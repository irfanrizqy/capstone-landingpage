"""
routes/test.py — Route kontrol load test, konektivitas, dan antrian test

Semua endpoint di sini bersifat proxy: meneruskan request dari browser
ke JMeter API Server (di VM terpisah) dan mengembalikan responnya.

Endpoint:
  POST /api/test/ping                    → Ping ke target URL (cek server tujuan test)
  GET  /api/jmeter/ping                  → Cek apakah JMeter API bisa dijangkau
  POST /api/test/start                   → Mulai load test (atau antri jika JMeter sibuk)
  GET  /api/test/queue/status/<queue_id> → Cek posisi antrian / status test yang sudah dimulai
  GET  /api/test/status/<test_id>        → Cek status test yang sedang/sudah berjalan
  GET  /api/test/results/<test_id>       → Ambil hasil test (JSON)
  GET  /api/test/results/<id>/csv        → Unduh hasil test (CSV) — alias backward-compat
  POST /api/test/stop/<test_id>          → Hentikan test yang sedang berjalan
  GET  /api/test/list                    → Daftar semua test di memori JMeter API
"""

import logging
import subprocess
import threading
import time
import uuid

import requests as http
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask import Blueprint, jsonify, request

import config
from routes.csv import _proxy_csv

logger  = logging.getLogger(__name__)
test_bp = Blueprint('test', __name__)

# Session dengan connection pool ke JMeter API — hemat TCP handshake per-request.
# Retry=0: gagal langsung dikembalikan ke browser, jangan retry otomatis.
_jmeter = http.Session()
_jmeter.mount('http://', HTTPAdapter(
    pool_connections=2, pool_maxsize=4,
    max_retries=Retry(total=0)
))

# ==================== ANTRIAN LOAD TEST ====================
# Antrian sederhana in-memory per-VM. Berguna saat banyak pengguna mengakses
# dashboard yang sama dan JMeter sedang sibuk menjalankan test lain.

_queue_lock    = threading.Lock()
_pending       = []   # list of {queue_id, params, added_at}
_queue_results = {}   # queue_id → {status, test_id?, message?}


def _jmeter_running_tests():
    """Kembalikan jumlah test yang sedang berjalan di JMeter API, atau None jika gagal."""
    try:
        r = _jmeter.get(f"{config.JMETER_API_URL}/api/health", timeout=3)
        return r.json().get('running_tests', 0) if r.ok else None
    except Exception:
        return None


def _queue_worker():
    """Thread latar belakang: mulai test berikutnya dari antrian saat JMeter bebas."""
    while True:
        time.sleep(3)
        with _queue_lock:
            # Bersihkan entri yang sudah kadaluarsa
            now = time.time()
            _pending[:] = [
                item for item in _pending
                if now - item['added_at'] < config.QUEUE_TTL_S
            ]
            if not _pending:
                continue
            next_item = _pending[0]

        running = _jmeter_running_tests()
        if running is None or running >= config.MAX_CONCURRENT_TESTS:
            continue  # Slot penuh atau JMeter tidak bisa dicek, coba lagi nanti

        with _queue_lock:
            if not _pending or _pending[0]['queue_id'] != next_item['queue_id']:
                continue   # Ada perubahan antrian sejak kita cek di atas
            item = _pending.pop(0)

        try:
            resp = _jmeter.post(
                f"{config.JMETER_API_URL}/api/load-test/start",
                json=item['params'], timeout=30
            )
            data = resp.json()
            if data.get('status') == 'success':
                with _queue_lock:
                    _queue_results[item['queue_id']] = {
                        'status':  'started',
                        'test_id': data['test_id']
                    }
            else:
                with _queue_lock:
                    _queue_results[item['queue_id']] = {
                        'status':  'error',
                        'message': data.get('message', 'Gagal memulai test dari antrian')
                    }
        except Exception as e:
            with _queue_lock:
                _queue_results[item['queue_id']] = {
                    'status': 'error', 'message': str(e)
                }
        logger.info(f"Queue worker: processed {item['queue_id']}, result: {_queue_results.get(item['queue_id'], {}).get('status')}")


