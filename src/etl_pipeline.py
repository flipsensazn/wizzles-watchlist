import requests
import pandas as pd
import numpy as np
import psycopg2
import psycopg2.extras
import yfinance as yf
import time
import os
from datetime import date

# --- Credentials from environment variables (GitHub Secrets inject these) ---
DATABASE_URL = os.environ.get('DATABASE_URL')
SEC_HEADERS  = {'User-Agent': 'WizzlesWatchlist flipsensazn@gmail.com'}

# Batch size for yfinance downloads — 500 is the practical sweet spot.
# Too large and Yahoo silently drops tickers; too small and it's slow.
YF_BATCH_SIZE = 500


# ── PHASE 1: UNIVERSE GATING (yfinance) ──────────────────
#
# Strategy:
#   1. Fetch the full US ticker list + CIK map from SEC company_tickers.json
#      (same file used for fundamentals — free, no key, one call)
#   2. Pre-filter on symbol strings alone (no API calls)
#   3. Batch-download price + volume via yfinance.download() — 500 tickers/call,
#      no rate limit, full universe in ~20 batches taking ~5 minutes total
#   4. Call yfinance Ticker.fast_info only on the ~300-500 vol/price survivors
#      to get market cap + 52W range (lightweight, ~0.3s per ticker)
#
# Total runtime: ~30–45 minutes vs 6+ hours with Finnhub free tier.

def get_us_universe():
    """
    Fetch full US ticker list and CIK map from SEC in a single call.
    Reusing this for Phase 2 means zero duplicate network requests.
    """
    print("Fetching US universe + CIK map from SEC...")
    res = requests.get("https://www.sec.gov/files/company_tickers.json",
                       headers=SEC_HEADERS)
    res.raise_for_status()
    data    = res.json()
    tickers = [v['ticker'] for v in data.values()]
    cik_map = {v['ticker']: str(v['cik_str']).zfill(10) for v in data.values()}
    print(f"Found {len(tickers)} tickers in SEC universe.")
    return tickers, cik_map


def prefilter(symbols):
    """
    Pure string-based filters — no API calls.
    Cuts the raw ~12,000 symbol list down to ~7,000–8,000 before any fetch.
    """
    symbols = [s for s in symbols if '.' not in s]           # no dots (foreign/preferred)
    symbols = [s for s in symbols if len(s) <= 5]            # max 5 chars
    symbols = [s for s in symbols if len(s) >= 3]            # min 3 chars (no indices)
    junk_suffixes = ('W', 'R', 'U', 'Q', 'Z')                # warrants/rights/units/bankrupt
    symbols = [s for s in symbols if not s.endswith(junk_suffixes)]
    print(f"Pre-filtered to {len(symbols)} symbols.")
    return symbols


def batch_download(symbols):
    """
    Download 1-month daily OHLCV for all symbols in batches of 500.
    Returns dict: { ticker -> {'price': float, 'avg_dollar_vol': float} }
    """
    print(f"Batch downloading price/volume for {len(symbols)} symbols...")
    results = {}
    batches = [symbols[i:i + YF_BATCH_SIZE] for i in range(0, len(symbols), YF_BATCH_SIZE)]

    for batch_num, batch in enumerate(batches):
        print(f"  Batch {batch_num + 1}/{len(batches)} ({len(batch)} symbols)...")
        try:
            raw = yf.download(
                " ".join(batch),
                period="1mo",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )

            for ticker in batch:
                try:
                    if len(batch) == 1:
                        # Single-ticker download returns flat (non-MultiIndex) DataFrame
                        close  = raw["Close"].dropna()
                        volume = raw["Volume"].dropna()
                    else:
                        close  = raw[ticker]["Close"].dropna()
                        volume = raw[ticker]["Volume"].dropna()

                    if close.empty or volume.empty:
                        continue

                    price       = float(close.iloc[-1])
                    avg_vol_10d = float(volume.iloc[-10:].mean()) if len(volume) >= 10 else float(volume.mean())
                    dollar_vol  = price * avg_vol_10d

                    if price >= 2.0:
                        results[ticker] = {
                            'price':          price,
                            'avg_dollar_vol': dollar_vol,
                        }
                except Exception:
                    continue

        except Exception as e:
            print(f"  Batch {batch_num + 1} error: {e}")

        time.sleep(1)  # polite pause between batches

    print(f"Price/volume data retrieved for {len(results)} symbols.")
    return results


