# Pickle

**Pickle is a labor market where robots hire the help they need — from humans, and
from each other.**

Robots fail in the real world, constantly. A cable catches a wheel, a grasp slips, a
charging pad dies, a resource runs out. Today every one of those failures means a
ticket, a technician, and hours of downtime for a fix that takes seconds. Pickle's
thesis: when a robot hits its limits, it needs exactly one of three kinds of
**intervention** — and each one is a market.

## The three interventions

**1. Physical intervention — buying hands.**
Some failures cannot be solved remotely, by definition: the robot is powerless,
immobilized, or the fix lies outside its own actuation. A human must be *present*.
Pickle turns that into a bounty: the robot's agent detects the failure, posts the
job on the robot itself, verifies the fix through the robot's own sensors, and
closes out instantly.
*Demo:* a SenseCAP Watcher loses power. Dying on battery, its screen becomes the
job poster — a red `*-*` face, a QR code, **SCAN TO SAVE ME**. A passerby scans,
proves they're a unique human (World ID), and plugs it in. Power returning *is*
the proof — verified electrically, in seconds.

**2. Remote intervention — buying skill.**
Sometimes the robot's body is capable but its skill or judgment isn't. Nobody needs
to be on-site; a human pilots it through the gap. And every such session doubles as
a demonstration the robot can train on — this intervention shrinks the need for
itself over time.
*Demo:* a Unitree G1 (MuJoCo) is blocked by a fallen rail. Its agent posts a teleop
bounty; a verified human takes control through **Snap Spectacles hand-tracking** —
their hands become the robot's arms, pinch to grip — lifts the rail clear, and the
robot's own resume-check verifies the work before the bounty closes.

**3. Machine intervention — buying services from peers.**
When the help a robot needs is something another machine already has — a charging
slot, a tool, queue priority, a sensor feed — no human belongs in the loop. The
robots transact directly, agent to agent, and the market still clears.
*Demo:* charging-slot negotiation between robot agents — one use case of a general
machine-to-machine service market.

## The economies this creates

1. **A micro-labor economy** — people monetize proximity and hands; robots buy
   uptime. The first gig market where the employer is a machine.
2. **A skill-and-data economy** — teleoperators sell dexterity by the minute, and
   each session compounds into training data. Robots don't just buy repair; they
   buy improvement.
3. **A machine-to-machine economy** — robots price scarce resources and services
   among themselves, so the market clears even when no human is around.

## How it works

```
robot detects failure ──▶ agent decides (0G Compute, every decision logged to
0G Storage with a request id) ──▶ bounty posted on the robot itself (QR / AR)
──▶ human claims, gated by proof-of-human (World ID) ──▶ intervention happens
──▶ the robot's own telemetry verifies the fix ──▶ bounty closes: VERIFIED
```

- **The robot is the job board.** Bounties render where the failure is: on the
  Watcher's screen, over the G1 in the sim viewer, in AR through Spectacles.
- **Identity gates the market.** One human, one claim — World ID nullifiers, with
  a human-approval checkpoint on protected agent actions.
- **Decisions are verifiable.** The agent's brain runs on 0G Compute; every
  decision and every teleop episode lands on 0G Storage. If 0G is unreachable,
  the robot safe-stops — it never fakes a decision.
- **Proof is physical.** VBUS edges, joint telemetry, resume checks — verification
  comes from the robot's own sensors, not from trust.

Machines have been hired by humans for a century. Pickle is the first market that
runs the other way.

---

*Monorepo: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the package map;
`npm install && npm run dev` walks the full bounty lifecycle against mocks.*
