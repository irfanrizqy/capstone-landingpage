/**
 * app-state.js — State global dan fungsi utilitas bersama
 *
 * Harus di-load PERTAMA sebelum semua modul app-*.js lainnya.
 * Semua variabel di sini bersifat global (window scope) karena menggunakan
 * plain <script> tags — tidak menggunakan ES Modules.
 */

// ==================== CONSTANTS ====================
// ADMIN_PASSWORD, USER_MAX_THREADS, USER_MAX_DURATION, USER_MAX_PHASES
// diinjeksikan dari config.py via template Jinja2 (lihat dashboard.html)
const POLL_INTERVAL_MS  = 2000;

// ==================== STATE ====================
let isAdminMode         = false;
let configMode          = 'single';

let currentTestId       = null;   // test_id fase yang sedang berjalan
let currentTestParams   = null;   // parameter test terakhir yang dimulai
let testPollingInterval = null;   // ID setInterval untuk polling status test

let phases              = [];
let currentPhaseIndex   = 0;
let isMultiPhaseMode    = false;
let isFetchingResults   = false;  // guard: cegah fetchResults() dipanggil >1x saat interval menumpuk
let allPhaseTestIds     = [];     // test_id semua fase yang sudah selesai
let allPhasesTimeline   = [];     // gabungan data timeline semua fase (untuk grafik)
let completedPhasesMs   = 0;      // total durasi aktual fase yang sudah selesai (detik)
let phaseBoundaryIndices = [];    // indeks di allPhasesTimeline tempat fase baru dimulai
let rampBoundaryIndices  = [];    // indeks di allPhasesTimeline tempat ramp-up tiap fase selesai
let allPhasesSummaries  = [];     // summary statistik tiap fase, digabung di akhir

// Antrian test
let currentQueueId      = null;   // queue_id saat test sedang menunggu antrian

// Progress interpolasi animasi
let progressAnimInterval = null;
let lastProgressData     = { progress: 0, elapsed: 0, timestamp: 0 };

let responseTimeChart   = null;
let successRateChart    = null;

// ==================== UTILITIES ====================

/**
 * Baca nilai integer dari elemen select, atau dari input custom jika "custom" dipilih.
 *
 * Digunakan untuk membaca numThreads, rampTime, duration dari form
 * yang memiliki opsi tetap + opsi custom input.
 *
 * @param {string} selId    - ID elemen <select>
 * @param {string} customId - ID elemen <input> yang muncul saat opsi "custom" dipilih
 * @returns {number|null}   - Nilai integer, atau null jika tidak valid
 */
function readFormInt(selId, customId) {
    const sel = document.getElementById(selId);
    if (!sel) return null;
    const v = sel.value === 'custom'
        ? parseInt(document.getElementById(customId)?.value)
        : parseInt(sel.value);
    return isNaN(v) ? null : v;
}

/**
 * Tunda eksekusi selama `ms` milidetik (non-blocking, berbasis Promise).
 *
 * @param {number} ms - Durasi jeda dalam milidetik
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Perbarui tampilan kotak status di bawah form konfigurasi.
 *
 * Warna background otomatis disesuaikan dengan tipe status:
 * - pending/running → kuning, completed → hijau, failed/error → merah
 *
 * @param {string} type - Tipe status: 'pending'|'running'|'completed'|'failed'|'error'|'stopped'
 * @param {string} msg  - Pesan yang ditampilkan di dalam kotak status
 */
function updateStatus(type, msg) {
    const map = { pending:'alert-info', running:'alert-warning', completed:'alert-success',
                  failed:'alert-danger', error:'alert-danger', stopped:'alert-info' };
    const el = document.getElementById('testStatusSection');
    const tx = document.getElementById('testStatusMessage');
    el.className   = `alert ${map[type] || 'alert-secondary'}`;
    tx.textContent = msg;
}

/**
 * Perbarui badge status di pojok kanan atas section status.
 *
 * @param {string} text  - Teks badge, misal: 'Running', 'Completed', 'Antrian #2'
 * @param {string} color - Warna Bootstrap: 'warning'|'success'|'danger'|'secondary'|'info'
 */
function setBadge(text, color) {
    const el = document.getElementById('testStatusBadge');
    el.textContent = text;
    el.className   = `badge bg-${color}`;
}

/**
 * Tampilkan atau sembunyikan section progress bar.
 *
 * @param {boolean} show - true untuk tampilkan, false untuk sembunyikan
 */
function showProgress(show) {
    document.getElementById('testProgressSection').style.display = show ? 'block' : 'none';
}

// ==================== TEST TYPE DETECTION ====================

