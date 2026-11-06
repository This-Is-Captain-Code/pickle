/**
 * smoke:escrow — live PickleEscrow bounties on 0G Galileo (robot G1, agent AGENT_G1).
 *
 *  happy: postBounty(0.001) → claim(worker, humanHash) → settle(computeRequestId, storageRoot)
 *  fail:  postBounty(0.001) → claim (20 s window) → wait → expire (called by AGENT_2: "anyone")
 *
 * Default computeRequestId / storageRoot are dummies; smoke:episode passes real ones.
 * The worker defaults to the deployer address so demo payouts come back to us
 * (override with SMOKE_WORKER_ADDRESS).
 */
import { ZeroHash, id as keccakText } from 'ethers';
import { assertGalileo, explorerAddress, fmt0G, galileoProvider } from '../../src/chain.ts';
import { DEMO_PAYOUT, Escrow, humanHash } from '../../src/escrow.ts';
import type { TxResult } from '../../src/tx.ts';
import { namedWallet, robotId } from '../../src/wallets.ts';
import { isMain, runSmoke } from './lib.ts';

type Log = (m: string) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BountyRun {
  bountyId: bigint;
  txs: TxResult[];
}

function ctx() {
  const provider = galileoProvider();
  return {
    provider,
    escrow: new Escrow(provider),
    agent: namedWallet('AGENT_G1', provider),
    other: namedWallet('AGENT_2', provider),
    robot: robotId('G1'),
    worker: process.env.SMOKE_WORKER_ADDRESS || namedWallet('DEPLOYER', provider).address,
  };
}

const show = (log: Log, r: TxResult) => log(`${r.action.padEnd(8)} ${r.cost.padEnd(26)} ${r.explorer}`);

/** post → claim → settle. Returns the bounty ID and txs. */
export async function liveHappyPath(
  log: Log,
  refs: { computeRequestId: string; storageRoot: string; human?: string } = {
    computeRequestId: `dummy-compute-${Date.now()}`,
    storageRoot: keccakText(`dummy-storage-root-${Date.now()}`),
  },
): Promise<BountyRun> {
  const { provider, escrow, agent, robot, worker } = ctx();
  await assertGalileo(provider);
  const txs: TxResult[] = [];
  const workerBefore = await provider.getBalance(worker);

  const post = await escrow.postBounty(agent, robot, DEMO_PAYOUT, 600, { walletName: 'AGENT_G1' });
  const bountyId = escrow.bountyIdFrom(post);
  txs.push(post);
  show(log, post);
  log(`bounty #${bountyId} posted, payout ${fmt0G(DEMO_PAYOUT)}`);

  const hh = humanHash(refs.human ?? `smoke-human-${Date.now()}`);
  const claim = await escrow.claim(agent, bountyId, worker, hh, { walletName: 'AGENT_G1' });
  txs.push(claim);
  show(log, claim);

  const settle = await escrow.settle(agent, bountyId, refs.computeRequestId, refs.storageRoot, { walletName: 'AGENT_G1' });
  txs.push(settle);
  show(log, settle);

  const b = await escrow.bounty(bountyId);
  if (b.status !== 'Settled') throw new Error(`bounty #${bountyId} status ${b.status}, expected Settled`);
  const ev = escrow.events(settle).find((e) => e.name === 'BountySettled');
  if (!ev) throw new Error('no BountySettled event');
  if (ev.args.computeRequestId !== refs.computeRequestId || ev.args.storageRoot !== refs.storageRoot)
    throw new Error('BountySettled event does not carry the compute/storage refs');
  const workerAfter = await provider.getBalance(worker);
  if (workerAfter - workerBefore !== DEMO_PAYOUT && worker !== agent.address)
    log(`note: worker balance moved ${fmt0G(workerAfter - workerBefore)} (other txs from the worker may overlap)`);
  log(`settled ✔ event computeRequestId=${ev.args.computeRequestId} storageRoot=${ev.args.storageRoot}`);
  return { bountyId, txs };
}

/** post → claim (short window) → wait → expire by a third party. */
export async function liveExpirePath(log: Log, windowSec = 20): Promise<BountyRun> {
  const { provider, escrow, agent, other, robot, worker } = ctx();
  const txs: TxResult[] = [];
  const balBefore = await escrow.robotBalance(robot);

  const post = await escrow.postBounty(agent, robot, DEMO_PAYOUT, windowSec, { walletName: 'AGENT_G1' });
  const bountyId = escrow.bountyIdFrom(post);
  txs.push(post);
  show(log, post);
  const claim = await escrow.claim(agent, bountyId, worker, humanHash(`smoke-expire-${Date.now()}`), {
    walletName: 'AGENT_G1',
  });
  txs.push(claim);
  show(log, claim);

  const { deadline } = await escrow.bounty(bountyId);
  // Wait until the chain's clock is past the deadline (block timestamps, not local time).
  for (;;) {
    const ts = BigInt((await provider.getBlock('latest'))!.timestamp);
    if (ts > deadline) break;
    log(`waiting for claim window: chain time ${ts}, deadline ${deadline}`);
    await sleep(Number(deadline - ts + 2n) * 1000);
  }
  // settle must now be refused (simulation) with ClaimExpired — nothing sent.
  try {
    await escrow.settle(agent, bountyId, 'late', ZeroHash, { walletName: 'AGENT_G1' });
    throw new Error('late settle was sent — expected ClaimExpired refusal');
  } catch (err: any) {
    if (err?.revert?.name !== 'ClaimExpired') throw err;
    log(`late settle refused before sending: ${err.revert.name} ✔`);
  }
  const exp = await escrow.expire(other, bountyId, { walletName: 'AGENT_2' });
  txs.push(exp);
  show(log, exp);
  const b = await escrow.bounty(bountyId);
  const balAfter = await escrow.robotBalance(robot);
  if (b.status !== 'Expired') throw new Error(`bounty #${bountyId} status ${b.status}, expected Expired`);
  if (balAfter !== balBefore) throw new Error(`robot balance ${balAfter} != before ${balBefore} (escrow not refunded)`);
  log(`expired ✔ escrow refunded, robot G1 balance back to ${fmt0G(balAfter)}`);
  return { bountyId, txs };
}

export function smokeEscrow(opts: { noExit?: boolean } = {}) {
  return runSmoke(
    'smoke:escrow',
    async (log) => {
      const { escrow } = ctx();
      log(`PickleEscrow ${explorerAddress(escrow.address)}`);
      const happy = await liveHappyPath(log);
      const fail = await liveExpirePath(log);
      const all = [...happy.txs, ...fail.txs];
      const total = all.reduce((s, r) => s + r.costWei, 0n);
      return `happy #${happy.bountyId} settled, fail #${fail.bountyId} expired; ${all.length} tx, gas ${fmt0G(total)}`;
    },
    opts,
  );
}

if (isMain(import.meta.url)) await smokeEscrow();
