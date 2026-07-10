# composite_score.py
#
# The Composite Bottleneck Score (CBS): one 0-100 number per ticker that
# blends everything the system knows about a node's OWN bottleneck evidence:
#
#   transcript stress   (weight 0.50)  what management SAID on the call
#   XBRL gauge score    (weight 0.35)  what the balance sheet PROVES
#   customer concentration (0.15)      how levered the name is to few buyers
#
# Weights renormalize over the components a ticker actually has — a name with
# only transcript data is scored on that alone, honestly, rather than diluted
# by phantom zeros. Inputs and effective weights are stored per row (JSONB)
# so every score is auditable.
#
# Graph-inherited risk is deliberately NOT in the CBS: it is a property of a
# node's position, not its own evidence, and the dependency graph already
# visualizes it. CBS = intrinsic heat; the graph radiates it.
#
# Runs weekly right after xbrl_gauges.py (same workflow), snapshots to the
# composite_scores table keyed (ticker, as_of_date) so history accumulates,
# and sends a Telegram digest of meaningful movers (Δ ≥ 15 or crossing 70)
# vs the previous snapshot.
#
# Env vars:
#   DATABASE_URL                        required
#   TELEGRAM_BOT_TOKEN / _CHAT_ID       optional (digest skipped if unset)

import json
import os
from datetime import date

import psycopg2
import psycopg2.extras

from transcript_stress import connect_db, send_telegram

DATABASE_URL = os.environ.get("DATABASE_URL")

W_TRANSCRIPT = 0.50
W_GAUGE      = 0.35
W_CONC       = 0.15

ALERT_DELTA     = 15
BOTTLENECK_LINE = 70


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def compute_composite(transcript, gauge, concentration):
    """
    Weighted blend over AVAILABLE components (weights renormalized).
    Inputs are dicts or None:
      transcript:    {"score": 0-100, "direction": str}
      gauge:         {"backlog_score": 0-100 | None, "inventory_days_yoy": float | None}
      concentration: {"top_pct": float}   # % of revenue from largest customer
    Returns (composite | None, parts dict for the audit trail).
    """
    parts, total_w, total = {}, 0.0, 0.0

    if transcript and transcript.get("score") is not None:
        s = clamp(float(transcript["score"]), 0, 100)
        parts["transcript"] = {"score": s, "weight": W_TRANSCRIPT,
                               "direction": transcript.get("direction")}
        total += s * W_TRANSCRIPT
        total_w += W_TRANSCRIPT

    g_score = None
    if gauge:
        if gauge.get("backlog_score") is not None:
            g_score = clamp(float(gauge["backlog_score"]), 0, 100)
        elif gauge.get("inventory_days_yoy") is not None and gauge["inventory_days_yoy"] > 0:
            # No RPO disclosure — a sharp inventory build is the only balance-
            # sheet signal available; capped low since it's ambiguous alone.
            g_score = clamp(float(gauge["inventory_days_yoy"]), 0, 40)
    if g_score is not None:
        parts["gauge"] = {"score": g_score, "weight": W_GAUGE}
        total += g_score * W_GAUGE
        total_w += W_GAUGE

    if concentration and concentration.get("top_pct"):
        c = clamp(float(concentration["top_pct"]) * 1.5, 0, 100)
        parts["concentration"] = {"score": c, "weight": W_CONC,
                                  "top_pct": concentration["top_pct"]}
        total += c * W_CONC
        total_w += W_CONC

    if total_w == 0:
        return None, parts
    return round(total / total_w, 1), parts


# ── DATA LOADING ─────────────────────────────────────────

