# SIREN — Progress Log

Log proses pengerjaan backend + dashboard (Devan). Terbaru di bawah.

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

## Next

- Kirim `docs/CONTRACT.md` ke Irfan.
- Tahap Final: prioritas multi-vehicle, analytics, telemetry lampu dari ESP32.
