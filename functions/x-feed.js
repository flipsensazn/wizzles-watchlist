// functions/x-feed.js
// This endpoint is intentionally minimal — the browser fetches X/RSS directly
// via a CORS proxy to avoid Cloudflare edge IP blocks on Nitter/XCancel.
// This file exists only to satisfy any direct /x-feed calls gracefully.

export async function onRequest(context) {
  const { request, env } = context;
  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const corsOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  // Tell the frontend to use browser-side fetching instead
  return new Response(JSON.stringify({ posts: [], useBrowserFetch: true }), { status: 200, headers });
}
