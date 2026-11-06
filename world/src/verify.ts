/**
 * Backend verification of an IDKit result. The client result is never trusted on its own:
 * it is forwarded UNCHANGED to World's verifier and only the verifier's answer counts.
 *
 * Docs (docs/sponsors.md §4b):
 *  - integrate (Step 5): POST https://developer.world.org/api/v4/verify/{rp_id}, body = IDKit result
 *    ("Forward the IDKit result payload as-is. No field remapping is required."), environment set explicitly.
 *  - verify OpenAPI: success {success: true, action, nullifier, environment, results[]};
 *    error {success: false, code, detail, results?}.
 *  - integrate (Step 6): nullifiers are 0x-hex 256-bit integers; "your backend must check that the nullifier
 *    hasn't been used before" → done on-chain: PickleEscrow.hasClaimed[bountyId][humanHash].
 */
import { keccak256, toBeHex } from 'ethers';

export const WORLD_VERIFY_BASE = 'https://developer.world.org/api/v4/verify';

export type WorldEnvironment = 'production' | 'staging';

export interface VerifyExpectation {
  rpId: string;
  action: string;
  environment: WorldEnvironment;
  /** hashSignal(expected signal). Every response must carry it, so a proof made for another payout address is rejected. */
  signalHash?: string;
  timeoutMs?: number;
}

export type BackendVerifyResult =
  | { ok: true; nullifier: string; action: string; environment: string; raw: unknown }
  | { ok: false; code: string; detail: string; status?: number; raw?: unknown };

/** Shape checks we do BEFORE asking World (cheap rejections). They never make a proof valid. */
function precheck(result: any, exp: VerifyExpectation): string | undefined {
  if (!result || typeof result !== 'object') return 'result is not an object';
  if (result.protocol_version !== '4.0') return `protocol_version ${result.protocol_version} (only 4.0 accepted)`;
  if (result.action !== exp.action) return `action mismatch: got ${result.action}, expected ${exp.action}`;
  if (result.environment !== exp.environment) return `environment mismatch: got ${result.environment}, expected ${exp.environment}`;
  if (!Array.isArray(result.responses) || result.responses.length === 0) return 'no responses';
  if (exp.signalHash) {
    const want = BigInt(exp.signalHash);
    for (const r of result.responses) {
      if (r?.signal_hash === undefined || BigInt(r.signal_hash) !== want) return `signal mismatch on ${r?.identifier ?? 'response'}`;
    }
  }
  return undefined;
}

export async function verifyWithWorld(result: unknown, exp: VerifyExpectation): Promise<BackendVerifyResult> {
  const pre = precheck(result, exp);
  if (pre) return { ok: false, code: 'precheck_failed', detail: pre };

  let res: Response;
  try {
    res = await fetch(`${WORLD_VERIFY_BASE}/${exp.rpId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Forwarded unchanged; environment set explicitly as in the integrate guide.
      body: JSON.stringify({ ...(result as object), environment: exp.environment }),
      signal: AbortSignal.timeout(exp.timeoutMs ?? 30_000),
    });
  } catch (e) {
    return { ok: false, code: 'verify_unreachable', detail: (e as Error).message };
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }

  if (!res.ok || json?.success !== true) {
    return {
      ok: false,
      status: res.status,
      code: json?.code ?? `http_${res.status}`,
      detail: json?.detail ?? text.slice(0, 200),
      raw: json,
    };
  }
  // Use the VERIFIER's nullifier/action/environment, not the client's.
  const nullifier: string | undefined = json.nullifier ?? json.results?.find((r: any) => r.success)?.nullifier;
  if (!nullifier) return { ok: false, code: 'no_nullifier', detail: 'verifier response has no nullifier', raw: json };
  if (json.action && json.action !== exp.action) return { ok: false, code: 'action_mismatch', detail: `verifier action ${json.action}`, raw: json };
  if (json.environment && json.environment !== exp.environment) return { ok: false, code: 'environment_mismatch', detail: `verifier env ${json.environment}`, raw: json };
  return { ok: true, nullifier, action: json.action ?? exp.action, environment: json.environment ?? exp.environment, raw: json };
}

/**
 * humanHash = keccak256(nullifier as a 32-byte big-endian integer).
 * The nullifier is already scoped to (human, app, action) and the action is per bounty, so the same
 * human gets the same humanHash for the same bounty (refused on-chain) and different ones elsewhere.
 * Parsing as an integer avoids hex casing / padding differences (integrate Step 6).
 */
export function humanHashFromNullifier(nullifier: string): string {
  return keccak256(toBeHex(BigInt(nullifier), 32));
}
