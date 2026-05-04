# Dokumentasi Folder `4.0` — Web Testing Dashboard v4.2

## Tujuan

Folder ini adalah **aplikasi web** yang berjalan di VM-3, VM-4, dan VM-5. Fungsinya:

1. **Menjalankan load test** (pengujian beban) menggunakan Apache JMeter
2. **Memantau metrik server** (CPU, RAM, Network) secara real-time
3. **Menampilkan hasil test** dan menyediakan ekspor CSV/JSON

---

## Struktur Folder

```
4.0/
├── app.py              ← Entry point — jalankan ini untuk start server
├── config.py           ← Semua konfigurasi (WAJIB diubah tiap VM)
├── requirements.txt    ← Dependensi Python (Flask, requests, dll.)
│
├── routes/             ← Endpoint API Flask (satu file = satu grup endpoint)
│   ├── pages.py        ← Halaman HTML: / dan /dashboard
│   ├── test.py         ← Kontrol load test + sistem antrian JMeter
│   ├── metrics.py      ← Metrik server dari Node Exporter
│   ├── csv.py          ← Download hasil test sebagai CSV (format Excel Indonesia)
│   └── disk.py         ← Monitor & cleanup disk JMeter
│
├── helpers/            ← Fungsi utilitas (dipanggil oleh routes/)
│   ├── metrics_parser.py  ← Parsing format Prometheus → dict Python
│   └── csv_export.py      ← Konversi JSON hasil JMeter → CSV
│
├── templates/          ← Halaman HTML (template Jinja2)
│   ├── landing.html    ← Halaman beranda (/)
│   └── dashboard.html  ← Halaman utama load test (/dashboard)
│
└── static/             ← File statis yang langsung dikirim ke browser
    ├── css/style.css
    ├── js/             ← Logika frontend (8 modul JavaScript)
    │   ├── app-state.js    ← State global & utilitas — DIMUAT PERTAMA
    │   ├── app-admin.js    ← Login admin, kunci/buka opsi form
    │   ├── app-poll.js     ← Polling status test & animasi progress bar
    │   ├── app-test.js     ← Mulai/stop test, manajemen fase multi-phase
    │   ├── app-results.js  ← Tampilkan hasil test & grafik Chart.js
    │   ├── app-disk.js     ← Download CSV/JSON, monitor & cleanup disk
    │   ├── app.js          ← Entry point frontend (DOMContentLoaded)
    │   └── metrics.js      ← Tampilkan CPU/RAM/Network, sparkline chart
    └── assets/images/
```

---

## Cara Menjalankan

```bash
cd "4.0"

# 1. Install dependensi
pip install -r requirements.txt

# 2. Edit config.py — ubah 3 baris sesuai VM yang dipakai
#    SERVER_NAME, SERVER_IP, SERVER_HOSTNAME

# 3. Jalankan server
python3 app.py
```

Buka browser ke `http://<IP-VM>:5000/dashboard` untuk mengakses dashboard.

---

## Konfigurasi (`config.py`)

File ini adalah **pusat konfigurasi**. Yang **wajib diubah** tiap VM hanya 3 baris di bagian `IDENTITAS SERVER`:

```python
SERVER_NAME     = "Web Server 1"      # Nama tampil di UI
SERVER_IP       = "192.168.100.40"    # IP VM ini
SERVER_HOSTNAME = "cd-web-1"          # Hostname VM ini
```

| VM   | SERVER_NAME     | SERVER_IP          | SERVER_HOSTNAME |
|------|-----------------|--------------------|-----------------|
| VM-3 | Web Server 1    | 192.168.100.40     | cd-web-1        |
| VM-4 | Web Server 2    | 192.168.100.45     | cd-web-2        |
| VM-5 | Web Server 3    | 192.168.100.50     | cd-web-3        |

Bagian lain di `config.py` (URL layanan, batas user, opsi dropdown) **sama untuk semua VM** dan tidak perlu diubah.

