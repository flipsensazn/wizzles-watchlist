// functions/x-feed.js
// Fetches @wallstengine posts via Nitter RSS (no X API key required)

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=300",  // 5-min cache
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

  // Try multiple Nitter instances in case one is down
  const NITTER_INSTANCES = [
    "https://nitter.poast.org/wallstengine/rss",
    "https://nitter.privacydev.net/wallstengine/rss",
    "https://nitter.net/wallstengine/rss",
  ];

  for (const url of NITTER_INSTANCES) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        cf: { cacheTtl: 300 },
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const posts = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

      for (const match of itemMatches) {
        const body = match[1];

        // Strip CDATA wrappers from title
        const rawTitle = (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                          body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";

        const link    = (body.match(/<link>(.*?)<\/link>/) || [])[1] || "";
        const pubDate = (body.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";

        // Clean up the title — remove @wallstengine prefix if Nitter adds it
        const title = rawTitle.replace(/^R to @\S+:\s*/i, "").trim();

        if (title && link) {
          posts.push({ title, link, pubDate });
        }
        if (posts.length >= 20) break;
      }

      if (posts.length > 0) {
        return new Response(JSON.stringify({ posts }), { status: 200, headers });
      }

    } catch (err) {
      // Try next instance
      continue;
    }
  }

  // All instances failed
  return new Response(
    JSON.stringify({ posts: [], error: "All Nitter instances unavailable" }),
    { status: 200, headers }   // Return 200 so frontend handles gracefully
  );
}
