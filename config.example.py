"""
config.py — Konfigurasi Web Testing Dashboard (4.0)

=======================================================================
PANDUAN DEPLOY KE BEBERAPA VM
=======================================================================
Hanya bagian "IDENTITAS SERVER" yang perlu diubah tiap VM.
Semua bagian lain (URL layanan, preset, dll.) sama untuk semua VM.

  VM-3: SERVER_NAME="Web Server 1",  SERVER_IP="192.168.100.40", SERVER_HOSTNAME="cd-web-1"
  VM-4: SERVER_NAME="Web Server 2",  SERVER_IP="192.168.100.45", SERVER_HOSTNAME="cd-web-2"
  VM-5: SERVER_NAME="Web Server 3",  SERVER_IP="192.168.100.50", SERVER_HOSTNAME="cd-web-3"

=======================================================================
CARA MENAMBAH VM BARU
=======================================================================
1. Tambah dict di _BACKEND_VMS:
      {"name": "Nama VM", "ip": "192.168.100.XX", "hostname": "hostname-vm"},
2. Tambah preset di TARGET_PRESETS (opsional, jika ingin muncul di shortcut):
      "key_baru": {"name": "Nama Tampil", "url": "http://192.168.100.XX", "icon": "🖥️"},
3. Tambah keterangan VM di bagian PANDUAN DEPLOY di atas.
4. Copy file ini ke VM baru, ganti hanya bagian IDENTITAS SERVER.

Untuk menghapus VM: hapus entri yang ditandai "# HAPUS JIKA TIDAK PERLU"
=======================================================================
"""

# ==================== IDENTITAS SERVER ====================
# !! GANTI BAGIAN INI SESUAI VM YANG SEDANG DIKONFIGURASI !!

SERVER_NAME     = "Web Server X"       # Nama tampil di dashboard
SERVER_IP       = "192.168.100.X"               # IP VM ini
SERVER_HOSTNAME = "cd-web-X"           # Hostname VM ini

# ==================== LAYANAN EKSTERNAL ====================
# Sama untuk semua VM — tidak perlu diubah

# JMeter API Server (VM terpisah tempat load test dijalankan)
JMETER_API_URL = "http://jmeter-api-IP:8080"

# Node Exporter — selalu localhost karena berjalan di VM yang sama
NODE_EXPORTER_URL = "http://localhost:9100"

# Prometheus Server — untuk data historis (opsional)
PROMETHEUS_URL = "http://prometheus-IP:9090"

# ==================== DAFTAR SEMUA BACKEND VM ====================
# Dipakai oleh /api/metrics/all untuk polling metrik semua VM sekaligus.
# is_self otomatis True untuk VM yang SERVER_IP-nya cocok.

_BACKEND_VMS = [
    {"name": "Web Server 1", "ip": "192.168.100.40", "hostname": "cd-web-1"},
    {"name": "Web Server 2", "ip": "192.168.100.45", "hostname": "cd-web-2"},
    {"name": "Web Server 3", "ip": "192.168.100.50", "hostname": "cd-web-3"},
]

ALL_SERVERS = [
    {**vm, "is_self": vm["ip"] == SERVER_IP}
    for vm in _BACKEND_VMS
]

# ==================== PRESET TARGET URL ====================
# Daftar URL yang muncul sebagai shortcut di form dashboard.
# "This Server" otomatis menggunakan SERVER_IP dan SERVER_NAME di atas.

TARGET_PRESETS = {
    "load_balancer": {
        "name": "Load Balancer — Q-Learning",
        "url":  "http://192.168.100.30",
        "icon": "🎯"
    },
    "load_balancer_wrr": {
        "name": "Load Balancer — WRR",
        "url":  "http://192.168.100.55",
        "icon": "⚖️"
    },
    "web_server_1": {
        "name": "Web Server 1",
        "url":  "http://192.168.100.40",
        "icon": "🖥️"
    },
    "web_server_2": {
        "name": "Web Server 2",
        "url":  "http://192.168.100.45",
        "icon": "🖥️"
    },
    "web_server_3": {
        "name": "Web Server 3",
        "url":  "http://192.168.100.50",
        "icon": "🖥️"
    },
    "this_server": {
        "name": f"This Server ({SERVER_NAME})",
        "url":  f"http://{SERVER_IP}",
        "icon": "🔧"
    },
}

