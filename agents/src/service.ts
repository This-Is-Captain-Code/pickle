// Pickle agents service: the long-running orchestrator for robot bounties.
//
// Physical (SenseCAP Watcher):
//   power lost ──MQTT──▶ 0G decision ──▶ bounty + QR on the robot's screen
//   scan ──claim.html──▶ relay room "claims" ──▶ verify human ──▶ CLAIMED
//   human plugs it in (VBUS↑) ──▶ 0G verdict ──▶ VERIFIED
//
// Teleop (MuJoCo G1 sim, no autonomy — the sim announces its standing job at boot):
//   sim stuck ──webhook──▶ 0G decision ──▶ bounty + QR in the sim viewer
//   claim ──▶ verify human ──▶ CLAIMED (arms are always live; the claim is what gets rewarded)
//   human sweeps the box off via Spectacles ──▶ box on floor ──webhook──▶ 0G verdict ──▶ VERIFIED
//
// Both paths escrow the demo payout on 0G Galileo (PickleEscrow: post → claim → settle),
// non-blocking: a chain failure is logged and the off-chain demo continues.
// Providers are env-switched (WORLD_MODE / ZEROG_MODE: mock | live).
import http from 'node:http';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ZeroGUnreachable, type Bounty, type VerifyOutcome } from '@pickle/shared';
import { buildProviders } from './providers.js';
import { Devices } from './devices.js';
import { ADDRESSES_PATH, DEMO_PAYOUT, Escrow, escrowDeployed, humanHash } from './escrow.js';
import { walletFromEnv } from './chain.js';
import type { Wallet } from 'ethers';

