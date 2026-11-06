/**
 * Create a wallet and store its private key in agents/.env. Prints the ADDRESS ONLY.
 *
 *   npx tsx agents/scripts/new-wallet.ts DEPLOYER
 *     → writes DEPLOYER_PRIVATE_KEY + DEPLOYER_ADDRESS
 *
 * Refuses to overwrite an existing non-empty key, so a funded wallet can't be lost by accident.
 * Creates agents/.env from agents/.env.example if it doesn't exist yet. agents/.env is gitignored.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const role = (process.argv[2] ?? '').toUpperCase();
if (!/^[A-Z][A-Z0-9_]*$/.test(role)) {
  console.error('Usage: tsx agents/scripts/new-wallet.ts <ROLE>   e.g. DEPLOYER');
  process.exit(1);
}

const agentsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(agentsDir, '.env');
if (!existsSync(envPath)) copyFileSync(join(agentsDir, '.env.example'), envPath);

let env = readFileSync(envPath, 'utf8');
const keyVar = `${role}_PRIVATE_KEY`;
const addrVar = `${role}_ADDRESS`;

const existing = env.match(new RegExp(`^${keyVar}=(.*)$`, 'm'));
if (existing && existing[1].trim() !== '') {
  const addr = new Wallet(existing[1].trim()).address;
  console.log(`${keyVar} already set in agents/.env — not overwriting. Address: ${addr}`);
  process.exit(0);
}

const wallet = Wallet.createRandom();

function setVar(text: string, name: string, value: string): string {
  const re = new RegExp(`^${name}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${name}=${value}`) : `${text.replace(/\n?$/, '\n')}${name}=${value}\n`;
}
env = setVar(env, keyVar, wallet.privateKey);
env = setVar(env, addrVar, wallet.address);
writeFileSync(envPath, env, { mode: 0o600 });

console.log(`Created ${role} wallet. Key stored in agents/.env as ${keyVar} (not printed).`);
console.log(`Address: ${wallet.address}`);
