/**
 * smoke:episode — a live bounty on PickleEscrow that settles with a REAL 0G Storage root.
 *
 *  stuck_detected → postBounty (bounty_posted = tx hash) → claim (human_verified) →
 *  fix_verified (compute request ID) → sealEvidence() uploads to 0G Storage →
 *  settle(computeRequestId, root) → download root, byte-compare, check the event → finalize() ("paid").
 *
 * Until World and 0G Compute are live, human_verified and fix_verified carry clearly-labelled
 * placeholder IDs ("placeholder-…"); the storage root and all txs are real.
 */
import { explorerAddress, fmt0G, galileoProvider } from '../../src/chain.ts';
import { Episode } from '../../src/episode.ts';
import { DEMO_PAYOUT, Escrow, humanHash } from '../../src/escrow.ts';
import { STORAGE_EXPLORER } from '../../src/storage.ts';
import { DEPLOYER_FLOOR_WEI, namedWallet, robotId } from '../../src/wallets.ts';
import { isMain, runSmoke } from './lib.ts';

export function smokeEpisode(opts: { noExit?: boolean } = {}) {
  return runSmoke(
    'smoke:episode',
    async (log) => {
      const provider = galileoProvider();
      const escrow = new Escrow(provider);
      const agent = namedWallet('AGENT_G1', provider);
      const deployer = namedWallet('DEPLOYER', provider);
      const robot = robotId('G1');
      const worker = process.env.SMOKE_WORKER_ADDRESS || deployer.address;
      const ep = new Episode('G1', { wallet: deployer, walletName: 'DEPLOYER', floorWei: DEPLOYER_FLOOR_WEI });
      let gas = 0n;
      log(`episode ${ep.episodeId} · escrow ${explorerAddress(escrow.address)}`);

      ep.record('stuck_detected', `sim-event-${Date.now()}`, { source: 'smoke', reason: 'fell over, cannot self-right' });

      const post = await escrow.postBounty(agent, robot, DEMO_PAYOUT, 900, { walletName: 'AGENT_G1' });
      const bountyId = escrow.bountyIdFrom(post);
      ep.bountyId = bountyId.toString();
      gas += post.costWei;
      ep.record('bounty_posted', post.hash, { bountyId, payout: DEMO_PAYOUT, claimWindowSec: 900 });
      log(`postBounty #${bountyId} ${post.cost} ${post.explorer}`);

      const human = `placeholder-world-${Date.now()}`;
      const claim = await escrow.claim(agent, bountyId, worker, humanHash(human), { walletName: 'AGENT_G1' });
      gas += claim.costWei;
      ep.record('human_verified', human, { worker, humanHash: humanHash(human), claimTx: claim.hash });
      log(`claim ${claim.cost} ${claim.explorer}`);

      const computeRequestId = `placeholder-compute-${Date.now()}`;
      ep.record('fix_verified', computeRequestId, { verdict: 'fixed', model: 'placeholder' });

      const root = await ep.sealEvidence();
      log(`evidence uploaded: root ${root} · ${ep.evidence!.cost} · ${ep.evidence!.explorer}`);

      const settle = await escrow.settle(agent, bountyId, computeRequestId, root, { walletName: 'AGENT_G1' });
      gas += settle.costWei;
      log(`settle ${settle.cost} ${settle.explorer}`);
      const ev = escrow.events(settle).find((e) => e.name === 'BountySettled');
      if (ev?.args.storageRoot !== root) throw new Error(`BountySettled.storageRoot ${ev?.args.storageRoot} != ${root}`);

      // The root recorded on-chain must download to exactly the evidence we sealed.
      const { doc, raw } = await Episode.fetch(root);
      if (Buffer.compare(Buffer.from(raw), Buffer.from(ep.evidence!.raw)) !== 0) throw new Error('downloaded evidence differs');
      const kinds = doc.entries.map((e) => e.kind).join(' → ');
      if (kinds !== 'stuck_detected → bounty_posted → human_verified → fix_verified') throw new Error(`entries: ${kinds}`);
      log(`downloaded on-chain root → identical bytes ✔ entries: ${kinds}`);

      const fin = await ep.finalize(settle.hash, { payout: DEMO_PAYOUT, worker });
      const back = await Episode.fetch(fin.rootHash);
      if (back.doc.entries.at(-1)?.kind !== 'paid' || back.doc.evidenceRoot !== root) throw new Error('final episode malformed');
      log(`final episode root ${fin.rootHash} · ${fin.cost} · ${fin.explorer} (includes paid + evidenceRoot) ✔`);

      const storage = ep.evidence!.costWei + fin.costWei;
      return `bounty #${bountyId} settled with storageRoot ${root} (downloads identical). Chain gas ${fmt0G(gas)}, storage ${fmt0G(storage)}. Local log ${ep.localPath}. ${STORAGE_EXPLORER}`;
    },
    opts,
  );
}

if (isMain(import.meta.url)) await smokeEpisode();
