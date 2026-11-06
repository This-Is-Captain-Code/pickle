// Pickle agents core — demo harness.
//
// Walks one full bounty lifecycle against whichever providers are configured
// (mock by default, env-switched to live — see providers.ts and .env.example):
//
//   stuck robot → 0G decision → episode log → bounty posted → IDKit claim
//   → fix verified (0G) → Agent Pass approval checkpoint → settle
//
// This file is the integration point for everyone: the World/0G dev runs it
// to exercise live providers; the sim/teleop side will replace the synthetic
// "stuck" event below with real telemetry from sim/ and the settle stub with
// the Monad escrow in contracts/.

import { ZeroGUnreachable, type Bounty, type Decision } from '@pickle/shared';
import { buildProviders } from './providers.js';

const providers = buildProviders();
const log = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);

async function main() {
  // ── 1. Robot reports stuck (synthetic until sim/ lands) ────────────────
  const situation = {
    stuckReason: 'obstacle_in_path',
    detail: 'cable across left wheel, drive current spiked',
    qpos: [0.0, 0.12, -0.4],
    contacts: 3,
    batteryPct: 61,
  };
  log('robot', `g1-sim-01 stuck: ${situation.detail}`);

  // ── 2. 0G decision: what to do about it ────────────────────────────────
  let decision: Decision;
  try {
    decision = await providers.engine.decide({
      robotId: 'g1-sim-01',
      situation,
      question: 'Robot is immobilized. Choose the response.',
      options: ['post_physical_bounty', 'post_teleop_bounty', 'wait_and_retry', 'alert_owner'],
    });
  } catch (err) {
    if (err instanceof ZeroGUnreachable) {
      // Track rule: never fake a decision. Halt the robot, queue the owner.
      log('safe-stop', `0G unreachable — robot halted, owner queued. (${err.message})`);
      return;
    }
    throw err;
  }
  log('0g', `decision=${decision.choice} requestId=${decision.requestId} (${decision.latencyMs}ms) — ${decision.reason}`);

  const receipt = await providers.episodes.append({
    ts: Date.now(),
    robotId: 'g1-sim-01',
    decision,
    situation,
  });
  log('0g', `episode logged: root=${receipt.rootHash.slice(0, 18)}… tx=${receipt.txHash.slice(0, 18)}…`);

  // ── 3. Post the bounty (stub until contracts/ lands) ───────────────────
  const bounty: Bounty = {
    id: `b-${Date.now().toString(36)}`,
    kind: decision.choice === 'post_teleop_bounty' ? 'teleop' : 'physical',
    robotId: 'g1-sim-01',
    title: 'Clear my wheel',
    reason: situation.detail,
    payoutWei: (5n * 10n ** 17n).toString(), // 0.5 MON
    state: 'open',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60_000,
  };
  log('bounty', `${bounty.id} posted (${bounty.kind}, 0.5 MON) — escrow stub, Monad wiring pending`);

  // ── 4. Human claims: IDKit proof-of-human gate ─────────────────────────
  const session = await providers.verifier.createClaimSession(bounty.id);
  log('world', `claim QR ready (expires ${new Date(session.expiresAt).toLocaleTimeString()}): ${session.connectorURI}`);
  const outcome = await providers.verifier.awaitOutcome(session.requestId);
  if (!outcome.ok) {
    log('world', `claim failed: ${outcome.code}${outcome.detail ? ` (${outcome.detail})` : ''} — bounty stays open`);
    return;
  }
  bounty.state = 'claimed';
  bounty.nullifier = outcome.nullifier;
  log('world', `claimed by unique human, nullifier=${outcome.nullifier.slice(0, 16)}…`);

  // ── 5. Verify the fix via telemetry + 0G ───────────────────────────────
  const fixSituation = { ...situation, stuckReason: 'none', contacts: 0, driveOk: true };
  const verdict = await providers.engine.decide({
    robotId: 'g1-sim-01',
    situation: fixSituation,
    question: 'Telemetry after human intervention. Is the robot freed?',
    options: ['fix_confirmed', 'still_stuck'],
  });
  await providers.episodes.append({
    ts: Date.now(),
    robotId: 'g1-sim-01',
    bountyId: bounty.id,
    decision: verdict,
    situation: fixSituation,
  });
  log('0g', `verification=${verdict.choice} requestId=${verdict.requestId}`);
  if (verdict.choice !== 'fix_confirmed') {
    log('bounty', 'fix not confirmed — holding escrow');
    return;
  }

  // ── 6. Agent Pass checkpoint: human approval before payout ─────────────
  const approval = await providers.checkpoint.requestApproval({
    action: 'settle-bounty',
    summary: `Pay 0.5 MON to claimant of "${bounty.title}" (${bounty.id})`,
    amountWei: bounty.payoutWei,
  });
  log('world', `approval needed — code ${approval.userCode} at ${approval.verificationUri}`);
  const decided = await providers.checkpoint.awaitDecision(approval.approvalId);
  if (decided !== 'approved') {
    bounty.state = 'denied';
    log('world', `approval ${decided} — payout does NOT occur`);
    return;
  }

  // ── 7. Settle (stub until contracts/ lands) ────────────────────────────
  bounty.state = 'paid';
  log('bounty', `${bounty.id} settled → PAID (escrow stub). Full loop complete. 🥒`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
