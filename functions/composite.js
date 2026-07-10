// functions/composite.js
//
// GET /composite — the Composite Bottleneck Score produced weekly by
// src/composite_score.py (transcript stress + XBRL gauges + filed customer
// concentration, blended and snapshotted to Neon).
//
//   { success: true, data: { AXTI: {
//       score, direction, prevScore, delta,
//       parts: { transcript, gauge, concentration },   // component scores
//       history: [{ date, score }, ...]                // oldest → newest, ~12 weeks
//   } } }

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Vary": "Origin",
    // Weekly snapshots — browser 30 min, edge 6 hours
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
    const url  = new URL(DATABASE_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    const host = url.hostname;

    const sqlQuery = `
      SELECT ticker, as_of_date, composite,
             transcript_score, transcript_direction,
             gauge_score, concentration_score
      FROM composite_scores
      WHERE as_of_date > now() - interval '90 days'
      ORDER BY ticker, as_of_date ASC
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
      const detail = await dbRes.text();
      // Table won't exist until the first ETL run — serve an empty map.
      if (/does not exist/i.test(detail)) {
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers });
      }
      console.error("composite DB query failed", { status: dbRes.status, detail });
      return new Response(
        JSON.stringify({ success: false, message: "Composite data is temporarily unavailable." }),
        { status: 500, headers }
      );
    }

    const rows = (await dbRes.json()).rows ?? [];
    const num = v => (v != null ? Number(v) : null);

    const data = {};
    for (const row of rows) {
      const entry = (data[row.ticker] ??= { history: [] });
      entry.history.push({ date: row.as_of_date, score: num(row.composite) });
      // rows arrive oldest → newest, so the last write wins as "latest"
      entry.score = num(row.composite);
      entry.direction = row.transcript_direction;
      entry.parts = {
        transcript: num(row.transcript_score),
        gauge: num(row.gauge_score),
        concentration: num(row.concentration_score),
      };
    }
    for (const entry of Object.values(data)) {
      const h = entry.history;
      entry.prevScore = h.length >= 2 ? h[h.length - 2].score : null;
      entry.delta = entry.prevScore != null && entry.score != null
        ? +(entry.score - entry.prevScore).toFixed(1) : null;
    }

    return new Response(
      JSON.stringify({ success: true, count: Object.keys(data).length, data }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("composite unexpected error", err);
    return new Response(
      JSON.stringify({ success: false, message: "Composite data is temporarily unavailable." }),
      { status: 500, headers }
    );
  }
}
