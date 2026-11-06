/**
 * smoke:world — World ID 4.0 (IDKit) claim gate on live PickleEscrow. INTERACTIVE: a human scans with World App.
 *
 *   1 success     bounty A: QR → you APPROVE → World v4 verify ✔ → humanHash → PickleEscrow.claim ✔
 *   2 tampered    replay case 1's proof with one proof element changed → World verify rejects → no claim
 *                 (plus: the untouched proof re-submitted for another bounty's action → rejected by our precheck)
 *   3 duplicate   bounty A again: QR → you APPROVE → refused (World replay error, or HumanAlreadyClaimed
 *                 on-chain) → nothing sent, bounty A unchanged
 *   4 cancelled   bounty B: QR → you tap DECLINE/cancel in World App → verification fails → no claim, B stays Open
 *   cleanup       cancel B (escrow back to robot); A's claim window is 120 s, then AGENT_2 expires it (escrow back)
 *
 * Needs in agents/.env: WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY (or WORLD_SIGNING_KEY), WORLD_ENV=production,
 * WORLD_PORTAL_API_KEY (creates the per-bounty actions), AGENT_G1/AGENT_2 keys, robot G1 escrow ≥ 0.002 0G.
 * The signing key and API key are only read server-side; nothing secret is printed or served.
 */
import { IdKitVerifier } from '@pickle/world';
import { assertGalileo, fmt0G, galileoProvider } from '../../src/chain.ts';
import { claimWithWorldId, type ClaimOutcome } from '../../src/claim.ts';
import { DEMO_PAYOUT, Escrow } from '../../src/escrow.ts';
import { worldConfigFromEnv } from '../../src/providers.ts';
import { startQrDisplay } from '../../src/qr.ts';
import { namedWallet, robotId } from '../../src/wallets.ts';
import { isMain, runSmoke } from './lib.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CLAIM_WINDOW_S = 120;