const env = (k: string, d = '') => process.env[k] ?? d;
const BROKER_URL = env('BROKER_URL');
const CLAIMS_WS_URL = env('CLAIMS_WS_URL', 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims');
const CLAIM_BASE_URL = env('CLAIM_BASE_URL', 'https://pickle-hand-relay.pickle-delhi.workers.dev');
const SIM_URL = env('SIM_URL', 'http://localhost:8787');
const SIM_TOKEN = env('SIM_TELEOP_TOKEN', 'dev-token');
const AGENTS_PORT = +env('AGENTS_PORT', '8090');
const PICKUP_TIMEOUT_MS = 3 * 60_000;

if (!BROKER_URL) { console.error('BROKER_URL is required (see agents/.env.example)'); process.exit(1); }

// Console + agents/logs/service.log (the file is the demo's post-mortem record; stdout capture can be lossy).
const SERVICE_LOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'service.log');
mkdirSync(dirname(SERVICE_LOG), { recursive: true });
const log = (tag: string, msg: string) => {
  const line = `[${tag}] ${msg}`;
  console.log(line);
  try { appendFileSync(SERVICE_LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
};
const providers = buildProviders();
const devices = new Devices(BROKER_URL, env('BROKER_USER', 'bridge'), env('BROKER_PASS'));

type Phase = 'open' | 'verifying' | 'awaiting_power' | 'in_progress' | 'verified';
interface ActiveBounty {
  bounty: Bounty;
  phase: Phase;
  claimId?: string;
  claimedAt?: number;
  timer?: NodeJS.Timeout;
  /** On-chain state: ops run sequentially in this queue, never blocking the UX. */
  chainQ?: Promise<void>;
  onchainId?: bigint;
}

// ── PickleEscrow (0G Galileo): the payout happens on-chain, non-blocking ──
// ESCROW_DEMO=0 disables. Each device maps to an on-chain robot + its agent wallet.
const CHAIN_ON = process.env.ESCROW_DEMO !== '0' && escrowDeployed();
const escrow = CHAIN_ON ? new Escrow() : null;
const EXPLORER = 'https://chainscan-galileo.0g.ai';
// Claim window mirrors the service's pickup timeout so on-chain expiry stays in sync.
const CLAIM_WINDOW_S = 170; // slightly under PICKUP_TIMEOUT so the on-chain deadline passes first
const PAYOUT_ADDRESS = process.env.PAYOUT_ADDRESS || process.env.DEPLOYER_ADDRESS || '';
const robotChain = new Map<string, { robotId: string; wallet: Wallet }>();
if (CHAIN_ON) {
  const robots = JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')).galileo.robots;
  // device name -> on-chain robot. The G1 sim is robot G1; the Watcher is R2.
  const map: Record<string, string> = { 'g1-sim-01': 'G1', 'watcher-01': 'R2' };
  for (const [dev, name] of Object.entries(map)) {
    if (robots[name]) robotChain.set(dev, { robotId: robots[name].id, wallet: walletFromEnv(`${robots[name].agentWallet}_PRIVATE_KEY`) });
  }
}

/** Queue an on-chain op for this bounty: strictly ordered, failures logged, UX never waits. */
function chainOp(pb: ActiveBounty, label: string, fn: () => Promise<string | void>) {
  if (!CHAIN_ON) return;
  pb.chainQ = (pb.chainQ ?? Promise.resolve())
    .then(fn)
    .then((hash) => log('chain', `${label} ✓${hash ? ` ${EXPLORER}/tx/${hash}` : ''}`))
    .catch((e: any) => log('chain', `${label} FAILED (demo continues off-chain): ${e.shortMessage ?? e.message}`));
}

/** 0G Storage roots are bytes32; mock roots aren't — pass live roots through, hash anything else. */
function asBytes32(root: string): string {
  return /^0x[0-9a-fA-F]{64}$/.test(root) ? root : humanHash(root);
}
const byDevice = new Map<string, ActiveBounty>(); // one active bounty per robot
const deciding = new Set<string>(); // robots whose (slow, live) 0G decision is in flight — no second bounty meanwhile
const lastRssi = new Map<string, number>();

async function simPost(path: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${SIM_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: SIM_TOKEN, ...body }),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.json().catch(() => ({})) as any).error ?? ''}`);
  return res.json();
}

// ---------- claims room (the claim page talks to us through the relay) ----------
// The relay DO can drop idle sockets, and a send into a dying socket vanishes
// silently — so acks are queued, re-sent on reconnect, and a ping keeps the
// room warm. Duplicate acks are fine: the page keys on (claimId, status).
let claimsWs: WebSocket | null = null;
const recentAcks: { at: number; msg: string }[] = [];
function connectClaims() {
  claimsWs = new WebSocket(CLAIMS_WS_URL);
  claimsWs.on('open', () => {
    log('claims', `listening on ${CLAIMS_WS_URL}`);
    for (const a of recentAcks.filter((a) => Date.now() - a.at < 60_000)) claimsWs!.send(a.msg);
  });
  claimsWs.on('close', () => setTimeout(connectClaims, 2000));
  claimsWs.on('error', (e) => log('claims', `error: ${e.message}`));
  claimsWs.on('message', (buf) => {
    let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.type === 'claim' && m.bountyId) onClaim(m).catch((e) => log('claims', `claim failed: ${e.message}`));
  });
}
setInterval(() => { try { claimsWs?.readyState === WebSocket.OPEN && claimsWs.send('{"type":"ping"}'); } catch { /* reconnect handles it */ } }, 25_000);

// Room "bounty" backs the speakable /go short link on the worker: push the
// open bounty's claim URL so GET /go redirects to it (one-shot socket).
function publishGo(url: string) {
  try {
    const ws = new WebSocket(CLAIMS_WS_URL.replace(/\/claims$/, '/bounty'));
    ws.on('open', () => { ws.send(JSON.stringify({ url, at: Date.now() })); setTimeout(() => ws.close(), 500); });
    ws.on('error', (e) => log('claims', `go-link publish failed: ${e.message}`));
  } catch (e: any) { log('claims', `go-link publish failed: ${e.message}`); }
}
function ack(claimId: string, status: string, extra: Record<string, unknown> = {}) {
  const msg = JSON.stringify({ type: 'claim_ack', claimId, status, ...extra });
  recentAcks.push({ at: Date.now(), msg });
  while (recentAcks.length > 30) recentAcks.shift();
  if (claimsWs?.readyState === WebSocket.OPEN) claimsWs.send(msg);
}

// ---------- device events ----------
devices.on('connect', () => log('mqtt', `connected ${BROKER_URL.replace(/:[^:@/]+@/, ':***@')}`));
devices.on('status', (dev, online) => log('mqtt', `${dev} is ${online ? 'online' : 'OFFLINE (death beat)'}`));
devices.on('evt', (evt) => {
  const pb = byDevice.get(evt.dev);
  if (evt.kind === 'heartbeat' && typeof evt.data.rssi === 'number') lastRssi.set(evt.dev, evt.data.rssi);
  if (evt.kind === 'crash') log('robot', `${evt.dev} crash event (ignored — power loss is the trigger now)`);
  if (evt.kind === 'power') {
    if (!pb && !deciding.has(evt.dev) && evt.data.on === false) {
      deciding.add(evt.dev);
      onPowerLoss(evt.dev, evt.data).catch((e) => log('agent', `power-loss handling failed: ${e.message}`)).finally(() => deciding.delete(evt.dev));
    }
    if (pb && evt.data.on === true) onPowerRestored(pb, evt.dev).catch((e) => log('agent', `power-restore handling failed: ${e.message}`));
  }
});

// ---------- 1. power lost -> decision -> bounty + QR (the dying poster) ----------
async function onPowerLoss(dev: string, data: Record<string, unknown>) {
  log('robot', `${dev} lost power${data.initial ? ' (woke up unplugged)' : ''} — running on battery`);
  const situation = {
    stuckReason: 'power_lost',
    onBattery: true,
    battery: 'draining, hours remain',
    selfRecovery: 'impossible — this robot cannot move itself or reach power',
    owner: 'unreachable (away from site)',
    bountyMarket: 'available — verified humans nearby can be hired in seconds for small physical tasks',
    initial: data.initial === true,
    rssi: lastRssi.get(dev) ?? null,
    device: dev,
  };

  let decision;
  try {
    decision = await providers.engine.decide({
      robotId: dev,
      situation,
      question: 'Robot lost external power and is draining its battery. Choose the response that restores operation fastest.',
      options: ['post_physical_bounty', 'wait_and_retry', 'alert_owner'],
    });
  } catch (err) {
    if (err instanceof ZeroGUnreachable) {
      log('safe-stop', `0G unreachable — ${dev} stays halted, owner queued (${err.message})`);
      devices.cmd(dev, { cmd: 'state', state: 'BLOCKED' });
      return;
    }
    throw err;
  }
  const receipt = await providers.episodes.append({ ts: Date.now(), robotId: dev, decision, situation });
  log('0g', `decision=${decision.choice} requestId=${decision.requestId} episode=${receipt.rootHash.slice(0, 14)}…`);
  if (decision.choice !== 'post_physical_bounty') { log('agent', `decision was ${decision.choice}, no bounty`); return; }

  const bounty: Bounty = {
    id: `b${Date.now().toString(36)}`,
    kind: 'physical', robotId: dev,
    title: 'Plug me back in', reason: 'power_lost',
    payoutWei: '0', // settlement out of scope — the bounty ends at verified
    state: 'open',
    createdAt: Date.now(), expiresAt: Date.now() + 10 * 60_000,
  };
  const pb: ActiveBounty = { bounty, phase: 'open' };
  byDevice.set(dev, pb);
  pb.timer = setTimeout(() => expire(dev), 10 * 60_000);

  const url = `${CLAIM_BASE_URL}/claim.html?b=${bounty.id}&d=${dev}`;
  publishGo(url); // keep the speakable /go short link pointing at the open bounty
  devices.cmd(dev, { cmd: 'job', id: bounty.id, url });
  devices.cmd(dev, { cmd: 'say', text: 'SCAN TO SAVE ME' });
  devices.cmd(dev, { cmd: 'state', state: '*-*' }); // dying face, red poster
  log('bounty', `${bounty.id} posted on ${dev} — QR -> ${url}`);
  postOnChain(dev, pb);
}

// Escrow the demo payout from the robot's own wallet (non-blocking; off-chain demo continues on failure).
function postOnChain(dev: string, pb: ActiveBounty) {
  const rc = robotChain.get(dev);
  if (!rc) return;
  pb.bounty.payoutWei = DEMO_PAYOUT.toString();
  chainOp(pb, `postBounty(${dev})`, async () => {
    const r = await escrow!.postBounty(rc.wallet, rc.robotId, DEMO_PAYOUT, CLAIM_WINDOW_S);
    pb.onchainId = escrow!.bountyIdFrom(r);
    log('chain', `on-chain bounty #${pb.onchainId} — 0.001 0G escrowed from ${dev}'s balance`);
    return r.hash;
  });
}

