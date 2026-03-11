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
    const sector = searchParams.get("sector");

    // Build query — filter by sector if provided
    const sectorClause = sector
      ? `AND sector = '${sector.replace(/'/g, "''")}'`
      : "";

    const query = `
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
      ${sectorClause}
      ORDER BY rank_overall ASC
      LIMIT 25;
    `;

    // Use Neon's HTTP API — no driver needed in Cloudflare Workers
    const neonRes = await fetch(DATABASE_URL.replace("postgresql://", "https://").split("@")[0].replace("https://", `https://${DATABASE_URL.split("@")[1]?.split("/")[0]}/sql`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    // Neon serverless HTTP endpoint
    const response = await fetch(
      `https://${new URL(DATABASE_URL.replace("postgresql://", "https://")).host}/sql`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DATABASE_URL.split(":")[2]?.split("@")[0]}`,
          "Neon-Connection-String": DATABASE_URL,
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ success: false, message: `DB error: ${errText}` }),
        { status: 500, headers }
      );
    }

    const result = await response.json();
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
