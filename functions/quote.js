// functions/quote.js
export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const { searchParams } = new URL(context.request.url);
  const ticker = searchParams.get("ticker");

  if (!ticker) {
    return new Response(JSON.stringify({ error: "No ticker provided" }), {
      status: 400,
      headers
    });
  }

  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    // Step 1: Get session cookie
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": USER_AGENT }
    });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    // Step 2: Get crumb
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    // Step 3: Fetch expanded modules for Multibagger Blueprint
    // Added: financialData, defaultKeyStatistics
    const modules = "assetProfile,summaryDetail,price,financialData,defaultKeyStatistics";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${crumb}`;
    
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    
    const data = await res.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers
    });
  } catch (err) {
    console.error(`Quote fetch failed for ${ticker}:`, err);
    return new Response(JSON.stringify({ error: "Failed to fetch quote data" }), {
      status: 500,
      headers
    });
  }
}
