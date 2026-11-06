/**
 * The one safe transaction path. Every on-chain write in agents/ goes through `sendTx`.
 *
 *  1. Simulate (eth_call) → a revert is REFUSED before anything is signed, with its custom error name.
 *  2. Estimate gas, add a margin (default +25%).
 *  3. Optional budget floor: refuse if balance − (gasLimit × maxFee + value) would drop below it.
 *  4. One serial queue per wallet with a local nonce (fetched once from `pending`, then tracked).
 *  5. Sign ONCE. Network errors retry by re-broadcasting the SAME signed bytes (same hash), never a new tx.
 *  6. Wait for the receipt; a mined revert is reported as TxReverted.
 *  7. Every attempt is appended to agents/logs/audit.jsonl: time, wallet, action, args, result, hash, cost.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Interface,
  formatEther,
  isError,
  keccak256,
  type InterfaceAbi,
  type JsonRpcProvider,
  type TransactionReceipt,
  type Wallet,
} from 'ethers';
import { GALILEO, explorerTx } from './chain.js';

export const AUDIT_LOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'audit.jsonl');

// ───────────────────────────── errors ─────────────────────────────
export interface DecodedRevert {
  name: string;
  args: unknown[];
  signature?: string;
}

/** Simulation reverted: nothing was signed or sent. */
export class TxRefused extends Error {
  constructor(
    readonly action: string,
    readonly revert: DecodedRevert,
  ) {
    super(`${action} refused before sending: ${fmtRevert(revert)}`);
    this.name = 'TxRefused';
  }
}

/** Sending would take the wallet below its budget floor. Nothing was sent. */
export class BudgetFloorError extends Error {
  constructor(
    readonly action: string,
    readonly balance: bigint,
    readonly worstCase: bigint,
    readonly floor: bigint,
  ) {
    super(
      `${action} refused: balance ${formatEther(balance)} − worst case ${formatEther(worstCase)} ` +
        `would drop below the ${formatEther(floor)} 0G floor`,
    );
    this.name = 'BudgetFloorError';
  }
}

/** Mined but reverted (status 0). The nonce was consumed and gas was paid. */
export class TxReverted extends Error {
  constructor(
    readonly action: string,
    readonly hash: string,
    readonly receipt: TransactionReceipt,
    readonly revert?: DecodedRevert,
  ) {
    super(`${action} reverted on-chain (${hash})${revert ? `: ${fmtRevert(revert)}` : ''}`);
    this.name = 'TxReverted';
  }
}

const fmtRevert = (r: DecodedRevert) =>
  r.args.length ? `${r.name}(${r.args.map((a) => String(a)).join(', ')})` : r.name;

// ───────────────────────────── revert decoding ─────────────────────
const errorInterfaces: Interface[] = [];

/** Register an ABI whose custom errors should be decodable by name (e.g. PickleEscrow). */
export function registerErrorAbi(abi: InterfaceAbi | Interface): void {
  errorInterfaces.push(abi instanceof Interface ? abi : new Interface(abi));
}

function revertData(err: any): string | undefined {
  const candidates = [err?.data, err?.info?.error?.data, err?.error?.data, err?.revert?.data];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x')) return c;
    if (c && typeof c.data === 'string') return c.data;
  }
  return undefined;
}

export function decodeRevert(err: unknown, extra?: Interface): DecodedRevert {
  const data = revertData(err);
  if (data && data.length >= 10) {
    for (const iface of extra ? [extra, ...errorInterfaces] : errorInterfaces) {
      try {
        const e = iface.parseError(data);
        if (e) return { name: e.name, args: [...e.args], signature: e.signature };
      } catch {
        /* not this ABI */
      }
    }
  }
  const e = err as any;
  if (e?.revert?.name) return { name: e.revert.name, args: [...(e.revert.args ?? [])] }; // Error(string), Panic
  if (e?.reason) return { name: 'Error', args: [e.reason] };
  return { name: data ? `UnknownError(${data.slice(0, 10)})` : 'UnknownRevert', args: [] };
}

