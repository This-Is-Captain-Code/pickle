/**
 * 0G Private Computer Router client (OpenAI-compatible chat completions).
 *
 * Sources (see docs/sponsors.md §2):
 *  - Base URL + auth header: docs.0g.ai/.../compute-network/router/overview, /router/authentication
 *  - Request id `x_0g_trace.request_id`, `verify_tee`: /router/features/chat-completions
 *  - Vision content parts (`image_url` data URL): /router/features/image-inputs
 *  - Error codes (402 insufficient_balance, 429 Retry-After, 502, 503): /router/errors
 *
 * Contract: any failure to obtain a real model answer throws ZeroGUnreachable with the reason.
 * Nothing in here ever invents a response.
 */
import { ZeroGUnreachable } from '@pickle/shared';

export const ROUTER_MAINNET = 'https://router-api.0g.ai/v1';
export const DEFAULT_MODEL = '0gm-1.0-35b-a3b';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface RouterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Ask the Router to verify the provider's TEE signature synchronously. */
  verifyTee?: boolean;
  timeoutMs?: number;
  /** Retries for transient failures (network, 429, 5xx). Default 1. */
  retries?: number;
}

export interface RouterResult {
  content: string;
  /** Canonical 0G request id (`x_0g_trace.request_id`). */
  requestId: string;
  /** OpenAI-style response `id` (kept alongside; docs don't say it equals request_id). */
  responseId?: string;
  model: string;
  latencyMs: number;
  provider?: string;
  teeVerified?: boolean;
  costNeuron?: string;
  usage?: Record<string, unknown>;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function routerChat(cfg: RouterConfig, messages: ChatMessage[], extra: Record<string, unknown> = {}): Promise<RouterResult> {
  if (!cfg.apiKey || cfg.apiKey === 'sk-...') throw new ZeroGUnreachable('no 0G Router API key configured');
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({ model: cfg.model, messages, ...(cfg.verifyTee ? { verify_tee: true } : {}), ...extra });
  const retries = cfg.retries ?? 1;
  let lastErr = 'unknown error';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; errors?: { code?: string }[] } };
      const code = e.cause?.code ?? e.cause?.errors?.[0]?.code;
      lastErr = `network: ${e.name === 'TimeoutError' ? 'timeout' : (code ?? e.message)}`;
      if (attempt < retries) { await sleep(1000); continue; }
      throw new ZeroGUnreachable(lastErr);
    }
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }

    if (!res.ok) {
      const code = json?.error?.code ?? json?.error?.type ?? 'unknown';
      const ids = [json?.request_id && `request_id=${json.request_id}`, res.headers.get('x-request-id') && `x-request-id=${res.headers.get('x-request-id')}`]
        .filter(Boolean).join(' ');
      const msg = typeof json?.error?.message === 'string' ? ` "${json.error.message.slice(0, 160)}"` : '';
      lastErr = `HTTP ${res.status} ${code}${msg}${ids ? ` (${ids})` : ''}`;
      if (TRANSIENT.has(res.status) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 1500);
        continue;
      }
      throw new ZeroGUnreachable(lastErr);
    }

    const content = json?.choices?.[0]?.message?.content;
    const trace = json?.x_0g_trace ?? {};
    const requestId: string | undefined = trace.request_id ?? json?.id;
    if (typeof content !== 'string' || content.length === 0) throw new ZeroGUnreachable('Router returned no message content');
    if (!requestId) throw new ZeroGUnreachable('Router response has no request id');
    return {
      content,
      requestId,
      responseId: json?.id,
      model: json?.model ?? cfg.model,
      latencyMs,
      provider: typeof trace.provider === 'string' ? trace.provider : trace.provider?.address ?? trace.provider?.name,
      teeVerified: trace.tee_verified,
      costNeuron: trace.billing?.total_cost?.toString(),
      usage: json?.usage,
    };
  }
  throw new ZeroGUnreachable(lastErr);
}
