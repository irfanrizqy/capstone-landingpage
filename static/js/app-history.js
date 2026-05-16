/**
 * app-history.js — Riwayat test: tabel daftar + modal detail
 *
 * Bergantung pada: app-state.js (sleep, _fmtDateTime via app-results.js)
 */

// ==================== STATE ====================

let _historyModal       = null;
let _historyChart       = null;
let _historyDetailId    = null;
let _historyRefreshTimer = null;

// ==================== INIT ====================

function initHistory() {
    const modalEl = document.getElementById('historyDetailModal');
    if (modalEl) _historyModal = new bootstrap.Modal(modalEl);

    const btn = document.getElementById('historyRefreshBtn');
    if (btn) btn.addEventListener('click', loadHistory);

    loadHistory();
    loadMultiPhaseHistory();
    _historyRefreshTimer = setInterval(loadHistory, 30000);
}

// ==================== LOAD & RENDER TABLE ====================

async function loadHistory() {
    const statusEl = document.getElementById('historyStatus');
    if (statusEl) statusEl.textContent = 'Memuat...';

    try {
        let tests = await _fetchTestList();

        // Jika kosong, coba restore dari disk lalu fetch ulang
        if (tests.length === 0) {
            await fetch('/api/test/restore', { method: 'POST' }).catch(() => {});
            tests = await _fetchTestList();
        }

        // Ambil session info agar tabel single bisa tandai test multi-phase
        let sessionMap = {};
        try {
            const sResp = await fetch('/api/test/sessions');
            if (sResp.ok) {
                const sData = await sResp.json();
                (sData.sessions || []).forEach(s => {
                    s.test_ids.forEach((tid, i) => {
                        sessionMap[tid] = { session_id: s.id, phase: i + 1, total: s.phase_count, ids: s.test_ids };
                    });
                });
            }
        } catch {}

        _renderHistoryTable(tests, sessionMap);

        if (statusEl) {
            const now = new Date().toLocaleTimeString('id-ID');
            statusEl.textContent = `${tests.length} test tersimpan · Diperbarui: ${now}`;
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Gagal memuat riwayat: ' + e.message;
    }
}

async function _fetchTestList() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const resp = await fetch('/api/test/list', { signal: ctrl.signal });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.tests || [];
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('Timeout: server tidak merespons dalam 10 detik');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function _renderHistoryTable(tests, sessionMap = {}) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    if (!tests.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Belum ada riwayat test.</td></tr>';
        return;
    }

    // Urutkan terbaru di atas
    const sorted = [...tests].sort((a, b) => {
        const at = a.start_time || a.created_time || '';
        const bt = b.start_time || b.created_time || '';
        return bt.localeCompare(at);
    });

    // Pre-hitung fase pertama tiap sesi (test_id dengan phase paling kecil)
    // agar tombol Download Merged muncul di baris fase_1, bukan fase terakhir
    const sessionFirstId = {};
    Object.entries(sessionMap).forEach(([tid, s]) => {
        const cur = sessionFirstId[s.session_id];
        if (!cur || s.phase < sessionMap[cur].phase) sessionFirstId[s.session_id] = tid;
    });
    const shownSessions = new Set();

    tbody.innerHTML = sorted.map(t => {
        const statusBadge = {
            completed: '<span class="badge bg-success">Selesai</span>',
            failed:    '<span class="badge bg-danger">Gagal</span>',
            running:   '<span class="badge bg-warning text-dark">Berjalan</span>',
            pending:   '<span class="badge bg-secondary">Pending</span>',
            stopped:   '<span class="badge bg-secondary">Dihentikan</span>',
        }[t.status] || `<span class="badge bg-secondary">${t.status}</span>`;

        const waktu   = _fmtDateTime(t.start_time || t.created_time);
        const target  = t.target_url || '--';
        const shortT  = target.length > 32 ? target.substring(0, 32) + '…' : target;
        const threads = t.parameters?.num_threads ?? '--';
        const dur     = t.parameters?.duration != null ? t.parameters.duration + 's' : '--';
        const avgRT   = t.summary?.response_time_avg != null ? t.summary.response_time_avg.toFixed(1) + ' ms' : '--';
        const errRate = t.summary?.error_rate != null ? t.summary.error_rate.toFixed(2) + '%' : '--';

        // Badge multi-phase jika test ini bagian dari sesi
        const sess = sessionMap[t.test_id];
        const phaseBadge = sess
            ? `<span class="badge bg-info text-dark ms-1" style="font-size:0.65rem">Fase ${sess.phase}/${sess.total}</span>`
            : '';

        // Tombol download merged — tampilkan hanya pada baris fase_1 dari sesi
        let mergedBtn = '';
        if (sess && !shownSessions.has(sess.session_id) && sessionFirstId[sess.session_id] === t.test_id) {
            shownSessions.add(sess.session_id);
            const idsParam = sess.ids.join(',');
            mergedBtn = `
                <button class="btn btn-sm btn-outline-success py-0 px-1 ms-1"
                        style="font-size:0.72rem"
                        title="Download Summary CSV gabungan ${sess.total} fase"
                        onclick="_dlMultiSummary('${idsParam}', this)">📊</button>
                <button class="btn btn-sm btn-outline-warning py-0 px-1 ms-1"
                        style="font-size:0.72rem"
                        title="Download Requests CSV gabungan ${sess.total} fase"
                        onclick="_dlMultiRequests('${idsParam}', this)">📄</button>`;
        }

        return `<tr>
            <td><code style="font-size:0.72rem">${t.test_id}</code>${phaseBadge}</td>
            <td title="${target}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortT}</td>
            <td>${statusBadge}</td>
            <td>${threads}</td>
            <td>${dur}</td>
            <td style="white-space:nowrap">${waktu}</td>
            <td>${avgRT}</td>
            <td>${errRate}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-sm btn-outline-primary py-0 px-2"
                        style="font-size:0.78rem"
                        onclick="showHistoryDetail('${t.test_id}')">Detail</button>${mergedBtn}
            </td>
        </tr>`;
    }).join('');
}

