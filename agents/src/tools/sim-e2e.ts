// Desk E2E for the teleop bounty (always-teleop sim, no autonomy): the sim
// announces its standing job at boot -> agent posts a bounty -> we claim via
// the relay (as the claim page would) -> scripted sweep knocks the box off ->
// sim reports completion -> agent verdict -> VERIFIED (and settle if escrow).
// Assumes: sim running with AGENTS_WEBHOOK_URL set, agents service running.
//   npx tsx --env-file=.env src/tools/sim-e2e.ts
import WebSocket from 'ws';

const env = (k: string, d = '') => process.env[k] ?? d;
const SIM_URL = env('SIM_URL', 'http://localhost:8787');
const TOKEN = env('SIM_TELEOP_TOKEN', 'dev-token');
const CLAIMS_WS_URL = env('CLAIMS_WS_URL', 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims');

const log = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await (await fetch(`${SIM_URL}/api/state`)).json()) as any;

async function waitFor(what: string, pred: () => Promise<boolean>, timeoutS = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) { try { if (await pred()) return; } catch { /* sim still booting */ } await sleep(700); }
  throw new Error(`timed out waiting for ${what}`);
}

async function sweep() {
  const ws = new WebSocket(`${SIM_URL.replace(/^http/, 'ws')}/ws?token=${TOKEN}`);
  let idx: Map<string, number> | null = null, nu = 0;
  ws.on('message', (buf) => { const m = JSON.parse(buf.toString()); if (m.t === 'init') { nu = m.actuators.length; idx = new Map(m.actuators.map((a: any, i: number) => [a.name, i])); } });
  await new Promise((r) => ws.on('open', r));
  while (!idx) await sleep(100);
  const send = (vals: Record<string, number>) => { const t = new Array(nu).fill(null); for (const [k, v] of Object.entries(vals)) { const i = idx!.get(k); if (i != null) t[i] = v; } ws.send(JSON.stringify({ t: 'ctrl', targets: t })); };
  send({ waist_pitch: 0.4, left_shoulder_pitch: -0.7, left_elbow: 0.3, left_shoulder_roll: 0.5, right_shoulder_pitch: -0.7, right_elbow: 0.3, right_shoulder_roll: -0.5, waist_yaw: -0.9 });
  await sleep(1800);
  for (let y = -0.9; y <= 0.9; y += 0.08) { send({ waist_yaw: +y.toFixed(2) as unknown as number }); await sleep(45); }
  await sleep(800);
  for (let y = 0.9; y >= -0.9; y -= 0.08) { send({ waist_yaw: +y.toFixed(2) as unknown as number }); await sleep(45); }
  // Hands back to rest, like a human lowering their arms — otherwise the restaged box lands on an outstretched arm.
  await sleep(500);
  send({ waist_yaw: 0, waist_pitch: 0, left_shoulder_pitch: -0.85, left_shoulder_roll: 0.28, left_elbow: 1.3, right_shoulder_pitch: -0.85, right_shoulder_roll: -0.28, right_elbow: 1.3 });
  await sleep(300);
  ws.close();
}

async function main() {
  log('e2e', '1. waiting for the agent to post the standing bounty (sim announces it at boot)');
  await waitFor('bounty in sim overlay', async () => (await state()).bounty?.state === 'open', 150); // live 0G decision can take a minute+
  const bounty = (await state()).bounty;
  log('e2e', `2. bounty ${bounty.id} on the viewer — claiming via relay (as the claim page would)`);

  const claimId = 'c-e2e-' + Date.now().toString(36);
  const ws = new WebSocket(CLAIMS_WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'claim', claimId, bountyId: bounty.id, device: 'g1-sim-01', ts: Date.now() })));
    ws.on('error', reject);
    ws.on('message', async (buf) => {
      let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type !== 'claim_ack' || m.claimId !== claimId) return;
      log('page', `claim page shows: ${m.status}${m.reason ? ` (${m.reason})` : ''}`);
      if (m.status === 'claimed') { log('e2e', '3. claimed — sweeping the box off the table'); await sweep(); }
      if (m.status === 'verified') { log('e2e', '4. VERIFIED 🥒 — teleop bounty loop complete (settle runs on-chain if escrow is on)'); resolve(); }
      if (m.status === 'rejected') reject(new Error(m.reason));
    });
    setTimeout(() => reject(new Error('timed out waiting for verified')), 180_000); // live 0G decision + storage upload can take a minute+
  });
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('[e2e] FAILED:', e.message); process.exit(1); });
