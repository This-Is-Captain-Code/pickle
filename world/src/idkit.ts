import type { ClaimSession, HumanVerifier, VerifyOutcome } from '@pickle/shared';

export interface IdKitConfig {
  appId: string; // app_... from https://developer.world.org
  rpId: string; // rp_...
  /** RP signing key — backend only, never ships to a client. */
  signingKeyHex: string;
  /** 'staging' + https://simulator.worldcoin.org for demos without Orb users. */
  environment: 'production' | 'staging';
}

/**
 * Live IDKit integration — OWNED BY THE WORLD/0G DEV. See world/README.md
 * for the full integration brief (endpoints, flow, failure codes).
 *
 * Sketch:
 *  - createClaimSession: signRequest({signingKeyHex, action: `claim-bounty-<id>`, ttl})
 *    from @worldcoin/idkit-core/signing, then IDKit.request({app_id, action,
 *    rp_context, ...}).preset(proofOfHuman({signal})) → return connectorURI.
 *  - awaitOutcome: request.pollUntilCompletion(), then POST the result to
 *    https://developer.world.org/api/v4/verify/{rp_id}, check success +
 *    environment, convert nullifier to decimal, reject replays via a
 *    UNIQUE(nullifier, action) store.
 */
export class IdKitVerifier implements HumanVerifier {
  constructor(private config: IdKitConfig) {}

  async createClaimSession(_bountyId: string, _signal?: string): Promise<ClaimSession> {
    throw new Error('IdKitVerifier not implemented yet — run with WORLD_MODE=mock');
  }

  async awaitOutcome(_requestId: string): Promise<VerifyOutcome> {
    throw new Error('IdKitVerifier not implemented yet — run with WORLD_MODE=mock');
  }
}
