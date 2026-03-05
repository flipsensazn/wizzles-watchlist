// functions/scanner.js
export async function onRequest(context) {
  const { request, env } = context;
  
  // The fallback list if the database is empty
  const DEFAULT_LIST = [
    "YELP", "NVRI", "CXM", "SFL", "WWW", "FIVN", "STGW", "ECVT", "CRI", 
    "TRIP", "OLPX", "LZ", "GLDD", "ARHS", "ACEL", "CRCT", "PGY", "TDAY", 
    "NABL", "NRDS", "STKL", "UDMY", "GOGO", "YEXT", "EHAB", "AHH", "RIGL", 
    "RPD", "AKBA"
  ];

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // EVERYONE: Read the global list
  if (request.method === "GET") {
    try {
      const data = env.SHARED_DATA ? await env.SHARED_DATA.get("scannerPool", "json") : null;
      return new Response(JSON.stringify({ tickers: data || DEFAULT_LIST }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ tickers: DEFAULT_LIST, error: err.message }), { status: 200, headers });
    }
  }

  // ADMIN ONLY: Update the global list
  if (request.method === "POST") {
    try {
      const body = await request.json();

      // THE ADMIN PASSWORD (Change this to whatever you want)
      if (body.password !== "Cisco123") {
        return new Response(JSON.stringify({ error: "Incorrect Admin Password" }), { status: 401, headers });
      }

      if (env.SHARED_DATA && body.tickers) {
        // Save the new list to the global database
        await env.SHARED_DATA.put("scannerPool", JSON.stringify(body.tickers));
        return new Response(JSON.stringify({ success: true, tickers: body.tickers }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: "Cloudflare KV not bound correctly." }), { status: 500, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers });
}