DEFAULT_TARGET_URL = "http://192.168.100.30"  # URL default saat dashboard dibuka

# ==================== PARAMETER LOAD TEST DEFAULT ====================

DEFAULT_NUM_THREADS = 5
DEFAULT_RAMP_TIME   = 10
DEFAULT_DURATION    = 60
DEFAULT_HTTP_PATH   = "/"

# ==================== BATAS USER MODE ====================
# Batasan untuk pengguna biasa (bukan admin).
# Admin bisa melampaui semua batas ini setelah login dengan ADMIN_PASSWORD.

ADMIN_PASSWORD        = "changeme"  # Password untuk aktifkan Admin Mode di dashboard
LARGE_FILE_WARNING_MB = 100         # Batas ukuran CSV (MB) sebelum muncul dialog peringatan file besar
USER_MAX_THREADS      = 50           # Maks users (threads) untuk user biasa
USER_MAX_DURATION     = 60          # Maks durasi (detik) untuk user biasa
USER_MAX_PHASES       = 3           # Maks fase untuk user biasa di Multi-Phase test
MAX_CONCURRENT_TESTS  = 5           # Maks test yang boleh berjalan bersamaan; lebih dari ini masuk antrian
QUEUE_TTL_S           = 60          # Entri antrian kadaluarsa setelah N detik (jika user reload/tutup tab)

# ==================== OPSI DROPDOWN FORM ====================

THREAD_OPTIONS = [
    {"value": "1",     "label": "1 user"},
    {"value": "5",     "label": "5 users"},
    {"value": "10",    "label": "10 users"},
    {"value": "50",    "label": "50 users"},
    {"value": "100",   "label": "100 users"},
    {"value": "500",   "label": "500 users"},
    {"value": "1000",  "label": "1000 users"},
    {"value": "2500",  "label": "2500 users"},
    {"value": "5000",  "label": "5000 users"},
    {"value": "custom","label": "Custom..."},
]

RAMP_TIME_OPTIONS = [
    {"value": "0",      "label": "0 seconds — Spike Test"},
    {"value": "5",      "label": "5 seconds"},
    {"value": "10",     "label": "10 seconds"},
    {"value": "30",     "label": "30 seconds"},
    {"value": "60",     "label": "60 seconds"},
    {"value": "custom", "label": "Custom..."},
]

DURATION_OPTIONS = [
    {"value": "30",     "label": "30 seconds"},
    {"value": "60",     "label": "60 seconds"},
    {"value": "120",    "label": "120 seconds (2 min)"},
    {"value": "300",    "label": "300 seconds (5 min)"},
    {"value": "600",    "label": "600 seconds (10 min)"},
    {"value": "custom", "label": "Custom..."},
]

HTTP_PATH_OPTIONS = [
    {"value": "/",           "label": "Root (/)"},
    {"value": "/index.html", "label": "Index Page (/index.html)"},
    {"value": "/api/health", "label": "Health Check (/api/health)"},
    {"value": "/api/test",   "label": "API Test (/api/test)"},
    {"value": "custom",      "label": "Custom..."},
]

# ==================== FLASK ====================

FLASK_HOST  = "0.0.0.0"
FLASK_PORT  = 5000
FLASK_DEBUG = False

METRICS_REFRESH_INTERVAL = 5  # detik, interval auto-refresh metrik di dashboard

# ==================== LOGGING ====================

LOG_FILE  = "/opt/web-dashboard/logs/app.log"
LOG_LEVEL = "INFO"
