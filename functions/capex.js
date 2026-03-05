// functions/capex.js
export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // EVERYONE: Read the global sub-sector list
  if (request.method === "GET") {
    try {
      const data = env.SHARED_DATA ? await env.SHARED_DATA.get("capexData", "json") : null;
      // If no data exists yet, return null so the frontend uses its default list
      return new Response(JSON.stringify({ capexData: data }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ capexData: null, error: err.message }), { status: 200, headers });
    }
  }

  // ADMIN ONLY: Update the global sub-sector list
  if (request.method === "POST") {
    try {
      const body = await request.json();

      if (body.password !== "Cisco123") {
        return new Response(JSON.stringify({ error: "Incorrect Admin Password" }), { status: 401, headers });
      }

      if (env.SHARED_DATA && body.capexData) {
        await env.SHARED_DATA.put("capexData", JSON.stringify(body.capexData));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: "Cloudflare KV not bound correctly." }), { status: 500, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers });
}
