// Pickle agents service: the long-running orchestrator for physical bounties.
//
//   Watcher crash ──MQTT──▶ 0G decision ──▶ bounty + QR on the robot's screen
//   Spectacles scans QR ──claim.html──▶ relay room "claims" ──▶ verify human ──▶ CLAIMED
//   human unplugs (VBUS↓ = picked up) … replugs (VBUS↑ = placed) ──▶ 0G verdict ──▶ PAID
//
// Providers are env-switched (mock today, World/0G live later) — same contract
// as the one-shot demo in index.ts. Escrow settle stays stubbed until contracts/.
import WebSocket from 'ws';
import { ZeroGUnreachable, type Bounty, type VerifyOutcome } from '@pickle/shared';
import { buildProviders } from './providers.js';
import { Devices } from './devices.js';

const env = (k: string, d = '') => process.env[k] ?? d;
const BROKER_URL = env('BROKER_URL');
const CLAIMS_WS_URL = env('CLAIMS_WS_URL', 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims');
const CLAIM_BASE_URL = env('CLAIM_BASE_URL', 'https://pickle-hand-relay.pickle-delhi.workers.dev');
const PICKUP_TIMEOUT_MS = 3 * 60_000;

if (!BROKER_URL) { console.error('BROKER_URL is required (see agents/.env.example)'); process.exit(1); }

const log = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);
const providers = buildProviders();
const devices = new Devices(BROKER_URL, env('BROKER_USER', 'bridge'), env('BROKER_PASS'));

type Phase = 'open' | 'verifying' | 'awaiting_pickup' | 'carrying' | 'verified';
interface PhysicalBounty {
  bounty: Bounty;
  phase: Phase;
  claimId?: string;
  pickedUpAt?: number;
  rssiBefore?: number;
  rssiAfter?: number;
  timer?: NodeJS.Timeout;
}
const byDevice = new Map<string, PhysicalBounty>(); // one active bounty per device
const lastRssi = new Map<string, number>();

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
  if (evt.kind === 'crash') onCrash(evt.dev, evt.data).catch((e) => log('agent', `crash handling failed: ${e.message}`));
  if (evt.kind === 'power' && pb) onPower(pb, evt.dev, evt.data.on === true).catch((e) => log('agent', `power handling failed: ${e.message}`));
});

