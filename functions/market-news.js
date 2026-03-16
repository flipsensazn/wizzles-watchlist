// functions/market-news.js

export async function onRequest(context) {
  const { request } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=180", // Cache for 3 minutes to stay fresh but prevent rate-limits
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }

  const feeds = [
    { name: "Tech", url: "https://feeds.bloomberg.com/technology/news.rss" },
    { name: "Markets", url: "https://feeds.bloomberg.com/markets/news.rss" },
    { name: "Crypto", url: "https://feeds.bloomberg.com/crypto/news.rss" }
  ];

  try {
    let allItems = [];

    // Fetch all feeds in parallel
    const responses = await Promise.all(feeds.map(f => fetch(f.url, {
       headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    })));
    
    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      if (!res.ok) continue;
      
      const xmlText = await res.text();
      const feedName = feeds[i].name;

      // Extract RSS items
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
      const linkRegex = /<link>([\s\S]*?)<\/link>/;
      const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;

      let match;
      while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];
        const titleMatch = titleRegex.exec(itemContent);
        const linkMatch = linkRegex.exec(itemContent);
        const pubDateMatch = pubDateRegex.exec(itemContent);

        if (titleMatch && linkMatch && pubDateMatch) {
          let title = (titleMatch[1] || titleMatch[2]).trim();
          // Unescape common HTML entities
          title = title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

          const pubDateStr = pubDateMatch[1].trim();
          const pubDateObj = new Date(pubDateStr);

          allItems.push({
            title,
            link: linkMatch[1].trim(),
            timestamp: pubDateObj.getTime(),
            category: feedName
          });
        }
      }
    }

    // Filter to ONLY show posts from the current calendar day (using NY Market Time)
    const formatter = new Intl.DateTimeFormat("en-US", { 
      timeZone: "America/New_York", 
      year: "numeric", month: "2-digit", day: "2-digit" 
    });
    const todayStr = formatter.format(new Date());

    const todaysItems = allItems.filter(item => {
       const itemDateStr = formatter.format(new Date(item.timestamp));
       return itemDateStr === todayStr; // Keep only if it matches today's date
    });

    // Sort chronologically by newest first
    todaysItems.sort((a, b) => b.timestamp - a.timestamp);

    // Deduplicate by URL (in case an article overlaps feeds)
    const uniqueMap = new Map();
    todaysItems.forEach(t => uniqueMap.set(t.link, t));
    const uniqueItems = Array.from(uniqueMap.values());

    return new Response(JSON.stringify({ news: uniqueItems }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
