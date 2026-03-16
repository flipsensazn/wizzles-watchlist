// functions/x-feed.js
// Fetches @wallstengine posts via XCancel RSS (most reliable from CF edge)

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

  // All RSS endpoint candidates in priority order
  const FEED_URLS = [
    "https://xcancel.com/wallstengine/rss",
    "https://nitter.net/wallstengine/rss",
    "https://nitter.poast.org/wallstengine/rss",
    "https://nitter.privacydev.net/wallstengine/rss",
    "https://nitter.space/wallstengine/rss",
    "https://nitter.1d4.us/wallstengine/rss",
  ];

  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        cf: { cacheTtl: 300 },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      if (!xml.includes("<item>")) continue;

      const posts = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

      for (const match of itemMatches) {
        const body = match[1];

        const rawTitle =
          (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
           body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";

        const link    = (body.match(/<link>([^<]*)<\/link>/)    || [])[1] || 
                        (body.match(/<guid[^>]*>([^<]*)<\/guid>/) || [])[1] || "";
        const pubDate = (body.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";

        // Strip HTML tags and clean up prefixes Nitter/XCancel add
        const title = rawTitle
          .replace(/<[^>]+>/g, "")
          .replace(/^R to @\S+:\s*/i, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .trim();

        if (title && link) posts.push({ title, link, pubDate });
        if (posts.length >= 20) break;
      }

      if (posts.length > 0) {
        const source = new URL(url).hostname;
        return new Response(
          JSON.stringify({ posts, source }),
          { status: 200, headers }
        );
      }
    } catch (e) {
      continue;
    }
  }

  return new Response(
    JSON.stringify({ posts: [], error: "All feed sources unavailable" }),
    { status: 200, headers }
  );
}
