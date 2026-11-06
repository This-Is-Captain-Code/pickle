/**
 * 0G Storage client (Galileo, turbo indexer). Uploads are paid by the DEPLOYER wallet (decision: storage
 * reuses the deployer). SDK: @0gfoundation/0g-storage-ts-sdk 1.2.13 — see docs/sponsors.md §3.
 *
 * The SDK signs and sends its own Flow.submit tx, so it can't use sendTx directly. Instead it runs
 * inside the wallet's sendTx queue (runExclusive) with our nonce, is checked against the deployer's
 * 0.2 0G floor first, and the resulting tx (gas + storage fee) is appended to agents/logs/audit.jsonl.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { formatEther, type Wallet } from 'ethers';
import { GALILEO, explorerTx } from './chain.js';
import { BudgetFloorError, audit, runExclusive } from './tx.js';

export const STORAGE_INDEXER = process.env.ZEROG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
export const STORAGE_EXPLORER = 'https://storagescan-galileo.0g.ai';
/** Upper bound we allow for one small upload (gas + fee) when checking the budget floor. */
const UPLOAD_WORST_CASE_WEI = 5_000_000_000_000_000n; // 0.005 0G

export interface UploadResult {
  rootHash: string;
  txHash: string;
  /** gas + storage fee (tx value) */
  costWei: bigint;
  cost: string;
  storageFeeWei: bigint;
  bytes: number;
  explorer: string;
  ms: number;
}

const rpcUrl = () => process.env.ZEROG_RPC_URL || GALILEO.rpcUrl;
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  // The SDK console.logs progress on every step; keep our output readable.
  const orig = console.log;
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = orig;
  }
};

/** Merkle root of `bytes` without uploading (what upload() will return). */
export async function rootOf(bytes: Uint8Array): Promise<string> {
  const [tree, err] = await new MemData(bytes).merkleTree();
  if (err || !tree) throw new Error(`merkleTree failed: ${err?.message}`);
  return tree.rootHash()!;
}

export async function uploadBytes(
  bytes: Uint8Array,
  wallet: Wallet,
  opts: { action?: string; walletName?: string; floorWei?: bigint; verbose?: boolean } = {},
): Promise<UploadResult> {
  const action = opts.action ?? 'storage upload';
  const base = { wallet: wallet.address, walletName: opts.walletName, action, args: { bytes: bytes.length } };
  const provider = wallet.provider!;
  return runExclusive(wallet, async (nonce) => {
    if (opts.floorWei !== undefined) {
      const bal = await provider.getBalance(wallet.address);
      if (bal - UPLOAD_WORST_CASE_WEI < opts.floorWei) {
        audit({ ...base, result: 'refused:BudgetFloor', detail: `balance=${bal}` });
        throw new BudgetFloorError(action, bal, UPLOAD_WORST_CASE_WEI, opts.floorWei);
      }
    }
    const t0 = Date.now();
    const indexer = new Indexer(STORAGE_INDEXER);
    const run = () => indexer.upload(new MemData(bytes), rpcUrl(), wallet as never, { nonce: BigInt(nonce) } as never);
    const [res, err] = opts.verbose ? await run() : await quiet(run);
    if (err) {
      audit({ ...base, result: 'error:upload', nonce, detail: String(err.message ?? err).slice(0, 300) });
      throw new Error(`0G Storage upload failed: ${err.message ?? err}`);
    }
    if (!('rootHash' in res)) throw new Error('unexpected fragmented upload for a small file');
    const { rootHash, txHash } = res;
    let costWei = 0n;
    let storageFeeWei = 0n;
    if (txHash) {
      const [rcpt, tx] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)]);
      storageFeeWei = tx?.value ?? 0n;
      costWei = (rcpt ? rcpt.gasUsed * (rcpt.gasPrice ?? 0n) : 0n) + storageFeeWei;
    }
    const cost = `${formatEther(costWei)} 0G`;
    audit({
      ...base,
      result: txHash ? 'mined' : 'already-stored',
      hash: txHash || undefined,
      nonce,
      cost,
      costWei: costWei.toString(),
      detail: `rootHash=${rootHash} storageFee=${storageFeeWei}`,
    });
    return {
      rootHash,
      txHash,
      costWei,
      cost,
      storageFeeWei,
      bytes: bytes.length,
      explorer: txHash ? explorerTx(txHash) : '',
      ms: Date.now() - t0,
    };
  });
}

/** Download by root with Merkle proof verification. */
export async function downloadBytes(rootHash: string, opts: { verbose?: boolean } = {}): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'pickle-0g-'));
  const out = join(dir, 'blob');
  try {
    const indexer = new Indexer(STORAGE_INDEXER);
    const run = () => indexer.download(rootHash, out, true);
    let err: Error | null = null;
    for (let i = 0; i < 6; i++) {
      // freshly uploaded files can take a few seconds to be served by every node
      rmSync(out, { force: true });
      err = opts.verbose ? await run() : await quiet(run);
      if (!err) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (err) throw new Error(`0G Storage download ${rootHash} failed: ${err.message ?? err}`);
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
