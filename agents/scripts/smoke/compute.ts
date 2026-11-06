/**
 * smoke:compute — 0G Private Computer Router (mainnet, decision D3).
 *  1. text: a real ZeroGDecisionEngine.decide() call → choice must be one of the options
 *  2. vision: send fixtures/red-square.png as a base64 data URL → answer must say "red"
 * Prints model, latency, 0G request id (x_0g_trace.request_id), response id, TEE flag and cost for each.
 *
 * Needs: ZEROG_ROUTER_KEY (sk-…) in agents/.env. Optional ZEROG_MANAGEMENT_KEY (mk-…) for balance.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODEL, ROUTER_MAINNET, ZeroGDecisionEngine, routerChat } from '@pickle/zerog';
import { AGENTS_DIR, isMain, runSmoke } from './lib.ts';

const IMAGE = join(AGENTS_DIR, 'scripts/smoke/fixtures/red-square.png');

function cfg() {
  const baseUrl = process.env.ZEROG_ROUTER_URL || ROUTER_MAINNET;
  const apiKey = process.env.ZEROG_ROUTER_KEY ?? '';
  const model = process.env.ZEROG_MODEL || DEFAULT_MODEL;
  const verifyTee = (process.env.ZEROG_VERIFY_TEE ?? '1') === '1';
  if (!apiKey || apiKey === 'sk-...') throw new Error('ZEROG_ROUTER_KEY not set in agents/.env');
  if (baseUrl.includes('testnet')) throw new Error(`ZEROG_ROUTER_URL is the testnet router (${baseUrl}); D3 = mainnet ${ROUTER_MAINNET}`);
  return { baseUrl, apiKey, model, verifyTee };
}

async function balance(baseUrl: string): Promise<string> {
  const mk = process.env.ZEROG_MANAGEMENT_KEY;
  if (!mk) return 'n/a (no ZEROG_MANAGEMENT_KEY)';
  try {
    const r = await fetch(`${baseUrl}/account/balance`, { headers: { authorization: `Bearer ${mk}` }, signal: AbortSignal.timeout(15_000) });
    const j: any = await r.json();
    return r.ok ? `${Number(BigInt(j.total_balance)) / 1e18} 0G` : `HTTP ${r.status}`;
  } catch (e) {
    return `error ${(e as Error).message}`;
  }
}

export function smokeCompute(opts: { noExit?: boolean } = {}) {
  return runSmoke('smoke:compute', async (log) => {
    const c = cfg();
    log(`router ${c.baseUrl} · model ${c.model} · verify_tee ${c.verifyTee} · balance ${await balance(c.baseUrl)}`);

    // 1. Text decision through the real engine (same code path the agents core uses)
    const engine = new ZeroGDecisionEngine({ mode: 'router', routerBaseUrl: c.baseUrl, routerApiKey: c.apiKey, model: c.model, verifyTee: c.verifyTee });
    const options = ['post_physical_bounty', 'post_teleop_bounty', 'wait_and_retry', 'alert_owner'];
    const d = await engine.decide({
      robotId: 'smoke-bot',
      situation: { stuckReason: 'obstacle_in_path', detail: 'cable wrapped around left wheel; arms free', batteryPct: 61 },
      question: 'The robot cannot move. A human nearby could unwrap the cable. Choose the response.',
      options,
    });
    if (!options.includes(d.choice)) throw new Error(`text: choice "${d.choice}" not in options`);
    log(`TEXT   model=${d.model} latency=${d.latencyMs}ms requestId=${d.requestId} tee_verified=${d.verified} → ${d.choice} ("${d.reason}")`);

    // 2. Vision call with a local image
    const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`;
    const v = await routerChat(
      { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, verifyTee: c.verifyTee },
      [{ role: 'user', content: [
        { type: 'text', text: 'What colour is the square in this image? Answer with one lowercase word.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] }],
      { temperature: 0, max_tokens: 20 },
    );
    const answer = v.content.trim();
    log(`VISION model=${v.model} latency=${v.latencyMs}ms requestId=${v.requestId} responseId=${v.responseId} tee_verified=${v.teeVerified} provider=${v.provider} cost=${v.costNeuron ?? '?'} neuron → "${answer}"`);
    if (!/red/i.test(answer)) throw new Error(`vision: expected "red", got "${answer}"`);

    return `text ${d.latencyMs}ms id=${d.requestId}; vision ${v.latencyMs}ms id=${v.requestId}`;
  }, opts);
}

if (isMain(import.meta.url)) await smokeCompute();
