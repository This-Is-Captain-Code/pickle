/**
 * Small-budget 0G Compute funding on Galileo testnet: talks to the LedgerManager contract directly, so the
 * ledger can be created at the CONTRACT minimum (MIN_ACCOUNT_BALANCE = 0.1 0G) instead of the SDK's
 * client-side 3 0G check. The SDK's own addLedger is just `addLedger('')` with value after that check
 * (lib.commonjs/ledger/ledger.js + ledger/contract/ledger.js), so this is equivalent.
 *
 *   npx tsx zerog/scripts/fund-compute-direct.mts --status
 *   npx tsx zerog/scripts/fund-compute-direct.mts --gas 0.17          # DEPLOYER → COMPUTE_WALLET (0.2 0G floor enforced)
 *   npx tsx zerog/scripts/fund-compute-direct.mts --ledger 0.15       # COMPUTE_WALLET: addLedger('') with value
 *   npx tsx zerog/scripts/fund-compute-direct.mts --transfer 0.05     # ledger → provider sub-account (inference)
 *   npx tsx zerog/scripts/fund-compute-direct.mts --retrieve          # sub-account → ledger (starts the refund lock)
 *   npx tsx zerog/scripts/fund-compute-direct.mts --refund 0.1        # ledger → COMPUTE_WALLET
 *
 * All sends go through agents/src/tx.ts sendTx (simulated, queued, audited to agents/logs/audit.jsonl).
 */
import { config } from 'dotenv';
import { Contract, Interface, Wallet, formatEther, parseEther } from 'ethers';
import { galileoProvider, explorerTx } from '../../agents/src/chain.ts';
import { sendTx } from '../../agents/src/tx.ts';
import { DEPLOYER_FLOOR_WEI, namedWallet } from '../../agents/src/wallets.ts';
import { TESTNET_DEFAULT_PROVIDER, loadComputeSdk } from '../src/direct.ts';

config({ path: 'agents/.env', quiet: true } as never);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

const provider = galileoProvider();
const LEDGER = loadComputeSdk().CONTRACT_ADDRESSES.testnet.ledger;
const iface = new Interface([
  'function addLedger(string additionalInfo) payable returns (uint256, uint256)',
  'function transferFund(address provider, string serviceName, uint256 amount)',
  'function retrieveFund(address[] providers, string serviceName)',
  'function refund(uint256 amount)',
  'function getLedger(address user) view returns (tuple(address user, uint256 availableBalance, uint256 totalBalance, string additionalInfo))',
  'function MIN_ACCOUNT_BALANCE() view returns (uint256)',
  'function MIN_TRANSFER_AMOUNT() view returns (uint256)',
  'function getServiceInfo(address serviceAddress) view returns (tuple(address serviceAddress, address serviceContract, string serviceType, string version, string fullName, string description, bool isRecommended, uint256 registeredAt))',
]);
/** The ledger keys services by fullName (SDK ledger/broker.js getServiceNames): getServiceInfo(InferenceServing).fullName. */
async function inferenceServiceName(): Promise<string> {
  const info = await ledger.getServiceInfo(loadComputeSdk().CONTRACT_ADDRESSES.testnet.inference);
  return info.fullName as string;
}
const ledger = new Contract(LEDGER, iface, provider);
const providerAddr = process.env.ZEROG_PROVIDER_ADDRESS || TESTNET_DEFAULT_PROVIDER;
const ck = process.env.COMPUTE_WALLET_PRIVATE_KEY;
if (!ck) throw new Error('COMPUTE_WALLET_PRIVATE_KEY missing in agents/.env');
const compute = new Wallet(ck, provider);
const deployer = namedWallet('DEPLOYER', provider);

async function status(tag = 'status') {
  const [d, c] = await Promise.all([provider.getBalance(deployer.address), provider.getBalance(compute.address)]);
  let l = 'none';
  try { const g = await ledger.getLedger(compute.address); l = `available ${formatEther(g.availableBalance)} / total ${formatEther(g.totalBalance)} 0G`; } catch { /* no ledger */ }
  let sub = 'none';
  try {
    const sdk = loadComputeSdk();
    const b = await sdk.createZGComputeNetworkBroker(compute as never);
    const a = await b.inference.getAccount(providerAddr);
    sub = `balance ${formatEther(a.balance)} 0G, pendingRefund ${formatEther(a.pendingRefund)} 0G`;
  } catch (e) { sub = `none (${(e as Error).message.slice(0, 60)})`; }
  console.log(`[${tag}] DEPLOYER ${formatEther(d)} 0G | COMPUTE_WALLET ${compute.address} ${formatEther(c)} 0G | ledger ${l} | sub-account(${providerAddr.slice(0, 8)}…) ${sub}`);
  return { d, c };
}

const show = (r: { action: string; hash: string; cost: string }) => console.log(`  ${r.action}: ${explorerTx(r.hash)} · gas ${r.cost}`);

if (process.argv.includes('--status')) await status();

const gas = arg('--gas');
if (gas) {
  const value = parseEther(gas);
  const r = await sendTx({ wallet: deployer, walletName: 'DEPLOYER', action: `fund COMPUTE_WALLET ${gas} 0G`, to: compute.address, value, floorWei: DEPLOYER_FLOOR_WEI });
  show(r);
  const { d } = await status('after --gas');
  if (d < DEPLOYER_FLOOR_WEI) throw new Error(`DEPLOYER below floor: ${formatEther(d)} 0G`);
  console.log(`  ✔ DEPLOYER ${formatEther(d)} 0G ≥ floor ${formatEther(DEPLOYER_FLOOR_WEI)} 0G`);
}

const led = arg('--ledger');
if (led) {
  const min: bigint = await ledger.MIN_ACCOUNT_BALANCE();
  const value = parseEther(led);
  if (value < min) throw new Error(`ledger ${led} 0G < contract MIN_ACCOUNT_BALANCE ${formatEther(min)} 0G`);
  const r = await sendTx({ wallet: compute, walletName: 'COMPUTE_WALLET', action: `addLedger ${led} 0G`, to: LEDGER, data: iface.encodeFunctionData('addLedger', ['']), value, iface });
  show(r);
  await status('after --ledger');
}

const tr = arg('--transfer');
if (tr) {
  const min: bigint = await ledger.MIN_TRANSFER_AMOUNT();
  const amount = parseEther(tr);
  if (amount < min) throw new Error(`transfer ${tr} 0G < contract MIN_TRANSFER_AMOUNT ${formatEther(min)} 0G`);
  const r = await sendTx({ wallet: compute, walletName: 'COMPUTE_WALLET', action: `transferFund ${tr} 0G → ${providerAddr}`, to: LEDGER, data: iface.encodeFunctionData('transferFund', [providerAddr, await inferenceServiceName(), amount]), iface });
  show(r);
  await status('after --transfer');
}

if (process.argv.includes('--retrieve')) {
  const r = await sendTx({ wallet: compute, walletName: 'COMPUTE_WALLET', action: `retrieveFund ${providerAddr}`, to: LEDGER, data: iface.encodeFunctionData('retrieveFund', [[providerAddr], await inferenceServiceName()]), iface });
  show(r);
  await status('after --retrieve');
}

const rf = arg('--refund');
if (rf) {
  const r = await sendTx({ wallet: compute, walletName: 'COMPUTE_WALLET', action: `refund ${rf} 0G`, to: LEDGER, data: iface.encodeFunctionData('refund', [parseEther(rf)]), iface });
  show(r);
  await status('after --refund');
}
