// functions/xfeed.js

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300", 
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }

  try {
    // The official Twitter syndication API (used by their own embeds)
    const url = "https://syndication.twitter.com/srv/timeline-profile/screen-name/wallstengine";
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch from Twitter Syndication" }), { status: 502, headers });
    }

    const html = await res.text();
    
    // The JSON data is embedded inside the HTML in a __NEXT_DATA__ script tag
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    
    if (!match || !match[1]) {
      return new Response(JSON.stringify({ error: "Could not parse Twitter data" }), { status: 500, headers });
    }

    const data = JSON.parse(match[1]);
    const timeline = data?.props?.pageProps?.timeline?.entries || [];

    const tweets = [];
    
    for (const entry of timeline) {
      // Filter for actual tweets (ignore cursors, generic items)
      if (entry.type === "TimelineTimelineItem" && entry.content?.tweet) {
        const tweetContent = entry.content.tweet;
        const text = tweetContent.text || "";
        const id = tweetContent.id_str;
        const date = tweetContent.created_at; // "Wed Oct 10 20:19:24 +0000 2018"
        
        if (text && id) {
          tweets.push({
            title: text.length > 100 ? text.substring(0, 100) + "..." : text,
            link: \`https://twitter.com/wallstengine/status/\${id}\`,
            pubDate: date
          });
        }
      }
    }

    return new Response(JSON.stringify({ tweets: tweets.slice(0, 10) }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
