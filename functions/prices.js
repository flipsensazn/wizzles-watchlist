// functions/prices.js

const CACHE_TTL_SECONDS = 60; // 1 minutes — keeps KV writes well under the 1,000/day free tier limit
// These 6 tickers power the market strip and get a dedicated no-cache fast path
// so the frontend 5s poll actually receives fresh data every call.
const STRIP_TICKERS = new Set(["^GSPC", "^DJI", "^IXIC", "BTC-USD", "ETH-USD", "XRP-USD"]);
// v2 key ensures any old REGULAR-session snapshots are not served after this deploy
const KV_CACHE_KEY  = "priceCache_v5";
// Crumb is valid for hours — cache it in KV to eliminate 2 serial round trips
const KV_CRUMB_KEY  = "yahooSession_v1";
const CRUMB_TTL_MS  = 55 * 60 * 1000; // 55 minutes
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── CRUMB HELPER ─────────────────────────────────────────────────────────────
async function getYahooSession(env) {
  if (env.SHARED_DATA) {
    try {
      const cached = await env.SHARED_DATA.get(KV_CRUMB_KEY, "json");
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < CRUMB_TTL_MS)) {
        return { cookie: cached.cookie, crumb: cached.crumb };
      }
    } catch (err) {
      console.error("KV crumb read error:", err);
    }
  }

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
  const rawCookie = cookieRes.headers.get("set-cookie");
  const cookie    = rawCookie ? rawCookie.split(";")[0] : "";

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
  });
  const crumb = await crumbRes.text();

  if (env.SHARED_DATA) {
    try {
      await env.SHARED_DATA.put(
        KV_CRUMB_KEY,
        JSON.stringify({ cookie, crumb, timestamp: Date.now() }),
        { expirationTtl: 3600 }
      );
    } catch (err) {
      console.error("KV crumb write error:", err);
    }
  }

  return { cookie, crumb };
}

