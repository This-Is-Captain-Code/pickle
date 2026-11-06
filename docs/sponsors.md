# Sponsor facts — 0G (Chain, Compute, Storage), World ID Agent Pass, zerobot

Researched 2026-11-06 from official docs/repos only. Every fact has its source. "NOT FOUND" = not on the
official pages read; do not fill from memory. "Probed" = checked live from our machine on 2026-11-06.

Source keys used below:

| Key | URL |
|---|---|
| 0G-TESTNET | https://docs.0g.ai/developer-hub/testnet/testnet-overview (updated 2026-09-02) |
| 0G-DEPLOY | https://docs.0g.ai/developer-hub/building-on-0g/contracts-on-0g/deploy-contracts (updated 2026-09-02) |
| 0G-STORAGE | https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk (updated 2026-09-02) |
| 0G-OV | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview |
| 0G-ROUTER | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview |
| 0G-QS | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart |
| 0G-AUTH | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/authentication |
| 0G-CHAT | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/chat-completions |
| 0G-IMG | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/image-inputs |
| 0G-DEP | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/account/deposits |
| 0G-ERR | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/errors |
| 0G-MODELS | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/models |
| 0G-INF | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference (Direct / broker SDK) |
| PC | https://pc.0g.ai · https://pc.0g.ai/models · https://pc.testnet.0g.ai/models |
| PC-API | https://router-api.0g.ai/v1/models (live JSON, no auth) |
| W-DOCS | https://auth.world.org/docs |
| W-DISC | https://auth.world.org/.well-known/openid-configuration |
| W-SDISC | https://sandbox.auth.world.org/.well-known/openid-configuration |
| W-REG | https://auth.world.org/docs/guides/app-registration |
| W-OIDC | https://auth.world.org/docs/guides/oidc |
| W-STEP | https://auth.world.org/docs/guides/step-up |
| W-IDT | https://auth.world.org/docs/guides/id-token |
| W-TEST | https://auth.world.org/docs/guides/testing |
| ZB | https://github.com/0gfoundation/zerobot @ `c8328ad9255751a70d814c26e32ac88a287e5b24` (2026-10-16) |
| NPM | `npm view <pkg> version` on 2026-11-06 |

---

## 1. 0G Chain — Galileo testnet

| Fact | Value | Source |
|---|---|---|
| Network name | 0G Galileo Testnet | 0G-TESTNET |
| Chain ID | `16602` (probed: `eth_chainId` → `0x40da` = 16602) | 0G-TESTNET, 0G-DEPLOY, probed |
| RPC | `https://evmrpc-testnet.0g.ai` ("development only, use a 3rd party RPC for production") | 0G-TESTNET |
| 3rd-party RPCs | QuickNode, ThirdWeb (`https://thirdweb.com/16602`), Ankr, dRPC | 0G-TESTNET |
| Native token | `0G` (1 0G = 1e18 neuron) | 0G-TESTNET, 0G-DEP |
| Explorer | `https://chainscan-galileo.0g.ai` | 0G-TESTNET |
| Faucet | `https://faucet.0g.ai` — **0.1 0G per wallet per day** | 0G-TESTNET |
| Faucet (Google Cloud) | `https://cloud.google.com/application/web3/faucet/0g/galileo` | 0G-TESTNET |
| More tokens | Discord `https://discord.gg/0glabs` | 0G-TESTNET |
| Compiler | `evmVersion: "cancun"` is required; doc example solc `0.8.19`, optimizer 200 runs; "invalid opcode" → set cancun or downgrade solc | 0G-DEPLOY |
| Tooling shown | Hardhat, Foundry, Truffle, solc (viem only appears in the verify plugin list) | 0G-DEPLOY |
| Verify API | `apiURL: https://chainscan-galileo.0g.ai/open/api`, `browserURL: https://chainscan-galileo.0g.ai`, placeholder API key is fine | 0G-DEPLOY |
| zerobot's Hardhat setup | Hardhat `^2.22.0`, toolbox `^5`, solc `0.8.27`, `evmVersion: "cancun"`, network `galileo` chainId 16602 | ZB `contracts/hardhat.config.ts`, `contracts/package.json` |
| Mainnet (reference only) | chain 16661, `https://evmrpc.0g.ai`, `https://chainscan.0g.ai` | 0G-DEPLOY |

