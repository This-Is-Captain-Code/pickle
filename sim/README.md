# @pickle/sim — Unitree G1 MuJoCo simulation

Authoritative physics runs in **Node** ([server/sim.js](server/sim.js),
`@mujoco/mujoco` WASM); the browser is a three.js viewer fed a 30 Hz pose
stream. Ported from Robot Rescue (Pranav9931/ethtokyo) with its World
ID/payments/DB layers removed — Pickle's agents core owns those concerns and
talks to this server over HTTP + webhook.

The G1 (official Unitree MJCF, BSD-3, pelvis welded) works a feeder line:
pick box → carry to belt → release, forever. Three scripted failures make it
stuck, which is Pickle's bounty trigger:

| Trigger | Stuck reason | Human fix |
|---|---|---|
| `POST /api/scenario/obstacle` | `obstructed` — rack rail falls across the feeder | back off, lift the rail, set it aside |
| `POST /api/scenario/person` | `hazard` — person inside the robot cell | tuck arms, get the person out, confirm clear |
| `POST /api/scenario/knock` | `lowconf` — box knocked off the feeder mark | re-aim, nudge it back, or discard |

## Run

```
npm run dev -w sim        # http://localhost:8787 — first boot takes ~30 s (WASM)
```

Open `http://localhost:8787/?token=dev-token` for the viewer **with** control
(scenario buttons, begin/end teleop, mouse drag-to-pose, stuck-action
buttons); omit the token to spectate.

## Interfaces

- **WS `/ws`** — on connect: `init` (geoms, actuators + ranges, robot status).
  Stream: `state` 30 Hz (`poses`, `robot` with qpos/ctrl/ncon), `robot` on
  change, `stuck`, `toast`. With `?token=<SIM_TELEOP_TOKEN>` the socket may
  send `{t:'ctrl', targets:[29|null]}` (null = leave that joint), `{t:'drag',
  body, target}`, `{t:'action', id}` — all applied only in teleop mode.
- **HTTP** — `GET /api/state`; `POST /api/scenario/:name`;
  `POST /api/teleop/begin|end|release` and `POST /api/action` (token in body).
  `end` enforces the sim's own resume check: the fix must actually hold.
- **Webhook out** — set `AGENTS_WEBHOOK_URL` and every stuck event POSTs
  `{type:'stuck', robotId, reason, telemetry, actions, resumeCondition, …}` —
  the agents core turns this into a 0G decision + bounty.

Env: `SIM_PORT` (8787), `SIM_TELEOP_TOKEN` (`dev-token`), `AGENTS_WEBHOOK_URL`.
