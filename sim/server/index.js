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
app.post('/api/teleop/begin', requireToken, (_req, res) => {
  if (!sim.beginTeleop()) return res.status(409).json({ error: `robot is not stuck (mode=${sim.mode})` });
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
server.listen(PORT, () => console.log(`pickle sim on http://localhost:${PORT}  (teleop token ${TOKEN === 'dev-token' ? 'dev-token (default)' : 'set'}; webhook ${WEBHOOK || 'off'})`));
