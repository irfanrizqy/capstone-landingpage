/**
 * app-poll.js — Polling status test dan animasi progress bar
 *
 * Melakukan polling ke /api/test/status setiap POLL_INTERVAL_MS detik
 * dan menganimasikan progress bar dengan interpolasi waktu.
 * Bergantung pada: app-state.js, app-results.js, app-disk.js
 */

// ==================== POLLING ====================

/**
 * Mulai polling status test secara periodik (setiap POLL_INTERVAL_MS ms).
 *
 * Menghentikan polling lama jika ada sebelum memulai yang baru,
 * sehingga aman dipanggil berulang kali tanpa membuat interval ganda.
 *
 * @param {boolean} isMulti - true jika ini bagian dari multi-phase test
 */
function startPolling(isMulti) {
    if (testPollingInterval) clearInterval(testPollingInterval);
    testPollingInterval = setInterval(() => pollStatus(isMulti), POLL_INTERVAL_MS);
}

/**
 * Hentikan polling dan kembalikan tombol ke state awal.
 *
 * Dipanggil saat test selesai, gagal, atau dihentikan paksa.
 * Juga menghentikan animasi interpolasi progress bar.
 */
function stopPolling() {
    if (testPollingInterval) { clearInterval(testPollingInterval); testPollingInterval = null; }
    stopProgressAnimation();
    const b = document.getElementById('startTestBtn');
    const s = document.getElementById('stopTestBtn');
    if (b) { b.disabled = false; b.innerHTML = '🚀 START LOAD TEST'; }
    if (s) s.disabled = true;
}

/**
 * Satu tick polling: ambil status test dari API dan proses transisi state.
 *
 * Guard isFetchingResults mencegah race condition di mana beberapa tick
 * setInterval yang hampir bersamaan semuanya melihat status 'completed'
 * dan memicu fetchResults() lebih dari sekali untuk fase yang sama.
 *
 * @param {boolean} isMulti - true jika ini bagian dari multi-phase test
 */
async function pollStatus(isMulti) {
    if (!currentTestId) return;
    try {
        const resp = await fetch(`/api/test/status/${currentTestId}`);
        const data = await resp.json();
        if (!resp.ok) return;

        if (data.progress !== undefined) {
            updateProgressBar(isMulti, data.progress, data.elapsed_time || 0);
        }

        const s = data.status;
        if (s === 'running') {
            setBadge('Running', 'warning');
        }
        if (s === 'completed' || s === 'failed' || s === 'stopped') {
            stopPolling();
            showProgress(false);
            if (s === 'completed') {
                // Guard: beberapa tick setInterval bisa selesai hampir bersamaan dan semuanya
                // melihat status 'completed'. Hanya satu yang boleh memanggil fetchResults().
                if (isFetchingResults) return;
                isFetchingResults = true;
                updateStatus('pending', '⏳ Mengambil hasil test...');
                setBadge('Loading...', 'info');
                try {
                    await fetchResults(isMulti);
                } finally {
                    isFetchingResults = false;
                }
            } else if (s === 'failed') {
                updateStatus('error', '❌ Test gagal. Memeriksa penyebab...');
                setBadge('Failed', 'danger');
                if (isMulti) { isMultiPhaseMode = false; resetMultiUI(); }
                // Cek apakah disk penuh sebagai kemungkinan penyebab kegagalan
                await checkDiskOnFailure();
            } else {
                updateStatus('stopped', 'Test dihentikan.');
                setBadge('Stopped', 'secondary');
                if (isMulti) { isMultiPhaseMode = false; resetMultiUI(); }
            }
        }
    } catch(err) { console.error('Poll error:', err); }
}

/**
 * Simpan data progress terbaru dari API untuk digunakan interpolasi animasi.
 *
 * Data API datang setiap 2 detik, sedangkan animasi bar berjalan 10x/detik.
 * Fungsi ini hanya menyimpan data snapshot; renderProgressFromState() yang
 * menghitung posisi interpolasi berdasarkan waktu berlalu sejak snapshot.
 *
 * @param {boolean} isMulti       - true jika multi-phase test
 * @param {number}  phaseProgress - persentase progress fase saat ini (0–100)
 * @param {number}  elapsedInPhase - waktu yang sudah berlalu dalam fase (detik)
 */
function updateProgressBar(isMulti, phaseProgress, elapsedInPhase) {
    lastProgressData = {
        progress:  phaseProgress,
        elapsed:   elapsedInPhase,
        timestamp: Date.now(),
        isMulti
    };
    renderProgressFromState();
}

