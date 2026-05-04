"""
routes/pages.py — Route halaman HTML

Melayani dua halaman utama dashboard:
  GET /           → Landing page (informasi sistem)
  GET /dashboard  → Halaman load testing & monitoring

Semua konfigurasi tampilan (preset URL, opsi thread, dll.)
diambil dari config.py dan dikirim ke template Jinja2.
"""

from flask import Blueprint, render_template
import config

pages_bp = Blueprint('pages', __name__)


@pages_bp.route('/')
def landing():
    """Tampilkan landing page dengan informasi server."""
    return render_template('landing.html', server_name=config.SERVER_NAME)


@pages_bp.route('/dashboard')
def dashboard():
    """
    Tampilkan halaman dashboard load testing.

    Mengirimkan konfigurasi awal (preset URL target, opsi thread,
    opsi durasi, dll.) ke template agar form langsung siap dipakai.
    """
    return render_template(
        'dashboard.html',
        server_name=config.SERVER_NAME,
        server_ip=config.SERVER_IP,
        server_hostname=config.SERVER_HOSTNAME,
        target_presets=config.TARGET_PRESETS,
        default_target=config.DEFAULT_TARGET_URL,
        thread_options=config.THREAD_OPTIONS,
        ramp_options=config.RAMP_TIME_OPTIONS,
        duration_options=config.DURATION_OPTIONS,
        http_path_options=config.HTTP_PATH_OPTIONS,
        default_threads=config.DEFAULT_NUM_THREADS,
        default_ramp=config.DEFAULT_RAMP_TIME,
        default_duration=config.DEFAULT_DURATION,
        refresh_interval=config.METRICS_REFRESH_INTERVAL,
        admin_password=config.ADMIN_PASSWORD,
        user_max_threads=config.USER_MAX_THREADS,
        user_max_duration=config.USER_MAX_DURATION,
        user_max_phases=config.USER_MAX_PHASES,
    )
