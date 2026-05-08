"""
routes/csv.py — Route unduh hasil test dalam format CSV

Mengambil hasil test dari JMeter API, membersihkan formatnya,
lalu mengirimkannya ke browser sebagai file CSV siap buka di Excel.

Perlakuan khusus:
  - BOM (Byte Order Mark) ditambahkan agar Excel Indonesia langsung
    mengenali encoding UTF-8
  - Delimiter diganti dari koma (,) ke titik koma (;) sesuai
    setting regional Excel Indonesia
  - Header "sep=;" ditambahkan agar Excel otomatis memisahkan kolom

Endpoint:
  GET /api/test/results/<test_id>/summary/csv  → CSV ringkasan test
  GET /api/test/results/<test_id>/requests/csv → CSV per-request (sama sumbernya,
                                                  nama file dibedakan)
"""

import logging

import requests as http
from requests.adapters import HTTPAdapter
from flask import Blueprint, Response, jsonify

import config

logger = logging.getLogger(__name__)
csv_bp = Blueprint('csv', __name__)

_jmeter = http.Session()
_jmeter.mount('http://', HTTPAdapter(pool_connections=1, pool_maxsize=2))


def _proxy_csv(test_id, filename_suffix):
    """
    Ambil CSV dari JMeter API, bersihkan, dan kirim ke browser.

    Fungsi internal yang dipakai oleh kedua endpoint CSV dan alias
    di routes/test.py. Semua transformasi format ada di sini.

    Args:
        test_id (str): ID test yang ingin diunduh.
        filename_suffix (str): Suffix nama file ('summary' atau 'requests').

    Returns:
        Flask Response: File CSV dengan header Content-Disposition untuk download.
    """
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/csv",
            timeout=15
        )
        if resp.status_code != 200:
            return jsonify({
                'status':  'error',
                'message': f'JMeter API status {resp.status_code}'
            }), resp.status_code

        # Hapus BOM yang mungkin sudah ada, ganti delimiter, tambah sep= untuk Excel
        raw       = resp.text.lstrip('﻿')
        lines     = [l.replace(',', ';') for l in raw.splitlines()
                     if l and not l.startswith('sep=')]
        csv_clean = 'sep=;\n' + '\n'.join(lines)

        return Response(
            '﻿' + csv_clean,
            mimetype='text/csv; charset=utf-8-sig',
            headers={
                'Content-Disposition': f'attachment; filename={test_id}_{filename_suffix}.csv'
            }
        )
    except http.exceptions.RequestException as e:
        logger.error(f"Error getting CSV ({filename_suffix}): {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@csv_bp.route('/api/test/results/<test_id>/summary/csv', methods=['GET'])
def get_test_results_summary_csv(test_id):
    """Unduh hasil test sebagai CSV ringkasan (satu baris per detik timeline)."""
    return _proxy_csv(test_id, 'summary')


@csv_bp.route('/api/test/results/<test_id>/requests/csv', methods=['GET'])
def get_test_results_requests_csv(test_id):
    """Unduh request-level CSV yang sudah di-generate on-demand."""
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/requests-csv/download",
            timeout=60
        )
        if resp.status_code != 200:
            return jsonify({'status': 'error', 'message': f'JMeter API status {resp.status_code}'}), resp.status_code

        raw       = resp.text.lstrip('﻿')
        lines     = [l.replace(',', ';') for l in raw.splitlines()
                     if l and not l.startswith('sep=')]
        csv_clean = 'sep=;\n' + '\n'.join(lines)

        return Response(
            '﻿' + csv_clean,
            mimetype='text/csv; charset=utf-8-sig',
            headers={'Content-Disposition': f'attachment; filename={test_id}_requests.csv'}
        )
    except http.exceptions.RequestException as e:
        logger.error(f"Error downloading requests CSV: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@csv_bp.route('/api/test/results/<test_id>/requests/csv/generate', methods=['POST'])
def generate_requests_csv_proxy(test_id):
    """Trigger on-demand CSV generation di JMeter API."""
    try:
        resp = _jmeter.post(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/requests-csv/generate",
            timeout=10
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@csv_bp.route('/api/test/results/<test_id>/requests/csv/status', methods=['GET'])
def requests_csv_status_proxy(test_id):
    """Cek status on-demand CSV generation."""
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/requests-csv/status",
            timeout=10
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