**Doc inconsistencies**
- 0G-DEPLOY links "0G Chain Scan" to the mainnet explorer `chainscan.0g.ai`, and its success example shows a mainnet URL. Use `chainscan-galileo.0g.ai` for testnet.
- 0G-DEPLOY's Hardhat deploy snippet uses the ethers v5 API (`token.deployed()`, `token.address`). Current Hardhat is v3 (`3.21.2`, NPM) and ethers is v6.

### Our deployment — PickleEscrow (live, 2026-11-06)

| What | Value |
|---|---|
| PickleEscrow | `0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a`, **source verified**: https://chainscan-galileo.0g.ai/address/0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a#code |
| Deploy tx | https://chainscan-galileo.0g.ai/tx/0x904c0eaa9f6482f82251d5b95dcf248269eafecf33a581b509c4f9c62422ce89 (0.005967 0G) |
| Owner (deployer) | `0x677ec7981a5953367394f94FFB86Ff7CF36e36Cd` |
| Max payout / demo payout | 0.005 0G / 0.001 0G |
| Robot G1 → agent | `0xdb8e063E2069Ae59DF257497E58cD3f2fFD7E750` → AGENT_G1 `0xDAD48EdA182bDED77427e7085673A7cA0d4c540A` |
| Robot R2 → agent | `0x5ad164A6e19120410ded00f8C2C7B04E09fD23FF` → AGENT_2 `0xabC77d1ee26f0833e0408c137878162dB698D90c` |
| ABI | `shared/abi/PickleEscrow.json`; addresses in `shared/addresses.json` |
| Example settle with a real 0G Storage root | bounty #3: https://chainscan-galileo.0g.ai/tx/0x4c9522fac3155359a5cefdb3a8dfcf6345346e2f795d148b7edeeda6e61dfa48 — `storageRoot` `0x7ece716869cb196bc3dad0ae71549a88522346087f8cb1afa31b25031a9b48cc` |
| Example expire (fail path, called by a third party) | bounty #2: https://chainscan-galileo.0g.ai/tx/0x094c7f8737c76fd91a096bd11bb58e6c48ca9b620272f49dd9fd610661faaca4 |

- **Verification works** with `@nomicfoundation/hardhat-verify` 2.1.1, `customChains` apiURL `https://chainscan-galileo.0g.ai/open/api` and a placeholder API key (`npx hardhat verify --network galileo <addr> 5000000000000000` in `contracts/hardhat`). It prints an Etherscan-v2 deprecation warning but succeeds.
- **Gas price observed:** ~4 gwei (`maxFeePerGas` 4000000014, `maxPriorityFeePerGas` 4000000000), EIP-1559 type 2.

## 2. 0G Compute — Private Computer / Router (OpenAI-compatible)

**Two separate environments.** "Mainnet and testnet are fully separate environments": separate UI, API endpoint, balances and keys (0G-ROUTER).

| | Mainnet | Testnet | Source |
|---|---|---|---|
| Web UI | `https://pc.0g.ai` | `https://pc.testnet.0g.ai` | 0G-ROUTER |
| API base | `https://router-api.0g.ai/v1` | `https://router-api-testnet.integratenetwork.work/v1` | 0G-ROUTER |
| Payment Layer contract | `0xA3b15Bd2aD18BFB6b5f92D8AA9F444Dd59d1cE32` | `0x0AD9690e0b34aB2d493DE02cDF149ee34f6C9939` | 0G-DEP |
| Probed 2026-11-06 | `/v1/models` → 200, 125 models | **TLS handshake fails** ("schannel: failed to receive handshake") on both `/v1/models` and `/`; `pc.testnet.0g.ai/models` renders **0 models in every category** | probed, PC |

