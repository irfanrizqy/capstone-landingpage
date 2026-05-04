"""
helpers/metrics_parser.py — Parser metrik Node Exporter

Modul ini mengubah teks mentah dari Node Exporter (format Prometheus)
menjadi dict terstruktur yang berisi CPU, memori, dan jaringan.

Digunakan oleh: routes/metrics.py
"""

import logging
import re
from datetime import datetime

logger = logging.getLogger(__name__)


def parse_node_exporter_metrics(metrics_text):
    """
    Parse teks output Node Exporter menjadi dict metrik server.

    Membaca baris-baris format Prometheus dan mengekstrak:
    - cpu_usage         : persentase CPU terpakai (0-100)
    - memory_total      : total RAM dalam bytes
    - memory_used       : RAM terpakai dalam bytes
    - memory_usage_percent : persentase RAM terpakai
    - network_receive_bytes  : total bytes diterima semua interface
    - network_transmit_bytes : total bytes dikirim semua interface

    Args:
        metrics_text (str): Isi respons HTTP dari endpoint /metrics Node Exporter.

    Returns:
        dict: Metrik server yang sudah dihitung, semua nilai 0 jika parsing gagal.
    """
    metrics = {
        'cpu_usage': 0,
        'cpu_cores': 0,
        'memory_total': 0,
        'memory_used': 0,
        'memory_usage_percent': 0,
        'network_receive_bytes': 0,
        'network_transmit_bytes': 0,
        'timestamp': datetime.now().isoformat()
    }

    try:
        lines = metrics_text.split('\n')
        cpu_idle = 0
        cpu_total = 0
        cpu_core_ids = set()
        memory_total = 0
        memory_available = 0

        for line in lines:
            if line.startswith('#') or not line.strip():
                continue

            # Akumulasi CPU idle dan total untuk hitung persentase pemakaian
            if line.startswith('node_cpu_seconds_total{') and 'mode="idle"' in line:
                parts = line.split()
                if len(parts) >= 2:
                    cpu_idle += float(parts[1])

            if line.startswith('node_cpu_seconds_total{'):
                parts = line.split()
                if len(parts) >= 2:
                    cpu_total += float(parts[1])
                m = re.search(r'cpu="(\d+)"', line)
                if m:
                    cpu_core_ids.add(m.group(1))

            if line.startswith('node_memory_MemTotal_bytes'):
                parts = line.split()
                if len(parts) >= 2:
                    memory_total = float(parts[1])

            if line.startswith('node_memory_MemAvailable_bytes'):
                parts = line.split()
                if len(parts) >= 2:
                    memory_available = float(parts[1])

            # Jumlahkan semua interface jaringan
            if line.startswith('node_network_receive_bytes_total{'):
                parts = line.split()
                if len(parts) >= 2:
                    metrics['network_receive_bytes'] += float(parts[1])

            if line.startswith('node_network_transmit_bytes_total{'):
                parts = line.split()
                if len(parts) >= 2:
                    metrics['network_transmit_bytes'] += float(parts[1])

        # CPU usage = 100% dikurangi persentase idle
        if cpu_total > 0:
            metrics['cpu_usage'] = round(100 - ((cpu_idle / cpu_total) * 100), 2)
        metrics['cpu_cores'] = len(cpu_core_ids)

        if memory_total > 0:
            memory_used = memory_total - memory_available
            metrics['memory_total'] = int(memory_total)
            metrics['memory_used'] = int(memory_used)
            metrics['memory_usage_percent'] = round((memory_used / memory_total) * 100, 2)

    except Exception as e:
        logger.error(f"Error parsing metrics: {e}")

    return metrics
