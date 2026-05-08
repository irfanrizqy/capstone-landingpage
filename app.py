#!/usr/bin/env python3
"""
app.py — Entry point aplikasi Web Testing Dashboard (4.0)

File ini hanya bertugas:
  1. Mengkonfigurasi logging
  2. Membuat instance Flask
  3. Mendaftarkan semua Blueprint (routes)
  4. Menjalankan server

Semua logika endpoint ada di folder routes/ dan helpers/.
"""

import os
import time
import logging

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

import config
from routes.pages   import pages_bp
from routes.metrics import metrics_bp
from routes.test    import test_bp
from routes.csv     import csv_bp
from routes.disk    import disk_bp

# ==================== LOGGING ====================
# Buat direktori log terlebih dahulu agar FileHandler tidak gagal
# saat direktori belum ada (menyebabkan exit-code 209/STDOUT di systemd)
os.makedirs(os.path.dirname(config.LOG_FILE), exist_ok=True)

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(config.LOG_FILE),
        logging.StreamHandler(),
    ]
)

# ==================== APP ====================

# Nama server ini, dibaca dari environment variable (di-set saat deploy tiap VM)
BACKEND_SERVER_NAME = os.getenv("BACKEND_SERVER_NAME", config.SERVER_NAME)

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # disable JS/CSS caching — always serve fresh
app.jinja_env.globals['app_version'] = int(time.time())  # cache-bust JS/CSS setiap restart
# Agar IP asli client terbaca saat di belakang reverse proxy (Envoy/Nginx)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Daftarkan semua blueprint
app.register_blueprint(pages_bp)   # Halaman HTML (/, /dashboard)
app.register_blueprint(metrics_bp) # Metrik server (/api/metrics/*, /api/health)
app.register_blueprint(test_bp)    # Kontrol load test (/api/test/*)
app.register_blueprint(csv_bp)     # Download CSV (/api/test/results/*/csv)
app.register_blueprint(disk_bp)    # Manajemen disk JMeter (/api/jmeter/*)


@app.after_request
def add_backend_header(response):
    """Tambahkan header X-Backend-Server ke setiap response untuk identifikasi VM."""
    response.headers["X-Backend-Server"] = BACKEND_SERVER_NAME
    return response


# ==================== MAIN ====================

if __name__ == '__main__':
    app.run(host=config.FLASK_HOST, port=config.FLASK_PORT, debug=config.FLASK_DEBUG)
