/**
 * app-results.js — Pengambilan & tampilan hasil test, inisialisasi grafik
 *
 * Mengambil hasil dari JMeter API, menampilkan statistik di tabel,
 * dan memperbarui grafik response time serta success rate.
 * Bergantung pada: app-state.js
 */

// ==================== FETCH & DISPLAY RESULTS ====================

/**
 * Ambil dan proses hasil test dari API setelah test selesai.
 *
 * Dipanggil oleh pollStatus() saat status berubah menjadi 'completed'.
 * Guard `isFetchingResults` (di app-poll.js) mencegah pemanggilan ganda
 * dari beberapa tick setInterval yang hampir bersamaan.
 *
 * Untuk single test: langsung tampilkan hasil dan update grafik.
 * Untuk multi-phase: simpan timeline + summary fase ini ke state global,
 * lalu lanjut ke fase berikutnya via runPhase(), atau panggil
 * finishMultiPhase() jika semua fase sudah selesai.
 *
 * @param {boolean} isMulti - true jika ini bagian dari multi-phase test
 */
async function fetchResults(isMulti) {
    if (!currentTestId) return;
    try {
        const resp = await fetch(`/api/test/results/${currentTestId}`);
        const data = await resp.json();

        // Hasil belum siap (post-processing masih berjalan di server) — retry tiap 2 detik
        if (resp.status === 202 || data.status === 'processing') {
            updateStatus('pending', '⏳ Memproses hasil test, harap tunggu...');
            setBadge('Processing...', 'info');
            await sleep(2000);
            return fetchResults(isMulti);
        }

        if (!resp.ok || !data.summary) {
            if (!isMulti) {
                updateStatus('error', 'Gagal mengambil hasil.');
                return;
            }
            // Multi-fase: lanjut ke fase berikutnya walau hasil tidak tersedia
            currentPhaseIndex++;
            if (currentPhaseIndex < phases.length && isMultiPhaseMode) {
                updateStatus('running', `⚠️ Fase ${currentPhaseIndex} tidak ada hasil. Memulai Fase ${currentPhaseIndex + 1}...`);
                await sleep(1000);
                await runPhase(document.getElementById('targetUrl').value.trim());
            } else {
                updateChartMulti();
                displayMultiPhaseResults();
                finishMultiPhase();
            }
            return;
        }

        const summary = data.summary;

        if (isMulti) {
            // Catat indeks awal fase ini di timeline (untuk boundary)
            const phaseStartIdx = allPhasesTimeline.length;
            if (currentPhaseIndex > 0) {
                phaseBoundaryIndices.push({
                    idx:   phaseStartIdx,
                    label: `Fase ${currentPhaseIndex + 1}`
                });
            }

            // Tambah timeline fase ini dengan offset waktu AKTUAL
            let phaseActualDuration = parseInt(phases[currentPhaseIndex]?.duration) || 0;
            if (summary.timeline?.length > 0) {
                // Gunakan max timestamp aktual dari data (bukan durasi konfigurasi)
                const maxActual = Math.max(...summary.timeline.map(p => p.timestamp));
                if (maxActual > 0) phaseActualDuration = maxActual;

                summary.timeline.forEach(pt => {
                    allPhasesTimeline.push({
                        timestamp:     Math.round(pt.timestamp + completedPhasesMs),
                        response_time: pt.response_time,
                        phase:         currentPhaseIndex + 1
                    });
                });

                // Catat batas ramp-up fase ini di timeline gabungan
                const phaseRampTime = parseInt(phases[currentPhaseIndex]?.rampTime) || 0;
                if (phaseRampTime > 0) {
                    const absoluteRampEnd = phaseRampTime + completedPhasesMs;
                    const rampIdx = allPhasesTimeline.findIndex(p => p.timestamp >= absoluteRampEnd);
                    if (rampIdx > 0) {
                        rampBoundaryIndices.push({
                            idx:   rampIdx,
                            label: `F${currentPhaseIndex + 1} full load`
                        });
                    }
                }
            }

            // Kumpulkan summary fase ini
            allPhasesSummaries.push({ ...summary, phase: currentPhaseIndex + 1 });

            // Offset berikutnya = berdasarkan durasi AKTUAL data (bukan konfigurasi)
            // Tambah 1s buffer agar tidak overlap
            completedPhasesMs += phaseActualDuration + 1;
            currentPhaseIndex++;

            if (currentPhaseIndex < phases.length && isMultiPhaseMode) {
                // Update grafik parsial (tanpa hasil statistik)
                updateChartMulti();
                updateStatus('running', `✅ Fase ${currentPhaseIndex} selesai. Memulai Fase ${currentPhaseIndex + 1}...`);
                await sleep(1000);
                await runPhase(document.getElementById('targetUrl').value.trim());
            } else {
                // Semua fase selesai — tampilkan grafik final + hasil
                updateChartMulti();
                displayMultiPhaseResults();
                finishMultiPhase();
            }
        } else {
            displayResults(summary, false);
            if (summary.timeline?.length > 0) updateChartSingle(summary.timeline);
            updateStatus('completed', 'Test selesai.');
            setBadge('Completed', 'success');
        }
    } catch(err) { updateStatus('error', 'Error: ' + err.message); }
}

