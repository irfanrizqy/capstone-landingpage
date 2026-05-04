# Web Testing Dashboard

Aplikasi web berbasis Flask untuk landing page, dashboard load testing, monitoring metrik server, dan ekspor hasil pengujian.

Project ini digunakan sebagai bagian dari sistem pengujian load balancing dan monitoring beberapa web server.

## Fitur Utama

- Landing page aplikasi
- Dashboard load testing
- Integrasi dengan JMeter API
- Monitoring CPU, RAM, dan network melalui Node Exporter
- Export hasil pengujian ke CSV/JSON
- Admin mode untuk akses pengujian lanjutan
- Tampilan frontend menggunakan HTML, CSS, dan JavaScript

## Struktur Project

```text
.
├── app.py
├── dev_server.py
├── config.example.py
├── requirements.txt
├── DOKUMENTASI.md
├── helpers/
├── routes/
├── static/
│   ├── assets/images/
│   ├── css/
│   └── js/
└── templates/