function isRevert(err: unknown): boolean {
  if (isError(err, 'CALL_EXCEPTION')) return true;
  const e = err as any;
  return e?.info?.error?.code === 3 || e?.error?.code === 3 || /execution reverted/i.test(String(e?.message));
}

function isNetworkError(err: unknown): boolean {
  if (isError(err, 'NETWORK_ERROR') || isError(err, 'TIMEOUT') || isError(err, 'SERVER_ERROR')) return true;
  const msg = String((err as any)?.message ?? err);
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network|timeout|502|503|504/i.test(msg);
}

// ───────────────────────────── audit ──────────────────────────────
export interface AuditEntry {
  time: string;
  wallet: string;
  walletName?: string;
  action: string;
  args?: unknown;
  result: string;
  hash?: string;
  nonce?: number;
  attempt?: number;
  cost?: string;
  costWei?: string;
  detail?: string;
}

const jsonSafe = (v: unknown) =>
  JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export function audit(e: Omit<AuditEntry, 'time'>): void {
  mkdirSync(dirname(AUDIT_LOG), { recursive: true });
  appendFileSync(AUDIT_LOG, JSON.stringify({ time: new Date().toISOString(), ...jsonSafe(e) }) + '\n');
}

// ───────────────────────────── queue + nonce ──────────────────────
interface WalletQueue {
  tail: Promise<unknown>;
  nonce?: number;
}
const queues = new Map<string, WalletQueue>();

function queueFor(address: string): WalletQueue {
  const k = address.toLowerCase();
  let q = queues.get(k);
  if (!q) queues.set(k, (q = { tail: Promise.resolve() }));
  return q;
}

/** Forget the tracked nonce (next send re-reads `pending`). */
export function resetNonce(address: string): void {
  queueFor(address).nonce = undefined;
}

// ───────────────────────────── send ───────────────────────────────
export interface SendTxRequest {
  wallet: Wallet;
  /** Human-readable label, e.g. "postBounty" or "deploy PickleEscrow". */
  action: string;
  /** Recorded in the audit log only. */
  args?: unknown;
  /** Omit / null for contract creation. */
  to?: string | null;
  data?: string;
  value?: bigint;
  /** Extra ABI used to decode reverts for this call. */
  iface?: Interface;
  walletName?: string;
  gasMarginPct?: number;
  /** Refuse if the post-tx worst-case balance would be below this. */
  floorWei?: bigint;
  receiptTimeoutMs?: number;
  maxBroadcastAttempts?: number;
}

export interface TxResult {
  action: string;
  hash: string;
  nonce: number;
  receipt: TransactionReceipt;
  gasUsed: bigint;
  costWei: bigint;
  cost: string;
  explorer: string;
  contractAddress?: string;
  broadcastAttempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queue a transaction on the wallet's serial queue. Resolves once mined (status 1). */
export function sendTx(req: SendTxRequest): Promise<TxResult> {
  const q = queueFor(req.wallet.address);
  const run = q.tail.then(() => doSend(q, req));
  q.tail = run.catch(() => undefined);
  return run;
}

async function withNetRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries || isRevert(err) || !isNetworkError(err)) throw err;
      await sleep(500 * 2 ** i);
    }
  }
}

