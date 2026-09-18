# SIREN — Priority Signaling System for Emergency Vehicles

Prototype: ambulans/pemadam mendekati simpang (radius 1 km) → lampu jalurnya hijau otomatis → normal kembali setelah lewat.

| Bagian | Folder | Pemilik |
|---|---|---|
| Backend (API + geofence + MQTT) | `backend/` | Devan |
| Web Dashboard (Command Center) | `dashboard/` | Devan |
| Mobile App (Driver) | `mobile/` | Irfan |
| Simulator ESP32 (Wokwi) | `wokwi/` | Irfan |

Kontrak antar-bagian: [`docs/CONTRACT.md`](docs/CONTRACT.md). Log proses: [`PROGRESS.md`](PROGRESS.md).

## Menjalankan (Node ≥ 24)

```powershell
cd backend
npm install
npm start                       # http://localhost:3000 (dashboard + API)
npm run sim -- --speed 120      # kendaraan simulasi di rute demo (terminal lain)
npm test                        # unit + HTTP tests
npm run typecheck
```

Opsi sim: `--id AMB-01 --type ambulance|firetruck --speed <km/j> --interval <ms> --url <backend>`.

## Konfigurasi (env / `backend/.env`)

| Var | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | port HTTP |
| `MQTT_URL` | `mqtt://broker.hivemq.com:1883` | broker untuk backend |
| `MQTT_WS_URL` | `wss://broker.hivemq.com:8884/mqtt` | broker untuk dashboard (browser) |
| `TOPIC_PREFIX` | `siren-polnes26` | prefix topic MQTT |
| `RADIUS_M` | `1000` | radius trigger prioritas |
| `PASS_M` / `PASS_HYSTERESIS_M` | `50` / `20` | deteksi "sudah lewat simpang" |
| `TTL_S` / `REFRESH_S` / `STALE_S` | `15` / `5` / `15` | failsafe ESP32, interval refresh, batas kendaraan hilang |

Akses dari HP (GPS asli): `cloudflared tunnel --url http://localhost:3000` lalu pakai URL `https://…trycloudflare.com` di app.
