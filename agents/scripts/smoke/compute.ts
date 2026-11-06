/**
 * smoke:compute — 0G Compute, two parts, each reported separately:
 *  1. TEXT decision through the real ZeroGDecisionEngine on the configured backend:
 *       ZEROG_COMPUTE_MODE=direct (default) → Galileo testnet broker SDK, wallet-paid
 *       ZEROG_COMPUTE_MODE=router            → mainnet Router, sk- key
 *     The choice must be one of the options.
 *  2. VISION on the mainnet Router (testnet has no image-capable model as of 2026-11-06):
 *     fixtures/red-square.png as a base64 data URL → the answer must say "red".
 * Prints backend, model, latency, 0G request id, response id, TEE flag and provider for each call.
 * Overall PASS needs both parts. `--text-only` skips vision (reported as SKIPPED, never as PASS).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODEL, ROUTER_MAINNET, RouterBackend, TESTNET_RPC, ZeroGDecisionEngine, type ZeroGComputeConfig } from '@pickle/zerog';
import { AGENTS_DIR, isMain, runSmoke } from './lib.ts';

const IMAGE = join(AGENTS_DIR, 'scripts/smoke/fixtures/red-square.png');

export function textConfig(): ZeroGComputeConfig {
  const mode = (process.env.ZEROG_COMPUTE_MODE || 'direct') as 'router' | 'direct';
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
  return routerConfig();
}

function routerConfig(): ZeroGComputeConfig {
  const routerBaseUrl = process.env.ZEROG_ROUTER_URL || ROUTER_MAINNET;
  if (routerBaseUrl.includes('testnet')) throw new Error(`ZEROG_ROUTER_URL is the testnet router (${routerBaseUrl}); use ${ROUTER_MAINNET}`);
  return {
    mode: 'router',
    routerBaseUrl,
    routerApiKey: process.env.ZEROG_ROUTER_KEY,
    model: process.env.ZEROG_MODEL || DEFAULT_MODEL,
    verifyTee: (process.env.ZEROG_VERIFY_TEE ?? '1') === '1',
  };
}

export function smokeCompute(opts: { noExit?: boolean; textOnly?: boolean } = {}) {
  return runSmoke('smoke:compute', async (log) => {
    const parts: string[] = [];
    let failed = '';

    // 1. Text decision on the configured backend
    try {
      const engine = new ZeroGDecisionEngine(textConfig());
      const options = ['post_physical_bounty', 'post_teleop_bounty', 'wait_and_retry', 'alert_owner'];
      const d = await engine.decide({
        robotId: 'smoke-bot',
        situation: { stuckReason: 'obstacle_in_path', detail: 'cable wrapped around left wheel; arms free', batteryPct: 61 },
        question: 'The robot cannot move. A human nearby could unwrap the cable. Choose the response.',
        options,
      });
      if (!options.includes(d.choice)) throw new Error(`choice "${d.choice}" not in options`);
      log(`TEXT   PASS backend=${engine.backend.kind} model=${d.model} latency=${d.latencyMs}ms requestId=${d.requestId} tee_verified=${d.verified} → ${d.choice} ("${d.reason}")`);
      parts.push(`text(${engine.backend.kind}) ${d.latencyMs}ms id=${d.requestId}`);
    } catch (e) {
      failed += `text: ${(e as Error).message}; `;
      log(`TEXT   FAIL ${(e as Error).message}`);
    }

    // 2. Vision on the mainnet Router
    if (opts.textOnly) {
      log('VISION SKIPPED (--text-only)');
      parts.push('vision SKIPPED');
    } else {
      try {
        const rc = routerConfig();
        const router = new RouterBackend({ baseUrl: rc.routerBaseUrl!, apiKey: rc.routerApiKey ?? '', model: rc.model, verifyTee: rc.verifyTee });
        const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`;
        const v = await router.chat(
          [{ role: 'user', content: [
            { type: 'text', text: 'What colour is the square in this image? Answer with one lowercase word.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          { temperature: 0, max_tokens: 20 },
        );
        const answer = v.content.trim();
        if (!/red/i.test(answer)) throw new Error(`expected "red", got "${answer}" (requestId ${v.requestId})`);
        log(`VISION PASS backend=router model=${v.model} latency=${v.latencyMs}ms requestId=${v.requestId} responseId=${v.responseId} tee_verified=${v.teeVerified} provider=${v.provider} → "${answer}"`);
        parts.push(`vision(router) ${v.latencyMs}ms id=${v.requestId}`);
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
