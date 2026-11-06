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
  const combos: [number, number][] = [
    [0.5, -0.85],
    [-0.5, -0.85],
    [0.5, -0.55],
    [-0.5, -0.55],
  ];
  for (const [wp, sp] of combos) {
    send({ waist_pitch: wp, left_shoulder_pitch: sp, left_elbow: 0.1, left_shoulder_roll: 0.3, waist_yaw: 0, left_wrist_pitch: 0 });
    await sleep(1800);
    const s = await state();
    const l = s.robot.wrists.l as number[];
    console.log(`wp=${wp} sp=${sp} -> wristL [${l.join(', ')}] radius=${Math.hypot(l[0], l[1]).toFixed(3)} (box ${s.robot.box?.join(', ')})`);
  }
  process.exit(0);
});
