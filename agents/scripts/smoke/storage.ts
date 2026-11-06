/**
 * smoke:storage — 0G Storage (Galileo, turbo indexer), paid by the DEPLOYER wallet.
 * Upload a sample episode log → root → download (Merkle proof on) → byte-identical.
 * The sample is stamped with the run time so every run is a real new upload.
 */
import { assertGalileo, fmt0G, galileoProvider } from '../../src/chain.ts';
import { STORAGE_EXPLORER, STORAGE_INDEXER, downloadBytes, rootOf, uploadBytes } from '../../src/storage.ts';
import { DEPLOYER_FLOOR_WEI, namedWallet } from '../../src/wallets.ts';
import { isMain, runSmoke } from './lib.ts';

export function sampleEpisode(): object {
  const t = Date.now();
  return {
    schema: 'pickle.episode/v1',
    episodeId: `smoke-${t}`,
    robot: 'G1',
    entries: [
      { seq: 0, ts: t, kind: 'stuck_detected', requestId: `sim-${t}`, data: { reason: 'smoke sample' } },
      { seq: 1, ts: t + 1, kind: 'bounty_posted', requestId: '0xsample', data: { payout: '0.001' } },
    ],
  };
}

export function smokeStorage(opts: { noExit?: boolean } = {}) {
  return runSmoke(
    'smoke:storage',
    async (log) => {
      const provider = galileoProvider();
      await assertGalileo(provider);
      const wallet = namedWallet('DEPLOYER', provider);
      const bytes = new TextEncoder().encode(JSON.stringify(sampleEpisode(), null, 2));
      const expectedRoot = await rootOf(bytes);
      log(`indexer ${STORAGE_INDEXER} · ${bytes.length} bytes · local root ${expectedRoot}`);

      const up = await uploadBytes(bytes, wallet, {
        action: 'smoke:storage upload',
        walletName: 'DEPLOYER',
        floorWei: DEPLOYER_FLOOR_WEI,
      });
      log(`uploaded in ${up.ms} ms · root ${up.rootHash} · tx ${up.explorer} · cost ${up.cost} (storage fee ${fmt0G(up.storageFeeWei)})`);
      if (up.rootHash !== expectedRoot) throw new Error(`root ${up.rootHash} != local ${expectedRoot}`);

      const t0 = Date.now();
      const got = await downloadBytes(up.rootHash);
      log(`downloaded ${got.length} bytes in ${Date.now() - t0} ms (Merkle proof verified)`);
      if (Buffer.compare(Buffer.from(got), Buffer.from(bytes)) !== 0) throw new Error('downloaded bytes differ from upload');
      return `root ${up.rootHash}, ${bytes.length} B round-trip identical, cost ${up.cost}. ${STORAGE_EXPLORER}`;
    },
    opts,
  );
}

if (isMain(import.meta.url)) await smokeStorage();
