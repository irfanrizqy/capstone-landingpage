/**
 * app-test.js — Kontrol load test (single & multi-phase) dan manajemen fase
 *
 * Menangani mulai/berhenti test, konfigurasi fase multi-phase,
 * dan cek konektivitas ke JMeter API dan target server.
 * Bergantung pada: app-state.js, app-admin.js, app-poll.js
 */

// ==================== CONNECTIVITY CHECK ====================

/**
 * Cek konektivitas ke JMeter API dan target server sebelum memulai test.
 *
 * Melakukan dua langkah:
 * 1. Ping JMeter API (/api/jmeter/ping) — pastikan JMeter bisa dijangkau
 * 2. Ping target URL (/api/test/ping) — pastikan server tujuan aktif
 *
 * Selama pengecekan, tombol start dinonaktifkan dan status diperbarui.
 * Jika salah satu langkah gagal, tombol dikembalikan dan fungsi mengembalikan false.
 *
 * @param {string}      targetUrl - URL target load test
 * @param {HTMLElement} btn       - Tombol start yang dinonaktifkan sementara
 * @param {string}      label     - Teks asli tombol untuk dikembalikan jika gagal
 * @returns {Promise<boolean>}    - true jika semua OK, false jika ada yang gagal
 */
async function checkConnectivity(targetUrl, btn, label) {
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cek JMeter API...';
    updateStatus('pending', '🔍 Step 1/2: Cek JMeter API...');

    try {
        const jRes  = await fetch('/api/jmeter/ping');
        const jData = await jRes.json();
        if (!jData.reachable) {
            updateStatus('error', `❌ JMeter tidak bisa dijangkau: ${jData.message}`);
            btn.disabled = false; btn.innerHTML = label; return false;
        }

        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cek target server...';
        updateStatus('pending', '✅ JMeter OK. Step 2/2: Cek target server...');
        await sleep(400);

        const pRes  = await fetch('/api/test/ping', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ target_url: targetUrl })
        });
        const pData = await pRes.json();
        if (!pData.reachable) {
            updateStatus('error', `❌ Target tidak bisa dijangkau: ${pData.message}`);
            btn.disabled = false; btn.innerHTML = label; return false;
        }

        updateStatus('pending', `✅ Semua OK (Packet Loss: ${pData.packet_loss}). Memulai test...`);
        await sleep(500);
        return true;
    } catch(err) {
        updateStatus('error', '❌ Connectivity error: ' + err.message);
        btn.disabled = false; btn.innerHTML = label; return false;
    }
}

// ==================== SINGLE TEST ====================

/**
 * Handler submit form single test.
 *
 * Memvalidasi input form, cek konektivitas, lalu memulai test.
 * Jika JMeter sedang sibuk, test masuk antrian dan menunggu via waitForQueue().
 * Reset semua state (chart, phase data, IDs) sebelum memulai test baru.
 *
 * @param {Event} e - Submit event dari form #loadTestForm
 */
async function handleStartSingleTest(e) {
    e.preventDefault();

    const targetUrl  = document.getElementById('targetUrl').value.trim();
    const numThreads = readFormInt('numThreads', 'customThreads');
    const rampTime   = readFormInt('rampTime',   'customRamp');
    const duration   = readFormInt('duration',   'customDuration');

    if (!targetUrl)                          { alert('Masukkan target URL.'); return; }
    if (!numThreads || numThreads < 1)       { alert('Users tidak valid.'); return; }
    if (duration == null || duration < 1)    { alert('Durasi tidak valid.'); return; }
    if (!isAdminMode && numThreads > USER_MAX_THREADS)  { alert(`User Mode: max ${USER_MAX_THREADS} users.`); return; }
    if (!isAdminMode && duration   > USER_MAX_DURATION) { alert(`User Mode: max ${USER_MAX_DURATION}s.`); return; }

    const btn = document.getElementById('startTestBtn');
    const ok  = await checkConnectivity(targetUrl, btn, '🚀 START LOAD TEST');
    if (!ok) return;

    isMultiPhaseMode    = false;
    isFetchingResults   = false;
    isNoJtlMode         = document.getElementById('noJtlToggle')?.checked || false;
    currentTestId       = null;
    currentQueueId      = null;
    allPhaseTestIds     = [];
    allPhasesTimeline   = [];
    completedPhasesMs   = 0;
    resetChart();

    currentTestParams = {
        target_url: targetUrl, num_threads: numThreads, ramp_time: rampTime, duration, http_path: '/',
        ...(isAdminMode  && { _admin_key: ADMIN_PASSWORD }),
        ...(isNoJtlMode  && { no_jtl: true }),
    };
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Starting...';

    try {
        const resp = await fetch('/api/test/start', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(currentTestParams)
        });
        const data = await resp.json();
        if (data.status === 'success') {
            currentTestId   = data.test_id;
            allPhaseTestIds = [data.test_id];
            onTestStarted(false);
        } else if (data.status === 'queued') {
            setBadge(`Antrian #${data.position}`, 'secondary');
            updateStatus('pending',
                `⏳ JMeter sedang sibuk. Test masuk antrian posisi ${data.position}. Harap tunggu...`);
            const testId = await waitForQueue(data.queue_id, null);
            if (!testId) {
                btn.disabled = false; btn.innerHTML = '🚀 START LOAD TEST'; return;
            }
            currentTestId   = testId;
            allPhaseTestIds = [testId];
            onTestStarted(false);
        } else {
            alert('Gagal: ' + (data.message || 'Unknown error'));
            btn.disabled = false; btn.innerHTML = '🚀 START LOAD TEST';
        }
    } catch(err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.innerHTML = '🚀 START LOAD TEST';
    }
}