/**
 * Merge statistik semua fase dan tampilkan sebagai hasil akhir multi-phase.
 *
 * Menghitung nilai gabungan dari allPhasesSummaries:
 * - Sum: total_requests, success_requests, error_requests
 * - Weighted average (by total_requests): response_time_avg, bandwidth
 * - Min/max: response_time_min / response_time_max
 * - Max (konservatif): percentile 90 dan 95 dari semua fase
 * - Throughput: total request dibagi total durasi konfigurasi
 *
 * Setelah memanggil displayResults(), field target, duration, dan test_id
 * di-override agar menampilkan info multi-phase yang benar (bukan nilai fase terakhir).
 */
function displayMultiPhaseResults() {
    if (!allPhasesSummaries.length) return;

    // Merge statistik: rata-rata weighted, sum untuk total
    const totalReq  = allPhasesSummaries.reduce((s, p) => s + (p.total_requests   || 0), 0);
    const totalSucc = allPhasesSummaries.reduce((s, p) => s + (p.success_requests || 0), 0);
    const totalErr  = allPhasesSummaries.reduce((s, p) => s + (p.error_requests   || 0), 0);

    // Weighted average response time berdasarkan jumlah request
    const avgRT = totalReq > 0
        ? allPhasesSummaries.reduce((s, p) =>
            s + ((p.response_time_avg || 0) * (p.total_requests || 0)), 0) / totalReq
        : 0;

    const minRT   = Math.min(...allPhasesSummaries.map(p => p.response_time_min   || Infinity).filter(v => isFinite(v)));
    const maxRT   = Math.max(...allPhasesSummaries.map(p => p.response_time_max   || 0));
    const medianRT = allPhasesSummaries[Math.floor(allPhasesSummaries.length / 2)]?.response_time_median;
    const p90RT   = Math.max(...allPhasesSummaries.map(p => p.response_time_90percentile || 0));
    const p95RT   = Math.max(...allPhasesSummaries.map(p => p.response_time_95percentile || 0));
    const totalDur = phases.reduce((s, p) => s + (parseInt(p.duration) || 0), 0);
    const throughput = totalDur > 0 ? totalReq / totalDur : 0;

    const merged = {
        total_requests:             totalReq,
        success_requests:           totalSucc,
        error_requests:             totalErr,
        error_rate:                 totalReq > 0 ? (totalErr / totalReq) * 100 : 0,
        response_time_avg:          Math.round(avgRT * 10) / 10,
        response_time_min:          isFinite(minRT) ? minRT : 0,
        response_time_max:          maxRT,
        response_time_median:       medianRT,
        response_time_90percentile: p90RT,
        response_time_95percentile: p95RT,
        throughput,
        bandwidth_received:         allPhasesSummaries.reduce((s, p) => s + (p.bandwidth_received || 0), 0) / allPhasesSummaries.length,
        bandwidth_sent:             allPhasesSummaries.reduce((s, p) => s + (p.bandwidth_sent     || 0), 0) / allPhasesSummaries.length
    };

    // isPartial=true: kita set sendiri summary fields setelah ini agar tidak ditimpa
    displayResults(merged, true);
    document.getElementById('summaryTarget').textContent   = currentTestParams?.target_url || '--';
    document.getElementById('summaryDuration').textContent = totalDur + 's (multi-phase)';
    document.getElementById('summaryTestId').textContent   = allPhaseTestIds.join(', ');
}

