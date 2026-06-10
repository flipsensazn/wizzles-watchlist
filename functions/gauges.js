// functions/gauges.js
//
// GET /gauges — serves the SEC XBRL supply-chain gauges produced by
// src/xbrl_gauges.py (weekly GitHub Actions ETL → Neon).
//
// Returns the most recent run's row per ticker:
//
//   { success: true, data: { ANET: { latestQuarterEnd, revenueYoy, rpoYoy,
//                                    orderGap, backlogScore, ... }, ... } }

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Vary": "Origin",
    // ETL runs weekly — cache browser 30 min, CDN edge 6 hours
    "Cache-Control": "public, max-age=1800, s-maxage=21600",
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
    // Convert the connection string into the Neon HTTP SQL endpoint.
    const url  = new URL(DATABASE_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    const host = url.hostname;

    // Latest run per ticker (runs are keyed by as_of_date).
    const sqlQuery = `
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of_date DESC) AS rn
        FROM xbrl_gauges
      )
      SELECT ticker, as_of_date, latest_quarter_end, revenue_q, revenue_yoy,
             inventory, inventory_yoy, inventory_days, inventory_days_yoy,
             rpo, rpo_yoy, rpo_to_ttm_revenue, order_gap, backlog_score
      FROM ranked WHERE rn = 1 ORDER BY ticker
    `;

    const dbRes = await fetch(`https://${host}/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": DATABASE_URL,
      },
      body: JSON.stringify({ query: sqlQuery }),
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      console.error("gauges DB query failed", { status: dbRes.status, detail: errText });
      return new Response(
        JSON.stringify({ success: false, message: "Gauge data is temporarily unavailable." }),
        { status: 500, headers }
      );
    }

    const result = await dbRes.json();
    const rows   = result.rows ?? [];

    const num = v => (v != null ? Number(v) : null);
    const data = {};
    for (const row of rows) {
      data[row.ticker] = {
        asOfDate:         row.as_of_date,
        latestQuarterEnd: row.latest_quarter_end,
        revenueQ:         num(row.revenue_q),
        revenueYoy:       num(row.revenue_yoy),
        inventory:        num(row.inventory),
        inventoryYoy:     num(row.inventory_yoy),
        inventoryDays:    num(row.inventory_days),
        inventoryDaysYoy: num(row.inventory_days_yoy),
        rpo:              num(row.rpo),
        rpoYoy:           num(row.rpo_yoy),
        rpoToTtmRevenue:  num(row.rpo_to_ttm_revenue),
        orderGap:         num(row.order_gap),
        backlogScore:     num(row.backlog_score),
      };
    }

    return new Response(
      JSON.stringify({ success: true, count: Object.keys(data).length, data }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("gauges unexpected error", err);
    return new Response(
      JSON.stringify({ success: false, message: "Gauge data is temporarily unavailable." }),
      { status: 500, headers }
    );
  }
}
