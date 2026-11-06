# World ID Agent Pass — integration debrief

Running log for the judged debrief: time to first success, friction, missing docs and capabilities, and the most
impactful improvement. Timestamps are IST (UTC+05:30). Facts and sources are in [sponsors.md §4](sponsors.md).

## Summary (fill in at the end)

- Time to first success: _TBD_
- Biggest friction: _TBD_
- Missing docs / capabilities: _TBD_
- The one most impactful improvement: _TBD_

## Log

### 2026-11-06 ~14:55 — research (step 1)
- What's called "Agent Pass" at the event is **World IdP** (OIDC) in the docs; the string "Agent Pass" appears nowhere on auth.world.org/docs. The fitting features are the device flow ("Sign in a headless agent") and "Human checkpoints" in the step-up guide.
- **Friction:** the testing guide only describes a sandbox World ID, which needs an integration-contact invite, the iOS TestFlight app and "about one hour for issuance". The docs mention no mock proofs and no simulator.
- **Doc inconsistencies:**
  - The `…/acr/selfie` and `…/acr/selfie-face` values are documented in the id-token and step-up guides but missing from both discovery documents' `acr_values_supported`.
  - The step-up example uses `"value"` in one place and `"values"` in another.
  - Sandbox discovery supports `refresh_token` and token-exchange; production doesn't.
- **Missing capability (device flow):** "binding_message or action terms: Unsupported". The approver sees only the requester and the user code, never what they're approving, so our backend has to show the action summary next to the code.

### 2026-11-06 16:30 — decision: production World IdP, per-bounty uniqueness
- **Decision (from Gopika):**
  - Use **production** `https://auth.world.org`, not the sandbox. Gopika has a real verified World ID, and the judges are World staff with World IDs.
  - Gopika registers a production OIDC client (`client_secret_post`) in https://auth.world.org/portal and pastes `WORLD_IDP_CLIENT_ID` / `WORLD_IDP_CLIENT_SECRET` into `agents/.env` herself.
  - The proof source stays swappable by config: production | sandbox, plus a local mock for offline tests.
- **Uniqueness rule:**
  - One claim per human per bounty. Each bounty is its own uniqueness scope.
  - A human who claimed earlier bounties can claim a new one.
  - The same human can never claim the same bounty twice.
  - No reset logic.
- **Integration note (flagged to Gopika):** World IdP OIDC has **no per-action scope**. That concept belongs to IDKit (a nullifier per `action`). In OIDC the stable identity is the pairwise `sub`, scoped to our client's sector (W-DISC `subject_types_supported: ["pairwise"]`; W-REG "sectors").
  - So per-bounty uniqueness has to be enforced **on our backend**: a unique `(iss, sub, bountyId)` record, written only after the ID token is fully validated.
  - The same person gets the same `sub` across bounties, so a second claim on the same bounty is refused, while new bounties stay claimable.
  - To honour "no reset logic", claims persist to disk and survive restarts. No API or script deletes them.
- **smoke:world must cover:**
  - (1) a validated success, after which the protected action runs;
  - (2) a cancelled or failed verification, where the action does **not** run;
  - (3) the same identity claiming the same bounty twice, where the second claim is refused and the action does not run.
- **Implication:** with production, the success path needs a real human (Gopika) to approve in the World App during the smoke run, so smoke:world will be interactive. The cancelled path can be run either by the human declining, or by letting the device code expire, which takes 20 min. Offline runs can use local signed fixtures (W-TEST "local signed fixtures").

---

## World ID 4.0 + IDKit (replaces the World IdP sign-in plan)

### 2026-11-06 18:45 — plan change, timer starts
- **Decision (from Gopika):** World ID 4.0 with IDKit, not World IdP OIDC.
  - The backend signs `rp_context`.
  - The claimer scans the IDKit QR in World App.
  - The backend forwards the proof unchanged to `POST https://developer.world.org/api/v4/verify/{rp_id}`.
  - `humanHash = hash(nullifier)` goes into `PickleEscrow.claim`, so the same human can't claim one bounty twice on-chain.
- **Docs read:** idkit/integrate, idkit/signatures, api-reference/developer-portal/verify, idkit/javascript, idkit/error-codes, idkit/credentials, concepts, SKILL.md, sandbox pages.
- **Packages (npm registry, 2026-11-06):** `@worldcoin/idkit-core` 4.6.0, including the `/signing` subpath for `signRequest`; `@worldcoin/idkit-server` 1.2.0, a dependency of core.