# Mulai worker thread saat modul pertama kali di-import
_worker = threading.Thread(target=_queue_worker, daemon=True)
_worker.start()


@test_bp.route('/api/test/ping', methods=['POST'])
def ping_target():
    """
    Ping ke host target untuk memverifikasi konektivitas sebelum test dimulai.

    Menjalankan ping 3 paket dari server ini ke host target.
    Dipakai di dashboard sebagai "Step 2/2: Cek target server" sebelum start test.

    Body JSON: { "target_url": "http://..." }
    """
    try:
        data = request.get_json()
        if not data or 'target_url' not in data:
            return jsonify({'status': 'error', 'message': 'target_url is required'}), 400

        import urllib.parse
        parsed = urllib.parse.urlparse(data['target_url'])
        host   = (parsed.hostname or parsed.path.split('/')[0]) \
                 .replace('http://', '').replace('https://', '')

        result = subprocess.run(
            ['ping', '-c', '3', '-W', '2', host],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            packet_loss = '0%'
            stats_line  = ''
            for line in result.stdout.split('\n'):
                if 'packet loss' in line:
                    for part in line.split(','):
                        if 'packet loss' in part:
                            packet_loss = part.strip().split()[0]
                if 'min/avg/max' in line or 'rtt' in line:
                    stats_line = line
            return jsonify({
                'status': 'success', 'reachable': True, 'host': host,
                'packet_loss': packet_loss, 'details': stats_line,
                'message': f'Host {host} is reachable'
            }), 200
        return jsonify({
            'status': 'success', 'reachable': False, 'host': host,
            'message': f'Host {host} is not reachable', 'error': result.stderr
        }), 200

    except subprocess.TimeoutExpired:
        return jsonify({'status': 'success', 'reachable': False,
                        'message': 'Ping timeout'}), 200
    except Exception as e:
        logger.error(f"Error in ping test: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@test_bp.route('/api/jmeter/ping', methods=['GET'])
def ping_jmeter():
    """
    Cek apakah JMeter API Server dapat dijangkau dari server ini.

    Dipakai di dashboard sebagai "Step 1/2: Cek JMeter API" sebelum start test.
    Mengakses endpoint /api/health milik JMeter API dan meneruskan statusnya.
    """
    try:
        resp = _jmeter.get(f"{config.JMETER_API_URL}/api/health", timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            return jsonify({
                'status': 'success', 'reachable': True,
                'jmeter_url': config.JMETER_API_URL,
                'message': 'JMeter API is reachable',
                'jmeter_status': data.get('status', 'unknown'),
                'running_tests': data.get('running_tests', 0)
            }), 200
        return jsonify({
            'status': 'success', 'reachable': False,
            'jmeter_url': config.JMETER_API_URL,
            'message': f'JMeter API returned status {resp.status_code}'
        }), 200
    except http.exceptions.Timeout:
        return jsonify({'status': 'success', 'reachable': False,
                        'jmeter_url': config.JMETER_API_URL,
                        'message': 'JMeter API timeout (>3s)'}), 200
    except http.exceptions.ConnectionError:
        return jsonify({'status': 'success', 'reachable': False,
                        'jmeter_url': config.JMETER_API_URL,
                        'message': 'Cannot connect to JMeter API'}), 200
    except Exception as e:
        logger.error(f"Error pinging JMeter API: {e}")
        return jsonify({'status': 'error', 'reachable': False,
                        'jmeter_url': config.JMETER_API_URL,
                        'message': str(e)}), 500


@test_bp.route('/api/test/start', methods=['POST'])
def start_load_test():
    """
    Mulai load test baru. Jika JMeter sedang sibuk, masukkan ke antrian.

    Body JSON: { target_url, num_threads, ramp_time, duration, http_path }
    Response:
      - Langsung mulai: { status:'success', test_id }
      - Antrian:        { status:'queued', queue_id, position, message }
    """
    data = request.get_json()
    if not data:
        return jsonify({'status': 'error', 'message': 'Request body must be JSON'}), 400

    # Cabut _admin_key dari payload sebelum diteruskan ke JMeter
    is_admin = data.pop('_admin_key', None) == config.ADMIN_PASSWORD

    running = _jmeter_running_tests()

    # Admin selalu bypass antrian; user biasa hanya langsung jika slot masih tersedia
    if is_admin or running is None or running < config.MAX_CONCURRENT_TESTS:
        try:
            resp = _jmeter.post(f"{config.JMETER_API_URL}/api/load-test/start",
                                json=data, timeout=30)
            return jsonify(resp.json()), resp.status_code
        except http.exceptions.RequestException as e:
            logger.error(f"Error starting load test: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # Semua slot penuh (running >= MAX_CONCURRENT_TESTS) → masuk antrian
    qid = str(uuid.uuid4())[:8]
    with _queue_lock:
        _pending.append({'queue_id': qid, 'params': data, 'added_at': time.time()})
        position = len(_pending)
        _queue_results[qid] = {'status': 'queued'}

    logger.info(f"Test queued: {qid} at position {position}")
    return jsonify({
        'status':   'queued',
        'queue_id': qid,
        'position': position,
        'message':  f'JMeter sedang sibuk. Test masuk antrian posisi {position}.'
    }), 202


@test_bp.route('/api/test/queue/status/<queue_id>', methods=['GET'])
def get_queue_status(queue_id):
    """
    Cek status antrian untuk queue_id tertentu.

    Response:
      - Masih menunggu: { status:'queued', position }
      - Sudah dimulai:  { status:'started', test_id }
      - Gagal:          { status:'error', message }
    """
    with _queue_lock:
        result = _queue_results.get(queue_id)

        # Jika sudah selesai diproses (started/error)
        if result and result['status'] != 'queued':
            return jsonify(result), 200

        # Cari posisi dalam antrian
        pos = next(
            (i + 1 for i, item in enumerate(_pending) if item['queue_id'] == queue_id),
            None
        )
        if pos is not None:
            return jsonify({'status': 'queued', 'position': pos}), 200

        # Tidak ada di pending tapi result masih 'queued' → baru saja dipop oleh worker
        if result:
            return jsonify({'status': 'queued', 'position': 1}), 200

    return jsonify({'status': 'error',
                    'message': 'Queue ID tidak ditemukan atau sudah kadaluarsa'}), 404


@test_bp.route('/api/test/status/<test_id>', methods=['GET'])
def get_test_status(test_id):
    """
    Ambil status test yang sedang berjalan atau sudah selesai.

    Digunakan oleh dashboard untuk polling setiap 2 detik.
    Respons berisi: status, progress (%), elapsed_time.
    """
    try:
        resp = _jmeter.get(f"{config.JMETER_API_URL}/api/load-test/status/{test_id}",
                           timeout=5)
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error getting test status: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@test_bp.route('/api/test/results/<test_id>', methods=['GET'])
def get_test_results(test_id):
    """
    Ambil hasil lengkap test dalam format JSON setelah test selesai.

    Respons berisi summary statistik (avg RT, throughput, error rate, dll.)
    dan data timeline per-detik untuk ditampilkan di grafik dashboard.
    """
    try:
        resp = _jmeter.get(f"{config.JMETER_API_URL}/api/load-test/results/{test_id}",
                           timeout=15)
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error getting test results: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@test_bp.route('/api/test/results/<test_id>/csv', methods=['GET'])
def get_test_results_csv(test_id):
    """Alias backward-compatible untuk unduh CSV summary (sama dengan /summary/csv)."""
    return _proxy_csv(test_id, 'summary')


@test_bp.route('/api/test/stop/<test_id>', methods=['POST'])
def stop_load_test(test_id):
    """Hentikan paksa test yang sedang berjalan di JMeter."""
    try:
        resp = _jmeter.post(f"{config.JMETER_API_URL}/api/load-test/stop/{test_id}",
                            timeout=10)
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error stopping test: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@test_bp.route('/api/test/list', methods=['GET'])
def list_load_tests():
    """Ambil daftar semua test yang tersimpan di memori JMeter API."""
    try:
        resp = _jmeter.get(f"{config.JMETER_API_URL}/api/load-test/list", timeout=5)
        return jsonify(resp.json()), resp.status_code
    except http.exceptions.RequestException as e:
        logger.error(f"Error listing tests: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
