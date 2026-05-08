/**
 * app-disk.js — Unduh hasil test (CSV/JSON) dan monitoring disk JMeter
 *
 * Menangani unduh laporan dalam format JSON dan CSV (dengan format Excel Indonesia),
 * memantau penggunaan disk VM JMeter, dan modal cleanup hasil lama.
 * Bergantung pada: app-state.js
 */

// ==================== DOWNLOAD CSV ====================

/**
 * Pasang event listener untuk tombol unduh laporan (JSON, CSV summary, CSV requests).
 *
 * Tombol JSON mengambil data mentah hasil test dari API dan mengunduhnya sebagai file .json.
 * Tombol CSV summary dan requests diteruskan ke downloadCsv() dengan tipe yang sesuai.
 *
 * Dipanggil sekali saat DOMContentLoaded dari app.js.
 */
function setupDownloads() {
    document.getElementById('downloadReportBtn').addEventListener('click', async (e) => {
        if (!currentTestId) return;
        const btn = e.currentTarget;
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Mengunduh...';
        try {
            const resp = await fetch(`/api/test/results/${currentTestId}`);
            if (!resp.ok) throw new Error('Server error ' + resp.status);
            const data = await resp.json();
            triggerDownload(
                new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}),
                `${currentTestId}.json`
            );
            btn.innerHTML = '✅ Berhasil';
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1200);
        } catch(e) {
            alert('Download gagal: ' + e.message);
            btn.innerHTML = orig; btn.disabled = false;
        }
    });

    document.getElementById('downloadSummaryCsvBtn').addEventListener('click',  (e) => downloadCsv('summary', e.currentTarget));
    document.getElementById('downloadRequestsCsvBtn').addEventListener('click', (e) => downloadRequestsCsvOnDemand(e.currentTarget));
}

/**
 * Unduh hasil test dalam format CSV (summary statistik atau requests per-detik).
 *
 * Mendukung dua mode:
 * - Single test: unduh langsung dari server (sudah ada BOM + sep=; untuk Excel Indonesia)
 * - Multi-phase: fetch tiap fase, merge menjadi satu CSV dengan kolom 'phase' di depan,
 *   dan tambahkan baris TOTAL di akhir untuk tipe 'summary'
 *
 * Baris TOTAL (hanya untuk summary multi-phase) menghitung:
 * - Sum: total_requests, success_requests, error_requests, duration_seconds
 * - Weighted average (by total_requests): throughput, bandwidth_received, bandwidth_sent, rt_avg
 * - Min/max: rt_min, rt_max dari semua fase
 * - '-' untuk kolom yang tidak bisa digabung (num_threads, ramp_time, timeline, rt_median, rt_90/95)
 * - Timestamps: start_time fase pertama, end_time fase terakhir
 *
 * Urutan kolom CSV JMeter (0-indexed):
 * test_id(0) status(1) target_url(2) num_threads(3) ramp_time(4) duration_seconds(5)
 * http_path(6) timestamp_seconds(7) timeline_rt(8) timeline_rps(9) total_req(10)
 * success(11) error(12) err_pct(13) suc_pct(14) throughput(15) bw_recv(16) bw_sent(17)
 * rt_avg(18) rt_min(19) rt_max(20) rt_median(21) rt_90(22) rt_95(23) start_time(24) end_time(25)
 *
 * @param {'summary'|'requests'} type - Tipe CSV yang diunduh
 * @param {HTMLElement}          btn  - Tombol yang diklik (untuk feedback loading/done)
 */
