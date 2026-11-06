# @pickle/zerog — 0G integration (Compute decisions + Storage episode log)

Owner: World/0G dev. Implements two interfaces from
[`@pickle/shared`](../shared/src/types.ts) for the **Physical AI: Agents with
a Body** track ($5k incl. $1k best-on-real-hardware):

| Interface | Live class (you build) | Mock (works today) |
|---|---|---|
| `DecisionEngine` | `ZeroGDecisionEngine` ([src/compute.ts](src/compute.ts)) | `MockDecisionEngine` |
| `EpisodeLogger` | `ZeroGEpisodeLogger` ([src/storage.ts](src/storage.ts)) | `MockEpisodeLogger` |

Run the pipeline against your work any time: `ZEROG_MODE=live npm run dev`
from the repo root (default is `mock`). `MockDecisionEngine({unreachable:true})`
simulates an outage so the safe-stop path is testable before anything is live.

## Track rules that shape this package (read first)

1. **A 0G call inside the decision loop** — `decide()` is that call. The
   agents core invokes it when a robot reports stuck, before posting a bounty,
   and when verifying a fix.
2. **Episode log on 0G Storage with a request id per decision** — `append()`
   receives every decision with its `requestId`; upload it and return the
   `rootHash`.
3. **Safe-stop fallback if 0G is unreachable; a fallback that fakes the
   decision disqualifies** — on failure, throw `ZeroGUnreachable` from
   `@pickle/shared`. The agents core catches it and halts the robot + queues
   the owner. Never return a locally fabricated decision.
4. Submission needs **contract deployment addresses** — our Monad escrow
   counts, but having something on Galileo helps; see "On-chain" below.

## 0G Compute brief (researched 2026-11-06)

Two paths — recommendation: **start with Router** (works in an hour), **switch
to Direct** if time allows (TEE-verifiable responses = stronger judging story).

**Router** (OpenAI-compatible):
- Testnet UI https://pc.testnet.0g.ai — connect wallet, deposit 0G, create an
  API key (`sk-`, shown once).
- Base URL: `https://router-api-testnet.integratenetwork.work/v1`. Use the
  `openai` npm package with that baseURL. Request id = response body `id`.
- Model catalog (mainnet list — **confirm what's live on testnet**): cheap TEE
  options include Qwen3.5-Flash, 0GM-1.0-35B-A3B, GPT-5 nano, Claude Haiku 5.5;
  there are purpose-built decision models (Laya, Vela 2.0 9B, `POST /decisions`,
  typed choice/score answers) worth a look since our call is "pick one option".
- Vision models exist (Qwen2.5-VL etc.) if we want the fix-verification photo
  analyzed on 0G too.

**Direct** (`@0gfoundation/0g-compute-ts-sdk`, Node ≥ 20):
- `createZGComputeNetworkBroker(wallet)` on RPC `https://evmrpc-testnet.0g.ai`.
- Funding: `broker.ledger.depositFund(...)` — **ledger creation needs ≥3 0G
  and each provider sub-account locks ≥1 0G, but the faucet
  (https://faucet.0g.ai) gives 0.1/day** → get tokens from 0G mentors/Discord
  on day one or stay on Router.
- Per call: `getServiceMetadata(provider)` → `getRequestHeaders(provider)` →
  POST `${endpoint}/chat/completions`. Request id = `ZG-Res-Key` response
  header; `broker.inference.processResponse(provider, chatID)` verifies the
  TEE signature → set `Decision.verified = true`.
- Rate limits per provider: 30 req/min, burst 5, 5 concurrent.

Decision prompt: reuse the Mumbai pattern — system prompt demands strict JSON
`{choice, reason}` with `choice` ∈ options, validate, retry once, then throw.

## 0G Storage brief

- `npm i @0gfoundation/0g-storage-ts-sdk ethers` (ethers is a peer dep).
- Turbo indexer: `https://indexer-storage-testnet-turbo.0g.ai`; uploads are
  paid in Galileo gas by the same funded wallet.
- In-memory upload (no temp files): `new MemData(bytes)` →
  `indexer.upload(data, rpcUrl, signer)` → `{rootHash, txHash}`.
- Verify retrievability once: `indexer.download(rootHash, './out.json', true)`.
- Storage explorer for the demo: https://storagescan-galileo.0g.ai

## Galileo testnet

Chain id **16602** · RPC `https://evmrpc-testnet.0g.ai` · explorer
https://chainscan-galileo.0g.ai · faucet https://faucet.0g.ai (0.1 0G/day,
Google Cloud faucet also exists; ask Discord for more).

## On-chain / zerobot notes

- zerobot (https://github.com/0gfoundation/zerobot) has deployed contracts we
  can reference or reuse for the "contract deployment addresses" requirement:
  RobotRegistry `0x291162e93D7A80Eb8F738882a28a7a8A5FBA73bb`, CommandDispatcher
  `0x418bA7C231dac8Ef58b534BeE6adC50E703AA753` (both Galileo). Registering our
  sim robot in their registry is cheap judge-appeal.
- zerobot has **no** Storage/episode-log or safe-stop code — don't go looking
  for it there; this package is where those live.

## Submission checklist (0G track)

☐ 0G call in the decision loop ☐ episode log on Storage w/ request id per
decision ☐ replayable sim or live hardware (agents core + sim team own this)
☐ safe-stop demo ☐ repo README + setup ☐ <3 min video ☐ live demo link
☐ contract addresses ☐ team names + Telegram/X.
