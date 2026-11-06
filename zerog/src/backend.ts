/**
 * One interface for every 0G Compute path, so the decision engine, request-id logging and safe-stop
 * behave identically whichever provider is configured:
 *   - 'router' → 0G Private Computer Router (mainnet, API key)       zerog/src/router.ts
 *   - 'direct' → 0G Compute Network via the broker SDK (testnet, wallet-paid)   zerog/src/direct.ts
 *
 * Rule for every backend: on ANY failure to get a real model answer, throw ZeroGUnreachable.
 * A backend never invents content.
 */
import type { ChatMessage } from './router.js';

export interface ChatResult {
  content: string;
  /** Canonical 0G request id. Router: x_0g_trace.request_id. Direct: ZG-Res-Key header (else completion id). */
  requestId: string;
  /** OpenAI-style completion `id`, kept alongside. */
  responseId?: string;
  model: string;
  latencyMs: number;
  /** Router: provider name/address from x_0g_trace. Direct: provider wallet address. */
  provider?: string;
  /** Router: x_0g_trace.tee_verified. Direct: broker.inference.processResponse() result. */
  teeVerified?: boolean;
  costNeuron?: string;
  usage?: Record<string, unknown>;
  backend: 'router' | 'direct';
}

export interface ChatBackend {
  readonly kind: 'router' | 'direct';
  chat(messages: ChatMessage[], extra?: Record<string, unknown>): Promise<ChatResult>;
}
