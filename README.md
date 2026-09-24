# SIREN — Priority Signaling System for Emergency Vehicles

Prototype: ambulans/pemadam mendekati simpang (radius 1 km) → lampu jalurnya hijau otomatis → normal kembali setelah lewat.

| Bagian | Folder | Pemilik |
|---|---|---|
| Backend (API + geofence + MQTT) | `backend/` | Devan |
| Web Dashboard (Command Center) | `dashboard/` | Devan |
| PWA (Driver Cockpit + Citizen HUD) | `mobile/` | Irfan |
| Simulator ESP32 (Wokwi) | `wokwi/` | Irfan |

Kontrak antar-bagian: [`docs/CONTRACT.md`](docs/CONTRACT.md). Log proses: [`PROGRESS.md`](PROGRESS.md).

## Menjalankan (Node ≥ 24)

```powershell
cd backend
npm install
npm start                       # http://localhost:3000 (dashboard + API), PWA di /mobile/
npm run sim -- --speed 120      # kendaraan simulasi di rute demo (terminal lain)
npm test                        # unit + HTTP tests
npm run typecheck
```

Opsi sim: `--id AMB-01 --type ambulance|firetruck --speed <km/j> --interval <ms> --url <backend>`.

## PWA (`mobile/`)

Buka `http://localhost:3000/mobile/`, lalu pilih peran:
- **Driver Cockpit**: isi ID kendaraan dan pilih jenisnya (Ambulans/Pemadam). Posisi berasal dari simulasi rute (60 km/j) atau GPS asli (toggle). Peta menampilkan jejak kendaraan, dan HUD menampilkan simpang berikutnya, jaraknya, serta status NORMAL/PRIORITAS.
- **Citizen HUD**: peta posisi warga dari GPS, plus kartu peringatan untuk kendaraan darurat dalam radius 1 km.

Di HP, buka lewat URL `cloudflared`, karena HTTPS wajib untuk GPS dan untuk install ke home screen. Field *Backend URL* di form Driver bisa diganti kalau backend tidak berada di origin yang sama. PWA punya service worker (network-first), jadi tampilannya tetap terbuka walau WiFi sempat putus.

## Wokwi (`wokwi/`)

1 ESP32 = 1 simpang (`INTERSECTION_ID` di `sketch.ino`), dengan 6 LED: fase A (jalan utama) di pin 25/26/27 dan fase B (jalan silang) di pin 14/32/33.

Cara menjalankan di wokwi.com:
1. Buat proyek ESP32 baru.
2. Tempel `sketch.ino` dan `diagram.json`.
3. Tambahkan library dari `libraries.txt` (PubSubClient, ArduinoJson).
4. Klik ▶.

`wokwi.toml` dipakai untuk menjalankan simulasi lewat `wokwi-cli` atau VS Code, dengan firmware hasil build di `wokwi/build/`. Kalau build server Wokwi sedang penuh, compile di laptop dengan `arduino-cli`, lalu di editor Wokwi pilih F1 → *Upload Firmware and Start Simulation*.

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
