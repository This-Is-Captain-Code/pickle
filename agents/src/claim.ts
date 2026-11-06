/**
 * Bounty claim gated by World ID 4.0:
 *   IDKit QR (per-bounty action) → human approves in World App → backend forwards the proof unchanged to
 *   World's v4 verifier → humanHash = keccak256(nullifier) → PickleEscrow.claim(bountyId, worker, humanHash).
 *
 * The client result is never trusted: no claim is sent unless World's verifier returned success.
 * One human per bounty is enforced on-chain (hasClaimed[bountyId][humanHash], never cleared); a duplicate
 * is caught by a view call and again by sendTx's pre-send simulation, so nothing is sent.
 */
import type { Wallet } from 'ethers';
import type { IdKitVerifier } from '@pickle/world';
import { humanHashFromNullifier } from '@pickle/world';
import type { Escrow } from './escrow.js';
import type { QrDisplay } from './qr.js';

export type ClaimOutcome =
  | { status: 'claimed'; bountyId: bigint; humanHash: string; txHash: string; requestId: string }
  | { status: 'verification_failed'; bountyId: bigint; code: string; detail?: string; requestId: string }
  | { status: 'refused_duplicate'; bountyId: bigint; humanHash: string; detail: string; requestId: string };

export async function claimWithWorldId(opts: {
  verifier: IdKitVerifier;
  escrow: Escrow;
  agent: Wallet;
  bountyId: bigint;
  worker: string;
  qr?: QrDisplay;
  label?: string;
}): Promise<ClaimOutcome> {
  const { verifier, escrow, agent, bountyId, worker } = opts;
  const session = await verifier.createClaimSession(bountyId.toString(), worker);
  await opts.qr?.update(opts.label ?? `Claim bounty #${bountyId}`, session.connectorURI);

  const outcome = await verifier.awaitOutcome(session.requestId);
  if (!outcome.ok) {
    return { status: 'verification_failed', bountyId, code: outcome.code, detail: outcome.detail, requestId: session.requestId };
  }

  // Verified by World. Derive the on-chain identity from the VERIFIER's nullifier.
  const hHash = humanHashFromNullifier(outcome.nullifier);
  if (await escrow.read.hasClaimed(bountyId, hHash)) {
    return { status: 'refused_duplicate', bountyId, humanHash: hHash, detail: 'HumanAlreadyClaimed (hasClaimed view)', requestId: session.requestId };
  }
  try {
    const r = await escrow.claim(agent, bountyId, worker, hHash, { walletName: 'AGENT_G1' });
    return { status: 'claimed', bountyId, humanHash: hHash, txHash: r.hash, requestId: session.requestId };
  } catch (e) {
    const msg = (e as Error).message;
    if (/HumanAlreadyClaimed/.test(msg)) {
      return { status: 'refused_duplicate', bountyId, humanHash: hHash, detail: msg, requestId: session.requestId };
    }
    throw e;
  }
}
