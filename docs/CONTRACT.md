# Kontrak SIREN — Backend ↔ Mobile App ↔ ESP32 (Wokwi) ↔ Dashboard

Pemilik backend: Devan · Konsumen: Irfan (mobile app + Wokwi). Ubah kontrak ini hanya lewat diskusi berdua.

## Alur

```
Mobile App ──POST /api/gps (tiap 1 dtk)──▶ Backend ──publish──▶ HiveMQ
                                                        ├──▶ ESP32 Wokwi   (sub intersection/{id}/cmd)
                                                        ├──▶ Web Dashboard (sub siren-polnes26/#)
                                                        └──▶ Citizen HUD   (sub vehicle/+)
```

## HTTP (base URL: `http://<laptop-devan>:3000`, atau URL tunnel `cloudflared`)

### Kode misi (wajib untuk driver)

`POST /api/gps` dan `GET /api/mission` wajib membawa header `Authorization: Bearer <kode misi>`. Kode diatur lewat env
`MISSION_CODES` (default demo `DEMO-112`). Tanpa kode atau kode salah → `401 { "error": "invalid mission code" }`,
dan tidak ada yang di-publish. Di dunia nyata kode ini diterbitkan Command Center 112 / RS rujukan per perjalanan.

### `GET /api/mission`

Cek kode misi sebelum mulai: `204` jika valid, `401` jika tidak.

### `POST /api/mission/end`

Dipanggil saat driver menekan *Selesai Misi*: `{ "vehicleId": "AMB-01" }` + header kode misi. Backend langsung
melepas simpang yang dipegang kendaraan itu dan publish pesan `gone` (lihat topic `vehicle`), tanpa menunggu 15 dtk.
Respons `204`; `400` kalau `vehicleId` tidak valid; `401` kalau kode salah.

### `POST /api/gps`

Kirim tiap 1 detik selama misi aktif. Berhenti kirim = misi selesai (backend melepas simpang setelah 15 dtk).

```json
{ "vehicleId": "AMB-01", "type": "ambulance", "lat": -8.172057, "lng": 113.694133, "speed": 60, "heading": 45 }
```

| Field | Wajib | Aturan |
|---|---|---|
| `vehicleId` | ya | `^[A-Za-z0-9_-]{1,32}$` (tanpa `/`, spasi) |
| `type` | ya | `"ambulance"` atau `"firetruck"` |
| `lat`, `lng` | ya | angka desimal |
| `speed` | tidak | km/jam, ≥ 0 |
| `heading` | tidak | derajat 0–359, 0 = utara |

Respons `200` (untuk Driver HUD):

```json
{ "nextIntersection": { "id": "S1", "name": "Simpang PB Sudirman – Bedadung – Anggrek", "distanceM": 450, "mode": "PRIORITY", "etaS": 31 } }
```

`nextIntersection` = simpang terdekat yang sedang didekati; `null` jika tidak ada. `mode` dilihat dari kendaraan ini:
`PRIORITY` hanya jika lampu hijau dipegang untuk kendaraan ini; dipegang kendaraan lain = `NORMAL` (tunggu). `etaS` = prediksi detik sampai tiba
di simpang itu (model AI ETA, lihat README → Prediksi ETA).
Respons `400`: `{ "error": "invalid gps payload", "fields": ["type"] }`. Respons `401`: kode misi tidak valid (lihat atas).

### `GET /api/route`

Rute demo sebagai `[[lat, lng], …]` (isi sama dengan `backend/scripts/route.json`). Dipakai dashboard untuk garis rute
dan penanda titik awal/akhir.

### `GET /api/intersections`

Daftar simpang `[{ id, name, lat, lng, axisA }]` (lihat tabel di bawah).

### `GET /api/config`

