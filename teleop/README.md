# teleop/ — Spectacles hand-tracking teleoperation (port pending)

Owner: teleop/sim dev. Port of https://github.com/This-Is-Captain-Code/pinch.
Not yet started — this README is the port plan.

Pipeline:

```
Spectacles browser (WebXR page, 26 joints/hand @ XR frame rate)
  ──wss──▶ Cloudflare Durable Object relay (room per session)
  ──ws───▶ bridge (new, ~100 lines): hand pose → 29 G1 actuator targets
  ──ws───▶ sim/ setTeleop()
```

- Reuse as-is: `openxr/index.html` (sender — no Lens Studio, plain WebXR in
  the Spectacles browser), `openxr/relay-worker/` (CF worker).
- Replace: the MQTT/pan-tilt tail (`server/src/teleop.js`) with a bridge that
  maps wrist/elbow pose to G1 arm + waist joint targets. Keep its
  mapAxis + deadband + rate-cap pattern.
- New work: recenter gesture (mapping is absolute XR coords, no calibration),
  One-Euro/exponential smoothing, interpolation to the physics rate.
- Gotchas from the source repo: sender uses relay room `default` but the old
  server defaulted to room `ws` — always set the room explicitly; fingertip
  joints are 5/10/15/20/25 (a config comment claims otherwise); the relay is
  unauthenticated and single-room — generate a unique room per teleop session.
