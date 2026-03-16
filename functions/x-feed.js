// functions/x-feed.js
// Fetches @wallstengine posts via RSS proxy (no X API key required)

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=300",
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

  // ── Strategy 1: RSS2JSON public API (most reliable from CF edge) ──────────
  try {
    const nitterRss = encodeURIComponent("https://nitter.poast.org/wallstengine/rss");
    const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${nitterRss}&count=20`;

    const res = await fetch(rss2jsonUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 300 },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok" && data.items?.length > 0) {
        const posts = data.items.map(item => ({
          title: (item.title || "").replace(/^R to @\S+:\s*/i, "").trim(),
          link:  item.link  || "",
          pubDate: item.pubDate || "",
        })).filter(p => p.title && p.link);

        if (posts.length > 0) {
          return new Response(JSON.stringify({ posts, source: "rss2json" }), { status: 200, headers });
        }
      }
    }
  } catch (e) {
    // fall through to next strategy
  }

  // ── Strategy 2: RSSHub hosted instance (alternative proxy) ────────────────
  const RSSHUB_INSTANCES = [
    "https://rsshub.app/twitter/user/wallstengine",
    "https://rsshub.rssforever.com/twitter/user/wallstengine",
  ];

  for (const url of RSSHUB_INSTANCES) {
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
        const rawTitle =
          (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
           body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
        const link    = (body.match(/<link>([^<]*)<\/link>/)    || [])[1] || "";
        const pubDate = (body.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
        const title   = rawTitle.replace(/<[^>]+>/g, "").replace(/^R to @\S+:\s*/i, "").trim();

        if (title && link) posts.push({ title, link, pubDate });
        if (posts.length >= 20) break;
      }

      if (posts.length > 0) {
        return new Response(JSON.stringify({ posts, source: "rsshub" }), { status: 200, headers });
      }
    } catch (e) {
      continue;
    }
  }

  // ── Strategy 3: Fetch tweets via SocialData unofficial RSS ────────────────
  try {
    const socialUrl = "https://socialdata.tools/twitter/user/wallstengine/tweets.rss";
    const res = await fetch(socialUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 300 },
    });

    if (res.ok) {
      const xml = await res.text();
      const posts = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

      for (const match of itemMatches) {
        const body = match[1];
        const rawTitle =
          (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
           body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
        const link    = (body.match(/<link>([^<]*)<\/link>/)    || [])[1] || "";
        const pubDate = (body.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
        const title   = rawTitle.replace(/<[^>]+>/g, "").trim();

        if (title && link) posts.push({ title, link, pubDate });
        if (posts.length >= 20) break;
      }

      if (posts.length > 0) {
        return new Response(JSON.stringify({ posts, source: "socialdata" }), { status: 200, headers });
      }
    }
  } catch (e) {
    // fall through
  }

  // ── All strategies failed ─────────────────────────────────────────────────
  return new Response(
    JSON.stringify({ posts: [], error: "All feed sources unavailable" }),
    { status: 200, headers }
  );
}
