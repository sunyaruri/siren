# SIREN — Progress Log

Log proses pengerjaan tim SIREN. Terbaru di bawah.

## Status task

Plan: `docs/superpowers/plans/2026-09-18-siren-backend-dashboard.md`

- [x] 1. Backend scaffold + geo helpers
- [x] 2. Contract types + validasi GPS
- [x] 3. Priority engine
- [x] 4. HTTP app + server bootstrap
- [x] 5. Route data + simulator (E2E)
- [x] 6. Dashboard
- [x] 7. Docs (CONTRACT.md + README)

## Log

### 2026-09-18

- Pembagian tugas: Devan = backend + web dashboard; Irfan = mobile app + Wokwi; Azrieal = proposal + video.
- Kendaraan hanya ambulans + pemadam (MBG dihapus dari proposal lama).
- Keputusan stack: Node 24 + TypeScript (tanpa build), Express, mqtt.js, HiveMQ publik, Leaflet.
- Rute demo dari data OSM/OSRM: Jl. Gajah Mada → RSUD dr. Soebandi (±4 km), simpang S1–S3.
- Spec & plan ditulis (lokal, tidak di-commit).

### 2026-09-19

- Task 1–4: backend selesai. `npm test` → 21/21 pass, `npm run typecheck` bersih.
- Smoke test server: terhubung ke HiveMQ, `GET /api/intersections` & `POST /api/gps` OK.
- Task 5 (E2E): `npm run sim -- --speed 180` + subscriber MQTT. Urutan perintah benar:
  S1 PRIORITY(A) → S1 NORMAL → S2 PRIORITY(A) → S3 PRIORITY(A) (radius overlap) → S2 NORMAL → S3 NORMAL,
  refresh PRIORITY tiap 5 dtk.
- Task 6: dashboard dicek di browser 1920×1080 (Playwright): peta, lingkaran hijau + pulse, panel, log,
  kendaraan hilang dari radar ±15 dtk setelah sim selesai. Console tanpa error.
- Temuan: tiles CARTO Dark Matter sekarang watermark "API KEY REQUIRED" → ganti OSM standar + CSS filter gelap.
- Temuan: favicon 404 → tambah `<link rel="icon" href="data:,">`.
- Catatan: setelah semua simpang dilewati, `nextIntersection` bisa menunjuk simpang lama yang jaraknya
  (garis lurus) mengecil lagi, mis. "S1 2112 m" di tujuan. Tidak memicu lampu (di luar radius); hanya tampilan HUD.
- Task 7: `docs/CONTRACT.md` (untuk Irfan) + `README.md`. `.gitignore` ditambah.

### 2026-09-19 s.d. 2026-09-23 — Irfan: PWA + Wokwi (sudah di `main`)

- PWA `mobile/`: Driver Cockpit (simulasi rute 60 km/j atau GPS asli, peta + HUD simpang berikutnya) dan
  Citizen HUD (peta, peringatan kendaraan darurat < 1 km). Ada service worker, ikon, dan manifest.
- Wokwi `wokwi/`: ESP32 + 6 LED, state machine NORMAL / PRIORITY (kuning 3 dtk dulu) / failsafe ttl.
  Countdown baru dicetak ke Serial. Keep-alive MQTT 60 dtk untuk mengatasi reconnect di Wokwi.
- Backend: `/mobile` disajikan lewat `express.static`.

### 2026-09-23 — Devan

- Cadangan PWA + Wokwi dibuat di branch lokal `opsional` (tidak di-push, tidak dipakai). Tim pakai versi Irfan.
- `main` di-pull ke versi Irfan. README, `CLAUDE.md`, dan `CONTRACT.md` di-update: PWA, Wokwi,
  `/api/config`, halaman web, keep-alive 60 dtk, salinan rute di `mobile/data/route.json`.
- Kode Irfan dicek terhadap kontrak (topic, field `mode`/`phase`/`ttl`, validasi `vehicleId`): cocok.
  Ini baru dari membaca kode; tes gabungan belum dilakukan.

### 2026-09-24 — Devan

- Fix Driver HUD: `nextIntersection` tidak lagi menunjuk simpang yang sudah dilewati (mis. "S1 2112 m" di tujuan).
  Engine sekarang mencatat set `visited` per kendaraan. Ditambah regression test; `npm test` 22/22 pass.
  Replay rute demo: S1 → S2 → S3 PRIORITY/NORMAL berurutan, `next` di tujuan = `null`.

- Deploy ke `oracle-server`: service systemd `siren` (port 8080) + aturan `siren.polije.app` di tunnel Cloudflare
  yang sudah ada di server, dan DNS CNAME di zone `polije.app`. Dicek: `/api/config`, `/mobile/`, `/`, dan
  `POST /api/gps` via `https://siren.polije.app` → 200. Dua situs lain di tunnel yang sama tetap 200.
- APK Android dari PWABuilder (package `app.polije.siren`) disimpan di `release/` (gitignored).
  `/.well-known/assetlinks.json` disajikan dan lolos verifikasi Google Digital Asset Links, jadi APK terbuka tanpa URL bar.

## Next

- Tes gabungan: backend + `npm run sim` / PWA Driver + Wokwi Irfan, lalu cek LED ikut berubah.
- Tes GPS asli dari HP lewat `cloudflared`, lalu tuning `RADIUS_M`/`PASS_M` bila perlu.
- Tahap Final: prioritas multi-vehicle, analytics, telemetry lampu dari ESP32, display countdown (TM1637).
