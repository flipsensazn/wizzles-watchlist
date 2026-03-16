// functions/cnn-fear-greed.js

export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS for your app
  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "*";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=900"
  };

  try {
    // CNN's internal, undocumented data endpoint
    const cnnUrl = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
    
    // We must mimic a real browser to avoid being blocked
    const response = await fetch(cnnUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    });

    if (!response.ok) throw new Error("Failed to fetch from CNN");

    const data = await response.json();
    
    // Extract the current score and text label (e.g., "Extreme Greed")
    const currentScore = data.fear_and_greed.score;
    const currentRating = data.fear_and_greed.rating;

    return new Response(JSON.stringify({ 
      score: Math.round(currentScore), 
      label: currentRating 
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
