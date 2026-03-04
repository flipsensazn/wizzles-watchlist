// functions/prices.js
const OTC_TICKERS = ["IQEPF", "SLOIF", "ALMU"];
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

const YAHOO_TICKERS = [
  ...OTC_TICKERS,
  ...INDEX_TICKERS,
  ...CRYPTO_TICKERS,
  ...HYPERSCALER_TICKERS,
];

// In-memory cache per Cloudflare isolate
let cache = { data: {}, timestamp: 0 };
const CACHE_TTL = 30000;

async function fetchYahoo(ticker) {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=2d`;
    const res = await fetch(url);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker, change: null, price: null };

    const closes = result.indicators.quote[0].close.filter(v => v !== null);
    const prev = closes[closes.length - 2];
    const curr = closes[closes.length - 1];

    if (prev && curr) {
      return {
        ticker,
        change: parseFloat((((curr - prev) / prev) * 100).toFixed(2)),
        price: parseFloat(curr.toFixed(2)),
      };
    }
    return { ticker, change: null, price: null };
  } catch (err) {
    console.warn(`Yahoo fetch failed for ${ticker}:`, err);
    return { ticker, change: null, price: null };
  }
}

async function fetchFinnhub(ticker, apiKey) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`
    );
    const quote = await res.json();
    const change = quote.dp;
    const price = quote.c;

    if (change !== null && change !== undefined && !isNaN(change)) {
      return {
        ticker,
        change: parseFloat(change.toFixed(2)),
        price: parseFloat((price ?? 0).toFixed(2)),
      };
    }
    return { ticker, change: null, price: null };
  } catch (err) {
    console.error(`Finnhub fetch failed for ${ticker}:`, err);
    return { ticker, change: null, price: null };
  }
}

// Cloudflare Pages specific handler syntax
export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // 1. Grab environment variable from Cloudflare Context
  const FINNHUB_KEY = context.env.FINNHUB_KEY;

  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.data).length > 0) {
    return new Response(JSON.stringify({ data: cache.data, cached: true }), {
      status: 200,
      headers
    });
  }

  // 2. Grab Query parameters
  const { searchParams } = new URL(context.request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam ? tickersParam.split(",") : [];

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "No tickers provided" }), {
      status: 400,
      headers
    });
  }

  const yahooTickers = tickers.filter(t => YAHOO_TICKERS.includes(t));
  const finnhubTickers = tickers.filter(t => !YAHOO_TICKERS.includes(t));
  const results = {};

  await Promise.all(yahooTickers.map(async t => {
    const r = await fetchYahoo(t);
    if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price };
  }));

  const batchSize = 10;
  for (let i = 0; i < finnhubTickers.length; i += batchSize) {
    const batch = finnhubTickers.slice(i, i + batchSize);
    // Pass the key to our fetcher function
    const batchResults = await Promise.all(batch.map(t => fetchFinnhub(t, FINNHUB_KEY)));
    batchResults.forEach(r => {
      if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price };
    });
    if (i + batchSize < finnhubTickers.length) {
      // Cloudflare workers support promises + setTimeout for simple delays
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  cache = { data: results, timestamp: Date.now() };

  return new Response(JSON.stringify({ data: results, cached: false }), {
    status: 200,
    headers
  });
}