// ---------- 1. stuck -> decision -> bounty + QR ----------
async function onCrash(dev: string, data: Record<string, unknown>) {
  if (byDevice.has(dev)) return; // one bounty per device at a time
  log('robot', `${dev} reports crash ${JSON.stringify(data)}`);
  const situation = { stuckReason: 'crash', sim: data.sim === true, rssi: lastRssi.get(dev) ?? null, device: dev };

  let decision;
  try {
    decision = await providers.engine.decide({
      robotId: dev,
      situation,
      question: 'Robot is down and cannot recover alone. Choose the response.',
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
    title: 'Move me to the working charging pad', reason: String(data.sim ? 'simulated crash' : 'crash'),
    payoutWei: '0', // settlement out of scope — the bounty ends at verified
    state: 'open',
    createdAt: Date.now(), expiresAt: Date.now() + 10 * 60_000,
  };
  const pb: PhysicalBounty = { bounty, phase: 'open', rssiBefore: lastRssi.get(dev) };
  byDevice.set(dev, pb);
  pb.timer = setTimeout(() => expire(dev), 10 * 60_000);

  const url = `${CLAIM_BASE_URL}/claim.html?b=${bounty.id}&d=${dev}`;
  publishGo(url); // keep the speakable /go short link pointing at the open bounty
  devices.cmd(dev, { cmd: 'simulate', kind: 'recover' }); // clear the red takeover; the poster is the state now
  devices.cmd(dev, { cmd: 'job', id: bounty.id, url });
  devices.cmd(dev, { cmd: 'state', state: 'JOB OPEN' });
  log('bounty', `${bounty.id} posted on ${dev} — QR -> ${url}`);
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
    outcome = await providers.verifier.awaitOutcome(session.requestId);
  } catch (e: any) { outcome = { ok: false, code: 'error', detail: e.message }; }

  if (!outcome.ok) {
    pb.phase = 'open'; pb.claimId = undefined;
    ack(m.claimId, 'rejected', { reason: `Verification failed: ${outcome.code}` });
    log('world', `claim rejected (${outcome.code}) — bounty stays open`);
    return;
  }
  pb.bounty.state = 'claimed'; pb.bounty.nullifier = outcome.nullifier;
  pb.phase = 'awaiting_pickup';
  pb.timer && clearTimeout(pb.timer);
  pb.timer = setTimeout(() => expire(dev), PICKUP_TIMEOUT_MS);
  ack(m.claimId, 'claimed', { instruction: 'Unplug the robot and move it to the working charging pad.' });
  devices.cmd(dev, { cmd: 'job', id: pb.bounty.id }); // no url -> QR comes down
  devices.cmd(dev, { cmd: 'state', state: 'CLAIMED' });
  devices.cmd(dev, { cmd: 'say', text: 'unplug me & move me!' });
  log('world', `claimed by unique human ${outcome.nullifier.slice(0, 12)}… — waiting for pickup (VBUS drop)`);
}

// ---------- 3. physical proof: VBUS down (picked up) then up (placed) ----------
async function onPower(pb: PhysicalBounty, dev: string, on: boolean) {
  if (pb.phase === 'awaiting_pickup' && !on) {
    pb.phase = 'carrying'; pb.pickedUpAt = Date.now();
    devices.cmd(dev, { cmd: 'say', text: 'carried! place me on the pad' });
    log('proof', `${dev} unplugged — human picked it up`);
    return;
  }
  if (pb.phase === 'carrying' && on) {
    pb.rssiAfter = lastRssi.get(dev);
    const carriedS = pb.pickedUpAt ? (Date.now() - pb.pickedUpAt) / 1000 : null;
    log('proof', `${dev} plugged in at the new spot (carried ${carriedS?.toFixed(0)}s)`);
    const situation = {
      proof: 'vbus_cycle', carried_s: carriedS,
      rssi_before: pb.rssiBefore ?? null, rssi_after: pb.rssiAfter ?? null,
      charging: true, device: dev,
    };
    const verdict = await providers.engine.decide({
      robotId: dev, situation,
      question: 'Telemetry after human intervention: power lost, device carried, power restored at a new location. Is the relocation complete?',
      options: ['fix_confirmed', 'still_stuck'],
    });
    await providers.episodes.append({ ts: Date.now(), robotId: dev, bountyId: pb.bounty.id, decision: verdict, situation });
    log('0g', `verification=${verdict.choice} requestId=${verdict.requestId}`);
    if (verdict.choice !== 'fix_confirmed') { devices.cmd(dev, { cmd: 'say', text: 'not verified yet…' }); return; }

    pb.phase = 'verified'; pb.bounty.state = 'verified';
    pb.timer && clearTimeout(pb.timer);
    devices.cmd(dev, { cmd: 'state', state: 'VERIFIED' });
    devices.cmd(dev, { cmd: 'say', text: 'fix verified. thank you!' });
    if (pb.claimId) ack(pb.claimId, 'verified');
    log('bounty', `${pb.bounty.id} VERIFIED — bounty complete 🥒`);
    setTimeout(() => { devices.cmd(dev, { cmd: 'job' }); devices.cmd(dev, { cmd: 'state', state: 'IDLE' }); byDevice.delete(dev); }, 10_000);
  }
}

function expire(dev: string) {
  const pb = byDevice.get(dev);
  if (!pb || pb.phase === 'verified') return;
  log('bounty', `${pb.bounty.id} expired in phase ${pb.phase}`);
  if (pb.claimId) ack(pb.claimId, 'rejected', { reason: 'Bounty expired.' });
  devices.cmd(dev, { cmd: 'job' });
  devices.cmd(dev, { cmd: 'state', state: 'IDLE' });
  byDevice.delete(dev);
}

connectClaims();
log('service', `pickle agents service up — claim base ${CLAIM_BASE_URL}`);
