# sim/ — Unitree G1 MuJoCo simulation (port pending)

Owner: teleop/sim dev. Port of https://github.com/Pranav9931/ethtokyo
("Robot Rescue"). Not yet started — this README is the port plan.

What it is: MuJoCo runs in **Node** (`server/sim.js`, `@mujoco/mujoco` WASM
bindings), the browser is a three.js viewer fed a 30 Hz pose stream over
WebSocket. Unitree G1 MJCF with welded pelvis, 29 position actuators,
no locomotion (arms + waist move; legs hold 0).

Port plan:
- Keep: `server/sim.js` (minus its job/routine logic), `server/scenes/unitree_g1/`
  (official Unitree model, BSD-3), `src/viewer.js`, the `/ws` skeleton from
  `server/index.js`.
- Strip: its World ID auth, World Chain WLD payments, Postgres, Claude
  job-author agent — Pickle's agents core replaces all of it.
- Teleop entry point: WS `{t:'ctrl', targets:[29]}` → `sim.setTeleop()` →
  applied to `ctrl` each physics tick (requires `beginTeleop()` mode flip).
  Re-gate on Pickle's bounty claim instead of its session cookies.
- Telemetry out: 30 Hz `{qpos, ctrl, ncon, poses}` + `sim.on('stuck')` →
  forward to the agents core as the DecisionRequest.situation.