// ==================== MODAL DETAIL ====================

async function showHistoryDetail(testId) {
    _historyDetailId = testId;
    document.getElementById('modalTestId').textContent = testId;

    const body = document.getElementById('historyModalBody');
    body.innerHTML = `<div class="text-center py-5">
        <div class="spinner-border text-success"></div>
        <p class="mt-2 text-muted small">Memuat hasil...</p>
    </div>`;

    // Reset tombol download
    ['modalDownloadJsonBtn','modalDownloadSummaryCsvBtn','modalDownloadRequestsCsvBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = false; el.onclick = null; }
    });

    if (_historyModal) _historyModal.show();

    try {
        const resp = await fetch(`/api/test/results/${testId}`);
        let data;
        try {
            data = await resp.json();
        } catch {
            body.innerHTML = `<div class="alert alert-danger">
                Server mengembalikan response tidak valid (bukan JSON).<br>
                <small class="text-muted">Status HTTP: ${resp.status}. Pastikan JMeter API aktif.</small>
            </div>`;
            return;
        }

        if (resp.status === 202 || data.status === 'processing') {
            body.innerHTML = `<div class="alert alert-info">
                ⏳ Hasil test masih diproses server. Coba beberapa saat lagi.
            </div>`;
            return;
        }

        if (!resp.ok || !data.summary) {
            body.innerHTML = `<div class="alert alert-warning">
                Hasil tidak tersedia untuk test ini.<br>
                <small class="text-muted">Status: <strong>${data.status || 'unknown'}</strong></small>
            </div>`;
            return;
        }

        _renderHistoryModal(testId, data);
    } catch (e) {
        body.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
    }
}

