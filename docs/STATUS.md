# STATUS — sponsor setup (World + 0G)

Owner: Gopika. Scope and rules are in the brief (CLAUDE.md). Facts and sources are in [sponsors.md](sponsors.md).

| # | Step | State | Time to first PASS |
|---|---|---|---|
| 1 | Research → docs/sponsors.md | ✅ done 2026-11-06 | n/a |
| 2 | 0G Chain: deployer wallet, funding, `smoke:chain` | ✅ PASS 2026-11-06 16:06 IST | ~32 min from wallet creation (15:34) to PASS, including funding wait and ~20 min of npm/solc download timeouts |
| 3 | 0G Compute: `smoke:compute`, `smoke:compute-down` | ✅ **PASS 2026-11-06 ~21:00 IST on the mainnet Router** ($4.99 credit, `ZEROG_COMPUTE_MODE=router`, Private/TEE-trust key). Text and vision both on `0gm-1.0-35b-a3b` (TEE), no Standard fallback needed. See "Compute on the Router" below. Testnet direct is shelved (provider requires a 1 0G sub-account reserve). `smoke:compute-down` ✅ | 16:29 → ~21:00 (blocked most of that time on funding) |
| 4 | 0G Storage: `smoke:storage` | ✅ PASS 2026-11-06 17:26 IST (first attempt) | see Pickle session below |
| 5 | World ID 4.0 + IDKit: `smoke:world` (success, tampered, duplicate, cancelled) | ✅ PASS 2026-11-06 20:32 IST. App `app_8db3…c431`, RP `rp_23ff310ecada5143`, one action per bounty; details in world-debrief.md | 1 h 41 min (18:45 → 20:26 first success) |
| 6 | zerobot: `smoke:zerobot` with mock Go2 | ⏸ | — |
| 7 | `smoke:all`, update STATUS | ✅ 2026-11-06 17:35 IST: 7 PASS · 1 FAIL (compute, 402) · 2 SKIPPED | — |

## Pickle work session — 2026-11-06 17:00–17:40 IST (branch `gopika/sponsor-setup`, PR #1)

