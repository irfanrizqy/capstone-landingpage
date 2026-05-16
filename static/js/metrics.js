/**
 * metrics.js — Pengambilan dan tampilan metrik server (CPU, RAM, Network)
 *
 * Menampilkan metrik real-time server dari Node Exporter via /api/metrics/current,
 * memperbarui progress bar CPU/RAM, sparkline grafik network, dan badge status footer.
 * Dipanggil secara berkala sesuai REFRESH_INTERVAL yang diinjeksikan dari config.py.
 */

// Riwayat data network untuk sparkline (maks 30 titik)
const metricsHistory = {
    networkIn: [],
    networkOut: [],
    maxPoints: 30
};

// Nilai network sebelumnya untuk menghitung laju (bytes/detik)
let previousMetrics = {
    networkIn: 0,
    networkOut: 0,
    timestamp: Date.now()
};

// Status Node Exporter terakhir — dibaca oleh updateFooterStatus agar tidak
// fetch /api/metrics/current dua kali (satu dari fetchCurrentMetrics, satu dari footer)
let _lastNodeExporterOk = null;

// Instance grafik sparkline network
let networkInChart = null;
let networkOutChart = null;

/**
 * Inisialisasi dua grafik sparkline untuk network IN dan OUT.
 *
 * Keduanya adalah line chart minimalis (tanpa label, tanpa tooltip)
 * yang hanya menampilkan tren laju network dalam 30 titik terakhir.
 * Dipanggil sekali saat DOMContentLoaded.
 */