⚠️ **The testnet Router looks unusable right now.** 0G-OV and 0G-QS only document the mainnet host. Only 0G-ROUTER mentions the testnet host, and it is not on an 0g.ai domain. → **Decision needed (see §7).**

**Auth** (0G-QS, 0G-AUTH, 0G-DEP)
- Sign in at pc.0g.ai with a wallet (MetaMask/WalletConnect) or via Privy (Google, X, Discord, TikTok).
- Deposit 0G to the Payment Layer: pc.0g.ai → Dashboard → Deposit. A minimum deposit is NOT FOUND.
- PC FAQ: "supports both 0G Mode and USD Mode", with USD paid by Stripe. 0G-DEP mentions only 0G deposits.
- PC home has a "Get free credits" link to `https://iai.finance/#/get`. It is not documented anywhere in the docs.
- API key: Dashboard → API Keys, `sk-…`, shown once. Header: `Authorization: Bearer sk-…`.
- `mk-…` management keys are needed for `/v1/account/*` (e.g. `GET /v1/account/balance`). An `sk-` key gets `403 insufficient_scope` there.
- Optional header `X-0G-Provider-Trust-Mode: verified|private` (default Standard) (PC).

**Request ID** (0G-CHAT, 0G-ERR)
- Success responses: `x_0g_trace.request_id` (UUID, "Quote it in any support ticket"). `x_0g_trace` also carries `provider` and `billing.total_cost` (neuron).
- Error responses: top-level `"request_id": "req_…"`.
- Standard `id` is also present, but the docs don't say it equals `request_id`. → We log **both**, and `x_0g_trace.request_id` is the canonical one.
- TEE: body `verify_tee: true` makes the Router verify the provider's TEE signature synchronously, and `x_0g_trace.tee_verified` is then returned (0G-CHAT).
- `ZG-Res-Key` header exists only on the Direct path (0G-INF), not the Router.

**Vision request** (0G-IMG) — `POST /v1/chat/completions`
```json
{"model":"<id>","messages":[{"role":"user","content":[
  {"type":"text","text":"..."},
  {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBOR..."}}]}]}
```
- Prefer base64 ("Send base64 when you need the request to succeed reliably").
- More than 20 MB after base64 encoding → 413.
- A model that can't take images → 400 `model_not_capable`, not charged.
- "There is no fee for images" beyond their input tokens.
- Check capability with `architecture.input_modalities` containing `"image"` in `GET /v1/models` (0G-MODELS). That endpoint needs no auth.

**Model IDs** (from PC-API live JSON, mainnet; testnet catalogue unavailable)

| ID | Input | Notes | USD / token (prompt / completion) |
|---|---|---|---|
| `0gm-1.0-35b-a3b` (**gone from the live catalog 2026-11-06 17:30 IST**; now `0gm-1.0-35b-a3b-sia`, input modalities **text only**) | text, image | **TEE** (`verifiability: TeeML`, TDX, dstack) — vision + verifiable, best fit for the track | 0.00000008 / 0.00000048 |
| `qwen2.5-vl-72b-instruct` | text, image | cheapest vision | 0.000000045 / 0.000000195 |
| `glm-5.3-flash` | text, image | | 0.00000009015 / 0.0000003153 |
| `qwen3.8-flash` | text, image, video | | 0.00000019125 / 0.00000059925 |
| `claude-haiku-5.5` | text, image | PC page says it's served over Anthropic Messages; API lists `supported_formats: ["openai","anthropic"]` | 0.0000001 / 0.0000005 |
| `laya` | text | **TEE** decision model, `type: "decisions"`, `POST /decisions` with `state` + `questions`, free | 0 / 0 |
| `vela-2.0-9b` | text | decision model, `POST /decisions` (PC). Full `/decisions` schema NOT FOUND | $0.04 / 1M input (PC) |

