// functions/quote.js
export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const { searchParams } = new URL(context.request.url);
  const ticker = searchParams.get("ticker");

  if (!ticker) {
    return new Response(JSON.stringify({ error: "No ticker provided" }), { status: 400, headers });
  }

  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    const modules = "assetProfile,summaryDetail,price,financialData,defaultKeyStatistics";
    
    // Fetch both Quote Summary and 1-Month Chart History simultaneously
    const quoteUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${crumb}`;
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d&crumb=${crumb}`;
    
    const [quoteRes, chartRes] = await Promise.all([
      fetch(quoteUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } }),
      fetch(chartUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } })
    ]);
    
    const quoteData = await quoteRes.json();
    const chartData = await chartRes.json();

    // Merge responses into a single payload
    return new Response(JSON.stringify({
      quoteSummary: quoteData.quoteSummary,
      chart: chartData.chart
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Fetch failed" }), { status: 500, headers });
  }
}
