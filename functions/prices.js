const OTC_TICKERS = ["IQEPF", "SLOIF", "ALMU"];
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

// These use the Yahoo scraper logic
const YAHOO_TICKERS = [
  ...OTC_TICKERS,
  ...INDEX_TICKERS,
  ...CRYPTO_TICKERS,
  ...HYPERSCALER_TICKERS,
];

// In-memory cache
let cache = { data: {}, timestamp: 0 };
const CACHE_TTL = 30000;

// Mimic a real browser to prevent Yahoo from blocking Cloudflare IPs
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://finance.yahoo.com/"
};

async function fetchYahoo(ticker) {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=2d`;
    
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return { ticker, change: null, price: null };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker, change: null, price: null };

    const closes = result.indicators.quote[0].close.filter(v => v !== null);
    
    // Calculate 1D change from the last two valid closing prices
    if (closes.length >= 2) {
      const prev = closes[closes.length - 2];
      const curr = closes[closes.length - 1];
      return {
        ticker,
        change: parseFloat((((curr - prev) / prev) * 100).toFixed(2)),
        price: parseFloat(curr.toFixed(2)),
      };
    }
    return { ticker, change: null, price: null };
  } catch (err) {
    console.error(`Yahoo error for ${ticker}:`, err);
    return { ticker, change: null, price: null };
  }
}

async function fetchFinnhub(ticker, apiKey) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`
    );
    const quote = await res.json();
    
    // Finnhub uses 'dp' for daily percentage change and 'c' for current price
    if (quote.dp !== null && quote.dp !== undefined) {
      return {
        ticker,
        change: parseFloat(quote.dp.toFixed(2)),
        price: parseFloat((quote.c ?? 0).toFixed(2)),
      };
    }
    return { ticker, change: null, price: null };
  } catch (err) {
    console.error(`Finnhub error for ${ticker}:`, err);
    return { ticker, change: null, price: null };
  }
}

export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // 1. ACCESS KEY: Using context.env for Cloudflare
  const FINNHUB_KEY = context.env.FINNHUB_KEY;

  if (!FINNHUB_KEY) {
    console.error("FINNHUB_KEY is missing in Cloudflare environment variables.");
  }

  // 2. CACHE CHECK
  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.data).length > 0) {
    return new Response(JSON.stringify({ data: cache.data, cached: true }), { status: 200, headers });
  }

  // 3. PARSE TICKERS
  const { searchParams } = new URL(context.request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam ? tickersParam.split(",") : [];

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "No tickers provided" }), { status: 400, headers });
  }

  const results = {};
  const yahooTickers = tickers.filter(t => YAHOO_TICKERS.includes(t));
  const finnhubTickers = tickers.filter(t => !YAHOO_TICKERS.includes(t));

  // 4. FETCH YAHOO
  await Promise.all(yahooTickers.map(async t => {
    const r = await fetchYahoo(t);
    if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price };
  }));

  // 5. FETCH FINNHUB (Batching to stay under rate limits)
  const batchSize = 10;
  for (let i = 0; i < finnhubTickers.length; i += batchSize) {
    const batch = finnhubTickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => fetchFinnhub(t, FINNHUB_KEY)));
    
    batchResults.forEach(r => {
      if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price };
    });

    if (i + batchSize < finnhubTickers.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Update Cache
  cache = { data: results, timestamp: Date.now() };

  return new Response(JSON.stringify({ data: results, cached: false }), { status: 200, headers });
}
