/**
 * smoke:all — run every smoke test and print a PASS / FAIL / SKIPPED table.
 *
 *   npm run smoke:all
 *
 * Each test runs as its own process (`tsx <file>`) so one crash can't take down the rest, and the
 * table reflects exactly what `npm run smoke:<name>` would print. A test is SKIPPED (not run) when
 * the keys it needs are missing from agents/.env. Exits non-zero if anything FAILs.
 *
 * Costs (Galileo testnet 0G, measured 2026-11-06): chain ~0.00013, tx ~0.00042, escrow ~0.0023 gas,
 * storage ~0.0012, episode ~0.0012 gas + ~0.0027 storage. Demo payouts go to the deployer address.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_DIR, REPO_ROOT } from './lib.ts';

const has = (v: string) => {
  const x = process.env[v]?.trim();
  return Boolean(x) && !x!.endsWith('...');
};

interface Test {
  name: string;
  /** script under agents/scripts/smoke, or a shell command */
  file?: string;
  cmd?: string[];
  needs?: string[];
  skip?: string;
}

const TESTS: Test[] = [
  { name: 'contracts (hardhat test)', cmd: ['npm', 'test', '--prefix', 'contracts/hardhat'] },
  { name: 'smoke:chain', file: 'chain.ts', needs: ['DEPLOYER_PRIVATE_KEY'] },
  { name: 'smoke:tx', file: 'tx.ts', needs: ['DEPLOYER_PRIVATE_KEY', 'AGENT_G1_PRIVATE_KEY'] },
  { name: 'smoke:escrow', file: 'escrow.ts', needs: ['AGENT_G1_PRIVATE_KEY', 'AGENT_2_PRIVATE_KEY'] },
  { name: 'smoke:storage', file: 'storage.ts', needs: ['DEPLOYER_PRIVATE_KEY'] },
  { name: 'smoke:episode', file: 'episode.ts', needs: ['DEPLOYER_PRIVATE_KEY', 'AGENT_G1_PRIVATE_KEY'] },
  // Text runs on ZEROG_COMPUTE_MODE (direct = testnet, paid by COMPUTE_WALLET; router = mainnet key).
  // Vision always uses the Router, so the router key is needed in both modes.
  {
    name: 'smoke:compute',
    file: 'compute.ts',
    needs: (process.env.ZEROG_COMPUTE_MODE || 'direct') === 'direct'
      ? ['COMPUTE_WALLET_PRIVATE_KEY', 'ZEROG_ROUTER_KEY']
      : ['ZEROG_ROUTER_KEY'],
  },
  { name: 'smoke:compute-down', file: 'compute-down.ts' },
  { name: 'smoke:world', file: 'world.ts', needs: ['WORLD_IDP_CLIENT_ID', 'WORLD_IDP_CLIENT_SECRET'] },
  { name: 'smoke:zerobot', file: 'zerobot.ts', skip: 'not built yet (vendor/zerobot setup pending)' },
];

type Status = 'PASS' | 'FAIL' | 'SKIPPED';
const rows: { name: string; status: Status; ms: number; detail: string }[] = [];

for (const t of TESTS) {
  const missing = (t.needs ?? []).filter((v) => !has(v));
  const path = t.file ? join(AGENTS_DIR, 'scripts', 'smoke', t.file) : undefined;
  if (t.skip || missing.length || (path && !existsSync(path))) {
    const why = t.skip ?? (missing.length ? `missing in agents/.env: ${missing.join(', ')}` : `${t.file} not written yet`);
    rows.push({ name: t.name, status: 'SKIPPED', ms: 0, detail: why });
    console.log(`SKIPPED ${t.name} — ${why}`);
    continue;
  }
  console.log(`\n── ${t.name} ──`);
  const t0 = Date.now();
  const [cmd, ...args] = t.cmd ?? ['npx', 'tsx', path!];
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 15 * 60_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out);
  const ms = Date.now() - t0;
  const verdict = out.split(/\r?\n/).reverse().find((l) => /^(PASS|FAIL) /.test(l));
  let status: Status;
  let detail: string;
  if (t.cmd) {
    const m = out.match(/(\d+) passing/);
    const f = out.match(/(\d+) failing/);
    status = r.status === 0 && !f ? 'PASS' : 'FAIL';
    detail = `${m?.[1] ?? 0} passing${f ? `, ${f[1]} failing` : ''}`;
  } else {
    status = r.status === 0 && verdict?.startsWith('PASS') ? 'PASS' : 'FAIL';
    detail = verdict?.replace(/^(PASS|FAIL) \S+ \(\d+ ms\) — /, '') ?? `exit ${r.status ?? r.signal}`;
  }
  rows.push({ name: t.name, status, ms, detail });
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const w = Math.max(...rows.map((r) => r.name.length));
console.log(`\n${'test'.padEnd(w)}  status   time     detail`);
console.log(`${'-'.repeat(w)}  -------  -------  ${'-'.repeat(60)}`);
for (const r of rows)
  console.log(`${r.name.padEnd(w)}  ${r.status.padEnd(7)}  ${(r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '-').padEnd(7)}  ${clip(r.detail, 140)}`);
const n = (s: Status) => rows.filter((r) => r.status === s).length;
console.log(`\n${n('PASS')} PASS · ${n('FAIL')} FAIL · ${n('SKIPPED')} SKIPPED`);
if (n('FAIL')) process.exitCode = 1;
