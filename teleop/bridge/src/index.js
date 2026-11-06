// Pickle teleop bridge: Spectacles hand frames (via the relay) → G1 arm joint
// targets (via the sim's WebSocket).
//
//   relay ──frames──▶ calibrate → One-Euro filter → map to joints ──ctrl @30Hz──▶ sim
//                                  pinch gesture (thumb↔index) ──pick/drop──▶ sim
//
// Hand frame format (from teleop/sender): {frame, ts, left?: {joints:[26], n}, right?: {...}}
// joints[i] = {pos:[x,y,z], rot:[x,y,z,w]} | null. XR space: x right, y up, z toward the wearer.
// Joint indices: wrist 0, thumb tip 5, index tip 10 (tips are 5/10/15/20/25).
//
// Run:  node src/index.js            (connect relay → sim)
//       node src/index.js --fake     (no Spectacles: synthetic hand motion)
import WebSocket from 'ws';

const SIM_URL = process.env.SIM_URL || 'http://localhost:8787';
const SIM_WS = SIM_URL.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(process.env.SIM_TELEOP_TOKEN || 'dev-token');
const RELAY_WS_URL = process.env.RELAY_WS_URL || 'wss://pickle-hand-relay.pickle-delhi.workers.dev/pickle';
const RATE_HZ = +(process.env.RATE_HZ || 60);
const AUTO_BEGIN = process.env.BRIDGE_AUTO_BEGIN === '1'; // dev: begin teleop as soon as the robot is stuck
const FAKE = process.argv.includes('--fake');

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

// ---------- One-Euro filter (per axis): light smoothing, low lag on fast moves ----------
class OneEuro {
  constructor({ minCutoff = 3.0, beta = 0.9, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null });
  }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.t == null) { this.t = t; this.x = x; return x; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    const dxRaw = (x - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// clamp+scale an input range onto a joint range (pinch's mapAxis, in radians)
const mapAxis = (v, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * clamp((v - inMin) / (inMax - inMin), 0, 1);

// ---------- per-hand state: calibration origin, filters, pinch edge ----------
const CALIB_FRAMES = 25;      // ~0.5 s of frames to lock the rest-pose origin
const LOST_RESET_MS = 1200;   // hand gone this long -> recalibrate on return
const PINCH_ON = 0.028, PINCH_OFF = 0.045; // m, hysteresis on thumb-tip↔index-tip

function makeHand(side) {
  return {
    side, origin: null, calib: [], lastSeen: 0,
    fx: new OneEuro(), fy: new OneEuro(), fz: new OneEuro(),
    pinched: false, offset: null,
  };
}
const hands = { left: makeHand('left'), right: makeHand('right') };
let holding = false, lastPinchActionAt = 0;

function updateHand(h, data, t) {
  const wrist = data?.joints?.[0]?.pos;
  if (!wrist) {
    if (t - h.lastSeen > LOST_RESET_MS) { h.origin = null; h.calib = []; h.offset = null; }
    return;
  }
  h.lastSeen = t;
  if (!h.origin) {
    h.calib.push(wrist);
    if (h.calib.length >= CALIB_FRAMES) {
      h.origin = [0, 1, 2].map((i) => h.calib.reduce((s, p) => s + p[i], 0) / h.calib.length);
      log('calib', `${h.side} hand origin locked at [${h.origin.map((v) => v.toFixed(3)).join(', ')}]`);
    }
    return;
  }
  h.offset = [
    h.fx.filter(wrist[0] - h.origin[0], t),
    h.fy.filter(wrist[1] - h.origin[1], t),
    h.fz.filter(wrist[2] - h.origin[2], t),
  ];
  // pinch gesture with hysteresis; a right-hand pinch toggles pick/drop
  const thumb = data.joints[5]?.pos, index = data.joints[10]?.pos;
  if (thumb && index) {
    const d = Math.hypot(thumb[0] - index[0], thumb[1] - index[1], thumb[2] - index[2]);
    const was = h.pinched;
    h.pinched = was ? d < PINCH_OFF : d < PINCH_ON;
    if (!was && h.pinched && h.side === 'right' && Date.now() - lastPinchActionAt > 600) {
      lastPinchActionAt = Date.now();
      sendAction(holding ? 'drop' : 'pick');
    }
  }
}

// ---------- hand offsets (m, XR frame) -> G1 joint targets (rad) ----------
// Arms + a forward waist lean on deep reaches (the G1's arms alone max out at
// ~0.45 m from the waist axis; leaning buys the extra reach a human expects).
// Legs/wrists stay at their current targets (nulls). Reach forward = -z in XR.
function armTargets(h) {
  if (!h.offset) return null;
  const [dx, dy, dz] = h.offset, reach = -dz, out = {};
  const p = `${h.side}_`;
  out[p + 'shoulder_pitch'] = mapAxis(dy, -0.25, 0.35, 0.5, -2.2);         // hand up -> arm up
  out[p + 'shoulder_roll'] = h.side === 'right'
    ? mapAxis(dx, -0.15, 0.3, 0.3, -1.6)                                    // right hand out (+x) -> abduct (-roll)
    : mapAxis(dx, -0.3, 0.15, 1.6, -0.3);                                   // left hand out (-x) -> abduct (+roll)
  out[p + 'elbow'] = mapAxis(reach, -0.1, 0.35, 1.9, -0.4);                 // reach forward -> extend
  out._reach = reach;
  return out;
}

// ---------- sim connection ----------
let simWs = null, actuatorIndex = null, nu = 0, robotMode = 'unknown';
let lastSent = null;

function connectSim() {
  simWs = new WebSocket(SIM_WS);
  simWs.on('open', () => log('sim', `connected ${SIM_WS.split('?')[0]}`));
  simWs.on('close', () => { log('sim', 'closed, retrying in 2s'); setTimeout(connectSim, 2000); });
  simWs.on('error', (e) => log('sim', `error: ${e.message}`));
  simWs.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'init') {
      nu = m.actuators.length;
      actuatorIndex = new Map(m.actuators.map((a, i) => [a.name, i]));
      log('sim', `init: ${nu} actuators, canControl=${m.canControl}`);
      if (!m.canControl) log('sim', 'WARNING: token rejected — ctrl will be denied');
      robotMode = m.robot.mode;
      if (robotMode === 'stuck' && AUTO_BEGIN) beginTeleop();
    } else if (m.t === 'robot' || m.t === 'state') {
      const prev = robotMode;
      robotMode = m.robot.mode;
      holding = !!m.robot.holding;
      if (prev !== robotMode) {
        log('sim', `robot mode: ${prev} -> ${robotMode}`);
        if (robotMode === 'stuck' && AUTO_BEGIN) beginTeleop();
      }
    } else if (m.t === 'denied') log('sim', `denied: ${m.msg}`);
  });
}