### 2026-11-06 18:48 — friction before the first line of code
1. **Signing key shape.** `.env` has `WORLD_RP_SIGNING_KEY` with 40 hex chars (20 bytes). The signatures doc requires a 32-byte secp256k1 key (64 hex chars, with or without `0x`). The value looks like an address or a truncated key. Blocked until the right key is pasted.
2. **Action missing.** No `WORLD_ACTION` in `.env`. The docs don't show where in the dashboard UI actions are created; they only name the MCP tool `create_world_id_action` and the legacy v2 `create-action` API.
3. **Environment.** `WORLD_ENV=staging`. Per SKILL.md, "The production World ID app only signs production proofs. A staging action only verifies against the World ID Simulator." A real World App scan needs a **production** action.
4. **One action for every bounty vs one-time proofs.** SKILL.md: "World ID 4.0 uniqueness proofs are one-time per action for each user. Use separate actions for separate one-time operations."
   - The nullifier depends on (user, app, action) and not on the signal (concepts.md).
   - So with a single `WORLD_ACTION`, the same human gets the same nullifier for every bounty. World may refuse their second proof (`nullifier_replayed` / `max_verifications_reached`, error-codes.md), which would block them from *other* bounties too.
   - The verify docs don't say whether v4 enforces this server-side; integrate.md says the RP must check nullifier reuse itself.
   - Needs a decision or a live test.
5. **No vanilla-JS QR library is named.** `connectorURI` is the QR payload; the React package uses `qrcode`.

### 2026-11-06 19:15–19:28 — decision + build
- **19:15 — Decision (Gopika): "go with matching the doc"** → one World ID action per bounty: `pickle-<escrow6>-claim-bounty-<id>`. The escrow prefix keeps a redeploy from colliding with old actions.
- **Fix:** the signing key in `.env` was re-pasted and is now the correct 64 hex chars. `WORLD_ENV` was set to `production`.
- **Friction: action creation from code.** The only documented programmatic path is the Developer Portal **MCP tool** `create_world_id_action`, at `https://developer.world.org/api/mcp` with a team `api_…` key.
  - There is no documented REST endpoint for v4 actions. The legacy `/api/v2/create-action` is documented only for "incognito actions".
  - The docs also don't say what verify or World App do with an unregistered action. SKILL.md only lists the symptom "action not found" / "QR scan does nothing".
  - → We call the MCP tool over JSON-RPC from the backend (`world/src/actions.ts`). This needs a new secret, `WORLD_PORTAL_API_KEY`.
- **Worked first time:**
  - `signRequest` from `@worldcoin/idkit-core/signing` in Node gives a 65-byte sig with a 300 s TTL.
  - `IDKit.request(...).preset(proofOfHuman({signal}))` in Node gives a `world.org` connector URI. Creating it doesn't validate the action.
- **Verifier error shape (live):** a junk v4 proof sent to `POST /api/v4/verify/rp_aa58…` returns HTTP 400:
  `{"success":false,"code":"all_verifications_failed","detail":"All proof verifications failed.","results":[{"identifier":"proof_of_human","success":false,"code":"verification_failed","detail":"execution reverted (unknown custom error)"}]}`.
  The per-result code `verification_failed` is not in the verify OpenAPI, which lists `verification_error`; it only appears in SKILL.md's troubleshooting table.
- **Signal binding:** the worker's payout address is the IDKit signal. The backend rejects any response whose `signal_hash` ≠ `hashSignal(worker)` *before* forwarding. The docs say the backend "should enforce the same value" but give no recipe; `hashSignal` is in `@worldcoin/idkit-core/hashing`.
- **Removed:** World IdP code (`world/src/agentpass.ts`, `WORLD_IDP_*` env vars). The payout-approval checkpoint stays mocked.
- **Status:** blocked on `WORLD_PORTAL_API_KEY` for the interactive `smoke:world` run.

### 2026-11-06 ~19:35 — first live run: `invalid_rp_signature`
- `smoke:world` run 1 never started: robot G1's escrow was too low. Refilled with `deploy:escrow`.
- **Run 2:**
  - Bounties #14 and #15 were posted.
  - **Per-bounty action creation via the portal MCP worked first time.** `pickle-ccdbe1-claim-bounty-14` appears under `rp_registration[].actions_v4` with `environment: production`.
  - The QR was shown and Gopika scanned it.
  - After about 100 s, IDKit completion failed with **`invalid_rp_signature`**.
- **Root cause (via MCP `get_app_config`):** the portal shows `rp_registration.signer_address = 0x0F9F0E4fBf6682dA2e71DC3604F920694E9b4Fe7`. The key in `.env` signs as `0x3A9B9ded2E3EFaE4B8140c2AE531Bd8F59729F20`, so it's the wrong key. The RP itself is `registered` (production and staging) and `on_chain.production_initialized: true`.
- **Friction:**
  1. The error only surfaces **after the human scans**. Nothing in IDKit or the docs checks the key up front, and the dashboard doesn't show which signer address goes with a key you saved.
  2. We added a preflight that compares our key's address with `signer_address` from `get_app_config`. It now fails in ~2 s, before any bounty is posted. This would be a great built-in check, e.g. an "RP key fingerprint" shown next to the key in the portal.
  3. `get_world_id_registration_status` reports `synced: {production: false, staging: false}` while `status` is `registered`. The docs don't say what `synced` means.
