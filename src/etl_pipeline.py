import requests
import pandas as pd
import numpy as np
import psycopg2
import psycopg2.extras
import time
import os
from datetime import date

# --- Credentials from environment variables (GitHub Secrets inject these) ---
FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY')
DATABASE_URL    = os.environ.get('DATABASE_URL')
FINNHUB_BASE    = 'https://finnhub.io/api/v1'
SEC_HEADERS     = {'User-Agent': 'WizzlesWatchlist flipsensazn@gmail.com'}


# ── PHASE 1: FINNHUB UNIVERSE GATING ─────────────────────
def get_us_universe():
    print("Fetching US symbol universe...")
    res = requests.get(f"{FINNHUB_BASE}/stock/symbol",
                       params={'exchange': 'US', 'token': FINNHUB_API_KEY})
    res.raise_for_status()
    symbols = res.json()
    common = [s['symbol'] for s in symbols if s.get('type') == 'Common Stock']
    print(f"Found {len(common)} common stocks.")
    return common


def apply_gates(symbols):
    candidates = []
    # Strip symbols with dots (ETFs, foreign ordinaries) to cut ~4000 irrelevant tickers
    symbols = [s for s in symbols if '.' not in s and len(s) <= 5]
    for i, symbol in enumerate(symbols):
        try:
            quote = requests.get(f"{FINNHUB_BASE}/quote",
                                 params={'symbol': symbol, 'token': FINNHUB_API_KEY}).json()
            price = quote.get('c', 0)
            if not price or price < 2.0:
                continue

            metrics = requests.get(f"{FINNHUB_BASE}/stock/metric",
                                   params={'symbol': symbol, 'metric': 'all',
                                           'token': FINNHUB_API_KEY}).json().get('metric', {})
            cap_m      = metrics.get('marketCapitalization', 0) or 0
            avg_vol    = metrics.get('10DayAverageTradingVolume', 0) or 0
            dollar_vol = price * (avg_vol * 1_000_000)

            # ── FEATURE 4: Capture 52-week range while we already have metrics ──
            week52_low        = metrics.get('52WeekLow', 0) or 0
            week52_high       = metrics.get('52WeekHigh', 0) or 0
            pct_above_52w_low = round(((price - week52_low) / week52_low * 100), 2) if week52_low > 0 else None

            if (25 <= cap_m <= 2000) and (dollar_vol >= 250_000):
                print(f"PASSED: {symbol} | ${price} | ${cap_m}M")
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
            print(f"Error {symbol}: {e}")

        time.sleep(2.1)  # Finnhub free tier: 60 calls/min, 2 per symbol = 30/min

    return pd.DataFrame(candidates)


# ── PHASE 2: SEC FUNDAMENTALS ────────────────────────────
def get_cik_map():
    print("Fetching CIK map from SEC...")
    res = requests.get("https://www.sec.gov/files/company_tickers.json",
                       headers=SEC_HEADERS)
    res.raise_for_status()
    return {v['ticker']: str(v['cik_str']).zfill(10) for v in res.json().values()}


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
    """
    Returns the prior-year annual value for a GAAP tag (second most recent 10-K filing).
    Used for real YoY growth calculations — asset growth and revenue growth.
    """
    gaap = facts.get('facts', {}).get('us-gaap', {})
    for tag in tags:
        if tag in gaap:
            try:
                usd_units = gaap[tag]['units']['USD']
                # Filter to annual 10-K filings only to avoid mixing quarters with years
                annual = [u for u in usd_units if u.get('form') in ('10-K', '10-K/A')]
                if len(annual) >= 2:
                    annual_sorted = sorted(annual, key=lambda x: x['end'], reverse=True)
                    return annual_sorted[1]['val']  # second most recent = prior year
            except (KeyError, IndexError):
                continue
    return np.nan


def fetch_sec_fundamentals(df_candidates):
    cik_map = get_cik_map()
    rows = []
    for _, row in df_candidates.iterrows():
        ticker = row['ticker']
        cik    = cik_map.get(ticker)
        if not cik:
            print(f"No CIK for {ticker}, skipping.")
            continue
        try:
            res = requests.get(
                f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
                headers=SEC_HEADERS)
            if res.status_code != 200:
                continue
            facts = res.json()

            # Core fundamentals
            cfo              = latest_gaap(facts, ['NetCashProvidedByUsedInOperatingActivities'])
            capex            = latest_gaap(facts, ['PaymentsToAcquirePropertyPlantAndEquipment',
                                                   'PaymentsToAcquireProductiveAssets'])
            net_income       = latest_gaap(facts, ['NetIncomeLoss'])
            total_assets     = latest_gaap(facts, ['Assets'])
            book_equity      = latest_gaap(facts, ['StockholdersEquity', 'AssetsNet'])

            # FEATURE 1: Real prior-year assets for true YoY growth (replaces 0.05 placeholder)
            total_assets_prev = prev_year_gaap(facts, ['Assets'])

            # FEATURE 2: Total debt for quality penalty calculation
            total_debt = latest_gaap(facts, ['LongTermDebt',
                                             'LongTermDebtAndCapitalLeaseObligation',
                                             'DebtAndCapitalLeaseObligations'])

            # FEATURE 3: Revenue current + prior year for growth factor
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
            print(f"SEC error {ticker}: {e}")
        time.sleep(0.15)  # SEC rate limit: 10 req/sec
    return pd.DataFrame(rows)