function initMetricCharts() {
    const netInCtx = document.getElementById('networkInChart').getContext('2d');
    networkInChart = new Chart(netInCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#0dcaf0',
                backgroundColor: 'rgba(13, 202, 240, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });

    const netOutCtx = document.getElementById('networkOutChart').getContext('2d');
    networkOutChart = new Chart(netOutCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#198754',
                backgroundColor: 'rgba(25, 135, 84, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });
}

/**
 * Perbarui tampilan progress bar CPU, warnanya, dan jumlah core.
 *
 * Warna progress bar:
 * - <50%: hijau (normal)
 * - 50–79%: kuning (waspada)
 * - ≥80%: merah (tinggi)
 *
 * @param {number} usage - Persentase penggunaan CPU (0–100)
 * @param {number} cores - Jumlah core CPU (dari Node Exporter)
 */
function updateCPUMetric(usage, cores) {
    document.getElementById('cpuUsage').textContent = usage.toFixed(1);

    const progress = document.getElementById('cpuProgress');
    progress.style.width = usage + '%';

    if (usage < 50) {
        progress.className = 'progress-bar bg-success';
    } else if (usage < 80) {
        progress.className = 'progress-bar bg-warning';
    } else {
        progress.className = 'progress-bar bg-danger';
    }

    const coresEl = document.getElementById('cpuCores');
    if (coresEl && cores > 0) coresEl.textContent = `${cores} core`;
}

/**
 * Perbarui tampilan progress bar memori dan detail penggunaan (MiB).
 *
 * Warna progress bar:
 * - <50%: biru/info (normal)
 * - 50–79%: kuning (waspada)
 * - ≥80%: merah (tinggi)
 *
 * @param {number} total   - Total memori dalam bytes
 * @param {number} used    - Memori terpakai dalam bytes
 * @param {number} percent - Persentase penggunaan memori (0–100)
 */
function updateMemoryMetric(total, used, percent) {
    document.getElementById('memoryUsage').textContent = percent.toFixed(1);

    const totalMiB = (total / 1024 / 1024).toFixed(2);
    const usedMiB  = (used  / 1024 / 1024).toFixed(2);
    document.getElementById('memoryDetails').textContent = `${usedMiB} MiB / ${totalMiB} MiB`;

    const progress = document.getElementById('memoryProgress');
    progress.style.width = percent + '%';

    if (percent < 50) {
        progress.className = 'progress-bar bg-info';
    } else if (percent < 80) {
        progress.className = 'progress-bar bg-warning';
    } else {
        progress.className = 'progress-bar bg-danger';
    }
}

/**
 * Perbarui tampilan laju network IN/OUT dan sparkline grafik.
 *
 * Menghitung laju (KB/s) sebagai delta bytes dibagi selang waktu sejak
 * pengukuran sebelumnya. Nilai negatif (counter reset) di-clamp ke 0.
 * Riwayat dibatasi 30 titik; titik terlama dihapus saat penuh (FIFO).
 *
 * @param {number} receiveBytes  - Total bytes yang diterima (kumulatif dari Node Exporter)
 * @param {number} transmitBytes - Total bytes yang dikirim (kumulatif dari Node Exporter)
 */
function updateNetworkMetrics(receiveBytes, transmitBytes) {
    const now      = Date.now();
    const timeDiff = (now - previousMetrics.timestamp) / 1000; // detik

    let receiveRate  = 0;
    let transmitRate = 0;

    if (previousMetrics.networkIn > 0 && timeDiff > 0) {
        receiveRate  = (receiveBytes  - previousMetrics.networkIn)  / timeDiff / 1024; // KB/s
        transmitRate = (transmitBytes - previousMetrics.networkOut) / timeDiff / 1024; // KB/s
    }

    document.getElementById('networkIn').textContent  = Math.max(0, receiveRate).toFixed(1);
    document.getElementById('networkOut').textContent = Math.max(0, transmitRate).toFixed(1);

    metricsHistory.networkIn.push(Math.max(0, receiveRate));
    metricsHistory.networkOut.push(Math.max(0, transmitRate));

    if (metricsHistory.networkIn.length > metricsHistory.maxPoints) {
        metricsHistory.networkIn.shift();
        metricsHistory.networkOut.shift();
    }

    if (networkInChart) {
        networkInChart.data.labels = Array(metricsHistory.networkIn.length).fill('');
        networkInChart.data.datasets[0].data = metricsHistory.networkIn;
        networkInChart.update('none');
    }

    if (networkOutChart) {
        networkOutChart.data.labels = Array(metricsHistory.networkOut.length).fill('');
        networkOutChart.data.datasets[0].data = metricsHistory.networkOut;
        networkOutChart.update('none');
    }

    previousMetrics.networkIn  = receiveBytes;
    previousMetrics.networkOut = transmitBytes;
    previousMetrics.timestamp  = now;
}

/**
 * Ambil metrik terkini dari API dan perbarui semua tampilan.
 *
 * Memanggil /api/metrics/current yang membaca data dari Node Exporter.
 * Jika berhasil, memperbarui CPU, RAM, network, dan timestamp terakhir diperbarui.
 * Error dicatat ke console tanpa mengganggu tampilan (graceful degradation).
 */
function _updateNodeExporterBadge() {
    const badge = document.getElementById('footerNodeExporter');
    if (!badge) return;
    if (_lastNodeExporterOk === true) {
        badge.textContent = 'Node Exporter: Online';
        badge.className   = 'badge bg-success';
    } else if (_lastNodeExporterOk === false) {
        badge.textContent = 'Node Exporter: Offline';
        badge.className   = 'badge bg-danger';
    }
}

async function fetchCurrentMetrics() {
    try {
        const response = await fetch('/api/metrics/current');
        const data     = await response.json();

        if (data.status === 'success') {
            const metrics = data.metrics;
            updateCPUMetric(metrics.cpu_usage, metrics.cpu_cores || 0);
            updateMemoryMetric(metrics.memory_total, metrics.memory_used, metrics.memory_usage_percent);
            updateNetworkMetrics(metrics.network_receive_bytes, metrics.network_transmit_bytes);

            const now = new Date();
            document.getElementById('lastUpdated').textContent = now.toLocaleTimeString();
            _lastNodeExporterOk = true;
        } else {
            console.error('Failed to fetch metrics:', data.message);
            _lastNodeExporterOk = false;
        }
    } catch (error) {
        console.error('Error fetching metrics:', error);
        _lastNodeExporterOk = false;
    }
    _updateNodeExporterBadge();
}

/**
 * Perbarui badge status JMeter API dan Node Exporter di footer.
 *
 * Mengecek keterjangkauan JMeter API via /api/jmeter/ping
 * dan status Node Exporter via /api/metrics/current.
 * Badge berubah hijau (Online) atau merah (Offline/Error) sesuai hasil.
 *
 * Dipanggil saat load dan setiap 10 detik oleh setInterval.
 */
async function updateFooterStatus() {
    try {
        const jmeterResponse = await fetch('/api/jmeter/ping');
        const jmeterData     = await jmeterResponse.json();

        const jmeterBadge = document.getElementById('footerJMeter');
        if (jmeterData.reachable) {
            jmeterBadge.textContent = 'JMeter API: Online';
            jmeterBadge.className   = 'badge bg-success';
        } else {
            jmeterBadge.textContent = 'JMeter API: Offline';
            jmeterBadge.className   = 'badge bg-danger';
        }
    } catch (error) {
        const jmeterBadge = document.getElementById('footerJMeter');
        jmeterBadge.textContent = 'JMeter API: Error';
        jmeterBadge.className   = 'badge bg-danger';
    }

    // Gunakan status terakhir dari fetchCurrentMetrics() — tidak perlu fetch ulang
    _updateNodeExporterBadge();
}

// Inisialisasi saat halaman siap
document.addEventListener('DOMContentLoaded', () => {
    initMetricCharts();
    fetchCurrentMetrics();
    updateFooterStatus();

    setInterval(fetchCurrentMetrics, REFRESH_INTERVAL);
    setInterval(updateFooterStatus, 10000);
});
