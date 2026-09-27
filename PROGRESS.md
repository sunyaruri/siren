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

### 2026-09-26 — Devan

- Citizen HUD didesain ulang sesuai masukan Azrieal (atas izin, meski `mobile/` modul Irfan): peta dihapus, diganti satu
  status besar. "Aman" saat tidak ada ancaman; layar penuh kedip merah-biru saat kendaraan darurat < 1 km dan mendekat,
  dengan panah arah relatif terhadap heading GPS (fallback arah mata angin saat diam), jarak, "Menepi & beri jalan".
  Getar `[400,150,400]` tiap 3 dtk selama mendekat, berhenti saat menjauh/lewat. Wake lock agar layar tetap menyala.
  Checkbox *Posisi simulasi* untuk demo di luar Jember. Cache SW → `siren-mobile-v4`.
- Dicek di Playwright (390×844, geolocation diemulasi) + `npm run sim`: Aman → alert "DARI BELAKANG" 983 m … 17 m →
  Aman setelah lewat; getar terpanggil tiap ±3 dtk lalu `vibrate(0)`; mode GPS diam → "DARI ARAH BARAT DAYA";
  `prefers-reduced-motion` mematikan kedip. Console tanpa error.

- Masukan Azrieal: tombol driver tanpa gerbang (celah "ambulans kosong"). Ditambah **Kode Misi**: `POST /api/gps` dan
  `GET /api/mission` wajib `Authorization: Bearer <kode>` dari env `MISSION_CODES` (default `DEMO-112`), selain itu 401
  dan tidak ada publish. Form driver cek kode dulu sebelum mulai; `npm run sim` punya `--code`. Test baru 2 → 25/25 pass.
  Catatan pitching: di produksi kode diterbitkan Command Center 112 / RS rujukan per perjalanan; broker publik belum ber-ACL.
- Landing + form driver didesain ulang: kartu peran (Petugas Darurat / Warga), kartu Kode Misi, ID + jenis satu baris,
  URL backend & GPS asli di *Pengaturan lanjutan*. Sekalian fix bawaan: checkbox GPS asli tertumpuk, pill HUD melebar.
  Dicek di Playwright 360 & 390 px: tanpa scroll horizontal; kode salah → pesan error; `DEMO-112` → misi jalan. Cache SW → v5.

### 2026-09-27 — Devan

- Commit `a404810` (Citizen HUD + kode misi + landing) di-push ke `main`.
- **Panel Demo** di dashboard (dikunci `DEMO_KEY`): kecepatan simulasi, kendaraan simulasi dari server (jenis + titik
  mulai), posisi warga di sepanjang rute (HP warga mode *Posisi simulasi* ikut via topic retained `demo`), radius live,
  kode misi live, reset demo. Backend: `route.ts`, `demo.ts`, `demo-api.ts`, `PriorityEngine.reset`, `ingestGps`.
  Driver PWA membaca `simSpeedKmh` dari `/api/config`. `npm test` 35/35 pass, typecheck bersih.
- Dicek di Playwright: kunci salah → "Kunci demo salah."; radius 600 m, 120 km/j, warga *Setelah S1*, mulai sebelum S1
  → S1 PRIORITAS ±2 dtk, HP warga alert "DARI BELAKANG" 7 dtk setelah Jalankan; `/api/config` ikut berubah.

- Laporan: HP warga baru alert setelah ambulans menjauh dari titik putih. Reproduksi dengan kode terbaru (warga S1 − 246 m,
  radius 1100 m, driver PWA 60 km/j): alert "DARI BELAKANG" dari 978 m sampai 33 m, lalu Aman, jadi logikanya benar.
  Dugaan: HP memakai posisi lain dari titik putih (halaman lama sebelum deploy memakai titik bawaan antara S1–S2,
  atau *Posisi simulasi* tidak dicentang sehingga memakai GPS asli). Ditambah baris sumber posisi di Citizen HUD.
- Catatan: menjalankan backend lokal dengan prefix yang sama menimpa topic retained produksi. Tes lokal pakai
  `TOPIC_PREFIX=siren-localtest`.

- Bug: dengan radius 850 m, S2 PRIORITAS lagi setelah ambulans lewat S3, karena rute berbelok balik mendekati S2 dan
  set `passed` sudah dikosongkan saat keluar radius. Fix: guard re-trigger pakai `visited` (seumur trip), `passed` dihapus.
  Regression test ditambah (36/36 pass). Replay rute demo radius 600/850/1000: tiap simpang PRIORITAS → NORMAL sekali.
- Kunci Panel Demo produksi diganti jadi yang mudah diketik atas permintaan Devan.

## Next

- Tes gabungan: backend + `npm run sim` / PWA Driver + Wokwi Irfan, lalu cek LED ikut berubah.
- Tes GPS asli dari HP lewat `cloudflared`, lalu tuning `RADIUS_M`/`PASS_M` bila perlu.
- Tahap Final: prioritas multi-vehicle, analytics, telemetry lampu dari ESP32, display countdown (TM1637).
