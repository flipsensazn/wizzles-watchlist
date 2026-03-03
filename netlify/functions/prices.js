const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"]; // SPX, DOW, NASDAQ
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const YAHOO_TICKERS = [...OTC_TICKERS, ...INDEX_TICKERS, ...CRYPTO_TICKERS];
const OTC_TICKERS = ["IQEPF", "SLOIF", "ALMU"];
const FINNHUB_KEY = process.env.FINNHUB_KEY;

// In-memory cache
let cache = { prices: {}, timestamp: 0 };
const CACHE_TTL = 30000; // 30 seconds

async function fetchFinnhub(ticker) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
  );
  const data = await res.json();
  const change = data.dp;
  if (change !== null && change !== undefined && !isNaN(change)) {
    return { ticker, change: parseFloat(change.toFixed(2)) };
  }
  return { ticker, change: null };
}

async function fetchYahoo(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(url); // No CORS proxy needed server-side!
    const data = await res.json();
    const closes = data.chart.result[0].indicators.quote[0].close
      .filter(v => v !== null);
    const prev = closes[closes.length - 2];
    const curr = closes[closes.length - 1];
    if (prev && curr) {
      return { ticker, change: parseFloat((((curr - prev) / prev) * 100).toFixed(2)) };
    }
    return { ticker, change: null };
  } catch {
    return { ticker, change: null };
  }
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Return cached prices if still fresh
  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.prices).length > 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ prices: cache.prices, cached: true }),
    };
  }

  // Get tickers from query string e.g. ?tickers=NVDA,AMD,LITE
  const tickers = event.queryStringParameters?.tickers?.split(",") ?? [];
  if (!tickers.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No tickers provided" }) };
  }

  const otc = tickers.filter(t => YAHOO_TICKERS.includes(t));
  const exchange = tickers.filter(t => !YAHOO_TICKERS.includes(t));

  const results = {};

  // Fetch OTC via Yahoo (no CORS proxy needed server-side)
  await Promise.all(otc.map(async t => {
    const r = await fetchYahoo(t);
    if (r.change !== null) results[r.ticker] = r.change;
  }));

  // Fetch exchange tickers via Finnhub in batches
  const batchSize = 10;
  for (let i = 0; i < exchange.length; i += batchSize) {
    const batch = exchange.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFinnhub));
    batchResults.forEach(r => { if (r.change !== null) results[r.ticker] = r.change; });
    if (i + batchSize < exchange.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Update cache
  cache = { prices: results, timestamp: Date.now() };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ prices: results, cached: false }),
  };
};
