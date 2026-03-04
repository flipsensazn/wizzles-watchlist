let cache = { data: {}, timestamp: 0 };
const CACHE_TTL = 15000; // 15 seconds

export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // 1. CACHE CHECK
  const now = Date.now();
  if (now - cache.timestamp < CACHE_TTL && Object.keys(cache.data).length > 0) {
    return new Response(JSON.stringify({ data: cache.data, cached: true }), { status: 200, headers });
  }

  // 2. PARSE TICKERS
  const { searchParams } = new URL(context.request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam ? [...new Set(tickersParam.split(",").filter(Boolean))] : [];

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "No tickers provided" }), { status: 400, headers });
  }

  const results = {};
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const FINNHUB_KEY = context.env.FINNHUB_KEY;

  // 3. YAHOO BULK FETCH (Primary Engine: Grabs 99% of tickers in 2 requests)
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    // Fetch in batches of 40 to avoid URL length limits
    const batchSize = 40;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(",")}&crumb=${crumb}`;
      
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
      
      if (res.ok) {
        const data = await res.json();
        const quoteList = data?.quoteResponse?.result || [];
        for (const q of quoteList) {
          if (q.regularMarketPrice !== undefined) {
            results[q.symbol] = {
              price: parseFloat(q.regularMarketPrice.toFixed(2)),
              change: q.regularMarketChangePercent !== undefined ? parseFloat(q.regularMarketChangePercent.toFixed(2)) : 0
            };
          }
        }
      }
    }
  } catch (err) {
    console.error("Yahoo bulk fetch error:", err);
  }

  // 4. FINNHUB FALLBACK (Only for missing/obscure tickers)
  const missingTickers = tickers.filter(t => !results[t]);

  if (missingTickers.length > 0 && FINNHUB_KEY) {
    // Limit to 45 max to ensure we NEVER breach the 60/min limit
    const safeMissing = missingTickers.slice(0, 45); 
    
    for (const t of safeMissing) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${FINNHUB_KEY}`);
        if (res.ok) {
          const quote = await res.json();
          if (quote.dp !== null && quote.dp !== undefined) {
            results[t] = {
              price: parseFloat((quote.c ?? 0).toFixed(2)),
              change: parseFloat(quote.dp.toFixed(2))
            };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 35));
      } catch (e) {
        console.error(`Finnhub fallback error for ${t}:`, e);
      }
    }
  }

  // 5. UPDATE CACHE AND RETURN
  if (Object.keys(results).length > 0) {
    cache = { data: results, timestamp: Date.now() };
  }

  return new Response(JSON.stringify({ data: results, cached: false }), { status: 200, headers });
}