Proposed for smoke tests: text and vision both on **`0gm-1.0-35b-a3b`** (TEE-attested), with `qwen2.5-vl-72b-instruct` as the fallback vision model.

**Errors** (0G-ERR, 0G-DEP)
- 400, 401 (`api_key_revoked`), 402 `insufficient_balance` (body: `{"error":{"code":"insufficient_balance",…},"request_id":"req_…"}`), 403, 404.
- 429 with `Retry-After`; 502 `provider_error`; 503 `no_available_provider`.
- "Do not retry 400, 401, 402, or 403."
- For our safe-stop: network failure, 5xx, 429 after retry, or a malformed answer → `UNAVAILABLE`, never a substituted answer.

**Observed live (2026-11-06 16:45, mainnet Router)** — these differ from the docs:
- A zero-balance account returns `402` with code **`pay_no_balance`** ("Add funds to keep using services."). 0G-ERR and 0G-DEP document `insufficient_balance`. Our code treats any 402 as UNAVAILABLE, so both work.
- Every response, including errors, carries an **`x-request-id` header**, along with `x-0g-gateway-instance` and `x-0g-e2ee` (`sealed` for the TEE model). The 502 body had no `request_id` field, so we log the header on errors.
- Rate-limit headers: `x-ratelimit-limit-requests: 30`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`.
- `0gm-1.0-35b-a3b` → `502 upstream_error` "fetch provider quote: Get https://compute-network-20.integratenetwork.work/v1/quote?legacy=false: EOF". The provider behind the Router is failing.

**Direct / broker path** (0G-INF) — **our text-decision path on testnet** (decision 2026-11-06 17:50; zerobot uses the same path)
- Package `@0gfoundation/0g-compute-ts-sdk` **0.9.0**, installed in `zerog/`; Node ≥ 20.0.0 (0G-INF, NPM `engines`). Peer dep `ethers` is pinned to 6.13.1 to match `agents/` (a second copy breaks the SDK's `Wallet` types).
- **The SDK's ESM build is broken in 0.9.0:** `import` fails with "does not provide an export named 'C'". We load the CommonJS build via `createRequire` (`zerog/src/direct.ts`).
- Contracts (SDK `CONTRACT_ADDRESSES.testnet`): LedgerManager `0xE70830508dAc0A97e6c087c75f402f9Be669E406`, InferenceServing `0xa79F4c8311FF93C06b8CfB403690cc987c93F91E`.
- Read-only discovery: `createReadOnlyInferenceBroker(rpc)` → `listService(offset, limit, includeUnacknowledged)`. The contract caps `limit` at **50** (it reverts with `LimitTooLarge(100, 50)`).
- Per call: `getServiceMetadata(provider)` returns `{endpoint: <url>/v1/proxy, model}` → `getRequestHeaders(provider)` (an `Authorization` header) → `POST {endpoint}/chat/completions`.
  - Request id = the `ZG-Res-Key` response header, else the completion `id`.
  - `processResponse(provider, chatID, usageJson)` checks the TEE signature (true/false/null) and caches fees (SDK typings).
- **Funding — the docs, SDK and contract disagree:**
  - 0G-INF says ledger ≥ 3 0G and each provider sub-account ≥ 1 0G.
  - The **contract** constants are `MIN_ACCOUNT_BALANCE = 0.1 0G` and `MIN_TRANSFER_AMOUNT = 0.01 0G`, read on-chain 2026-11-06.
  - The **SDK enforces 3 0G client-side** for ledger creation (`LedgerProcessor.MIN_LEDGER_BALANCE_OG = 3`), even though its comment says it "matches the MIN_ACCOUNT_BALANCE constant". It only *warns* on transfers below 1 0G.
  - → **We need ≥ 3 0G for the ledger, plus a bit to move into the sub-account. Asked for 3.5 0G.**
- **Auto-funding:** `getRequestHeaders()` on its own tries to move up to 2 0G from the ledger into the provider sub-account (`[Auto-funding] Failed to transfer 2.0000 0G…`, `inference/broker/base.js` `doTransfer`, `MIN_LOCKED_BALANCE = 1 0G`). That's ledger → sub-account, never from the wallet, but it does send transactions.
- Rate limits (0G-INF): 30 req/min per user per provider, burst 5, 5 concurrent. The provider below is stricter.
- zerobot's `AIBroker` uses this path, with default model `qwen-2.5-7b-instruct` (ZB `sdk/src/ai/broker.ts`). **That model is not registered on testnet today.**
- CLI `@0gfoundation/0gpc` needs macOS/Linux and Node ≥ 22 (PC). It isn't usable on our Windows + Node 20.16 box, and we don't need it.

**Testnet providers — live `listService()` + reachability from our machine, 2026-11-06 17:40 IST**

Produced by `npx tsx zerog/scripts/list-testnet-services.ts`, which is read-only (no wallet).

| Model | Type | Provider | Endpoint | Verifiability | Reachable | Images |
|---|---|---|---|---|---|---|
| `qwen/qwen3.8-omni-flash` | chatbot | `0xd6269e257761705B9e442E59794703762DFcC940` | compute-network-6.integratenetwork.work | TeeML, TEE signer acknowledged | ✅ `/v1/models`, `/v1/quote` → 200 | ❌ `input_modalities: ["text"]` |
| `glm-5.3` | chatbot | `0x1cB95Eb66Cc67C62d4DE0CC96726C5A5d82e7C85` | compute-network-rdv2-b300.integratenetwork.work | TeeML, acknowledged | ❌ ECONNRESET | — |
| `Qwen2.5-0.5B-Instruct` | chatbot | `0x87a13337…8ed4`, `0xA02b95Aa…1A09` | `…-3081/-3083.dstack-pha-in2.phala.network` | — | ❌ ECONNRESET | — |
| `openai/gpt-oss-20b` | chatbot | `0x8e60d466…0049` | compute-network-7.integratenetwork.work | TeeML | ❌ ENOTFOUND (stale since 2025-12) | — |
| `google/gemma-3-27b-it` | chatbot | `0x69Eb5a0B…aE08` | compute-network-8.integratenetwork.work | TeeML | ❌ ENOTFOUND (stale since 2025-12) | — |
| `openai/whisper-large-v3` | speech-to-text | `0xC93C82C2…3Cc4` | compute-network-dev-101.integratenetwork.work | TeeML | ❌ ECONNRESET | — |
| `z-image-turbo` | text-to-image | `0x1cE3f41A…e6dF` | compute-network-dev-100.integratenetwork.work | TeeML | ❌ ECONNRESET | — |

Details for `qwen/qwen3.8-omni-flash` (from the provider's `/v1/models`):
- "Served here as a text chatbot via DashScope (**streaming only**)".
- Rate limits: `requests_per_minute: 10`, `tokens_per_minute: 2000`.
- `provider_type: centralized` (aliyun), `tee_type: TDX`.
- Price: prompt 1.18e12 / completion 4.72e12 neuron per token.
- → **No image-capable model on testnet.** Text decisions use testnet; vision stays on the mainnet Router.

Some `integratenetwork.work` hosts are reachable from here, so this is **not** a blanket network block. The resets look provider-side, though a per-host block can't be ruled out.

## 3. 0G Storage

**Probed 2026-11-06 (smoke:storage / smoke:episode):** `MemData` upload returns `{ txHash, rootHash, txSeq }` (confirmed) and the root equals `MemData.merkleTree().rootHash()` computed locally. A ~0.5 KB upload costs ≈0.0012–0.0013 0G, almost all gas (~300k gas). The storage fee (`tx.value`) is ≈6e-8 0G. Upload takes ~10 s (finality on); download with proof takes ~2 s. The SDK's peer is **exactly** `ethers 6.13.1`, so `agents` pins that. The SDK accepts `uploadOpts.nonce`, which we use to keep it on our per-wallet nonce queue.

| Fact | Value | Source |
|---|---|---|
| Package | `@0gfoundation/0g-storage-ts-sdk` (latest `1.2.13`, NPM) + peer `ethers` (latest `6.17.0`; SDK snippets use the v6 API). Encryption needs SDK ≥ 1.2.6 | 0G-STORAGE, NPM |
| Turbo indexer (testnet) | `https://indexer-storage-testnet-turbo.0g.ai` ("recommended"). Probed: `/` returns 404, which is expected because it's a JSON-RPC endpoint | 0G-STORAGE |
| Standard indexer (testnet) | **NOT FOUND.** 0G-STORAGE says to see the testnet page, which doesn't list it | — |
| Flow contract | auto-discovered from the indexer. Listed on 0G-TESTNET: Flow `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`, Mine `0x00A9E9604b0538e06b268Fb297Df333337f9593b`, Reward `0xA97B57b4BdFEA2D0a25e535bd849ad4e6C440A69` ("may change") | 0G-STORAGE, 0G-TESTNET |
| Fees | Turbo = "faster, higher fees". Payer and token NOT stated explicitly; uploads are signed by an ethers wallet on the 0G RPC, so presumably 0G gas from that wallet | 0G-STORAGE |
| Storage explorer | `https://storagescan-galileo.0g.ai` | 0G-TESTNET |