- **Cleanup:** bounties #14 and #15 cancelled; escrow back to robot G1.
- **19:42–20:01 — watched for a delayed refresh:** checked `get_app_config` every 2 min for 20 min. The registered signer stayed `0x0F9F…4Fe7` with `updated_at` unchanged (18:42 IST); our key stayed `0x3A9B…9F20`. → Not a propagation delay. The key in `.env` is not this app's RP key.

### 2026-11-06 20:05–20:32 — new app via portal MCP → first success
- Gopika deleted the old app, added the Developer Portal MCP server (`claude mcp add worldcoin-developer-portal …`), and ran `agents/scripts/setup-world-app.mts` herself. The script does `create_app` (external, cloud) → `configure_world_id`, then writes the returned key straight into `agents/.env`.
  - New app `app_8db3cb0dbab89d6eca9a308639d9c431`, RP `rp_23ff310ecada5143`, signer `0x10D0f85474265E73dBBd6E5EE8A841CD1CAf7E05`.
- **Friction:** right after `configure_world_id`, `get_app_config` showed `rp_registration.status: "pending"` while the public `GET /api/v4/rp-status/{rp_id}` already said `registered`. Calling `get_world_id_registration_status` ("Fetch and sync") flipped the portal record to `registered`. `synced` stays `false` throughout, and its meaning isn't documented.
- **20:26 — FIRST SUCCESS.** Scan → approve in World App → backend `POST /api/v4/verify/rp_23ff…` → success → `humanHash = keccak256(nullifier)` → `PickleEscrow.claim` on bounty #16 ([tx](https://chainscan-galileo.0g.ai/tx/0x59431a0a0516cc36cad917ae1d80d29d313d0925d21ee4ed1027e3459e6e41eb)). 69 s from QR to on-chain claim.
- **`smoke:world` PASS at 20:32** (430 s total):
  1. **success**, as above.
  2. **tampered:** one proof element changed → World `all_verifications_failed`. The untouched proof for bounty #16's action, replayed against bounty #17's action → our precheck rejected it (action mismatch).
  3. **duplicate:** a second scan for the same bounty/action **was verified by World again** (no `nullifier_replayed`). The same nullifier gives the same `humanHash`, and `PickleEscrow.hasClaimed` refused it (`HumanAlreadyClaimed`); nothing was sent. **Finding:** World's v4 verify does not enforce one-proof-per-action. The RP must, exactly as integrate.md says ("your backend must check that the nullifier hasn't been used before"), and our contract does.
  4. **cancelled:** no claim, bounty #17 stayed Open. The outcome was a **5-min `timeout`**, not `user_rejected`; the decline did not reach the bridge, or wasn't tapped. The no-claim guarantee holds either way, but we have not yet observed an explicit `user_rejected` live.
  - cleanup: #17 cancelled, #16 expired, so the escrow went back to robot G1.

## Summary (World ID 4.0 + IDKit)
- **Time to first success: 1 h 41 min** (18:45 → 20:26).
  - Coding took ~30 min.
  - ~50 min went to the wrong RP signing key: three different keys were tried, none matching the registered signer, and the portal can't show the original again.
  - ~20 min went to an unneeded wait for a "refresh".
  - Once the app was created via MCP, it was ~20 min to PASS.
- **Biggest friction:** an RP signing-key mismatch only shows up as `invalid_rp_signature` **after the human scans**. Nothing tells you up front that your key isn't the registered one.
- **Missing docs / capabilities:**
  - No dashboard path is documented for creating v4 actions, and there's no REST endpoint; only the MCP tool.
  - The meaning of `synced` is undocumented, and the portal status can lag (`pending` vs `registered`).
  - The per-result code `verification_failed` isn't in the verify OpenAPI.
  - The docs don't say v4 verify accepts a second proof for the same action. (The guidance is consistent with this, but stating it explicitly would help.)
  - There's no vanilla-JS QR recipe.
- **The one most impactful improvement:** a **key check**.
  - Ideal: show the signer address next to the RP in the dashboard, and make IDKit (or a `GET /api/v4/rp-status/{rp_id}`) return the registered signer, so a backend can verify its key before showing a QR.
  - We built this ourselves with MCP `get_app_config` (`signer_address`). It turned a confusing post-scan failure into a 2-second preflight error.
