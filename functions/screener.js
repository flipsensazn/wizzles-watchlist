// functions/screener.js
export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const SCREENER_ID = "280c1669-7de1-4984-8154-e304ec8756aa";

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    let tickers = [];
    let debugLog = []; // Track exactly what happens

    // ATTEMPT 1: Official API
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${SCREENER_ID}&count=100&crumb=${crumb}`;
      const apiRes = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
      debugLog.push(`API Status: ${apiRes.status}`);
      if (apiRes.ok) {
        const data = await apiRes.json();
        const quotes = data.finance?.result?.[0]?.quotes || [];
        tickers = quotes.map(q => q.symbol);
        debugLog.push(`API Found Tickers: ${tickers.length}`);
      }
    } catch (e) {
      debugLog.push(`API Attempt Failed: ${e.message}`);
    }

    // ATTEMPT 2: HTML Scrape Fallback
    if (tickers.length === 0) {
      try {
        const htmlUrl = `https://finance.yahoo.com/research-hub/screener/${SCREENER_ID}/?start=0&count=100`;
        const htmlRes = await fetch(htmlUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
        debugLog.push(`HTML Status: ${htmlRes.status}`);
        
        const html = await htmlRes.text();
        const regex = /"symbol":"([^"]+)"/g;
        let match;
        const found = new Set();
        while ((match = regex.exec(html)) !== null) {
           if (!match[1].includes("=") && !match[1].includes("-USD") && !match[1].includes("^")) {
               found.add(match[1]);
           }
        }
        tickers = Array.from(found);
        debugLog.push(`HTML Regex Found: ${tickers.length}`);
        
        // If it still failed, let's grab a snippet of the page to see if Yahoo changed their code
        if (tickers.length === 0) {
          debugLog.push(`HTML Snippet: ${html.substring(0, 200)}...`);
        }
      } catch (e) {
         debugLog.push(`HTML Attempt Failed: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({ tickers, debugLog }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Screener fetch failed", details: err.message }), { status: 500, headers });
  }
}
