import type {
  ApprovalCheckpoint,
  ApprovalOutcome,
  ApprovalRequest,
  ApprovalSession,
} from '@pickle/shared';

export interface AgentPassConfig {
  clientId: string;
  /** worldidp_client_secret_... — backend only. */
  clientSecret: string;
  /** https://auth.world.org (or the sandbox issuer). */
  issuer: string;
}

/**
 * Live World ID Agent Pass (World IdP) integration — OWNED BY THE WORLD/0G DEV.
 * See world/README.md for the full brief.
 *
 * Sketch (device grant, RFC 8628 — fits our headless agent):
 *  - requestApproval: POST {issuer}/api/v1/device_authorization (scope=openid +
 *    client auth) → {device_code, user_code, verification_uri_complete,
 *    expires_in, interval}. Keep device_code server-side; return the rest.
 *  - awaitDecision: poll POST {issuer}/api/v1/token with
 *    grant_type=urn:ietf:params:oauth:grant-type:device_code, respecting
 *    `interval` (+5s on slow_down). Map: token → validate ID token (RS256 via
 *    jwks, iss, aud, acr policy) → 'approved'; access_denied → 'denied';
 *    expired_token → 'expired'. Device grant always forces fresh auth.
 *  - The device page shows no action terms — WE display req.summary next to
 *    the user code ourselves (that's part of the demo).
 */
export class AgentPassCheckpoint implements ApprovalCheckpoint {
  constructor(private config: AgentPassConfig) {}

  async requestApproval(_req: ApprovalRequest): Promise<ApprovalSession> {
    throw new Error('AgentPassCheckpoint not implemented yet — run with WORLD_MODE=mock');
  }

  async awaitDecision(_approvalId: string): Promise<ApprovalOutcome> {
    throw new Error('AgentPassCheckpoint not implemented yet — run with WORLD_MODE=mock');
  }
}
