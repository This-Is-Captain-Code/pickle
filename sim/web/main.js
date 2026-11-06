// Minimal viewer bootstrap: renders the server's pose stream and, when opened
// with ?token=<SIM_TELEOP_TOKEN>, offers manual teleop controls (mouse drag +
// begin/end buttons). The Spectacles path drives the same WS protocol from
// teleop/bridge instead.
import { createViewer } from '/viewer.js';

const token = new URLSearchParams(location.search).get('token') || '';
const viewer = createViewer(document.getElementById('c'));
const $ = (id) => document.getElementById(id);

let ws, robot = null, canControl = false;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  ws.onopen = () => chip('s-ws', 'ws: live', 'ok');
  ws.onclose = () => { chip('s-ws', 'ws: retry…', 'warn'); setTimeout(connect, 2000); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') { canControl = !!m.canControl; viewer.setGeoms(m); setRobot(m.robot); setBounty(m.bounty); }
    else if (m.t === 'state') { viewer.setPoses(m.poses); setRobot(m.robot); }
    else if (m.t === 'robot') setRobot(m.robot);
    else if (m.t === 'bounty') setBounty(m.bounty);
    else if (m.t === 'stuck') toast(`Stuck: ${m.event.title}`, 'warn');
    else if (m.t === 'toast') toast(m.msg, m.level);
    else if (m.t === 'denied') toast(m.msg, 'error');
  };
}
connect();

viewer.onDrag = ({ body, target }) => {
  if (ws?.readyState === 1 && robot?.mode === 'teleop') ws.send(JSON.stringify({ t: 'drag', body, target }));
};

function chip(id, text, cls = '') { const el = $(id); el.textContent = text; el.className = `chip ${cls}`; }

// Bounty overlay: QR while open, status while claimed/verified. Set by the
// agents core via POST /api/bounty; cleared with bounty=null.
function setBounty(b) {
  const el = $('bounty');
  if (!b) { el.style.display = 'none'; $('bounty-qr').innerHTML = ''; return; }
  el.style.display = 'block';
  el.className = b.state === 'claimed' ? 'claimed' : b.state === 'verified' ? 'verified' : '';
  $('bounty-title').textContent = b.state === 'claimed' ? 'CLAIMED' : b.state === 'verified' ? 'VERIFIED 🥒' : 'BOUNTY — SCAN TO CLAIM';
  $('bounty-text').textContent = b.title || '';
  $('bounty-qr').innerHTML = '';
  $('bounty-qr').style.display = b.url && b.state === 'open' ? 'inline-block' : 'none';
  if (b.url && b.state === 'open' && window.QRCode) new QRCode($('bounty-qr'), { text: b.url, width: 148, height: 148, correctLevel: QRCode.CorrectLevel.M });
}

function setRobot(r) {
  if (!r) return;
  robot = r;
  viewer.setPerson(r.person);
  viewer.setDragEnabled(canControl && r.mode === 'teleop');
  chip('s-mode', `mode: ${r.mode}${r.stuckReason ? ` (${r.stuckReason})` : ''}`, r.mode === 'stuck' ? 'err' : r.mode === 'teleop' ? 'warn' : 'ok');
  chip('s-time', `t: ${r.time.toFixed(1)}s`);
  chip('s-held', r.holding ? `hands: ${r.held}` : 'hands: free', r.holding ? 'warn' : '');
  chip('s-done', `shipped: ${r.shipped}`);
  $('b-teleop').disabled = !(canControl && r.mode === 'stuck');
  $('b-done').disabled = !(canControl && r.mode === 'teleop');
  const panel = $('stuck');
  if (r.mode === 'stuck' || r.mode === 'teleop') {
    const acts = r.actions.map((a) => `<button data-action="${a.id}" ${a.available && r.mode === 'teleop' ? '' : 'disabled'} title="${a.desc}">${a.done ? '✓ ' : ''}${a.label}</button>`).join(' ');
    const manual = (r.manualActions || []).map((a) => `<button data-action="${a.id}" ${a.available ? '' : 'disabled'} title="${a.desc}">${a.label}</button>`).join(' ');
    panel.innerHTML = `<b>${r.stuckReason ?? ''}</b> — ${r.resume ? `resume blocked: ${r.resume}` : 'safe to resume'}<div class="row" style="margin-top:6px">${acts} ${manual}</div>`;
    panel.style.display = 'block';
  } else panel.style.display = 'none';
}

async function post(url) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!res.ok) toast((await res.json()).error || res.statusText, 'error');
}
document.body.addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.scenario) post(`/api/scenario/${b.dataset.scenario}`);
  else if (b.dataset.action && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'action', id: b.dataset.action }));
  else if (b.id === 'b-teleop') post('/api/teleop/begin');
  else if (b.id === 'b-done') post('/api/teleop/end');
});

function toast(msg, level = '') {
  const el = document.createElement('div');
  el.className = `toast ${level}`; el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
