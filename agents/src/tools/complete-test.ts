// Shove the box off the table with a scripted sweep; verify BOUNTY COMPLETE
// fires and the box auto-restages. npx tsx src/tools/complete-test.ts
import WebSocket from 'ws';

const SIM = 'http://localhost:8787';
const ws = new WebSocket(`${SIM.replace(/^http/, 'ws')}/ws?token=${process.env.SIM_TELEOP_TOKEN || 'dev-token'}`);
let idx: Map<string, number> | null = null, nu = 0, complete = false, reset = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[test] ${m}`);

ws.on('message', (buf) => {
  const m = JSON.parse(buf.toString());
  if (m.t === 'init') { nu = m.actuators.length; idx = new Map(m.actuators.map((a: any, i: number) => [a.name, i])); }
  if (m.t === 'bounty_complete') { complete = true; log('BOUNTY COMPLETE received ✓'); }
  if (m.t === 'bounty_reset') { reset = true; log('bounty reset (box restaged) ✓'); }
});
const send = (vals: Record<string, number>) => {
  const t: (number | null)[] = new Array(nu).fill(null);
  for (const [k, v] of Object.entries(vals)) { const i = idx!.get(k); if (i != null) t[i] = v; }
  ws.send(JSON.stringify({ t: 'ctrl', targets: t }));
};

ws.on('open', async () => {
  while (!idx) await sleep(100);
  log('arms forward at box height, then waist sweep');
  send({ waist_pitch: 0.4, left_shoulder_pitch: -0.7, left_elbow: 0.3, left_shoulder_roll: 0.5, right_shoulder_pitch: -0.7, right_elbow: 0.3, right_shoulder_roll: -0.5, waist_yaw: -0.9 });
  await sleep(1800);
  for (let y = -0.9; y <= 0.9; y += 0.08) { send({ waist_yaw: +y.toFixed(2) as unknown as number }); await sleep(45); }
  await sleep(800);
  for (let y = 0.9; y >= -0.9; y -= 0.08) { send({ waist_yaw: +y.toFixed(2) as unknown as number }); await sleep(45); }
  const t0 = Date.now();
  while (!complete && Date.now() - t0 < 10_000) await sleep(300);
  if (!complete) { const s = (await (await fetch(`${SIM}/api/state`)).json()) as any; log(`FAIL: no completion. box at [${s.robot.box.join(', ')}]`); process.exit(1); }
  const t1 = Date.now();
  while (!reset && Date.now() - t1 < 9_000) await sleep(300);
  log(reset ? 'PASS: complete + auto-restage loop works 🥒' : 'completion fired but no restage');
  process.exit(reset ? 0 : 1);
});
