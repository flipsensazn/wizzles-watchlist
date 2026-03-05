// functions/screener.js
export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const SCREENER_ID = "280c1669-7de1-4984-8154-e304ec8756aa"; // Your specific Yahoo Screener ID

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    let tickers = [];

    // ATTEMPT 1: Official Yahoo API Fetch
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${SCREENER_ID}&count=100&crumb=${crumb}`;
      const apiRes = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const quotes = data.finance?.result?.[0]?.quotes || [];
        tickers = quotes.map(q => q.symbol);
      }
    } catch (e) {
      console.log("API attempt failed, falling back to HTML scraping.");
    }

    // ATTEMPT 2: HTML Scrape Fallback (Extremely robust for shared links)
    if (tickers.length === 0) {
      const htmlUrl = `https://finance.yahoo.com/research-hub/screener/${SCREENER_ID}/?start=0&count=100`;
      const htmlRes = await fetch(htmlUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } });
      const html = await htmlRes.text();
      
      // Extract every symbol hidden in the React payload of the page
      const regex = /"symbol":"([^"]+)"/g;
      let match;
      const found = new Set();
      while ((match = regex.exec(html)) !== null) {
         // Filter out random indices or currencies that might get caught
         if (!match[1].includes("=") && !match[1].includes("-USD") && !match[1].includes("^")) {
             found.add(match[1]);
         }
      }
      tickers = Array.from(found);
    }

    return new Response(JSON.stringify({ tickers }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Screener fetch failed", details: err.message }), { status: 500, headers });
  }
}