// ---------- 2. claim (QR scanned) -> human verification -> CLAIMED ----------
async function onClaim(m: { claimId: string; bountyId: string; device?: string }) {
  const entry = [...byDevice.entries()].find(([, p]) => p.bounty.id === m.bountyId);
  if (!entry || entry[1].phase !== 'open') return ack(m.claimId, 'rejected', { reason: 'Bounty is not open (already claimed or expired).' });
  const [dev, pb] = entry;
  pb.phase = 'verifying'; pb.claimId = m.claimId;
  ack(m.claimId, 'verifying');
  log('world', `claim ${m.claimId} on ${pb.bounty.id} — verifying human…`);

  let outcome: VerifyOutcome;
  try {
    const session = await providers.verifier.createClaimSession(pb.bounty.id);
    // Live World ID: the human must open this in World App (QR on desktop,
    // tap-through on the phone). The claim page renders it.
    ack(m.claimId, 'verifying', { connectorURI: session.connectorURI });
    outcome = await providers.verifier.awaitOutcome(session.requestId);
  } catch (e: any) { outcome = { ok: false, code: 'error', detail: e.message }; }

  // The bounty may have been withdrawn or expired while the human was in World App.
  if (byDevice.get(dev) !== pb) {
    log('world', `claim ${m.claimId} finished after ${pb.bounty.id} was withdrawn — ignored`);
    return ack(m.claimId, 'rejected', { reason: 'This bounty was withdrawn while you were verifying (the robot recovered).' });
  }
  if (!outcome.ok) {
    pb.phase = 'open'; pb.claimId = undefined;
    ack(m.claimId, 'rejected', { reason: `Verification failed: ${outcome.code}` });
    log('world', `claim rejected (${outcome.code}) — bounty stays open`);
    return;
  }
  pb.bounty.state = 'claimed'; pb.bounty.nullifier = outcome.nullifier;
  pb.claimedAt = Date.now();
  pb.timer && clearTimeout(pb.timer);
  const rcc = robotChain.get(dev);
  if (rcc && PAYOUT_ADDRESS) {
    const hHash = humanHash(outcome.nullifier);
    chainOp(pb, `claim(${dev})`, async () => {
      if (pb.onchainId == null) throw new Error('no on-chain bounty id (postBounty failed?)');
      return (await escrow!.claim(rcc.wallet, pb.onchainId, PAYOUT_ADDRESS, hHash)).hash;
    });
  }

  if (pb.bounty.kind === 'teleop') {
    pb.phase = 'in_progress';
    pb.timer = setTimeout(() => expire(dev), 10 * 60_000);
    // Always-teleop sims are already unlocked (409 "not stuck"); only log real failures.
    try { await simPost('/api/teleop/begin'); } catch (e: any) { if (!/not stuck/.test(e.message)) log('sim', `teleop begin failed: ${e.message}`); }
    await setSimBounty({ id: pb.bounty.id, title: pb.bounty.title, state: 'claimed' });
    ack(m.claimId, 'claimed', { instruction: 'You are in control of the arms. Sweep the box off the table — the job completes the moment it hits the floor.' });
    log('world', `claimed by unique human ${outcome.nullifier.slice(0, 12)}… — teleop session unlocked`);
  } else {
    pb.phase = 'awaiting_power';
    pb.timer = setTimeout(() => expire(dev), PICKUP_TIMEOUT_MS);
    ack(m.claimId, 'claimed', { instruction: 'Plug the robot into power.' });
    devices.cmd(dev, { cmd: 'job', id: pb.bounty.id }); // no url -> QR comes down
    devices.cmd(dev, { cmd: 'state', state: 'CLAIMED' });
    devices.cmd(dev, { cmd: 'say', text: 'plug me in!' });
    log('world', `claimed by unique human ${outcome.nullifier.slice(0, 12)}… — waiting for power (VBUS up)`);
  }
}

