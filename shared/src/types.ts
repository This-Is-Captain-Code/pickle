// ──────────────────────────────────────────────────────────────────────────
// The contract between Pickle's packages. agents/ consumes these interfaces;
// world/ and zerog/ implement them (each ships a mock + a live version).
// Changing a signature here is an API break for the other dev — coordinate.
// ──────────────────────────────────────────────────────────────────────────

// ─── Bounty lifecycle ─────────────────────────────────────────────────────

export type BountyKind = 'physical' | 'teleop' | 'robot';

export type BountyState =
  | 'open'
  | 'claimed'
  | 'verifying'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'denied';

export interface Bounty {
  id: string;
  kind: BountyKind;
  robotId: string;
  title: string;
  /** Why the robot is stuck / what it needs. */
  reason: string;
  /** Payout in wei (MON on Monad testnet), decimal string. */
  payoutWei: string;
  state: BountyState;
  /** World ID nullifier of the human who claimed it (one human, one claim). */
  nullifier?: string;
  createdAt: number;
  expiresAt: number;
  tx?: { post?: string; settle?: string };
}

// ─── World: human identity & approval (world/ implements) ────────────────

export interface ClaimSession {
  requestId: string;
  /** Render as a QR code (robot screen or Spectacles view); opens World App. */
  connectorURI: string;
  expiresAt: number;
}

export type VerifyFailureCode =
  | 'user_rejected'
  | 'cancelled'
  | 'timeout'
  | 'credential_unavailable'
  | 'nullifier_replayed'
  | 'error';

export type VerifyOutcome =
  | { ok: true; nullifier: string }
  | { ok: false; code: VerifyFailureCode; detail?: string };

/**
 * IDKit: proves the claimant is a unique human before a bounty claim.
 * Action is scoped per bounty (`claim-bounty-<bountyId>`), so the nullifier
 * enforces one-claim-per-human-per-bounty. Server-side verification and
 * nullifier replay rejection are the implementation's job, not the caller's.
 */
export interface HumanVerifier {
  createClaimSession(bountyId: string, signal?: string): Promise<ClaimSession>;
  /** Resolves only after server-side verify + nullifier uniqueness check. */
  awaitOutcome(requestId: string): Promise<VerifyOutcome>;
}

export interface ApprovalRequest {
  /** Machine-readable action, e.g. 'settle-bounty'. */
  action: string;
  /** Human-readable summary the approver sees alongside the user code. */
  summary: string;
  amountWei?: string;
}

export interface ApprovalSession {
  approvalId: string;
  /** RFC 8628 user code the human enters / confirms. */
  userCode: string;
  /** Where the human goes to authenticate (verification_uri_complete). */
  verificationUri: string;
  expiresAt: number;
}

export type ApprovalOutcome = 'approved' | 'denied' | 'expired' | 'error';

/**
 * World ID Agent Pass (World IdP): a human checkpoint before a protected
 * agent action (payouts above threshold). Fresh authentication each time.
 */
export interface ApprovalCheckpoint {
  requestApproval(req: ApprovalRequest): Promise<ApprovalSession>;
  awaitDecision(approvalId: string): Promise<ApprovalOutcome>;
}

// ─── 0G: decisions & episode log (zerog/ implements) ─────────────────────

export interface DecisionRequest {
  robotId: string;
  /** Telemetry snapshot the model decides on (stuck reason, qpos, contacts…). */
  situation: Record<string, unknown>;
  question: string;
  /** The model must pick exactly one. */
  options: string[];
}

export interface Decision {
  choice: string;
  reason: string;
  /** 0G response id (ZG-Res-Key / body id). Required per decision by the track. */
  requestId: string;
  model: string;
  latencyMs: number;
  /** True when the TEE signature was verified (0G Direct path). */
  verified?: boolean;
}

/** Thrown when 0G cannot be reached. agents/ catches it and safe-stops. */
export class ZeroGUnreachable extends Error {
  constructor(detail?: string) {
    super(`0G unreachable${detail ? `: ${detail}` : ''}`);
    this.name = 'ZeroGUnreachable';
  }
}

/**
 * 0G Compute inside the decision loop. Implementations must NOT fabricate a
 * decision on failure (track disqualifier) — throw ZeroGUnreachable instead.
 */
export interface DecisionEngine {
  decide(req: DecisionRequest): Promise<Decision>;
}

export interface EpisodeRecord {
  ts: number;
  robotId: string;
  bountyId?: string;
  decision: Decision;
  situation: Record<string, unknown>;
}

export interface EpisodeReceipt {
  /** 0G Storage merkle root — the content id needed to retrieve the record. */
  rootHash: string;
  txHash: string;
}

/** Episode log on 0G Storage: one record per decision. */
export interface EpisodeLogger {
  append(record: EpisodeRecord): Promise<EpisodeReceipt>;
}
