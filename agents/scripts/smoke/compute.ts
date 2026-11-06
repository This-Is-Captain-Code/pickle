/**
 * smoke:compute — 0G Compute, two parts, each reported separately:
 *  1. TEXT decision through the real ZeroGDecisionEngine on the configured backend:
 *       ZEROG_COMPUTE_MODE=router (current) → mainnet Router, model ZEROG_MODEL (default 0gm-1.0-35b-a3b, TEE)
 *       ZEROG_COMPUTE_MODE=direct            → Galileo testnet broker SDK (shelved: provider needs 1 0G reserve)
 *     The choice must be one of the options.
 *  2. VISION on the Router, model ZEROG_VISION_MODEL (default 0gm-1.0-35b-a3b, TEE, text+image):
 *     fixtures/red-square.png as a base64 data URL → the answer must say "red".
 * Keys: ZEROG_ROUTER_KEY (Private/TEE trust mode). If a call fails because the model isn't served in that
 * trust mode, it is retried ONCE with ZEROG_ROUTER_KEY_STANDARD (if set) and the result is labelled STANDARD.
 * Prints per call: key/trust mode, model, latency, 0G request id, x-request-id, e2ee header, tee_verified, cost (µUSD).
 * Overall PASS needs both parts. `--text-only` skips vision (reported as SKIPPED, never as PASS).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZeroGUnreachable, type Decision } from '@pickle/shared';
import {
  DEFAULT_MODEL, ROUTER_MAINNET, RouterBackend, TESTNET_RPC, ZeroGDecisionEngine,
  type ChatBackend, type ChatResult, type ZeroGComputeConfig,
} from '@pickle/zerog';
import { AGENTS_DIR, isMain, runSmoke } from './lib.ts';

const IMAGE = join(AGENTS_DIR, 'scripts/smoke/fixtures/red-square.png');

export function textConfig(apiKey = process.env.ZEROG_ROUTER_KEY): ZeroGComputeConfig {
  const mode = (process.env.ZEROG_COMPUTE_MODE || 'router') as 'router' | 'direct';
  if (mode === 'direct') {
    return {
      mode,
      rpcUrl: process.env.ZEROG_RPC_URL || TESTNET_RPC,
      // Own wallet for the compute ledger; never the deployer (other processes send from it concurrently).
      privateKey: process.env.COMPUTE_WALLET_PRIVATE_KEY,
      providerAddress: process.env.ZEROG_PROVIDER_ADDRESS || undefined,
      model: process.env.ZEROG_DIRECT_MODEL || '',
      verifyTee: process.env.ZEROG_DIRECT_REQUIRE_TEE === '1',
    };
  }
  return routerConfig(apiKey, process.env.ZEROG_MODEL || DEFAULT_MODEL);
}

function routerConfig(apiKey: string | undefined, model: string): ZeroGComputeConfig {
  const routerBaseUrl = process.env.ZEROG_ROUTER_URL || ROUTER_MAINNET;
  if (routerBaseUrl.includes('testnet')) throw new Error(`ZEROG_ROUTER_URL is the testnet router (${routerBaseUrl}); use ${ROUTER_MAINNET}`);
  return { mode: 'router', routerBaseUrl, routerApiKey: apiKey, model, verifyTee: (process.env.ZEROG_VERIFY_TEE ?? '1') === '1' };
}

/** Errors that mean "this model isn't available under this key's trust mode" → worth one STANDARD retry. */
const TRUST_MODE_ERROR = /no_available_provider|trust|private|tee|not available|model_not_found|unsupported/i;

async function withStandardFallback<T>(label: string, log: (m: string) => void, run: (key: string, tag: string) => Promise<T>): Promise<{ value: T; tag: string }> {
  try {
    return { value: await run(process.env.ZEROG_ROUTER_KEY ?? '', 'TEE key'), tag: 'TEE key' };
  } catch (e) {
    const std = process.env.ZEROG_ROUTER_KEY_STANDARD;
    if (!(e instanceof ZeroGUnreachable) || !std || !TRUST_MODE_ERROR.test(e.message)) throw e;
    log(`${label}: TEE key failed (${e.message.slice(0, 120)}) → retrying this call with the STANDARD key`);
    return { value: await run(std, 'STANDARD key (fallback)'), tag: 'STANDARD key (fallback)' };
  }
}