// ---------- 3. physical proof: power comes back ----------
async function onPowerRestored(pb: ActiveBounty, dev: string) {
  if (pb.phase === 'open' || pb.phase === 'verifying') {
    // Someone plugged it in without claiming — robot is fine, bounty is moot.
    log('bounty', `${pb.bounty.id} withdrawn: power restored before any claim`);
    if (pb.claimId) ack(pb.claimId, 'rejected', { reason: 'Power was restored before the claim completed.' });
    pb.timer && clearTimeout(pb.timer);
    if (robotChain.get(dev)) chainOp(pb, `cancel(${dev})`, async () => {
      if (pb.onchainId == null) return;
      return (await escrow!.cancel(robotChain.get(dev)!.wallet, pb.onchainId)).hash;
    });
    devices.cmd(dev, { cmd: 'job' });
    devices.cmd(dev, { cmd: 'say', text: '' });
    devices.cmd(dev, { cmd: 'state', state: 'IDLE' });
    byDevice.delete(dev);
    return;
  }
  if (pb.phase === 'awaiting_power') {
    const rescueS = pb.claimedAt ? (Date.now() - pb.claimedAt) / 1000 : null;
    log('proof', `${dev} is charging again (${rescueS?.toFixed(0)}s after claim)`);
    const situation = { proof: 'vbus_restored', seconds_since_claim: rescueS, charging: true, rssi: lastRssi.get(dev) ?? null, device: dev };
    const verdict = await providers.engine.decide({
      robotId: dev, situation,
      question: 'Telemetry after human intervention: external power restored, battery charging. Is the robot rescued?',
      options: ['fix_confirmed', 'still_stuck'],
    });
    const epi = await providers.episodes.append({ ts: Date.now(), robotId: dev, bountyId: pb.bounty.id, decision: verdict, situation });
    log('0g', `verification=${verdict.choice} requestId=${verdict.requestId}`);
    if (verdict.choice !== 'fix_confirmed') { devices.cmd(dev, { cmd: 'say', text: 'not verified yet…' }); return; }

    pb.phase = 'verified'; pb.bounty.state = 'verified';
    pb.timer && clearTimeout(pb.timer);
    devices.cmd(dev, { cmd: 'state', state: 'VERIFIED' });
    devices.cmd(dev, { cmd: 'say', text: 'fix verified. thank you!' });
    if (pb.claimId) ack(pb.claimId, 'verified');
    log('bounty', `${pb.bounty.id} VERIFIED — bounty complete 🥒`);
    const rcs = robotChain.get(dev);
    if (rcs) {
      chainOp(pb, `settle(${dev})`, async () => {
        if (pb.onchainId == null) throw new Error('no on-chain bounty id');
        const r = await escrow!.settle(rcs.wallet, pb.onchainId, verdict.requestId, asBytes32(epi.rootHash));
        log('chain', `0.001 0G paid to ${PAYOUT_ADDRESS.slice(0, 10)}… — settle cites compute ${verdict.requestId.slice(0, 8)}… + storage root on-chain`);
        return r.hash;
      });
    }
    setTimeout(() => { devices.cmd(dev, { cmd: 'job' }); devices.cmd(dev, { cmd: 'state', state: 'IDLE' }); byDevice.delete(dev); }, 10_000);
  }
}

