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
    
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match || !match[1]) {
      return new Response(JSON.stringify({ error: "Could not locate feed data." }), { status: 500, headers });
    }

    const data = JSON.parse(match[1]);
    const entries = data?.props?.pageProps?.timeline?.entries || [];
    
    let tweets = [];

    // Path 1: Parse the official timeline array. 
    // This ensures we only get feed items and ignore the "What's Happening" trending sidebar data.
    if (entries.length > 0) {
      for (const entry of entries) {
        if (entry.entryId && entry.entryId.startsWith("tweet-") && entry.content?.tweet) {
          const t = entry.content.tweet;
          const author = t.user?.screen_name;
          tweets.push({
            // If it's a retweet, add an RT tag so the UI makes sense
            title: author && author.toLowerCase() !== "wallstengine" ? `RT @${author}: ${t.text}` : t.text,
            link: `https://x.com/${author || 'wallstengine'}/status/${t.id_str}`,
            pubDate: t.created_at,
            timestamp: new Date(t.created_at).getTime()
          });
        }
      }
    }

    // Path 2: Fallback recursive search if X unexpectedly changes their JSON layout.
    // Strictly filtered to ONLY pull tweets authored by the target account.
    if (tweets.length === 0) {
      function findTweets(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.id_str && obj.text && obj.created_at) {
          if (obj.user?.screen_name?.toLowerCase() === "wallstengine") {
            tweets.push({
              title: obj.text,
              link: `https://x.com/wallstengine/status/${obj.id_str}`,
              pubDate: obj.created_at,
              timestamp: new Date(obj.created_at).getTime()
            });
            return; // Stop digging here so we don't grab nested quote-tweet data
          }
        }
        for (const key in obj) {
          findTweets(obj[key]);
        }
      }
      findTweets(data);
    }

    // Deduplicate by link
    const uniqueMap = new Map();
    tweets.forEach(t => uniqueMap.set(t.link, t));
    const uniqueTweets = Array.from(uniqueMap.values());

    // Sort chronologically (newest first) to fix Pinned Tweets throwing off the order
    uniqueTweets.sort((a, b) => b.timestamp - a.timestamp);

    return new Response(JSON.stringify({ tweets: uniqueTweets.slice(0, 10) }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
