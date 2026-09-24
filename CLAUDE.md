# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SIREN: hackathon prototype for emergency vehicle priority signaling (ambulance and fire truck only; the MBG fleet from the old proposal `document.md` is out of scope). When a vehicle comes within 1 km of a signalised intersection, that intersection's lights turn green for the vehicle's lane; once it passes, the intersection returns to its normal cycle.

The work is split into 3 pillars plus a backend. The backend and the dashboard are Devan's; `mobile/` (PWA) and `wokwi/` (ESP32) are Irfan's (GitHub `ucilmenangis`), who pushes straight to `main`. The local-only branch `opsional` holds Devan's unused backup of both; it is never pushed and never merged. The interface between pillars is fixed in `docs/CONTRACT.md` (written in Indonesian). Changing payloads or topics breaks Irfan's mobile app and ESP32 code, so update `CONTRACT.md` in the same change.

## Commands

Run all of these from `backend/`. Requires Node >= 24.

```powershell
npm start                                   # http://localhost:3000 (API + dashboard); reads backend/.env if present
npm run dev                                 # same, with --watch
npm run sim -- --speed 120                  # fake driver app that drives the demo route (needs the server running)
npm test                                    # node:test, all src/**/*.test.ts
node --test src/priority.test.ts            # a single test file
node --test --test-name-pattern "first-come" "src/**/*.test.ts"   # a single test
npm run typecheck                           # tsc, typecheck only (noEmit)
npx mqtt sub -h broker.hivemq.com -t "siren-polnes26/#" -v        # watch MQTT traffic
```

Sim options: `--id`, `--type ambulance|firetruck`, `--speed <km/h>`, `--interval <ms>`, `--url`.

## TypeScript without a build step

Node 24 runs `.ts` files directly (type stripping), and `tsc` only typechecks. Consequences:
- Only erasable syntax is allowed: no `enum`, no `namespace`, no constructor parameter properties (`erasableSyntaxOnly`).
- Relative imports must include the `.ts` extension.
- Type-only imports must use `import type` or an inline `type` modifier (`verbatimModuleSyntax`).
- The only allowed dependencies are `express` and `mqtt` at runtime, and `typescript`, `@types/node` and `@types/express` for development. Validation is hand-written in `contract.ts`; there is no zod, jest or dotenv.

## Architecture

Data flow: the mobile app sends `POST /api/gps` to the backend, the backend publishes to the public HiveMQ broker, and the ESP32 (Wokwi), the dashboard and the Citizen HUD all subscribe to that broker. The browser and the ESP32 never talk to the backend over HTTP for real-time data. Everything real-time goes through MQTT, including the dashboard, which connects directly over WSS.

Backend layers in `backend/src/`:
- **`priority.ts` (`PriorityEngine`)** holds all the decision logic. It is pure: no I/O, and the time is passed in as `now`.
  - `update(gps, now)` returns `{ commands, next }`.
  - `tick(now)` re-sends held PRIORITY commands and releases intersections whose vehicle has gone stale.
  - Rules:
    - **Trigger:** the vehicle is within the radius and its distance is strictly decreasing.
    - **Passed:** the minimum distance got to `PASS_M` or less, and the current distance is more than `min + PASS_HYSTERESIS_M`.
    - **Jitter guard:** the per-vehicle `passed` set prevents a re-trigger after passing; the set is cleared once the vehicle leaves the radius.
    - **`next` (Driver HUD):** the nearest intersection that is either held by this vehicle, or closing and not in the per-vehicle `visited` set. `visited` is never cleared during a trip, so the HUD never points back at an intersection already passed.
    - **Phase:** A when the vehicle approaches within 45° of `axisA` (mod 180), otherwise B.
    - **Two vehicles:** first-come per intersection (multi-vehicle priority rules are deferred to the Final stage).
- **`app.ts` (`createApp`)** is thin Express glue: it validates input, calls the engine, and publishes through an injected `Publish` function. Tests inject a fake publisher, so no broker is needed.
- **`server.ts`** is the only file that touches the real MQTT client and timers. At startup it publishes NORMAL to every intersection, which overwrites stale retained PRIORITY messages left from a previous run.
- **`config.ts`** holds the env config and the list of intersections S1–S3. Their coordinates and `axisA` come from OSM traffic signals along the OSRM demo route in `scripts/route.json`.
  - `mobile/data/route.json` is an identical copy used by the PWA simulator. Change both together.
- **Static files:** `app.ts` serves `dashboard/` at `/` and `mobile/` at `/mobile`.

MQTT conventions (prefix `siren-polnes26`):
- **`intersection/{id}/cmd`**: RETAINED.
  - PRIORITY carries a `ttl`, and the backend re-sends it every `REFRESH_S`. Consumers fall back to NORMAL if it is not refreshed within `ttl`; the ESP32 failsafe and the dashboard both mirror this.
- **`vehicle/{id}`**: not retained.
- **`vehicleId` validation:** restricted to `[A-Za-z0-9_-]` because it is embedded in topic names.

Dashboard (`dashboard/`, plain HTML, CSS and ES modules, no build):
- **Libraries and config:** Leaflet and mqtt.js are loaded from CDN. On load the page calls `GET /api/config` (prefix, WSS URL, radius, stale) and `GET /api/intersections`.
- **Untrusted broker:** the broker is public, so every MQTT message is shape-checked and text is rendered with `textContent`.
- **Map tiles:** standard OSM tiles darkened with a CSS filter. CARTO dark tiles now require an API key and render a watermark.
- **Colors:** defined once as CSS custom properties in `style.css`; `app.js` reads them back through `getComputedStyle`.

PWA (`mobile/`, Irfan's; served at `/mobile/`; plain HTML and JS, no build):
- **Structure:** a single `index.html` holds three views (landing, driver, citizen), and `app.js` switches between them. The back button reloads the page to reset.
- **Driver (`driver.js`):**
  - Position comes from a route simulator at a fixed 60 km/h over `data/route.json`, or from real GPS.
  - It sends `POST /api/gps` every second and shows `nextIntersection` on a Leaflet map with a HUD.
  - The *Backend URL* field defaults to the page origin.
- **Citizen (`citizen.js`):** uses `mqtt-client.js` (mqtt.js over WSS plus a `haversineM` helper) to subscribe to `vehicle/+`, and shows alert cards for vehicles within 1 km of the phone's GPS position.
- **`sw.js`:** a network-first app-shell cache. Bump `CACHE` whenever the shell file list changes.

Wokwi (`wokwi/`, Irfan's):
- **`sketch.ino`:** a single-file state machine (NORMAL cycle / PRIORITY with a 3 s yield / ttl failsafe) using PubSubClient and ArduinoJson.
  - Keep-alive is 60 s, because Wokwi simulates slower than real time and pings arrive late.
  - WiFi and MQTT reconnects are blocking.
  - The countdown is printed to Serial only; there is no display.
- **Pins:** A = 25/26/27, B = 14/32/33.
- **Running it:** `wokwi.toml` points `wokwi-cli` / VS Code at firmware in `wokwi/build/`, which is gitignored.

## Conventions

- **Language:** code, identifiers and comments in English. Team-facing docs (`docs/CONTRACT.md`, `README.md`, `PROGRESS.md`) and the dashboard UI text in Bahasa Indonesia.
- **`PROGRESS.md`:** the running work log. Append an entry when finishing work.
- **Local-only planning docs:** `docs/superpowers/` holds the spec and plan. They stay local (they are in `.gitignore`); do not commit them.
- **Tuning:** radius, pass detection, ttl, refresh and stale are env knobs (see `README.md`), meant for tuning during real-GPS tests. Do not hardcode them.