API shape (0G-STORAGE, verbatim names):
```ts
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
const indexer = new Indexer('https://indexer-storage-testnet-turbo.0g.ai');
const mem = new MemData(new TextEncoder().encode(json));
const [tree, treeErr] = await mem.merkleTree();          // tree.rootHash()
const [tx, err] = await indexer.upload(mem, RPC_URL, signer); // tx.rootHash, tx.txHash (single-fragment)
const dlErr = await indexer.download(rootHash, outPath, true); // true = verify Merkle proof; Node-only, writes a file
```
- `download()` uses `fs.appendFileSync`, so delete `outPath` first or it will append.
- The `rootHash`/`txHash` fields on `tx` are shown for `ZgFile` uploads. For `MemData` they're assumed by analogy and will be confirmed in smoke:storage.

## 4. World ID Agent Pass (= World IdP, OIDC)

The term "Agent Pass" doesn't appear in the docs. The product is **World IdP**, an OIDC provider; its docs headline is "Human continuity for apps and agents" (W-DOCS). The relevant agent features are:
- the **device flow**, "Sign in a headless agent" (W-OIDC);
- **Human checkpoints**: "Pause the agent workflow, complete the step-up procedure, and resume only after your backend accepts the authentication" (W-STEP).

World IdP is separate from IDKit and legacy "Sign in with World ID".

