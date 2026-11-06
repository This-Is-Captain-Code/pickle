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
  constructor({ minCutoff = 1.2, beta = 0.25, dCutoff = 1.0 } = {}) {
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

// ---------- tiny vec3 ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
// rotate v around unit axis k by angle t (Rodrigues)
const rotAxis = (v, k, t) => add(add(scale(v, Math.cos(t)), scale(cross(k, v), Math.sin(t))), scale(k, dot(k, v) * (1 - Math.cos(t))));
// quaternion [x,y,z,w] applied to v
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  return add(add(scale(u, 2 * dot(u, v)), scale(v, w * w - dot(u, u))), scale(cross(u, v), 2 * w));
};

// ---------- per-hand state: calibration origin, filters, pinch edge ----------
const CALIB_FRAMES = 25;      // ~0.5 s of frames to lock the rest-pose origin
const LOST_RESET_MS = 1200;   // hand gone this long -> recalibrate on return
const PINCH_ON = 0.028, PINCH_OFF = 0.045; // m, hysteresis on thumb-tip↔index-tip

function makeHand(side) {
  return {
    side, origin: null, calib: [], lastSeen: 0,
    fx: new OneEuro(), fy: new OneEuro(), fz: new OneEuro(),
    pinched: false, offset: null, abs: null,
  };
}
const hands = { left: makeHand('left'), right: makeHand('right') };
let head = null; // latest {pos, rot} from the sender (newer senders only)
let holding = false, lastPinchActionAt = 0;
let parked = false;
// "Ready" park pose: hands hovering over the table (matches the sim's
// REST_POSE); sent once when tracking is lost so the robot never freezes
// mid-motion in whatever pose the last stale frame left it.
const PARK_POSE = {
  left_shoulder_pitch: -0.85, right_shoulder_pitch: -0.85,
  left_shoulder_roll: 0.28, right_shoulder_roll: -0.28,
  left_elbow: 1.3, right_elbow: 1.3, waist_pitch: 0,
};

