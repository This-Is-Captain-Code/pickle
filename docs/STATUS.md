# STATUS — sponsor setup (World + 0G)

Owner: Gopika. Scope and rules are in the brief (CLAUDE.md). Facts and sources are in [sponsors.md](sponsors.md).

| # | Step | State | Time to first PASS |
|---|---|---|---|
| 1 | Research → docs/sponsors.md | ✅ done 2026-11-06 | n/a |
| 2 | 0G Chain: deployer wallet, funding, `smoke:chain` | ⏸ waiting on decisions below | — |
| 3 | 0G Compute: `smoke:compute`, `smoke:compute-down` | ⏸ | — |
| 4 | 0G Storage: `smoke:storage` | ⏸ | — |
| 5 | World ID Agent Pass: `smoke:world` (success + denied), start world-debrief.md | ⏸ | — |
| 6 | zerobot: `smoke:zerobot` with mock Go2 | ⏸ | — |
| 7 | `smoke:all`, update STATUS | ⏸ | — |

## Things you must do by hand

| What | Where | Needed for |
|---|---|---|
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
