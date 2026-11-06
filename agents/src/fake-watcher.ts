// Fake Watcher: emulates the SenseCAP Watcher firmware over MQTT so the whole
// physical-bounty loop runs on a desk with no hardware. With --auto it also
// plays the human: "scans" the QR by sending the claim into the relay room,
// then unplugs and replugs itself.
//
//   npm run fake-watcher -w agents          # device only (drive it by hand)
//   npm run fake-watcher -w agents -- --auto
import mqtt from 'mqtt';
import WebSocket from 'ws';

const env = (k: string, d = '') => process.env[k] ?? d;
const DEV = env('FAKE_DEV_ID', 'watcher-01');
const AUTO = process.argv.includes('--auto') || env('FAKE_AUTO') === '1';
const CLAIMS_WS_URL = env('CLAIMS_WS_URL', 'wss://pickle-hand-relay.pickle-delhi.workers.dev/claims');

const log = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);
const client = mqtt.connect(env('BROKER_URL'), {
  username: env('BROKER_USER', 'bridge'), password: env('BROKER_PASS'),
  clientId: `${DEV}-fake`, will: { topic: `monaid/${DEV}/status`, payload: Buffer.from('offline'), qos: 1, retain: true },
});

let seq = 0, rssi = -52, screen = 'IDLE';
const evt = (kind: string, data: Record<string, unknown> = {}) =>
  client.publish(`monaid/${DEV}/evt`, JSON.stringify({ dev: DEV, kind, seq: ++seq, ts: Math.floor(Date.now() / 1000), data, sig: '' }), { qos: 1 });

client.on('connect', () => {
  client.publish(`monaid/${DEV}/status`, 'online', { qos: 1, retain: true });
  client.subscribe(`monaid/${DEV}/cmd`);
  log('fake', `${DEV} online (broker ok)`);
  setInterval(() => evt('heartbeat', { up: process.uptime() | 0, n: ++beats, rssi }), 5000);
  if (AUTO) setTimeout(() => { log('fake', 'power cord yanked (VBUS down) -> dying on battery *-*'); evt('power', { on: false, charging: false, initial: false }); }, 2000);
});
let beats = 0;

client.on('message', (_t, buf) => {
  let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.cmd === 'state') { screen = m.state; log('screen', `█ ${screen} █`); }
  else if (m.cmd === 'job' && m.id) { log('screen', `job #${m.id}${m.payout ? ` ${m.payout}` : ''} ${m.url ? `QR[${m.url}]` : '(no QR)'}`); if (AUTO && m.url) scanQr(m.url); }
  else if (m.cmd === 'job') log('screen', 'job cleared');
  else if (m.cmd === 'say') log('screen', `💬 ${m.text}`);
  else if (m.cmd === 'simulate') log('fake', `simulate ${m.kind}`);
});

// --- the "human" (auto mode): scan QR -> claim page behavior -> move the device ---
function scanQr(url: string) {
  const u = new URL(url);
  const bountyId = u.searchParams.get('b'), device = u.searchParams.get('d');
  const claimId = 'c-fake-' + Date.now().toString(36);
  log('human', `scanned QR -> claiming ${bountyId}`);
  const ws = new WebSocket(CLAIMS_WS_URL);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'claim', claimId, bountyId, device, ts: Date.now() })));
  ws.on('message', (buf) => {
    let m: any; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.type !== 'claim_ack' || m.claimId !== claimId) return;
    log('human', `claim page shows: ${m.status}${m.reason ? ` (${m.reason})` : ''}`);
    if (m.status === 'claimed') {
      setTimeout(() => { log('human', 'plugging the watcher into power (VBUS up)'); evt('power', { on: true, charging: true }); }, 3000);
    }
    if (m.status === 'verified') { log('human', 'VERIFIED 🥒 — loop complete'); setTimeout(() => process.exit(0), 12_000); }
  });
}