function _renderHistoryModal(testId, data) {
    const s      = data.summary;
    const params = data.parameters || {};
    const start  = _fmtDateTime(data.start_time);
    const end    = _fmtDateTime(data.end_time);
    const dur    = data.total_time != null ? data.total_time.toFixed(1) + 's' : '--';
    const sr     = s.total_requests > 0
        ? ((s.success_requests / s.total_requests) * 100).toFixed(2) : '0.00';
    const srColor = parseFloat(sr) >= 99 ? 'bg-success'
                  : parseFloat(sr) >= 95 ? 'bg-warning text-dark' : 'bg-danger';

    document.getElementById('historyModalBody').innerHTML = `
        <div class="row g-3">
            <div class="col-md-5">
                <div class="alert alert-light mb-0">
                    <h6 class="alert-heading mb-2">📝 Informasi Test</h6>
                    <ul class="mb-0 small">
                        <li>Target: <code>${params.target_url || '--'}</code></li>
                        <li>Path: <code>${params.http_path || '/'}</code></li>
                        <li>Threads: <strong>${params.num_threads ?? '--'}</strong></li>
                        <li>Ramp-up: ${params.ramp_time ?? '--'}s</li>
                        <li>Durasi: ${params.duration ?? '--'}s</li>
                        <li>Waktu Mulai: <strong>${start}</strong></li>
                        <li>Waktu Selesai: <strong>${end}</strong></li>
                        <li>Total Waktu: ${dur}</li>
                    </ul>
                </div>
            </div>
            <div class="col-md-7">
                <table class="table table-sm mb-0">
                    <tbody>
                        <tr><td class="text-muted">Avg Response Time</td><td><strong>${s.response_time_avg ?? '--'} ms</strong></td></tr>
                        <tr><td class="text-muted">Min / Max</td><td>${s.response_time_min ?? '--'} / ${s.response_time_max ?? '--'} ms</td></tr>
                        <tr><td class="text-muted">Median / 90p / 95p</td><td>${s.response_time_median ?? '--'} / ${s.response_time_90percentile ?? '--'} / ${s.response_time_95percentile ?? '--'} ms</td></tr>
                        <tr><td class="text-muted">Throughput</td><td><strong>${s.throughput?.toFixed(2) ?? '--'} req/s</strong></td></tr>
                        <tr><td class="text-muted">Total Request</td><td>${s.total_requests?.toLocaleString() ?? '--'}</td></tr>
                        <tr><td class="text-muted">Success / Error</td><td>${s.success_requests?.toLocaleString() ?? '--'} / ${s.error_requests?.toLocaleString() ?? '--'}</td></tr>
                        <tr><td class="text-muted">Success Rate</td><td><span class="badge ${srColor}">${sr}%</span></td></tr>
                        <tr><td class="text-muted">Error Rate</td><td>${s.error_rate?.toFixed(2) ?? '--'}%</td></tr>
                        <tr><td class="text-muted">Bandwidth Recv/Send</td><td>${s.bandwidth_received?.toFixed(2) ?? '--'} / ${s.bandwidth_sent?.toFixed(2) ?? '--'} KB/s</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        ${s.timeline?.length > 0 ? `
        <div class="row mt-3">
            <div class="col-12">
                <h6 class="border-bottom pb-2 mt-2">📈 Timeline Response Time</h6>
                <div style="height:180px"><canvas id="historyChartCanvas"></canvas></div>
            </div>
        </div>` : ''}
    `;

    // Render chart jika ada timeline
    if (s.timeline?.length > 0) {
        setTimeout(() => {
            const ctx = document.getElementById('historyChartCanvas')?.getContext('2d');
            if (!ctx) return;
            if (_historyChart) _historyChart.destroy();
            _historyChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: s.timeline.map(p => p.timestamp + 's'),
                    datasets: [{
                        label: 'Response Time (ms)',
                        data: s.timeline.map(p => p.response_time),
                        borderColor: '#047857',
                        backgroundColor: 'rgba(4,120,87,0.08)',
                        borderWidth: 1.5, fill: true, tension: 0.4, pointRadius: 0
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { maxTicksLimit: 15, autoSkip: true, font: { size: 10 } } },
                        y: { beginAtZero: true, ticks: { callback: v => v + ' ms', font: { size: 10 } } }
                    }
                }
            });
        }, 50);
    }

    // Download buttons
    const jsonBtn = document.getElementById('modalDownloadJsonBtn');
    if (jsonBtn) jsonBtn.onclick = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${testId}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    const csvSumBtn = document.getElementById('modalDownloadSummaryCsvBtn');
    if (csvSumBtn) csvSumBtn.onclick = () => _handleModalSummaryCsv(testId, csvSumBtn);

    const csvReqBtn = document.getElementById('modalDownloadRequestsCsvBtn');
    if (csvReqBtn) csvReqBtn.onclick = () => _handleModalRequestsCsv(testId, csvReqBtn);
}

