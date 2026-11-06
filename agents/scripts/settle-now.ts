// Manual settle for a Claimed bounty whose automatic settle failed (e.g. the agent
// ran out of gas) — must run before the claim deadline. Optionally tops up the
// agent's gas from another named wallet first.
//   npx tsx --env-file=.env scripts/settle-now.ts <bountyId> <computeRequestId> <storageRoot> [--gas-from AGENT_G1 --gas 0.001]
import { parseEther, formatEther } from 'ethers';
import { Escrow } from '../src/escrow.js';
import { galileoProvider } from '../src/chain.js';
import { sendTx } from '../src/tx.js';
import { namedWallet, WALLETS, type WalletName } from '../src/wallets.js';

const [idArg, requestId, root] = process.argv.slice(2);
const gi = process.argv.indexOf('--gas-from');
const gasFrom = gi > 0 ? (process.argv[gi + 1] as WalletName) : null;
const ga = process.argv.indexOf('--gas');
const gasAmt = ga > 0 ? parseEther(process.argv[ga + 1]) : parseEther('0.001');
if (!idArg || !requestId || !/^0x[0-9a-fA-F]{64}$/.test(root ?? '')) { console.error('usage: settle-now.ts <bountyId> <computeRequestId> <storageRoot(bytes32)> [--gas-from WALLET --gas 0.001]'); process.exit(2); }

const provider = galileoProvider();
const e = new Escrow(provider);
const id = BigInt(idArg);
const b = await e.bounty(id);
const agentAddr = (await e.agentOf(b.robot)).toLowerCase();
const agentName = WALLETS.find((w) => namedWallet(w.name, provider).address.toLowerCase() === agentAddr)?.name;
if (!agentName) { console.error(`no key for agent ${agentAddr}`); process.exit(1); }
const agent = namedWallet(agentName, provider);
const now = Math.floor(Date.now() / 1000);
console.log(`bounty #${id}: status=${b.status} worker=${b.worker} deadline in ${Number(b.deadline) - now}s; agent ${agentName} gas ${formatEther(await provider.getBalance(agent.address))} 0G`);
if (b.status !== 'Claimed') { console.error('not Claimed — nothing to settle'); process.exit(1); }

if (gasFrom) {
  const from = namedWallet(gasFrom, provider);
  const r = await sendTx({ wallet: from, walletName: gasFrom, action: `gas ${gasFrom} -> ${agentName}`, to: agent.address, value: gasAmt, args: { to: agent.address } });
  console.log(`gas top-up: ${r.explorer}`);
}
const r = await e.settle(agent, id, requestId, root, { walletName: agentName });
console.log(`settled: ${r.explorer}`);
console.log(`bounty #${id} now ${(await e.bounty(id)).status}`);
