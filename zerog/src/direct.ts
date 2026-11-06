/**
 * 0G Compute Network "Direct" backend: wallet-paid inference on Galileo testnet via the broker SDK.
 * The same path 0G's own zerobot uses (sdk/src/ai/broker.ts).
 *
 * Sources (see docs/sponsors.md §2):
 *  - docs.0g.ai/developer-hub/building-on-0g/compute-network/inference: createZGComputeNetworkBroker,
 *    getServiceMetadata → getRequestHeaders → POST {endpoint}/chat/completions, ZG-Res-Key, processResponse
 *  - SDK 0.9.0 typings (lib.commonjs/inference/broker/broker.d.ts): processResponse(provider, chatID, usageJson)
 *  - Live testnet provider listing (zerog/scripts/list-testnet-services.ts, 2026-11-06): the only reachable
 *    chatbot is qwen/qwen3.8-omni-flash @ 0xd6269e…C940, text-only, STREAMING ONLY, 10 req/min, 2000 tok/min.
 *
 * Funding (ledger + provider sub-account) is NOT done here — it spends 0G, so it lives in the explicit
 * zerog/scripts/fund-testnet-compute.ts. If the account isn't funded, chat() throws ZeroGUnreachable.
 */
import { createRequire } from 'node:module';
import { JsonRpcProvider, Wallet } from 'ethers';
import { ZeroGUnreachable } from '@pickle/shared';
import type { ChatBackend, ChatResult } from './backend.js';
import type { ChatMessage } from './router.js';

type Sdk = typeof import('@0gfoundation/0g-compute-ts-sdk');
type Broker = Awaited<ReturnType<Sdk['createZGComputeNetworkBroker']>>;

/** The SDK's ESM build is broken in 0.9.0 ("does not provide an export named 'C'"); load the CommonJS build. */
export function loadComputeSdk(): Sdk {
  return createRequire(import.meta.url)('@0gfoundation/0g-compute-ts-sdk') as Sdk;
}

export const TESTNET_RPC = 'https://evmrpc-testnet.0g.ai';
/** qwen/qwen3.8-omni-flash, TeeML, the only reachable testnet chatbot on 2026-11-06. */
export const TESTNET_DEFAULT_PROVIDER = '0xd6269e257761705B9e442E59794703762DFcC940';

export interface DirectConfig {
  rpcUrl?: string;
  privateKey: string;
  providerAddress?: string;
  /** Override the provider's on-chain default model id. */
  model?: string;
  timeoutMs?: number;
  /** If true, a response whose TEE signature fails verification is rejected (ZeroGUnreachable). */
  requireVerified?: boolean;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 240);

export class DirectBackend implements ChatBackend {
  readonly kind = 'direct' as const;
  private broker?: Promise<Broker>;
  readonly providerAddress: string;

  constructor(private cfg: DirectConfig) {
    this.providerAddress = cfg.providerAddress || TESTNET_DEFAULT_PROVIDER;
  }

  private getBroker(): Promise<Broker> {
    if (!this.cfg.privateKey) return Promise.reject(new ZeroGUnreachable('direct mode: no wallet private key configured'));
    this.broker ??= (async () => {
      const wallet = new Wallet(this.cfg.privateKey, new JsonRpcProvider(this.cfg.rpcUrl || TESTNET_RPC));
      return loadComputeSdk().createZGComputeNetworkBroker(wallet);
    })().catch((e) => {
      this.broker = undefined; // allow a later retry
      throw new ZeroGUnreachable(`direct: broker init failed: ${errText(e)}`);
    });
    return this.broker;
  }

  async chat(messages: ChatMessage[], extra: Record<string, unknown> = {}): Promise<ChatResult> {
    const broker = await this.getBroker();
    const provider = this.providerAddress;

    let endpoint: string, model: string, headers: Record<string, string>;
    try {
      ({ endpoint, model } = await broker.inference.getServiceMetadata(provider, this.cfg.model));
      headers = (await broker.inference.getRequestHeaders(provider)) as unknown as Record<string, string>;
    } catch (e) {
      throw new ZeroGUnreachable(`direct: cannot prepare request for provider ${provider}: ${errText(e)}`);
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        // This provider is streaming-only; ask for usage in the final chunk so billing/verification can use it.
        body: JSON.stringify({ model, messages, ...extra, stream: true, stream_options: { include_usage: true } }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 60_000),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      throw new ZeroGUnreachable(`direct: network: ${err.name === 'TimeoutError' ? 'timeout' : err.cause?.code ?? err.message}`);
    }

    const resKey = res.headers.get('zg-res-key') ?? undefined;
    if (!res.ok || !res.body) {
      const body = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
      throw new ZeroGUnreachable(`direct: HTTP ${res.status} from provider ${provider}: ${body}`);
    }

    // Parse the SSE stream: "data: {...}\n\n" … "data: [DONE]"
    let content = '';
    let completionId: string | undefined;
    let usage: Record<string, unknown> | undefined;
    let respModel = model;
    try {
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          const j = JSON.parse(data);
          if (j.error) throw new Error(`stream error: ${JSON.stringify(j.error).slice(0, 160)}`);
          completionId ??= j.id;
          if (j.model) respModel = j.model;
          content += j.choices?.[0]?.delta?.content ?? '';
          if (j.usage) usage = j.usage;
        }
      }
    } catch (e) {
      throw new ZeroGUnreachable(`direct: stream failed: ${errText(e)}`);
    }
    const latencyMs = Date.now() - started;

    const requestId = resKey ?? completionId;
    if (!content) throw new ZeroGUnreachable('direct: provider returned no content');
    if (!requestId) throw new ZeroGUnreachable('direct: response has no ZG-Res-Key header or completion id');

    // TEE signature check + fee caching (SDK: chatID = ZG-Res-Key || completion.id, content = usage JSON).
    let teeVerified: boolean | undefined;
    try {
      const v = await broker.inference.processResponse(provider, requestId, usage ? JSON.stringify(usage) : undefined);
      teeVerified = v === null ? undefined : v;
    } catch (e) {
      teeVerified = false;
      if (this.cfg.requireVerified) throw new ZeroGUnreachable(`direct: TEE verification error: ${errText(e)}`);
    }
    if (this.cfg.requireVerified && teeVerified !== true) throw new ZeroGUnreachable('direct: TEE signature not verified');

    return { content, requestId, responseId: completionId, model: respModel, latencyMs, provider, teeVerified, usage, backend: 'direct' };
  }
}
