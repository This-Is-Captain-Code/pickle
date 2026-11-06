/**
 * Read-only: list every 0G Compute inference provider registered on Galileo testnet and probe
 * whether each endpoint is reachable from this machine. No wallet, no funds, no transactions.
 *
 *   npx tsx zerog/scripts/list-testnet-services.ts [--json]
 *
 * SDK: @0gfoundation/0g-compute-ts-sdk 0.9.0, createReadOnlyInferenceBroker(rpcUrl)
 * (lib.commonjs/inference/broker/read-only-broker.d.ts).
 */
import { createRequire } from 'node:module';
// The SDK's ESM build (lib.esm) is broken in 0.9.0 ("does not provide an export named C"); load the CommonJS build.
const { createReadOnlyInferenceBroker } = createRequire(import.meta.url)('@0gfoundation/0g-compute-ts-sdk') as typeof import('@0gfoundation/0g-compute-ts-sdk');

const RPC = process.env.ZEROG_RPC_URL || 'https://evmrpc-testnet.0g.ai';

async function probe(url: string): Promise<string> {
  const t0 = Date.now();
  try {
    const r = await fetch(url.replace(/\/$/, ''), { signal: AbortSignal.timeout(12_000) });
    return `HTTP ${r.status} (${Date.now() - t0} ms)`;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; errors?: { code?: string }[] } };
    return `UNREACHABLE ${err.name === 'TimeoutError' ? 'timeout' : err.cause?.code ?? err.cause?.errors?.[0]?.code ?? err.message}`;
  }
}

const broker = await createReadOnlyInferenceBroker(RPC, 16602);
// The contract caps a page at 50 (reverts LimitTooLarge(100, 50)).
const services = [];
for (let offset = 0; ; offset += 50) {
  const page = await broker.listService(offset, 50, true);
  services.push(...page);
  if (page.length < 50) break;
}
const rows = [];
for (const s of services) {
  let info: unknown = s.additionalInfo;
  try { info = JSON.parse(s.additionalInfo); } catch { /* keep raw */ }
  rows.push({
    provider: s.provider,
    serviceType: s.serviceType,
    model: s.model,
    url: s.url,
    verifiability: s.verifiability,
    teeSignerAcknowledged: s.teeSignerAcknowledged,
    inputPricePerToken: s.inputPrice.toString(),
    outputPricePerToken: s.outputPrice.toString(),
    updatedAt: new Date(Number(s.updatedAt) * 1000).toISOString(),
    additionalInfo: info,
    reachable: await probe(s.url),
  });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) console.log(`${r.model} | ${r.serviceType} | ${r.provider} | ${r.url} | ${r.verifiability || '-'} | tee_ack=${r.teeSignerAcknowledged} | in=${r.inputPricePerToken} out=${r.outputPricePerToken} | updated ${r.updatedAt} | ${r.reachable}\n   info: ${JSON.stringify(r.additionalInfo).slice(0, 300)}`);
console.log(`\n${rows.length} services on ${RPC}`);
