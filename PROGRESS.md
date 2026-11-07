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

- Commit `0140a6f` (Panel Demo + fix re-trigger) di-push.
- Slider posisi warga & radius sekarang live saat digeser (PUT di-throttle 150 ms): titik putih, lingkaran, dan HP warga
  ikut bergerak. Dicek di Playwright: titik pindah di tengah drag.
- Bug: setelah *Stop semua*, ikon ambulans tertinggal ±15 dtk (menunggu stale). Sekarang stop/reset/*Selesai Misi*
  langsung melepas simpang (`engine.forget`) dan publish `{ vehicleId, gone: true }` ke topic `vehicle`; dashboard dan
  Citizen HUD langsung menghapusnya. Endpoint baru `POST /api/mission/end`. `npm test` 39/39. Dicek: ikon hilang ≤ 1,2 dtk
  setelah Stop maupun Selesai Misi, simpang kembali NORMAL.

- Panel Demo: *Stop semua* diganti **Jeda/Lanjutkan** (kendaraan diam di tempat, lampu tetap hijau, jarak di HP warga
  ikut beku) dan **Hapus**. **Reset** sekarang mengembalikan kendaraan simulasi ke titik mulainya (dijeda) + semua
  simpang NORMAL. Dashboard menampilkan garis rute dengan penanda ▶ Mulai dan H Tujuan (`GET /api/route`).
  `npm test` 40/40. Dicek di Playwright: jeda → HP warga beku di 878 m selama 5 dtk dan S1 tetap PRIORITAS; lanjutkan →
  801 m; reset → kendaraan di 0,00 km, semua NORMAL; hapus → ikon hilang.

### 2026-10-01: Irfan

- Tes gabungan (dilakukan 2026-09-23, baru dicatat): backend lokal + `npm run sim` 60 km/j + Wokwi di VS Code
  (firmware `wokwi/`, `INTERSECTION_ID` S1) + dashboard. Saat ambulans masuk radius (±926 m dari S1), dashboard
  S1 PRIORITAS fase A, LED fase A hijau ditahan, Serial `[fsm] -> PRIORITY phase=A ttl=15s` dan failsafe disegarkan
  tiap ±5 dtk selama mendekat, lalu `[fsm] -> NORMAL` setelah lewat. Log dashboard: S1, S2, S3 masing-masing
  PRIORITAS lalu NORMAL. Run headless `wokwi-cli` dengan sim 300 km/j memberi hasil sama.
- Catatan: tes ini sebelum kode misi (27 Sep). Belum diulang dengan backend terbaru (`npm run sim` sekarang pakai
  `--code`, default `DEMO-112`).

- Commit `8ce4419` di-push. **Wokwi S1–S3** (dikerjakan tanpa menunggu Irfan, atas permintaan Devan): satu ESP32 memegang
  tiga simpang (18 LED + label `wokwi-text`), state machine per simpang, subscribe `intersection/+/cmd`, siklus NORMAL
  dibuat tidak serempak. Compile `arduino-cli` bersih (69% flash). Dites di wokwi.com dengan firmware uji ber-prefix
  `siren-localtest` + backend lokal + ambulans simulasi 200 km/j: S1 PRIORITAS A → NORMAL → S2 PRIORITAS → S3 PRIORITAS
  → S2 NORMAL → S3 NORMAL, LED ikut (screenshot).

- Masukan Devan: setelah ambulans lewat S1, fase A tetap hijau ±10 dtk (siklus NORMAL mulai lagi dari "A hijau").
  Fix: keluar dari PRIORITY, jalur yang ditahan langsung kuning lalu jalur lawan hijau. Sekalian reconnect MQTT dibuat
  non-blocking; sebelumnya semua lampu membeku selama reconnect (terlihat di tes). Dicek di Wokwi dengan membaca status
  LED: S1 A hijau (prioritas) → A kuning saat NORMAL → B hijau 3 dtk kemudian; S2 dan S3 sama; lampu tetap jalan saat
  reconnect.

- Bug: ambulans simulasi yang sampai tujuan hilang dari daftar Panel Demo, jadi Reset tidak bisa memutarnya ulang, dan
  ikonnya diam ±15 dtk di tujuan. Sekarang saat sampai tujuan: langsung selesai misi (ikon hilang, lampu dilepas), tetap
  di daftar sebagai "sampai tujuan"; Reset mengembalikannya ke titik mulai (dijeda) lalu Lanjutkan. `npm test` 41/41.
  Dicek di Playwright: sampai tujuan → ikon 0, tombol Jeda nonaktif; Reset → kembali 2,46 km dijeda; Lanjutkan → jalan.

- 2026-10-31 — Deploy ulang ke `siren.polije.app`. Service `siren` dan `~/siren` sudah terhapus dan tunnel lama
  `cloudflared-cliproxy` mati (530), jadi dipasang ulang: kode working tree terbaru, `DEMO_KEY` baru, dan tunnel
  Cloudflare khusus `siren` (service `cloudflared-siren`) dengan CNAME dipindah ke tunnel itu. Dicek: `/`, `/api/config`,
  `/mobile/`, `/.well-known/assetlinks.json` 200; `POST /api/gps` tanpa kode 401.

- 2026-11-06 — Fitur AI: **prediksi ETA** (Predictive Green Wave). Model regresi ridge (`backend/src/eta.ts`) memprediksi
  detik sampai tiba di simpang dari riwayat kecepatan; lampu hijau dibuka saat di dalam radius, mendekat, dan prediksi
  ETA ≤ `ETA_LEAD_S` (default 40). Dilatih dengan `npm run train:eta` dari 400 perjalanan sintetis di rute demo: MAE
  17,7 dtk vs 30,7 dtk cara naif (jarak ÷ kecepatan). `etaS` ikut di `nextIntersection` dan payload `vehicle/{id}`;
  dashboard menampilkan "ETA S1: 27 dtk" dan log "prediksi AI: tiba 39 dtk". Bug yang ketemu saat tes: dua fix
  berjarak milidetik membuat fitur percepatan meledak (ETA 0); kini percepatan butuh ≥ 1 dtk riwayat dan dibatasi
  ±5 m/s². `npm test` 48/48, dicek di browser (lokal): S1 PRIORITAS saat prediksi 39 dtk.

- 2026-11-06 — UI/UX untuk juri (panduan skill ui-ux-pro-max). Dashboard: panel *Cara kerja* 3 langkah yang menyala
  live, kartu *Kendaraan & prediksi AI* (ETA besar + bar menuju ambang `etaLeadS` + status awam), label S1–S3 dan
  legenda di peta, bahasa awam (jalur utama/silang, siklus normal, Live), empty state dengan tombol *Mulai demo*.
  PWA: HUD driver (status lampu, "Tiba di S1 dalam 24 dtk"), error form di dekat field, kode uji coba DEMO-112 terlihat,
  layar warga menjelaskan cara uji, kontras/fokus/target sentuh. `GET /api/config` kini berisi `etaLeadS`.
  Ketemu saat deploy: Cloudflare memaksa `max-age=14400` pada JS/CSS sehingga browser memuat HTML baru dengan modul
  lama (tampilan rusak). Fix: `?v=20261106` di semua aset & import, SW fetch `cache: no-cache`, static `no-cache`.
  `npm test` 49/49; dicek di browser (lokal & produksi, termasuk browser dengan cache lama).

- 2026-11-06 — Tema warna "Rambu Jalan" (terang) untuk dashboard + PWA, menggantikan navy + hijau neon yang terasa
  generik: kertas krem, tinta hitam, hijau rambu untuk brand dan lampu hijau, kuning hanya untuk "menunggu", merah untuk
  pemadam/error, biru rambu untuk ambulans, tanpa glow; header dashboard berbentuk pelat rambu; peta tile OSM terang.
  Dua bug ketemu saat cek di browser: (1) HUD driver menulis "Lampu hijau untuk Anda" padahal simpang dipegang ambulans
  lain; `nextIntersection.mode` kini dari sudut pandang kendaraan itu (+ tes regresi). (2) Log dashboard kadang
  "tiba 41 dtk" padahal ambang 40, karena broker publik tidak menjaga urutan antar-topic; PRIORITY kini membawa `etaS`
  saat dipicu AI. `npm test` 49/49; dicek di browser: dashboard menunggu/hijau, HUD driver dua kendaraan, alert warga.

- 2026-11-06 — Landing page untuk juri (`landing/`, tampil di `/`; dashboard pindah ke `/dashboard/`). Dibuat dengan
  5 agent: riset produk sejenis (Miovision Opticom, LYT, HAAS Alert, Applied Information, RapidSOS, berita Suwon),
  riset desain (rambu PM 13/2014, Kinneir & Calvert, GOV.UK type scale, skill ui-ux-pro-max), copy dari repo + concept
  paper, builder, dan reviewer (QA visual + cek fakta tiap klaim ke kode/paper). Isi: hero dengan animasi SVG simpang
  (pause + reduced-motion), angka sistem, masalah (sitasi paper), cara kerja, AI + tabel MAE, empat bagian dengan
  screenshot asli, keamanan, coba demo (DEMO-112, tanpa kunci Panel Demo), tim. Tanpa JS tetap terbaca; 320 px tanpa
  scroll horizontal. Catatan: paper menulis Suwon −56% (dikutip ke Seoul Economic Daily 2026), sedangkan artikel itu
  menyebut −63,5%; perlu disamakan.

- 2026-11-06 — Tampilan "Liquid Glass" terang untuk landing, dashboard dan PWA (tema rambu terasa kartun): peta penuh
  sebagai kanvas, panel kaca mengambang (blur + fallback solid), Inter saja, tombol pill. Landing dibuat bergaya produk:
  tanpa jejak lomba/tim, nav 4 item, satu container 1200 px, sitasi jadi catatan sumber. PWA: layar awal ala aplikasi
  native, kolom di tengah pada layar lebar, ETA HUD satu baris. Dashboard: zoom pecahan agar rute pas, legenda tidak
  menutupi rute. Demo tanpa kunci: `POST /api/demo/quick-run` (tombol *Mulai demo*), maks. 3 kendaraan simulasi,
  pengaturan lanjutan tetap berkunci. `npm test` 50/50; dicek di browser (1440, 1280, 390).

- 2026-11-06 — Status lampu merah/kuning/hijau di dashboard: tiap simpang di peta punya ikon dua lampu (kiri jalur
  utama, kanan jalur silang) dan kartu simpang menulis warnanya. `dashboard/signals.js` meniru state machine ESP32
  (siklus 10/3/10/3 dtk, stagger S1/S2/S3, jeda kuning 3 dtk saat prioritas, lanjut dari kuning setelah lewat); ESP32
  belum melaporkan warnanya, jadi siklus normal bisa beda beberapa detik dari LED Wokwi. 4 tes baru, `npm test` 54/54.

- 2026-11-06 — HUD driver juga menampilkan warna lampu jalurnya sendiri di simpang berikutnya ("Lampu jalur Anda di
  S1: merah"), dari perintah MQTT + state machine yang sama dengan dashboard; status "Membuka lampu hijau…" selama jalur
  silang kuning 3 dtk. Form driver disederhanakan (field URL Backend dihapus; backend selalu origin halaman). Dicek di
  browser: hijau → kuning → merah (siklus) → membuka → hijau untuk Anda.

- 2026-11-06 — (1) Lampu dilepas otomatis bila kendaraan pemegang prioritas berhenti (< 3 km/j) 180 dtk
  (`STOP_RELEASE_S`), sesuai klaim paper Bab 2.2 no. 1b; sebelumnya ambulans yang parkir dengan app menyala menahan
  hijau tanpa batas. (2) Demo bersama membersihkan diri: simulasi yang dijeda/selesai dihapus setelah 5 menit, pengaturan
  Panel Demo kembali ke bawaan (DEMO-112, radius 1 km) 30 menit setelah aktivitas operator terakhir. Pemicunya: di
  produksi kode misi tertinggal "AMB-01" dan radius 850 m sehingga DEMO-112 untuk juri ditolak. (3) Dialog konfirmasi
  sebelum Selesai Misi; status HUD "Menunggu prioritas lampu" agar tidak bertentangan dengan lampu siklus yang hijau.
  `npm test` 57/57; dicek di browser (dialog di tengah, Batal tetap aktif, Ya selesai mengakhiri misi).

- 2026-11-06 — Edge case demo yang membingungkan juri: (1) kendaraan berhenti/dijeda menampilkan "Berhenti" alih-alih
  ETA beku (ETA saat diam hanya jarak / kecepatan minimum), plus "dilepas bila berhenti 3 menit" saat memegang hijau
  (`stopReleaseS` kini ada di `/api/config`). (2) Dua ambulans *Mulai demo* beruntun: kartu kedua dulu bilang "Menunggu"
  padahal lampunya hijau karena searah; sekarang "hijau · searah dengan AMB-SIM1", atau "S1 sedang hijau untuk … (datang
  lebih dulu)" bila beda jalur (`laneAt` di `signals.js`, mirror `phaseFor`). (3) Panel Demo: *Jalankan* jadi *Tambah
  kendaraan*, *Jeda/Lanjutkan/Hapus* jadi "... semua" dengan keterangan, posisi kendaraan ditulis relatif simpang
  ("S1 − 382 m"). `npm test` 58/58; dicek di browser lokal.

- 2026-11-06 — Kendaraan melambat/berhenti. (1) Model ETA diganti regresi ridge **log-linear** (ln ETA dari ln jarak, ln
  kecepatan, ln rata-rata 10 dtk, percepatan; lantai kecepatan 4 m/s) dan dilatih ulang dengan macet sampai 1 km dan
  berhenti sampai 90 dtk. Model lama hampir hanya memakai jarak (bobot `distanceKm` 73,9; fitur kecepatan ~0,1): rem 60
  → 20 km/j menaikkan ETA 89 → 106 dtk padahal sebenarnya ~165; model baru 72 → 140–169. Data uji baru: MAE 22,05 dtk
  (model lama 22,21; naif jarak ÷ kecepatan 25,45); 60 dtk terakhir 10,37 (lama 12,34; naif 9,79, dekat simpang naif
  setara karena kecepatan di sana jarang berubah). (2) HUD driver mode simulasi: tombol *Normal / Pelan / Berhenti*
  (20 km/j / 0). (3) Driver HUD dan Citizen HUD: di bawah 3 km/j tampil "Berhenti" alih-alih ETA beku; warga tidak
  digetarkan selama kendaraan berhenti. `npm test` 59/59.

- 2026-11-06 — Audit teks sebelum kirim form: istilah aplikasi diseragamkan jadi "Petugas Darurat" (dashboard dulu
  "aplikasi Driver/driver", landing "Aplikasi sopir"); "Centang" jadi "Aktifkan" (Posisi simulasi berupa switch);
  "ETA"/"NORMAL" di kartu dan Panel Demo jadi "prediksi tiba"/"siklus normal"; petunjuk HP warga kini menyuruh menekan
  *Mulai demo* di Command Center (dulu Panel Demo, yang butuh kunci); status awal warga "Menyambung…" bukan "Terputus";
  landing menyebut pelepasan lampu saat berhenti 3 menit, tombol Pelan/Berhenti, dan prediksi tiba di HUD petugas.
  ID kendaraan default acak (`AMB-NN`/`DMK-NN`) agar dua juri tidak bentrok di server demo yang sama. Dicek: hitung
  mundur ETA di dashboard turun ~1 dtk/dtk dan hijau tepat di 40 dtk.

- 2026-11-07 — Demo dipindah dari Jember ke Bali untuk AI Web Innovation Challenge (Bali DigiFest 2026): rute OSRM Jl.
  Nakula (Kuta) → Jl. Imam Bonjol → Jl. Teuku Umar → RSUP Prof. Ngoerah (5,1 km, 237 titik), S1–S3 = simpang berlampu
  OSM di Jl. Imam Bonjol (× Pulau Galang / Gunung Soputan / Teuku Umar Barat; 1188 / 2083 / 3076 m dari awal rute),
  titik warga bawaan 1783 m. Model ETA dilatih ulang: MAE 24,85 vs naif 26,15 dtk; 60 dtk terakhir 9,0 vs 8,37; rem
  60 → 20 km/j: 68 → 146–155 dtk. Screenshot landing dan hero PWA diambil ulang; gambar diberi `?v=`. Versi Jember
  tetap di tag `v1.1-submission` dan `aiwic-v1.0-submission`. README ditambah bagian wajib panduan AIWIC dan
  `backend/.env.example`.

## Next

- Simpan `sketch.ino` + `diagram.json` terbaru ke proyek Wokwi online (link untuk demo/video).
- Ulang tes gabungan dengan backend terbaru (kode misi, Panel Demo) + Wokwi.
- Tes GPS asli dari HP lewat `cloudflared`, lalu tuning `RADIUS_M`/`PASS_M` bila perlu.
- Tahap Final: prioritas multi-vehicle, analytics, telemetry lampu dari ESP32, display countdown (TM1637).
