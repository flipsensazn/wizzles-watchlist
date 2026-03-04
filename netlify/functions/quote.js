// netlify/functions/quote.js
exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const ticker = event.queryStringParameters?.ticker;
  if (!ticker) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "No ticker provided" }),
    };
  }

  // A standard User-Agent is required, otherwise Yahoo blocks the request entirely
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    // Step 1: Ping Yahoo's consent/cookie domain to get a valid session cookie
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": USER_AGENT }
    });
    // Extract the raw cookie string from the response headers
    const rawCookie = cookieRes.headers.get("set-cookie");
    const cookie = rawCookie ? rawCookie.split(";")[0] : "";

    // Step 2: Use the cookie to request a valid "crumb" token
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookie,
      }
    });
    const crumb = await crumbRes.text();

    // Step 3: Fetch the actual data, appending the crumb to the URL
    const modules = "assetProfile,summaryDetail,price";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${crumb}`;
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookie
      }
    });
    
    const data = await res.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error(`Quote fetch failed for ${ticker}:`, err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch quote data" }),
    };
  }
};
