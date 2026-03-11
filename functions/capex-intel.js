// functions/capex-intel.js
//
// Dynamically queries Google Gemini to get the latest publicly-announced
// hyperscaler AI capex allocations across the 6 infrastructure sectors.
// Results are cached in Cloudflare KV for 6 hours to avoid hammering the API.
//
// GET  /capex-intel   → returns cached or freshly-fetched intel
// POST /capex-intel   → admin-only force-refresh (busts the cache)

const CACHE_KEY = "capexIntel";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in ms
const MODEL     = "gemini-3.1-flash-lite-preview";

const SECTORS = [
  {
    id:          "compute",
    label:       "Compute & Silicon",
    description: "GPU/AI accelerators (NVDA, AMD), memory & HBM (MU, WDC), custom ASICs/TPUs (AVGO, MRVL), leading-edge foundry (TSM), semiconductor equipment (AMAT, LRCX, ASML), advanced packaging",
  },
  {
    id:          "networking",
    label:       "Networking & Connectivity",
    description: "Ethernet switching (ANET, CSCO), optical transceivers 400G/800G (LITE, COHR), cables & connectors, cybersecurity infrastructure (PANW, CRWD)",
  },
  {
    id:          "photonics",
    label:       "Photonics & Interconnects",
    description: "Optical engines, InP substrate & epiwafers, epitaxy equipment (VECO), silicon photonics foundry, high-speed interconnects",
  },
  {
    id:          "neoclouds",
    label:       "Neoclouds & Data Centers",
    description: "Hyperscale REIT construction (EQIX, DLR), GPU cloud operators / neoclouds (CoreWeave, IREN, APLD), AI server infrastructure (SMCI, VRT), MEP contractors (FIX, EME, MTZ)",
  },
  {
    id:          "power",
    label:       "Power & Cooling",
    description: "Power generation & utilities (VST, NEE, BE), nuclear (OKLO, SMR), UPS/power management (ETN, VRT), liquid & immersion cooling",
  },
  {
    id:          "frontier",
    label:       "Frontier / Speculative",
    description: "Quantum computing, neuromorphic AI, space (RKLB, ASTS), SaaS platforms (PLTR, SNOW, NOW), robotics, precious metals hedge",
  },
];

function buildPrompt() {
  return `You are a financial analyst specialising in AI infrastructure capital expenditure.

The five primary hyperscalers—Amazon (AWS), Microsoft (Azure), Alphabet/Google, Meta, and Oracle—have collectively announced roughly $600 billion or more in AI-related capex for 2025-2026, based on their most recent earnings calls, investor-day presentations, and SEC filings.

Based on your knowledge of their public guidance and capital allocation priorities, estimate how this total spend flows across the following six infrastructure sectors.

Sectors to allocate:
${SECTORS.map(s => `• ${s.id} — "${s.label}": ${s.description}`).join("\n")}

Guidelines:
- The six sectors should sum to roughly 600 (i.e., $600 B total).
- "Compute & Silicon" (chips + foundry + equipment) typically absorbs the largest share (~25-35%).
- "Neoclouds & Data Centers" (physical build-out) is the second-largest (~18-22%).
- Use your best estimate for sectors where direct figures are unavailable, flagging confidence accordingly.
- Include a one-sentence rationale citing the basis for each sector's allocation.

Respond with ONLY a valid JSON array — no markdown fences, no preamble, no explanation outside the JSON:

[
  {
    "id": "compute",
    "capex": <integer, billions USD>,
    "value": "<display string e.g. ~$185B>",
    "rationale": "<one sentence explaining the basis for this allocation>",
    "confidence": "high|medium|low"
  },
  ...six objects total...
]`;
}

export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "";
  const origin         = request.headers.get("Origin") || "";
  const corsOrigin     = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // ── POST: admin-only cache-bust ───────────────────────────────────────────
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const adminPassword = env.ADMIN_PASSWORD;
      if (!adminPassword || body.password !== adminPassword) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }
      if (env.SHARED_DATA) await env.SHARED_DATA.delete(CACHE_KEY);
      return new Response(JSON.stringify({ success: true, message: "Cache cleared — next GET will fetch live intel." }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  // ── GET: serve from cache or fetch fresh ─────────────────────────────────
  if (request.method === "GET") {
    try {
      // 1. Try KV cache first
      if (env.SHARED_DATA) {
        const cached = await env.SHARED_DATA.get(CACHE_KEY, "json");
        if (cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return new Response(JSON.stringify({ ...cached, fromCache: true }), { status: 200, headers });
        }
      }

      // 2. Cache miss — call Gemini (15s timeout)
      const geminiKey = env.GEMINI_API_KEY;
      if (!geminiKey) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY not set. Add it as a Cloudflare Pages environment variable." }),
          { status: 500, headers }
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let geminiRes;
      try {
        geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`,
          {
            method:  "POST",
            signal:  controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: buildPrompt() }] }],
              generationConfig: {
                temperature:     0.2,
                maxOutputTokens: 1500,
              },
            }),
          }
        );
      } catch (fetchErr) {
        const msg = fetchErr.name === "AbortError" ? "Gemini request timed out after 15s" : fetchErr.message;
        return new Response(JSON.stringify({ error: msg }), { status: 502, headers });
      } finally {
        clearTimeout(timeout);
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        let errDetail = errText;
        try {
          const errJson = JSON.parse(errText);
          errDetail = errJson?.error?.message || errText;
        } catch (_) {}
        return new Response(
          JSON.stringify({ error: `Gemini API error ${geminiRes.status}`, detail: errDetail }),
          { status: 502, headers }
        );
      }

      const geminiData = await geminiRes.json();

      // Extract text from Gemini response structure
      const textContent = geminiData?.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join("") ?? "";

      if (!textContent) {
        return new Response(
          JSON.stringify({ error: "Empty response from Gemini", raw: JSON.stringify(geminiData) }),
          { status: 500, headers }
        );
      }

      // Parse JSON — strip any accidental markdown fences
      let allocations;
      try {
        const clean = textContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        allocations = JSON.parse(clean);
        if (!Array.isArray(allocations)) throw new Error("Expected a JSON array");
      } catch (parseErr) {
        return new Response(
          JSON.stringify({ error: "Failed to parse Gemini response as JSON", raw: textContent }),
          { status: 500, headers }
        );
      }

      // Validate sectors
      const validIds = new Set(SECTORS.map(s => s.id));
      allocations = allocations.filter(a => a.id && validIds.has(a.id) && typeof a.capex === "number");

      const result = {
        allocations,
        fetchedAt: Date.now(),
        model:     MODEL,
        note:      "Allocations derived from Gemini based on public hyperscaler filings and earnings calls.",
      };

      // 3. Persist to KV for 6 hours
      if (env.SHARED_DATA) {
        await env.SHARED_DATA.put(CACHE_KEY, JSON.stringify(result));
      }

      return new Response(JSON.stringify({ ...result, fromCache: false }), { status: 200, headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers });
}
