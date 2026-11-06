// Interactive pose probe for the swat task: tries arm poses, prints wrist pos.
import WebSocket from 'ws';

const SIM = 'http://localhost:8787';
const ws = new WebSocket(`${SIM.replace(/^http/, 'ws')}/ws?token=${process.env.SIM_TELEOP_TOKEN || 'dev-token'}`);
let idx: Map<string, number> | null = null;
let nu = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await (await fetch(`${SIM}/api/state`)).json()) as any;

ws.on('message', (buf) => {
  const m = JSON.parse(buf.toString());
  if (m.t === 'init') { nu = m.actuators.length; idx = new Map(m.actuators.map((a: any, i: number) => [a.name, i])); }
});
const send = (vals: Record<string, number>) => {
  const t: (number | null)[] = new Array(nu).fill(null);
  for (const [k, v] of Object.entries(vals)) { const i = idx!.get(k); if (i != null) t[i] = v; }
  ws.send(JSON.stringify({ t: 'ctrl', targets: t }));
};

ws.on('open', async () => {
  while (!idx) await sleep(100);
  // The exact pose the bridge commands when the user's hands rest at their
  // calibration origin (all offsets zero).
  send({
    waist_pitch: 0,
    left_shoulder_pitch: -0.625, right_shoulder_pitch: -0.625,
    left_shoulder_roll: 0.333, right_shoulder_roll: -0.333,
    left_elbow: 1.389, right_elbow: 1.389,
  });
  await sleep(2000);
  const s = await state();
  const l = s.robot.wrists.l as number[];
  const r = s.robot.wrists.r as number[];
  console.log(`rest pose wrists: L [${l.join(', ')}]  R [${r.join(', ')}]`);
  console.log(`midpoint: [${((l[0] + r[0]) / 2).toFixed(3)}, ${((l[1] + r[1]) / 2).toFixed(3)}, ${((l[2] + r[2]) / 2).toFixed(3)}]`);
  process.exit(0);
});