async function downloadCsv(type, btn) {
    const ids = allPhaseTestIds.length > 0 ? allPhaseTestIds : (currentTestId ? [currentTestId] : []);
    if (!ids.length) { alert('Belum ada test selesai.'); return; }

    const ep   = type === 'summary' ? 'summary/csv' : 'requests/csv';
    const orig = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Mengunduh...';

    try {
        if (ids.length === 1) {
            // Single test — download langsung dari server (sudah ada sep=; dan BOM)
            const resp = await fetch(`/api/test/results/${ids[0]}/${ep}`);
            if (!resp.ok) throw new Error('Server error ' + resp.status);
            triggerDownload(await resp.blob(), `${ids[0]}_${type}.csv`);
            btn.innerHTML = '✅ Berhasil';
        } else {
            // Multi-phase — fetch tiap fase, merge jadi 1 CSV, tambah baris TOTAL
            let header = null;
            const rows = [];
            const phaseSummaries = []; // data per-fase untuk perhitungan baris TOTAL

            for (let i = 0; i < ids.length; i++) {
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Fase ${i+1}/${ids.length}...`;
                const resp = await fetch(`/api/test/results/${ids[i]}/${ep}`);
                if (!resp.ok) { console.warn(`Fase ${i+1} skip`); continue; }

                let text = await resp.text();
                // Bersihkan BOM ganda yang kadang muncul dari server
                text = text.replace(/^﻿/, '').replace(/^﻿/, '');
                const lines = text.split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('sep='));
                if (lines.length < 2) continue;

                if (!header) header = `phase;${lines[0]}`;
                lines.slice(1).forEach(row => rows.push(`fase_${i+1};${row}`));

                // Ekstrak statistik dari baris data pertama (nilai summary sama di semua baris)
                if (type === 'summary') {
                    const c = lines[1].split(';');
                    const rtMin = parseFloat(c[19]);
                    phaseSummaries.push({
                        test_id:          c[0]  || '',
                        target_url:       c[2]  || '',
                        http_path:        c[6]  || '',
                        duration_seconds: parseInt(c[5])    || 0,
                        total_requests:   parseInt(c[10])   || 0,
                        success_requests: parseInt(c[11])   || 0,
                        error_requests:   parseInt(c[12])   || 0,
                        throughput:       parseFloat(c[15]) || 0,
                        bw_received:      parseFloat(c[16]) || 0,
                        bw_sent:          parseFloat(c[17]) || 0,
                        rt_avg:           parseFloat(c[18]) || 0,
                        rt_min:           (rtMin > 0) ? rtMin : Infinity,
                        rt_max:           parseFloat(c[20]) || 0,
                        start_time:       c[24] || '',
                        end_time:         c[25] || '',
                    });
                }
            }

            if (!header) { alert('Tidak ada data CSV.'); btn.innerHTML = orig; btn.disabled = false; return; }

            // Hitung dan tambah baris TOTAL di akhir CSV summary
            if (type === 'summary' && phaseSummaries.length > 1) {
                const totalReq  = phaseSummaries.reduce((s, p) => s + p.total_requests,   0);
                const totalSuc  = phaseSummaries.reduce((s, p) => s + p.success_requests, 0);
                const totalErr  = phaseSummaries.reduce((s, p) => s + p.error_requests,   0);
                const totalDur  = phaseSummaries.reduce((s, p) => s + p.duration_seconds, 0);
                const errPct    = totalReq > 0 ? (totalErr / totalReq * 100).toFixed(2) : '0.00';
                const sucPct    = totalReq > 0 ? (totalSuc / totalReq * 100).toFixed(2) : '100.00';

                // Throughput keseluruhan = total request dibagi total durasi konfigurasi
                const throughput = totalDur > 0 ? (totalReq / totalDur).toFixed(2) : '0.00';

                // Bandwidth & RT avg: rata-rata tertimbang berdasarkan jumlah request tiap fase
                const bwRecv = totalReq > 0
                    ? (phaseSummaries.reduce((s,p) => s + p.bw_received * p.total_requests, 0) / totalReq).toFixed(2)
                    : '0.00';
                const bwSent = totalReq > 0
                    ? (phaseSummaries.reduce((s,p) => s + p.bw_sent * p.total_requests, 0) / totalReq).toFixed(2)
                    : '0.00';
                const rtAvg = totalReq > 0
                    ? (phaseSummaries.reduce((s,p) => s + p.rt_avg * p.total_requests, 0) / totalReq).toFixed(2)
                    : '0.00';

                const rtMin = Math.min(...phaseSummaries.map(p => p.rt_min).filter(v => isFinite(v)));
                const rtMax = Math.max(...phaseSummaries.map(p => p.rt_max));

                const totalRow = [
                    'TOTAL',
                    phaseSummaries.map(p => p.test_id).join(' + '),
                    'completed',
                    phaseSummaries[0].target_url,
                    '-',       // num_threads — berbeda tiap fase
                    '-',       // ramp_time
                    totalDur,
                    phaseSummaries[0].http_path,
                    '-',       // timestamp_seconds (data per-detik, tidak berlaku untuk total)
                    '-',       // timeline_response_time_ms
                    '-',       // timeline_throughput_rps
                    totalReq,
                    totalSuc,
                    totalErr,
                    errPct,
                    sucPct,
                    throughput,
                    bwRecv,
                    bwSent,
                    rtAvg,
                    isFinite(rtMin) ? rtMin : '-',
                    rtMax,
                    '-',       // rt_median — tidak bisa digabung tanpa data raw
                    '-',       // rt_90th
                    '-',       // rt_95th
                    phaseSummaries[0].start_time,
                    phaseSummaries[phaseSummaries.length - 1].end_time,
                ].join(';');

                rows.push(''); // baris kosong sebagai pemisah visual sebelum TOTAL
                rows.push(totalRow);
            }

            const csv  = `sep=;\n${header}\n${rows.join('\n')}`;
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            triggerDownload(blob, `multiphase_${ids[0]}_${type}.csv`);
            btn.innerHTML = '✅ Berhasil';
        }
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1200);
    } catch(e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig; btn.disabled = false;
    }
}

/**
 * Download request-level CSV secara on-demand.
 * Klik tombol → generate di server → progress bar → otomatis download saat siap.
 */
async function downloadRequestsCsvOnDemand(btn) {
    const ids = allPhaseTestIds.length > 0 ? allPhaseTestIds : (currentTestId ? [currentTestId] : []);
    if (!ids.length) { alert('Belum ada test selesai.'); return; }

    const orig = btn.innerHTML;
    btn.disabled = true;

    // Buat atau tampilkan progress bar
    let progressEl = document.getElementById('csvGenerateProgress');
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'csvGenerateProgress';
        progressEl.style.cssText = 'margin-top:6px;';
        progressEl.innerHTML =
            '<div class="progress" style="height:5px;">' +
              '<div class="progress-bar progress-bar-striped progress-bar-animated bg-warning" role="progressbar" style="width:100%"></div>' +
            '</div>' +
            '<small id="csvGenerateMsg" class="text-muted" style="font-size:0.75rem;"></small>';
        btn.parentNode.insertBefore(progressEl, btn.nextSibling);
    }
    progressEl.style.display = 'block';
    const msgEl = document.getElementById('csvGenerateMsg');
    const setMsg = (txt) => { if (msgEl) msgEl.textContent = txt; };

    try {
        if (ids.length === 1) {
            // Single test — generate → poll → download langsung
            setMsg('Memulai pemrosesan CSV...');
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...';
            const genResp = await fetch(`/api/test/results/${ids[0]}/requests/csv/generate`, { method: 'POST' });
            if (!genResp.ok) throw new Error('Gagal mulai generate');
            const genData = await genResp.json();
            if (genData.status === 'error') throw new Error(genData.message);

            let elapsed = 0;
            while (true) {
                await sleep(2000); elapsed += 2;
                const stResp = await fetch(`/api/test/results/${ids[0]}/requests/csv/status`);
                if (!stResp.ok) continue;
                const stData = await stResp.json();
                if (stData.status === 'ready') break;
                if (stData.status === 'error') throw new Error('Server error saat generate CSV');
                setMsg(`Memproses log request... (${elapsed}s — biasanya 1–2 menit)`);
            }

            setMsg('Mengunduh CSV...');
            const dlResp = await fetch(`/api/test/results/${ids[0]}/requests/csv`);
            if (!dlResp.ok) throw new Error('Gagal unduh CSV');
            triggerDownload(await dlResp.blob(), `${ids[0]}_requests.csv`);

        } else {
            // Multi-phase — generate+poll semua fase, fetch text, merge jadi 1 CSV
            const phaseTexts = [];

            for (let i = 0; i < ids.length; i++) {
                const testId = ids[i];
                const phaseLabel = ` (fase ${i+1}/${ids.length})`;

                // 1. Generate
                setMsg(`Memulai pemrosesan${phaseLabel}...`);
                btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Memproses${phaseLabel}...`;
                const genResp = await fetch(`/api/test/results/${testId}/requests/csv/generate`, { method: 'POST' });
                if (!genResp.ok) throw new Error(`Gagal mulai generate${phaseLabel}`);
                const genData = await genResp.json();
                if (genData.status === 'error') throw new Error(genData.message);

                // 2. Poll hingga ready
                let elapsed = 0;
                while (true) {
                    await sleep(2000); elapsed += 2;
                    const stResp = await fetch(`/api/test/results/${testId}/requests/csv/status`);
                    if (!stResp.ok) continue;
                    const stData = await stResp.json();
                    if (stData.status === 'ready') break;
                    if (stData.status === 'error') throw new Error(`Server error saat generate CSV${phaseLabel}`);
                    setMsg(`Memproses log request${phaseLabel}... (${elapsed}s — biasanya 1–2 menit)`);
                }

                // 3. Ambil teks CSV (belum download)
                setMsg(`Mengambil data${phaseLabel}...`);
                const dlResp = await fetch(`/api/test/results/${testId}/requests/csv`);
                if (!dlResp.ok) throw new Error(`Gagal ambil CSV${phaseLabel}`);
                phaseTexts.push(await dlResp.text());
            }

            // 4. Merge semua fase menjadi 1 CSV dengan kolom phase di depan
            setMsg('Menggabungkan semua fase...');
            let header = null;
            const rows = [];
            for (let i = 0; i < phaseTexts.length; i++) {
                const lines = phaseTexts[i]
                    .replace(/^﻿/, '')
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('sep='));
                if (lines.length < 2) continue;
                if (!header) header = `phase;${lines[0]}`;
                lines.slice(1).forEach(row => rows.push(`fase_${i+1};${row}`));
            }
            if (!header) throw new Error('Tidak ada data CSV.');

            const csv  = `sep=;\n${header}\n${rows.join('\n')}`;
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            triggerDownload(blob, `multiphase_${ids[0]}_requests.csv`);
        }

        btn.innerHTML = '✅ Berhasil';
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);

    } catch(e) {
        alert('Download gagal: ' + e.message);
        btn.innerHTML = orig;
        btn.disabled = false;
    } finally {
        if (progressEl) progressEl.style.display = 'none';
    }
}

