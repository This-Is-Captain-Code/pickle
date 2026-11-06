// Read on-chain bounty state. Usage: npx tsx agents/scripts/check-bounty.ts <id>
import { Escrow } from '../src/escrow.js';

const id = BigInt(process.argv[2] ?? '26');
const e = new Escrow();
const b = await e.bounty(id);
const zero = '0x' + '0'.repeat(64);
console.log(`bounty #${id}: status=${b.status} worker=${b.worker} humanHash=${b.humanHash === zero ? '(unset)' : b.humanHash.slice(0, 14) + '…'} payout=${b.payout}`);
