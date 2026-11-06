/**
 * smoke:tx — the safe sender (agents/src/tx.ts) on 0G Galileo.
 *
 *  A. Five sends fired at once from one wallet (0-value self-transfers: 21k gas, the cheapest
 *     possible tx) must all mine, with consecutive nonces, in nonce order, with no nonce errors.
 *  B. A deliberately failing call (PickleEscrow.setMaxPayout from a non-owner) must be refused
 *     BEFORE signing, with the custom error name NotOwner, and leave the nonce untouched.
 *     Needs PickleEscrow in shared/addresses.json; otherwise B is reported as not run (FAIL).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { assertGalileo, explorerTx, fmt0G, galileoProvider } from '../../src/chain.ts';
import { TxRefused, sendTx, AUDIT_LOG } from '../../src/tx.ts';
import { floorFor, namedWallet } from '../../src/wallets.ts';
import { REPO_ROOT, isMain, runSmoke } from './lib.ts';

const ADDRESSES = join(REPO_ROOT, 'shared/addresses.json');
const ABI = join(REPO_ROOT, 'shared/abi/PickleEscrow.json');

export function smokeTx(opts: { noExit?: boolean } = {}) {
  return runSmoke(
    'smoke:tx',
    async (log) => {
      const provider = galileoProvider();
      await assertGalileo(provider);
      const deployer = namedWallet('DEPLOYER', provider);

      // ── A: five concurrent sends ──
      const startNonce = await provider.getTransactionCount(deployer.address, 'pending');
      const t0 = Date.now();
      const results = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          sendTx({
            wallet: deployer,
            walletName: 'DEPLOYER',
            action: `smoke:tx self-send #${i}`,
            args: { i },
            to: deployer.address,
            value: 0n,
            floorWei: floorFor('DEPLOYER'),
          }),
        ),
      );
      let total = 0n;
      for (const [i, r] of results.entries()) {
        total += r.costWei;
        log(`#${i} nonce ${r.nonce} block ${r.receipt.blockNumber} idx ${r.receipt.index} · ${r.cost} · ${explorerTx(r.hash)}`);
      }
      const nonces = results.map((r) => r.nonce);
      const expected = [0, 1, 2, 3, 4].map((i) => startNonce + i);
      if (JSON.stringify(nonces) !== JSON.stringify(expected))
        throw new Error(`nonces ${nonces} != expected ${expected}`);
      for (let i = 1; i < results.length; i++) {
        const a = results[i - 1].receipt;
        const b = results[i].receipt;
        if (b.blockNumber < a.blockNumber || (b.blockNumber === a.blockNumber && b.index < a.index))
          throw new Error(`#${i} landed before #${i - 1}`);
      }
      log(`A: 5 sends mined in order, nonces ${nonces[0]}..${nonces[4]}, ${Date.now() - t0} ms, total ${fmt0G(total)}`);

      // ── B: refused before sending ──
      if (!existsSync(ABI) || !existsSync(ADDRESSES)) throw new Error('B not run: PickleEscrow not deployed (shared/abi)');
      const escrowAddr = JSON.parse(readFileSync(ADDRESSES, 'utf8')).galileo?.contracts?.PickleEscrow?.address;
      if (!escrowAddr) throw new Error('B not run: no PickleEscrow address in shared/addresses.json');
      const iface = new Interface(JSON.parse(readFileSync(ABI, 'utf8')).abi);
      const agent = namedWallet('AGENT_G1', provider);
      const nonceBefore = await provider.getTransactionCount(agent.address, 'pending');
      try {
        await sendTx({
          wallet: agent,
          walletName: 'AGENT_G1',
          action: 'smoke:tx setMaxPayout as non-owner',
          args: [1],
          to: escrowAddr,
          data: iface.encodeFunctionData('setMaxPayout', [1n]),
          iface,
        });
        throw new Error('B: failing call was SENT — it should have been refused');
      } catch (err) {
        if (!(err instanceof TxRefused)) throw err;
        if (err.revert.name !== 'NotOwner') throw new Error(`B: refused with ${err.revert.name}, expected NotOwner`);
        log(`B: ${err.message}`);
      }
      const nonceAfter = await provider.getTransactionCount(agent.address, 'pending');
      if (nonceAfter !== nonceBefore) throw new Error(`B: AGENT_G1 nonce moved ${nonceBefore} → ${nonceAfter}`);

      return `5 concurrent sends in order (nonces ${nonces[0]}..${nonces[4]}, ${fmt0G(total)}); failing call refused as NotOwner, nothing sent. Audit: ${AUDIT_LOG}`;
    },
    opts,
  );
}

if (isMain(import.meta.url)) await smokeTx();
