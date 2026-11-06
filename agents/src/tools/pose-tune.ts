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
  // Candidate "ready" rest poses: hands hovering over the table near the box
  // (box at 0.34, 0, 0.87; table top 0.81).
  const combos: [number, number, number][] = [
    [-0.75, 1.2, 0.28],
    [-0.85, 1.3, 0.28],
    [-0.7, 1.05, 0.25],
  ];
  for (const [sp, el, sr] of combos) {
    send({
      waist_pitch: 0,
      left_shoulder_pitch: sp, right_shoulder_pitch: sp,
      left_shoulder_roll: sr, right_shoulder_roll: -sr,
      left_elbow: el, right_elbow: el,
    });
    await sleep(1800);
    const s = await state();
    const l = s.robot.wrists.l as number[];
    const r = s.robot.wrists.r as number[];
    console.log(`sp=${sp} el=${el} sr=${sr} -> wristL [${l.join(', ')}] wristR [${r.join(', ')}]`);
  }
  process.exit(0);
});
