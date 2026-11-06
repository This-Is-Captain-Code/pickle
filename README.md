# Pickle

**Pickle is a labor market where robots hire the help they need — from humans, and
from each other.**

Site: **https://pickle-neon.vercel.app** ([job portal](https://pickle-neon.vercel.app/portal)) · Escrow: [`PickleEscrow` on 0G Galileo](https://chainscan-galileo.0g.ai/address/0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a) · Tracks: **World ID** (Agent Pass / Best Use of IDKit) · **0G Physical AI**

Robots fail in the real world, constantly. A cable catches a wheel, a grasp slips, a
charging pad dies, a resource runs out. Today every one of those failures means a
ticket, a technician, and hours of downtime for a fix that takes seconds. Pickle's
thesis: when a robot hits its limits, it needs exactly one of three kinds of
**intervention** — and each one is a market.

## The three interventions — all three demoed live, on hardware, on-chain

**1. Physical intervention — buying hands.** (human → robot)
Some failures cannot be solved remotely, by definition: the robot is powerless,
immobilized, or the fix lies outside its own actuation. A human must be *present*.
*Demo:* a SenseCAP Watcher loses power. Dying on battery, its screen becomes the
job poster — a red `*-*` face, a QR code, **SCAN TO SAVE ME**. A passerby scans,
proves they're a unique human with **World ID** in World App, and plugs it in.
Power returning *is* the proof — verified electrically, judged by **0G Compute**,
and the escrow pays out on 0G Galileo. 2 min 11 s from unplug to payout:
[postBounty](https://chainscan-galileo.0g.ai/tx/0xac7f56123b4644fb7f9736033afcf086591f2e93df011c8281d1a54b4148be85) →
[claim](https://chainscan-galileo.0g.ai/tx/0x29c4fa604e553650bf298ff259ab10e66eb71beeb0ebefbca54a5bbd47588ccb) →
[settle](https://chainscan-galileo.0g.ai/tx/0x355c96d839639c0475168361265fcf5c0fdd1af3a9e28a8f2207bf98a69098b8).

**2. Remote intervention — buying skill.** (human → robot)
Sometimes the robot's body is capable but its skill or judgment isn't. Nobody needs
to be on-site; a human pilots it through the gap — and every session doubles as a
demonstration the robot can train on.
*Demo:* a Unitree G1 (MuJoCo, running in Node) has a box on its table it has no
policy for. Its agent posts a teleop bounty; a World-verified human takes the arms
through **Snap Spectacles hand-tracking** (WebXR → Cloudflare relay → sim) and
sweeps the box off. The box hitting the floor is the proof.
[postBounty](https://chainscan-galileo.0g.ai/tx/0xc94112393176bde260c79a7203526599a0a989e575422b136e608399872d0b61) →
[claim](https://chainscan-galileo.0g.ai/tx/0xa8e79a037fc6257fbd393e6ed2c77a0a406bea64d76aba8bfb937b1e46b92ceb) →
[settle](https://chainscan-galileo.0g.ai/tx/0xb3dd0cc8e1bf06c1b1063c4e4bb620e2058443da3c30fd8ff9ce0175cc370fab).

**3. Machine intervention — buying services from peers.** (robot → robot)
When the help a robot needs is something another machine already has — power, a
tool, queue priority — no human belongs in the loop. The robots transact directly.
*Demo:* the same dying Watcher offers its job to a second robot (a LilyGO T-Deck)
instead of a human. The T-Deck's **own agent** decides on 0G Compute — with its real
battery voltage in the prompt — accepts, and claims the bounty **with its own wallet
as the worker; no World ID, because the worker is a machine**. Power is delivered,
the Watcher's sensors prove it, 0G verifies, and the escrow pays the T-Deck.
76 s unplug to payout:
[postBounty](https://chainscan-galileo.0g.ai/tx/0x918f0a2fb4a8abc9a9318d66c223c37cd76ef409154417ee1baa7162089dafc8) →
[claim (worker = T-Deck)](https://chainscan-galileo.0g.ai/tx/0xc44a55a95c91b677e43e53611076aa114603112c9cacf3bcc6cfe5ac29b4920b) →
[settle → T-Deck wallet](https://chainscan-galileo.0g.ai/tx/0x6c7bc20d8796f4559062c65b675f1a7ed989c14f88003b5117030e031a1ed1a4).
A short press of the Watcher's knob switches it between demo 1 and demo 3; both
screens show which one is armed.

## How it works

```
robot detects failure ──▶ agent decides on 0G Compute (TEE), decision + situation
logged to 0G Storage ──▶ bounty posted ON the robot (QR / AR / screen) and escrowed
on 0G Galileo from the robot's own balance ──▶ claim: human (World ID proof of human,
one nullifier per bounty) or another robot's agent (its wallet) ──▶ intervention
──▶ the robot's own telemetry is the proof ──▶ 0G Compute verdict ──▶ settle: the
escrow pays the worker, citing the compute request id + the storage root on-chain
```

- **The robot is the job board.** Bounties render where the failure is: on the
  Watcher's screen, in the sim viewer over the G1, in AR through Spectacles.
- **Identity gates the market.** One human, one claim — World ID 4.0 via IDKit,
  verified on our backend, nullifier bound to the bounty on-chain as `humanHash`.
  Machines claim with a wallet instead.
- **Decisions are verifiable.** Every decision and verdict is a 0G Compute request
  (`0gm-1.0-35b-a3b`, sealed/TEE) and an episode on 0G Storage; `settle` records
  both. If 0G is unreachable, the robot **safe-stops** — it never fakes a decision.
- **Proof is physical.** VBUS edges, box position, joint telemetry — verification
  comes from the robot's own sensors, not from trust.
- **Money is real (testnet).** `PickleEscrow`: `postBounty` → `claim` → `settle`,
  with `cancel`/`expire` paths that return escrow to the robot. Robots are on-chain
  ids with agent wallets; a human's identity never touches the chain in clear.

## Repo map

| Package | What |
|---|---|
| `agents/` | The orchestrator (`src/service.ts`): MQTT devices, sim webhook, claims relay, World verify, 0G decide/verify, escrow queue. Tools: `sim-e2e`, `fake-watcher`, `escrow-status --reclaim`, `fund-robot`, `settle-now` |
| `contracts/hardhat/` | `PickleEscrow.sol` + 31 tests; deployed + verified on Galileo |
| `world/` | IDKit 4 `HumanVerifier` (per-bounty actions, backend RP signing, v4 verify) |
| `zerog/` | `DecisionEngine` on the 0G Router (TEE) · `EpisodeLogger` on 0G Storage |
| `sim/` | Node MuJoCo Unitree G1 (29 DOF) + three.js viewer; always-teleop; announces its standing job |
| `teleop/` | Spectacles WebXR sender, Cloudflare relay worker (also serves `/go` and the claim page), joint-mapping bridge |
| `firmware/` | SenseCAP Watcher (ESP-IDF): QR poster, `*-*` dying face, VBUS proof, knob demo toggle |
| `site/` | Next.js landing: the three interventions + the job portal |
| `shared/` | The interface contract (`HumanVerifier`, `DecisionEngine`, `EpisodeLogger`, `Bounty`) + `addresses.json` |

## Run it

```
npm install
npm run typecheck
# mock everything, full lifecycle on a desk:
npm run serve -w agents                       # orchestrator (WORLD_MODE/ZEROG_MODE default to mock)
node sim/server/index.js                      # G1 sim on :8787 (set AGENTS_WEBHOOK_URL=http://localhost:8090/events/sim)
npx tsx --env-file=.env src/tools/sim-e2e.ts  # from agents/: claim → sweep → VERIFIED
npm run fake-watcher -w agents -- --auto      # Watcher emulator playing robot + human
```

Live: copy `agents/.env.example` → `agents/.env` (World app/RP keys, 0G router key,
Galileo wallets) and set `WORLD_MODE=live ZEROG_MODE=live`. Escrow is on whenever
`shared/addresses.json` has a deployed `PickleEscrow`; `ESCROW_DEMO=0` turns it off.
Before a demo: `scripts/escrow-status.ts --reclaim` then `scripts/deploy-escrow.ts`
(idempotent top-up). Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/STATUS.md`](docs/STATUS.md) (every rehearsal with tx links).

## Addresses (0G Galileo, chain 16602)

- `PickleEscrow` `0xCcdbe1e1f597dbc8Ce5788a35f5f1383D2990f9a`
- Robot G1 (sim) `0xdb8e063E2069Ae59DF257497E58cD3f2fFD7E750` · agent `0xDAD48EdA182bDED77427e7085673A7cA0d4c540A` (also the T-Deck's wallet in demo 3)
- Robot R2 (Watcher) `0x5ad164A6e19120410ded00f8C2C7B04E09fD23FF` · agent `0xabC77d1ee26f0833e0408c137878162dB698D90c`

## Team

Captain Code (sim, teleop, firmware, orchestrator, site) · Gopika (World ID, 0G, escrow contract, chain tooling).
Built at Monad Blitz Delhi, Nov 2026. Teleop borrows from
[pinch](https://github.com/This-Is-Captain-Code/pinch) and the G1 sim from
[ethtokyo](https://github.com/Pranav9931/ethtokyo).

Machines have been hired by humans for a century. Pickle is the first market that
runs the other way.
