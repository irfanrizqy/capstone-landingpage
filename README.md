# Web Testing Dashboard — Staging Branch

Repository ini berisi aplikasi Web Testing Dashboard berbasis Flask yang digunakan pada lingkungan staging untuk pengujian sistem load balancing, monitoring server, dan pengelolaan hasil load test.

Branch `staging` digunakan sebagai tempat pengembangan dan pengujian fitur sebelum perubahan diterapkan ke environment production pada web server utama.

## Tujuan Branch Staging

Branch ini dipakai untuk:

- Menguji perubahan fitur dashboard sebelum masuk ke branch `main`
- Melakukan validasi UI dan workflow load testing
- Mengecek integrasi dengan JMeter API, Node Exporter, dan endpoint backend
- Menampung perbaikan bug sebelum diterapkan ke VM production
- Menjadi environment uji coba agar perubahan tidak langsung mengganggu web server production

## Fitur Aplikasi

Aplikasi ini menyediakan:

- Landing page project Capstone Design
- Dashboard load testing berbasis Flask
- Konfigurasi single test dan multi-phase test
- Integrasi dengan JMeter API untuk menjalankan load test
- Monitoring CPU, RAM, dan network melalui Node Exporter
- Tampilan hasil pengujian berupa response time, throughput, success rate, dan bandwidth
- Riwayat pengujian / history test
- Detail hasil test melalui modal
- Export hasil pengujian ke JSON
- Export ringkasan hasil test ke CSV
- Export request-level CSV
- Admin mode untuk membuka batasan pengujian lanjutan
- Monitoring disk JMeter dan fitur cleanup hasil lama

## Perubahan pada Branch Staging

Perubahan utama pada branch ini:

1. Menambahkan fitur history test
   - Menampilkan daftar riwayat load test
   - Menampilkan detail hasil test dalam modal
   - Menampilkan statistik test lama tanpa harus menjalankan test ulang
   - Mendukung download hasil dari data history

2. Memperbaiki error download request CSV
   - Menambahkan proses generate CSV request-level secara on-demand
   - Menambahkan polling status sampai file CSV siap
   - Memperbaiki handling response ketika file belum selesai diproses
   - Menambahkan validasi content-type agar error dari server tidak dianggap sebagai CSV

3. Memperbaiki tombol download CSV
   - Tombol CSV Ringkasan sekarang memiliki feedback proses download
   - Tombol CSV Request sekarang menampilkan status proses seperti mengecek, generate, memproses, mengunduh, dan selesai
   - File request CSV besar akan menampilkan peringatan sebelum download
   - Jika ukuran file terlalu besar, user diarahkan untuk mengambil file langsung dari server menggunakan FileZilla

4. Merapikan struktur Flask
   - Route dipisahkan ke folder `routes/`
   - Helper dipisahkan ke folder `helpers/`
   - Frontend dashboard dipisah ke beberapa file JavaScript modular
   - Konfigurasi sensitif dipisahkan dari repository melalui `config.py`
   - Template konfigurasi disediakan melalui `config.example.py`

## Struktur Project

```text
.
├── app.py
├── dev_server.py
├── config.example.py (ubah menjadi config.py dan ubah beberapa baris di dalam config)
├── requirements.txt
├── DOKUMENTASI.md
├── helpers/
│   ├── csv_export.py
│   └── metrics_parser.py
├── routes/
│   ├── csv.py
│   ├── disk.py
│   ├── metrics.py
│   ├── pages.py
│   └── test.py
├── static/
│   ├── assets/images/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── app-admin.js
│       ├── app-disk.js
│       ├── app-history.js
│       ├── app-poll.js
│       ├── app-results.js
│       ├── app-state.js
│       ├── app-test.js
│       └── metrics.js
└── templates/
    ├── dashboard.html
    └── landing.html