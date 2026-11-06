# Smoke tests

Run each one from the repo root. Each prints `PASS`/`FAIL` with details and exits non-zero on failure.
Secrets come from `agents/.env` (gitignored; template: `agents/.env.example`).

**One-time setup:**
```
npm install
npm install --prefix contracts/hardhat
npx tsx agents/scripts/new-wallet.ts DEPLOYER   # prints address only; fund it via https://faucet.0g.ai
```

## smoke:chain — 0G Galileo

```
npm run smoke:chain              # reuse the SmokeStore recorded in shared/addresses.json (1 tx)
npm run smoke:chain -- --fresh   # deploy a new SmokeStore and record it (2 txs)
```
- Compiles `contracts/hardhat/contracts/SmokeStore.sol` with Hardhat 2.29.1, solc 0.8.27 and evmVersion cancun.
- Checks that the RPC reports chain 16602 and prints the deployer's balance.
- **Default:** reuses the recorded SmokeStore. It first checks that the address actually has code on-chain; if not, it deploys a fresh one.
- Calls `set(<timestamp>)`, then reads back `value()` and `lastWriter()`.
- Prints explorer links and the gas cost of each tx.
- **Cost measured:** reuse 0.000121 0G; fresh 0.000743 0G.
- **Needs:** `DEPLOYER_PRIVATE_KEY` funded.
- **Fails if:** the chain ID is wrong, the balance is 0, a tx reverts, or the read-back doesn't match.

## smoke:compute — 0G Router (mainnet)

```
npm run smoke:compute
```
- **Text:** a real `ZeroGDecisionEngine.decide()` call (the same code path as the agents core). The model must answer with strict JSON `{choice, reason}` and `choice` must be one of the options.
- **Vision:** sends `agents/scripts/smoke/fixtures/red-square.png` as a base64 `image_url` data URL. The answer must contain "red".
- **Printed for each call:** model, latency, **0G request id** (`x_0g_trace.request_id`), response `id`, `tee_verified`, provider and cost.
- **Defaults:** `ZEROG_ROUTER_URL=https://router-api.0g.ai/v1`, `ZEROG_MODEL=0gm-1.0-35b-a3b`, `ZEROG_VERIFY_TEE=1`. The test refuses to run against the testnet router URL.
- **Needs:** `ZEROG_ROUTER_KEY` (sk-…). An optional `ZEROG_MANAGEMENT_KEY` (mk-…) lets it print the balance.

## smoke:compute-down — safe-stop when 0G is unreachable

```
npm run smoke:compute-down
```
- Points the real engine at three dead endpoints:
  - a closed local port;
  - an unresolvable host (`router.invalid`);
  - a local server answering `503 no_available_provider`.
- For each: `decideOrSafeStop()` (`agents/src/decide.ts`) must return `status: 'UNAVAILABLE'`, the safe-stop hook must fire exactly once, and no decision object may exist.
- No key or network access is needed.
## smoke:storage — _step 4_
## smoke:world — _step 5_
## smoke:zerobot — _step 6_
## smoke:all — _step 7_