function _setModalDownloadProgress(btn, message, variant = 'success') {
    let progressEl = document.getElementById('modalCsvDownloadProgress');

    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'modalCsvDownloadProgress';
        progressEl.style.cssText = 'width:100%;margin:8px 12px 0 12px;';
        progressEl.innerHTML = `
            <div class="progress" style="height:6px;width:100%;">
                <div id="modalCsvDownloadBar"
                     class="progress-bar progress-bar-striped progress-bar-animated bg-${variant}"
                     role="progressbar"
                     style="width:100%">
                </div>
            </div>
            <small id="modalCsvDownloadMsg"
                   class="text-muted"
                   style="font-size:0.75rem;display:block;margin-top:4px;">
            </small>
        `;

        const footer = document.querySelector('#historyDetailModal .modal-footer');
        if (footer) footer.prepend(progressEl);
    }

    const bar = document.getElementById('modalCsvDownloadBar');
    const msg = document.getElementById('modalCsvDownloadMsg');

    if (bar) {
        bar.className = `progress-bar progress-bar-striped progress-bar-animated bg-${variant}`;
    }

    if (msg) msg.textContent = message || '';

    progressEl.style.display = 'block';
}

function _hideModalDownloadProgress() {
    const progressEl = document.getElementById('modalCsvDownloadProgress');
    if (progressEl) progressEl.style.display = 'none';
}

