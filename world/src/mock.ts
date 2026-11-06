import { createHash } from 'node:crypto';
import type {
  ApprovalCheckpoint,
  ApprovalOutcome,
  ApprovalRequest,
  ApprovalSession,
  ClaimSession,
  HumanVerifier,
  VerifyFailureCode,
  VerifyOutcome,
} from '@pickle/shared';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MockVerifierOptions {
  /** Force every verification to fail with this code (demo the denied path). */
  failWith?: VerifyFailureCode;
  /** Simulated time between session creation and user completion. */
  delayMs?: number;
}

/** Stands in for IdKitVerifier so agents/ runs before the live integration lands. */
export class MockHumanVerifier implements HumanVerifier {
  private sessions = new Map<string, string>(); // requestId -> bountyId
  private usedNullifiers = new Set<string>();

  constructor(private opts: MockVerifierOptions = {}) {}

  async createClaimSession(bountyId: string, signal?: string): Promise<ClaimSession> {
    const requestId = `mock-req-${bountyId}-${Date.now()}`;
    this.sessions.set(requestId, bountyId);
    return {
      requestId,
      connectorURI: `https://worldcoin.org/verify?mock=1&bounty=${bountyId}&signal=${signal ?? ''}`,
      expiresAt: Date.now() + 15 * 60_000,
    };
  }

  async awaitOutcome(requestId: string): Promise<VerifyOutcome> {
    const bountyId = this.sessions.get(requestId);
    if (!bountyId) return { ok: false, code: 'error', detail: 'unknown requestId' };
    await sleep(this.opts.delayMs ?? 1500);
    if (this.opts.failWith) return { ok: false, code: this.opts.failWith };

    // Same fake human every time: replay protection is observable in the mock.
    const nullifier = BigInt(
      '0x' + createHash('sha256').update(`mock-human-1:claim-bounty-${bountyId}`).digest('hex'),
    ).toString();
    if (this.usedNullifiers.has(nullifier)) return { ok: false, code: 'nullifier_replayed' };
    this.usedNullifiers.add(nullifier);
    return { ok: true, nullifier };
  }
}

export interface MockCheckpointOptions {
  /** What the simulated owner decides. */
  decision?: ApprovalOutcome;
  delayMs?: number;
}

/** Mocked payout-approval checkpoint (the World IdP device-grant version was removed for World ID 4.0 + IDKit). */
export class MockApprovalCheckpoint implements ApprovalCheckpoint {
  private pending = new Map<string, ApprovalRequest>();

  constructor(private opts: MockCheckpointOptions = {}) {}

  async requestApproval(req: ApprovalRequest): Promise<ApprovalSession> {
    const approvalId = `mock-approval-${Date.now()}`;
    this.pending.set(approvalId, req);
    return {
      approvalId,
      userCode: 'PICKL-42',
      verificationUri: `https://example.invalid/approve?mock=1&user_code=PICKL-42`,
      expiresAt: Date.now() + 20 * 60_000,
    };
  }

  async awaitDecision(approvalId: string): Promise<ApprovalOutcome> {
    if (!this.pending.delete(approvalId)) return 'error';
    await sleep(this.opts.delayMs ?? 1500);
    return this.opts.decision ?? 'approved';
  }
}
