# Pickle architecture

**Pickle is a labor market where robots hire the help they need.** One pipeline,
three intervention classes — **Physical** (hands, `BountyKind: 'physical'`),
**Remote** (skill/teleop, `'teleop'`), **Machine** (robot↔robot services,
`'robot'`) — judged across three tracks (World ID Agent Pass, Best Use of IDKit,
0G Physical AI). Bounties end at **verified** — on-chain settlement is out of
scope.

```
             Spectacles (WebXR sender)                      World App
                    │ 26 joints/hand                      (human verifies)
                    ▼                                           ▲
             Cloudflare relay                                   │ QR / user code
                    │                                           │
                    ▼                   claim gate / approval   │
  teleop/bridge ──targets──▶ sim/ G1 ◀──────────┐               │
                    MuJoCo (Node) + viewer      │               │
                    │ telemetry, stuck events   │               │
                    ▼                           │               │
              agents/ core ────────────────────▶ world/  (IDKit + Agent Pass)
              bounty lifecycle ────────────────▶ zerog/  (Compute decisions +
                                                          Storage episode log)
```

## Package map & ownership

| Package | What | Owner |
|---|---|---|
| `shared/` | TS interfaces both sides implement/consume — **the contract** | both (coordinate changes) |
| `agents/` | Bounty lifecycle orchestrator + demo harness (`npm run dev`) | lead |
| `world/` | `HumanVerifier` (IDKit) + `ApprovalCheckpoint` (Agent Pass) | World/0G dev |
| `zerog/` | `DecisionEngine` (0G Compute) + `EpisodeLogger` (0G Storage) | World/0G dev |
| `sim/` | Node MuJoCo Unitree G1 + browser viewer (ethtokyo port) | lead |
| `teleop/` | Spectacles WebXR sender + relay + joint-mapping bridge (pinch port) | lead |
| `firmware/` | SenseCAP Watcher: QR bounty poster + VBUS physical proof (Mumbai port) | lead |

## How parallel work stays unblocked

Every external integration sits behind an interface in `shared/src/types.ts`,
and every interface ships a working mock. `agents/` picks mock vs live from
env (`WORLD_MODE`, `ZEROG_MODE` — see `agents/.env.example`), so:

- The World/0G dev implements `world/src/{idkit,agentpass}.ts` and
  `zerog/src/{compute,storage}.ts` and tests each against the full pipeline
  with `WORLD_MODE=live` / `ZEROG_MODE=live` — without sim, teleop, or
  contracts existing.
- The sim/teleop side builds against mocks, and the moment a live provider
  lands it's an env flip, no code change.
- Failure paths (required by every track) are first-class: mock knobs
  `WORLD_FAIL_WITH`, `WORLD_APPROVAL=denied`, `ZEROG_UNREACHABLE=1`
  rehearse the denied-claim, denied-payout, and safe-stop demos.

## Run it

```
npm install
npm run dev          # full mock lifecycle: stuck → decide → claim → verify → approve → paid
npm run typecheck
```

Demo the failure paths:

```
WORLD_FAIL_WITH=user_rejected npm run dev   # claim denied, bounty stays open
WORLD_APPROVAL=denied npm run dev           # payout blocked at the human checkpoint
ZEROG_UNREACHABLE=1 npm run dev             # 0G down → safe-stop, no faked decision
```

(PowerShell: `$env:WORLD_APPROVAL='denied'; npm run dev`)