function updateHand(h, data, t) {
  const wrist = data?.joints?.[0]?.pos;
  if (!wrist) {
    if (t - h.lastSeen > LOST_RESET_MS) { h.origin = null; h.calib = []; h.offset = null; h.basis = null; }
    return;
  }
  h.lastSeen = t;
  h.seenWall = Date.now();
  parked = false;
  if (!h.origin) {
    h.calib.push(wrist);
    if (h.calib.length >= CALIB_FRAMES) {
      h.origin = [0, 1, 2].map((i) => h.calib.reduce((s, p) => s + p[i], 0) / h.calib.length);
      // Freeze the torso frame at calibration (head yaw), so deltas stay
      // body-aligned no matter where the user later looks.
      let fwd = head ? qrot(head.rot, [0, 0, -1]) : [0, 0, -1];
      fwd = unit([fwd[0], 0, fwd[2]]);
      if (!Number.isFinite(fwd[0]) || norm(fwd) < 0.5) fwd = [0, 0, -1];
      h.basis = { fwd, right: unit(cross(fwd, [0, 1, 0])) };
      log('calib', `${h.side} hand origin locked at [${h.origin.map((v) => v.toFixed(3)).join(', ')}] -> robot ready pose`);
    }
    return;
  }
  h.offset = [
    h.fx.filter(wrist[0] - h.origin[0], t),
    h.fy.filter(wrist[1] - h.origin[1], t),
    h.fz.filter(wrist[2] - h.origin[2], t),
  ];
  h.abs = add(h.origin, h.offset); // filtered absolute wrist (XR space), for IK
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

// ---------- arm IK (anchored deltas -> shoulder/elbow angles) ----------
// WebXR has no elbow/shoulder joints. Instead of reconstructing the user's
// absolute arm (whose geometry never matches the robot's), the calibration
// origin is pinned to the robot's ready pose: the wrist target starts at
// D_REST (the ready-pose wrist, measured relative to the robot's shoulder)
// and moves by the user's hand delta, torso-aligned via the head yaw frozen
// at calibration. Two-link solve from there. BRIDGE_IK=0 restores legacy.
const USE_IK = process.env.BRIDGE_IK === '1'; // experimental; default is the simple anchored mapping
const ARM_U = 0.22, ARM_F = 0.26; // G1 upper arm / forearm (m)
const ARM_SCALE = +(process.env.ARM_SCALE || 0.8); // human hand delta -> robot delta
const D_REST = { left: [0.32, 0.07, -0.23], right: [0.32, -0.07, -0.23] }; // ready-pose wrist, shoulder-relative

function armTargetsIK(h) {
  if (!h.offset) return null;
  const basis = h.basis ?? { fwd: [0, 0, -1], right: [1, 0, 0] };
  // XR delta (x right, y up, z back) -> robot frame (x fwd, y left, z up)
  const dd = [dot(h.offset, basis.fwd), -dot(h.offset, basis.right), h.offset[1]];
  const d = add(D_REST[h.side], scale(dd, ARM_SCALE));
  const Lraw = norm(d);
  const L = clamp(Lraw, 0.08, ARM_U + ARM_F - 0.01);
  const dir = unit(d);

  // two-link: upper arm tilts off the shoulder->wrist line by alpha, elbow below
  const alpha = Math.acos(clamp((ARM_U * ARM_U + L * L - ARM_F * ARM_F) / (2 * ARM_U * L), -1, 1));
  const interior = Math.acos(clamp((ARM_U * ARM_U + ARM_F * ARM_F - L * L) / (2 * ARM_U * ARM_F), -1, 1));
  let bendAxis = cross(dir, [0, 0, 1]); // horizontal normal of the vertical plane through dir
  if (norm(bendAxis) < 0.1) bendAxis = cross(dir, [1, 0, 0]);
  bendAxis = unit(bendAxis);
  const uDir = rotAxis(dir, bendAxis, -alpha); // elbow drops below the line
  // Upper-arm direction (pitch about y, then roll about x, zero = hanging):
  //   uDir = (-sin(p)cos(r), sin(r), -cos(p)cos(r))  [robot frame: x fwd, y left, z up]
  const roll = Math.asin(clamp(uDir[1], -1, 1));
  const pitch = Math.atan2(-uDir[0], -uDir[2]);
  const elbow = clamp(Math.PI - interior, -0.2, 2.05);

  const p = `${h.side}_`;
  const out = {};
  out[p + 'shoulder_pitch'] = clamp(pitch, -2.9, 2.5);
  out[p + 'shoulder_roll'] = clamp(roll, -2.2, 2.2);
  out[p + 'elbow'] = elbow;
  // Lean only on reach DEFICIT (target beyond the arm), never at rest.
  out._lean = clamp((Lraw - (ARM_U + ARM_F - 0.03)) / 0.15, 0, 1) * 0.5;
  return out;
}

// ---------- the demo mapping: ready pose + three linear sliders per arm ----
// Calibration origin = the robot's ready pose (hands flanking the box).
// Hand up/down -> shoulder pitch; left/right -> shoulder roll; forward/back
// -> elbow. Linear gains, generous clamps, nothing that can amplify noise.
const GAIN = { pitch: 3.0, roll: 2.6, elbow: 3.2 }; // rad per metre of hand travel
function armTargets(h) {
  if (!h.offset) return null;
  const basis = h.basis ?? { fwd: [0, 0, -1], right: [1, 0, 0] };
  // XR delta -> body-aligned: dFwd (reach), dLeft, dUp
  const dFwd = dot(h.offset, basis.fwd);
  const dLeft = -dot(h.offset, basis.right);
  const dUp = h.offset[1];
  const restRoll = h.side === 'left' ? 0.28 : -0.28;
  const p = `${h.side}_`;
  const out = {};
  out[p + 'shoulder_pitch'] = clamp(-0.85 - dUp * GAIN.pitch, -2.3, 0.4);
  out[p + 'shoulder_roll'] = clamp(restRoll + dLeft * GAIN.roll, -1.9, 1.9);
  out[p + 'elbow'] = clamp(1.3 - dFwd * GAIN.elbow, 0.05, 2.0);
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
  let maxReach = null, maxLean = null;
  const now = Date.now();
  const anyFresh = [hands.left, hands.right].some((h) => h.seenWall && now - h.seenWall < 400);
  if (!anyFresh) {
    // Tracking lost: park once in the ready pose instead of holding stale motion.
    const lastSeen = Math.max(hands.left.seenWall ?? 0, hands.right.seenWall ?? 0);
    if (!parked && lastSeen && now - lastSeen > 2500) {
      const t = new Array(nu).fill(null);
      for (const [name, v] of Object.entries(PARK_POSE)) { const i = actuatorIndex.get(name); if (i != null) t[i] = v; }
      simWs.send(JSON.stringify({ t: 'ctrl', targets: t }));
      parked = true;
      log('bridge', 'hands lost — parked in ready pose');
    }
    return;
  }
  for (const h of [hands.left, hands.right]) {
    if (!h.seenWall || now - h.seenWall > 400) continue; // stale hand: don't steer with old data
    const t = USE_IK ? armTargetsIK(h) : armTargets(h);
    if (!t) continue;
    if (t._lean != null) maxLean = Math.max(maxLean ?? 0, t._lean);
    if (t._reach != null) maxReach = Math.max(maxReach ?? -99, t._reach);
    delete t._reach; delete t._lean;
    for (const [name, v] of Object.entries(t)) { const i = actuatorIndex.get(name); if (i != null) targets[i] = +v.toFixed(4); }
  }
  const wi = actuatorIndex.get('waist_pitch');
  if (wi != null) {
    if (maxLean != null) targets[wi] = +maxLean.toFixed(4); // IK: lean on reach deficit only
    else if (maxReach != null) targets[wi] = +mapAxis(maxReach, 0.05, 0.35, 0, 0.5).toFixed(4); // legacy
  }
  if (targets.every((v) => v == null)) return;
  if (lastSent && targets.every((v, i) => v == null || lastSent[i] == null || Math.abs(v - lastSent[i]) < 0.005)) return;
  lastSent = targets;
  simWs.send(JSON.stringify({ t: 'ctrl', targets }));
}, 1000 / RATE_HZ);

