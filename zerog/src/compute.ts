import { ZeroGUnreachable, type Decision, type DecisionEngine, type DecisionRequest } from '@pickle/shared';
import { DEFAULT_MODEL, ROUTER_MAINNET, routerChat, type ChatMessage, type RouterConfig } from './router.js';

export interface ZeroGComputeConfig {
  /** 'router' (OpenAI-compatible, API key). 'direct' (broker SDK) is not implemented — D3 chose router. */
  mode: 'router' | 'direct';
  /** Router base URL. Mainnet: https://router-api.0g.ai/v1 (decision D3). */
  routerBaseUrl?: string;
  routerApiKey?: string;
  /** Direct mode only (unused). */
  rpcUrl?: string;
  privateKey?: string;
  providerAddress?: string;
  /** Default 0gm-1.0-35b-a3b (TEE-attested, text + image). */
  model: string;
  /** Ask the Router to verify the TEE signature (`verify_tee: true`). Default true. */
  verifyTee?: boolean;
  timeoutMs?: number;
}

/** Explicit status a caller can surface when 0G is down. Never accompanied by a decision. */
export const UNAVAILABLE = 'UNAVAILABLE' as const;

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
 * Live 0G Compute decision engine (Router). Every Decision carries the real 0G request id.
 * On any failure — network, HTTP error, missing request id, or an answer that isn't one of
 * the options after one retry — it throws ZeroGUnreachable. It NEVER returns a made-up decision.
 */
export class ZeroGDecisionEngine implements DecisionEngine {
  private router: RouterConfig;

  constructor(private config: ZeroGComputeConfig) {
    this.router = {
      baseUrl: config.routerBaseUrl || ROUTER_MAINNET,
      apiKey: config.routerApiKey ?? '',
      model: config.model || DEFAULT_MODEL,
      verifyTee: config.verifyTee ?? true,
      timeoutMs: config.timeoutMs,
    };
  }

  async decide(req: DecisionRequest): Promise<Decision> {
    if (this.config.mode !== 'router') throw new ZeroGUnreachable(`compute mode "${this.config.mode}" not implemented`);
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
      const r = await routerChat(this.router, messages, { temperature: 0 });
      tried.push(r.requestId);
      const parsed = parseDecision(r.content, req.options);
      if (parsed) {
        return { ...parsed, requestId: r.requestId, model: r.model, latencyMs: r.latencyMs, verified: r.teeVerified === true };
      }
    }
    throw new ZeroGUnreachable(`model output was not a valid option after retry (request ids ${tried.join(', ')})`);
  }
}
