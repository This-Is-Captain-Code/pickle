// Rehearsal for the "knock the bad box off" teleop task: scripted arm sweep
// instead of Spectacles. Verifies the physics hit + swat-to-discard logic.
//   npx tsx src/tools/swat-test.ts   (sim must be running)
import WebSocket from 'ws';

const SIM_URL = process.env.SIM_URL || 'http://localhost:8787';
const TOKEN = process.env.SIM_TELEOP_TOKEN || 'dev-token';
const log = (m: string) => console.log(`[swat] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (path: string, body: Record<string, unknown> = {}) =>
  fetch(`${SIM_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, ...body }) });
const state = async () => (await (await fetch(`${SIM_URL}/api/state`)).json()) as any;

async function waitFor(what: string, pred: (s: any) => boolean, timeoutS = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) { const s = await state(); if (pred(s)) return s; await sleep(500); }
  throw new Error(`timeout: ${what}`);
}

async function main() {
  await post('/api/scenario/reset');
  await sleep(1000);
  log('knocking the box off the mark');
  await post('/api/scenario/knock');
  await waitFor('stuck lowconf', (s) => s.robot.mode === 'stuck' && s.robot.stuckReason === 'lowconf');
  log('robot stuck (lowconf) — beginning teleop');
  await post('/api/teleop/begin');

  const ws = new WebSocket(`${SIM_URL.replace(/^http/, 'ws')}/ws?token=${TOKEN}`);
  let idx: Map<string, number> | null = null;
  let nu = 0;
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.t === 'init') { nu = m.actuators.length; idx = new Map(m.actuators.map((a: any, i: number) => [a.name, i])); }
  });
  await new Promise((r) => ws.on('open', r));
  while (!idx) await sleep(100);

  const send = (vals: Record<string, number>) => {
    const t = new Array(nu).fill(null);
    for (const [k, v] of Object.entries(vals)) { const i = idx!.get(k); if (i != null) t[i] = v; }
    ws.send(JSON.stringify({ t: 'ctrl', targets: t }));
  };

  // Mimic what a human does through the bridge: lean in (deep reach) and
  // sweep the left arm across the feeder (box lands on the robot's left).
  log('leaning in, arm forward at box height');
  send({ waist_pitch: 0.5, left_shoulder_pitch: -0.55, left_elbow: 0.1, left_shoulder_roll: 1.3, left_wrist_pitch: 0 });
  await sleep(1800);
  log('sweeping the left arm across the feeder (3 passes, same direction)');
  for (let pass = 0; pass < 3; pass++) {
    send({ left_shoulder_pitch: -1.1, left_shoulder_roll: 1.3 }); // lift over, wind up
    await sleep(900);
    send({ left_shoulder_pitch: -0.55, left_shoulder_roll: 1.3 }); // drop to box height
    await sleep(700);
    for (let r = 1.3; r >= -0.5; r -= 0.1) { send({ left_shoulder_roll: +r.toFixed(2) as unknown as number }); await sleep(45); }
    await sleep(600);
    const s = await state();
    log(`pass ${pass + 1}: box [${s.robot.box?.join(', ')}]`);
    if (s.robot.actionsDone?.includes('skip_part')) break;
  }
  await sleep(1000);
  const after = await state();
  log(`box now at [${after.robot.box?.join(', ')}], wristL [${after.robot.wrists?.l?.join(', ')}]`);

  const s = await waitFor('box discarded (skip_part)', (s) => s.robot.actionsDone?.includes('skip_part'), 10).catch(() => null);
  if (!s) { log('FAIL: box was not knocked off — physics miss'); process.exit(1); }
  log('box knocked off + auto-discarded ✓ — pressing work done');
  await sleep(1500);
  const end = await post('/api/teleop/end');
  log(end.ok ? 'work done accepted — robot resuming ✓ SWAT TASK PASSES' : `work done refused: ${JSON.stringify(await end.json())}`);
  process.exit(end.ok ? 0 : 1);
}
main().catch((e) => { console.error('[swat] FAILED:', e.message); process.exit(1); });
