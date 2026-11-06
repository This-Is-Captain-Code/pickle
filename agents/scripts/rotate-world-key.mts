/**
 * Rotate the World ID 4.0 RP signing key and store the new key in agents/.env. Run it YOURSELF:
 *
 *   npx tsx agents/scripts/rotate-world-key.mts
 *
 * - Calls the Developer Portal MCP tool `rotate_world_id_signing_key` (app = WORLD_APP_ID, auth = WORLD_PORTAL_API_KEY).
 *   Portal docs: "The new private key is returned once, at signing_key.private_key"; the portal does not keep it.
 * - Writes it to WORLD_RP_SIGNING_KEY in agents/.env and keeps the previous value as a commented line.
 * - Prints ONLY addresses. Anything shaped like a key is redacted, even in errors.
 * - The previously registered key stops working for this app.
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { computeAddress } from 'ethers';
import { PortalMcp, WORLD_MCP_URL } from '../../world/src/actions.ts';

const ENV = 'agents/.env';
config({ path: ENV, quiet: true } as never);
const red = (s: string) => s.replace(/(0x)?[0-9a-fA-F]{64}/g, '<redacted>');
const appId = process.env.WORLD_APP_ID;
const apiKey = process.env.WORLD_PORTAL_API_KEY;
if (!appId || !apiKey) throw new Error('WORLD_APP_ID and WORLD_PORTAL_API_KEY must be set in agents/.env');

const mcp = new PortalMcp(WORLD_MCP_URL, apiKey);
const r = await mcp.callTool('rotate_world_id_signing_key', { app_id: appId }).catch((e: Error) => {
  console.error('rotate call failed:', red(e.message).slice(0, 400));
  process.exit(1);
});
let j: any;
try { j = JSON.parse(r.text); } catch { console.error('unexpected portal reply (redacted):', red(r.text).slice(0, 400)); process.exit(1); }
const pk: string | undefined = j?.signing_key?.private_key;
if (r.isError || !pk) { console.error('portal returned no key (redacted):', red(JSON.stringify(j)).slice(0, 600)); process.exit(1); }

const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
let env = readFileSync(ENV, 'utf8');
const line = `WORLD_RP_SIGNING_KEY=${hex}`;
env = /^WORLD_RP_SIGNING_KEY=.*$/m.test(env)
  ? env.replace(/^WORLD_RP_SIGNING_KEY=(.*)$/m, (_m, old) => `# previous key, replaced ${new Date().toISOString()} by rotate-world-key (no longer registered):\n#WORLD_RP_SIGNING_KEY_OLD=${old}\n${line}`)
  : `${env.replace(/\n?$/, '\n')}${line}\n`;
writeFileSync(ENV, env);

const saved = (readFileSync(ENV, 'utf8').match(/^WORLD_RP_SIGNING_KEY=(.*)$/m) ?? [])[1];
console.log(`New key saved to ${ENV} (${saved === hex ? 'verified' : 'NOT VERIFIED — check the file'}).`);
console.log(`It signs as: ${computeAddress(hex)}`);
const reported = j.signing_key?.address ?? j.signing_key?.signer_address ?? j.signer_address;
if (reported) console.log(`Portal reports signer: ${reported}`);
console.log('Next: the new signer must reach World\'s registry; smoke:world\'s preflight checks this before any scan.');
