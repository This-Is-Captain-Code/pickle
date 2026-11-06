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

## smoke:compute — text on testnet (direct) + vision on mainnet Router

```
npm run smoke:compute                 # text + vision; PASS needs both
npm run smoke:compute -- --text-only  # vision reported as SKIPPED (never as PASS)
```
Each part is reported separately (`TEXT PASS/FAIL`, `VISION PASS/FAIL/SKIPPED`).

**Text** — a real `ZeroGDecisionEngine.decide()` call, the same code path as the agents core. The answer must be strict JSON `{choice, reason}` with `choice` from the options; one retry, then UNAVAILABLE.
- The backend comes from `ZEROG_COMPUTE_MODE`. Request ids, validation and safe-stop are identical for both.

| Mode | Network | Paid by | Default model | Request id |
|---|---|---|---|---|
| `direct` (default) | Galileo testnet, broker SDK | `COMPUTE_WALLET` ledger | `qwen/qwen3.8-omni-flash`, provider `0xd6269e…C940`, streaming | `ZG-Res-Key` |
| `router` | Mainnet Router | `ZEROG_ROUTER_KEY` | `0gm-1.0-35b-a3b` | `x_0g_trace.request_id` |

**Vision** — always the mainnet Router, because testnet has no image-capable model (sponsors.md §2).
- Sends `agents/scripts/smoke/fixtures/red-square.png` as a base64 `image_url`. The answer must contain "red".

**Printed per call:** backend, model, latency, **0G request id**, response id, `tee_verified`, provider.

**Needs:**
- Text, direct mode: `COMPUTE_WALLET_PRIVATE_KEY` with a funded compute ledger. Check with `npx tsx zerog/scripts/fund-testnet-compute.ts`, which is read-only; it creates the ledger with `--ledger 3` and funds the provider with `--transfer 0.5`.
- Vision: `ZEROG_ROUTER_KEY` with Router credits.

## smoke:compute-down — safe-stop when 0G is unreachable

```
npm run smoke:compute-down
```
- Points the real engine at five dead endpoints across **both** backends:
  - router: a closed local port; an unresolvable host (`router.invalid`); a local server answering `503 no_available_provider`.
  - direct: the Galileo RPC on a closed port; an unresolvable RPC host. In both, the broker can't initialise.
- For each: `decideOrSafeStop()` (`agents/src/decide.ts`) must return `status: 'UNAVAILABLE'`, the safe-stop hook must fire exactly once, and no decision object may exist.
- No key, funds or network access are needed. The direct cases use a throwaway, unfunded key.
## smoke:storage — _step 4_
## smoke:world — _step 5_
## smoke:zerobot — _step 6_
## smoke:all — _step 7_
