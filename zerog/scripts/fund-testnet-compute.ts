/**
 * 0G Compute (Galileo testnet) funding — READ-ONLY by default.
 *
 *   npx tsx zerog/scripts/fund-testnet-compute.ts                 # status only, spends nothing
 *   npx tsx zerog/scripts/fund-testnet-compute.ts --ledger 3      # create ledger with 3 0G (or deposit if it exists)
 *   npx tsx zerog/scripts/fund-testnet-compute.ts --transfer 1    # move 1 0G from ledger to the provider sub-account
 *
 * Wallet: COMPUTE_WALLET_PRIVATE_KEY only. A dedicated wallet so compute never sends from the deployer
 * while another process is using it. Create it with `npx tsx agents/scripts/new-wallet.ts COMPUTE_WALLET`.
 * Provider: ZEROG_PROVIDER_ADDRESS, else the reachable testnet chatbot (qwen/qwen3.8-omni-flash).
 * Minimums are read from the LedgerManager contract (MIN_ACCOUNT_BALANCE, MIN_TRANSFER_AMOUNT), not assumed.
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import { TESTNET_DEFAULT_PROVIDER, TESTNET_RPC, loadComputeSdk } from '../src/direct.js';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../agents/.env'), quiet: true } as never);

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ledgerAmount = arg('--ledger');
const transferAmount = arg('--transfer');

const key = process.env.COMPUTE_WALLET_PRIVATE_KEY;
if (!key) throw new Error('Set COMPUTE_WALLET_PRIVATE_KEY in agents/.env (npx tsx agents/scripts/new-wallet.ts COMPUTE_WALLET)');
const rpc = process.env.ZEROG_RPC_URL || TESTNET_RPC;
const providerAddr = process.env.ZEROG_PROVIDER_ADDRESS || TESTNET_DEFAULT_PROVIDER;

const sdk = loadComputeSdk();
const rpcProvider = new JsonRpcProvider(rpc);
const wallet = new Wallet(key, rpcProvider);
const ledgerAddr = sdk.CONTRACT_ADDRESSES.testnet.ledger;

const ledgerRead = new Contract(ledgerAddr, [
  'function MIN_ACCOUNT_BALANCE() view returns (uint256)',
  'function MIN_TRANSFER_AMOUNT() view returns (uint256)',
], rpcProvider);
const [minAccount, minTransfer] = await Promise.all([
  ledgerRead.MIN_ACCOUNT_BALANCE().catch(() => undefined),
  ledgerRead.MIN_TRANSFER_AMOUNT().catch(() => undefined),
]);

console.log(`wallet           ${wallet.address}`);
console.log(`wallet balance   ${formatEther(await rpcProvider.getBalance(wallet.address))} 0G`);
console.log(`ledger contract  ${ledgerAddr} (SDK CONTRACT_ADDRESSES.testnet)`);
console.log(`on-chain minimums: MIN_ACCOUNT_BALANCE=${minAccount !== undefined ? formatEther(minAccount) + ' 0G' : 'n/a'}, MIN_TRANSFER_AMOUNT=${minTransfer !== undefined ? formatEther(minTransfer) + ' 0G' : 'n/a'}`);
console.log(`provider         ${providerAddr}`);

const broker = await sdk.createZGComputeNetworkBroker(wallet);

async function status() {
  try {
    const l = await broker.ledger.getLedger();
    console.log(`ledger           available ${formatEther(l.availableBalance)} 0G / total ${formatEther(l.totalBalance)} 0G`);
  } catch (e) {
    console.log(`ledger           none yet (${(e as Error).message.slice(0, 120)})`);
  }
  try {
    const a = await broker.inference.getAccount(providerAddr);
    console.log(`sub-account      balance ${formatEther(a.balance)} 0G · pendingRefund ${formatEther(a.pendingRefund)} 0G · acknowledged ${a.acknowledged}`);
  } catch (e) {
    console.log(`sub-account      none yet (${(e as Error).message.slice(0, 120)})`);
  }
}

await status();

if (ledgerAmount) {
  const n = Number(ledgerAmount);
  let exists = true;
  try { await broker.ledger.getLedger(); } catch { exists = false; }
  console.log(`\n→ ${exists ? 'depositFund' : 'addLedger'}(${n}) — spends ${n} 0G + gas`);
  if (exists) await broker.ledger.depositFund(n); else await broker.ledger.addLedger(n);
  await status();
}
if (transferAmount) {
  console.log(`\n→ transferFund(${providerAddr}, inference, ${transferAmount} 0G)`);
  await broker.ledger.transferFund(providerAddr, 'inference', parseEther(transferAmount));
  await status();
}