/**
 * Render ulang progress bar menggunakan data terakhir + interpolasi waktu.
 *
 * Dipanggil setiap 100ms oleh animasi interval. Menghitung posisi bar
 * dengan menambahkan drift waktu sejak snapshot terakhir, sehingga bar
 * terlihat bergerak mulus meski data API hanya datang setiap 2 detik.
 *
 * Untuk multi-phase, persentase dihitung relatif terhadap total durasi semua fase.
 */
function renderProgressFromState() {
    const { progress: phaseProgress, elapsed: elapsedInPhase, timestamp, isMulti } = lastProgressData;

    // Interpolasi: hitung waktu yang sudah berlalu sejak data terakhir diterima
    const driftMs = Math.min(2000, Date.now() - timestamp);
    const drift   = driftMs / 1000;

    let pct, elapsed;
    if (isMulti && phases.length > 0) {
        const totalDur    = phases.reduce((s, p) => s + (parseInt(p.duration) || 0), 0);
        const phaseDur    = parseInt(phases[currentPhaseIndex]?.duration) || 0;
        const realElapsed = Math.min(phaseDur, elapsedInPhase + drift);
        const realPhasePct = phaseDur > 0 ? (realElapsed / phaseDur) * 100 : 0;
        const curProg     = (realPhasePct / 100) * phaseDur;
        pct     = totalDur > 0 ? Math.min(100, ((completedPhasesMs + curProg) / totalDur) * 100) : 0;
        elapsed = completedPhasesMs + realElapsed;
        document.getElementById('phaseProgressLabel').textContent =
            `Fase ${currentPhaseIndex+1}/${phases.length} · Total ~${totalDur}s`;
    } else {
        const phaseDur    = currentTestParams?.duration || 60;
        const realElapsed = Math.min(phaseDur, elapsedInPhase + drift);
        pct     = phaseDur > 0 ? Math.min(100, (realElapsed / phaseDur) * 100) : phaseProgress;
        elapsed = realElapsed;
    }

    document.getElementById('testProgressBar').style.width  = pct.toFixed(1) + '%';
    document.getElementById('testProgressText').textContent = pct.toFixed(1) + '%';
    document.getElementById('testElapsedTime').textContent  = elapsed.toFixed(0);
}

/**
 * Mulai animasi progress bar (interval 100ms untuk gerakan mulus).
 *
 * Menggunakan interpolasi waktu sehingga bar bergerak smooth di antara
 * polling API yang datang setiap 2 detik.
 */
function startProgressAnimation() {
    stopProgressAnimation();
    progressAnimInterval = setInterval(renderProgressFromState, 100);
}

/**
 * Hentikan animasi progress bar.
 */
function stopProgressAnimation() {
    if (progressAnimInterval) {
        clearInterval(progressAnimInterval);
        progressAnimInterval = null;
    }
}

// ==================== QUEUE POLLING ====================

/**
 * Tunggu antrian selesai dengan polling setiap 3 detik (async loop).
 *
 * Mengembalikan test_id saat JMeter mulai menjalankan test dari antrian,
 * atau null jika terjadi error atau antrian dibatalkan (currentQueueId direset).
 *
 * Cara membatalkan dari luar: set currentQueueId = null, loop akan berhenti
 * pada iterasi berikutnya karena pengecekan `currentQueueId === queueId`.
 *
 * @param {string}      queueId - ID antrian yang diterima dari /api/test/start
 * @param {string|null} label   - Label untuk pesan status, misal 'Fase 2' atau null untuk single
 * @returns {Promise<string|null>} - test_id jika berhasil, null jika error/dibatalkan
 */
async function waitForQueue(queueId, label) {
    currentQueueId = queueId;
    const prefix   = label ? label : 'Test';

    while (currentQueueId === queueId) {
        await sleep(3000);
        try {
            const resp = await fetch(`/api/test/queue/status/${queueId}`);
            const data = await resp.json();

            if (data.status === 'started') {
                currentQueueId = null;
                return data.test_id;
            }
            if (data.status === 'queued') {
                setBadge(`Antrian #${data.position}`, 'secondary');
                updateStatus('pending',
                    `⏳ ${prefix} dalam antrian posisi ${data.position}. Menunggu test lain selesai...`);
            } else {
                currentQueueId = null;
                updateStatus('error',
                    `❌ ${prefix} gagal dari antrian: ${data.message || 'Unknown error'}`);
                setBadge('Error', 'danger');
                return null;
            }
        } catch(err) {
            console.error('Queue poll error:', err);
        }
    }
    return null; // dibatalkan dari luar (currentQueueId di-reset oleh handleStopTest)
}
