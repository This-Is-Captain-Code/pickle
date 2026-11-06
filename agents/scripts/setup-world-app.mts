/**
 * Create the Pickle World ID 4.0 app and store its credentials in agents/.env. Run it YOURSELF:
 *
 *   npx tsx agents/scripts/setup-world-app.mts
 *
 * Steps (Developer Portal MCP, https://developer.world.org/api/mcp):
 *  1. create_app {name, app_mode: external, verification: cloud} unless the team already has an app with that name
 *  2. configure_world_id {app_id}: managed RP, on-chain registration; returns the signing key ONCE
 *     ("store it immediately"). If the app is already registered, this script stops (it never rotates).
 *  3. Writes WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY, WORLD_PORTAL_API_KEY, WORLD_ENV=production
 *     into agents/.env. Replaced lines are kept as comments.
 *
 * API key: the Authorization header of the `worldcoin-developer-portal` MCP server in ~/.claude.json
 * (added with `claude mcp add`), else WORLD_PORTAL_API_KEY from agents/.env.
 * Prints ids and addresses only; anything key-shaped is redacted.
 */
import { config } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { computeAddress } from 'ethers';
import { PortalMcp, WORLD_MCP_URL } from '../../world/src/actions.ts';

const ENV = 'agents/.env';
const APP_NAME = process.env.WORLD_APP_NAME || 'pickle';
config({ path: ENV, quiet: true } as never);
const red = (s: string) => s.replace(/(0x)?[0-9a-fA-F]{64}/g, '<redacted>').replace(/api_[A-Za-z0-9+/=]{20,}/g, 'api_<redacted>');

function apiKey(): string {
  const cjPath = `${homedir()}/.claude.json`;
  if (existsSync(cjPath)) {
    const cj = JSON.parse(readFileSync(cjPath, 'utf8'));
    for (const p of Object.values<any>(cj.projects ?? {})) {
      const h: string | undefined = p?.mcpServers?.['worldcoin-developer-portal']?.headers?.Authorization;
      if (h) return h.replace(/^Bearer\s+/, '');
    }
  }
  if (process.env.WORLD_PORTAL_API_KEY) return process.env.WORLD_PORTAL_API_KEY;
  throw new Error('No portal API key: add the MCP server (claude mcp add …) or set WORLD_PORTAL_API_KEY');
}

async function call(m: PortalMcp, tool: string, args: Record<string, unknown>): Promise<any> {
  const r = await m.callTool(tool, args);
  let j: any;
  try { j = JSON.parse(r.text); } catch { throw new Error(`${tool}: unexpected reply (redacted): ${red(r.text).slice(0, 300)}`); }
  if (r.isError) throw new Error(`${tool} failed (redacted): ${red(JSON.stringify(j)).slice(0, 400)}`);
  return j;
}

const key = apiKey();
const m = new PortalMcp(WORLD_MCP_URL, key);

// 1. app
const team = await call(m, 'get_team_context', {});
const apps: any[] = team?.team_by_pk?.apps ?? [];
let appId: string | undefined = apps.find((a) => (a.name ?? a.app_metadata?.[0]?.name) === APP_NAME)?.id;
if (appId) console.log(`Using existing app "${APP_NAME}": ${appId}`);
else {
  const created = await call(m, 'create_app', { name: APP_NAME, app_mode: 'external', verification: 'cloud' });
  appId = created?.app?.id ?? created?.app_id ?? created?.id ?? created?.insert_app_one?.id;
  if (!appId) throw new Error(`create_app returned no app id (redacted): ${red(JSON.stringify(created)).slice(0, 400)}`);
  console.log(`Created app "${APP_NAME}": ${appId}`);
}

// 2. World ID 4.0 registration (never rotates an existing one)
const cfg = await call(m, 'get_app_config', { app_id: appId });
if ((cfg?.app?.rp_registration ?? []).length > 0) {
  const reg = cfg.app.rp_registration[0];
  console.error(`App ${appId} already has RP ${reg.rp_id} (signer ${reg.signer_address}). Its key can't be fetched again. Stopping without changes.`);
  process.exit(1);
}
const wid = await call(m, 'configure_world_id', { app_id: appId });
const pk: string | undefined = wid?.signing_key?.private_key;
const rpId: string | undefined = wid?.rp_id ?? wid?.rp_registration?.rp_id ?? wid?.registration?.rp_id;
if (!pk || !rpId) throw new Error(`configure_world_id returned no key or rp_id (redacted): ${red(JSON.stringify(wid)).slice(0, 500)}`);
const hex = pk.startsWith('0x') ? pk : `0x${pk}`;

// 3. agents/.env
let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
const stamp = new Date().toISOString();
const set = (name: string, value: string) => {
  const re = new RegExp(`^${name}=(.*)$`, 'm');
  env = re.test(env)
    ? env.replace(re, (_m, old) => (old.trim() && old.trim() !== value ? `#${name}_REPLACED_${stamp.slice(0, 10)}=${old}\n${name}=${value}` : `${name}=${value}`))
    : `${env.replace(/\n?$/, '\n')}${name}=${value}\n`;
};
set('WORLD_APP_ID', appId);
set('WORLD_RP_ID', rpId);
set('WORLD_RP_SIGNING_KEY', hex);
set('WORLD_PORTAL_API_KEY', key);
set('WORLD_ENV', 'production');
writeFileSync(ENV, env);

const saved = (readFileSync(ENV, 'utf8').match(/^WORLD_RP_SIGNING_KEY=(.*)$/m) ?? [])[1];
console.log(`World ID 4.0 RP: ${rpId}`);
console.log(`Signing key saved to ${ENV} (${saved === hex ? 'verified' : 'NOT VERIFIED — check the file'}); it signs as ${computeAddress(hex)}`);
const reported = wid?.signing_key?.address ?? wid?.signer_address;
if (reported) console.log(`Portal reports signer: ${reported}`);
console.log('Done. On-chain registration may take a few minutes; smoke:world checks it before any scan.');