/**
 * Picu unduhan file dari Blob secara programatik ke browser pengguna.
 *
 * Membuat elemen <a> sementara, menge-klik, lalu langsung menghapusnya dari DOM.
 * Object URL dicabut setelah klik untuk membebaskan memori browser.
 *
 * @param {Blob}   blob     - Data file yang akan diunduh
 * @param {string} filename - Nama file yang disarankan ke browser
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== DISK MONITORING & CLEANUP ====================

/**
 * Ambil status disk VM JMeter dan perbarui badge di footer dashboard.
 *
 * Warna badge menyesuaikan tingkat penggunaan:
 * - ≥90%: merah (kritis, segera cleanup)
 * - 75–89%: kuning (peringatan)
 * - <75%: hijau (aman)
 *
 * Dipanggil sekali saat halaman load dan setiap 30 detik oleh setInterval di app.js.
 * Badge hanya bisa diklik untuk membuka modal cleanup jika isAdminMode aktif.
 */
async function updateDiskBadge() {
    const badge = document.getElementById('footerDisk');
    if (!badge) return;
    try {
        const resp = await fetch('/api/jmeter/disk');
        if (!resp.ok) throw new Error('fail');
        const d = await resp.json();
        const pct = d.disk_usage_pct;
        badge.textContent = `💾 Disk JMeter: ${pct}% (${d.disk_free_gb}GB free)`;
        badge.style.cursor = isAdminMode ? 'pointer' : 'default';
        if (pct >= 90) {
            badge.style.background = 'linear-gradient(135deg,#DC2626,#EF4444)';
            badge.title = `⚠️ KRITIS: Disk hampir penuh! ${d.results_count} hasil test tersimpan (${d.results_size_mb}MB). Klik untuk bersihkan.`;
        } else if (pct >= 75) {
            badge.style.background = 'linear-gradient(135deg,#D97706,#F59E0B)';
            badge.title = `⚠️ Disk mulai penuh. Klik untuk bersihkan.`;
        } else {
            badge.style.background = 'linear-gradient(135deg,var(--green-700),var(--green-500))';
            badge.title = `Disk aman. ${d.results_count} hasil test, ${d.results_size_mb}MB. Klik untuk bersihkan.`;
        }
    } catch(e) {
        badge.textContent = '💾 Disk JMeter: --';
        badge.style.background = '#6c757d';
        badge.title = 'Tidak bisa cek disk';
    }
}

