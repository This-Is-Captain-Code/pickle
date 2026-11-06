import { ZeroGUnreachable, type Decision, type DecisionEngine, type DecisionRequest } from '@pickle/shared';
import type { ChatBackend } from './backend.js';
import { DirectBackend, TESTNET_RPC } from './direct.js';
import { DEFAULT_MODEL, ROUTER_MAINNET, RouterBackend, type ChatMessage } from './router.js';

export interface ZeroGComputeConfig {
  /**
   * 'direct' → 0G Compute Network on Galileo testnet via the broker SDK (wallet-paid).
   * 'router' → 0G Private Computer Router on mainnet (sk- API key).
   * Request ids, validation, retry and the never-fake/safe-stop rule are identical for both.
   */
  mode: 'router' | 'direct';
  /** Router: base URL (default https://router-api.0g.ai/v1) + sk- key. */
  routerBaseUrl?: string;
  routerApiKey?: string;
  /** Direct: Galileo RPC + funded wallet + provider address (default: the reachable testnet chatbot). */
  rpcUrl?: string;
  privateKey?: string;
  providerAddress?: string;
  /** Router: model id (default 0gm-1.0-35b-a3b). Direct: optional override of the provider's model. */
  model: string;
  /** Router: send verify_tee. Direct: reject responses whose TEE signature doesn't verify. */
  verifyTee?: boolean;
  /** Router: turn off reasoning for reasoning models (default true). */
  disableThinking?: boolean;
  timeoutMs?: number;
}

/** Explicit status a caller can surface when 0G is down. Never accompanied by a decision. */
export const UNAVAILABLE = 'UNAVAILABLE' as const;

export function buildBackend(c: ZeroGComputeConfig): ChatBackend {
  if (c.mode === 'direct') {
    return new DirectBackend({
      rpcUrl: c.rpcUrl || TESTNET_RPC,
      privateKey: c.privateKey ?? '',
      providerAddress: c.providerAddress,
      model: c.model || undefined,
      timeoutMs: c.timeoutMs,
      requireVerified: c.verifyTee === true,
    });
  }
  return new RouterBackend({
    baseUrl: c.routerBaseUrl || ROUTER_MAINNET,
    apiKey: c.routerApiKey ?? '',
    model: c.model || DEFAULT_MODEL,
    verifyTee: c.verifyTee ?? true,
    disableThinking: c.disableThinking ?? true,
    timeoutMs: c.timeoutMs,
  });
}

const SYSTEM_PROMPT =
  'You are the decision module of a robot. Reply with ONLY a JSON object, no prose, no code fences: ' +
  '{"choice": <one of the allowed options, copied exactly>, "reason": <one short sentence>}.';

function parseDecision(content: string, options: string[]): { choice: string; reason: string } | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (typeof obj.choice !== 'string' || typeof obj.reason !== 'string') return null;
    if (!options.includes(obj.choice)) return null;
    return { choice: obj.choice, reason: obj.reason };
  } catch {
    return null;
  }
}

/**
 * Live 0G Compute decision engine. Every Decision carries the real 0G request id.
 * On any failure — network, HTTP error, missing request id, or an answer that isn't one of
 * the options after one retry — it throws ZeroGUnreachable. It NEVER returns a made-up decision.
 */
export class ZeroGDecisionEngine implements DecisionEngine {
  readonly backend: ChatBackend;

  constructor(config: ZeroGComputeConfig, backend?: ChatBackend) {
    this.backend = backend ?? buildBackend(config);
  }

  async decide(req: DecisionRequest): Promise<Decision> {
    if (req.options.length === 0) throw new Error('DecisionRequest.options is empty');

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Robot: ${req.robotId}\nSituation (JSON): ${JSON.stringify(req.situation)}\n` +
          `Question: ${req.question}\nAllowed options: ${JSON.stringify(req.options)}`,
      },
    ];

    const tried: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.backend.chat(messages, { temperature: 0, max_tokens: 200 });
      tried.push(r.requestId);
      const parsed = parseDecision(r.content, req.options);
      if (parsed) {
        return { ...parsed, requestId: r.requestId, model: r.model, latencyMs: r.latencyMs, verified: r.teeVerified === true };
      }
    }
    throw new ZeroGUnreachable(`model output was not a valid option after retry (request ids ${tried.join(', ')})`);
  }
}
