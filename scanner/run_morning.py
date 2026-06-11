"""Morning pipeline orchestrator for GitHub Actions.

GitHub cron is UTC and can't follow US daylight saving, so the workflow
fires at both 12:30 and 13:30 UTC; this guard runs the pipeline only for
the fire that lands in the 8:00–9:15am ET window, and only on live trading
days (Yahoo's SPY calendar knows the holidays).

Then: premarket gappers scan -> TJL evaluation -> KV push + Telegram.
"""
import datetime
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from tjl_scan import fetch_stored_scan, spy_session  # noqa: E402


def local_pipeline_already_ran():
    """True if today's scan is already in KV — Wizzle's PC (the primary
    pipeline, 8:30am ET) ran first; this cloud run (8:40am ET) is the
    fallback for days the PC is asleep."""
    url = os.environ.get("GAP_SCANNER_URL")
    if not url:
        return False
    stored = fetch_stored_scan(url)
    today = datetime.date.today().isoformat()
    return bool(stored and stored.get("scanned_at", "")[:10] == today)


def guards_pass():
    if os.environ.get("FORCE_RUN"):
        print("FORCE_RUN set — skipping window/holiday guards")
        return True
    reg_start, _, gmtoffset = spy_session()
    now = time.time()

    # Holiday check: the next regular session must start within 2 hours
    # (at 8:30am ET, today's 9:30 open is 1h away; on a holiday the next
    # session is at least a day out, and after the open this is negative).
    if not (0 < reg_start - now < 2 * 3600):
        print("skip: not in the pre-open window of a live trading day "
              f"(reg_start={reg_start}, now={int(now)})")
        return False

    # DST disambiguation: of the two UTC fires, run only the 8:00-9:15am ET one
    et_seconds = (int(now) + gmtoffset) % 86400
    if not (8 * 3600 <= et_seconds <= 9 * 3600 + 15 * 60):
        print(f"skip: wrong DST fire (ET seconds-of-day {et_seconds})")
        return False
    return True


def main():
    if not guards_pass():
        return

    if not os.environ.get("FORCE_RUN") and local_pipeline_already_ran():
        print("skip: today's scan already in KV — local pipeline ran first; "
              "cloud fallback not needed")
        return

    print("running premarket gappers scan...")
    res = subprocess.run(["bash", str(HERE / "premarket_gappers.sh")], cwd=str(HERE))
    if res.returncode != 0:
        print(f"ERROR: gappers scan failed (exit {res.returncode})")
        sys.exit(1)

    print("running TJL evaluation...")
    res = subprocess.run([sys.executable, str(HERE / "tjl_scan.py")], cwd=str(HERE))
    sys.exit(res.returncode)


if __name__ == "__main__":
    main()
