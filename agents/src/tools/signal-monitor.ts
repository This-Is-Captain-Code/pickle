// Live diagnostic tap: relay hand frames in, sim reactions out, 60 seconds.
//   npx tsx src/tools/signal-monitor.ts
import WebSocket from 'ws';

const RELAY = 'wss://pickle-hand-relay.pickle-delhi.workers.dev/pickle';
const SIM = 'ws://localhost:8787/ws';
const ts = () => new Date().toISOString().slice(14, 23);
const log = (tag: string, msg: string) => console.log(`${ts()} [${tag}] ${msg}`);

// ---- relay side: finger signals ----
let frames = 0, lastFrameNo = -1, regressions = 0;
const hand = { seen: 0, pinchDist: NaN, pinched: false, tips: 0 };
const wristBuf: number[][] = [];

const rws = new WebSocket(RELAY);
rws.on('open', () => log('tap', 'listening to relay frames'));
rws.on('message', (buf) => {
  let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (!m.left && !m.right) return;
  frames++;
  if (typeof m.frame === 'number') {
    if (m.frame < lastFrameNo - 5) { regressions++; log('tap', `!! frame counter went BACKWARDS (${lastFrameNo} -> ${m.frame}) — second sender?`); }
    lastFrameNo = m.frame;
  }
  const r = m.right;
  if (r?.joints?.[0]?.pos) {
    hand.seen = Date.now();
    wristBuf.push(r.joints[0].pos);
    if (wristBuf.length > 60) wristBuf.shift();
    const t = r.joints[5]?.pos, i = r.joints[10]?.pos;
    hand.tips = (t ? 1 : 0) + (i ? 1 : 0);
    if (t && i) {
      const d = Math.hypot(t[0] - i[0], t[1] - i[1], t[2] - i[2]);
      const was = hand.pinched;
      hand.pinched = was ? d < 0.045 : d < 0.028;
      hand.pinchDist = d;
      if (hand.pinched !== was) log('pinch', `${hand.pinched ? 'ON ' : 'OFF'} dist=${(d * 1000).toFixed(0)}mm`);
    } else {
      hand.pinchDist = NaN;
    }
  }
});

// ---- sim side: what the robot does ----
let holding = false, mode = '?';
const sws = new WebSocket(SIM);
sws.on('open', () => log('tap', 'listening to sim state'));
sws.on('message', (buf) => {
  let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.t === 'robot' || m.t === 'state') {
    if (m.robot.mode !== mode) { mode = m.robot.mode; log('sim', `mode -> ${mode}`); }
    if (!!m.robot.holding !== holding) { holding = !!m.robot.holding; log('sim', `holding -> ${holding} (${m.robot.held ?? '-'})`); }
  }
  if (m.t === 'toast') log('sim', `toast[${m.level}]: ${m.msg}`);
  if (m.t === 'denied') log('sim', `DENIED: ${m.msg}`);
});

// ---- 1 Hz summary ----
const int = setInterval(() => {
  const fresh = Date.now() - hand.seen < 500;
  let jitter = NaN;
  if (wristBuf.length > 20) {
    const mean = [0, 1, 2].map((i) => wristBuf.reduce((s, p) => s + p[i], 0) / wristBuf.length);
    jitter = Math.sqrt(wristBuf.reduce((s, p) => s + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2 + (p[2] - mean[2]) ** 2, 0) / wristBuf.length) * 1000;
  }
  console.log(`${ts()} [1s] frames=${frames} rightHand=${fresh ? 'LIVE' : 'lost'} tips=${hand.tips}/2 pinchDist=${Number.isFinite(hand.pinchDist) ? (hand.pinchDist * 1000).toFixed(0) + 'mm' : '--'} wristSpread=${Number.isFinite(jitter) ? jitter.toFixed(1) + 'mm' : '--'} | sim: ${mode} holding=${holding}`);
  frames = 0;
}, 1000);

setTimeout(() => { clearInterval(int); log('tap', `done. backward-frame events: ${regressions}`); process.exit(0); }, 60_000);