def load_signals(conn):
    """Latest signal per ticker from each source table → {ticker: {...}}."""
    signals = {}

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (ticker) ticker, stress_score, direction
            FROM transcript_stress
            ORDER BY ticker, fiscal_year DESC, fiscal_quarter DESC
        """)
        for ticker, score, direction in cur.fetchall():
            signals.setdefault(ticker, {})["transcript"] = {
                "score": float(score) if score is not None else None,
                "direction": direction,
            }

        cur.execute("""
            SELECT DISTINCT ON (ticker) ticker, backlog_score, inventory_days_yoy
            FROM xbrl_gauges
            ORDER BY ticker, as_of_date DESC
        """)
        for ticker, backlog, inv_yoy in cur.fetchall():
            signals.setdefault(ticker, {})["gauge"] = {
                "backlog_score": float(backlog) if backlog is not None else None,
                "inventory_days_yoy": float(inv_yoy) if inv_yoy is not None else None,
            }

        cur.execute("""
            SELECT ticker, MAX(pct) FROM customer_exposure
            WHERE basis = 'revenue' GROUP BY ticker
        """)
        for ticker, top_pct in cur.fetchall():
            signals.setdefault(ticker, {})["concentration"] = {
                "top_pct": float(top_pct) if top_pct is not None else None,
            }

    return signals


def load_previous(conn):
    """Most recent prior snapshot per ticker (for the movers digest)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (ticker) ticker, composite
            FROM composite_scores
            WHERE as_of_date < %s
            ORDER BY ticker, as_of_date DESC
        """, (date.today(),))
        return {t: float(c) for t, c in cur.fetchall() if c is not None}


# ── DATABASE ─────────────────────────────────────────────

BOOTSTRAP_SQL = """
    CREATE TABLE IF NOT EXISTS composite_scores (
        ticker               TEXT NOT NULL,
        as_of_date           DATE NOT NULL,
        composite            DOUBLE PRECISION,
        transcript_score     DOUBLE PRECISION,
        transcript_direction TEXT,
        gauge_score          DOUBLE PRECISION,
        concentration_score  DOUBLE PRECISION,
        components           JSONB,
        computed_at          TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (ticker, as_of_date)
    );
"""

UPSERT_SQL = """
    INSERT INTO composite_scores
        (ticker, as_of_date, composite, transcript_score, transcript_direction,
         gauge_score, concentration_score, components)
    VALUES %s
    ON CONFLICT (ticker, as_of_date) DO UPDATE SET
        composite            = EXCLUDED.composite,
        transcript_score     = EXCLUDED.transcript_score,
        transcript_direction = EXCLUDED.transcript_direction,
        gauge_score          = EXCLUDED.gauge_score,
        concentration_score  = EXCLUDED.concentration_score,
        components           = EXCLUDED.components,
        computed_at          = now();
"""


def _emoji(score):
    if score >= 70: return "🔴"
    if score >= 40: return "🟠"
    if score >= 15: return "🔵"
    return "🟢"


def build_movers_digest(previous, current):
    """Telegram blocks for meaningful CBS moves, hottest first."""
    blocks = []
    for ticker, comp in current.items():
        if comp is None:
            continue
        old = previous.get(ticker)
        if old is None:
            if comp < BOTTLENECK_LINE:
                continue  # brand-new score only alerts if already red-hot
            line = f"{_emoji(comp)} *{ticker}*  — → {comp:.0f}  (new)"
        else:
            delta = comp - old
            crossed = (old < BOTTLENECK_LINE <= comp) or (comp < BOTTLENECK_LINE <= old)
            if abs(delta) < ALERT_DELTA and not crossed:
                continue
            sign = "+" if delta >= 0 else ""
            line = f"{_emoji(comp)} *{ticker}*  {old:.0f} → {comp:.0f}  ({sign}{delta:.0f})"
        blocks.append((comp, line))
    blocks.sort(key=lambda x: -x[0])
    return [b for _, b in blocks]


# ── MAIN ─────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Composite Bottleneck Score ===")
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL not set.")

    conn = connect_db(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(BOOTSTRAP_SQL)
        conn.commit()

        signals = load_signals(conn)
        previous = load_previous(conn)
        print(f"{len(signals)} tickers with signals · {len(previous)} prior snapshots")

        today = date.today()
        rows, current = [], {}
        for ticker, s in sorted(signals.items()):
            composite, parts = compute_composite(
                s.get("transcript"), s.get("gauge"), s.get("concentration"))
            if composite is None:
                continue
            current[ticker] = composite
            rows.append((
                ticker, today, composite,
                parts.get("transcript", {}).get("score"),
                parts.get("transcript", {}).get("direction"),
                parts.get("gauge", {}).get("score"),
                parts.get("concentration", {}).get("score"),
                psycopg2.extras.Json(parts),
            ))

        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, UPSERT_SQL, rows, page_size=200)
        conn.commit()
        print(f"{len(rows)} composite scores snapshotted for {today}.")

        movers = build_movers_digest(previous, current)
        if movers and previous:
            print(f"{len(movers)} CBS mover(s) — sending Telegram digest.")
            header = (f"⬢ *Composite Bottleneck Score — {len(movers)} "
                      f"mover{'s' if len(movers) != 1 else ''}*\n"
                      f"_week of {today.isoformat()}_")
            send_telegram(header + "\n\n" + "\n".join(movers))
        elif not previous:
            print("First snapshot — baseline recorded, no digest.")
        else:
            print("No meaningful CBS moves — no digest sent.")
    finally:
        conn.close()

    print("=== Composite Bottleneck Score complete ===")
