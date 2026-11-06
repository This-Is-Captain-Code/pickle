/**
 * Live World ID 4.0 verifier (IDKit). One action per bounty; backend-signed rp_context; proof forwarded
 * unchanged to World's v4 verifier; only a verifier-confirmed nullifier is returned.
 *
 * Packages: @worldcoin/idkit-core 4.6.0 (npm, 2026-11-06), `signRequest` from '@worldcoin/idkit-core/signing'.
 * Docs: docs.world.org/world-id/idkit/{integrate,signatures,javascript,credentials,error-codes}.
 */
import type { ClaimSession, HumanVerifier, VerifyFailureCode, VerifyOutcome } from '@pickle/shared';
import { IDKit, IDKitErrorCodes, proofOfHuman, type IDKitRequest, type IDKitResult } from '@worldcoin/idkit-core';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { computeAddress } from 'ethers';
import { ActionRegistry, bountyAction } from './actions.js';
import { verifyWithWorld, type BackendVerifyResult, type WorldEnvironment } from './verify.js';

export interface IdKitConfig {
  appId: string;
  rpId: string;
  /** 32-byte secp256k1 RP signing key (hex). SERVER ONLY — never logged, never sent to a client. */
  signingKeyHex: string;
  environment: WorldEnvironment;
  /** Developer Portal team API key for creating per-bounty actions. Optional if actions already exist. */
  portalApiKey?: string;
  /** Escrow address, used to scope action names to one deployment. */
  escrowAddress?: string;
  /** Max time to wait for the human in World App. Default 5 min (the RP signature TTL is 300 s). */
  timeoutMs?: number;
}

interface Pending {
  bountyId: string;
  action: string;
  signal: string;
  request: IDKitRequest;
  expiresAt: number;
  /** Raw client result, kept only so tests can replay/tamper it. Never trusted. */
  lastResult?: IDKitResult;
}

const ERROR_MAP: Record<string, VerifyFailureCode> = {
  user_rejected: 'user_rejected',
  verification_rejected: 'user_rejected',
  cancelled: 'cancelled',
  timeout: 'timeout',
  credential_unavailable: 'credential_unavailable',
  world_id_4_not_available: 'credential_unavailable',
  nullifier_replayed: 'nullifier_replayed',
  max_verifications_reached: 'nullifier_replayed',
};

export class IdKitVerifier implements HumanVerifier {
  private pending = new Map<string, Pending>();
  private registry?: ActionRegistry;

  constructor(private config: IdKitConfig) {
    const hex = config.signingKeyHex.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('World RP signing key must be 32 bytes of hex (64 chars)');
    if (config.portalApiKey) {
      this.registry = new ActionRegistry({ appId: config.appId, apiKey: config.portalApiKey, environment: config.environment });
    }
  }

  actionFor(bountyId: string): string {
    return bountyAction(bountyId, this.config.escrowAddress);
  }

  /** Address of our signing key (public). The key itself never leaves this class. */
  signerAddress(): string {
    const hex = this.config.signingKeyHex.startsWith('0x') ? this.config.signingKeyHex : `0x${this.config.signingKeyHex}`;
    return computeAddress(hex);
  }

  /**
   * Fail fast if our key isn't the one World has registered for this rp_id. Otherwise World App rejects every
   * request with `invalid_rp_signature`, but only after the human has scanned.
   */
  async preflight(): Promise<{ signer: string; registeredSigner: string; status: string }> {
    if (!this.registry) throw new Error('preflight needs WORLD_PORTAL_API_KEY');
    const reg = await this.registry.rpRegistration(this.config.rpId);
    const signer = this.signerAddress();
    if (!reg.signerAddress) throw new Error(`rp ${this.config.rpId}: portal shows no signer_address (status ${reg.status ?? 'unknown'})`);
    if (reg.status !== 'registered') throw new Error(`rp ${this.config.rpId} status is ${reg.status}, not registered`);
    if (reg.signerAddress.toLowerCase() !== signer.toLowerCase()) {
      throw new Error(`WORLD_RP_SIGNING_KEY is not this app's RP key: it signs as ${signer}, but World has ${reg.signerAddress} registered for ${this.config.rpId}`);
    }
    return { signer, registeredSigner: reg.signerAddress, status: reg.status };
  }

  /** Server-side RP signature for one request. The key never leaves this function. */
  private rpContext(action: string) {
    const s = signRequest({ signingKeyHex: this.config.signingKeyHex, action });
    return { rp_id: this.config.rpId, nonce: s.nonce, created_at: Number(s.createdAt), expires_at: Number(s.expiresAt), signature: s.sig };
  }

  async createClaimSession(bountyId: string, signal?: string): Promise<ClaimSession> {
    const action = this.actionFor(bountyId);
    const sig = signal ?? `pickle-bounty-${bountyId}`;
    if (this.registry) await this.registry.ensure(action, `Claim Pickle bounty #${bountyId}`);
    const request = await IDKit.request({
      app_id: this.config.appId as `app_${string}`,
      action,
      action_description: `Claim Pickle bounty #${bountyId}`,
      rp_context: this.rpContext(action),
      allow_legacy_proofs: false,
      environment: this.config.environment,
    }).preset(proofOfHuman({ signal: sig }));
    const expiresAt = Date.now() + (this.config.timeoutMs ?? 300_000);
    this.pending.set(request.requestId, { bountyId, action, signal: sig, request, expiresAt });
    return { requestId: request.requestId, connectorURI: request.connectorURI, expiresAt };
  }

  /** Waits for World App, then verifies on the backend. ok:true only after World's verifier says so. */
  async awaitOutcome(requestId: string): Promise<VerifyOutcome> {
    const p = this.pending.get(requestId);
    if (!p) return { ok: false, code: 'error', detail: 'unknown request id' };
    const completion = await p.request.pollUntilCompletion({ pollInterval: 2_000, timeout: Math.max(1_000, p.expiresAt - Date.now()) });
    if (!completion.success) {
      const err = String(completion.error);
      return { ok: false, code: ERROR_MAP[err] ?? (err === IDKitErrorCodes.Timeout ? 'timeout' : 'error'), detail: err };
    }
    p.lastResult = completion.result;
    const v = await this.verify(completion.result, p.action, p.signal);
    if (!v.ok) return { ok: false, code: ERROR_MAP[v.code] ?? 'error', detail: `${v.code}: ${v.detail}` };
    return { ok: true, nullifier: v.nullifier };
  }

  /** Forward a (possibly untrusted) result to World's verifier for this bounty's action. */
  verify(result: unknown, action: string, signal?: string): Promise<BackendVerifyResult> {
    return verifyWithWorld(result, {
      rpId: this.config.rpId,
      action,
      environment: this.config.environment,
      signalHash: signal === undefined ? undefined : String(hashSignal(signal)),
    });
  }

  /** For tests only: the last raw client result of a request (to replay or tamper with). */
  rawResult(requestId: string): IDKitResult | undefined {
    return this.pending.get(requestId)?.lastResult;
  }

  /** Action + signal a request was made for (tests replay results against them). */
  requestInfo(requestId: string): { action: string; signal: string } | undefined {
    const p = this.pending.get(requestId);
    return p && { action: p.action, signal: p.signal };
  }
}
