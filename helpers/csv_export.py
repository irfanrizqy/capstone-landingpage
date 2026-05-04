"""
helpers/csv_export.py — Generator CSV hasil load test JMeter

Modul ini mengubah payload JSON hasil test JMeter menjadi format CSV
yang rapi dengan satu baris per titik waktu (timeline).

Digunakan oleh: routes/csv.py (via proxy dari JMeter API)
"""

import csv
import io


def jmeter_results_to_tidy_rows(payload):
    """
    Ubah payload JSON hasil JMeter menjadi list baris CSV.

    Setiap baris mewakili satu titik waktu dalam timeline test.
    Kolom statistik ringkasan (avg RT, throughput, dll.) diulang di setiap baris
    agar mudah dianalisis per-detik di Excel/spreadsheet.

    Jika tidak ada data timeline, menghasilkan satu baris ringkasan saja.

    Args:
        payload (dict): Response JSON dari endpoint /api/load-test/results/<id>.

    Returns:
        list[dict]: List baris siap ditulis ke CSV.
    """
    rows = []
    if not isinstance(payload, dict):
        return rows

    summary  = payload.get("summary", {})
    timeline = summary.get("timeline", [])

    test_id            = payload.get("test_id") or summary.get("test_id")
    target_url         = payload.get("target_url") or summary.get("target_url")
    duration           = payload.get("duration") or summary.get("duration")
    total_requests     = summary.get("total_requests")
    success_requests   = summary.get("success_requests")
    error_requests     = summary.get("error_requests")
    error_rate         = summary.get("error_rate")
    throughput         = summary.get("throughput")
    bandwidth_received = summary.get("bandwidth_received")
    bandwidth_sent     = summary.get("bandwidth_sent")
    rt_avg             = summary.get("response_time_avg")
    rt_min             = summary.get("response_time_min")
    rt_max             = summary.get("response_time_max")
    rt_median          = summary.get("response_time_median")
    rt_90              = summary.get("response_time_90percentile")
    rt_95              = summary.get("response_time_95percentile")

    success_rate = None
    if total_requests not in (None, 0) and success_requests is not None:
        success_rate = round((success_requests / total_requests) * 100, 2)

    # Kolom statistik ringkasan — sama di semua baris
    base = {
        "test_id": test_id, "target_url": target_url, "duration_seconds": duration,
        "throughput_rps": throughput,
        "total_requests": total_requests, "success_requests": success_requests,
        "error_requests": error_requests, "error_rate_pct": error_rate,
        "success_rate_pct": success_rate,
        "bandwidth_received_kbps": bandwidth_received, "bandwidth_sent_kbps": bandwidth_sent,
        "response_time_avg_ms": rt_avg, "response_time_min_ms": rt_min,
        "response_time_max_ms": rt_max, "response_time_median_ms": rt_median,
        "response_time_90th_ms": rt_90, "response_time_95th_ms": rt_95,
    }

    if isinstance(timeline, list) and timeline:
        # Satu baris per detik sesuai data timeline
        for point in timeline:
            rows.append({
                **base,
                "timestamp_seconds": point.get("timestamp"),
                "timeline_response_time_ms": point.get("response_time"),
            })
    else:
        # Fallback: satu baris ringkasan tanpa data timeline
        rows.append({**base, "timestamp_seconds": None, "timeline_response_time_ms": None})

    return rows


def json_to_csv_text(payload):
    """
    Konversi payload JSON hasil JMeter menjadi string CSV dengan delimiter titik koma.

    Delimiter titik koma (;) dipakai agar file langsung terbaca per-kolom
    di Microsoft Excel versi Indonesia/regional.

    Args:
        payload (dict): Response JSON dari endpoint /api/load-test/results/<id>.

    Returns:
        str: Isi file CSV dalam bentuk string.
    """
    rows = jmeter_results_to_tidy_rows(payload)
    if not rows:
        rows = [{"message": "No data"}]

    fieldnames = [
        "test_id", "target_url", "duration_seconds",
        "timestamp_seconds", "timeline_response_time_ms",
        "throughput_rps", "total_requests", "success_requests", "error_requests",
        "error_rate_pct", "success_rate_pct",
        "bandwidth_received_kbps", "bandwidth_sent_kbps",
        "response_time_avg_ms", "response_time_min_ms", "response_time_max_ms",
        "response_time_median_ms", "response_time_90th_ms", "response_time_95th_ms",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, delimiter=';')
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()
