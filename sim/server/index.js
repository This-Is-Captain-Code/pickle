// Pickle sim server: authoritative MuJoCo G1 simulation + WebSocket streams.
// Slimmed from Robot Rescue's server: no World ID / payments / DB here — those
// live in Pickle's agents core, which talks to this server over HTTP + webhook.
//
//   viewers     ──ws /ws───────────▶ init / state (30 Hz) / robot status
//   controller  ──ws /ws?token=…──▶ {t:'ctrl'|'drag'|'action'} while teleop is active
//   agents core ◀──POST webhook──── stuck events (bounty trigger)
//   agents core ──POST /api/teleop/begin|end {token}── gates control after a verified claim
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Sim, SCENE_DIR } from './sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.SIM_PORT || 8787);
const TOKEN = process.env.SIM_TELEOP_TOKEN || 'dev-token';
const WEBHOOK = process.env.AGENTS_WEBHOOK_URL || ''; // e.g. http://localhost:8090/events/sim
// Demo defaults: the sim stays in teleop — the human always has control
// (SIM_MODE=auto restores the autonomous routine). A scenario can still be
// staged at boot when running the bounty story: SIM_SCENARIO=knock|obstacle|person.
const SIM_MODE = (process.env.SIM_MODE ?? 'teleop').toLowerCase();
const AUTO_SCENARIO = (process.env.SIM_SCENARIO ?? 'none').toLowerCase();
// Where the box is staged for teleop sessions: centered, one small reach in
// front of the hands' rest midpoint (0.27, 0, 0.87); drop zone on the right.
const BOX_SPOT = (process.env.SIM_BOX ?? '0.34,0,0.875').split(',').map(Number);
// The pose the bridge commands at the user's calibration rest: the robot
// idles hands-over-table instead of slumping at ctrl=0.
const REST_POSE = {
  left_shoulder_pitch: -0.85, right_shoulder_pitch: -0.85,
  left_shoulder_roll: 0.28, right_shoulder_roll: -0.28,
  left_elbow: 1.3, right_elbow: 1.3,
};

const sim = await Sim.create();
const app = express();
app.use(express.json());

const requireToken = (req, res, next) =>
  (req.body?.token || req.query.token) === TOKEN ? next() : res.status(403).json({ error: 'bad token' });

app.get('/api/state', (_req, res) => res.json({ robot: sim.status(), bounty }));

// The agents core attaches/clears the bounty shown by the viewer (QR overlay).
let bounty = null;
app.post('/api/bounty', requireToken, (req, res) => {
  bounty = req.body.bounty ?? null;
  broadcast({ t: 'bounty', bounty });
  res.json({ ok: true });
});

// Scenario controls — the "world" acting on the robot (demo triggers).
app.post('/api/scenario/:name', (req, res) => {
  const map = { obstacle: () => sim.spawnObstacle(), person: () => sim.personEnter(), knock: () => sim.knockTarget(), reset: () => sim.reset() };
  if (!map[req.params.name]) return res.status(404).json({ error: 'unknown scenario' });
  map[req.params.name]();
  res.json({ ok: true, robot: sim.status() });
});

// Teleop gate. The agents core calls begin AFTER the IDKit claim verified;
// end runs the sim's own resume check (the fix must actually hold).
app.post('/api/teleop/begin', requireToken, (req, res) => {
  if (!sim.beginTeleop(req.body.force === true)) return res.status(409).json({ error: `robot is not stuck (mode=${sim.mode})` });
  broadcast({ t: 'toast', level: 'ok', msg: 'Teleop session started.' });
  res.json({ ok: true, robot: sim.status() });
});
app.post('/api/teleop/end', requireToken, async (_req, res) => {
  const before = sim.status(); // post-fix, pre-resume snapshot: what the human left behind
  const blocker = sim.endTeleop();
  if (blocker) return res.status(409).json({ error: blocker, robot: sim.status() });
  broadcast({ t: 'toast', level: 'ok', msg: 'Teleop done — robot back to work.' });
  res.json({ ok: true, robot: sim.status() });
  if (WEBHOOK) {
    const telemetry = {
      obstacle_in_path: before.obstacleInPath, person_near: before.personNear,
      target_displaced: before.targetDisplaced, holding: before.holding,
      contacts: before.ncon, actions_done: before.actionsDone, time_s: before.time,
    };
    try {
      await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'teleop_done', robotId: 'g1-sim-01', telemetry }) });
    } catch (e) { console.error('[webhook] agents core unreachable:', e.message); }
  }
});
app.post('/api/teleop/release', requireToken, (_req, res) => { sim.releaseToPool(); res.json({ ok: true }); });
app.post('/api/action', requireToken, (req, res) => {
  const err = sim.humanAction(String(req.body.id || ''));
  if (err) return res.status(409).json({ error: err });
  res.json({ ok: true, robot: sim.status() });
});