// ── REQUEST HANDLER ──────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

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

  // 2a. FAST PATH — strip tickers bypass KV cache entirely so the 5s frontend
  //     poll always gets a live Yahoo quote, not a 60s-stale snapshot.
  //     Only activates when the request contains ONLY strip tickers (i.e. the
  //     dedicated fast-refresh call from the frontend, not the full 30s refresh).
  const allStrip = tickers.length > 0 && tickers.every(t => STRIP_TICKERS.has(t));
  if (allStrip) {
    const stripResults = {};
    try {
      const { cookie, crumb } = await getYahooSession(env);
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${tickers.join(",")}&corsDomain=finance.yahoo.com&formatted=false&crumb=${crumb}`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
      if (res.ok) {
        const data = await res.json();
        const quotes = data?.quoteResponse?.result || [];
        console.log(`[strip fast-path] Yahoo returned ${quotes.length} quotes for: ${tickers.join(",")}`);
        for (const q of quotes) {
          if (q.regularMarketPrice === undefined) continue;
          const state = q.marketState;
          let price, change, session;
          if (state === "POST" || state === "POSTPOST") {
            price = q.postMarketPrice ?? q.regularMarketPrice;
            change = q.postMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
            session = "POST";
          } else if (state === "PRE") {
            price = q.preMarketPrice ?? q.regularMarketPrice;
            change = q.preMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
            session = "PRE";
          } else if (state === "CLOSED") {
            price = q.postMarketPrice ?? q.regularMarketPrice;
            change = q.postMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
            session = q.postMarketPrice != null ? "POST" : "CLOSED";
          } else {
            price = q.regularMarketPrice;
            change = q.regularMarketChangePercent ?? 0;
            session = "REGULAR";
          }
          stripResults[q.symbol] = {
            price:   parseFloat(price.toFixed(2)),
            change:  parseFloat(change.toFixed(2)),
            session,
          };
        }
        // NOTE: chart data is intentionally NOT fetched here — the fast path
        // only updates price/change every 5s. Charts update on the 30s cycle,
        // which is fine since 15m-interval chart bars don't change that fast.
        // Fetching 6 chart calls every 5s was causing timeouts and silent failures.
        console.log(`[strip fast-path] returning ${Object.keys(stripResults).length} results`);
      } else {
        console.error(`[strip fast-path] Yahoo quote responded ${res.status}`);
      }
    } catch (err) {
      console.error("[strip fast-path] error:", err.message);
    }
    return new Response(JSON.stringify({ data: stripResults, cached: false }), { status: 200, headers });
  }

  // 2. KV PRICE CACHE CHECK
  if (env.SHARED_DATA) {
    try {
      const cached = await env.SHARED_DATA.get(KV_CACHE_KEY, "json");
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_TTL_SECONDS * 1000)) {
        const allPresent = tickers.every(t => cached.data && t in cached.data);
        if (allPresent) {
          return new Response(JSON.stringify({ data: cached.data, cached: true }), { status: 200, headers });
        }
      }
    } catch (err) {
      console.error("KV cache read error:", err);
    }
  }

  // 3. FETCH FROM YAHOO (Primary Engine)
  const results = {};
  const FINNHUB_KEY = env.FINNHUB_KEY;

  try {
    const { cookie, crumb } = await getYahooSession(env);

    const batchSize = 40;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);

      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(",")}&corsDomain=finance.yahoo.com&formatted=false&crumb=${crumb}`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });

      if (res.ok) {
        const data = await res.json();
        const quoteList = data?.quoteResponse?.result || [];

        for (const q of quoteList) {
          if (q.regularMarketPrice === undefined) continue;

          const state = q.marketState; 
          let price, change, session;

          if (state === "POST" || state === "POSTPOST") {
            price   = q.postMarketPrice ?? q.regularMarketPrice;
            change  = q.postMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
            session = "POST";
          } else if (state === "PRE") {
            price   = q.preMarketPrice ?? q.regularMarketPrice;
            change  = q.preMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
            session = "PRE";
          } else if (state === "CLOSED") {
            if (q.postMarketPrice != null) {
              price   = q.postMarketPrice;
              change  = q.postMarketChangePercent ?? q.regularMarketChangePercent ?? 0;
              session = "POST";
            } else {
              price   = q.regularMarketPrice;
              change  = q.regularMarketChangePercent ?? 0;
              session = "CLOSED";
            }
          } else {
            price   = q.regularMarketPrice;
            change  = q.regularMarketChangePercent ?? 0;
            session = "REGULAR";
          }

          results[q.symbol] = {
            price:    parseFloat(price.toFixed(2)),
            change:   parseFloat(change.toFixed(2)),
            session,
            week52Low:  q.fiftyTwoWeekLow  != null ? parseFloat(q.fiftyTwoWeekLow.toFixed(2))  : null,
            week52High: q.fiftyTwoWeekHigh != null ? parseFloat(q.fiftyTwoWeekHigh.toFixed(2)) : null,
            earningsDate: q.earningsTimestamp || q.earningsTimestampStart || null,
          };
        }
      } else if (res.status === 401 || res.status === 403) {
        if (env.SHARED_DATA) {
          try { await env.SHARED_DATA.delete(KV_CRUMB_KEY); } catch {}
        }
      }
    }

    // 4. FETCH 2-DAY INTRADAY CHARTS FOR MACRO TICKERS (For Bloomberg TV UI)
    const MACRO_TICKERS = new Set(["^GSPC", "^DJI", "^IXIC", "BTC-USD", "ETH-USD", "XRP-USD"]);
    const macrosToFetch = tickers.filter(t => MACRO_TICKERS.has(t));

    if (macrosToFetch.length > 0) {
      await Promise.all(macrosToFetch.map(async (t) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=2d&interval=15m&crumb=${crumb}`;
          const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
          if (res.ok) {
            const data = await res.json();
            const result = data.chart?.result?.[0];
            if (result && result.indicators?.quote?.[0]?.close) {
               results[t] = results[t] || {};
               results[t].chartData = result.indicators.quote[0].close;
               results[t].chartTimestamps = result.timestamp;
            }
          }
        } catch (e) {
          console.error(`Chart fetch error for ${t}:`, e);
        }
      }));
    }

  } catch (err) {
    console.error("Yahoo bulk fetch error:", err);
  }

  // 5. FINNHUB FALLBACK (only for tickers Yahoo missed)
  const missingTickers = tickers.filter(t => !results[t]);
  if (missingTickers.length > 0 && FINNHUB_KEY) {
    const safeMissing = missingTickers.slice(0, 45);
    const BATCH_SIZE  = 8;

    async function fetchFinnhub(t) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${FINNHUB_KEY}`);
        if (res.ok) {
          const quote = await res.json();
          if (quote.dp !== null && quote.dp !== undefined) {
            results[t] = {
              price:   parseFloat((quote.c ?? 0).toFixed(2)),
              change:  parseFloat(quote.dp.toFixed(2)),
              session: "REGULAR",
            };
          }
        }
      } catch (e) {
        console.error(`Finnhub fallback error for ${t}:`, e);
      }
    }

    for (let i = 0; i < safeMissing.length; i += BATCH_SIZE) {
      const batch = safeMissing.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(fetchFinnhub));
      if (i + BATCH_SIZE < safeMissing.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  // 6. WRITE BACK TO KV PRICE CACHE
  if (Object.keys(results).length > 0 && env.SHARED_DATA) {
    try {
      let merged = results;
      try {
        const existing = await env.SHARED_DATA.get(KV_CACHE_KEY, "json");
        if (existing && existing.data) merged = { ...existing.data, ...results };
      } catch {}
      const cachePayload = JSON.stringify({ data: merged, timestamp: Date.now() });
      await env.SHARED_DATA.put(KV_CACHE_KEY, cachePayload, { expirationTtl: CACHE_TTL_SECONDS * 4 });
    } catch (err) {
      console.error("KV cache write error:", err);
    }
  }

  return new Response(JSON.stringify({ data: results, cached: false }), { status: 200, headers });
}