### Konfigurasi penting lainnya

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `JMETER_API_URL` | `http://192.168.100.50:8080` | Alamat JMeter API Server |
| `ADMIN_PASSWORD` | `qaz12345` | Password login Admin Mode di dashboard |
| `USER_MAX_THREADS` | `5` | Maks users untuk pengguna biasa |
| `USER_MAX_DURATION` | `60` | Maks durasi test (detik) untuk pengguna biasa |
| `USER_MAX_PHASES` | `3` | Maks fase multi-phase untuk pengguna biasa |
| `MAX_CONCURRENT_TESTS` | `5` | Maks test berjalan bersamaan untuk user biasa; Admin selalu bypass antrian |
| `QUEUE_TTL_S` | `60` | Entri antrian kadaluarsa setelah N detik (misal jika user reload/tutup tab) |
| `METRICS_REFRESH_INTERVAL` | `5` | Interval refresh metrik (detik) |

---

## Alur Kerja Keseluruhan

```
Browser User
    │
    ▼
Flask (app.py — port 5000)
    │
    ├── GET  /dashboard  ──────────────→ dashboard.html (dengan config dari Jinja2)
    │
    ├── GET  /api/metrics/current  ────→ Node Exporter :9100 → parse → JSON
    │
    ├── POST /api/test/start  ─────────→ JMeter API :8080
    │       └── JMeter sibuk? → antrian in-memory → cek tiap 3 detik
    │
    ├── GET  /api/test/status/<id>  ───→ JMeter API :8080
    │
    ├── GET  /api/test/results/<id>  ──→ JMeter API :8080
    │
    ├── GET  /api/test/results/<id>/summary/csv  → CSV dengan format Excel Indonesia
    │
    └── GET  /api/jmeter/disk  ────────→ JMeter API :8080 (info disk)
```

---

## Penjelasan Komponen Backend (Python)

### `app.py` — Entry Point

Tidak ada logika bisnis di sini. Tugasnya:
1. Setup logging ke file + console
2. Buat instance Flask
3. Daftarkan 5 Blueprint (routes)
4. Tambahkan header `X-Backend-Server` ke setiap response (identifikasi VM)

### `routes/pages.py` — Halaman HTML

Melayani dua halaman:
- `GET /` → landing page
- `GET /dashboard` → halaman utama load test

Semua variabel dari `config.py` (preset URL, opsi thread, password admin, dll.) dikirim ke template HTML via Jinja2 sehingga nilai konfigurasi bisa muncul langsung di form tanpa hardcode di HTML.

### `routes/test.py` — Kontrol Load Test

File paling kompleks. Mengelola:

- **Proxy ke JMeter API** — semua request test diteruskan ke JMeter di VM lain (:8080)
- **Sistem antrian** — jika JMeter sedang menjalankan test lain, request baru masuk antrian in-memory. Background thread (`_queue_worker`) cek setiap 3 detik; jika JMeter sudah bebas, test berikutnya dimulai otomatis
- **Cek konektivitas** — endpoint `/api/jmeter/ping` dan `/api/test/ping` memverifikasi bahwa JMeter dan server target bisa dijangkau sebelum test dimulai

Endpoint yang tersedia:

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | `/api/test/ping` | Cek apakah server target bisa dijangkau |
| GET | `/api/jmeter/ping` | Cek apakah JMeter API bisa dijangkau |
| POST | `/api/test/start` | Mulai load test (atau antri jika JMeter sibuk) |
| GET | `/api/test/queue/status/<id>` | Cek posisi antrian |
| GET | `/api/test/status/<id>` | Cek status test yang berjalan |
| GET | `/api/test/results/<id>` | Ambil hasil test (JSON) |
| POST | `/api/test/stop/<id>` | Hentikan test yang sedang berjalan |

### `routes/metrics.py` — Metrik Server

Membaca data dari **Node Exporter** (port 9100) dalam format Prometheus, lalu diparsing oleh `helpers/metrics_parser.py` menjadi dict yang berisi CPU, RAM, dan Network.

Endpoint `/api/metrics/all` bisa mengambil metrik dari semua VM sekaligus (berguna untuk tampilan monitoring terpusat).

### `routes/csv.py` + `helpers/csv_export.py` — Export CSV

