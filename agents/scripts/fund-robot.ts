// Top up one robot's escrow balance from a named wallet (default DEPLOYER, which
// has the 0.2 0G floor; use --from AGENT_G1 etc. when the deployer is at its floor).
//   npx tsx --env-file=.env scripts/fund-robot.ts R2 0.001 --from AGENT_G1
import { readFileSync } from 'node:fs';
import { formatEther, parseEther } from 'ethers';
import { ADDRESSES_PATH, Escrow } from '../src/escrow.js';
import { galileoProvider } from '../src/chain.js';
import { floorFor, namedWallet, type WalletName } from '../src/wallets.js';

const [robotName, amountArg] = process.argv.slice(2);
const fromIdx = process.argv.indexOf('--from');
const from = (fromIdx > 0 ? process.argv[fromIdx + 1] : 'DEPLOYER') as WalletName;
if (!robotName || !amountArg) { console.error('usage: fund-robot.ts <G1|R2> <amount0G> [--from WALLET]'); process.exit(2); }

const robots = JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')).galileo.robots as Record<string, { id: string }>;
const robot = robots[robotName];
if (!robot) { console.error(`unknown robot ${robotName}; known: ${Object.keys(robots).join(', ')}`); process.exit(2); }

const provider = galileoProvider();
const wallet = namedWallet(from, provider);
const e = new Escrow(provider);
const amount = parseEther(amountArg);
console.log(`${from} ${wallet.address} balance ${formatEther(await provider.getBalance(wallet.address))} 0G -> fund ${robotName} +${amountArg} 0G (escrow now ${formatEther(await e.robotBalance(robot.id))})`);
const r = await e.fund(wallet, robot.id, amount, { floorWei: floorFor(from), walletName: from });
console.log(`funded: ${r.explorer}  (gas ${r.cost})`);
console.log(`${robotName} escrow balance now ${formatEther(await e.robotBalance(robot.id))} 0G`);