async function doSend(q: WalletQueue, req: SendTxRequest): Promise<TxResult> {
  const { wallet, action } = req;
  const provider = wallet.provider;
  if (!provider) throw new Error('sendTx: wallet has no provider');
  const rpc = provider as unknown as JsonRpcProvider;
  if (typeof rpc.send !== 'function') throw new Error('sendTx: wallet provider must be a JsonRpcProvider');
  const from = wallet.address;
  const value = req.value ?? 0n;
  const to = req.to ?? null;
  const data = req.data ?? '0x';
  const base = { wallet: from, walletName: req.walletName, action, args: req.args };
  const call = { from, to, data, value };

  // 1. simulate + 2. estimate (both surface reverts before signing)
  let gasEstimate: bigint;
  try {
    await withNetRetry(() => provider.call(call));
    gasEstimate = await withNetRetry(() => provider.estimateGas(call));
  } catch (err) {
    if (isRevert(err)) {
      const revert = decodeRevert(err, req.iface);
      audit({ ...base, result: `refused:${revert.name}`, detail: fmtRevert(revert) });
      throw new TxRefused(action, revert);
    }
    audit({ ...base, result: 'error:simulate', detail: String((err as Error).message ?? err).slice(0, 300) });
    throw err;
  }
  const gasLimit = (gasEstimate * BigInt(100 + (req.gasMarginPct ?? 25))) / 100n;

  const fee = await withNetRetry(() => provider.getFeeData());
  const maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? fee.gasPrice ?? 0n;
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;

  // 3. budget floor
  if (req.floorWei !== undefined) {
    const balance = await withNetRetry(() => provider.getBalance(from));
    const worst = gasLimit * maxFeePerGas + value;
    if (balance - worst < req.floorWei) {
      audit({ ...base, result: 'refused:BudgetFloor', detail: `balance=${balance} worst=${worst} floor=${req.floorWei}` });
      throw new BudgetFloorError(action, balance, worst, req.floorWei);
    }
  }

  // 4. nonce (local tracking; read from chain only on first use or after a reset)
  if (q.nonce === undefined) q.nonce = await withNetRetry(() => provider.getTransactionCount(from, 'pending'));
  const nonce = q.nonce;

  // 5. sign once
  const raw = await wallet.signTransaction({
    type: 2,
    chainId: GALILEO.chainId,
    nonce,
    to,
    data,
    value,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const hash = keccak256(raw);

  const maxAttempts = req.maxBroadcastAttempts ?? 5;
  let attempt = 0;
  let accepted = false;
  while (!accepted) {
    attempt++;
    try {
      await rpc.send('eth_sendRawTransaction', [raw]);
      accepted = true;
      audit({ ...base, result: 'broadcast', hash, nonce, attempt });
    } catch (err) {
      const msg = String((err as any)?.info?.error?.message ?? (err as any)?.error?.message ?? (err as Error).message);
      if (/already known|known transaction|already imported/i.test(msg)) {
        accepted = true;
        audit({ ...base, result: 'broadcast:already-known', hash, nonce, attempt });
      } else if (/nonce too low/i.test(msg)) {
        // Either our earlier attempt landed, or someone else used this nonce.
        const seen = await provider.getTransaction(hash).catch(() => null);
        if (seen) {
          accepted = true;
          audit({ ...base, result: 'broadcast:already-mined', hash, nonce, attempt });
        } else {
          q.nonce = undefined;
          audit({ ...base, result: 'error:nonce-too-low', hash, nonce, attempt, detail: msg.slice(0, 200) });
          throw new Error(`${action}: nonce ${nonce} too low and our tx is unknown — nonce resynced, nothing sent`);
        }
      } else if (isNetworkError(err) && attempt < maxAttempts) {
        audit({ ...base, result: 'retry:network', hash, nonce, attempt, detail: msg.slice(0, 200) });
        await sleep(750 * 2 ** (attempt - 1));
      } else {
        // Rejected by the node (e.g. underpriced) — the nonce was not consumed.
        audit({ ...base, result: 'error:broadcast', hash, nonce, attempt, detail: msg.slice(0, 300) });
        throw new Error(`${action}: broadcast failed: ${msg}`);
      }
    }
  }
  q.nonce = nonce + 1;

  // 6. wait for the receipt, re-broadcasting the same bytes if it goes missing
  const deadline = Date.now() + (req.receiptTimeoutMs ?? 180_000);
  let lastRebroadcast = Date.now();
  let receipt: TransactionReceipt | null = null;
  while (!receipt) {
    receipt = await provider.getTransactionReceipt(hash).catch(() => null);
    if (receipt) break;
    if (Date.now() > deadline) {
      audit({ ...base, result: 'timeout:receipt', hash, nonce, attempt });
      throw new Error(`${action}: no receipt for ${hash} after ${(req.receiptTimeoutMs ?? 180_000) / 1000}s (still pending)`);
    }
    if (Date.now() - lastRebroadcast > 30_000) {
      lastRebroadcast = Date.now();
      await rpc.send('eth_sendRawTransaction', [raw]).catch(() => undefined); // same signed tx
    }
    await sleep(1200);
  }

  const gasUsed = receipt.gasUsed;
  const costWei = gasUsed * (receipt.gasPrice ?? maxFeePerGas);
  const cost = `${formatEther(costWei)} 0G`;
  if (receipt.status !== 1) {
    let revert: DecodedRevert | undefined;
    try {
      await provider.call({ ...call, blockTag: receipt.blockNumber });
    } catch (err) {
      revert = decodeRevert(err, req.iface);
    }
    audit({ ...base, result: `reverted${revert ? `:${revert.name}` : ''}`, hash, nonce, attempt, cost, costWei: costWei.toString() });
    throw new TxReverted(action, hash, receipt, revert);
  }
  audit({ ...base, result: 'mined', hash, nonce, attempt, cost, costWei: costWei.toString() });
  return {
    action,
    hash,
    nonce,
    receipt,
    gasUsed,
    costWei,
    cost,
    explorer: explorerTx(hash),
    contractAddress: receipt.contractAddress ?? undefined,
    broadcastAttempts: attempt,
  };
}

// ───────────────────────────── helpers ────────────────────────────
/** Encode a contract method call and send it through sendTx. */
export function callTx(
  wallet: Wallet,
  contract: { address: string; iface: Interface },
  method: string,
  args: unknown[],
  opts: Omit<SendTxRequest, 'wallet' | 'action' | 'to' | 'data' | 'iface' | 'args'> & { action?: string } = {},
): Promise<TxResult> {
  return sendTx({
    ...opts,
    wallet,
    action: opts.action ?? method,
    args,
    to: contract.address,
    data: contract.iface.encodeFunctionData(method, args),
    iface: contract.iface,
  });
}

/** Deploy a contract through sendTx. */
export function deployTx(
  wallet: Wallet,
  artifact: { abi: InterfaceAbi; bytecode: string },
  ctorArgs: unknown[],
  opts: Omit<SendTxRequest, 'wallet' | 'to' | 'data' | 'iface' | 'args' | 'action'> & { action?: string } = {},
): Promise<TxResult> {
  const iface = new Interface(artifact.abi);
  return sendTx({
    ...opts,
    wallet,
    action: opts.action ?? 'deploy',
    args: ctorArgs,
    to: null,
    data: artifact.bytecode + iface.encodeDeploy(ctorArgs).slice(2),
    iface,
  });
}

/**
 * Run an external sender (e.g. the 0G Storage SDK, which signs its own Flow.submit tx) inside the
 * wallet's serial queue, so it can never race a sendTx nonce. `fn` gets the next nonce to use; the
 * tracked nonce is re-read from the chain afterwards, since we can't see what `fn` broadcast.
 */
export function runExclusive<T>(wallet: Wallet, fn: (nonce: number) => Promise<T>): Promise<T> {
  const q = queueFor(wallet.address);
  const run = q.tail.then(async () => {
    const provider = wallet.provider!;
    if (q.nonce === undefined) q.nonce = await withNetRetry(() => provider.getTransactionCount(wallet.address, 'pending'));
    try {
      return await fn(q.nonce);
    } finally {
      q.nonce = undefined;
    }
  });
  q.tail = run.catch(() => undefined);
  return run;
}