// ==================== MULTI-PHASE ====================

/**
 * Inisialisasi daftar fase multi-phase dengan satu fase default.
 *
 * Dipanggil sekali saat DOMContentLoaded. Mengosongkan array `phases`
 * dan menambahkan satu fase awal dengan nilai default.
 */
function initPhases() {
    phases = [];
    addPhase();
}

/**
 * Tambahkan satu fase baru ke konfigurasi multi-phase.
 *
 * Default value fase baru mengikuti mode: Admin mendapat nilai besar (100 users, 60s),
 * user biasa mendapat nilai batas user (USER_MAX_THREADS, USER_MAX_DURATION).
 * Ditolak jika user mode sudah mencapai USER_MAX_PHASES.
 */
function addPhase() {
    if (isMultiPhaseMode) return;
    if (!isAdminMode && phases.length >= USER_MAX_PHASES) {
        alert(`User Mode: max ${USER_MAX_PHASES} fase.`); return;
    }
    phases.push({ threads: isAdminMode ? 100 : USER_MAX_THREADS, rampTime: phases.length === 0 ? 10 : 0,
                  duration: isAdminMode ? 60 : USER_MAX_DURATION });
    renderPhases();
    renderSummary();
}

/**
 * Hapus fase ke-i dari daftar fase.
 *
 * Ditolak jika hanya tersisa 1 fase (minimal 1 fase harus ada).
 *
 * @param {number} i - Indeks fase yang akan dihapus (0-based)
 */
function removePhase(i) {
    if (isMultiPhaseMode) return;
    if (phases.length <= 1) { alert('Minimal 1 fase.'); return; }
    phases.splice(i, 1);
    renderPhases();
    renderSummary();
}

/**
 * Perbarui nilai field tertentu pada fase ke-i.
 *
 * Dipanggil setiap kali input di panel fase berubah.
 * Nilai yang melebihi batas user (threads, duration) otomatis diklem ke nilai max
 * sehingga user tidak bisa memasukkan nilai di atas batas meski mengetik langsung.
 *
 * @param {number} i     - Indeks fase yang diperbarui (0-based)
 * @param {string} field - Nama field: 'threads' | 'rampTime' | 'duration'
 * @param {string} raw   - Nilai mentah dari input (belum diparse ke integer)
 */
function updatePhase(i, field, raw) {
    if (isMultiPhaseMode) return;
    if (!phases[i]) return;
    let val = parseInt(raw);
    if (isNaN(val)) return;
    if (!isAdminMode) {
        if (field === 'threads'  && val > USER_MAX_THREADS)  val = USER_MAX_THREADS;
        if (field === 'duration' && val > USER_MAX_DURATION) val = USER_MAX_DURATION;
    }
    phases[i][field] = val;
    renderPhases();
    renderSummary();
}

/**
 * Render ulang semua panel fase ke DOM.
 *
 * Mengosongkan #phasesContainer dan membangun ulang card tiap fase dari array `phases`.
 * Tombol "Hapus" hanya muncul di fase ke-2 ke atas (fase pertama tidak bisa dihapus).
 * Label counter fase (misal "2/3 fase") diperbarui sesuai mode admin/user.
 */