| Fact | Production | Sandbox | Source |
|---|---|---|---|
| Issuer | `https://auth.world.org` | `https://sandbox.auth.world.org` | W-DISC, W-SDISC |
| Device authorization | `/api/v1/device_authorization` | same path on sandbox host (probed: answers `invalid_client` without creds ✔) | W-DISC, W-SDISC |
| Token | `/api/v1/token` | same | W-DISC |
| JWKS | `/.well-known/jwks.json` | same | W-DISC |
| Grants | `authorization_code`, `urn:ietf:params:oauth:grant-type:device_code` | + `refresh_token`, `token-exchange` | W-DISC, W-SDISC |
| Scopes | `openid` | `openid`, `offline_access` | W-DISC, W-SDISC |
| ID token alg | RS256; subject type `pairwise` | same | W-DISC |
| Client auth | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none` | same | W-DISC |
| `acr_values_supported` | `…/acr/orb`, `…/acr/orb-face` | same | W-DISC |
| Portal | `https://auth.world.org/portal` (Google sign-in) | `https://sandbox.auth.world.org/portal` | W-REG, W-TEST |

**Registration** (W-REG)
- Choose one auth method; it's fixed for the client's lifetime. We'll use `client_secret_post`.
- The secret starts with `worldidp_client_secret_` and is shown once.
- Device-only clients **still need a registered HTTPS redirect URI**. Wildcards aren't allowed, and DCR isn't supported.
- Accepted accounts (Orb / Selfie Check / Any) are set in the portal under Settings → Authenticate.

