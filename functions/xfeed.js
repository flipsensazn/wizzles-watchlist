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
    // We use Twitter's own internal Syndication API (the one their widgets use)
    // This bypasses Nitter and doesn't require an API key.
    const url = "https://syndication.twitter.com/srv/timeline-profile/screen-name/wallstengine";
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch from X/Twitter." }), { status: 502, headers });
    }

    const html = await res.text();
    
    // The timeline data is injected into the HTML as a massive JSON object
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match || !match[1]) {
      return new Response(JSON.stringify({ error: "Could not locate feed data." }), { status: 500, headers });
    }

    const data = JSON.parse(match[1]);
    const tweets = [];
    
    // Recursively search the JSON tree for tweet objects to protect against X changing their data structure
    function findTweets(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      // If an object has these three fields, it's a tweet
      if (obj.id_str && obj.text && obj.created_at && !obj.retweeted_status_id_str) {
        tweets.push({
          title: obj.text,
          link: `https://x.com/wallstengine/status/${obj.id_str}`,
          pubDate: obj.created_at
        });
      }
      
      for (const key in obj) {
        findTweets(obj[key]);
      }
    }

    findTweets(data);

    // Deduplicate by link and take the most recent 10
    const uniqueTweets = Array.from(new Map(tweets.map(t => [t.link, t])).values());

    return new Response(JSON.stringify({ tweets: uniqueTweets.slice(0, 10) }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
