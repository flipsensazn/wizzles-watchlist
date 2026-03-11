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
SEC_HEADERS     = {'User-Agent': 'WizzlesWatchlist flipsensazn@gmail.com'}  # ← update this


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

            if (25 <= cap_m <= 2000) and (dollar_vol >= 250_000):
                print(f"PASSED: {symbol} | ${price} | ${cap_m}M")
                candidates.append({'ticker': symbol, 'price': price,
                                   'market_cap': cap_m, 'avg_dollar_vol_20d': dollar_vol})
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
            rows.append({
                'ticker':             ticker,
                'cfo':                latest_gaap(facts, ['NetCashProvidedByUsedInOperatingActivities']),
                'capex':              latest_gaap(facts, ['PaymentsToAcquirePropertyPlantAndEquipment',
                                                          'PaymentsToAcquireProductiveAssets']),
                'net_income':         latest_gaap(facts, ['NetIncomeLoss']),
                'total_assets':       latest_gaap(facts, ['Assets']),
                'book_equity':        latest_gaap(facts, ['StockholdersEquity', 'AssetsNet']),
            })
        except Exception as e:
            print(f"SEC error {ticker}: {e}")
        time.sleep(0.15)  # SEC limit: 10 req/sec
    return pd.DataFrame(rows)


# ── PHASE 3: SCORING ─────────────────────────────────────
def score(df):
    df['fcf']             = df['cfo'] - df['capex'].abs()
    df['fcf_yield']       = df['fcf'] / (df['market_cap'] * 1_000_000)
    df['book_to_market']  = df['book_equity'] / (df['market_cap'] * 1_000_000)
    df['roa']             = df['net_income'] / df['total_assets']
    df['asset_growth_yoy'] = 0.05  # MVP placeholder — replace with real T-1 calc later

    df = df[(df['fcf_yield'] > 0) & (df['book_to_market'] > 0) & (df['roa'] > 0)].copy()

    for factor in ['fcf_yield', 'book_to_market', 'roa', 'asset_growth_yoy']:
        lo, hi     = df[factor].quantile(0.05), df[factor].quantile(0.95)
        winsorized = df[factor].clip(lower=lo, upper=hi)
        df[f'{factor}_rank_pct'] = winsorized.rank(pct=True)

    df['composite_score'] = (
        0.45 * df['fcf_yield_rank_pct'] +
        0.20 * df['book_to_market_rank_pct'] +
        0.20 * df['roa_rank_pct'] +
        0.15 * df['asset_growth_yoy_rank_pct']
    )
    df['rank_overall'] = df['composite_score'].rank(ascending=False, method='min').astype(int)
    return df.sort_values('rank_overall')


# ── PHASE 4: DATABASE LOAD ───────────────────────────────
def load_to_db(df):
    print(f"Loading {len(df)} rows into Neon PostgreSQL...")
    df['as_of_date'] = date.today()
    df_clean = df.replace({np.nan: None})

    cols = [
        'as_of_date', 'ticker', 'market_cap', 'price', 'avg_dollar_vol_20d',
        'cfo', 'capex', 'fcf', 'net_income', 'total_assets', 'book_equity',
        'fcf_yield', 'book_to_market', 'roa', 'asset_growth_yoy',
        'fcf_yield_rank_pct', 'book_to_market_rank_pct', 'roa_rank_pct',
        'asset_growth_yoy_rank_pct', 'composite_score', 'rank_overall'
    ]
    records = [tuple(x) for x in df_clean[cols].to_numpy()]

    insert_sql = """
        INSERT INTO ranked_candidates (
            as_of_date, ticker, market_cap, price, avg_dollar_vol_20d,
            cfo_ttm, capex_ttm, fcf_ttm, net_income_ttm, total_assets_latest, book_equity_latest,
            fcf_yield, book_to_market, roa, asset_growth_yoy,
            fcf_rank_pct, bm_rank_pct, roa_rank_pct, asset_growth_rank_pct,
            composite_score, rank_overall
        ) VALUES %s
        ON CONFLICT (as_of_date, ticker) DO UPDATE SET
            market_cap      = EXCLUDED.market_cap,
            price           = EXCLUDED.price,
            composite_score = EXCLUDED.composite_score,
            rank_overall    = EXCLUDED.rank_overall;
    """
    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
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

    print(f"\nTop 5 ranked:\n{ranked[['ticker','composite_score','rank_overall']].head()}")
    load_to_db(ranked)
    print("=== ETL Complete ===")
