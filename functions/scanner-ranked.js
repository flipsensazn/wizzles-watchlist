// functions/scanner-ranked.js

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
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const DATABASE_URL = env.DATABASE_URL;
  if (!DATABASE_URL) {
    return new Response(
      JSON.stringify({ success: false, message: "DATABASE_URL not configured." }),
      { status: 500, headers }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const sector = searchParams.get("sector") || null;

    // Neon supports direct SQL over HTTP using the connection string
    // Extract credentials from the DATABASE_URL
    const url = new URL(DATABASE_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    const username = url.username;
    const password = url.password;
    const host = url.hostname;
    const database = url.pathname.replace("/", "");

    const sectorFilter = sector ? `AND sector = $1` : "";
    const queryParams  = sector ? [sector] : [];

    const sqlQuery = `
      WITH LatestDate AS (
        SELECT MAX(as_of_date) AS max_date FROM ranked_candidates
      )
      SELECT
        rank_overall,
        ticker,
        company_name,
        sector,
        industry,
        market_cap,
        price,
        fcf_yield,
        book_to_market,
        roa,
        asset_growth_yoy,
        composite_score
      FROM ranked_candidates
      WHERE as_of_date = (SELECT max_date FROM LatestDate)
      ${sectorFilter}
      ORDER BY rank_overall ASC
      LIMIT 25
    `;

    // Neon HTTP SQL API endpoint
    const neonEndpoint = `https://${host}/sql`;

    const dbRes = await fetch(neonEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(`${username}:${password}`),
        "Neon-Connection-String": DATABASE_URL,
      },
      body: JSON.stringify({
        query: sqlQuery,
        params: queryParams,
      }),
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      return new Response(
        JSON.stringify({ success: false, message: `DB query failed: ${errText}` }),
        { status: 500, headers }
      );
    }

    const result = await dbRes.json();
    const rows = result.rows ?? [];

    return new Response(
      JSON.stringify({ success: true, count: rows.length, data: rows }),
      { status: 200, headers }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { status: 500, headers }
    );
  }
}
