/**
 * PickleEscrow client. Address + ABI come from shared/ (written by `npm run deploy:escrow`).
 * All writes go through sendTx (agents/src/tx.ts): simulated first, serial per wallet, audited.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, Interface, id as keccakText, type Provider, type Wallet } from 'ethers';
import { galileoProvider } from './chain.js';
import { callTx, registerErrorAbi, type TxResult } from './tx.js';

const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared');
export const ESCROW_ABI_PATH = join(SHARED, 'abi', 'PickleEscrow.json');
export const ADDRESSES_PATH = join(SHARED, 'addresses.json');

/** Contract cap set at deploy, and the demo bounty payout (user spec). */
export const MAX_PAYOUT = 5_000_000_000_000_000n; // 0.005 0G
export const DEMO_PAYOUT = 1_000_000_000_000_000n; // 0.001 0G

export const BountyStatus = ['None', 'Open', 'Claimed', 'Settled', 'Expired', 'Cancelled'] as const;

export interface OnchainBounty {
  robot: string;
  payout: bigint;
  claimWindow: bigint;
  deadline: bigint;
  worker: string;
  humanHash: string;
  status: (typeof BountyStatus)[number];
}

export function escrowDeployed(): boolean {
  if (!existsSync(ESCROW_ABI_PATH) || !existsSync(ADDRESSES_PATH)) return false;
  return Boolean(JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')).galileo?.contracts?.PickleEscrow?.address);
}

/**
 * Hash of a claimer's World identity, scoped to one bounty. `subject` is the World
 * identifier we validated (e.g. `${iss}|${sub}` or a nullifier); never stored in clear on-chain.
 */
export function humanHash(subject: string): string {
  return keccakText(`pickle.human.${subject}`);
}

export class Escrow {
  readonly iface: Interface;
  readonly address: string;
  readonly read: Contract;

  constructor(provider: Provider = galileoProvider()) {
    if (!escrowDeployed()) throw new Error('PickleEscrow not deployed — run `npm run deploy:escrow`');
    this.iface = new Interface(JSON.parse(readFileSync(ESCROW_ABI_PATH, 'utf8')).abi);
    this.address = JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')).galileo.contracts.PickleEscrow.address;
    this.read = new Contract(this.address, this.iface, provider);
    registerErrorAbi(this.iface);
  }

  private tx(w: Wallet, method: string, args: unknown[], opts: { value?: bigint; floorWei?: bigint; walletName?: string } = {}) {
    return callTx(w, { address: this.address, iface: this.iface }, method, args, opts);
  }

  // owner
  registerRobot(owner: Wallet, robot: string, agent: string, o?: { floorWei?: bigint; walletName?: string }) {
    return this.tx(owner, 'registerRobot', [robot, agent], o);
  }
  setMaxPayout(owner: Wallet, wei: bigint, o?: { floorWei?: bigint; walletName?: string }) {
    return this.tx(owner, 'setMaxPayout', [wei], o);
  }
  fund(from: Wallet, robot: string, wei: bigint, o?: { floorWei?: bigint; walletName?: string }) {
    return this.tx(from, 'fund', [robot], { ...o, value: wei });
  }

  // agent
  postBounty(agent: Wallet, robot: string, payout: bigint, claimWindowSec: number, o?: { walletName?: string }) {
    return this.tx(agent, 'postBounty', [robot, payout, claimWindowSec], o);
  }
  claim(agent: Wallet, bountyId: bigint, worker: string, hHash: string, o?: { walletName?: string }) {
    return this.tx(agent, 'claim', [bountyId, worker, hHash], o);
  }
  settle(agent: Wallet, bountyId: bigint, computeRequestId: string, storageRoot: string, o?: { walletName?: string }) {
    return this.tx(agent, 'settle', [bountyId, computeRequestId, storageRoot], o);
  }
  cancel(agent: Wallet, bountyId: bigint, o?: { walletName?: string }) {
    return this.tx(agent, 'cancel', [bountyId], o);
  }
  // anyone
  expire(caller: Wallet, bountyId: bigint, o?: { walletName?: string; floorWei?: bigint }) {
    return this.tx(caller, 'expire', [bountyId], o);
  }

  // views
  async bounty(bountyId: bigint): Promise<OnchainBounty> {
    const b = await this.read.getBounty(bountyId);
    return {
      robot: b.robot,
      payout: b.payout,
      claimWindow: b.claimWindow,
      deadline: b.deadline,
      worker: b.worker,
      humanHash: b.humanHash,
      status: BountyStatus[Number(b.status)],
    };
  }
  robotBalance(robot: string): Promise<bigint> {
    return this.read.robotBalance(robot);
  }
  async agentOf(robot: string): Promise<string> {
    return (await this.read.robots(robot)).agent;
  }

  /** Bounty ID from a postBounty receipt. */
  bountyIdFrom(r: TxResult): bigint {
    for (const log of r.receipt.logs) {
      try {
        const p = this.iface.parseLog(log);
        if (p?.name === 'BountyPosted') return p.args.bountyId as bigint;
      } catch {
        /* other contract */
      }
    }
    throw new Error(`no BountyPosted event in ${r.hash}`);
  }

  /** Decode this contract's events from a receipt (for printing). */
  events(r: TxResult): { name: string; args: Record<string, unknown> }[] {
    const out: { name: string; args: Record<string, unknown> }[] = [];
    for (const log of r.receipt.logs) {
      try {
        const p = this.iface.parseLog(log);
        if (p) out.push({ name: p.name, args: Object.fromEntries(p.fragment.inputs.map((f, i) => [f.name, p.args[i]])) });
      } catch {
        /* skip */
      }
    }
    return out;
  }
}
