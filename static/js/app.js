/**
 * app.js — Entry point: inisialisasi semua komponen dashboard
 *
 * File ini hanya berisi DOMContentLoaded handler.
 * Semua logika ada di modul app-*.js yang di-load sebelumnya di dashboard.html.
 *
 * Urutan load (penting): app-state → app-admin → app-test → app-poll
 *                        → app-results → app-disk → app.js
 */

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loadTestForm');
    if (form) form.addEventListener('submit', handleStartSingleTest);
    const stopBtn = document.getElementById('stopTestBtn');
    if (stopBtn) stopBtn.addEventListener('click', handleStopTest);

    try { initCharts();        } catch(e) { console.error('initCharts:', e); }
    try { setupAdminModal();   } catch(e) { console.error('setupAdminModal:', e); }
    try { setupFormHandlers(); } catch(e) { console.error('setupFormHandlers:', e); }
    try { setupDownloads();    } catch(e) { console.error('setupDownloads:', e); }
    try { initPhases();        } catch(e) { console.error('initPhases:', e); }
    try { setupCleanupModal(); } catch(e) { console.error('setupCleanupModal:', e); }

    updateDiskBadge();
    setInterval(updateDiskBadge, 30000);
});
