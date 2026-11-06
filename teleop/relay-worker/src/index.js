const enc = new TextEncoder();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export class Room {
  constructor(state) {
    this.state      = state;
    this.wsSessions = new Set();
    this.sseWriters = new Set();
    this.latest     = null;
    this._lastWrite = 0;

    // Restore the last known frame from persistent storage on cold start
    this.state.blockConcurrencyWhile(async () => {
      this.latest = (await this.state.storage.get('latest')) ?? null;
    });
  }

  push(raw) {
    try { this.latest = JSON.parse(raw); } catch {}

    // Persist to storage at most once per second so curl always has fresh data
    const now = Date.now();
    if (now - this._lastWrite > 1000) {
      this._lastWrite = now;
      this.state.storage.put('latest', this.latest).catch(() => {});
    }

    // Broadcast to WebSocket peers
    for (const ws of this.wsSessions) {
      if (ws.readyState === 1) ws.send(raw);
    }

    // Push to SSE subscribers
    const chunk = enc.encode(`data: ${raw}\n\n`);
    for (const w of [...this.sseWriters]) {
      w.write(chunk).catch(() => this.sseWriters.delete(w));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── WebSocket (Spectacles sender) ──────────────────────────────────────
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this.wsSessions.add(server);
      server.addEventListener('message', ({ data }) => this.push(data));
      const drop = () => this.wsSessions.delete(server);
      server.addEventListener('close', drop);
      server.addEventListener('error', drop);
      return new Response(null, { status: 101, webSocket: client });
    }

    // ── SSE stream  GET /default/stream ───────────────────────────────────
    if (url.pathname.endsWith('/stream')) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      this.sseWriters.add(writer);

      if (this.latest) {
        writer.write(enc.encode(`data: ${JSON.stringify(this.latest)}\n\n`));
      }

      return new Response(readable, {
        headers: {
          ...CORS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // ── REST snapshot  GET /default ───────────────────────────────────────
    const body = this.latest
      ? JSON.stringify(this.latest, null, 2)
      : JSON.stringify({ status: 'no data yet', hint: 'Open pinch-beige.vercel.app on Spectacles first.' });

    return new Response(body, {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const parts  = url.pathname.replace(/^\/+/, '').split('/');
    const roomId = parts[0] || 'default';
    const id     = env.ROOMS.idFromName(roomId);
    return env.ROOMS.get(id).fetch(request);
  },
};
