/**
 * app-admin.js — Admin mode, kunci opsi form, dan konfigurasi mode tampilan
 *
 * Mengelola autentikasi admin, pembatasan opsi untuk user biasa,
 * dan peralihan mode Single Test / Multi-Phase.
 * Bergantung pada: app-state.js
 */

// ==================== ADMIN MODE ====================

/**
 * Pasang event listener untuk modal login Admin.
 *
 * Modal muncul ketika tombol "Admin" di header diklik.
 * Setelah password benar, admin mode diaktifkan dan semua batasan dibuka.
 * Menutup modal jika klik di luar area modal atau tekan Cancel.
 */
function setupAdminModal() {
    const overlay    = document.getElementById('adminModalOverlay');
    const toggleBtn  = document.getElementById('adminToggleBtn');
    const confirmBtn = document.getElementById('adminConfirmBtn');
    const cancelBtn  = document.getElementById('adminCancelBtn');
    const pwInput    = document.getElementById('adminPasswordInput');
    const errMsg     = document.getElementById('adminErrorMsg');

    toggleBtn.addEventListener('click', () => {
        if (isAdminMode) { setAdminMode(false); return; }
        overlay.classList.add('open');
        pwInput.value = '';
        errMsg.classList.remove('visible');
        setTimeout(() => pwInput.focus(), 100);
    });
    confirmBtn.addEventListener('click', () => {
        if (pwInput.value === ADMIN_PASSWORD) {
            overlay.classList.remove('open');
            setAdminMode(true);
        } else {
            errMsg.classList.add('visible');
            pwInput.value = '';
            pwInput.focus();
        }
    });
    cancelBtn.addEventListener('click', () => overlay.classList.remove('open'));
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
}

/**
 * Aktifkan atau nonaktifkan Admin Mode.
 *
 * Saat aktif: semua opsi form dibuka, notice user mode disembunyikan.
 * Saat nonaktif: opsi dikembalikan ke batas user, nilai yang melebihi batas direset.
 *
 * @param {boolean} active - true untuk aktifkan admin, false untuk logout admin
 */
function setAdminMode(active) {
    isAdminMode = active;
    document.getElementById('adminBadge').classList.toggle('visible', active);
    const btn = document.getElementById('adminToggleBtn');
    btn.classList.toggle('admin-active', active);
    btn.textContent = active ? 'Logout Admin' : 'Admin';

    const n = document.getElementById('userModeNotice');
    const m = document.getElementById('userModeNoticeMulti');
    if (active) {
        if (n) n.style.display = 'none';
        if (m) m.style.display = 'none';
        unlockOptions();
    } else {
        if (n) n.style.display = '';
        if (m) m.style.display = '';
        lockOptions();
        const customRow = document.getElementById('customInputsRow');
        if (customRow) customRow.style.display = 'none';
        document.getElementById('customThreadsDiv').style.display  = 'none';
        document.getElementById('customRampDiv').style.display     = 'none';
        document.getElementById('customDurationDiv').style.display = 'none';
        const t = document.getElementById('numThreads');
        const d = document.getElementById('duration');
        if (t && t.value === 'custom') t.value = '10';
        if (d && d.value === 'custom') d.value = '30';
        renderPhases();
    }
}

/**
 * Sembunyikan dan nonaktifkan opsi form yang nilainya melebihi batas user.
 *
 * Juga menangani kasus browser restore: jika nilai yang terpilih adalah
 * "custom" (non-angka) atau melebihi batas, otomatis pilih opsi valid pertama
 * agar form tidak dalam state tidak valid saat halaman dimuat ulang.
 *
 * Batas diambil dari USER_MAX_THREADS dan USER_MAX_DURATION (dari config.py).
 */
function lockOptions() {
    const applyLock = (id, max) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        Array.from(sel.options).forEach(o => {
            const v = parseInt(o.value);
            const lock = !isNaN(v) && v > max;
            o.disabled = lock;
            o.style.display = lock ? 'none' : '';
        });
        // Reset jika nilai saat ini melebihi max ATAU bukan angka (misal "custom" dari browser restore)
        const v = parseInt(sel.value);
        if (isNaN(v) || v > max) {
            const firstValid = Array.from(sel.options).find(o => !o.disabled && o.value !== 'custom');
            if (firstValid) sel.value = firstValid.value;
        }
    };
    applyLock('numThreads', USER_MAX_THREADS);
    applyLock('duration',   USER_MAX_DURATION);
}

/**
 * Buka kembali semua opsi form (digunakan saat Admin Mode aktif).
 *
 * Menampilkan semua opsi yang sebelumnya disembunyikan oleh lockOptions().
 */
function unlockOptions() {
    ['numThreads', 'duration'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        Array.from(sel.options).forEach(o => { o.disabled = false; o.style.display = ''; });
    });
}

// ==================== CONFIG MODE ====================

/**
 * Beralih antara tab Single Test dan Multi-Phase.
 *
 * Mengontrol visibilitas panel konfigurasi dan status tab aktif.
 *
 * @param {string} mode - 'single' atau 'multi'
 */
function switchConfigMode(mode) {
    configMode = mode;
    document.getElementById('tabSingle').classList.toggle('active', mode === 'single');
    document.getElementById('tabMulti').classList.toggle('active',  mode === 'multi');
    document.getElementById('singleTestPanel').style.display = mode === 'single' ? '' : 'none';
    document.getElementById('multiPhasePanel').style.display = mode === 'multi'  ? '' : 'none';
}

// ==================== FORM HANDLERS ====================

/**
 * Pasang semua event listener untuk interaksi form konfigurasi.
 *
 * Menangani:
 * - Klik preset URL target (mengisi field target URL otomatis)
 * - Perubahan select ke "custom" (menampilkan input manual untuk threads/ramp/duration)
 * - Memanggil lockOptions() di akhir untuk memastikan state awal sesuai mode user
 */
function setupFormHandlers() {
    document.querySelectorAll('.target-preset').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const url = e.target.dataset.url || e.target.closest('a').dataset.url;
            document.getElementById('targetUrl').value = url;
        });
    });

    const customRow = document.getElementById('customInputsRow');
    [
        ['numThreads', 'customThreadsDiv', 'customThreads'],
        ['rampTime',   'customRampDiv',    'customRamp'],
        ['duration',   'customDurationDiv','customDuration'],
    ].forEach(([selId, divId, inpId]) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        sel.addEventListener('change', () => {
            const div  = document.getElementById(divId);
            const show = sel.value === 'custom';
            div.style.display = show ? 'block' : 'none';
            if (show) {
                customRow.style.display = 'flex';
                document.getElementById(inpId)?.focus();
            } else {
                const anyOpen = ['customThreadsDiv','customRampDiv','customDurationDiv']
                    .some(d => document.getElementById(d)?.style.display === 'block');
                if (!anyOpen) customRow.style.display = 'none';
            }
        });
    });

    lockOptions();

    // Perbarui indikator jenis test & ringkasan waktu setiap kali nilai form berubah
    ['numThreads', 'rampTime', 'duration', 'customThreads', 'customRamp', 'customDuration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { updateTestTypeHint(); updateTimeSummaryHint(); });
    });
    updateTestTypeHint();
    updateTimeSummaryHint();
}