function expire(dev: string) {
  const pb = byDevice.get(dev);
  if (!pb || pb.phase === 'verified') return;
  log('bounty', `${pb.bounty.id} expired in phase ${pb.phase}`);
  if (pb.claimId) ack(pb.claimId, 'rejected', { reason: 'Bounty expired.' });
  const rce = robotChain.get(dev);
  if (rce) {
    const claimed = pb.phase === 'awaiting_power' || pb.phase === 'in_progress';
    chainOp(pb, `${claimed ? 'expire' : 'cancel'}(${dev})`, async () => {
      if (pb.onchainId == null) return;
      const r = claimed ? await escrow!.expire(rce.wallet, pb.onchainId) : await escrow!.cancel(rce.wallet, pb.onchainId);
      return r.hash;
    });
  }
  if (pb.bounty.kind === 'teleop') {
    simPost('/api/teleop/release').catch(() => {});
    void setSimBounty(null);
  } else {
    devices.cmd(dev, { cmd: 'job' });
    devices.cmd(dev, { cmd: 'state', state: 'IDLE' });
  }
  byDevice.delete(dev);
}

// ---------- sim robot (teleop bounties) ----------
async function setSimBounty(b: Record<string, unknown> | null) {
  try { await simPost('/api/bounty', { bounty: b }); } catch (e: any) { log('sim', `bounty overlay update failed: ${e.message}`); }
}