/**
 * Cek disk JMeter setelah test gagal dan tampilkan pesan yang tepat.
 *
 * Jika disk ≥85% atau sisa ruang <1GB: tampilkan pesan error spesifik tentang
 * disk penuh, dan (jika Admin) tambahkan tombol cleanup inline di bawah kotak status.
 * Jika disk masih aman: tampilkan pesan generik bahwa test gagal.
 *
 * Dipanggil oleh pollStatus() (app-poll.js) saat status test berubah menjadi 'failed'.
 */
async function checkDiskOnFailure() {
    try {
        const resp = await fetch('/api/jmeter/disk');
        if (!resp.ok) return;
        const d = await resp.json();
        if (d.disk_usage_pct >= 85 || d.disk_free_gb < 1) {
            updateStatus('error',
                `❌ Test gagal — Disk JMeter hampir penuh (${d.disk_usage_pct}%, sisa ${d.disk_free_gb}GB). Klik tombol di bawah untuk bersihkan.`
            );
            // Tampilkan tombol cleanup inline (hanya admin)
            if (isAdminMode) {
                const statusEl = document.getElementById('testStatusSection');
                if (statusEl && !document.getElementById('inlineCleanupBtn')) {
                    const btn = document.createElement('button');
                    btn.id        = 'inlineCleanupBtn';
                    btn.className = 'btn btn-sm btn-danger mt-2';
                    btn.innerHTML = '🗑️ Bersihkan Disk JMeter Sekarang';
                    btn.onclick   = openCleanupModal;
                    statusEl.appendChild(btn);
                }
            }
        } else {
            updateStatus('error', '❌ Test gagal. Periksa log JMeter di VM-6 untuk detail.');
        }
    } catch(e) {
        updateStatus('error', '❌ Test gagal. Tidak bisa memeriksa penyebab.');
    }
}