// Static: robot meshes + the viewer page (three.js comes from a CDN importmap).
app.use('/scenes/unitree_g1/assets', express.static(path.join(SCENE_DIR, 'assets'), { maxAge: '1d', immutable: true }));
app.use('/scenes/people', express.static(path.join(SCENE_DIR, '..', 'people'), { maxAge: '1d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'web')));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of clients) if (c.readyState === 1) c.send(s); }

wss.on('connection', (ws, req) => {
  ws.canControl = new URL(req.url, 'http://x').searchParams.get('token') === TOKEN;
  clients.add(ws);
  ws.send(JSON.stringify({ t: 'init', ...sim.describe(), robot: sim.status(), canControl: ws.canControl }));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!ws.canControl) return ws.send(JSON.stringify({ t: 'denied', msg: 'control locked: connect with ?token=' }));
    if (m.t === 'ctrl') sim.setTeleop(m.targets || []);
    else if (m.t === 'drag') sim.setDrag(m.body == null ? null : Number(m.body), Array.isArray(m.target) ? m.target : [0, 0, 0]);
    else if (m.t === 'action') { const err = sim.humanAction(String(m.id || '')); if (err) ws.send(JSON.stringify({ t: 'toast', level: 'error', msg: err })); }
  });
});

// ---------- events out ----------
sim.on('status', () => broadcast({ t: 'robot', robot: sim.status() }));
sim.on('stuck', async (info) => {
  const st = sim.status();
  const event = {
    type: 'stuck', robotId: 'g1-sim-01', reason: info.reason, title: info.title, detail: info.detail,
    urgency: info.urgency, suggestedReward: info.reward,
    telemetry: { time_s: st.time, person_near: st.personNear, obstacle_in_path: st.obstacleInPath, target_displaced: st.targetDisplaced, contacts: st.ncon, last_routine_step: st.waypoint, joint_positions_rad: st.qpos },
    actions: st.actions.map(({ id, label, desc }) => ({ id, label, desc })),
    resumeCondition: st.resume || 'safe to resume',
  };
  broadcast({ t: 'stuck', event });
  broadcast({ t: 'toast', level: 'warn', msg: `Robot stuck: ${info.title}` });
  if (WEBHOOK) {
    try { await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }); }
    catch (e) { console.error('[webhook] agents core unreachable:', e.message); }
  }
});

// ---------- main loop: 60 Hz physics, 30 Hz state stream ----------
let last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(Number(now - last) / 1e9, 0.1); last = now;
  sim.advance(dt);
}, 1000 / 60);
setInterval(() => broadcast({ t: 'state', time: +sim.data.time.toFixed(3), poses: sim.poses(), robot: sim.status() }), 1000 / 30);

process.on('uncaughtException', (e) => console.error('[sim] uncaught exception (kept running):', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[sim] unhandled rejection (kept running):', e?.stack || e));
server.listen(PORT, () => {
  console.log(`pickle sim on http://localhost:${PORT}  (teleop token ${TOKEN === 'dev-token' ? 'dev-token (default)' : 'set'}; webhook ${WEBHOOK || 'off'}; mode ${SIM_MODE}; scenario ${AUTO_SCENARIO})`);
  // Always-teleop watchdog: whatever drops the sim back to auto (boot, reset,
  // work done), control returns to the human within a second — with the box
  // staged at the comfortable teleop spot.
  if (SIM_MODE === 'teleop') setInterval(() => {
    if (sim.mode !== 'auto') return;
    sim.beginTeleop(true);
    sim.setTeleop(sim.actNames.map((n) => REST_POSE[n] ?? null));
    if (BOX_SPOT.length === 3 && BOX_SPOT.every(Number.isFinite)) {
      const b = sim.boxes[sim.current];
      sim.placeFree(b.qadr, b.dadr, BOX_SPOT);
    }
  }, 1000);
  const auto = { obstacle: () => sim.spawnObstacle(), person: () => sim.personEnter(), knock: () => sim.knockTarget() }[AUTO_SCENARIO];
  if (auto) {
    // Retry until it takes. For knock, the displaced-box check only runs in
    // the approach/descend steps — staged anywhere else, the robot grasps the
    // box anyway — so wait for the approach window with free hands.
    const timer = setInterval(() => {
      if (sim.mode !== 'auto') return clearInterval(timer); // staged (or someone else got it stuck)
      if (AUTO_SCENARIO === 'knock') {
        const st = sim.status();
        if (st.holding || st.waypoint !== 'approach') return;
      }
      auto();
      console.log(`[demo] auto-staged scenario: ${AUTO_SCENARIO}`);
      clearInterval(timer);
    }, 1000);
  }
});
