"""
routes/disk.py — Route manajemen disk JMeter API

Meneruskan request ke JMeter API untuk memantau dan membersihkan
file hasil test yang tersimpan di VM JMeter.

Endpoint:
  GET  /api/jmeter/disk    → Status penggunaan disk VM JMeter
                             (total, terpakai, bebas, jumlah file test)
  POST /api/jmeter/cleanup → Hapus hasil test lama, simpan N test terbaru
                             Body JSON: { "keep": 10 }
"""

import logging

import requests as http
from requests.adapters import HTTPAdapter
from flask import Blueprint, jsonify, request

import config

logger  = logging.getLogger(__name__)
disk_bp = Blueprint('disk', __name__)

_jmeter = http.Session()
_jmeter.mount('http://', HTTPAdapter(pool_connections=1, pool_maxsize=2))


@disk_bp.route('/api/jmeter/disk', methods=['GET'])
def proxy_disk_status():
    """
    Ambil informasi penggunaan disk dari VM JMeter.

    Mengembalikan persentase disk terpakai, ruang bebas (GB),
    dan jumlah serta ukuran file hasil test yang tersimpan.
    Digunakan dashboard untuk menampilkan badge disk dan
    memicu peringatan jika disk hampir penuh (>75%).
    """
    try:
        resp = _jmeter.get(f"{config.JMETER_API_URL}/api/disk/status", timeout=10)
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error getting disk status: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@disk_bp.route('/api/jmeter/cleanup', methods=['POST'])
def proxy_disk_cleanup():
    """
    Hapus hasil test lama di VM JMeter, simpan hanya N test terbaru.

    Hanya bisa diakses oleh Admin (pembatasan dilakukan di sisi frontend).
    Body JSON: { "keep": <jumlah test yang ingin disimpan, default 10> }

    Respons berisi jumlah yang dihapus, MB yang dibebaskan,
    dan status disk setelah cleanup.
    """
    try:
        data = request.get_json(silent=True) or {}
        resp = _jmeter.post(
            f"{config.JMETER_API_URL}/api/disk/cleanup",
            json=data,
            timeout=60
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error during cleanup: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
