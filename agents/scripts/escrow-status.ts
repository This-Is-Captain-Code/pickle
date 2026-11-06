// Escrow ops view: robot balances + recent bounties, and optionally reclaim
// stuck funds. Usage (from agents/):
//   npx tsx --env-file=.env scripts/escrow-status.ts            # balances + last 8 bounties
//   npx tsx --env-file=.env scripts/escrow-status.ts 12         # last 12
//   npx tsx --env-file=.env scripts/escrow-status.ts --reclaim  # cancel Open / expire past-deadline bounties our agents control
import { readFileSync } from 'node:fs';
import { formatEther, type Wallet } from 'ethers';
import { ADDRESSES_PATH, Escrow } from '../src/escrow.js';
import { walletFromEnv } from '../src/chain.js';

const argv = process.argv.slice(2);
const reclaim = argv.includes('--reclaim');
const lastN = Number(argv.find((a) => /^\d+$/.test(a)) ?? 8);

const e = new Escrow();
const robots: Record<string, { id: string; agentWallet: string; agent: string }> = JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')).galileo?.robots ?? {};
const agentFor = (robotAddr: string): Wallet | null => {
  const r = Object.values(robots).find((r) => r.id.toLowerCase() === robotAddr.toLowerCase());
  const key = r && `${r.agentWallet}_PRIVATE_KEY`;
  return key && process.env[key] ? walletFromEnv(key) : null;
};
const nameOf = (robotAddr: string) => Object.entries(robots).find(([, r]) => r.id.toLowerCase() === robotAddr.toLowerCase())?.[0] ?? robotAddr.slice(0, 10);

for (const [name, r] of Object.entries(robots)) {
  console.log(`${name.padEnd(4)} ${r.id}  escrow balance ${formatEther(await e.robotBalance(r.id))} 0G`);
}

const next = Number(await e.read.nextBountyId());
const now = BigInt(Math.floor(Date.now() / 1000));
const zeroAddr = '0x' + '0'.repeat(40);
for (let i = next - 1; i >= Math.max(1, next - lastN); i--) {
  const id = BigInt(i);
  const b = await e.bounty(id);
  if (b.status === 'None') continue;
  const pastDeadline = b.deadline > 0n && now > b.deadline;
  console.log(`#${i}  ${b.status.padEnd(9)} ${nameOf(b.robot).padEnd(4)} payout ${formatEther(b.payout)}  worker ${b.worker === zeroAddr ? '-' : b.worker.slice(0, 10) + '…'}${pastDeadline && b.status === 'Claimed' ? '  (past deadline)' : ''}`);
  if (!reclaim || (b.status !== 'Open' && b.status !== 'Claimed')) continue;
  const agent = agentFor(b.robot);
  try {
    if (!agent) console.log('   (no agent key for this robot in .env)');
    else if (b.status === 'Open') { const r = await e.cancel(agent, id); console.log(`   cancelled -> ${r.hash}`); }
    else if (pastDeadline) { const r = await e.expire(agent, id); console.log(`   expired -> ${r.hash}`); }
    else console.log('   (claimed and still inside its window — left alone)');
  } catch (err: any) { console.log(`   reclaim failed: ${err.message}`); }
}
