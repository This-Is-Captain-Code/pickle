# Smoke tests

Run each one from the repo root. Each prints `PASS`/`FAIL` with details and exits non-zero on failure.
Secrets come from `agents/.env` (gitignored; template: `agents/.env.example`).

**One-time setup:**
```
npm install
npm install --prefix contracts/hardhat
npx tsx agents/scripts/new-wallet.ts DEPLOYER   # prints address only; fund it via https://faucet.0g.ai
npx tsx agents/scripts/new-wallet.ts AGENT_G1   # robot G1's agent (refuses to overwrite)
npx tsx agents/scripts/new-wallet.ts AGENT_2    # robot R2's agent
npm run wallets                                 # name, address, role, balance, explorer link
npm run deploy:escrow                           # idempotent: deploy/register/top up/fund only what's missing
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
## contracts — PickleEscrow unit tests

```
npm run test:contracts      # = npm test --prefix contracts/hardhat
```
- 31 tests on the in-process Hardhat network, with no keys and no 0G spent.
- **Covers:** every custom error, the happy path, claim → expire, the same humanHash claiming the same bounty twice (also after expiry), cancel/expire/fund while paused, settle/withdraw/post/claim blocked while paused, a rejecting worker (`TransferFailed`), and a reentrant worker (`Reentrancy`).

## smoke:tx — safe sender (agents/src/tx.ts)

```
npm run smoke:tx
```
- **A:** fires five 0-value deployer self-transfers at once (21k gas, the cheapest tx). They must all mine with consecutive nonces, in nonce order, with no nonce errors.
- **B:** `PickleEscrow.setMaxPayout` from AGENT_G1 (not the owner) must be **refused before signing** as `NotOwner`, and AGENT_G1's nonce must not move.
- **Cost measured:** 0.00042 0G.
- Every attempt is appended to `agents/logs/audit.jsonl`.

## smoke:escrow — live bounties on PickleEscrow

```
npm run smoke:escrow
```
- **Happy path:** `postBounty(0.001)` → `claim` → `settle` with a dummy computeRequestId and storageRoot. Checks status Settled and that the event carries both refs.
- **Fail path:** `postBounty` → `claim` with a 20 s window → waits on **chain time** → a late `settle` is refused as `ClaimExpired` (nothing sent) → `expire` by AGENT_2 (a third party). Checks status Expired and that the robot's escrow is refunded.
- **Cost measured:** ≈0.00225 0G gas. The worker is the deployer address (override with `SMOKE_WORKER_ADDRESS`), so payouts come back.
- **Needs:** `deploy:escrow` run, and robot G1 escrow ≥ 0.001 (re-run `deploy:escrow` to refill).

## smoke:storage — 0G Storage

```
npm run smoke:storage
```
- Uploads a timestamped sample episode (~460 B) via the turbo indexer, paid by the DEPLOYER (inside its sendTx queue, with the 0.2 0G floor checked).
- Checks that the returned root equals the locally computed Merkle root, then downloads with proof verification and byte-compares.
- **Cost measured:** ≈0.0012–0.0013 0G per upload.

## smoke:episode — bounty settled with a real 0G Storage root

```
npm run smoke:episode
```
- Episode entries: `stuck_detected` → `bounty_posted` (tx hash) → `human_verified` → `fix_verified` (compute request ID).
- `sealEvidence()` uploads the episode to 0G Storage. `settle(computeRequestId, root)` must emit that root.
- The on-chain root is downloaded and must be byte-identical to what was sealed.
- `finalize()` then uploads the full episode with `paid` (settle tx hash) and `evidenceRoot`.
- **Placeholders:** until World and Compute are live, `human_verified`/`fix_verified` IDs are labelled `placeholder-…`.
- **Cost measured:** ≈0.0012 0G gas + ≈0.0027 0G storage.
- Local mirror: `agents/logs/episodes/<id>.jsonl`.

## smoke:world — _not built: World IdP client keys missing_
## smoke:zerobot — _not built_

## smoke:all

```
npm run smoke:all
```
- Runs the contract tests and every smoke test, each as its own process, then prints a PASS / FAIL / SKIPPED table.
- A test is SKIPPED when its keys are missing from `agents/.env`. Exits non-zero on any FAIL.
- **Full run cost:** ≈0.009 0G plus 2 × 0.001 demo payouts from robot G1 (refill with `deploy:escrow`).
- Last run (2026-11-06 17:35 IST): 7 PASS · 1 FAIL (`smoke:compute`, 402 no Router balance) · 2 SKIPPED (world, zerobot).