/**
 * Render statistik test ke elemen DOM tabel hasil.
 *
 * Mengisi semua field hasil (RT avg/min/max/median/90p/95p, throughput,
 * total/success/error requests, success rate, bandwidth).
 *
 * Jika isPartial=false, juga mengisi field target URL, durasi, dan test ID
 * dari currentTestParams — untuk multi-phase, field ini diisi oleh caller
 * (displayMultiPhaseResults) setelah fungsi ini selesai.
 *
 * Selalu memperbarui donut chart success rate.
 *
 * @param {Object}  summary   - Objek statistik dari API atau yang sudah di-merge
 * @param {boolean} isPartial - true = jangan timpa field target/duration/testId
 */
function displayResults(summary, isPartial) {
    document.getElementById('resultsContent').style.display = 'block';

    const ms  = v => v != null ? `${v} ms` : '-- ms';
    const num = v => v != null ? v.toFixed(2) : '--';

    document.getElementById('rtAvg').textContent    = ms(summary.response_time_avg);
    document.getElementById('rtMin').textContent    = ms(summary.response_time_min);
    document.getElementById('rtMax').textContent    = ms(summary.response_time_max);
    document.getElementById('rtMedian').textContent = ms(summary.response_time_median);
    document.getElementById('rt90').textContent     = ms(summary.response_time_90percentile);
    document.getElementById('rt95').textContent     = ms(summary.response_time_95percentile);

    document.getElementById('throughput').textContent      = num(summary.throughput);
    document.getElementById('totalRequests').textContent   = summary.total_requests?.toLocaleString()   ?? '--';
    document.getElementById('successRequests').textContent = summary.success_requests?.toLocaleString() ?? '--';
    document.getElementById('errorRequests').textContent   = summary.error_requests?.toLocaleString()   ?? '--';

    const sr = summary.total_requests > 0
        ? ((summary.success_requests / summary.total_requests) * 100).toFixed(2) : '0.00';
    document.getElementById('successRate').textContent = sr;
    document.getElementById('errorRate').textContent   = summary.error_rate?.toFixed(2) ?? '--';

    document.getElementById('bandwidthReceived').textContent =
        summary.bandwidth_received != null ? summary.bandwidth_received.toFixed(2) : '0.00';
    document.getElementById('bandwidthSent').textContent =
        summary.bandwidth_sent != null ? summary.bandwidth_sent.toFixed(2) : '0.00';

    if (!isPartial) {
        document.getElementById('summaryTarget').textContent   =
            currentTestParams?.target_url || summary.target_url || '--';
        const dur = currentTestParams?.duration ?? summary.duration;
        document.getElementById('summaryDuration').textContent =
            (dur != null) ? dur + 's' : '--';
        document.getElementById('summaryTestId').textContent   = currentTestId || '--';
    }

    successRateChart.data.datasets[0].data = [
        summary.success_requests || 0,
        summary.error_requests   || 0
    ];
    successRateChart.update();
}

// ==================== CHARTS ====================

/**
 * Inisialisasi dua grafik Chart.js: line chart response time dan donut chart success rate.
 *
 * Line chart response time mendukung plugin custom `phaseBoundaries` yang menggambar
 * garis vertikal putus-putus di setiap batas antar fase multi-phase. Indeks batas
 * disimpan di chart._boundaries dan diisi oleh fetchResults() saat fase berganti.
 *
 * Dipanggil sekali saat DOMContentLoaded dari app.js.
 */