// Sim reported stuck -> same pipeline as the Watcher, but the fix is a teleop session.
type SimStuckEvent = { robotId: string; reason: string; title?: string; detail?: string; telemetry?: Record<string, unknown>; resumeCondition?: string };
async function onSimStuck(evt: SimStuckEvent) {
  const dev = evt.robotId || 'g1-sim-01';
  // The sim re-announces its job until acknowledged; one bounty per robot at a
  // time, including while the (slow, live) 0G decision is still in flight.
  if (byDevice.has(dev) || deciding.has(dev)) return;
  deciding.add(dev);
  try { await decideSimStuck(dev, evt); } finally { deciding.delete(dev); }
}
async function decideSimStuck(dev: string, evt: SimStuckEvent) {
  log('robot', `${dev} stuck: ${evt.title ?? evt.reason}`);
  const situation = {
    stuckReason: evt.reason, detail: evt.detail, resumeCondition: evt.resumeCondition,
    selfRecovery: 'impossible — this robot has no autonomous policy for this task; its arms only move under human teleoperation',
    owner: 'unreachable (away from site)',
    bountyMarket: 'available — verified humans can take remote control of the arms within seconds',
    ...(evt.telemetry ?? {}),
  };

  let decision;
  try {
    decision = await providers.engine.decide({
      robotId: dev, situation,
      question: 'Robot is stuck mid-task and needs human dexterity. Choose the response that restores operation fastest.',
      options: ['post_teleop_bounty', 'wait_and_retry', 'alert_owner'],
    });
  } catch (err) {
    if (err instanceof ZeroGUnreachable) { log('safe-stop', `0G unreachable — ${dev} stays halted, owner queued`); return; }
    throw err;
  }
  const receipt = await providers.episodes.append({ ts: Date.now(), robotId: dev, decision, situation });
  log('0g', `decision=${decision.choice} requestId=${decision.requestId} episode=${receipt.rootHash.slice(0, 14)}…`);
  if (decision.choice !== 'post_teleop_bounty') { log('agent', `decision was ${decision.choice}, no bounty`); return; }

  const bounty: Bounty = {
    id: `b${Date.now().toString(36)}`,
    kind: 'teleop', robotId: dev,
    title: evt.title ?? 'Take control and free me', reason: evt.reason,
    payoutWei: '0', state: 'open',
    createdAt: Date.now(), expiresAt: Date.now() + 10 * 60_000,
  };
  const pb: ActiveBounty = { bounty, phase: 'open' };
  byDevice.set(dev, pb);
  pb.timer = setTimeout(() => expire(dev), 10 * 60_000);

  const url = `${CLAIM_BASE_URL}/claim.html?b=${bounty.id}&d=${dev}`;
  publishGo(url);
  await setSimBounty({ id: bounty.id, title: bounty.title, url, state: 'open' });
  log('bounty', `${bounty.id} posted on ${dev} (teleop) — QR -> ${url}`);
  postOnChain(dev, pb);
}

