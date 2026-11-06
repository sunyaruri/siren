# SIREN — Priority Signaling System for Emergency Vehicles

Prototype: ambulans/pemadam mendekati simpang (radius 1 km) → model AI memprediksi waktu tibanya → lampu jalurnya hijau
otomatis saat prediksi ETA ≤ 40 detik → normal kembali setelah lewat.

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
npm start                       # http://localhost:3000 (landing), dashboard di /dashboard/, PWA di /mobile/
npm run sim -- --speed 120      # kendaraan simulasi di rute demo (terminal lain)
npm test                        # unit + HTTP tests
npm run typecheck
```

Opsi sim: `--id AMB-01 --type ambulance|firetruck --speed <km/j> --interval <ms> --url <backend> --code <kode misi>` (default `DEMO-112`).

## PWA (`mobile/`)

Buka `http://localhost:3000/mobile/`, lalu pilih peran:
- **Driver Cockpit**: isi **Kode Misi** (demo: `DEMO-112`), ID kendaraan, dan jenisnya (Ambulans/Pemadam). Tanpa kode yang valid, backend menolak GPS (401) sehingga lampu tidak berubah. Posisi berasal dari simulasi rute (60 km/j) atau GPS asli (toggle). Peta menampilkan jejak kendaraan, dan HUD menampilkan simpang berikutnya, jaraknya, serta status NORMAL/PRIORITAS.
- **Citizen HUD**: tanpa peta. Tampil "Aman", atau layar penuh berkedip merah-biru saat ambulans/pemadam dalam 1 km dan
  sedang mendekat: panah + arah (dari belakang/depan/kiri/kanan), jarak, "Menepi & beri jalan", dan HP bergetar tiap 3 dtk
  (Android, hanya saat app terbuka dan layar menyala). Centang *Posisi simulasi* untuk demo di luar Jember.

Di HP, buka lewat URL `cloudflared`, karena HTTPS wajib untuk GPS dan untuk install ke home screen. Field *Backend URL* di form Driver bisa diganti kalau backend tidak berada di origin yang sama. PWA punya service worker (network-first), jadi tampilannya tetap terbuka walau WiFi sempat putus.

## Panel Demo (dashboard)

Tanpa kunci: tombol **Mulai demo** di dashboard langsung menjalankan satu ambulans simulasi di dalam zona S1
(maks. 3 kendaraan simulasi sekaligus). Pengaturan lanjutan ada di tombol **Panel Demo**: isi kunci (`DEMO_KEY`), lalu:
- **Kendaraan simulasi:** atur kecepatan (juga dipakai simulasi rute di HP driver untuk misi baru), pilih jenis dan
  titik mulai (mis. *Mulai sebelum S1*, tepat di luar radius), lalu **Jalankan**. Tidak perlu HP driver kedua atau terminal.
  **Jeda** membekukan kendaraan di tempat (lampu tetap hijau, jarak di HP warga ikut berhenti), **Lanjutkan** meneruskan,
  **Hapus** menghilangkan kendaraan simulasi dari peta dan HP warga seketika. Kendaraan yang **sampai tujuan** otomatis
  selesai misi (hilang dari peta, lampu dilepas) tapi tetap di daftar; **Reset** memutarnya ulang dari titik mulai.
- **Posisi warga:** geser di sepanjang rute atau pilih *Setelah S1/S2/S3*. HP warga yang mencentang *Posisi simulasi*
  langsung pindah ke titik itu, dan titik hitam di peta ikut pindah.
- **Radius prioritas:** ubah radius trigger (mis. 600 m) tanpa restart.
- **Kode misi:** tambah/hapus kode yang diterima Driver Cockpit.
- **Reset demo:** semua simpang NORMAL, kendaraan simulasi kembali ke titik mulainya dalam keadaan dijeda; tekan
  **Lanjutkan** untuk mengulang skenario.

Peta dashboard menampilkan garis rute demo dengan penanda **▶ Mulai** (Jl. Gajah Mada) dan **H Tujuan** (RSUD dr. Soebandi).

Skenario cepat: radius 600 m, kecepatan 120 km/j, warga *Setelah S1*, kendaraan *Mulai sebelum S1* → lampu S1 hijau
begitu prediksi ETA ≤ `ETA_LEAD_S` (log dashboard: "prediksi AI: tiba … dtk"), HP warga bergetar ±7 dtk setelah **Jalankan**. Semua pengaturan hilang saat server restart.

Lokal: taruh `DEMO_KEY=...` di `backend/.env`. Saat produksi sedang dipakai, jalankan backend lokal dengan
`TOPIC_PREFIX` lain (mis. `siren-localtest`), karena topic retained di broker publik dipakai bersama dan akan tertimpa.

## Deploy (online)

- URL publik: **https://siren.polije.app** (landing page untuk juri), **https://siren.polije.app/dashboard/** (Command Center) dan **https://siren.polije.app/mobile/** (PWA).
- APK Android (TWA dari PWABuilder) ada di `release/SIREN.apk`, yang tidak ikut di-commit. Bagikan file itu langsung. Keystore dan password-nya ada di `release/` juga; simpan baik-baik, karena dibutuhkan untuk membuat versi APK berikutnya.
- Server: `oracle-server` (Ubuntu arm64). Kode ada di `~/siren` dan jalan sebagai service systemd `siren` di port 8080.
- Akses publik lewat tunnel Cloudflare khusus `siren` (ID `918204aa-a0a0-483f-8f44-df9d09b60f8d`, dikelola dari dashboard Cloudflare, aturan `siren.polije.app → http://127.0.0.1:8080`). Di server jalan sebagai service `cloudflared-siren`; token connector-nya ada di `/etc/cloudflared-siren.env` (hanya root yang bisa baca). DNS `siren.polije.app` adalah CNAME ke tunnel tersebut.

