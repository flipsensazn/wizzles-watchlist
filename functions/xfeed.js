// functions/xfeed.js

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300", // Cache for 5 mins to prevent rate limiting
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }

  // A list of public Nitter instances to use as our free scraping proxies
  const instances = [
    "https://nitter.poast.org",
    "https://xcancel.com",
    "https://nitter.privacydev.net"
  ];
  
  const username = "wallstengine";
  let xmlText = null;

  // Try each instance until one succeeds
  for (const instance of instances) {
    try {
      const res = await fetch(`${instance}/${username}/rss`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      
      if (res.ok) {
        xmlText = await res.text();
        break; // Success, exit the loop
      }
    } catch (e) {
      console.warn(`Failed to fetch from ${instance}`);
    }
  }

  if (!xmlText) {
    return new Response(JSON.stringify({ error: "All scraper endpoints failed to respond." }), { status: 502, headers });
  }

  // Cloudflare Workers don't have DOMParser, so we use Regex to extract the RSS data
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>([\s\S]*?)<\/title>/;
  const linkRegex = /<link>([\s\S]*?)<\/link>/;
  const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;

  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    const titleMatch = titleRegex.exec(itemContent);
    const linkMatch = linkRegex.exec(itemContent);
    const pubDateMatch = pubDateRegex.exec(itemContent);

    if (titleMatch && linkMatch) {
      // Clean up CDATA tags and HTML entities
      let title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      // Unescape common HTML entities
      title = title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

      items.push({
        title: title,
        link: linkMatch[1].trim(),
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : null
      });
    }
  }

  // Return the 10 most recent posts
  return new Response(JSON.stringify({ tweets: items.slice(0, 10) }), { status: 200, headers });
}
