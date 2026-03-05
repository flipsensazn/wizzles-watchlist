// functions/prices.js

// ── FIX #2: Removed module-level in-memory cache (unreliable in Cloudflare Workers).
// Prices are now cached in Cloudflare KV with a 30-second TTL, which persists
// reliably across all worker isolates.
const CACHE_TTL_SECONDS = 30;
const KV_CACHE_KEY = "priceCache";

export async function onRequest(context) {
  const { request, env } = context;

  // ── FIX #3: Restrict CORS to your actual domain ──────────────────────────
  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN;

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }

  // 1. PARSE TICKERS
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam ? [...new Set(tickersParam.split(",").filter(Boolean))] : [];

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "No tickers provided" }), { status: 400, headers });
  }

  // 2. KV CACHE CHECK
  // KV stores the cache as { data: {...}, timestamp: ms }.
  // We set a KV-level expiration AND check the timestamp ourselves for the 30s TTL.
  if (env.SHARED_DATA) {
    try {
      const cached = await env.SHARED_DATA.get(KV_CACHE_KEY, "json");
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_TTL_SECONDS * 1000)) {
        return new Response(JSON.stringify({ data: cached.data, cached: true }), { status: 200, headers });
      }
    } catch (err) {
      console.error("KV cache read error:", err);
      // Non-fatal — fall through to a fresh fetch
    }
  }

  // 3. FETCH TICKERS FROM YAHOO (Primary Engine)
  const results = {};
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const FINNHUB_KEY = env.FINNHUB_KEY;

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
              change: q.regularMarketChangePercent !== undefined
                ? parseFloat(q.regularMarketChangePercent.toFixed(2))
                : 0
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

  // 5. WRITE BACK TO KV CACHE (with TTL expiration as a safety net)
  if (Object.keys(results).length > 0 && env.SHARED_DATA) {
    try {
      const cachePayload = JSON.stringify({ data: results, timestamp: Date.now() });
      // expirationTtl is a hard KV-level expiry (in seconds) as a safety net
      await env.SHARED_DATA.put(KV_CACHE_KEY, cachePayload, { expirationTtl: CACHE_TTL_SECONDS * 4 });
    } catch (err) {
      console.error("KV cache write error:", err);
      // Non-fatal — still return results to the client
    }
  }

  return new Response(JSON.stringify({ data: results, cached: false }), { status: 200, headers });
}