# ── PHASE 3: SCORING ─────────────────────────────────────
def score(df):

    # ── Raw factor calculations ──────────────────────────
    df['fcf']            = df['cfo'] - df['capex'].abs()
    df['fcf_yield']      = df['fcf'] / (df['market_cap'] * 1_000_000)
    df['book_to_market'] = df['book_equity'] / (df['market_cap'] * 1_000_000)
    df['roa']            = df['net_income'] / df['total_assets']

    # FEATURE 1: Real asset growth YoY (replaces 0.05 placeholder)
    df['asset_growth_yoy'] = np.where(
        df['total_assets_prev'].notna() & (df['total_assets_prev'] != 0),
        (df['total_assets'] - df['total_assets_prev']) / df['total_assets_prev'].abs(),
        0.0  # neutral fallback when prior year unavailable
    )

    # FEATURE 3: Revenue growth YoY
    df['revenue_growth'] = np.where(
        df['revenue_prev'].notna() & (df['revenue_prev'] != 0),
        (df['revenue_current'] - df['revenue_prev']) / df['revenue_prev'].abs(),
        np.nan  # will be filled with median at ranking step
    )

    # ── FEATURE 1: Relaxed ROA gate — allow down to -5% ─
    # Keeps companies trending toward profitability rather than cutting them entirely
    df = df[
        (df['fcf_yield'] > 0) &
        (df['book_to_market'] > 0) &
        (df['roa'] >= -0.05)        # was: roa > 0
    ].copy()

    if df.empty:
        print("No candidates survived the gates.")
        return df

    # ── Winsorize + percentile rank all 5 factors ────────
    factors = ['fcf_yield', 'book_to_market', 'roa', 'asset_growth_yoy', 'revenue_growth']
    for factor in factors:
        col = df[factor].copy()
        # Fill missing revenue_growth with median so gaps don't skew ranks
        if factor == 'revenue_growth':
            col = col.fillna(col.median())
        lo         = col.quantile(0.05)
        hi         = col.quantile(0.95)
        winsorized = col.clip(lower=lo, upper=hi)
        df[f'{factor}_rank_pct'] = winsorized.rank(pct=True)

    # ── Updated composite (5 factors, rebalanced weights) ─
    df['composite_score'] = (
        0.35 * df['fcf_yield_rank_pct']        +  # reduced from 0.45
        0.20 * df['book_to_market_rank_pct']   +
        0.15 * df['roa_rank_pct']              +  # reduced from 0.20
        0.15 * df['asset_growth_yoy_rank_pct'] +
        0.15 * df['revenue_growth_rank_pct']      # new momentum factor
    )

    # ── FEATURE 2: Quality penalty system ───────────────
    df['quality_penalty'] = 0

    # Penalty 1: High debt burden (total debt / book equity > 2.0)
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

    # Penalty 2: Asset bloat — fast balance sheet growth without FCF support
    asset_bloat = (df['asset_growth_yoy'] > 0.20) & (df['fcf_yield'] < 0.03)
    df.loc[asset_bloat, 'quality_penalty'] += 1
    if asset_bloat.sum() > 0:
        print(f"  Quality penalty (asset bloat): {asset_bloat.sum()} stocks")

    # Penalty 3: Micro-cap liquidity risk (under $30M market cap)
    microcap = df['market_cap'] < 30
    df.loc[microcap, 'quality_penalty'] += 1
    if microcap.sum() > 0:
        print(f"  Quality penalty (micro-cap <$30M): {microcap.sum()} stocks")

    # Each penalty point deducts 0.05 from composite score, floor at 0
    df['composite_score'] = (df['composite_score'] - (df['quality_penalty'] * 0.05)).clip(lower=0)

    # ── Final ranking ────────────────────────────────────
    df['rank_overall'] = df['composite_score'].rank(ascending=False, method='min').astype(int)
    return df.sort_values('rank_overall')


# ── PHASE 4: DATABASE LOAD ───────────────────────────────
def load_to_db(df):
    print(f"Loading {len(df)} rows into Neon PostgreSQL...")

    # Add new columns to the Neon table if they don't already exist
    # Run this once — safe to re-run (IF NOT EXISTS guard)
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

    # Ordered list of python col -> db col mappings
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

    # Only include mappings where the python column actually exists in df
    active = [(py, db) for py, db in col_map if py in df_clean.columns]
    py_cols = [py for py, _ in active]
    db_cols = [db for _, db in active]

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

        # Run migration to add new columns (safe / idempotent)
        cur.execute(migration_sql)
        conn.commit()
        print("Schema migration complete (new columns ensured).")

        # Insert / upsert data
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
    universe   = get_us_universe()
    candidates = apply_gates(universe)
    print(f"\n{len(candidates)} candidates passed gates.")

    if candidates.empty:
        print("No candidates -- aborting.")
        exit(1)

    sec_data = fetch_sec_fundamentals(candidates)
    merged   = pd.merge(candidates, sec_data, on='ticker', how='inner')
    ranked   = score(merged)

    if ranked.empty:
        print("No candidates survived scoring -- aborting.")
        exit(1)

    print(f"\nTop 5 ranked:")
    print(ranked[['ticker', 'composite_score', 'rank_overall',
                  'fcf_yield', 'revenue_growth', 'quality_penalty',
                  'pct_above_52w_low']].head())

    load_to_db(ranked)
    print("=== ETL Complete ===")
