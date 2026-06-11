// functions/capex-history.js
//
// GET /capex-history — the capex guidance time series. Every fresh
// capex-intel reading is appended to Neon (see persistHistory in
// capex-intel.js); this endpoint serves the trend so the UI can show the
// FIRST DERIVATIVE of hyperscaler guidance — the actual signal.
//
//   { success: true, history: [{ fetchedAt, total, byCompany }] }   (oldest → newest)

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Vary": "Origin",
    // New readings land at most every 6h — cache browser 30 min, edge 3h
    "Cache-Control": "public, max-age=1800, s-maxage=10800",
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
    const url  = new URL(DATABASE_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    const host = url.hostname;

    // Last 180 days, thinned to one reading per day (the latest) so the
    // payload stays small no matter how often intel refreshes.
    const sqlQuery = `
      SELECT DISTINCT ON (fetched_at::date)
        fetched_at, total_capex, by_company
      FROM capex_intel_history
      WHERE fetched_at > now() - interval '180 days'
      ORDER BY fetched_at::date, fetched_at DESC
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
      console.error("capex-history DB query failed", { status: dbRes.status, detail: errText });
      return new Response(
        JSON.stringify({ success: false, message: "History is temporarily unavailable." }),
        { status: 500, headers }
      );
    }

    const result = await dbRes.json();
    const rows   = result.rows ?? [];

    const history = rows.map(row => {
      let byCompany = row.by_company;
      if (typeof byCompany === "string") {
        try { byCompany = JSON.parse(byCompany); } catch { byCompany = null; }
      }
      return {
        fetchedAt: row.fetched_at,
        total: row.total_capex != null ? Number(row.total_capex) : null,
        byCompany: byCompany ?? null,
      };
    }).sort((a, b) => new Date(a.fetchedAt) - new Date(b.fetchedAt));

    return new Response(
      JSON.stringify({ success: true, count: history.length, history }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("capex-history unexpected error", err);
    return new Response(
      JSON.stringify({ success: false, message: "History is temporarily unavailable." }),
      { status: 500, headers }
    );
  }
}
