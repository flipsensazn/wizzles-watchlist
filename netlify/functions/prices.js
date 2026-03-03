const OTC_TICKERS = ["IQEPF", "SLOIF", "ALMU"];
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

// ALL of these go through Yahoo so we get both price + change
const YAHOO_TICKERS = [
  ...OTC_TICKERS,
  ...INDEX_TICKERS,
  ...CRYPTO_TICKERS,
  ...HYPERSCALER_TICKERS,
];

const FINNHUB_KEY = process.env.FINNHUB_KEY;

let cache = { data: {}, timestamp: 0 };
const CACHE_TTL = 30000;

async function fetchYahoo(ticker) {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=5d`;
    const res = await fetch(url);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker, change: null, price: null, history: [] };

    const closes = result.indicators.quote[0].close.filter(v => v !== null);
    const prev = closes[closes.length - 2];
    const curr = closes[closes.length - 1];

    if (prev && curr) {
      return {
        ticker,
        change: parseFloat((((curr - prev) / prev) * 100).toFixed(2)),
        price: parseFloat(curr.toFixed(2)),
        history: closes.map(v => parseFloat(v.toFixed(2))), // ← ADD THIS
      };
    }
    return { ticker, change: null, price: null, history: [] };
  } catch (err) {
    console.warn(`Yahoo fetch failed for ${ticker}:`, err);
    return { ticker, change: null, price: null, history: [] };
  }
}

// Also update fetchFinnhub to include history (from intraday if available, else empty)
async function fetchFinnhub(ticker) {
  try {
    const [quoteRes, candleRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&count=5&token=${FINNHUB_KEY}`)
    ]);
    const quote = await quoteRes.json();
    const candle = await candleRes.json();

    const change = quote.dp;
    const price = quote.c;
    const history = candle.c ? candle.c.map(v => parseFloat(v.toFixed(2))) : [];

    if (change !== null && change !== undefined && !isNaN(change)) {
      return {
        ticker,
        change: parseFloat(change.toFixed(2)),
        price: parseFloat((price ?? 0).toFixed(2)),
        history,
      };
    }
    return { ticker, change: null, price: null, history: [] };
  } catch (err) {
    console.error(`Finnhub fetch failed for ${ticker}:`, err);
    return { ticker, change: null, price: null, history: [] };
  }
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.data).length > 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: cache.data, cached: true }),
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

  // Yahoo — returns { change, price } for all Yahoo tickers
  await Promise.all(yahooTickers.map(async t => {
    const r = await fetchYahoo(t);
    if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price, history: r.history };
  }));

  // Finnhub — also returns { change, price } now for consistency
  const batchSize = 10;
  for (let i = 0; i < finnhubTickers.length; i += batchSize) {
    const batch = finnhubTickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFinnhub));
    batchResults.forEach(r => {
    if (r.change !== null) results[r.ticker] = { change: r.change, price: r.price, history: r.history };
  });
    if (i + batchSize < finnhubTickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  cache = { data: results, timestamp: Date.now() };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ data: results, cached: false }),
  };
};
