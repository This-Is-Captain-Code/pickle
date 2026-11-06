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

## smoke:world — World ID 4.0 claim gate (interactive)

```
npm run smoke:world      # keep World App ready: 3 scans
```

**Preflight:** checks that the RP is `registered` and that `WORLD_RP_SIGNING_KEY` signs as the portal's `signer_address`. A wrong key fails here in ~2 s, before anything is posted.

Then it posts bounties A and B (0.001 0G each, 120 s claim window). Each bounty gets its own World ID action, created via the portal MCP.

| Step | What you do | Expected |
|---|---|---|
| 1 | Scan, **approve** | World v4 verify ✔ → `humanHash = keccak256(nullifier)` → `PickleEscrow.claim` ✔ |
| 2 | Nothing | A tampered proof element is rejected by World (`all_verifications_failed`); A's proof replayed against B's action is rejected by our precheck |
| 3 | Scan, **approve again** (same bounty) | Refused: World replay error, or (as observed) World verifies but `hasClaimed` → `HumanAlreadyClaimed`. Nothing sent |
| 4 | Scan, **decline** (or let it time out) | Verification fails → no claim; B stays Open |
| cleanup | — | Cancels B, waits out A's window, then AGENT_2 expires A; escrow goes back to robot G1 |

- **The QR** prints in the terminal and is served at http://localhost:8799/ (`WORLD_QR_PORT`).
- **Needs:** `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_PORTAL_API_KEY`, `WORLD_ENV=production`, AGENT_G1 and AGENT_2 keys, and robot G1 escrow ≥ 0.002 0G.
- **Setup a new app:** run `npx tsx agents/scripts/setup-world-app.mts` yourself. It writes the one-time key to `.env`.
- **Cost measured:** ≈ 0.0015 0G gas (4 txs + cleanup). Payouts are not spent.
- **Last run:** 2026-11-06 20:32, PASS (7 min 10 s).
- **`smoke:all`** skips it unless `SMOKE_INTERACTIVE=1`.
## smoke:zerobot — _not built_

## smoke:all

```
npm run smoke:all
```
- Runs the contract tests and every smoke test, each as its own process, then prints a PASS / FAIL / SKIPPED table.
- A test is SKIPPED when its keys are missing from `agents/.env`. Exits non-zero on any FAIL.
- **Full run cost:** ≈0.009 0G plus 2 × 0.001 demo payouts from robot G1 (refill with `deploy:escrow`).
- Last run (2026-11-06 17:35 IST): 7 PASS · 1 FAIL (`smoke:compute`, 402 no Router balance) · 2 SKIPPED (world, zerobot).