function initCharts() {
    const rtCtx = document.getElementById('responseTimeChart').getContext('2d');
    responseTimeChart = new Chart(rtCtx, {
        type: 'line',
        data: { labels: [], datasets: [{
            label: 'Response Time (ms)',
            data: [],
            borderColor: '#047857',
            backgroundColor: 'rgba(4,120,87,0.08)',
            borderWidth: 2, fill: true, tension: 0.4,
            pointRadius: 3, pointHoverRadius: 6,
            pointHoverBackgroundColor: '#047857',
            pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
        }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    backgroundColor: 'rgba(17,24,39,0.92)',
                    titleColor: '#A7F3D0', bodyColor: '#F9FAFB',
                    borderColor: '#047857', borderWidth: 1, padding: 10, cornerRadius: 8,
                    callbacks: {
                        title: items => `⏱ Waktu: ${items[0].label}`,
                        label: ctx   => ` Response Time: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1)+' ms' : 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Time (seconds)', color: '#6B7280', font: { size: 11 } },
                    grid: { display: false },
                    ticks: { color: '#6B7280', font: { size: 10 }, maxTicksLimit: 20, autoSkip: true }
                },
                y: {
                    title: { display: true, text: 'Response Time (ms)', color: '#6B7280', font: { size: 11 } },
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { color: '#6B7280', font: { size: 10 }, callback: v => v + ' ms' }
                }
            }
        },
        plugins: [{
            id: 'phaseBoundaries',
            afterDraw(chart) {
                const bounds = chart._boundaries;
                if (!bounds?.length) return;
                const { ctx, scales: { x, y } } = chart;
                ctx.save();
                bounds.forEach(({ idx, label, color, dash, labelOffset }) => {
                    if (idx <= 0 || idx >= chart.data.labels.length) return;
                    const xp = x.getPixelForValue(idx);
                    ctx.beginPath();
                    ctx.strokeStyle = color || 'rgba(4,120,87,0.75)';
                    ctx.lineWidth   = 1.5;
                    ctx.setLineDash(dash || [6,4]);
                    ctx.moveTo(xp, y.top);
                    ctx.lineTo(xp, y.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = color || '#047857';
                    ctx.font      = 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'left';
                    ctx.fillText(label, xp + 4, y.top + (labelOffset || 16));
                });
                ctx.restore();
            }
        }]
    });

    const srCtx = document.getElementById('successRateChart').getContext('2d');
    successRateChart = new Chart(srCtx, {
        type: 'doughnut',
        data: {
            labels: ['Success', 'Errors'],
            datasets: [{ data: [100,0], backgroundColor: ['#10B981','#EF4444'], borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const v = ctx.parsed || 0;
                            const t = ctx.dataset.data.reduce((a,b) => a+b, 0);
                            return `${ctx.label}: ${v.toLocaleString()} (${t>0?((v/t)*100).toFixed(1):0}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Reset grafik response time ke state kosong (tanpa data, tanpa boundary).
 *
 * Dipanggil saat test baru dimulai agar grafik dari test sebelumnya tidak terlihat.
 * Menggunakan mode 'none' untuk melewati animasi saat reset.
 */
function resetChart() {
    responseTimeChart.data.labels = [];
    responseTimeChart.data.datasets[0].data = [];
    responseTimeChart._boundaries = [];
    rampBoundaryIndices = [];
    responseTimeChart.update('none');
}

/**
 * Perbarui grafik response time dengan data timeline single test.
 *
 * Menghapus boundary (tidak ada pembatas fase untuk single test).
 *
 * @param {Array<{timestamp: number, response_time: number}>} timeline
 *   Data per-detik dari field summary.timeline di API hasil test
 */
function updateChartSingle(timeline) {
    responseTimeChart.data.labels = timeline.map(p => p.timestamp + 's');
    responseTimeChart.data.datasets[0].data = timeline.map(p => p.response_time);

    const rampTime = currentTestParams?.ramp_time || 0;
    if (rampTime > 0) {
        const rampIdx = timeline.findIndex(p => p.timestamp >= rampTime);
        responseTimeChart._boundaries = rampIdx > 0
            ? [{ idx: rampIdx, label: '↑ Beban penuh', color: 'rgba(107,114,128,0.85)', dash: [4,3] }]
            : [];
    } else {
        responseTimeChart._boundaries = [];
    }
    responseTimeChart.update();
}

/**
 * Perbarui grafik response time dengan data timeline gabungan semua fase.
 *
 * Membaca dari allPhasesTimeline (dibangun secara inkremental oleh fetchResults())
 * dan phaseBoundaryIndices untuk menggambar garis vertikal batas antar fase.
 * Dipanggil setelah tiap fase selesai (parsial) dan saat semua fase selesai (final).
 */
function updateChartMulti() {
    if (!allPhasesTimeline.length) return;

    responseTimeChart.data.labels = allPhasesTimeline.map(p => `${p.timestamp}s`);
    responseTimeChart.data.datasets[0].data = allPhasesTimeline.map(p => p.response_time);

    // Ramp-up boundaries (abu-abu, bawah) + Phase boundaries (hijau, atas)
    const rampBounds  = rampBoundaryIndices.map(b => ({
        ...b, color: 'rgba(107,114,128,0.85)', dash: [4,3], labelOffset: 32
    }));
    const phaseBounds = phaseBoundaryIndices.map(b => ({
        ...b, color: 'rgba(4,120,87,0.75)', dash: [6,4], labelOffset: 16
    }));
    responseTimeChart._boundaries = [...rampBounds, ...phaseBounds];
    responseTimeChart.update();
}