/**
 * Buka modal cleanup disk JMeter.
 *
 * Hanya bisa diakses oleh Admin — jika user biasa mencoba, tampilkan alert penolakan.
 * Setelah modal terbuka, langsung muat info disk terkini via loadCleanupDiskInfo()
 * agar admin melihat kondisi disk terbaru sebelum memutuskan berapa test yang disimpan.
 */
function openCleanupModal() {
    if (!isAdminMode) {
        alert('⚠️ Fitur ini hanya tersedia untuk Admin.\nLogin sebagai Admin terlebih dahulu.');
        return;
    }
    const overlay = document.getElementById('cleanupModalOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    loadCleanupDiskInfo();
}

/**
 * Muat dan tampilkan info disk terkini di dalam modal cleanup.
 *
 * Menampilkan persentase penggunaan, ruang bebas, total kapasitas disk,
 * dan jumlah/ukuran hasil test yang tersimpan.
 * Warna background info menyesuaikan tingkat penggunaan (merah/kuning/hijau).
 */
async function loadCleanupDiskInfo() {
    const infoEl = document.getElementById('cleanupDiskInfo');
    try {
        const resp = await fetch('/api/jmeter/disk');
        const d    = await resp.json();
        const color = d.disk_usage_pct >= 90 ? '#FEE2E2' :
                      d.disk_usage_pct >= 75 ? '#FEF3C7' : '#D1FAE5';
        const textColor = d.disk_usage_pct >= 90 ? '#991B1B' :
                          d.disk_usage_pct >= 75 ? '#92400E' : '#065F46';
        infoEl.style.background  = color;
        infoEl.style.color       = textColor;
        infoEl.innerHTML = `
            <strong>📊 Status Disk VM-6 (JMeter)</strong><br>
            Penggunaan: <strong>${d.disk_usage_pct}%</strong> &nbsp;|&nbsp;
            Bebas: <strong>${d.disk_free_gb} GB</strong> &nbsp;|&nbsp;
            Total: <strong>${d.disk_total_gb} GB</strong><br>
            Hasil test tersimpan: <strong>${d.results_count} test</strong>
            (~${d.results_size_mb} MB)
        `;
    } catch(e) {
        infoEl.textContent = 'Tidak bisa memuat info disk.';
    }
}

/**
 * Pasang event listener untuk modal cleanup disk JMeter.
 *
 * Menangani:
 * - Klik Cancel / area di luar modal → tutup modal
 * - Klik Confirm → validasi input jumlah test yang disimpan (min 1),
 *   kirim POST /api/jmeter/cleanup, tampilkan hasil via alert
 *
 * Setelah cleanup berhasil: hapus tombol inline cleanup jika ada,
 * refresh badge disk di footer, dan tampilkan ringkasan (dihapus/dibebaskan/tersisa).
 *
 * Dipanggil sekali saat DOMContentLoaded dari app.js.
 */
function setupCleanupModal() {
    const overlay    = document.getElementById('cleanupModalOverlay');
    const confirmBtn = document.getElementById('cleanupConfirmBtn');
    const cancelBtn  = document.getElementById('cleanupCancelBtn');
    const errMsg     = document.getElementById('cleanupErrorMsg');
    if (!overlay) return;

    cancelBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });

    confirmBtn.addEventListener('click', async () => {
        const keep = parseInt(document.getElementById('cleanupKeepInput').value);
        if (isNaN(keep) || keep < 1) {
            errMsg.textContent = 'Masukkan angka minimal 1.';
            errMsg.classList.add('visible'); return;
        }
        errMsg.classList.remove('visible');

        const origText   = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menghapus...';

        try {
            const resp = await fetch('/api/jmeter/cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keep })
            });
            const data = await resp.json();

            if (data.status === 'success') {
                // Hapus tombol inline cleanup jika ada
                const inlineBtn = document.getElementById('inlineCleanupBtn');
                if (inlineBtn) inlineBtn.remove();

                overlay.classList.remove('open');
                // Refresh disk badge
                updateDiskBadge();
                // Tampilkan hasil
                alert(`✅ Berhasil!\n\nDihapus: ${data.deleted_count} test hasil lama\nDibebaskan: ${data.freed_mb} MB\nDisimpan: ${data.kept_count} test terbaru\n\nDisk sekarang: ${data.disk_usage_pct}% (sisa ${data.disk_free_gb} GB)`);
            } else {
                errMsg.textContent = 'Gagal: ' + (data.message || 'Unknown error');
                errMsg.classList.add('visible');
            }
        } catch(e) {
            errMsg.textContent = 'Error: ' + e.message;
            errMsg.classList.add('visible');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = origText;
        }
    });
}