function renderPhases() {
    const c   = document.getElementById('phasesContainer');
    c.innerHTML = '';
    const maxT   = isAdminMode ? 10000 : USER_MAX_THREADS;
    const maxD   = isAdminMode ? 3600  : USER_MAX_DURATION;
    const locked = isMultiPhaseMode;

    phases.forEach((p, i) => {
        const info = detectTestType(p.threads || 0, p.rampTime ?? 0, p.duration || 0);
        const div = document.createElement('div');
        div.className = 'phase-panel';
        div.innerHTML = `
            <div class="phase-number">Fase ${i+1} <span style="font-size:0.72rem;font-weight:500;padding:2px 8px;border-radius:20px;background:${info.bg};color:${info.color};margin-left:6px;">${info.icon} ${info.type}</span></div>
            ${i > 0 && !locked ? `<button class="btn-remove-phase" onclick="removePhase(${i})">✕ Hapus</button>` : ''}
            <div class="row g-2">
                <div class="col-md-4">
                    <label class="form-label" style="font-size:.82rem;">Users (max ${maxT}): <span class="tip" data-tip="Jumlah user virtual yang mengirim&#10;request secara bersamaan ke server.&#10;Makin banyak = makin besar beban.">?</span></label>
                    <input type="number" class="form-control form-control-sm"
                           min="1" max="${maxT}" value="${p.threads}" ${locked ? 'disabled' : ''}
                           onchange="updatePhase(${i},'threads',this.value)">
                </div>
                <div class="col-md-4">
                    <label class="form-label" style="font-size:.82rem;">Ramp-up (s): <span class="tip" data-tip="Waktu (detik) untuk menambah semua user&#10;secara bertahap. Isi 0 untuk langsung&#10;semua user aktif sekaligus.">?</span></label>
                    <input type="number" class="form-control form-control-sm"
                           min="0" max="600" value="${p.rampTime}" ${locked ? 'disabled' : ''}
                           onchange="updatePhase(${i},'rampTime',this.value)">
                </div>
                <div class="col-md-4">
                    <label class="form-label" style="font-size:.82rem;">Durasi (s, max ${maxD}): <span class="tip" data-tip="Lama waktu (detik) load test berjalan&#10;setelah semua user aktif.&#10;Tidak termasuk ramp-up time.">?</span></label>
                    <input type="number" class="form-control form-control-sm"
                           min="1" max="${maxD}" value="${p.duration}" ${locked ? 'disabled' : ''}
                           onchange="updatePhase(${i},'duration',this.value)">
                </div>
            </div>`;
        c.appendChild(div);
    });

    const addBtn = document.getElementById('addPhaseBtn');
    if (addBtn) addBtn.disabled = locked;

    const lim = document.getElementById('phaseLimit');
    if (lim) lim.textContent = isAdminMode
        ? `(${phases.length} fase)`
        : `(${phases.length}/${USER_MAX_PHASES} fase)`;
}

/**
 * Render panel ringkasan konfigurasi multi-phase.
 *
 * Menampilkan daftar singkat tiap fase (users · ramp · durasi)
 * dan total durasi konfigurasi dalam detik dan menit.
 * Dipanggil setiap kali fase ditambah, dihapus, atau diubah nilainya.
 */
function renderSummary() {
    const panel = document.getElementById('summaryPanel');
    const rows  = document.getElementById('summaryRows');
    const total = document.getElementById('summaryTotal');
    if (!panel) return;
    panel.style.display = '';
    rows.innerHTML = '';

    let totalDur = 0;
    phases.forEach((p, i) => {
        const dur = parseInt(p.duration) || 0;
        totalDur += dur;
        const fullLoad = Math.max(0, dur - (p.rampTime || 0));
        const row = document.createElement('div');
        row.className = 'summary-phase-row';
        row.innerHTML = `<span class="phase-label">Fase ${i+1}</span>
            <span class="phase-detail">${p.threads} users · ` +
            (p.rampTime > 0
                ? `ramp <strong>${p.rampTime}s</strong> + load <strong>${fullLoad}s</strong> = <strong>${dur}s</strong>`
                : `langsung beban penuh <strong>${dur}s</strong>`) +
            `</span>`;
        rows.appendChild(row);
    });
    total.innerHTML = `<span>Total: ${phases.length} fase</span>
        <span>~${totalDur}s (${(totalDur/60).toFixed(1)} menit)</span>`;
}

/**
 * Handler tombol START MULTI-PHASE TEST.
 *
 * Memvalidasi semua fase, cek konektivitas, lalu memulai fase pertama via runPhase().
 * Reset semua state global (phase index, chart, test IDs) sebelum mulai.
 */
