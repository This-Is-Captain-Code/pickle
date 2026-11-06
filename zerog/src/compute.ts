import type { Decision, DecisionEngine, DecisionRequest } from '@pickle/shared';

export interface ZeroGComputeConfig {
  /** 'router' (OpenAI-compatible, API key) or 'direct' (wallet-signed, TEE-verifiable). */
  mode: 'router' | 'direct';
  /** Router: https://router-api-testnet.integratenetwork.work/v1 + sk- key. */
  routerBaseUrl?: string;
  routerApiKey?: string;
  /** Direct: Galileo RPC + funded wallet for @0gfoundation/0g-compute-ts-sdk. */
  rpcUrl?: string;
  privateKey?: string;
  providerAddress?: string;
  model: string;
}

/**
 * Live 0G Compute decision engine — OWNED BY THE WORLD/0G DEV. See
 * zerog/README.md for the full brief. The Mumbai decision-agent prompt
 * pattern (pick one option + one-line reason, validated JSON, strict schema)
 * is the shape to reproduce here.
 *
 * Contract (from @pickle/shared):
 *  - decide() returns Decision with a REAL 0G requestId per call
 *    (Direct: ZG-Res-Key header; Router: response body id).
 *  - On any 0G failure: throw ZeroGUnreachable. NEVER return a made-up
 *    decision — a faked fallback disqualifies us from the track.
 *  - Direct mode: optionally broker.inference.processResponse(provider, chatID)
 *    → set decision.verified = true. That's the judge-facing TEE story.
 */
export class ZeroGDecisionEngine implements DecisionEngine {
  constructor(private config: ZeroGComputeConfig) {}

  async decide(_req: DecisionRequest): Promise<Decision> {
    throw new Error('ZeroGDecisionEngine not implemented yet — run with ZEROG_MODE=mock');
  }
}