// ---------- frame source: relay, or synthetic hands for desk testing ----------
function onFrame(frame) {
  const t = frame.ts ?? performance.now();
  if (frame.head?.pos && frame.head?.rot) head = frame.head;
  updateHand(hands.left, frame.left, t);
  updateHand(hands.right, frame.right, t);
}

function connectRelay() {
  const ws = new WebSocket(RELAY_WS_URL);
  ws.on('open', () => log('relay', `connected ${RELAY_WS_URL}`));
  ws.on('close', () => { log('relay', 'closed, retrying in 3s'); setTimeout(connectRelay, 3000); });
  ws.on('error', (e) => log('relay', `error: ${e.message}`));
  // Latest-frame sampling: a WS hiccup makes the relay deliver a burst of
  // queued frames at once — replaying them moves the robot "on its own" with
  // stale motion. Keep only the freshest frame per tick, drop the backlog.
  let latest = null, dropped = 0, n = 0;
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m.left && !m.right) return;
    if (latest) dropped++;
    latest = m;
    if (++n % 600 === 1) log('relay', `frames flowing (#${n}, ${dropped} stale dropped)`);
  });
  setInterval(() => {
    if (!latest) return;
    const m = latest;
    latest = null;
    onFrame(m);
  }, 1000 / 90);
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
      head: { pos: [0, 1.55, 0], rot: [0, 0, 0, 1] }, // exercises the IK path
      right: { joints: mkJoints([0.2, 1.0 + dy, -0.3 + dz], pinching ? 0.01 : 0.09), n: 3 },
      left: { joints: mkJoints([-0.2, 1.0 + (settled ? 0.15 * Math.sin(s * 0.9 + 1) : 0), -0.3], 0.09), n: 3 },
    });
  }, 1000 / 60);
}

connectSim();
if (FAKE) runFake(); else connectRelay();
log('bridge', `mode=${FAKE ? 'fake' : 'relay'} rate=${RATE_HZ}Hz autoBegin=${AUTO_BEGIN} ik=${USE_IK ? 'on (anchored: calibration = ready pose)' : 'off'}`);