def apply_gates(symbols):
    """
    Two-stage gate:
      Gate 1 (batched): price >= $2 AND dollar volume >= $250K
      Gate 2 (per-ticker): $25M <= market cap <= $2B

    Returns DataFrame of candidates ready for SEC fundamentals.
    """
    symbols = prefilter(symbols)

    # Gate 1: price + volume — fast batched download
    price_vol  = batch_download(symbols)
    vol_passed = [s for s, v in price_vol.items() if v['avg_dollar_vol'] >= 250_000]
    print(f"{len(vol_passed)} symbols passed price/volume gate.")

    # Gate 2: market cap + 52W range via fast_info (called only on survivors)
    candidates = []
    print(f"Fetching market cap + 52W range for {len(vol_passed)} survivors...")

    for i, symbol in enumerate(vol_passed):
        try:
            fi = yf.Ticker(symbol).fast_info

            cap_m       = (fi.market_cap or 0) / 1_000_000
            week52_low  = fi.year_low  or 0
            week52_high = fi.year_high or 0
            price       = price_vol[symbol]['price']
            dollar_vol  = price_vol[symbol]['avg_dollar_vol']

            pct_above_52w_low = (
                round((price - week52_low) / week52_low * 100, 2)
                if week52_low > 0 else None
            )

            if 25 <= cap_m <= 2000:
                print(f"  PASSED: {symbol} | ${price:.2f} | ${cap_m:.0f}M")
                candidates.append({
                    'ticker':             symbol,
                    'price':              price,
                    'market_cap':         cap_m,
                    'avg_dollar_vol_20d': dollar_vol,
                    'week52_low':         week52_low,
                    'week52_high':        week52_high,
                    'pct_above_52w_low':  pct_above_52w_low,
                })

        except Exception as e:
            print(f"  fast_info error {symbol}: {e}")
            continue

        # Brief pause every 50 tickers to be a polite Yahoo consumer
        if i > 0 and i % 50 == 0:
            time.sleep(2)

    print(f"\n{len(candidates)} candidates passed all gates.")
    return pd.DataFrame(candidates)


# ── PHASE 2: SEC FUNDAMENTALS ────────────────────────────

def latest_gaap(facts, tags):
    """Returns the most recent value for the first matching GAAP tag."""
    gaap = facts.get('facts', {}).get('us-gaap', {})
    for tag in tags:
        if tag in gaap:
            try:
                units = sorted(gaap[tag]['units']['USD'],
                               key=lambda x: x['end'], reverse=True)
                if units:
                    return units[0]['val']
            except (KeyError, IndexError):
                continue
    return np.nan


def prev_year_gaap(facts, tags):
    """Returns the prior-year annual value (second most recent 10-K) for YoY calcs."""
    gaap = facts.get('facts', {}).get('us-gaap', {})
    for tag in tags:
        if tag in gaap:
            try:
                usd_units = gaap[tag]['units']['USD']
                annual = [u for u in usd_units if u.get('form') in ('10-K', '10-K/A')]
                if len(annual) >= 2:
                    annual_sorted = sorted(annual, key=lambda x: x['end'], reverse=True)
                    return annual_sorted[1]['val']
            except (KeyError, IndexError):
                continue
    return np.nan


