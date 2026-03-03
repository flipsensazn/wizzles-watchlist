const OTC_TICKERS = ["IQEPF", "SLOIF", "ALMU"];
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const YAHOO_TICKERS = [...OTC_TICKERS, ...INDEX_TICKERS, ...CRYPTO_TICKERS];

const FINNHUB_KEY = process.env.FINNHUB_KEY;

let cache = { prices: {}, timestamp: 0 };
const CACHE_TTL = 30000;

async function fetchFinnhub(ticker) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    const change = data.dp;
    if (change !== null && change !== undefined && !isNaN(change)) {
      return { ticker, change: parseFloat(change.toFixed(2)) };
    }
    console.warn(`No Finnhub data for ${ticker}:`, data);
    return { ticker, change: null };
  } catch (err) {
    console.error(`Finnhub fetch failed for ${ticker}:`, err);
    return { ticker, change: null };
  }
}

async function fetchYahoo(ticker) {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=5d`;
    const res = await fetch(url);
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    if (!result) {
      console.warn(`No Yahoo result for ${ticker}`);
      return { ticker, change: null };
    }

    const closes = result.indicators.quote[0].close.filter(v => v !== null);
    const prev = closes[closes.length - 2];
    const curr = closes[closes.length - 1];

    if (prev && curr) {
      return { ticker, change: parseFloat((((curr - prev) / prev) * 100).toFixed(2)) };
    }
    return { ticker, change: null };
  } catch (err) {
    console.warn(`Yahoo fetch failed for ${ticker}:`, err);
    return { ticker, change: null };
  }
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.prices).length > 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ prices: cache.prices, cached: true }),
    };
  }

  const tickers = event.queryStringParameters?.tickers?.split(",") ?? [];
  if (!tickers.length) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "No tickers provided" }),
    };
  }

  const yahooTickers = tickers.filter(t => YAHOO_TICKERS.includes(t));
  const finnhubTickers = tickers.filter(t => !YAHOO_TICKERS.includes(t));

  const results = {};

  // Fetch Yahoo tickers (OTC + indices + crypto)
  await Promise.all(yahooTickers.map(async t => {
    const r = await fetchYahoo(t);
    if (r.change !== null) results[r.ticker] = r.change;
  }));

  // Fetch Finnhub tickers in batches
  const batchSize = 10;
  for (let i = 0; i < finnhubTickers.length; i += batchSize) {
    const batch = finnhubTickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFinnhub));
    batchResults.forEach(r => { if (r.change !== null) results[r.ticker] = r.change; });
    if (i + batchSize < finnhubTickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  cache = { prices: results, timestamp: Date.now() };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ prices: results, cached: false }),
  };
};
