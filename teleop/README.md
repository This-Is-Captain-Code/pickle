# teleop/ — Spectacles hand-tracking teleoperation

Ported from pinch (This-Is-Captain-Code/pinch) + a new bridge that maps hands
onto the G1's arms.

```
sender/ (WebXR page, Spectacles browser)        26 joints/hand per XR frame
   └──wss──▶ relay-worker/ (Cloudflare DO, room = first path segment)
               └──ws──▶ bridge/ (Node)  calibrate → One-Euro → joint map
                           └──ws──▶ sim /ws?token=…  {t:'ctrl'|'action'}
```

## bridge/ — the mapping

- **Calibration**: each hand's rest origin = average of its first ~25 tracked
  frames (recalibrates if the hand is lost >1.2 s). All control is relative
  to that origin — no absolute XR coordinates.
- **Mapping** (per hand, offsets in metres → radians):
  hand up/down → `*_shoulder_pitch`; hand out/in → `*_shoulder_roll`;
  reach forward → `*_elbow` extension. Legs/waist/wrists are sent as `null`
  (sim leaves them untouched).
- **Pinch** (thumb-tip ↔ index-tip < 2.8 cm, hysteresis): right-hand pinch
  toggles pick/drop — close your fingers on the rail to grab it.
- **Smoothing**: One-Euro filter per axis; 30 Hz send rate with a 5 mrad
  deadband.

Env: `RELAY_WS_URL` (room `pickle` on the deployed relay), `SIM_URL`
(http://localhost:8787), `SIM_TELEOP_TOKEN`, `RATE_HZ`,
`BRIDGE_AUTO_BEGIN=1` (dev: start teleop the moment the robot is stuck,
bypassing the claim — the real flow begins via the agents core after IDKit).

```
npm run start -w teleop/bridge     # relay → sim
npm run fake  -w teleop/bridge     # no Spectacles: synthetic circling hands + pinches
```

## sender/ — Spectacles side

Plain WebXR page (no Lens Studio): open it in the Spectacles browser over
HTTPS, enter the relay room URL (use a **unique room per session** — the
relay is unauthenticated and single-room-shared), tap START AR, grant hand
tracking. Deploy: any static host (`npx vercel` from `sender/`).

## relay-worker/ — Cloudflare relay

Durable Object per room; broadcasts raw frames to WS peers + SSE, snapshot at
`GET /<room>`. Deploy: `npx wrangler deploy` from `relay-worker/` (name:
`pickle-hand-relay`). Until then the bridge default points at pinch's
deployed relay (`hand-tracking-relay.jenil-panchal10.workers.dev`), room
`pickle`.

## Desk test (no hardware)

```
npm run dev -w sim                                   # terminal 1
curl -X POST localhost:8787/api/scenario/obstacle    # robot gets stuck
BRIDGE_AUTO_BEGIN=1 npm run fake -w teleop/bridge    # terminal 2 — arm follows fake hands
```
