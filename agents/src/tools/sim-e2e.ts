// Desk E2E for the teleop bounty: plays the human end to end with no
// Spectacles. Assumes the sim (with AGENTS_WEBHOOK_URL set) and the agents
// service are both running.
//
//   npx tsx --env-file=.env src/tools/sim-e2e.ts
import WebSocket from 'ws';

const env = (k: string, d = '') => process.env[k] ?? d;
const SIM_URL = env('SIM_URL', 'http://localhost:8787');
const TOKEN = env('SIM_TELEOP_TOKEN', 'dev-token');
const CLAIMS_WS_URL = env('CLAIMS_WS_URL', 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims');

const log = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = async (path: string, body: Record<string, unknown> = {}) => {
  const res = await fetch(`${SIM_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) as any };
};
const state = async () => (await (await fetch(`${SIM_URL}/api/state`)).json()) as any;

async function waitFor(what: string, pred: () => Promise<boolean>, timeoutS = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) { if (await pred()) return; await sleep(700); }
  throw new Error(`timed out waiting for ${what}`);
}

// NOTE: run the sim with SIM_SCENARIO=none for this test — the boot default
// auto-stages the knock-box demo, which would occupy the device's bounty slot.
async function main() {
  log('e2e', '1. dropping the rail on the robot');
  await post('/api/scenario/reset');
  await sleep(1000);
  await post('/api/scenario/obstacle');
  // The sim defers the rail drop until the arms are clear of the feeder, so
  // stuck can take most of a routine cycle to land.
  await waitFor('robot stuck', async () => (await state()).robot.mode === 'stuck', 90);
  log('e2e', '2. robot is stuck — waiting for the agent to post the bounty');
  await waitFor('bounty in sim overlay', async () => (await state()).bounty?.state === 'open', 20);
  const bounty = (await state()).bounty;
  log('e2e', `3. bounty ${bounty.id} on the viewer — claiming via relay (as the claim page would)`);

  const claimId = 'c-e2e-' + Date.now().toString(36);
  const ws = new WebSocket(CLAIMS_WS_URL);
  const verified = new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'claim', claimId, bountyId: bounty.id, device: 'g1-sim-01', ts: Date.now() })));
    ws.on('error', reject);
    ws.on('message', async (buf) => {
      let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type !== 'claim_ack' || m.claimId !== claimId) return;
      log('page', `claim page shows: ${m.status}${m.reason ? ` (${m.reason})` : ''}`);
      if (m.status === 'claimed') {
        log('e2e', '4. teleop unlocked — doing the fix via the stuck actions');
        await waitFor('teleop mode', async () => (await state()).robot.mode === 'teleop');
        await post('/api/action', { id: 'pick_crate' });
        await waitFor('rail picked', async () => (await state()).robot.holding, 20);
        await post('/api/action', { id: 'drop_on_belt' });
        await waitFor('rail cleared', async () => { const r = (await state()).robot; return !r.holding && !r.obstacleInPath; }, 30);
        await sleep(1500); // let the release macro finish
        log('e2e', '5. pressing ✅ work done');
        const end = await post('/api/teleop/end');
        if (!end.ok) { log('e2e', `work done refused: ${end.body.error}`); }
      }
      if (m.status === 'verified') { log('e2e', '6. VERIFIED 🥒 — teleop bounty loop complete'); resolve(); }
      if (m.status === 'rejected') reject(new Error(m.reason));
    });
  });
  await verified;
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('[e2e] FAILED:', e.message); process.exit(1); });
