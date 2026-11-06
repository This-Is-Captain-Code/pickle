# @pickle/world — World ID integration (Agent Pass + IDKit)

Owner: World/0G dev. This package implements two interfaces from
[`@pickle/shared`](../shared/src/types.ts) and nothing else — the agents core
never imports World SDKs directly:

| Interface | Live class (you build) | Mock (works today) | Track |
|---|---|---|---|
| `HumanVerifier` | `IdKitVerifier` ([src/idkit.ts](src/idkit.ts)) | `MockHumanVerifier` | 🪪 Best Use of IDKit ($2.5k) |
| `ApprovalCheckpoint` | `AgentPassCheckpoint` ([src/agentpass.ts](src/agentpass.ts)) | `MockApprovalCheckpoint` | World ID Agent Pass ($5k) |

Run the whole pipeline against your work-in-progress any time:
`WORLD_MODE=live npm run dev` from the repo root (mocks: `WORLD_MODE=mock`,
the default). The demo harness in `agents/` exercises both success and
failure paths.

## Where each one fires in Pickle

- **IdKitVerifier** — the *trust moment*: a human claims a paid bounty. We
  verify they're a unique human (Proof of Human) before the claim locks, and
  the nullifier enforces one-claim-per-human-per-bounty. The `connectorURI`
  we return is rendered as a QR on the stuck robot's screen / in Spectacles.
- **AgentPassCheckpoint** — the *protected agent action*: the agent wants to
  settle a payout above the owner-approval threshold. It pauses, requests a
  fresh human authentication (device grant), and settles only on approval.
  Deny/expiry = our demo of the unsuccessful path (required by the track).

## IDKit integration brief (researched 2026-11-06)

- Packages: `@worldcoin/idkit-core` (4.x, framework-agnostic — what we want;
  `@worldcoin/idkit` is the React widget we don't need).
- Portal: create an app at https://developer.world.org → `app_id` (`app_...`),
  `rp_id` (`rp_...`), `signing_key` (secret, backend only).
- Backend signs every request:
  `signRequest({ signingKeyHex, action, ttl: 300 })` from
  `@worldcoin/idkit-core/signing` → `{sig, nonce, createdAt, expiresAt}` go
  into `rp_context`.
- Create request (headless, no widget):
  `IDKit.request({app_id, action, rp_context, allow_legacy_proofs: true, environment}).preset(proofOfHuman({signal}))`
  → `request.connectorURI` (render as QR) → `request.pollUntilCompletion()`.
- Action naming: `claim-bounty-<bountyId>` (nullifier is per human+action →
  one claim per human per bounty). Signal binds extra context if needed.
- Server verify: `POST https://developer.world.org/api/v4/verify/{rp_id}` with
  the IDKit result forwarded as-is. Require `success === true` and
  `environment` matching ours. Store nullifier as decimal
  (`BigInt(hex).toString()`), reject replays with a `UNIQUE(nullifier, action)`
  check (in-memory Set is fine for the hackathon).
- Credential choice (judges reward the *minimum sufficient* one): Proof of
  Human (`proofOfHuman`) for the uniqueness claim. If nobody at the venue has
  an Orb-verified World App, fall back to `selfieCheck()` (medium assurance,
  gate on `sybil_score`) and say why in the debrief.
- Demo without real users: `environment: 'staging'` + the simulator at
  https://simulator.worldcoin.org/.
- Failure paths to demo (completion.error / verify response):
  `user_rejected` (cancel in World App), `nullifier_replayed` (claim twice),
  `credential_unavailable`, `timeout`. Map them to `VerifyFailureCode`.

## Agent Pass integration brief (researched 2026-11-06)

- "Agent Pass" = World IdP, an OIDC provider at https://auth.world.org.
  Discovery: `https://auth.world.org/.well-known/openid-configuration`.
  Docs: https://auth.world.org/docs (guides: getting-started, oidc, step-up,
  testing). Portal: https://auth.world.org/portal (Google sign-in; secret
  `worldidp_client_secret_...` shown once; register a callback URL even for
  device-only clients; pick client auth method — `client_secret_post` is
  simplest for us).
- Use the **device grant** (RFC 8628), it fits a headless agent:
  1. `POST /api/v1/device_authorization` (`scope=openid` + client auth) →
     `{device_code, user_code, verification_uri_complete, expires_in, interval}`.
  2. Human opens the URI, authenticates with World ID (device grant always
     forces fresh auth).
  3. Poll `POST /api/v1/token` with
     `grant_type=urn:ietf:params:oauth:grant-type:device_code` no faster than
     `interval` (add 5s on `slow_down`).
  4. Validate the ID token with an OIDC lib (`openid-client` recommended):
     RS256 via jwks_uri, `iss === https://auth.world.org`, `aud === client_id`,
     then enforce `acr` policy ourselves (e.g. essential claim
     `{"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb","https://world.org/oidc/acr/selfie"]}}}`
     or `acr_values`).
- Outcome mapping: token → `approved`; `access_denied` → `denied`;
  `expired_token` (20 min) → `expired`; HTTP 503/429 → end attempt (`error`).
  Never treat a pending poll as approval.
- The device page shows only requester + user code, no action terms — the
  agents core displays `req.summary` next to the code; keep that visible in
  the demo (it's our "approval layer", and judges look for it).
- ⚠️ The public docs don't document the hackathon's mock-proof mode (the
  documented sandbox needs TestFlight + ~1h credential issuance). **Ask the
  World mentors on day one how mocked proofs work.** The OAuth playground
  (https://oauth-playground.toolsforhumanity.dev/) works against the sandbox
  IdP before you register anything.

## Track qualification checklists

Agent Pass: ☐ official integration ☐ full journey (request → completion →
validated result → protected action) ☐ unsuccessful path where the action
does NOT occur ☐ backend validation, no client secrets exposed ☐ integration
debrief (time-to-first-success, friction, missing docs, #1 improvement —
**keep notes as you go**, it's a judged requirement).

IDKit: ☐ working integration ☐ ≥1 credential verified server-side ☐ explain
why the chosen credential is minimum sufficient ☐ success + one alternative
path ☐ same debrief. Keep a `DEBRIEF.md` in this package.
