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
  const FISCALAI_KEY = context.env.FISCALAI_KEY;

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();

    // 1. YAHOO FETCH (Removed the broken balanceSheetHistory module)
    const modules = "assetProfile,summaryDetail,price,financialData,defaultKeyStatistics";
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${crumb}`;
    
    const yahooPromise = fetch(yahooUrl, { headers: { "User-Agent": USER_AGENT, "Cookie": cookie } })
      .then(res => res.json());

// 2. FISCAL.AI FETCH (Standardized Annual Balance Sheet)
    let fiscalPromise = Promise.resolve({ _debug: "No API Key found in env" });
    
    if (FISCALAI_KEY) {
      const fiscalUrl = `https://api.fiscal.ai/v1/company/financials/balance-sheet/standardized?ticker=${ticker}&periodType=annual`;
      fiscalPromise = fetch(fiscalUrl, {
        headers: { "X-Api-Key": FISCALAI_KEY }
      })
      .then(async res => {
        if (!res.ok) return { _error: res.status, _details: await res.text() };
        return res.json();
      })
      .catch(err => ({ _error: "Network/Parse Error", _details: err.message }));
    }

    // Await both APIs concurrently
    const [yahooData, fiscalData] = await Promise.all([yahooPromise, fiscalPromise]);

    // Merge into one clean JSON payload
    return new Response(JSON.stringify({
      quoteSummary: yahooData.quoteSummary,
      fiscalai: fiscalData
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Fetch failed" }), { status: 500, headers });
  }
}
