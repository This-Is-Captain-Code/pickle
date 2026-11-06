/**
 * Deploy PickleEscrow to 0G Galileo and set it up for the demo. Idempotent: each step checks
 * chain state first and is skipped if already done, so a re-run costs nothing.
 *
 *   npm run deploy:escrow            (compiles first)
 *   npm run deploy:escrow -- --fresh (deploy a new contract even if one is recorded)
 *
 *  1. deploy PickleEscrow(maxPayout = 0.005 0G)         → shared/addresses.json, shared/abi/PickleEscrow.json
 *  2. registerRobot(G1 → AGENT_G1), registerRobot(R2 → AGENT_2)
 *  3. top up agent wallets with gas to a small target
 *  4. fund each robot's escrow balance with a tiny amount
 *
 * Every tx goes through sendTx with the deployer's 0.2 0G floor; costs are printed and audited.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEther } from 'ethers';
import { GALILEO, assertGalileo, explorerAddress, fmt0G, galileoProvider } from '../src/chain.ts';
import { ADDRESSES_PATH, ESCROW_ABI_PATH, Escrow } from '../src/escrow.ts';
import { deployTx, sendTx, type TxResult } from '../src/tx.ts';
import { DEPLOYER_FLOOR_WEI, WALLETS, namedWallet, robotId, type WalletName } from '../src/wallets.ts';
import { REPO_ROOT } from './smoke/lib.ts';

import { MAX_PAYOUT, DEMO_PAYOUT } from '../src/escrow.ts';
/** Gas targets: a bounty cycle (post+claim+settle) is ~250k gas ≈ 0.001 0G at 4 gwei. */
const GAS_TARGET: Partial<Record<WalletName, bigint>> = {
  AGENT_G1: parseEther('0.008'),
  AGENT_2: parseEther('0.003'),
};
/** Escrow balance per robot: G1 covers ~4 demo bounties, R2 one. */
const ROBOT_FUND: Record<string, bigint> = { G1: parseEther('0.004'), R2: parseEther('0.001') };

const ARTIFACT = join(REPO_ROOT, 'contracts/hardhat/artifacts/contracts/PickleEscrow.sol/PickleEscrow.json');
const fresh = process.argv.includes('--fresh');

const provider = galileoProvider();
await assertGalileo(provider);
const deployer = namedWallet('DEPLOYER', provider);
const opts = { floorWei: DEPLOYER_FLOOR_WEI, walletName: 'DEPLOYER' };
const txs: TxResult[] = [];
const note = (r: TxResult) => {
  txs.push(r);
  console.log(`  ${r.action.padEnd(34)} ${r.cost.padEnd(26)} ${r.explorer}`);
};

const startBal = await provider.getBalance(deployer.address);
console.log(`Deployer ${deployer.address} balance ${fmt0G(startBal)} (floor ${fmt0G(DEPLOYER_FLOOR_WEI)})`);

// 1. deploy
const addresses = existsSync(ADDRESSES_PATH) ? JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')) : {};
let escrowAddr: string | undefined = fresh ? undefined : addresses.galileo?.contracts?.PickleEscrow?.address;
if (escrowAddr && (await provider.getCode(escrowAddr)) === '0x') escrowAddr = undefined;
if (!escrowAddr) {
  const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  const r = await deployTx(deployer, artifact, [MAX_PAYOUT], { ...opts, action: 'deploy PickleEscrow' });
  note(r);
  escrowAddr = r.contractAddress!;
  mkdirSync(join(REPO_ROOT, 'shared/abi'), { recursive: true });
  writeFileSync(
    ESCROW_ABI_PATH,
    JSON.stringify({ contractName: 'PickleEscrow', address: escrowAddr, chainId: GALILEO.chainId, abi: artifact.abi }, null, 2) + '\n',
  );
  addresses.galileo ??= { chainId: GALILEO.chainId, explorer: GALILEO.explorer, contracts: {} };
  addresses.galileo.contracts.PickleEscrow = {
    address: escrowAddr,
    deployTx: r.hash,
    deployer: deployer.address,
    block: r.receipt.blockNumber,
    maxPayout: MAX_PAYOUT.toString(),
    demoPayout: DEMO_PAYOUT.toString(),
    abi: 'shared/abi/PickleEscrow.json',
    purpose: 'Pickle bounty escrow: robots hire humans',
    deployedAt: new Date().toISOString(),
  };
  addresses.galileo.robots = Object.fromEntries(
    WALLETS.filter((w) => w.robot).map((w) => [w.robot, { id: robotId(w.robot!), agentWallet: w.name, agent: namedWallet(w.name).address }]),
  );
  writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2) + '\n');
  console.log(`PickleEscrow deployed at ${explorerAddress(escrowAddr)}`);
} else {
  console.log(`PickleEscrow already at ${explorerAddress(escrowAddr)} (--fresh to redeploy)`);
}

const escrow = new Escrow(provider);

// 2. register robots
for (const w of WALLETS.filter((x) => x.robot)) {
  const rid = robotId(w.robot!);
  const agent = namedWallet(w.name, provider).address;
  if ((await escrow.agentOf(rid)).toLowerCase() === agent.toLowerCase()) {
    console.log(`  robot ${w.robot} already registered → ${w.name}`);
    continue;
  }
  note(await escrow.registerRobot(deployer, rid, agent, opts).then((r) => ({ ...r, action: `registerRobot ${w.robot}` })));
}

// 3. top up agent gas
for (const [name, target] of Object.entries(GAS_TARGET) as [WalletName, bigint][]) {
  const addr = namedWallet(name, provider).address;
  const bal = await provider.getBalance(addr);
  if (bal >= target) {
    console.log(`  ${name} gas ${fmt0G(bal)} ≥ target ${fmt0G(target)}`);
    continue;
  }
  const r = await sendTx({ wallet: deployer, ...opts, action: `top up ${name}`, args: { to: addr }, to: addr, value: target - bal });
  note({ ...r, action: `top up ${name} +${fmt0G(target - bal)}` });
}

// 4. fund robots
for (const [robot, amount] of Object.entries(ROBOT_FUND)) {
  const rid = robotId(robot);
  const bal = await escrow.robotBalance(rid);
  if (bal >= amount) {
    console.log(`  robot ${robot} escrow ${fmt0G(bal)} ≥ ${fmt0G(amount)}`);
    continue;
  }
  const r = await escrow.fund(deployer, rid, amount - bal, opts);
  note({ ...r, action: `fund robot ${robot} +${fmt0G(amount - bal)}` });
}

const endBal = await provider.getBalance(deployer.address);
const gas = txs.reduce((s, r) => s + r.costWei, 0n);
console.log(`\nDone. ${txs.length} tx, gas ${fmt0G(gas)}. Deployer ${fmt0G(startBal)} → ${fmt0G(endBal)} (spent ${fmt0G(startBal - endBal)} incl. transfers).`);
