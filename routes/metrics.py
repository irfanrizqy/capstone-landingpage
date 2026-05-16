"""
routes/metrics.py — Route metrik dan health check server

Endpoint:
  GET /api/server-info      → Identitas server ini (nama, IP, hostname)
  GET /api/metrics/current  → Metrik real-time server ini dari Node Exporter
  GET /api/metrics/all      → Metrik ketiga backend VM sekaligus
  GET /api/health           → Status kesehatan layanan (Node Exporter + JMeter API)

Semua data metrik diambil langsung dari Node Exporter (port 9100)
dan diparse oleh helpers/metrics_parser.py.
"""

import re
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests as http
from requests.adapters import HTTPAdapter
from flask import Blueprint, jsonify

import config
from helpers.metrics_parser import parse_node_exporter_metrics

logger     = logging.getLogger(__name__)
metrics_bp = Blueprint('metrics', __name__)

# Pool diperbesar ke 3 koneksi agar bisa fetch 3 server secara paralel
_node = http.Session()
_node.mount('http://', HTTPAdapter(pool_connections=3, pool_maxsize=6))


@metrics_bp.route('/api/server-info', methods=['GET'])
def get_server_info():
    """Kembalikan identitas server ini: nama, IP, hostname, dan timestamp."""
    return jsonify({
        'server_name': config.SERVER_NAME,
        'ip_address':  config.SERVER_IP,
        'hostname':    config.SERVER_HOSTNAME,
        'timestamp':   datetime.now().isoformat()
    })


@metrics_bp.route('/api/metrics/current', methods=['GET'])
def get_current_metrics():
    """
    Ambil metrik real-time server ini dari Node Exporter lokal.

    Mengambil data dari Node Exporter di port 9100 lalu memparsing
    CPU, memori, dan jaringan menggunakan parse_node_exporter_metrics().
    """
    try:
        response = _node.get(f"{config.NODE_EXPORTER_URL}/metrics", timeout=5)
        if response.status_code == 200:
            return jsonify({
                'status':  'success',
                'metrics': parse_node_exporter_metrics(response.text)
            }), 200
        return jsonify({
            'status':  'error',
            'message': f'Node Exporter returned status {response.status_code}'
        }), 500
    except http.exceptions.RequestException as e:
        logger.error(f"Error fetching metrics: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


def _fetch_single_server(server):
    """Ambil metrik satu server — dijalankan di thread pool."""
    server_data = {
        'name':     server['name'],
        'ip':       server['ip'],
        'hostname': server['hostname'],
        'is_self':  server.get('is_self', False),
        'status':   'unknown',
        'metrics':  {}
    }
    try:
        url = f"{config.NODE_EXPORTER_URL}/metrics" if server.get('is_self') \
              else f"http://{server['ip']}:9100/metrics"
        response = _node.get(url, timeout=3)

        if response.status_code == 200:
            text = response.text

            cpu_idle = sum(float(x) for x in re.findall(
                r'node_cpu_seconds_total{.*?mode="idle".*?}\s+([\d.]+)', text))
            cpu_all = sum(float(x) for x in re.findall(
                r'node_cpu_seconds_total{.*?}\s+([\d.]+)', text))
            if cpu_all > 0:
                server_data['metrics']['cpu_usage'] = max(
                    0, min(100, round(100 - (cpu_idle / cpu_all * 100), 1)))

            m_total = re.search(r'node_memory_MemTotal_bytes\s+([\d.]+)', text)
            m_avail = re.search(r'node_memory_MemAvailable_bytes\s+([\d.]+)', text)
            if m_total and m_avail:
                total = float(m_total.group(1))
                used  = total - float(m_avail.group(1))
                server_data['metrics']['memory_total']   = total
                server_data['metrics']['memory_used']    = used
                server_data['metrics']['memory_percent'] = round(
                    (used / total * 100) if total else 0, 1)

            net_rx, net_tx = 0, 0
            for line in text.split('\n'):
                if line.startswith('node_network_receive_bytes_total{') and 'device="lo"' not in line:
                    parts = line.split()
                    if len(parts) >= 2: net_rx += float(parts[1])
                if line.startswith('node_network_transmit_bytes_total{') and 'device="lo"' not in line:
                    parts = line.split()
                    if len(parts) >= 2: net_tx += float(parts[1])
            server_data['metrics']['network_rx_bytes'] = net_rx
            server_data['metrics']['network_tx_bytes'] = net_tx
            server_data['status'] = 'online'
        else:
            server_data['status'] = 'error'

    except http.exceptions.Timeout:
        server_data['status'] = 'timeout'
    except http.exceptions.ConnectionError:
        server_data['status'] = 'offline'
    except Exception as e:
        logger.error(f"Error fetching metrics from {server['name']}: {e}")
        server_data['status'] = 'error'

    return server_data


@metrics_bp.route('/api/metrics/all', methods=['GET'])
def get_all_metrics():
    """
    Ambil metrik dari semua backend VM secara paralel.

    Semua server di-fetch bersamaan — total waktu tunggu = max(timeout per server) = 3s,
    bukan 3s × N server seperti loop sekuensial.
    """
    with ThreadPoolExecutor(max_workers=len(config.ALL_SERVERS)) as pool:
        all_metrics = list(pool.map(_fetch_single_server, config.ALL_SERVERS))

    return jsonify({
        'status':    'success',
        'servers':   all_metrics,
        'timestamp': datetime.now().isoformat()
    }), 200


@metrics_bp.route('/api/health', methods=['GET'])
def health_check():
    """
    Cek kesehatan dua layanan pendukung: Node Exporter dan JMeter API.

    Digunakan oleh monitoring eksternal untuk memverifikasi
    apakah server ini siap menerima load test.
    """
    node_exporter_ok = False
    jmeter_api_ok    = False
    try:
        node_exporter_ok = _node.get(
            f"{config.NODE_EXPORTER_URL}/metrics", timeout=2).status_code == 200
    except Exception:
        pass
    try:
        jmeter_api_ok = http.get(
            f"{config.JMETER_API_URL}/api/health", timeout=2).status_code == 200
    except Exception:
        pass

    return jsonify({
        'status':      'healthy',
        'timestamp':   datetime.now().isoformat(),
        'server_name': config.SERVER_NAME,
        'server_ip':   config.SERVER_IP,
        'services': {
            'node_exporter': 'ok' if node_exporter_ok else 'error',
            'jmeter_api':    'ok' if jmeter_api_ok    else 'error',
        }
    })