// Sim's own resume check passed and the robot went back to work -> verify.
async function onTeleopDone(evt: { robotId: string; telemetry?: Record<string, unknown> }) {
  const dev = evt.robotId || 'g1-sim-01';
  const pb = byDevice.get(dev);
  if (!pb || pb.phase !== 'in_progress') { log('agent', `teleop_done for ${dev} ignored (no in-progress bounty)`); return; }
  const situation = { proof: 'sim_resume_check', ...(evt.telemetry ?? {}) };
  const verdict = await providers.engine.decide({
    robotId: dev, situation,
    question: 'Human teleop session ended and the robot passed its own resume check. Is the fix complete?',
    options: ['fix_confirmed', 'still_stuck'],
  });
  const epi = await providers.episodes.append({ ts: Date.now(), robotId: dev, bountyId: pb.bounty.id, decision: verdict, situation });
  log('0g', `verification=${verdict.choice} requestId=${verdict.requestId}`);
  if (verdict.choice !== 'fix_confirmed') return;

  pb.phase = 'verified'; pb.bounty.state = 'verified';
  pb.timer && clearTimeout(pb.timer);
  if (pb.claimId) ack(pb.claimId, 'verified');
  await setSimBounty({ id: pb.bounty.id, title: pb.bounty.title, state: 'verified' });
  log('bounty', `${pb.bounty.id} VERIFIED — teleop bounty complete 🥒`);
  const rct = robotChain.get(dev);
  if (rct) chainOp(pb, `settle(${dev})`, async () => {
    if (pb.onchainId == null) throw new Error('no on-chain bounty id');
    return (await escrow!.settle(rct.wallet, pb.onchainId, verdict.requestId, asBytes32(epi.rootHash))).hash;
  });
  setTimeout(() => { void setSimBounty(null); byDevice.delete(dev); }, 10_000);
}

// Webhook listener: the sim POSTs stuck + teleop_done events here.
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/events/sim') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      let evt: any; try { evt = JSON.parse(body); } catch { return; }
      if (evt.type === 'stuck') onSimStuck(evt).catch((e) => log('agent', `sim stuck handling failed: ${e.message}`));
      if (evt.type === 'teleop_done') onTeleopDone(evt).catch((e) => log('agent', `teleop_done handling failed: ${e.message}`));
    });
  } else { res.writeHead(404).end(); }
}).listen(AGENTS_PORT, () => log('http', `sim webhook on http://localhost:${AGENTS_PORT}/events/sim`));

connectClaims();
// A bounty overlay left by a previous service instance is dead to us — clear it so the sim re-announces.
setSimBounty(null).catch(() => {});
log('service', `pickle agents service up — claim base ${CLAIM_BASE_URL}, sim at ${SIM_URL}, escrow ${CHAIN_ON ? `LIVE on Galileo (${escrow!.address.slice(0, 10)}…, payouts to ${PAYOUT_ADDRESS.slice(0, 10)}…)` : 'off'}`);