def fetch_sec_fundamentals(df_candidates, cik_map):
    """
    Fetch XBRL fundamentals from SEC EDGAR for each candidate.
    cik_map is passed in from get_us_universe() — no second SEC fetch needed.
    """
    rows    = []
    tickers = df_candidates['ticker'].tolist()
    print(f"Fetching SEC fundamentals for {len(tickers)} candidates...")

    for ticker in tickers:
        cik = cik_map.get(ticker)
        if not cik:
            print(f"  No CIK for {ticker}, skipping.")
            continue
        try:
            res = requests.get(
                f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
                headers=SEC_HEADERS)
            if res.status_code != 200:
                continue
            facts = res.json()

            cfo               = latest_gaap(facts, ['NetCashProvidedByUsedInOperatingActivities'])
            capex             = latest_gaap(facts, ['PaymentsToAcquirePropertyPlantAndEquipment',
                                                    'PaymentsToAcquireProductiveAssets'])
            net_income        = latest_gaap(facts, ['NetIncomeLoss'])
            total_assets      = latest_gaap(facts, ['Assets'])
            book_equity       = latest_gaap(facts, ['StockholdersEquity', 'AssetsNet'])
            total_assets_prev = prev_year_gaap(facts, ['Assets'])
            total_debt        = latest_gaap(facts, ['LongTermDebt',
                                                    'LongTermDebtAndCapitalLeaseObligation',
                                                    'DebtAndCapitalLeaseObligations'])
            rev_tags = [
                'RevenueFromContractWithCustomerExcludingAssessedTax',
                'Revenues',
                'SalesRevenueNet',
                'RevenueFromContractWithCustomerIncludingAssessedTax',
            ]
            revenue_current = latest_gaap(facts, rev_tags)
            revenue_prev    = prev_year_gaap(facts, rev_tags)

            rows.append({
                'ticker':            ticker,
                'cfo':               cfo,
                'capex':             capex,
                'net_income':        net_income,
                'total_assets':      total_assets,
                'total_assets_prev': total_assets_prev,
                'book_equity':       book_equity,
                'total_debt':        total_debt,
                'revenue_current':   revenue_current,
                'revenue_prev':      revenue_prev,
            })
        except Exception as e:
            print(f"  SEC error {ticker}: {e}")

        time.sleep(0.15)  # SEC rate limit: 10 req/sec

    return pd.DataFrame(rows)


# ── PHASE 3: SCORING ─────────────────────────────────────

def score(df):
    df['fcf']            = df['cfo'] - df['capex'].abs()
    df['fcf_yield']      = df['fcf'] / (df['market_cap'] * 1_000_000)
    df['book_to_market'] = df['book_equity'] / (df['market_cap'] * 1_000_000)
    df['roa']            = df['net_income'] / df['total_assets']

    df['asset_growth_yoy'] = np.where(
        df['total_assets_prev'].notna() & (df['total_assets_prev'] != 0),
        (df['total_assets'] - df['total_assets_prev']) / df['total_assets_prev'].abs(),
        0.0
    )

    df['revenue_growth'] = np.where(
        df['revenue_prev'].notna() & (df['revenue_prev'] != 0),
        (df['revenue_current'] - df['revenue_prev']) / df['revenue_prev'].abs(),
        np.nan
    )

    # Relaxed ROA gate: allow down to -5% to keep near-profitable companies
    df = df[
        (df['fcf_yield'] > 0) &
        (df['book_to_market'] > 0) &
        (df['roa'] >= -0.05)
    ].copy()

    if df.empty:
        print("No candidates survived the scoring gates.")
        return df

    # Winsorize + percentile rank all 5 factors
    factors = ['fcf_yield', 'book_to_market', 'roa', 'asset_growth_yoy', 'revenue_growth']
    for factor in factors:
        col = df[factor].copy()
        if factor == 'revenue_growth':
            col = col.fillna(col.median())
        lo         = col.quantile(0.05)
        hi         = col.quantile(0.95)
        winsorized = col.clip(lower=lo, upper=hi)
        df[f'{factor}_rank_pct'] = winsorized.rank(pct=True)

    # Composite: FCF(35%) B/M(20%) ROA(15%) AssetGrowth(15%) RevGrowth(15%)
    df['composite_score'] = (
        0.35 * df['fcf_yield_rank_pct']        +
        0.20 * df['book_to_market_rank_pct']   +
        0.15 * df['roa_rank_pct']              +
        0.15 * df['asset_growth_yoy_rank_pct'] +
        0.15 * df['revenue_growth_rank_pct']
    )

    # Quality penalties
    df['quality_penalty'] = 0

    if 'total_debt' in df.columns:
        high_debt = (
            df['total_debt'].notna() &
            df['book_equity'].notna() &
            (df['book_equity'].abs() > 0) &
            (df['total_debt'] / df['book_equity'].abs() > 2.0)
        )
        df.loc[high_debt, 'quality_penalty'] += 1
        if high_debt.sum() > 0:
            print(f"  Quality penalty (high debt D/E>2): {high_debt.sum()} stocks")

    asset_bloat = (df['asset_growth_yoy'] > 0.20) & (df['fcf_yield'] < 0.03)
    df.loc[asset_bloat, 'quality_penalty'] += 1
    if asset_bloat.sum() > 0:
        print(f"  Quality penalty (asset bloat): {asset_bloat.sum()} stocks")

    microcap = df['market_cap'] < 30
    df.loc[microcap, 'quality_penalty'] += 1
    if microcap.sum() > 0:
        print(f"  Quality penalty (micro-cap <$30M): {microcap.sum()} stocks")

    df['composite_score'] = (df['composite_score'] - (df['quality_penalty'] * 0.05)).clip(lower=0)

    df['rank_overall'] = df['composite_score'].rank(ascending=False, method='min').astype(int)
    return df.sort_values('rank_overall')


