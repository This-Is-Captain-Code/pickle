/**
 * Show an IDKit connector URI as a QR code: printed in the terminal and served on a local page
 * (http://localhost:<port>/) so it can be scanned from a laptop screen. The page contains only the
 * public connector URI and bounty info — never keys or proofs.
 */
import { createServer, type Server } from 'node:http';
import QRCode from 'qrcode';

export interface QrDisplay {
  url: string;
  update(title: string, connectorURI: string): Promise<void>;
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startQrDisplay(port = Number(process.env.WORLD_QR_PORT ?? 8799)): Promise<QrDisplay> {
  let title = 'Waiting for a claim…';
  let svg = '';
  let uri = '';
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Pickle claim</title>
<style>body{font-family:system-ui,sans-serif;background:#fff;color:#111;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center;padding:16px;max-width:520px}svg{width:min(80vw,420px);height:auto}code{word-break:break-all;font-size:12px;color:#555}</style></head>
<body><main><h1>${esc(title)}</h1>${svg || '<p>No active request.</p>'}<p>Scan with World App</p><code>${esc(uri)}</code></main></body></html>`);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://localhost:${port}/`,
    async update(t, connectorURI) {
      title = t;
      uri = connectorURI;
      svg = await QRCode.toString(connectorURI, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      console.log(await QRCode.toString(connectorURI, { type: 'terminal', small: true }));
      console.log(`  ${t}\n  QR also at http://localhost:${port}/  ·  link: ${connectorURI}\n`);
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
