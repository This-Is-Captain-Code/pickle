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