| Part | What | Result |
|---|---|---|
| 0 | Push 15 commits to `gopika/sponsor-setup`, open PR | ✅ https://github.com/This-Is-Captain-Code/pickle/pull/1 |
| 1 | `PickleEscrow` contract + 31 Hardhat tests | ✅ 31 passing (every revert, happy path, claim→expire, same human twice, cancel/expire while paused, reentrancy) |
| 2 | `AGENT_G1`, `AGENT_2` wallets + `npm run wallets` | ✅ |
| 3 | Safe sender `agents/src/tx.ts` + `smoke:tx` | ✅ 5 concurrent sends land in nonce order; failing call refused before signing as `NotOwner` |
| 4 | Deploy, verify, register, fund + `smoke:escrow` | ✅ deployed + **verified** on chainscan; live settle (#1) and expire (#2) |
| 5 | 0G Storage `smoke:storage` + Episode logger + `smoke:episode` | ✅ bounty #3 settled with a real storage root that downloads byte-identical |
| 6a | 0G Compute `smoke:compute` | ❌ blocked on 0G: Router account has **no balance** (`402 pay_no_balance`). Also: the model `0gm-1.0-35b-a3b` was renamed to `0gm-1.0-35b-a3b-sia` in the live catalog and is now **text-only**, so the vision check can't pass on it |
| 6b | World `smoke:world` | ⏭ SKIPPED — `WORLD_IDP_CLIENT_ID` empty, `WORLD_IDP_CLIENT_SECRET` is the placeholder |
| 7 | `smoke:all`, docs, PR description | ✅ |

### PickleEscrow design notes

- `claimWindow` is counted **from the claim**: `deadline = claimedAt + claimWindow`. `settle` after the deadline → `ClaimExpired`; `expire` before it → `ClaimNotExpired`. Open (unclaimed) bounties don't expire; the agent cancels them.
- `expire` is terminal (escrow back to the robot's balance). `hasClaimed[bountyId][humanHash]` is never cleared, and is checked **before** status, so the same human re-claiming always gets `HumanAlreadyClaimed`; a different human on a claimed bounty gets `BountyNotOpen`.
- **Pause** blocks `settle` and `withdraw` (money out) and also `postBounty` and `claim` (new obligations). `cancel`, `expire` and `fund` stay open.
- **Added beyond the spec:** `withdraw(robot, to, amount)` (agent only, blocked by pause) so a robot's un-escrowed balance is never stuck; extra errors `NotOwner`, `RobotNotRegistered`, `ZeroAddress`, `ZeroAmount`, `InvalidClaimWindow` (0 or > 30 days), `InvalidHumanHash`, `BountyNotFound`, `ClaimNotExpired`, `NotPaused`, `TransferFailed`, `Reentrancy`. Pause events are `ContractPaused`/`ContractUnpaused` (Solidity won't allow an event and the `Paused` error to share a name).
- `storageRoot` is `bytes32` (0G Storage roots are 32 bytes); `computeRequestId` is a `string`.
- Robots are on-chain IDs `address(keccak256("pickle.robot.<name>"))` with no key. `humanHash = keccak256("pickle.human.<World subject>")`.

### Safe sender (agents/src/tx.ts)

Every write in `agents/` goes through `sendTx`, including `smoke:chain` (migrated this session). The 0G Storage SDK signs its own `Flow.submit` tx, so it runs inside the same per-wallet queue via `runExclusive` (our nonce, floor check first, audited). The deployer has a hard **0.2 0G floor**. Audit log: `agents/logs/audit.jsonl` (gitignored).

### Addresses created this session

| Address | What |
|---|---|
| `0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a` | PickleEscrow (Galileo, verified) — https://chainscan-galileo.0g.ai/address/0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a#code |
| `0xDAD48EdA182bDED77427e7085673A7cA0d4c540A` | AGENT_G1 wallet (agent for robot G1). Key in `agents/.env` |
| `0xabC77d1ee26f0833e0408c137878162dB698D90c` | AGENT_2 wallet (agent for robot R2). Key in `agents/.env` |
| `0xdb8e063E2069Ae59DF257497E58cD3f2fFD7E750` | Robot G1 on-chain ID (no key) |
| `0x5ad164A6e19120410ded00f8C2C7B04E09fD23FF` | Robot R2 on-chain ID (no key) |

### Budget

- 51 txs mined this session, **0.023358 0G** in gas + storage fees (DEPLOYER 0.016534, AGENT_G1 0.006491, AGENT_2 0.000333). Every tx with hash and cost: `agents/logs/audit.jsonl`; summary in the PR.
- Value moved (still ours): agent gas top-ups 0.014412 0G, robot escrow funding 0.007 0G. Demo payouts (4 × 0.001) went to the deployer address.
- Deployer **0.499136 → 0.465190 0G**. AGENT_G1 0.004755, AGENT_2 0.002833. Escrow holds 0.003 (G1 0.002, R2 0.001).
- Typical costs at 4 gwei: deploy 0.005967; postBounty 0.000468; claim 0.000452; settle 0.000242; expire 0.000167; storage upload (≈0.5 KB) ≈0.0012–0.0013, almost all gas (storage fee ≈6e-8 0G).

### Shared-interface changes

- `shared/src/types.ts`: **unchanged.**
- New `shared/abi/PickleEscrow.json`. `shared/addresses.json` gains `galileo.contracts.PickleEscrow` and `galileo.robots`.
- `agents/package.json`: **ethers 6.17.0 → 6.13.1** (exact peer of `@0gfoundation/0g-storage-ts-sdk@1.2.13`; npm `overrides` can't override a peer). Added `@0gfoundation/0g-storage-ts-sdk 1.2.13`.
- `contracts/hardhat`: added test/verify plugins (hardhat-ethers 3.1.0, hardhat-chai-matchers 2.1.0, hardhat-network-helpers 1.1.0, hardhat-verify 2.1.1, chai 4.5.0, ethers 6.17.0).
- The Episode logger lives in `agents/src/episode.ts`. `zerog/src/storage.ts` (`ZeroGEpisodeLogger`) is **still a stub**: see the next point.

### Concurrent work in this tree (not mine, not committed)

A second Claude session in this repo (started ~3 h earlier) was editing `zerog/` (adding the 0G Compute broker SDK and a "direct" testnet mode), plus `agents/src/providers.ts`, `agents/scripts/smoke/compute*.ts` and the root `package-lock.json`, while this session ran. I didn't commit or modify any of it. My lockfile commit was built from a clean checkout so their compute-SDK lock entries weren't included. That's also why I kept the storage SDK in `agents/` and not `zerog/`.

## Addresses

| Address | Purpose | Network | Created |
|---|---|---|---|
| `0x677ec7981a5953367394f94FFB86Ff7CF36e36Cd` | Deployer (contracts on Galileo). Key in `agents/.env` as `DEPLOYER_PRIVATE_KEY` | 0G Galileo 16602 — https://chainscan-galileo.0g.ai/address/0x677ec7981a5953367394f94FFB86Ff7CF36e36Cd | 2026-11-06 |
| `0xaEd150ed47D91A489AfF7631bb06F5d4CCBF2162` | SmokeStore (smoke:chain test contract, not used by app) | Galileo — https://chainscan-galileo.0g.ai/address/0xaEd150ed47D91A489AfF7631bb06F5d4CCBF2162 | 2026-11-06 |
| `0xAf7F5E66959125bba8a62D59Be8664745864F0ad` | **COMPUTE_WALLET**: pays the 0G Compute ledger (testnet direct). Kept separate so compute never sends from the deployer while other processes use it. Key in the compute worktree's `agents/.env` as `COMPUTE_WALLET_PRIVATE_KEY`. Unfunded; ≥ 3.5 0G requested | Galileo — https://chainscan-galileo.0g.ai/address/0xAf7F5E66959125bba8a62D59Be8664745864F0ad | 2026-11-06 17:55 |

Funding received: 0.5 0G at the deployer (confirmed via `eth_getBalance` before the first tx).

## Transactions

| Purpose | Hash | Cost |
|---|---|---|
| Deploy SmokeStore | [0x990dfdf8…3218d](https://chainscan-galileo.0g.ai/tx/0x990dfdf8ba9ea9f6a7fbce1c0507f25bc00d32b413193f691547f8527663218d) | 0.000474188 0G |
| `set(1793961404343)` | [0xc1bcb73e…cbc88](https://chainscan-galileo.0g.ai/tx/0xc1bcb73e48fdfb55805f51a84c2f99e7824c74a837e6fef1a42de585025cbc88) | 0.000268676 0G |

Deployer balance after step 2: 0.499257 0G.

### Compute on the Router (2026-11-06 ~21:00 IST)

| Call | Key | Model | Latency | 0G request id | Trust / TEE | Cost |
|---|---|---|---|---|---|---|
| Text decision → `post_teleop_bounty` | TEE (Private) | `0gm-1.0-35b-a3b` | 3038 ms | `b1dbde8e-e713-40a9-9afc-677b1f4634b5` | `x-0g-e2ee: sealed`; `tee_verified` not returned | 30 µUSD |
| Vision, red square → "red" | TEE (Private) | `0gm-1.0-35b-a3b` | 2123 ms | `37f6871e-26f0-4f56-9e7b-62450a072cef` | `x-0g-e2ee: sealed`; `tee_verified` not returned | 7 µUSD |
| Diagnostics (3 probe calls) | TEE | `0gm-1.0-35b-a3b` | — | — | — | 18 + 5 + 63 + 9 µUSD |
| `smoke:all` run, text + vision | TEE | `0gm-1.0-35b-a3b` | 2773 / 2185 ms | `0a74c469-…` | sealed | ~36 µUSD |

- **Credit used today:** ≈ 0.0002 USD of the $4.99.
- **`0gm-1.0-35b-a3b` is a reasoning model.** Without `chat_template_kwargs: {enable_thinking: false}` it spends `max_tokens` on `reasoning_content` and returns `content: ""` (`finish_reason: length`). With thinking off a decision costs ~5–30 µUSD instead of ~63 µUSD. The router client now sends this by default.
- `verify_tee: true` returned **no `tee_verified` field** in Private trust mode, which contradicts the chat-completions doc. The TEE evidence we record is `x-0g-e2ee: sealed`, plus the catalog's `tee_attested: true` (`TDX`, verified via dstack).
- The Router bills USD credit: `x_0g_trace.billing.total_cost_usd_micro`.
- **No Standard key in `agents/.env`** (`ZEROG_ROUTER_KEY_STANDARD` absent). The fallback exists in code but wasn't needed.

### Merge of `origin/main` (2026-11-06 ~21:10 IST)
- Merged 45 commits from `main` into `gopika/sponsor-setup` as `543fbd9`.
- **Conflicts:**
  - `agents/package.json`: union of both sides. Ours: `@0gfoundation/0g-storage-ts-sdk 1.2.13`, `dotenv 16.6.1`, `ethers 6.13.1`. Main's: `mqtt ^5.10.4`, `ws ^8.21.3`, dev `@types/ws`. Main's `serve` and `fake-watcher` scripts kept.
  - `package-lock.json`: took main's, then `npm install` added our exact pins on top. One `ethers@6.13.1` across the workspace.
  - `agents/.env.example`: merged automatically (main's device and teleop sections plus our World/0G sections), then updated: compute default `router`, `ZEROG_ROUTER_KEY_STANDARD` added.
- **Pre-existing type error on main** (`agents/src/tools/hand-vs-sim.ts`, `origin` possibly null) fixed with a local snapshot in `ed54d20`. `main` alone fails `npm run typecheck` with it.
- `sim/` and `teleop/` are untouched: byte-identical to `origin/main`.
- **Post-merge refill** (`deploy:escrow`): AGENT_G1 gas +0.00772, AGENT_2 +0.00033, robot G1 escrow +0.004. Deployer 0.2694 → 0.2570 0G. A leftover open bounty #22 (from a failed escrow run) was cancelled.

### Compute small-budget attempt (2026-11-06 20:45 IST, approved by Gopika)
Goal: create the 0G Compute ledger at the **contract** minimum (0.1 0G) instead of the SDK's client-side 3 0G, via `zerog/scripts/fund-compute-direct.mts`, which calls LedgerManager directly.

| # | Purpose | From → to | Tx | Value | Gas |
|---|---|---|---|---|---|
| 1 | Fund COMPUTE_WALLET | DEPLOYER → `0xAf7F…F0ad` | [0xc78f9a51…](https://chainscan-galileo.0g.ai/tx/0xc78f9a51f21579ca66f787975253a2305816334a23a2dc916bfe618ee4aaa0f3) | 0.17 0G | 0.000084 0G |
| 2 | `addLedger('')`, accepted below SDK minimum | COMPUTE_WALLET → LedgerManager `0xE708…E406` | [0x994afbd1…](https://chainscan-galileo.0g.ai/tx/0x994afbd1748539d350dc07809d8a416047c40c7bddd9d2044ec72ad1558b020b) | 0.15 0G | 0.000719 0G |
| 3 | `transferFund` 0.05 → provider `0xd626…C940`. Service name = `getServiceInfo(InferenceServing).fullName`; the literal `"inference"` reverts `ServiceNotFound(address)` | ledger → sub-account | [0x8598dc2b…](https://chainscan-galileo.0g.ai/tx/0x8598dc2b6a79d45a1b191bc282d05674d7f516e45c81347b53d72f24014bedb8) | (0.05 internal) | 0.001783 0G |
| 4 | Text request → **HTTP 400** (exact error below) | — | — | — | 0 |
| 5 | `retrieveFund` (refund) | sub-account → `pendingRefund` (24 h lock) | [0x33dfd994…](https://chainscan-galileo.0g.ai/tx/0x33dfd994326097551230a19bfa37a31e0378960104a8003cb9adae63da8e13b8) | (0.05 internal) | 0.000952 0G |
| 6 | `refund(0.1)` | ledger → COMPUTE_WALLET | [0x3c603dd6…](https://chainscan-galileo.0g.ai/tx/0x3c603dd6138f634809222c1753ee534c320747a751497a93ea35436aa6bbf71c) | 0.10 0G back | 0.000311 0G |

- **Exact provider error (step 4):** `HTTP 400 {"error":"validate request: insufficient balance: your locked balance is 0.050000 0G, but the required minimum is 1.000000 0G (breakdown: minimum reserve 1.000000 0G + unsettled fees 0.000000 0G + current request fee 0.000000 0G). Please add more funds with: 0g-compute-cli transfer-fund --provider 0xd6269e257761705B9e442E59794703762DFcC940 --amount <amount>"}`
- **Vision on `qwen3.8-omni-flash`:** not testable. Every request is rejected by the balance check before the content is read, and the provider's `/v1/models` already says `input_modalities: ["text"]`.
- **Totals:** gas 0.003849 0G (spent).
  - 0.116235 0G is back in COMPUTE_WALLET.
  - **0.05 0G is locked** in `pendingRefund` until ≈ **2026-11-07 20:48 IST** (`InferenceServing.lockTime = 86400 s`). Claim it then with `--retrieve` followed by `--refund 0.05`.
  - DEPLOYER: 0.440290 → **0.270206 0G** (stays above the 0.2 floor).
- **Conclusion:** the provider enforces a **1 0G minimum reserve** server-side. The SDK's 3 0G ledger rule is stricter than the contract's 0.1, but the provider's 1 0G is real. Minimum to run testnet text compute: ledger ≥ 0.1 + sub-account ≥ 1.0 + per-request fees → **≈ 1.1 0G** at COMPUTE_WALLET (it already holds 0.116).

## Packages installed

| Package | Version | Where | Why / source |
|---|---|---|---|
| ethers | 6.17.0 | agents | 0G Storage SDK peer dep (0G-STORAGE); chain client |
| dotenv | 16.6.1 | agents | load `agents/.env`; matches zerobot's `^16.6.1` |
| hardhat | 2.29.1 | contracts/hardhat (dev) | D2: Hardhat 2 (0G-DEPLOY shows Hardhat; zerobot uses ^2.22) |
| solc | 0.8.27 (downloaded by Hardhat) | — | zerobot config; cancun per 0G-DEPLOY |
| tsx 4.23.15, typescript 5.9.3 | (root, already in lockfile) | root | ran `npm install` at the root, which had never been run |
| @0gfoundation/0g-compute-ts-sdk | 0.9.0 | zerog | testnet direct compute + read-only provider listing (0G-INF; latest on NPM). ESM build broken → loaded via CommonJS |
| ethers | 6.13.1 | zerog | SDK peer dep; pinned to the same version as `agents/` so there is one copy (two copies break the SDK's `Wallet` types) |

## Decisions (made 2026-11-06)

- **D1:** Build into the existing `agents/`, `world/` and `zerog/` packages. Keys go in `agents/.env`.
- **D2:** Hardhat 2 + ethers v6, solc 0.8.27, evmVersion cancun.
- **D3:** Mainnet Router `https://router-api.0g.ai/v1` with model `0gm-1.0-35b-a3b`. Credits come from 0G mentors.
- **D4:** `vendor/zerobot`, pinned to `c8328ad`, gitignored, with setup commands in a README. WebRTC is timeboxed to 20 min, then fall back to WSL.
- **Storage wallet:** 0G Storage reuses the deployer wallet (decided 16:29).
- **smoke:chain** reuses the recorded SmokeStore by default; `--fresh` redeploys.
- **World:** use **production** `auth.world.org`. The proof source is swappable: production | sandbox | mock. Uniqueness is per bounty: a unique `(iss, sub, bountyId)` record, persisted, with no reset. Details in [world-debrief.md](world-debrief.md).
- **Compute client:** plain `fetch` against the Router instead of the `openai` SDK. It needs no dependency, gives full control of timeouts and retries, and reads `x_0g_trace` and error codes raw.
- **World:** the proof source is swappable (`sandbox` | `mock`). Validation always runs on our backend.

## File plan (for teammate coordination)

| File | Change |
|---|---|
| `agents/package.json`, `agents/.env.example`, `package-lock.json` | Deps + env vars (done for step 2) |
| `agents/scripts/new-wallet.ts` | New (done) |
| `agents/scripts/smoke/*.ts` | New: one per smoke test + `all.ts` |
| `agents/src/providers.ts` | Small edit: new World/0G config fields and defaults (mainnet router URL, model, proof source). The mock defaults stay unchanged |
| `agents/src/chain.ts` | New: minimal 0G Chain client |
| `agents/src/decide.ts` | New: `decideOrSafeStop()` → `OK` or `UNAVAILABLE` + safe-stop |
| `zerog/src/router.ts` | New: Router HTTP client |
| `zerog/src/index.ts` | Export the new router helpers |
| `zerog/src/compute.ts` | Implement `ZeroGDecisionEngine` (router mode) |
| `zerog/src/storage.ts` | Implement `ZeroGEpisodeLogger` |
| `zerog/package.json` | Deps |
| `world/src/agentpass.ts` | Implement `AgentPassCheckpoint` (device grant + backend validation) |
| `world/src/proof-source.ts` | New: `sandbox` / `mock` proof source behind one interface |
| `world/package.json` | Deps |
| `contracts/hardhat/` | New, self-contained Hardhat 2 project for the smoke contract. Kept separate from the teammate's escrow port |
| `shared/addresses.json` | New: deployed addresses |
| `shared/src/types.ts` | **No changes planned.** If one becomes necessary I'll ask first |
| `vendor/README.md`, `.gitignore` | zerobot setup commands; ignore `vendor/zerobot/` |
| `package.json` (root) | Add `smoke:*` scripts |
| `docs/smoke-tests.md`, `docs/world-debrief.md` | New |

Not touched: `world/src/idkit.ts`, `world/src/mock.ts`, `zerog/src/mock.ts`, `agents/src/index.ts`, `sim/`, `teleop/`.

## Things you must do by hand

| What | Where | Needed for |
|---|---|---|
| **0G Compute credits:** the Router key works but the account has no balance (`402 pay_no_balance`). Deposit at pc.0g.ai or get mentor credits. Then set `ZEROG_MODEL` to a live model: `0gm-1.0-35b-a3b` is gone, and `0gm-1.0-35b-a3b-sia` is text-only, so vision needs a different model (e.g. a `-vl` one) | https://pc.0g.ai | smoke:compute |
| **World:** create the IdP client and paste `WORLD_IDP_CLIENT_ID` + `WORLD_IDP_CLIENT_SECRET` into `agents/.env`. Then smoke:world can be built and run (it needs you to approve on your phone) | see rows below | smoke:world |
| Fund the deployer wallet. Faucet gives 0.1 0G/day per wallet; ask 0G mentors/Discord for more (≥ 1 0G is comfortable for chain + storage) | https://faucet.0g.ai · https://cloud.google.com/application/web3/faucet/0g/galileo · https://discord.gg/0glabs | step 2, 4 |
| 0G Compute: sign in, deposit, create an `sk-` API key, paste it into `agent/.env` yourself. Mainnet `pc.0g.ai` or testnet `pc.testnet.0g.ai` depending on decision D3. Optionally also an `mk-` key (Settings → Management Keys) for balance checks | https://pc.0g.ai (Dashboard → Deposit / API Keys) | step 3 |
| Ask 0G mentors: is the testnet Router alive, and can we get testnet credits? Free-credits link from pc.0g.ai: https://iai.finance/#/get | venue / Discord | step 3 |
| World: register an OIDC client in the **sandbox** portal. Auth method `client_secret_post`; register any HTTPS redirect URI (required even for device-only). Paste `client_id` + `worldidp_client_secret_…` into `agent/.env` yourself | https://sandbox.auth.world.org/portal (Google sign-in) | step 5 |
| Ask World mentors **how mocked proofs work at this event**. The docs only describe a sandbox World ID: integration-contact invite → iOS TestFlight → Manual verify → ~1 h issuance | venue | step 5 |
| Optional: try the device flow in the OAuth playground to see the human side before our code runs | https://oauth-playground.toolsforhumanity.dev/ | step 5 |

## Decisions needed before step 2

- **D1 — repo layout vs brief.** The brief's layout differs from what's already in the repo:

  | Brief says | Repo already has (teammate scaffold) |
  |---|---|
  | `agent/` | `agents/` |
  | `vendor/` | — (doesn't exist) |
  | `shared/addresses.json` | `shared/src/types.ts` |
  | — | `world/` and `zerog/` packages with `HumanVerifier` / `ApprovalCheckpoint` / `DecisionEngine` / `EpisodeLogger` interfaces and mocks |

  **Recommendation:** put the clients and smoke tests in the existing `world/` and `zerog/` packages and keep `.env` in `agents/.env`, so the real code lands where the pipeline already expects it.
- **D2 — contracts tooling.** zerobot uses Hardhat 2.22, solc 0.8.27 and cancun. **Recommendation:** match zerobot (Hardhat 2.x + ethers v6). It's the setup proven on Galileo, and 0G-DEPLOY's examples are Hardhat 2-era.
- **D3 — Compute network.** The testnet Router (`router-api-testnet.integratenetwork.work`) fails its TLS handshake from here, and pc.testnet.0g.ai shows 0 models.

  | Option | What it needs |
  |---|---|
  | (a) mainnet Router `router-api.0g.ai` | Real 0G or USD/Stripe credits; it's cheap — about $0.08 per 1M tokens on `0gm-1.0-35b-a3b` |
  | (b) testnet Direct broker | ≥ 3 + 1 0G testnet |
  | (c) wait for mentors | — |

  **Recommendation:** (a), with keys from pc.0g.ai, unless mentors confirm the testnet Router is alive.
- **D4 — zerobot vendoring.** **Recommendation:** gitignored clone at `vendor/zerobot`, pinned to commit `c8328ad`, rather than a submodule. It's read-only and avoids nested-git friction for teammates.
- **D5 — escrow chain.** `contracts/README.md` (teammate) plans the escrow on **Monad**, but the 0G track needs contract addresses on 0G Chain. This is a heads-up only, not my scope; `smoke:chain` deploys a tiny test contract on Galileo either way.

## Doc conflicts found (details in sponsors.md)

- **0G testnet Router:** only the router overview page mentions it; the quickstart and overview pages show mainnet only. It is unreachable as of today.
- **0G deploy page:** links the mainnet explorer and uses ethers-v5 APIs.
- **0G Storage:** the standard-mode testnet indexer URL is missing from every page.
- **World:** the `selfie` acr values are documented but absent from both discovery docs. The step-up guide mixes `value` and `values`. Sandbox supports refresh/token-exchange; production does not.
- **zerobot:** its peer range `@roamhq/wrtc ^0.8.0` excludes the latest 0.10.0.

### Live pipeline rehearsal (2026-11-07, demo service)

Full bounty pipeline PASS with WORLD_MODE=live + ZEROG_MODE=live through the actual agents service (not smoke scripts): power-loss -> 0G decision (post_physical_bounty, req 35792aa1) + episode on Storage (0x28c88be1...) -> claim page on a phone -> REAL World ID Proof of Human approved in World App (nullifier 0x07d15e0d05...) -> VBUS proof (device-only fake watcher, FAKE_DEVICE=1) -> 0G verdict (fix_confirmed, req 970e75a7) -> VERIFIED. The claim page now renders the World connectorURI (QR + open-in-World-App link). Remaining: same take on real Watcher hardware at the venue.