const fmt = (r: Pick<ChatResult, 'model' | 'latencyMs' | 'requestId' | 'xRequestId' | 'e2ee' | 'teeVerified' | 'costUsdMicro'>) =>
  `model=${r.model} latency=${r.latencyMs}ms requestId=${r.requestId} x-request-id=${r.xRequestId ?? '-'} e2ee=${r.e2ee ?? '-'} tee_verified=${r.teeVerified ?? 'not returned'} cost=${r.costUsdMicro ?? '?'}µUSD`;

/** Wraps a backend so the decision test can also report the raw call's trace fields. */
class Recording implements ChatBackend {
  readonly kind = 'router' as const;
  last?: ChatResult;
  constructor(private inner: ChatBackend) {}
  async chat(...a: Parameters<ChatBackend['chat']>) { this.last = await this.inner.chat(...a); return this.last; }
}

export function smokeCompute(opts: { noExit?: boolean; textOnly?: boolean } = {}) {
  return runSmoke('smoke:compute', async (log) => {
    const parts: string[] = [];
    let failed = '';
    const mode = (process.env.ZEROG_COMPUTE_MODE || 'router') as 'router' | 'direct';

    // 1. Text decision
    try {
      const options = ['post_physical_bounty', 'post_teleop_bounty', 'wait_and_retry', 'alert_owner'];
      const req = {
        robotId: 'smoke-bot',
        situation: { stuckReason: 'obstacle_in_path', detail: 'cable wrapped around left wheel; arms free', batteryPct: 61 },
        question: 'The robot cannot move. A human nearby could unwrap the cable. Choose the response.',
        options,
      };
      if (mode === 'direct') {
        const d = await new ZeroGDecisionEngine(textConfig()).decide(req);
        log(`TEXT   PASS backend=direct model=${d.model} latency=${d.latencyMs}ms requestId=${d.requestId} tee_verified=${d.verified} → ${d.choice}`);
        parts.push(`text(direct) ${d.latencyMs}ms id=${d.requestId}`);
      } else {
        const { value: [d, raw], tag } = await withStandardFallback('TEXT', log, async (key) => {
          const cfg = textConfig(key);
          const rec = new Recording(new RouterBackend({ baseUrl: cfg.routerBaseUrl!, apiKey: key, model: cfg.model, verifyTee: cfg.verifyTee, disableThinking: true }));
          const dec: Decision = await new ZeroGDecisionEngine(cfg, rec).decide(req);
          return [dec, rec.last!] as const;
        });
        if (!options.includes(d.choice)) throw new Error(`choice "${d.choice}" not in options`);
        log(`TEXT   PASS [${tag}] ${fmt(raw)} → ${d.choice} ("${d.reason}")`);
        parts.push(`text ${raw.model} [${tag}] ${raw.latencyMs}ms id=${raw.requestId} ${raw.costUsdMicro ?? '?'}µUSD`);
      }
    } catch (e) {
      failed += `text: ${(e as Error).message}; `;
      log(`TEXT   FAIL ${(e as Error).message}`);
    }

    // 2. Vision (Router)
    if (opts.textOnly) {
      log('VISION SKIPPED (--text-only)');
      parts.push('vision SKIPPED');
    } else {
      try {
        const model = process.env.ZEROG_VISION_MODEL || DEFAULT_MODEL;
        const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`;
        const { value: v, tag } = await withStandardFallback('VISION', log, (key) => {
          const rc = routerConfig(key, model);
          return new RouterBackend({ baseUrl: rc.routerBaseUrl!, apiKey: key, model, verifyTee: rc.verifyTee, disableThinking: true }).chat(
            [{ role: 'user', content: [
              { type: 'text', text: 'What colour is the square in this image? Answer with one lowercase word.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ] }],
            { temperature: 0, max_tokens: 20 },
          );
        });
        const answer = v.content.trim();
        if (!/red/i.test(answer)) throw new Error(`expected "red", got "${answer}" (requestId ${v.requestId})`);
        log(`VISION PASS [${tag}] ${fmt(v)} → "${answer}"`);
        parts.push(`vision ${v.model} [${tag}] ${v.latencyMs}ms id=${v.requestId} ${v.costUsdMicro ?? '?'}µUSD`);
      } catch (e) {
        failed += `vision: ${(e as Error).message}; `;
        log(`VISION FAIL ${(e as Error).message}`);
      }
    }

    if (failed) throw new Error(failed.trim());
    return parts.join('; ');
  }, opts);
}

if (isMain(import.meta.url)) await smokeCompute({ textOnly: process.argv.includes('--text-only') });