async function beginTeleop() {
  try {
    const res = await fetch(`${SIM_URL}/api/teleop/begin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.SIM_TELEOP_TOKEN || 'dev-token' }) });
    log('sim', res.ok ? 'teleop session started (auto)' : `begin failed: ${(await res.json()).error}`);
  } catch (e) { log('sim', `begin failed: ${e.message}`); }
}

function sendAction(id) {
  if (simWs?.readyState !== WebSocket.OPEN) return;
  simWs.send(JSON.stringify({ t: 'action', id }));
  log('gesture', `pinch -> ${id}`);
}

// 30 Hz ctrl sender with a deadband: only send when a target moved > 5 mrad.
setInterval(() => {
  if (!actuatorIndex || robotMode !== 'teleop' || simWs?.readyState !== WebSocket.OPEN) return;
  const targets = new Array(nu).fill(null);
  let maxReach = null;
  for (const h of [hands.left, hands.right]) {
    const t = armTargets(h);
    if (!t) continue;
    maxReach = maxReach == null ? t._reach : Math.max(maxReach, t._reach);
    delete t._reach;
    for (const [name, v] of Object.entries(t)) { const i = actuatorIndex.get(name); if (i != null) targets[i] = +v.toFixed(4); }
  }
  if (maxReach != null) {
    const i = actuatorIndex.get('waist_pitch');
    if (i != null) targets[i] = +mapAxis(maxReach, 0.05, 0.35, 0, 0.5).toFixed(4); // deep reach -> lean in
  }
  if (targets.every((v) => v == null)) return;
  if (lastSent && targets.every((v, i) => v == null || lastSent[i] == null || Math.abs(v - lastSent[i]) < 0.002)) return;
  lastSent = targets;
  simWs.send(JSON.stringify({ t: 'ctrl', targets }));
}, 1000 / RATE_HZ);

// ---------- frame source: relay, or synthetic hands for desk testing ----------
function onFrame(frame) {
  const t = frame.ts ?? performance.now();
  updateHand(hands.left, frame.left, t);
  updateHand(hands.right, frame.right, t);
}

function connectRelay() {
  const ws = new WebSocket(RELAY_WS_URL);
  ws.on('open', () => log('relay', `connected ${RELAY_WS_URL}`));
  ws.on('close', () => { log('relay', 'closed, retrying in 3s'); setTimeout(connectRelay, 3000); });
  ws.on('error', (e) => log('relay', `error: ${e.message}`));
  let n = 0;
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m.left && !m.right) return;
    if (++n % 300 === 1) log('relay', `frames flowing (#${n})`);
    onFrame(m);
  });
}

function runFake() {
  log('fake', 'synthetic hands: right hand circles, pinches every 4 s');
  const t0 = performance.now();
  const mkJoints = (wrist, pinchDist) => {
    const joints = new Array(26).fill(null);
    joints[0] = { pos: wrist };
    joints[5] = { pos: [wrist[0] + pinchDist, wrist[1], wrist[2]] };  // thumb tip
    joints[10] = { pos: [wrist[0], wrist[1], wrist[2]] };             // index tip
    return joints;
  };
  setInterval(() => {
    const t = performance.now(), s = (t - t0) / 1000;
    const settled = s > 1; // first second: hold still so calibration locks
    const dy = settled ? 0.25 * Math.sin(s * 1.2) : 0;
    const dz = settled ? -0.15 * (1 + Math.cos(s * 1.2)) : 0;
    const pinching = settled && s % 4 < 0.8;
    onFrame({
      ts: t,
      right: { joints: mkJoints([0.2, 1.0 + dy, -0.3 + dz], pinching ? 0.01 : 0.09), n: 3 },
      left: { joints: mkJoints([-0.2, 1.0 + (settled ? 0.15 * Math.sin(s * 0.9 + 1) : 0), -0.3], 0.09), n: 3 },
    });
  }, 1000 / 60);
}

connectSim();
if (FAKE) runFake(); else connectRelay();
log('bridge', `mode=${FAKE ? 'fake' : 'relay'} rate=${RATE_HZ}Hz autoBegin=${AUTO_BEGIN}`);