# ── PHASE 4: DATABASE LOAD ───────────────────────────────

def load_to_db(df):
    print(f"Loading {len(df)} rows into Neon PostgreSQL...")

    migration_sql = """
        ALTER TABLE ranked_candidates
            ADD COLUMN IF NOT EXISTS quality_penalty     INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS revenue_growth      DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS pct_above_52w_low   DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS week52_low          DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS week52_high         DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS total_debt          DOUBLE PRECISION;
    """

    df['as_of_date'] = date.today()
    df_clean = df.replace({np.nan: None})

    col_map = [
        ('as_of_date',               'as_of_date'),
        ('ticker',                   'ticker'),
        ('market_cap',               'market_cap'),
        ('price',                    'price'),
        ('avg_dollar_vol_20d',       'avg_dollar_vol_20d'),
        ('cfo',                      'cfo_ttm'),
        ('capex',                    'capex_ttm'),
        ('fcf',                      'fcf_ttm'),
        ('net_income',               'net_income_ttm'),
        ('total_assets',             'total_assets_latest'),
        ('book_equity',              'book_equity_latest'),
        ('fcf_yield',                'fcf_yield'),
        ('book_to_market',           'book_to_market'),
        ('roa',                      'roa'),
        ('asset_growth_yoy',         'asset_growth_yoy'),
        ('fcf_yield_rank_pct',       'fcf_rank_pct'),
        ('book_to_market_rank_pct',  'bm_rank_pct'),
        ('roa_rank_pct',             'roa_rank_pct'),
        ('asset_growth_yoy_rank_pct','asset_growth_rank_pct'),
        ('composite_score',          'composite_score'),
        ('rank_overall',             'rank_overall'),
        ('quality_penalty',          'quality_penalty'),
        ('revenue_growth',           'revenue_growth'),
        ('pct_above_52w_low',        'pct_above_52w_low'),
        ('week52_low',               'week52_low'),
        ('week52_high',              'week52_high'),
        ('total_debt',               'total_debt'),
    ]

    active     = [(py, db) for py, db in col_map if py in df_clean.columns]
    py_cols    = [py for py, _ in active]
    db_cols    = [db for _, db in active]
    records    = [tuple(x) for x in df_clean[py_cols].to_numpy()]
    col_str    = ', '.join(db_cols)
    update_set = ', '.join([f"{db} = EXCLUDED.{db}"
                            for db in db_cols if db not in ('as_of_date', 'ticker')])

    insert_sql = f"""
        INSERT INTO ranked_candidates ({col_str})
        VALUES %s
        ON CONFLICT (as_of_date, ticker) DO UPDATE SET {update_set};
    """

    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        cur.execute(migration_sql)
        conn.commit()
        print("Schema migration complete.")
        psycopg2.extras.execute_values(cur, insert_sql, records, page_size=500)
        conn.commit()
        print("Database load successful.")
    except Exception as e:
        print(f"DB error: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


# ── MAIN ─────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Starting Weekly ETL ===")

    # Phase 1: universe + CIK map in one SEC call — no Finnhub needed
    raw_symbols, cik_map = get_us_universe()
    candidates = apply_gates(raw_symbols)

    if candidates.empty:
        print("No candidates passed gates — aborting.")
        exit(1)

    # Phase 2: SEC fundamentals (reuses cik_map from above — no second fetch)
    sec_data = fetch_sec_fundamentals(candidates, cik_map)
    merged   = pd.merge(candidates, sec_data, on='ticker', how='inner')

    # Phase 3: score + rank
    ranked = score(merged)

    if ranked.empty:
        print("No candidates survived scoring — aborting.")
        exit(1)

    print(f"\nTop 10 ranked:")
    print(ranked[['ticker', 'rank_overall', 'composite_score',
                  'fcf_yield', 'revenue_growth',
                  'quality_penalty', 'pct_above_52w_low']].head(10).to_string())

    # Phase 4: write to Neon
    load_to_db(ranked)
    print("=== ETL Complete ===")
