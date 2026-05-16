"""
routes/csv.py — Route unduh hasil test dalam format CSV

Endpoint:
  GET /api/test/results/<test_id>/summary/csv         → CSV ringkasan test (single)
  GET /api/test/results/<test_id>/requests/csv        → CSV per-request single test
  GET /api/test/results/summary/csv/multi?ids=...     → CSV ringkasan multi-fase (merged, simpan ke disk)
  GET /api/test/results/requests/csv/multi?ids=...    → CSV per-request multi-fase (merged, simpan ke disk)
  POST /api/test/results/<test_id>/requests/csv/generate → trigger generate
  GET  /api/test/results/<test_id>/requests/csv/status   → cek status generate
"""

import logging

import requests as http
from requests.adapters import HTTPAdapter
from flask import Blueprint, Response, jsonify, request

import config

logger = logging.getLogger(__name__)
csv_bp = Blueprint('csv', __name__)

_jmeter = http.Session()
_jmeter.mount('http://', HTTPAdapter(pool_connections=2, pool_maxsize=4))

_LARGE_FILE_MB = 100  # batas ukuran file yang bisa diunduh via browser


def _proxy_csv(test_id, filename_suffix):
    """Ambil summary CSV dari JMeter API dan kirim ke browser (file kecil, aman di-proxy)."""
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/csv",
            timeout=15
        )
        if resp.status_code != 200:
            return jsonify({'status': 'error', 'message': f'JMeter API status {resp.status_code}'}), resp.status_code

        raw       = resp.text.lstrip('﻿')
        lines     = [l for l in raw.splitlines() if l and not l.startswith('sep=')]
        csv_clean = 'sep=;\n' + '\n'.join(lines)

        return Response(
            '﻿' + csv_clean,
            mimetype='text/csv; charset=utf-8-sig',
            headers={'Content-Disposition': f'attachment; filename={test_id}_{filename_suffix}.csv'}
        )
    except http.exceptions.RequestException as e:
        logger.error(f"Error getting CSV ({filename_suffix}): {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


def _stream_from_jmeter(jmeter_url, download_name):
    """
    Unduh CSV dari JMeter API ke buffer, lalu kirim ke browser sekaligus.
    Buffering (bukan streaming langsung) penting: jika koneksi ke JMeter putus di tengah jalan
    saat streaming, Flask sudah terlanjur mengirim header 200 OK ke browser sehingga tidak bisa
    mengirim kode error — browser hanya melihat koneksi putus dan melempar "Failed to fetch".
    Dengan buffering, kegagalan JMeter tertangkap sebelum header dikirim ke browser,
    sehingga Flask bisa mengembalikan JSON error yang bermakna.
    File sudah dibatasi <100 MB oleh frontend sebelum endpoint ini dipanggil.
    """
    try:
        resp = _jmeter.get(jmeter_url, timeout=(10, 120))
        if resp.status_code != 200:
            return jsonify({'status': 'error', 'message': f'JMeter API status {resp.status_code}'}), resp.status_code

        data = resp.content
        return Response(
            data,
            mimetype='text/csv; charset=utf-8-sig',
            headers={
                'Content-Disposition': f'attachment; filename={download_name}',
                'Content-Length': str(len(data)),
            }
        )
    except http.exceptions.RequestException as e:
        logger.error(f"Proxy error ({download_name}): {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ==================== ENDPOINTS ====================

@csv_bp.route('/api/test/results/<test_id>/summary/csv', methods=['GET'])
def get_test_results_summary_csv(test_id):
    """Unduh CSV ringkasan test."""
    return _proxy_csv(test_id, 'summary')


@csv_bp.route('/api/test/results/<test_id>/requests/csv', methods=['GET'])
def get_test_results_requests_csv(test_id):
    """Unduh CSV per-request single test via proxy ke JMeter API."""
    return _stream_from_jmeter(
        jmeter_url=f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/requests-csv/download",
        download_name=f'{test_id}_requests.csv'
    )


@csv_bp.route('/api/test/results/summary/csv/multi', methods=['GET'])
def get_multi_summary_csv():
    """
    Unduh CSV ringkasan multi-fase (satu baris per fase, semua fase dalam 1 file).
    JMeter API menulis file ke disk di merged_results/ lalu serve dengan send_file().
    File tetap tersimpan di server JMeter setelah diunduh.
    """
    ids_param = request.args.get('ids', '')
    test_ids  = [t.strip() for t in ids_param.split(',') if t.strip()]
    if not test_ids:
        return jsonify({'status': 'error', 'message': 'Parameter ids wajib diisi'}), 400

    return _stream_from_jmeter(
        jmeter_url=f"{config.JMETER_API_URL}/api/load-test/results/summary-csv/merge?ids={ids_param}",
        download_name=f'multiphase_{len(test_ids)}phases_summary.csv'
    )


@csv_bp.route('/api/test/results/requests/csv/multi', methods=['GET'])
def get_multi_requests_csv():
    """
    Unduh CSV per-request multi-fase (semua request dari semua fase dalam 1 file).
    JMeter API menulis file ke disk di merged_results/ lalu serve dengan send_file().
    File tetap tersimpan di server JMeter setelah diunduh.
    """
    ids_param = request.args.get('ids', '')
    test_ids  = [t.strip() for t in ids_param.split(',') if t.strip()]
    if not test_ids:
        return jsonify({'status': 'error', 'message': 'Parameter ids wajib diisi'}), 400

    return _stream_from_jmeter(
        jmeter_url=f"{config.JMETER_API_URL}/api/load-test/results/requests-csv/merge?ids={ids_param}",
        download_name=f'multiphase_{len(test_ids)}phases_requests.csv'
    )


@csv_bp.route('/api/test/results/summary/csv/merge-prepare', methods=['GET'])
def prepare_multi_summary_csv():
    """
    Minta server JMeter gabungkan summary fase ke merged_results/ dan
    kembalikan metadata (filename, path, size_mb) sebagai JSON.
    """
    ids_param = request.args.get('ids', '')
    if not ids_param.strip():
        return jsonify({'status': 'error', 'message': 'Parameter ids wajib diisi'}), 400
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/summary-csv/merge-prepare?ids={ids_param}",
            timeout=(10, 300)
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Proxy error (summary merge-prepare): {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@csv_bp.route('/api/test/results/requests/csv/merge-prepare', methods=['GET'])
def prepare_multi_requests_csv():
    """
    Minta server JMeter gabungkan semua requests.csv fase ke merged_results/ dan
    kembalikan metadata (filename, path, size_mb) sebagai JSON — tanpa langsung
    mengunduh file. Frontend pakai ini untuk menampilkan path di dialog file besar.
    """
    ids_param = request.args.get('ids', '')
    if not ids_param.strip():
        return jsonify({'status': 'error', 'message': 'Parameter ids wajib diisi'}), 400
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/requests-csv/merge-prepare?ids={ids_param}",
            timeout=(10, 300)
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Proxy error (merge-prepare): {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@csv_bp.route('/api/test/results/merged/<filename>', methods=['GET'])
def serve_merged_file_proxy(filename):
    """Unduh file CSV dari merged_results/ di server JMeter berdasarkan nama file."""
    return _stream_from_jmeter(
        jmeter_url=f"{config.JMETER_API_URL}/api/load-test/results/merged/{filename}",
        download_name=filename
    )


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
    """Cek status on-demand CSV generation (termasuk size_mb dan file_path)."""
    try:
        resp = _jmeter.get(
            f"{config.JMETER_API_URL}/api/load-test/results/{test_id}/requests-csv/status",
            timeout=10
        )
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