async function handleStartMultiPhase() {
    const targetUrl = document.getElementById('targetUrl').value.trim();
    if (!targetUrl) { alert('Masukkan target URL.'); return; }

    for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        if (!p.threads || p.threads < 1)  { alert(`Fase ${i+1}: users min 1.`); return; }
        if (!p.duration || p.duration < 1) { alert(`Fase ${i+1}: durasi min 1s.`); return; }
        if (!isAdminMode) {
            if (p.threads  > USER_MAX_THREADS)  { alert(`Fase ${i+1}: max ${USER_MAX_THREADS} users.`); return; }
            if (p.duration > USER_MAX_DURATION)  { alert(`Fase ${i+1}: max ${USER_MAX_DURATION}s.`); return; }
        }
    }

    const btn = document.getElementById('startMultiBtn');
    const ok  = await checkConnectivity(targetUrl, btn, '🚀 START MULTI-PHASE TEST');
    if (!ok) return;

    isMultiPhaseMode      = true;
    isFetchingResults     = false;
    isNoJtlMode           = document.getElementById('noJtlToggle')?.checked || false;
    currentPhaseIndex     = 0;
    currentTestId         = null;
    currentQueueId        = null;
    allPhaseTestIds       = [];
    allPhasesTimeline     = [];
    completedPhasesMs     = 0;
    phaseBoundaryIndices  = [];
    rampBoundaryIndices   = [];
    allPhasesSummaries    = [];
    currentTestParams     = { target_url: targetUrl };
    resetChart();
    renderPhases();  // Kunci input/tombol hapus selama test berjalan
    document.getElementById('resultsContent').style.display = 'none';

    await runPhase(targetUrl);
}

/**
 * Mulai satu fase dari multi-phase test.
 *
 * Dipanggil secara rekursif dari fetchResults() setelah tiap fase selesai.
 * Mengirim request /api/test/start untuk fase currentPhaseIndex.
 * Jika JMeter sedang sibuk, menunggu antrian via waitForQueue().
 * Jika semua fase sudah dijalankan, memanggil finishMultiPhase() secara langsung.
 *
 * @param {string} targetUrl - URL target yang sama untuk semua fase
 */
async function runPhase(targetUrl) {
    if (currentPhaseIndex >= phases.length) { finishMultiPhase(); return; }

    // Kosongkan currentTestId selama transisi agar handleStopTest tidak mencoba
    // menghentikan fase yang sudah selesai di periode jeda antar fase.
    currentTestId = null;

    const p   = phases[currentPhaseIndex];
    const num = currentPhaseIndex + 1;

    document.getElementById('phaseProgressLabel').textContent = `Fase ${num}/${phases.length}`;
    updateStatus('running', `▶️ Menjalankan Fase ${num}/${phases.length}: ${p.threads} users, ${p.duration}s`);

    try {
        const resp = await fetch('/api/test/start', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                target_url:  targetUrl,
                num_threads: p.threads,
                ramp_time:   p.rampTime,
                duration:    p.duration,
                http_path:   '/',
                ...(isAdminMode && { _admin_key: ADMIN_PASSWORD }),
                ...(isNoJtlMode && { no_jtl: true }),
            })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            currentTestId = data.test_id;
            allPhaseTestIds.push(data.test_id);
            onTestStarted(true);
        } else if (data.status === 'queued') {
            setBadge(`Antrian #${data.position}`, 'secondary');
            updateStatus('pending',
                `⏳ Fase ${num} dalam antrian posisi ${data.position}. Menunggu JMeter bebas...`);
            const testId = await waitForQueue(data.queue_id, `Fase ${num}`);
            if (!testId) { resetMultiUI(); isMultiPhaseMode = false; return; }
            currentTestId = testId;
            allPhaseTestIds.push(testId);
            onTestStarted(true);
        } else {
            updateStatus('error', `Fase ${num} gagal: ${data.message}`);
            isMultiPhaseMode = false; resetMultiUI(); renderPhases();
        }
    } catch(err) {
        updateStatus('error', 'Error: ' + err.message);
        isMultiPhaseMode = false; resetMultiUI(); renderPhases();
    }
}

/**
 * Akhiri sesi multi-phase test setelah semua fase selesai.
 *
 * Menghentikan polling dan animasi, menyembunyikan progress bar,
 * dan memperbarui status + badge menjadi 'Completed'.
 */