`{ topicPrefix, mqttWsUrl, radiusM, staleS, simSpeedKmh, etaLeadS, stopReleaseS }`. Dipakai dashboard dan Citizen HUD.
`etaLeadS` = ambang prediksi ETA (detik) untuk membuka lampu hijau; `0` = pemicu radius saja. `stopReleaseS` = lama
kendaraan berhenti (< 3 km/j) sebelum lampu hijaunya dilepas; `0` = tidak pernah. `radiusM` dan
`simSpeedKmh` (kecepatan simulasi rute di Driver PWA) bisa berubah dari Panel Demo.

### Panel Demo: `/api/demo` (khusus operator demo)

Semua wajib header `X-Demo-Key` = env `DEMO_KEY`. Env kosong → `403`, kunci salah → `401`.
Kecuali `POST /api/demo/quick-run` (tanpa kunci, untuk tombol *Mulai demo* di dashboard): menjalankan satu ambulans
simulasi di dalam zona S1 (0,75 × radius sebelum simpang). Maksimal 3 kendaraan simulasi sekaligus; lebih dari itu
→ `429`. Respons `201 { vehicleId }`. `DEMO_KEY` kosong → `403`.

| Endpoint | Body | Fungsi |
|---|---|---|
| `GET /api/demo` | - | status: `codes`, `radiusM`, `citizenAlongM`, `speedKmh`, `routeLengthM`, `stops`, `runs` |
| `PUT /api/demo` | `{ codes?, radiusM?, citizenAlongM?, speedKmh? }` | ubah pengaturan langsung, lalu publish topic `demo` |
| `POST /api/demo/run` | `{ type, startM }` | jalankan kendaraan simulasi di server dari `startM` meter sepanjang rute |
| `POST /api/demo/pause` | - | jeda semua kendaraan simulasi (tetap di tempat, `speed` 0, lampu tetap dipegang) |
| `POST /api/demo/resume` | - | lanjutkan kendaraan yang dijeda |
| `POST /api/demo/clear` | - | hapus semua kendaraan simulasi (langsung dilepas + pesan `gone`) |
| `POST /api/demo/reset` | - | semua simpang NORMAL, kendaraan simulasi (termasuk yang sudah sampai tujuan) kembali ke titik mulai (dijeda, trip baru) |

Pengaturan ini hanya di memori: restart server = kembali ke default env.

### Halaman web

- `/`: Web Dashboard (Command Center).
- `/mobile/`: PWA, berisi Driver Cockpit dan Citizen HUD.

## MQTT

Broker `broker.hivemq.com` — ESP32/Node: TCP `1883`; browser: `wss://broker.hivemq.com:8884/mqtt`.
Prefix topic: `siren-polnes26/`. Broker publik → siapa pun bisa publish; selalu validasi JSON yang diterima.

### `siren-polnes26/intersection/{id}/cmd` — backend → ESP32 (retained)

```json
{ "mode": "PRIORITY", "phase": "A", "vehicleId": "AMB-01", "vehicleType": "ambulance", "ttl": 15, "ts": 1789000000000, "etaS": 38 }
{ "mode": "NORMAL", "ts": 1789000000000 }
```

Selama kendaraan masih mendekat, backend mengirim ulang `PRIORITY` tiap 5 detik.

### `siren-polnes26/vehicle/{vehicleId}` — backend → dashboard & Citizen HUD

```json
{ "vehicleId": "AMB-01", "type": "ambulance", "lat": -8.16, "lng": 113.70, "speed": 60, "heading": 45, "nextId": "S1", "etaS": 31, "ts": 1789000000000 }
```

`nextId` dan `etaS` (opsional, ada jika kendaraan sedang mendekati simpang) = simpang berikutnya dan prediksi detik
sampai tiba, sama dengan `nextIntersection` di respons `POST /api/gps`. Pesan ini dikirim tepat sebelum perintah
`intersection/{id}/cmd` yang dipicunya.

Saat misi selesai atau kendaraan simulasi dihentikan, topic yang sama menerima `{ "vehicleId": "AMB-01", "gone": true, "ts": … }`
(tanpa `lat`/`lng`): hapus kendaraan itu sekarang juga.