async function _downloadBlobWithButton(btn, url, filename, loadingText, progressVariant = 'success') {
    const orig = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${loadingText}`;
    _setModalDownloadProgress(btn, loadingText, progressVariant);

    try {
        const resp = await fetch(url);
        const ct = resp.headers.get('content-type') || '';

        if (!resp.ok) {
            let errMsg = `Server error ${resp.status}`;
            try {
                const j = await resp.json();
                errMsg = j.message || errMsg;
            } catch {}
            throw new Error(errMsg);
        }

        _setModalDownloadProgress(btn, 'Menyiapkan file untuk diunduh...', progressVariant);

        const blob = await resp.blob();

        if (!ct.includes('csv') && !ct.includes('octet-stream') && !ct.includes('text/plain')) {
            console.warn('Unexpected content-type:', ct);
        }

        triggerDownload(blob, filename);

        btn.innerHTML = '✅ Selesai';
        _setModalDownloadProgress(btn, 'Download selesai.', progressVariant);

        setTimeout(() => {
            btn.innerHTML = orig;
            btn.disabled = false;
            _hideModalDownloadProgress();
        }, 1500);

    } catch (e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig;
        btn.disabled = false;
        _hideModalDownloadProgress();
    }
}

async function _handleModalSummaryCsv(testId, btn) {
    await _downloadBlobWithButton(
        btn,
        `/api/test/results/${testId}/summary/csv`,
        `${testId}_summary.csv`,
        'Mengunduh ringkasan...',
        'success'
    );
}

function _confirmLargeFile(sizeMb, filePath) {
    return new Promise((resolve) => {
        const pathHtml = filePath
            ? `<p style="font-size:0.82rem;color:#6B7280;margin-top:8px;word-break:break-all">
                   Path server: <code>${filePath}</code>
               </p>`
            : '';
        document.getElementById('fileSizeWarningBody').innerHTML = `
            <p style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:10px;font-size:0.88rem;color:#92400E;margin-bottom:12px">
                Ukuran file: <strong>${sizeMb.toFixed(0)} MB</strong>
            </p>
            <p style="font-size:0.88rem;color:#374151;margin-bottom:4px">
                Mengunduh file sebesar ini via browser bisa memakan waktu lama dan berisiko gagal di tengah jalan.
            </p>
            <p style="font-size:0.88rem;color:#374151;margin-bottom:0">
                Disarankan: gunakan <strong>FileZilla</strong> untuk mengambil file langsung dari server.
            </p>
            ${pathHtml}
        `;

        const overlay   = document.getElementById('fileSizeWarningOverlay');
        const forceBtn  = document.getElementById('fileSizeWarningForceBtn');
        const cancelBtn = document.getElementById('fileSizeWarningCancelBtn');

        overlay.style.display = 'flex';

        function cleanup(result) {
            overlay.style.display = 'none';
            forceBtn.removeEventListener('click', onForce);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onForce()  { cleanup(true);  }
        function onCancel() { cleanup(false); }

        forceBtn.addEventListener('click', onForce,  { once: true });
        cancelBtn.addEventListener('click', onCancel, { once: true });
    });
}

async function _downloadCsvOrWarn(testId, sizeMb, filePath, btn = null) {
    if (sizeMb && sizeMb > LARGE_FILE_WARNING_MB) {
        const proceed = await _confirmLargeFile(sizeMb, filePath);
        if (!proceed) return false;
    }

    if (btn) {
        _setModalDownloadProgress(btn, 'Mengunduh CSV request...', 'warning');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Mengunduh...';
    }

    const dlResp = await fetch(`/api/test/results/${testId}/requests/csv`);
    const ct = dlResp.headers.get('content-type') || '';

    if (!dlResp.ok || !ct.includes('csv')) {
        let errMsg = `Server error ${dlResp.status}`;
        try {
            const j = await dlResp.json();
            errMsg = j.message || errMsg;
        } catch {}
        throw new Error(errMsg);
    }

    const blob = await dlResp.blob();
    triggerDownload(blob, `${testId}_requests.csv`);

    if (btn) {
        _setModalDownloadProgress(btn, 'Download selesai.', 'warning');
    }

    return true;
}

async function _handleModalRequestsCsv(testId, btn) {
    const orig = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Mengecek...';
    _setModalDownloadProgress(btn, 'Mengecek status CSV request...', 'warning');

    try {
        // Cek status dulu sebelum generate
        const statusResp = await fetch(`/api/test/results/${testId}/requests/csv/status`);
        const statusData = await statusResp.json();

        if (statusData.status === 'ready') {
            const ok = await _downloadCsvOrWarn(testId, statusData.size_mb, statusData.file_path, btn);
            if (ok) {
                btn.innerHTML = '✅ Selesai';
                setTimeout(() => {
                    btn.innerHTML = orig;
                    btn.disabled = false;
                    _hideModalDownloadProgress();
                }, 1500);
            } else {
                btn.innerHTML = orig;
                btn.disabled = false;
                _hideModalDownloadProgress();
            }
            return;
        }

        // Trigger generate
        _setModalDownloadProgress(btn, 'Memulai generate CSV request...', 'warning');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generate...';

        const genResp = await fetch(`/api/test/results/${testId}/requests/csv/generate`, { method: 'POST' });
        const genData = await genResp.json();

        if (genData.status === 'ready') {
            const ok = await _downloadCsvOrWarn(testId, genData.size_mb, genData.file_path, btn);
            if (ok) {
                btn.innerHTML = '✅ Selesai';
                setTimeout(() => {
                    btn.innerHTML = orig;
                    btn.disabled = false;
                    _hideModalDownloadProgress();
                }, 1500);
            } else {
                btn.innerHTML = orig;
                btn.disabled = false;
                _hideModalDownloadProgress();
            }
            return;
        }

        // Poll sampai selesai
        let elapsed = 0;
        for (let i = 0; i < 60; i++) {
            await sleep(3000);
            elapsed += 3;

            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...';
            _setModalDownloadProgress(
                btn,
                `Memproses CSV request... (${elapsed}s — biasanya 1–2 menit)`,
                'warning'
            );

            const pollResp = await fetch(`/api/test/results/${testId}/requests/csv/status`);
            const pollData = await pollResp.json();

            if (pollData.status === 'ready') {
                const ok = await _downloadCsvOrWarn(testId, pollData.size_mb, pollData.file_path, btn);
                if (ok) {
                    btn.innerHTML = '✅ Selesai';
                    setTimeout(() => {
                        btn.innerHTML = orig;
                        btn.disabled = false;
                        _hideModalDownloadProgress();
                    }, 1500);
                } else {
                    btn.innerHTML = orig;
                    btn.disabled = false;
                    _hideModalDownloadProgress();
                }
                return;
            }

            if (pollData.status === 'error') {
                throw new Error('Gagal generate CSV request.');
            }
        }

        throw new Error('Timeout: CSV belum selesai diproses.');

    } catch (e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig;
        btn.disabled = false;
        _hideModalDownloadProgress();
    }
}

// ==================== MULTI-PHASE HISTORY ====================

async function loadMultiPhaseHistory() {
    try {
        const resp = await fetch('/api/test/sessions');
        if (!resp.ok) throw new Error('Server error');
        const data = await resp.json();
        const sessions = data.sessions || [];
        _renderMultiHistoryTable(sessions);
        const countEl = document.getElementById('multiHistoryCount');
        if (countEl) countEl.textContent = sessions.length ? `${sessions.length} sesi tersimpan` : '';
    } catch(e) {
        const tbody = document.getElementById('multiHistoryTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-2">Gagal memuat riwayat multi-phase.</td></tr>';
    }
}

function _renderMultiHistoryTable(sessions) {
    const tbody = document.getElementById('multiHistoryTableBody');
    if (!tbody) return;

    if (!sessions.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-2">Belum ada riwayat multi-phase.</td></tr>';
        return;
    }

    tbody.innerHTML = sessions.map((s, idx) => {
        const waktu   = _fmtDateTime(s.completed_at);
        const target  = s.target_url || '--';
        const shortT  = target.length > 36 ? target.substring(0, 36) + '…' : target;
        const idsAttr = s.test_ids.join(',');
        return `<tr>
            <td><span class="badge bg-info text-dark">${s.phase_count} fase</span></td>
            <td title="${target}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortT}</td>
            <td style="white-space:nowrap;font-size:0.8rem">${waktu}</td>
            <td>
                <button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size:0.78rem"
                        onclick="_dlMultiSummary('${idsAttr}', this)">📊 Summary</button>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-warning py-0 px-2" style="font-size:0.78rem"
                        onclick="_dlMultiRequests('${idsAttr}', this)">📄 Requests</button>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:0.78rem"
                        onclick="_deleteMultiSession('${s.id}')" title="Hapus dari riwayat">✕</button>
            </td>
        </tr>`;
    }).join('');
}

async function _deleteMultiSession(sessionId) {
    try {
        await fetch(`/api/test/sessions/${sessionId}`, { method: 'DELETE' });
    } catch(e) {
        console.warn('Gagal hapus sesi:', e);
    }
    loadMultiPhaseHistory();
}

async function _dlMultiSummary(idsParam, btn) {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
        // Gunakan prepare→download agar nama file aktual dari server digunakan
        const prepResp = await fetch(`/api/test/results/summary/csv/merge-prepare?ids=${idsParam}`);
        if (!prepResp.ok) {
            let errMsg = `Server error ${prepResp.status}`;
            try { const j = await prepResp.json(); errMsg = j.message || errMsg; } catch {}
            throw new Error(errMsg);
        }
        const prepData = await prepResp.json();
        if (prepData.status === 'error') throw new Error(prepData.message);

        const dlResp = await fetch(`/api/test/results/merged/${encodeURIComponent(prepData.filename)}`);
        const dlCt   = dlResp.headers.get('content-type') || '';
        if (!dlResp.ok || (!dlCt.includes('csv') && !dlCt.includes('octet-stream'))) {
            let errMsg = `Server error ${dlResp.status}`;
            try { const j = await dlResp.json(); errMsg = j.message || errMsg; } catch {}
            throw new Error(errMsg);
        }
        triggerDownload(await dlResp.blob(), prepData.filename);
        btn.innerHTML = '✅';
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
    } catch(e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig; btn.disabled = false;
    }
}

async function _dlMultiRequests(idsParam, btn) {
    const ids  = idsParam.split(',');
    const orig = btn.innerHTML;
    btn.disabled = true;

    try {
        // 1. Generate + poll tiap fase
        for (let i = 0; i < ids.length; i++) {
            const testId = ids[i];
            const lbl    = `(${i + 1}/${ids.length})`;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${lbl}`;

            const genResp = await fetch(`/api/test/results/${testId}/requests/csv/generate`, { method: 'POST' });
            if (!genResp.ok) throw new Error(`Gagal generate fase ${i + 1}`);
            const genData = await genResp.json();
            if (genData.status === 'error') throw new Error(genData.message);

            let elapsed = 0;
            while (true) {
                await sleep(2000); elapsed += 2;
                const stResp = await fetch(`/api/test/results/${testId}/requests/csv/status`);
                if (!stResp.ok) continue;
                const stData = await stResp.json();
                if (stData.status === 'ready') break;
                if (stData.status === 'error') throw new Error(`Error generate fase ${i + 1}`);
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${elapsed}s ${lbl}`;
            }
        }

        // 2. Merge ke disk — dapat path & ukuran aktual
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Merge...';
        const prepResp = await fetch(`/api/test/results/requests/csv/merge-prepare?ids=${idsParam}`);
        if (!prepResp.ok) {
            let errMsg = `Server error ${prepResp.status}`;
            try { const j = await prepResp.json(); errMsg = j.message || errMsg; } catch {}
            throw new Error(errMsg);
        }
        const prepData = await prepResp.json();
        if (prepData.status === 'error') throw new Error(prepData.message);

        // 3. Dialog file besar (pakai overlay yang sama dengan halaman utama)
        if (prepData.size_mb > LARGE_FILE_WARNING_MB) {
            const proceed = await confirmLargeRequestCsv(prepData.size_mb, prepData.path);
            if (!proceed) { btn.innerHTML = orig; btn.disabled = false; return; }
        }

        // 4. Download file yang sudah ada di server
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Unduh...';
        const dlResp = await fetch(`/api/test/results/merged/${encodeURIComponent(prepData.filename)}`);
        const dlCt   = dlResp.headers.get('content-type') || '';
        if (!dlResp.ok || (!dlCt.includes('csv') && !dlCt.includes('octet-stream'))) {
            let errMsg = `Server error ${dlResp.status}`;
            try { const j = await dlResp.json(); errMsg = j.message || errMsg; } catch {}
            throw new Error(errMsg);
        }
        triggerDownload(await dlResp.blob(), prepData.filename);
        btn.innerHTML = '✅';
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);

    } catch(e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig; btn.disabled = false;
    }
}