function finishMultiPhase() {
    isMultiPhaseMode = false;
    stopPolling();
    resetMultiUI();
    renderPhases();  // Buka kunci input/tombol hapus kembali
    showProgress(false);
    document.getElementById('phaseProgressLabel').textContent = '';
    updateStatus('completed', `✅ Semua ${phases.length} fase selesai.`);
    setBadge('Completed', 'success');

    // Simpan sesi ke server (JMeter API disk) agar terlihat oleh semua pengguna
    if (allPhaseTestIds.length > 1) {
        fetch('/api/test/sessions', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                id:           'mp_' + Date.now(),
                test_ids:     [...allPhaseTestIds],
                phase_count:  allPhaseTestIds.length,
                target_url:   phases[0]?.target_url || '',
                completed_at: new Date().toISOString(),
            }),
        })
        .then(() => { if (typeof loadMultiPhaseHistory === 'function') loadMultiPhaseHistory(); })
        .catch(e  => console.warn('Gagal simpan sesi multi-phase:', e));
    }
}

/**
 * Kembalikan tombol multi-phase ke state siap (start aktif, stop dinonaktifkan).
 *
 * Dipanggil saat multi-phase selesai, gagal, atau dihentikan paksa.
 */
function resetMultiUI() {
    const btn  = document.getElementById('startMultiBtn');
    const stop = document.getElementById('stopMultiBtn');
    if (btn)  { btn.disabled  = false; btn.innerHTML  = '🚀 START MULTI-PHASE TEST'; }
    if (stop) stop.disabled = true;
}

// ==================== STOP ====================

/**
 * Handler tombol STOP untuk single test dan multi-phase test.
 *
 * Dua skenario:
 * 1. Test masih dalam antrian (currentQueueId ada, currentTestId belum ada):
 *    Batalkan antrian dengan mereset currentQueueId → waitForQueue() otomatis berhenti
 *    pada iterasi berikutnya karena guard `currentQueueId === queueId` gagal.
 * 2. Test sudah berjalan (currentTestId ada):
 *    Kirim POST /api/test/stop/<id> ke JMeter untuk menghentikan test aktif.
 */
async function handleStopTest() {
    // Jika test masih dalam antrian (belum mulai), batalkan antrian
    if (currentQueueId && !currentTestId) {
        if (!confirm('Yakin ingin membatalkan test yang sedang menunggu antrian?')) return;
        currentQueueId   = null;  // flag ke waitForQueue untuk berhenti
        isMultiPhaseMode = false;
        updateStatus('stopped', 'Antrian dibatalkan.');
        setBadge('Cancelled', 'secondary');
        resetMultiUI();
        renderPhases();
        const btn  = document.getElementById('startTestBtn');
        if (btn)  { btn.disabled  = false; btn.innerHTML  = '🚀 START LOAD TEST'; }
        return;
    }
    // Tidak ada test aktif — tapi jika multi-phase sedang dalam transisi antar fase,
    // cukup batalkan sesi tanpa perlu mengirim stop ke API.
    if (!currentTestId) {
        if (isMultiPhaseMode) {
            if (!confirm('Yakin ingin menghentikan multi-phase test?')) return;
            isMultiPhaseMode = false;
            resetMultiUI();
            renderPhases();
            showProgress(false);
            updateStatus('stopped', 'Multi-phase test dihentikan.');
            setBadge('Stopped', 'secondary');
        }
        return;
    }
    if (!confirm('Yakin ingin menghentikan test?')) return;
    isMultiPhaseMode = false;
    try {
        const resp = await fetch(`/api/test/stop/${currentTestId}`, { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'success') {
            updateStatus('stopped', 'Test dihentikan.');
            stopPolling();
            renderPhases();
        }
    } catch(err) { alert('Error stop: ' + err.message); }
}

/**
 * Callback yang dipanggil setelah test berhasil dimulai (single atau fase N).
 *
 * Menampilkan progress bar, memperbarui badge dan status,
 * mengaktifkan tombol stop, dan memulai polling status + animasi progress.
 * Inisialisasi lastProgressData agar interpolasi dimulai dari nol.
 *
 * @param {boolean} isMulti - true jika ini bagian dari multi-phase test
 */
function onTestStarted(isMulti) {
    showProgress(true);
    setBadge('Running', 'warning');
    updateStatus('running', '▶️ Test sedang berjalan...');
    document.getElementById('stopTestBtn').disabled = false;
    const sm = document.getElementById('stopMultiBtn');
    if (sm) sm.disabled = false;
    lastProgressData = { progress: 0, elapsed: 0, timestamp: Date.now(), isMulti };
    startProgressAnimation();
    startPolling(isMulti);
}

