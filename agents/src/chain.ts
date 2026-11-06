/**
 * Minimal 0G Chain (Galileo testnet) client.
 * Network facts: https://docs.0g.ai/developer-hub/testnet/testnet-overview (see docs/sponsors.md §1).
 */
import { JsonRpcProvider, Wallet, formatEther } from 'ethers';

export const GALILEO = {
  chainId: 16602,
  name: '0G Galileo Testnet',
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorer: 'https://chainscan-galileo.0g.ai',
} as const;

export const explorerTx = (hash: string) => `${GALILEO.explorer}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${GALILEO.explorer}/address/${addr}`;

export function galileoProvider(rpcUrl = process.env.ZEROG_RPC_URL || GALILEO.rpcUrl): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, { chainId: GALILEO.chainId, name: 'galileo' }, { staticNetwork: true });
}

/** Wallet from an env var holding a private key. Never logs the key. */
export function walletFromEnv(varName: string, provider = galileoProvider()): Wallet {
  const key = process.env[varName];
  if (!key) throw new Error(`${varName} is not set in agents/.env`);
  return new Wallet(key, provider);
}

export async function assertGalileo(provider: JsonRpcProvider): Promise<void> {
  const { chainId } = await provider.getNetwork();
  const live = Number(await provider.send('eth_chainId', []));
  if (live !== GALILEO.chainId || Number(chainId) !== GALILEO.chainId) {
    throw new Error(`Wrong chain: RPC reports ${live}, expected ${GALILEO.chainId}`);
  }
}

export const fmt0G = (wei: bigint) => `${formatEther(wei)} 0G`;