Citizen HUD: subscribe `siren-polnes26/vehicle/+`, hitung jarak (Haversine) dari posisi HP sendiri, tampilkan
peringatan mis. "Ambulans 300 m di belakang" jika < 1 km.

### `siren-polnes26/demo` — backend → Citizen HUD & dashboard (retained)

```json
{ "citizen": { "lat": -8.1659, "lng": 113.7052, "heading": 35 }, "radiusM": 1000, "simSpeedKmh": 60, "ts": 1789000000000 }
```

Dikirim saat server start dan tiap kali Panel Demo berubah. Citizen HUD yang mencentang *Posisi simulasi* memakai
`citizen` sebagai posisinya dan `radiusM` sebagai batas peringatan; dashboard menampilkan titik warga dan radius baru.

## Aturan ESP32 (Wokwi)

- 1 ESP32 memegang S1–S3: subscribe `siren-polnes26/intersection/+/cmd`, ambil id simpang dari topic, abaikan id lain.
- 6 LED per simpang: **fase A** = jalan utama (merah/kuning/hijau), **fase B** = jalan silang (merah/kuning/hijau).
- `NORMAL`: siklus biasa (saran: A hijau 10 dtk → A kuning 3 dtk → B hijau 10 dtk → B kuning 3 dtk).
- `PRIORITY` fase X: jika jalur lawan sedang hijau → kuning 3 dtk → merah; lalu jalur X hijau, tahan.
- **Failsafe:** tidak menerima `PRIORITY` baru selama `ttl` detik → kembali ke siklus `NORMAL`.
- Kembali ke `NORMAL` setelah `PRIORITY` (perintah NORMAL atau failsafe): jalur yang tadi ditahan hijau langsung
  kuning 3 dtk, lalu jalur lawan (yang sudah menunggu) hijau. Jangan mulai ulang siklus dari jalur yang sama.
- WiFi Wokwi: SSID `Wokwi-GUEST`, tanpa password. Client ID MQTT harus unik (mis. `siren-esp32-<random>`).
- Keep-alive MQTT 60 detik (`mqtt.setKeepAlive(60)`). Wokwi sering berjalan lebih lambat dari waktu nyata, dan dengan default 15 detik broker memutus koneksi.
- Tes tanpa backend: `npx mqtt pub -h broker.hivemq.com -t "siren-polnes26/intersection/S1/cmd" -m '{"mode":"PRIORITY","phase":"A","vehicleId":"AMB-01","vehicleType":"ambulance","ttl":15,"ts":0}'`

## Simpang demo (Denpasar, Bali)

| id | Nama | lat | lng | axisA |
|---|---|---|---|---|
| S1 | Simpang Imam Bonjol – Pulau Galang | -8.6956617 | 115.1870329 | 35 |
| S2 | Simpang Imam Bonjol – Gunung Soputan | -8.6892329 | 115.1917795 | 32 |
| S3 | Simpang Imam Bonjol – Teuku Umar Barat | -8.6819342 | 115.1969248 | 35 |

## Rute demo (untuk Route Simulator mobile)

Jl. Nakula (Kuta) → Jl. Imam Bonjol → Jl. Teuku Umar → RSUP Prof. dr. I.G.N.G. Ngoerah, ±5,1 km. 20 titik `[lat, lng]`
(rute penuh 237 titik ada di `backend/scripts/route.json` dan salinannya `mobile/data/route.json`; interpolasi
antar-titik agar gerakan halus):

```json
[[-8.699574,115.179509],[-8.699977,115.182318],[-8.700258,115.185046],[-8.698727,115.185328],[-8.695921,115.186717],
 [-8.693199,115.188336],[-8.690537,115.19027],[-8.688666,115.191952],[-8.688002,115.192347],[-8.685103,115.194452],
 [-8.682675,115.196398],[-8.681531,115.197555],[-8.681098,115.200954],[-8.67996,115.203854],[-8.678158,115.205352],
 [-8.677028,115.206161],[-8.676034,115.206676],[-8.676105,115.207133],[-8.676769,115.209954],[-8.675111,115.210838]]
```