export function smokeWorld(opts: { noExit?: boolean } = {}) {
  return runSmoke('smoke:world', async (log) => {
    const cfg = worldConfigFromEnv();
    if (cfg.environment !== 'production') throw new Error(`WORLD_ENV=${cfg.environment}: a real World App only signs production proofs (docs SKILL.md). Set WORLD_ENV=production.`);
    if (!cfg.portalApiKey) throw new Error('WORLD_PORTAL_API_KEY missing: needed to create the per-bounty World ID actions (portal → team → API keys).');

    const provider = galileoProvider();
    await assertGalileo(provider);
    const escrow = new Escrow(provider);
    const agent = namedWallet('AGENT_G1', provider);
    const other = namedWallet('AGENT_2', provider);
    const robot = robotId('G1');
    const worker = process.env.SMOKE_WORKER_ADDRESS || namedWallet('DEPLOYER', provider).address;
    const bal = await escrow.robotBalance(robot);
    if (bal < 2n * DEMO_PAYOUT) throw new Error(`robot G1 escrow ${fmt0G(bal)} < ${fmt0G(2n * DEMO_PAYOUT)} — run \`npm run deploy:escrow\``);

    const verifier = new IdKitVerifier({ ...cfg, escrowAddress: escrow.address });
    const pf = await verifier.preflight();
    log(`preflight: RP ${cfg.rpId} ${pf.status}, signing key matches registered signer ${pf.registeredSigner}`);
    const qr = await startQrDisplay();
    const checks: string[] = [];
    const t0 = Date.now();
    try {
      // Bounties
      const postA = await escrow.postBounty(agent, robot, DEMO_PAYOUT, CLAIM_WINDOW_S, { walletName: 'AGENT_G1' });
      const A = escrow.bountyIdFrom(postA);
      const postB = await escrow.postBounty(agent, robot, DEMO_PAYOUT, CLAIM_WINDOW_S, { walletName: 'AGENT_G1' });
      const B = escrow.bountyIdFrom(postB);
      log(`posted bounty A #${A} (${postA.explorer}) and B #${B} (${postB.explorer}); actions ${verifier.actionFor(String(A))}, ${verifier.actionFor(String(B))}`);

      // 1 — success
      log(`STEP 1/4: scan the QR and APPROVE in World App (bounty A #${A}).`);
      const s1 = await claimWithWorldId({ verifier, escrow, agent, bountyId: A, worker, qr, label: `1/4 APPROVE — claim bounty #${A}` });
      if (s1.status !== 'claimed') throw new Error(`step 1 expected claimed, got ${describe(s1)}`);
      const onA = await escrow.bounty(A);
      if (onA.status !== 'Claimed' || onA.humanHash !== s1.humanHash) throw new Error(`bounty A on-chain status ${onA.status}, humanHash ${onA.humanHash}`);
      log(`✔ 1 success: World verified, claim tx ${s1.txHash}, humanHash ${s1.humanHash} (first success after ${Math.round((Date.now() - t0) / 1000)} s)`);
      checks.push('success');

      // 2 — tampered proof (no scan needed)
      const raw = verifier.rawResult(s1.requestId) as any;
      const info = verifier.requestInfo(s1.requestId)!;
      if (!raw) throw new Error('no raw result kept from step 1');
      const tampered = structuredClone(raw);
      const p0: string = tampered.responses[0].proof[0];
      tampered.responses[0].proof[0] = p0.slice(0, -1) + (p0.endsWith('0') ? '1' : '0');
      const t = await verifier.verify(tampered, info.action, info.signal);
      if (t.ok) throw new Error('step 2: World ACCEPTED a tampered proof');
      log(`✔ 2a tampered proof rejected by World verifier: ${t.code} ${t.detail ? `(${String(t.detail).slice(0, 80)})` : ''}`);
      const wrongAction = await verifier.verify(raw, verifier.actionFor(String(B)), info.signal);
      if (wrongAction.ok) throw new Error('step 2: proof for bounty A accepted for bounty B');
      log(`✔ 2b bounty A's proof replayed for bounty B rejected: ${wrongAction.code}`);
      if ((await escrow.bounty(B)).status !== 'Open') throw new Error('step 2: bounty B changed state');
      checks.push('tampered');

      // 3 — same human, same bounty
      log(`STEP 3/4: scan the NEW QR and APPROVE again (same bounty A #${A}). This claim must be refused.`);
      const s3 = await claimWithWorldId({ verifier, escrow, agent, bountyId: A, worker, qr, label: `3/4 APPROVE again — same bounty #${A} (must be refused)` });
      if (s3.status === 'claimed') throw new Error(`step 3: duplicate claim was ACCEPTED (tx ${s3.txHash})`);
      if (s3.status === 'verification_failed' && !['nullifier_replayed', 'error'].includes(s3.code)) {
        throw new Error(`step 3: expected a duplicate refusal, got ${describe(s3)} — did you cancel instead of approving?`);
      }
      const onA3 = await escrow.bounty(A);
      if (onA3.humanHash !== s1.humanHash || onA3.status !== 'Claimed') throw new Error('step 3: bounty A changed');
      log(`✔ 3 duplicate refused: ${describe(s3)}${s3.status === 'refused_duplicate' && s3.humanHash === s1.humanHash ? ' (same humanHash as step 1)' : ''}`);
      checks.push('duplicate');

      // 4 — cancelled
      log(`STEP 4/4: scan the QR and DECLINE / cancel in World App (bounty B #${B}).`);
      const s4 = await claimWithWorldId({ verifier, escrow, agent, bountyId: B, worker, qr, label: `4/4 DECLINE — bounty #${B} (must not be claimed)` });
      if (s4.status === 'claimed') throw new Error(`step 4: bounty B was claimed (tx ${s4.txHash}) — expected a cancelled verification`);
      if ((await escrow.bounty(B)).status !== 'Open') throw new Error('step 4: bounty B is not Open');
      log(`✔ 4 cancelled/failed verification → no claim, bounty B still Open (${describe(s4)})`);
      checks.push('cancelled');

      // cleanup
      await qr.update('Done — smoke:world finished', 'https://world.org');
      const c = await escrow.cancel(agent, B, { walletName: 'AGENT_G1' });
      log(`cleanup: cancelled B ${c.explorer}`);
      const wait = Number(onA.deadline) * 1000 - Date.now() + 15_000;
      if (wait > 0) { log(`cleanup: waiting ${Math.ceil(wait / 1000)} s for A's claim window, then expiring it`); await sleep(wait); }
      const e = await escrow.expire(other, A, { walletName: 'AGENT_2' });
      log(`cleanup: expired A ${e.explorer} (escrow back to robot G1)`);
    } finally {
      await qr.close();
    }
    return `${checks.join(', ')} — all as expected`;
  }, opts);
}

function describe(o: ClaimOutcome): string {
  if (o.status === 'claimed') return `claimed tx ${o.txHash}`;
  if (o.status === 'refused_duplicate') return `refused on-chain: ${o.detail.slice(0, 80)}`;
  return `verification failed: ${o.code}${o.detail ? ` (${o.detail.slice(0, 100)})` : ''}`;
}

if (isMain(import.meta.url)) await smokeWorld();
