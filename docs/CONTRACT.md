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
{ "nextIntersection": { "id": "S1", "name": "Simpang PB Sudirman – Bedadung – Anggrek", "distanceM": 450, "mode": "PRIORITY" } }
```

`nextIntersection` = simpang terdekat yang sedang didekati; `null` jika tidak ada.
Respons `400`: `{ "error": "invalid gps payload", "fields": ["type"] }`. Respons `401`: kode misi tidak valid (lihat atas).

### `GET /api/route`

Rute demo sebagai `[[lat, lng], …]` (isi sama dengan `backend/scripts/route.json`). Dipakai dashboard untuk garis rute
dan penanda titik awal/akhir.

### `GET /api/intersections`

Daftar simpang `[{ id, name, lat, lng, axisA }]` (lihat tabel di bawah).

### `GET /api/config`

`{ topicPrefix, mqttWsUrl, radiusM, staleS, simSpeedKmh }`. Dipakai dashboard dan Citizen HUD. `radiusM` dan
`simSpeedKmh` (kecepatan simulasi rute di Driver PWA) bisa berubah dari Panel Demo.

### Panel Demo: `/api/demo` (khusus operator demo)

Semua wajib header `X-Demo-Key` = env `DEMO_KEY`. Env kosong → `403`, kunci salah → `401`.

| Endpoint | Body | Fungsi |
|---|---|---|
| `GET /api/demo` | - | status: `codes`, `radiusM`, `citizenAlongM`, `speedKmh`, `routeLengthM`, `stops`, `runs` |
| `PUT /api/demo` | `{ codes?, radiusM?, citizenAlongM?, speedKmh? }` | ubah pengaturan langsung, lalu publish topic `demo` |
| `POST /api/demo/run` | `{ type, startM }` | jalankan kendaraan simulasi di server dari `startM` meter sepanjang rute |
| `POST /api/demo/pause` | - | jeda semua kendaraan simulasi (tetap di tempat, `speed` 0, lampu tetap dipegang) |
| `POST /api/demo/resume` | - | lanjutkan kendaraan yang dijeda |
| `POST /api/demo/clear` | - | hapus semua kendaraan simulasi (langsung dilepas + pesan `gone`) |
| `POST /api/demo/reset` | - | semua simpang NORMAL, kendaraan simulasi kembali ke titik mulai (dijeda, trip baru) |

Pengaturan ini hanya di memori: restart server = kembali ke default env.

### Halaman web

- `/`: Web Dashboard (Command Center).
- `/mobile/`: PWA, berisi Driver Cockpit dan Citizen HUD.

## MQTT

Broker `broker.hivemq.com` — ESP32/Node: TCP `1883`; browser: `wss://broker.hivemq.com:8884/mqtt`.
Prefix topic: `siren-polnes26/`. Broker publik → siapa pun bisa publish; selalu validasi JSON yang diterima.

### `siren-polnes26/intersection/{id}/cmd` — backend → ESP32 (retained)

```json
{ "mode": "PRIORITY", "phase": "A", "vehicleId": "AMB-01", "vehicleType": "ambulance", "ttl": 15, "ts": 1789000000000 }
{ "mode": "NORMAL", "ts": 1789000000000 }
```

Selama kendaraan masih mendekat, backend mengirim ulang `PRIORITY` tiap 5 detik.

### `siren-polnes26/vehicle/{vehicleId}` — backend → dashboard & Citizen HUD

```json
{ "vehicleId": "AMB-01", "type": "ambulance", "lat": -8.16, "lng": 113.70, "speed": 60, "heading": 45, "ts": 1789000000000 }
```

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

- 1 ESP32 = 1 simpang. Set `INTERSECTION_ID` (`"S1"`/`"S2"`/`"S3"`), subscribe `siren-polnes26/intersection/<ID>/cmd`.
- 6 LED: **fase A** = jalan utama (merah/kuning/hijau), **fase B** = jalan silang (merah/kuning/hijau).
- `NORMAL`: siklus biasa (saran: A hijau 10 dtk → A kuning 3 dtk → B hijau 10 dtk → B kuning 3 dtk).
- `PRIORITY` fase X: jika jalur lawan sedang hijau → kuning 3 dtk → merah; lalu jalur X hijau, tahan.
- **Failsafe:** tidak menerima `PRIORITY` baru selama `ttl` detik → kembali ke siklus `NORMAL`.
- WiFi Wokwi: SSID `Wokwi-GUEST`, tanpa password. Client ID MQTT harus unik (mis. `siren-esp32-S1-<random>`).
- Keep-alive MQTT 60 detik (`mqtt.setKeepAlive(60)`). Wokwi sering berjalan lebih lambat dari waktu nyata, dan dengan default 15 detik broker memutus koneksi.
- Tes tanpa backend: `npx mqtt pub -h broker.hivemq.com -t "siren-polnes26/intersection/S1/cmd" -m '{"mode":"PRIORITY","phase":"A","vehicleId":"AMB-01","vehicleType":"ambulance","ttl":15,"ts":0}'`

## Simpang demo (Jember)

| id | Nama | lat | lng | axisA |
|---|---|---|---|---|
| S1 | Simpang PB Sudirman – Bedadung – Anggrek | -8.166863 | 113.704253 | 35 |
| S2 | Simpang PB Sudirman – Mastrip – Sroedji | -8.156951 | 113.711360 | 35 |
| S3 | Simpang Sroedji – Slamet Riyadi – dr. Soebandi | -8.151537 | 113.717539 | 54 |

## Rute demo (untuk Route Simulator mobile)

Jl. Gajah Mada (Kaliwates) → RSUD dr. Soebandi, ±4,0 km. 20 titik `[lat, lng]` (rute penuh 117 titik ada di
`backend/scripts/route.json` dan salinannya `mobile/data/route.json`; interpolasi antar-titik agar gerakan halus):

```json
[[-8.172057,113.694133],[-8.171326,113.696342],[-8.170465,113.697997],[-8.169704,113.699432],[-8.168804,113.701003],
 [-8.168039,113.702525],[-8.167021,113.704142],[-8.165426,113.705289],[-8.163947,113.706332],[-8.161687,113.707953],
 [-8.160866,113.708537],[-8.159372,113.709615],[-8.15707,113.711275],[-8.155306,113.712581],[-8.154937,113.712937],
 [-8.153658,113.71464],[-8.15251,113.716203],[-8.151376,113.717208],[-8.150689,113.715433],[-8.150439,113.713894]]
```
