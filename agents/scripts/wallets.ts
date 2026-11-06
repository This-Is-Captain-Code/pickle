/**
 * List the named Galileo wallets: name, address, role, balance, explorer link.
 *
 *   npm run wallets
 *
 * Reads keys from agents/.env only to derive addresses; never prints a key.
 */
import './smoke/lib.ts';
import { explorerAddress, fmt0G, galileoProvider } from '../src/chain.ts';
import { WALLETS, hasKey, namedWallet, robotId } from '../src/wallets.ts';

const provider = galileoProvider();
const rows: string[][] = [['name', 'address', 'role', 'balance', 'explorer']];
let missing = 0;
for (const w of WALLETS) {
  if (!hasKey(w.name)) {
    rows.push([w.name, '(no key in agents/.env)', w.role, '-', '-']);
    missing++;
    continue;
  }
  const addr = namedWallet(w.name, provider).address;
  const bal = await provider.getBalance(addr);
  rows.push([w.name, addr, w.role, fmt0G(bal), explorerAddress(addr)]);
}

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const [i, r] of rows.entries()) {
  console.log(r.map((c, j) => c.padEnd(widths[j])).join('  '));
  if (i === 0) console.log(widths.map((n) => '-'.repeat(n)).join('  '));
}
console.log('\nRobot IDs (on-chain identifiers, no key):');
for (const w of WALLETS) if (w.robot) console.log(`  ${w.robot.padEnd(3)} ${robotId(w.robot)}  agent=${w.name}`);
if (missing) process.exitCode = 1;
