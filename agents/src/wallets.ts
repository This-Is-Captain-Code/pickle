/**
 * Named wallets used on 0G Galileo. Keys live only in agents/.env (`<NAME>_PRIVATE_KEY`).
 *
 * Robots are identified on-chain by a deterministic address derived from their name
 * (no key exists for it): keccak256("pickle.robot.<name>") truncated to 20 bytes.
 * Each robot is operated by one agent wallet, which is the only account allowed to post,
 * claim and settle its bounties in PickleEscrow.
 */
import { Wallet, getAddress, id as keccakText, type Provider } from 'ethers';
import { galileoProvider } from './chain.js';

export type WalletName = 'DEPLOYER' | 'AGENT_G1' | 'AGENT_2';

export interface WalletInfo {
  name: WalletName;
  role: string;
  /** Robot this wallet is the agent for, if any. */
  robot?: string;
}

export const WALLETS: readonly WalletInfo[] = [
  { name: 'DEPLOYER', role: 'deployer + PickleEscrow owner; 0G Storage uploads' },
  { name: 'AGENT_G1', role: 'agent for robot G1 (simulated Unitree G1)', robot: 'G1' },
  { name: 'AGENT_2', role: 'agent for robot R2 (second robot, robot-to-robot bidding)', robot: 'R2' },
];

/** Deterministic on-chain ID for a robot name. */
export function robotId(robotName: string): string {
  return getAddress('0x' + keccakText(`pickle.robot.${robotName}`).slice(-40));
}

export function hasKey(name: WalletName): boolean {
  return Boolean(process.env[`${name}_PRIVATE_KEY`]?.trim());
}

/** Signer for a named wallet. Throws if the key is missing; never logs the key. */
export function namedWallet(name: WalletName, provider: Provider = galileoProvider()): Wallet {
  const key = process.env[`${name}_PRIVATE_KEY`]?.trim();
  if (!key) throw new Error(`${name}_PRIVATE_KEY is not set in agents/.env`);
  return new Wallet(key, provider);
}

/** Address for a named wallet, from the key (authoritative) — never from *_ADDRESS. */
export function addressOf(name: WalletName): string {
  return namedWallet(name).address;
}

/** The deployer must never drop below this (user rule). Passed to sendTx as `floorWei`. */
export const DEPLOYER_FLOOR_WEI = 200_000_000_000_000_000n; // 0.2 0G

/** Budget floor for a named wallet (only the deployer has one). */
export function floorFor(name: WalletName): bigint | undefined {
  return name === 'DEPLOYER' ? DEPLOYER_FLOOR_WEI : undefined;
}