**Device grant** (W-OIDC)
1. Start the request:
   ```
   POST {issuer}/api/v1/device_authorization
   client_id=…&client_secret=…&scope=openid
   ```
   Returns `device_code`, `user_code`, `verification_uri`/`verification_uri_complete`, `expires_in`, `interval`. A full example body is NOT FOUND.
2. Poll:
   ```
   POST {issuer}/api/v1/token
   grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=…&client_secret=…&device_code=…
   ```

How to handle each poll result:

| Result | Action |
|---|---|
| `authorization_pending` (400) | Wait `interval`, then poll again |
| `slow_down` | Add 5 s to all later intervals |
| `access_denied` | Stop → **denied** |
| `expired_token` | Stop → **expired** |
| `invalid_grant` | Stop |
| 503 | "never approval" → end the attempt |
| 429 on start | `Retry-After: 60` |

- The device code expires 20 minutes after creation and can be redeemed once.
- `acr_values` / `claims` are accepted. `nonce`, `prompt` and `max_age` are ignored, because fresh authentication is always required.
- "binding_message or action terms: Unsupported": the human only sees the requester and the user code. → Our backend must show the action summary next to the code.

**ID token validation** (W-OIDC, W-IDT)
- Verify the RS256 signature via JWKS, plus `iss` (exact), `aud` = client_id, and `exp`.
- **Require `auth_time`, `acr` and `amr`.** Use `auth_time` for freshness, not `iat`.
- Device tokens omit `nonce`. Store the (`iss`, `sub`) pair.
- acr strings: `https://world.org/oidc/acr/orb`, `…/orb-face`, `…/selfie`, `…/selfie-face`.
- amr: `["pop"]` = World ID proof; `["pop","face","user"]` = with face check; `["pop","user","mfa"]` = passkey.
- Accounts without verification omit `acr` entirely.

**Testing** (W-TEST)
- Sandbox issuer plus a **sandbox World ID**, which has an Orb-level test credential without visiting an Orb. "Sandbox authentication does not establish that a real person is Orb-verified."
- To get one: ask "your World ID integration contact" for access → iOS TestFlight app → Add proof of human → Manual verify → selfie → "Allow about one hour for issuance".
- OAuth playground: `https://oauth-playground.toolsforhumanity.dev/` runs device flows against the sandbox.
- For validation-failure tests, use "local signed fixtures".
- **Mock proofs / simulator: NOT FOUND in the docs.** The brief says proofs are mocked at this event → ask World mentors how.

**Library**
- The docs don't name one ("Use an OIDC library").
- Proposed: `openid-client` `6.8.9` (NPM), the certified OIDC RP library, or `jose` for JWT/JWKS only. → Pinned when installed.

**Doc inconsistencies (World)**
- The id-token and step-up guides document `…/acr/selfie` and `…/selfie-face`, but neither discovery document lists them in `acr_values_supported`.
- The step-up example uses `"acr":{"essential":true,"value":"…"}` in one place and `"values":[…]` in another. We'll use `values`.
- Production discovery has no `refresh_token`/`offline_access`; sandbox has both, plus token-exchange/ID-JAG. Code tested on sandbox must not depend on them.

## 5. zerobot (read only)

Source for everything here is ZB.
- **What it is**: on-chain robot control. A sender calls `RobotCommandDispatcher.dispatchCommand()` on 0G Galileo → `OperatorNode` watches events → executes on the robot over WebRTC → `submitReceipt()`. Status "Early-stage, testnet only". Apache-2.0.
- **Deployed contracts (Galileo)** — upgradeable proxies:
  - RobotRegistry `0x291162e93D7A80Eb8F738882a28a7a8A5FBA73bb`
  - RobotCommandDispatcher `0x418bA7C231dac8Ef58b534BeE6adC50E703AA753`
  - Third proxy-admin/impl entry `0x289aDd2B07Dee844e7775A05c84bbf6d164815AF`
  - Sources: README, `contracts/.openzeppelin/unknown-16602.json`.
