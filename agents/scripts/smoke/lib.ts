/** Shared helpers for smoke tests: env loading, PASS/FAIL reporting, timing. */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = join(AGENTS_DIR, '..');

config({ path: join(AGENTS_DIR, '.env'), quiet: true } as never);

export interface SmokeResult {
  name: string;
  pass: boolean;
  ms: number;
  detail: string;
}

/** Run a smoke body; print PASS/FAIL; exit non-zero on failure unless `noExit`. */
export async function runSmoke(
  name: string,
  body: (log: (msg: string) => void) => Promise<string>,
  opts: { noExit?: boolean } = {},
): Promise<SmokeResult> {
  const t0 = Date.now();
  const log = (msg: string) => console.log(`  [${name}] ${msg}`);
  try {
    const detail = await body(log);
    const r = { name, pass: true, ms: Date.now() - t0, detail };
    console.log(`PASS ${name} (${r.ms} ms) — ${detail}`);
    return r;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const r = { name, pass: false, ms: Date.now() - t0, detail };
    console.log(`FAIL ${name} (${r.ms} ms) — ${detail}`);
    if (!opts.noExit) process.exitCode = 1;
    return r;
  }
}

export function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(metaUrl) === process.argv[1];
}
