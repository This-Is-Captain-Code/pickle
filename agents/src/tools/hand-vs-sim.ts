// Side-by-side live tap: right hand (raw + bridge-style offset) vs sim arm.
//   npx tsx src/tools/hand-vs-sim.ts
import WebSocket from 'ws';

const RELAY = 'wss://pickle-hand-relay.pickle-delhi.workers.dev/pickle';
const log = (m: string) => console.log(`${new Date().toISOString().slice(14, 22)} ${m}`);

// mirror the bridge's calibration (first 25 frames after hand appears)
let origin: number[] | null = null;
const calib: number[][] = [];
let wrist: number[] | null = null;
let lastSeen = 0;

const rws = new WebSocket(RELAY);
rws.on('message', (buf) => {
  let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
  const w = m.right?.joints?.[0]?.pos;
  if (!w) { if (Date.now() - lastSeen > 1200) { origin = null; calib.length = 0; } return; }
  lastSeen = Date.now();
  wrist = w;
  if (!origin) {
    calib.push(w);
    if (calib.length >= 25) {
      origin = [0, 1, 2].map((i) => calib.reduce((s, p) => s + p[i], 0) / calib.length);
      log(`CALIBRATED right-hand origin [${origin.map((v) => v.toFixed(3)).join(', ')}]`);
    }
  }
});

const f3 = (a: number[] | null) => (a ? a.map((v) => v.toFixed(3)).join(',') : '--');
const int = setInterval(async () => {
  const s = (await (await fetch('http://localhost:8787/api/state')).json()) as any;
  const q = s.robot.qpos as number[];
  const o = origin; // snapshot: `origin` is reassigned in a callback, so TS can't narrow it inside the map
  const off = wrist && o ? wrist.map((v, i) => v - o[i]) : null;
  const fresh = Date.now() - lastSeen < 500;
  log(
    `HAND ${fresh ? ' ' : '(LOST)'} raw[${f3(wrist)}] off[${f3(off)}]  ||  SIM Rarm sp=${q[22]} sr=${q[23]} el=${q[25]} wrist[${f3(s.robot.wrists.r)}]`,
  );
}, 500);

setTimeout(() => { clearInterval(int); process.exit(0); }, 45_000);