- **SDK**: `@0g-foundation/zerobot-sdk` `0.1.0` — **not published on npm** (`npm view` → 404). It must be built from the clone.
  - Entry points: root (ChainClient, Commander, ChainListener, AIBroker, schemas), `/robot` (Go2Connection), `/operator` (OperatorNode), `/mock` (`startMockRobot(port?: number)`).
  - Deps: `ethers ^6.13.0`, `eventemitter3`, `node-forge`. Peers: `@roamhq/wrtc ^0.8.0` (optional) and `viem ^2.46.0` (optional).
- **Mock robot**: `sdk/src/mock/server.ts` emulates a Go2 Pro.
  - It serves HTTP signaling on port **9991**, sets up a WebRTC peer and data channel, then runs the validation challenge, heartbeat and command ack. Once subscribed it streams `rt/lf/lowstate` telemetry; battery is mocked at 87%.
  - It needs `@roamhq/wrtc`. That package is now at `0.10.0` and ships a `@roamhq/wrtc-win32-x64` prebuilt (NPM), so it should work on Windows.
  - Run it with `npx tsx examples/mock-robot.ts [--port N]`. Connect with `new Go2Connection({ ip: '127.0.0.1', port: 9991 })` → `connect()` → `sportCommand(SportCommand.X)`.
- **Harmless command for our smoke**: `BalanceStand` or `Hello` via `Go2Connection` directly, i.e. off-chain, no gas. Then subscribe to read `lowstate`. `Damp` / `StopMove` are the soft-stop commands, which our safe-stop can reuse.
- **Toolchain**: pnpm workspace, `packageManager: pnpm@11.5.1`, Node types 22, TypeScript ^5.7, tsx ^4.23. We have pnpm 9.15.9 and Node 20.16.0 → use `corepack` to get pnpm 11.5.1. Node 20 should be fine, but that's unverified.
- **Env** (`.env.example`): `ROBOT_IP`, `ROBOT_DEVICE_KEY`, `RPC_URL`, `REGISTRY_ADDRESS`, `DISPATCHER_ADDRESS`, `DEPLOYER_/OPERATOR_/SENDER_PRIVATE_KEY`, `ROBOT_ID`.
- No 0G Storage, episode-log or safe-stop code in zerobot.

## 6. Packages — candidate pins (none installed yet)

| Package | Version (NPM, 2026-11-06) | Why / doc |
|---|---|---|
| `openai` | 7.52.0 | Router is OpenAI-compatible; 0G-QS/0G-CHAT use `import OpenAI from "openai"` with custom baseURL |
| `@0gfoundation/0g-storage-ts-sdk` | 1.2.13 | 0G-STORAGE |
| `ethers` | 6.17.0 | 0G-STORAGE peer dep; zerobot uses ^6.13 |
| `@0gfoundation/0g-compute-ts-sdk` | 0.9.0 | 0G-INF — only if we take the Direct path |
| `openid-client` | 6.8.9 | World IdP validation (docs only say "use an OIDC library") |
| `viem` | 2.57.16 | chain smoke, if we choose viem |
| `hardhat` | 3.21.2 (zerobot uses ^2.22) | contracts — **tool choice pending (brief: ask)** |
| `tsx` | 4.23.15 | run TS scripts (zerobot uses the same) |
| `dotenv` | 18.0.9 (zerobot uses ^16) | load `.env` |
| `@roamhq/wrtc` | 0.10.0 (zerobot peer range ^0.8.0 — **0.10 is outside it**) | mock robot WebRTC; pin to zerobot's lockfile version |

Local toolchain: Node v20.16.0, npm 10.8.1, pnpm 9.15.9, corepack 0.28.2.

## 7. Open questions, conflicts, and manual steps → see docs/STATUS.md