Mengambil hasil JSON dari JMeter API lalu mengkonversinya ke CSV dengan format **Excel Indonesia**:
- Delimiter titik koma (`;`) — sesuai setting regional Excel Indonesia
- BOM UTF-8 (`﻿`) — agar Excel langsung mengenali encoding
- Header `sep=;` — agar Excel otomatis memisahkan kolom

### `routes/disk.py` — Monitoring Disk JMeter

Proxy ke JMeter API untuk:
- `GET /api/jmeter/disk` → cek penggunaan disk di VM JMeter
- `POST /api/jmeter/cleanup` → hapus hasil test lama, simpan N test terbaru

### `helpers/metrics_parser.py`

Mengubah teks mentah format Prometheus dari Node Exporter menjadi dict Python. Menghitung:
- **CPU usage** = 100% dikurangi persentase waktu idle
- **RAM usage** = MemTotal - MemAvailable
- **Network** = jumlah semua interface (lo, eth0, dll.)

---

## Penjelasan Komponen Frontend (JavaScript)

7 file JS dimuat **berurutan** di `dashboard.html`. Urutan ini **penting** karena variabel global dibagi antar file (tidak menggunakan ES Modules).

### Urutan Load & Tanggung Jawab

| Urutan | File | Tanggung Jawab |
|--------|------|----------------|
| 1 | `app-state.js` | Semua variabel global & fungsi utilitas (`sleep`, `updateStatus`, `setBadge`, dll.) |
| 2 | `app-admin.js` | Login admin modal, lock/unlock opsi form, tab Single/Multi-Phase |
| 3 | `app-poll.js` | Polling status test tiap 2 detik, animasi progress bar tiap 100ms, polling antrian |
| 4 | `app-test.js` | Validasi form, mulai/stop test, manajemen fase multi-phase |
| 5 | `app-results.js` | Ambil & tampilkan hasil test, update grafik response time & success rate |
| 6 | `app-disk.js` | Download CSV/JSON, monitor disk JMeter, modal cleanup |
| 7 | `app.js` | Entry point: pasang event listener saat halaman siap |
| — | `metrics.js` | Ambil & tampilkan CPU/RAM/Network, sparkline chart, badge status footer |

### Alur Saat User Klik START TEST

```
1. handleStartSingleTest()          [app-test.js]
   │  → validasi form
   │  → checkConnectivity()         cek JMeter API + target server
   │  → POST /api/test/start
   │
   ├── Respons "success"
   │   └── currentTestId = data.test_id
   │       → onTestStarted()
   │
   └── Respons "queued"
       └── waitForQueue()           [app-poll.js]
           │  polling /api/test/queue/status tiap 3 detik
           └── status "started" → onTestStarted()

2. onTestStarted()                  [app-test.js]
   ├── startPolling()               polling /api/test/status tiap 2 detik
   └── startProgressAnimation()    update progress bar tiap 100ms

3. pollStatus() → status "completed"
   └── fetchResults()              [app-results.js]
       ├── displayResults()         tampilkan tabel statistik
       └── updateChartSingle()      update grafik response time
```

### Alur Multi-Phase Test

Setiap fase dijalankan secara berurutan. Setelah satu fase selesai, `fetchResults()` memanggil `runPhase()` untuk memulai fase berikutnya. Data timeline semua fase digabungkan di `allPhasesTimeline` untuk ditampilkan dalam satu grafik dengan garis pembatas antar fase.

```
handleStartMultiPhase()
    └── runPhase(fase 1) → polling → selesai
        └── fetchResults() → simpan ke allPhasesTimeline
            └── runPhase(fase 2) → polling → selesai
                └── fetchResults() → simpan ke allPhasesTimeline
                    └── finishMultiPhase() → displayMultiPhaseResults()
```

---

## Admin Mode

Klik tombol **"Admin"** di header dashboard → masukkan password (`config.ADMIN_PASSWORD`).

Saat Admin Mode aktif:
- Semua batas user (max threads, durasi, jumlah fase) dinonaktifkan
- Badge "Admin" muncul di header
- Badge **💾 Disk JMeter** di footer menjadi dapat diklik → membuka modal cleanup disk