Update kode di server: upload hasil `git archive HEAD backend dashboard mobile` (atau `$(git stash create)` sebagai ganti `HEAD` untuk ikut perubahan yang belum di-commit) ke `~/siren`, lalu jalankan `npm ci --omit=dev` di `~/siren/backend` dan `sudo systemctl restart siren`.

`DEMO_KEY` produksi ada di drop-in `/etc/systemd/system/siren.service.d/demo.conf` (hanya root yang bisa baca). Ganti isinya, lalu `sudo systemctl daemon-reload && sudo systemctl restart siren`.

Hapus setelah proyek selesai:
1. Hapus DNS record `siren.polije.app` di Cloudflare.
2. Jalankan `sudo systemctl disable --now cloudflared-siren`, hapus `/etc/systemd/system/cloudflared-siren.service` dan `/etc/cloudflared-siren.env`, lalu hapus tunnel `siren` di Cloudflare (Zero Trust → Networks → Tunnels).
3. Jalankan `sudo systemctl disable --now siren`, lalu hapus `/etc/systemd/system/siren.service`, folder `/etc/systemd/system/siren.service.d`, dan folder `~/siren`.

## Wokwi (`wokwi/`)

1 ESP32 memegang ketiga simpang S1–S3 (18 LED, berlabel di diagram). Tiap simpang punya fase A (jalan utama) dan
fase B (jalan silang), masing-masing merah/kuning/hijau:

| Simpang | Fase A (M/K/H) | Fase B (M/K/H) |
|---|---|---|
| S1 | 25 / 26 / 27 | 14 / 32 / 33 |
| S2 | 16 / 17 / 18 | 19 / 21 / 22 |
| S3 | 23 / 4 / 13 | 5 / 2 / 15 |

Cara menjalankan di wokwi.com:
1. Buat proyek ESP32 baru.
2. Tempel `sketch.ino` dan `diagram.json`.
3. Tambahkan library dari `libraries.txt` (PubSubClient, ArduinoJson).
4. Klik ▶.

`wokwi.toml` dipakai untuk menjalankan simulasi lewat `wokwi-cli` atau VS Code, dengan firmware hasil build di `wokwi/build/`. Kalau build server Wokwi sedang penuh, compile di laptop dengan `arduino-cli`, lalu di editor Wokwi pilih F1 → *Upload Firmware and Start Simulation*.

## Prediksi ETA (AI)

Pemicu lampu memakai model machine learning (regresi ridge log-linear) yang memprediksi berapa detik lagi kendaraan
sampai di simpang. Lampu hijau dibuka saat kendaraan di dalam radius, sedang mendekat, **dan** prediksi ETA ≤
`ETA_LEAD_S`. Jadi kendaraan cepat dapat hijau lebih awal, kendaraan lambat/terjebak tidak menahan lampu terlalu lama.

- Model (`backend/src/eta.ts`): ln ETA = w · [1, ln jarak, ln kecepatan sekarang, ln rata-rata kecepatan 10 dtk,
  percepatan], kecepatan minimal 4 m/s. Skala log membuatnya mengikuti fisika (kecepatan separuh → ETA kira-kira dua
  kali), jadi ambulans yang mengerem langsung mendapat ETA lebih lama. Kecepatan diambil dari `speed` GPS, atau
  dihitung dari selisih posisi bila `speed` tidak dikirim.
- Pelatihan: `npm run train:eta` (di `backend/`) mensimulasikan 400 perjalanan di rute demo (kecepatan acak, macet
  sampai 1 km, berhenti sampai 90 dtk, melambat di tikungan, noise GPS 4 m), melatih model, dan menulis bobotnya ke
  `src/eta-model.ts`.
- Hasil di perjalanan uji (data yang tidak dipakai melatih): MAE 22,1 dtk vs 25,5 dtk untuk cara naif jarak ÷
  kecepatan; dalam 60 dtk terakhir sebelum simpang keduanya setara (10,4 vs 9,8 dtk). Model regresi linear versi
  sebelumnya di data uji yang sama: 22,2 dan 12,3 dtk, dan hampir tidak bereaksi saat kendaraan melambat (rem 60 → 20
  km/j: ETA 89 → 106 dtk, padahal sebenarnya ~165 dtk; model baru 72 → 140–169 dtk).
- Keterbatasan: data latih masih sintetis. Langkah berikutnya: latih ulang dari rekaman GPS perjalanan asli.

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
| `ETA_LEAD_S` | `40` | lampu hijau saat prediksi ETA ≤ nilai ini (detik); `0` = pemicu radius saja |
| `STOP_RELEASE_S` | `180` | lampu hijau dilepas bila kendaraan berhenti (< 3 km/j) selama ini (detik); `0` = mati |
| `MISSION_CODES` | `DEMO-112` | kode misi awal, pisahkan dengan koma (bisa diubah dari Panel Demo) |
| `DEMO_KEY` | kosong | kunci Panel Demo; kosong = panel mati |

Akses dari HP (GPS asli): `cloudflared tunnel --url http://localhost:3000` lalu pakai URL `https://…trycloudflare.com` di app.