/**
 * Tentukan jenis test berdasarkan kombinasi parameter konfigurasi.
 *
 * Urutan prioritas:
 * 1. Smoke Test  — users ≤ 2 (beban minimal, cek server aktif)
 * 2. Spike Test  — ramp-up = 0 + users ≥ 5 (lonjakan tiba-tiba)
 * 3. Soak Test   — durasi ≥ 300s + users ≥ 3 (uji stabilitas jangka panjang)
 * 4. Stress Test — users ≥ 50 (cari batas maksimal server)
 * 5. Load Test   — kondisi normal (default)
 *
 * @param {number} threads  - Jumlah user/thread
 * @param {number} rampTime - Ramp-up time dalam detik
 * @param {number} duration - Durasi test dalam detik
 * @returns {{type, icon, color, bg, desc}}
 */
function detectTestType(threads, rampTime, duration) {
    // 1. Smoke Test — beban sangat kecil, hanya cek server aktif
    if (threads <= 2) return {
        type: 'Smoke Test', icon: '🔍', color: '#0891B2', bg: '#E0F7FA',
        desc: 'Beban minimal — hanya memastikan server merespons dengan benar.'
    };
    // 2. Spike Test — semua user langsung aktif, tidak ada pemanasan
    if (rampTime === 0 && threads >= 5) return {
        type: 'Spike Test', icon: '⚡', color: '#DC2626', bg: '#FEE2E2',
        desc: 'Semua user aktif sekaligus — mensimulasikan lonjakan traffic tiba-tiba.'
    };
    // 3. Stress Test — beban berat (cek sebelum soak, karena 50 user tetap stress meski durasi panjang)
    if (threads >= 50) return {
        type: 'Stress Test', icon: '🔥', color: '#D97706', bg: '#FEF3C7',
        desc: 'Beban berat — mencari batas maksimal kemampuan server.'
    };
    // 4. Soak Test — durasi panjang dengan beban moderat (cari memory leak / degradasi)
    if (duration >= 300) return {
        type: 'Soak Test', icon: '⏳', color: '#7C3AED', bg: '#EDE9FE',
        desc: 'Durasi panjang — menguji stabilitas server dan potensi memory leak.'
    };
    // 5. Load Test — kondisi normal
    return {
        type: 'Load Test', icon: '📊', color: '#059669', bg: '#D1FAE5',
        desc: 'Beban normal — mensimulasikan pola penggunaan nyata.'
    };
}

/**
 * Perbarui ringkasan pembagian waktu di bawah form single test.
 *
 * Menampilkan: [Ramp-up: Xs] + [Beban penuh: Ys] = [Total: Zs]
 * Disembunyikan jika nilai durasi belum valid.
 * Beban penuh = max(0, duration - rampTime).
 */
function updateTimeSummaryHint() {
    const el = document.getElementById('timeSummaryHint');
    if (!el) return;
    const rampTime = readFormInt('rampTime', 'customRamp') ?? 0;
    const duration = readFormInt('duration', 'customDuration');
    if (!duration) { el.style.display = 'none'; return; }

    const fullLoad = Math.max(0, duration - rampTime);
    el.style.display = 'flex';

    if (rampTime > 0) {
        el.innerHTML =
            `<span style="background:#E0F2FE;color:#0369A1;padding:3px 10px;border-radius:20px;font-size:0.8rem;">⏱ Ramp-up: <strong>${rampTime}s</strong></span>` +
            `<span style="color:#9CA3AF;padding:0 2px;">+</span>` +
            `<span style="background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:20px;font-size:0.8rem;">⚡ Beban penuh: <strong>${fullLoad}s</strong></span>` +
            `<span style="color:#9CA3AF;padding:0 2px;">=</span>` +
            `<span style="background:#F3F4F6;color:#374151;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">📋 Total: <strong>${duration}s</strong></span>`;
    } else {
        el.innerHTML =
            `<span style="background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:20px;font-size:0.8rem;">⚡ Langsung beban penuh: <strong>${duration}s</strong></span>`;
    }
}

/**
 * Baca nilai form single test dan perbarui indikator jenis test.
 *
 * Dipanggil setiap kali salah satu nilai form berubah.
 * Menyembunyikan indikator jika nilai belum lengkap/valid.
 */
function updateTestTypeHint() {
    const el = document.getElementById('testTypeHint');
    if (!el) return;
    const threads  = readFormInt('numThreads', 'customThreads');
    const rampTime = readFormInt('rampTime',   'customRamp');
    const duration = readFormInt('duration',   'customDuration');
    if (!threads || !duration) { el.style.display = 'none'; return; }

    const info = detectTestType(threads, rampTime ?? 0, duration);
    el.style.display    = 'block';
    el.style.background = info.bg;
    el.style.borderLeftColor = info.color;
    el.style.color      = info.color;
    el.innerHTML = `<strong>${info.icon} ${info.type}</strong> — ${info.desc}`;
}