Untuk logout: klik tombol "Logout Admin".

### Deteksi Jenis Test Otomatis

Dashboard mendeteksi jenis test secara otomatis berdasarkan kombinasi parameter dan menampilkan indikator berwarna di bawah form:

| Jenis | Kondisi | Keterangan |
|-------|---------|------------|
| 🔍 Smoke Test | Users ≤ 2 | Beban minimal, cek server aktif |
| ⚡ Spike Test | Ramp-up = 0 + Users ≥ 5 | Lonjakan traffic tiba-tiba |
| 🔥 Stress Test | Users ≥ 50 | Cari batas maksimal server |
| ⏳ Soak Test | Durasi ≥ 300s | Uji stabilitas jangka panjang |
| 📊 Load Test | Kondisi lainnya | Simulasi penggunaan normal |

Indikator ini juga muncul sebagai badge kecil di tiap fase panel Multi-Phase dan otomatis diperbarui saat nilai berubah.

Dropdown **Ramp-up Time** menyediakan opsi **"0 seconds — Spike Test"** di urutan teratas agar Spike Test langsung bisa dipilih tanpa perlu input custom. Daftar opsi dapat diubah di `config.py` bagian `RAMP_TIME_OPTIONS`.

### Ringkasan Waktu & Garis Ramp-up di Grafik

Di bawah indikator jenis test terdapat **ringkasan pembagian waktu** yang muncul otomatis saat nilai diisi:

```
[⏱ Ramp-up: 10s]  +  [⚡ Beban penuh: 20s]  =  [📋 Total: 30s]
```

Karena JMeter menggunakan `duration` sebagai **total waktu termasuk ramp-up**, beban penuh dihitung sebagai `duration − ramp_time`.

Di **grafik response time**, terdapat **garis vertikal abu-abu** bertanda "↑ Beban penuh" yang menandai detik di mana ramp-up selesai dan semua user sudah aktif. Untuk Multi-Phase, setiap fase memiliki garis ramp-up sendiri (label "F1 full load", "F2 full load", dst.) di samping garis batas antar fase (hijau).

### Cara Menggunakan Cleanup Disk

1. Login sebagai Admin terlebih dahulu
2. Scroll ke bawah halaman hingga footer
3. Klik badge **💾 Disk JMeter: XX% (YGB bebas)** — badge ini baru bisa diklik setelah Admin Mode aktif
4. Modal cleanup akan muncul, isi berapa test terbaru yang ingin disimpan (default: 10)
5. Klik **🗑️ Hapus Sekarang**

> **Catatan bug yang sudah diperbaiki:** Sebelumnya modal cleanup tidak muncul sama sekali karena struktur HTML-nya salah — `cleanupModalOverlay` ter-nest di dalam `adminModalOverlay`, sehingga modal cleanup selalu tersembunyi karena parent-nya `display:none`. Sudah diperbaiki di `dashboard.html` baris 14–45.

---

## Ketergantungan Eksternal

| Layanan | Alamat Default | Fungsi |
|---------|----------------|--------|
| **JMeter API** | `192.168.100.50:8080` | Menjalankan load test sebenarnya |
| **Node Exporter** | `localhost:9100` | Data metrik CPU/RAM/Network |
| **Prometheus** | `192.168.100.35:9090` | Data historis (opsional, belum dipakai aktif) |

> Jika JMeter API tidak bisa dijangkau, test tidak bisa dimulai tetapi dashboard tetap bisa dibuka dan metrik server tetap tampil.

---

## Menambah VM Baru

1. Edit `config.py`, tambahkan entry di `_BACKEND_VMS`:
   ```python
   {"name": "Web Server 4", "ip": "192.168.100.55", "hostname": "cd-web-4"},
   ```
2. Tambahkan preset di `TARGET_PRESETS` (opsional):
   ```python
   "web_server_4": {"name": "Web Server 4", "url": "http://192.168.100.55", "icon": "🖥️"},
   ```
3. Copy folder `4.0` ke VM baru, ubah `SERVER_NAME`, `SERVER_IP`, `SERVER_HOSTNAME`.
4. Jalankan `python3 app.py`.
