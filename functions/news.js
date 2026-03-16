// functions/news.js

const KV_CRUMB_KEY = "yahooSession_v1";
const CRUMB_TTL_MS = 55 * 60 * 1000; // 55 minutes
const USER_AGENT   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getYahooSession(env) {
  if (env.SHARED_DATA) {
    try {
      const cached = await env.SHARED_DATA.get(KV_CRUMB_KEY, "json");
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < CRUMB_TTL_MS)) {
        return { cookie: cached.cookie, crumb: cached.crumb };
      }
    } catch (err) {}
  }

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
  const rawCookie = cookieRes.headers.get("set-cookie");
  const cookie    = rawCookie ? rawCookie.split(";")[0] : "";

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
  });
  const crumb = await crumbRes.text();

  if (env.SHARED_DATA) {
    try { await env.SHARED_DATA.put(KV_CRUMB_KEY, JSON.stringify({ cookie, crumb, timestamp: Date.now() }), { expirationTtl: 3600 }); } catch (err) {}
  }

  return { cookie, crumb };
}

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=300"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  try {
    const { cookie, crumb } = await getYahooSession(env);
    
    // We use the search endpoint targeting top hyperscalers and AI infrastructure
    const basket = "NVDA,AMD,MSFT,GOOG,AMZN,META,TSM,SMCI";
    const newsUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(basket)}&quotesCount=0&newsCount=15&crumb=${crumb}`;

    const res = await fetch(newsUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });

    if (res.status === 401 || res.status === 403) {
      if (env.SHARED_DATA) {
        try { await env.SHARED_DATA.delete(KV_CRUMB_KEY); } catch {}
      }
      return new Response(JSON.stringify({ error: "Yahoo session expired, please retry" }), { status: 503, headers });
    }

    const data = await res.json();
    return new Response(JSON.stringify({ news: data?.news || [] }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Fetch failed" }), { status: 500, headers });
  }
}
