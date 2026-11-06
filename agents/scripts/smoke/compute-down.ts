/**
 * smoke:compute-down — 0G unreachable must yield UNAVAILABLE + safe-stop, never a decision.
 *
 * Runs the REAL ZeroGDecisionEngine, on BOTH backends, against endpoints that cannot answer:
 *  router: closed local port, unresolvable host, a local server answering 503 no_available_provider
 *  direct: Galileo RPC on a closed port, unresolvable RPC host (broker can't initialise)
 * For each: decideOrSafeStop() must return status UNAVAILABLE, the safe-stop hook must fire exactly once,
 * and no Decision object may be produced. No API key or network access to 0G is needed.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZeroGDecisionEngine, type ZeroGComputeConfig } from '@pickle/zerog';
import { decideOrSafeStop } from '../../src/decide.ts';
import { isMain, runSmoke } from './lib.ts';

export function smokeComputeDown(opts: { noExit?: boolean } = {}) {
  return runSmoke('smoke:compute-down', async (log) => {
    const srv = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'no_available_provider', message: 'mock outage' }, request_id: 'req_mock503' }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port503 = (srv.address() as AddressInfo).port;

    // A throwaway, unfunded key for the direct cases — nothing is ever sent from it.
    const dummyKey = '0x' + '11'.repeat(32);
    const cases: [string, ZeroGComputeConfig][] = [
      ['router: conn refused', { mode: 'router', routerBaseUrl: 'http://127.0.0.1:9/v1', routerApiKey: 'sk-smoke-dummy', model: '0gm-1.0-35b-a3b', timeoutMs: 5000 }],
      ['router: DNS failure', { mode: 'router', routerBaseUrl: 'https://router.invalid/v1', routerApiKey: 'sk-smoke-dummy', model: '0gm-1.0-35b-a3b', timeoutMs: 5000 }],
      ['router: HTTP 503', { mode: 'router', routerBaseUrl: `http://127.0.0.1:${port503}/v1`, routerApiKey: 'sk-smoke-dummy', model: '0gm-1.0-35b-a3b', timeoutMs: 5000 }],
      ['direct: RPC down', { mode: 'direct', rpcUrl: 'http://127.0.0.1:9', privateKey: dummyKey, model: '', timeoutMs: 5000 }],
      ['direct: RPC DNS', { mode: 'direct', rpcUrl: 'https://rpc.invalid', privateKey: dummyKey, model: '', timeoutMs: 5000 }],
    ];

    try {
      for (const [label, cfg] of cases) {
        const engine = new ZeroGDecisionEngine(cfg);
        const stops: string[] = [];
        const out = await decideOrSafeStop(
          engine,
          { robotId: 'smoke-bot', situation: { stuck: true }, question: 'Choose.', options: ['a', 'b'] },
          (robotId, reason) => { stops.push(`${robotId}: ${reason}`); },
        );
        if (out.status !== 'UNAVAILABLE') throw new Error(`${label}: expected UNAVAILABLE, got a decision ${JSON.stringify(out)}`);
        if ('decision' in out) throw new Error(`${label}: a decision object leaked`);
        if (stops.length !== 1) throw new Error(`${label}: safe-stop fired ${stops.length} times`);
        log(`${label.padEnd(18)} → ${out.status}, safe-stop fired (${out.reason})`);
      }
    } finally {
      srv.close();
    }
    return `all ${cases.length} outage modes → UNAVAILABLE + safe-stop, no decision returned`;
  }, opts);
}

if (isMain(import.meta.url)) await smokeComputeDown();
