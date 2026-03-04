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

  try {
    const modules = "assetProfile,summaryDetail,price";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;
    
    // Adding a User-Agent is highly recommended for Yahoo endpoints 
    // when fetching from a serverless backend to prevent 403 Forbidden errors.
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
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
