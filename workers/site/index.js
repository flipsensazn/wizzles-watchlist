// workers/site — the site Worker (Workers + static assets).
//
// This replaces the Cloudflare Pages deployment. The existing files in
// functions/ are unchanged Pages Functions — this router gives each one the
// same {request, env} context Pages did, keyed by its old file-based route.
// Anything that isn't an API route falls through to the static assets
// (the Vite build in dist/, single-page-application fallback).
//
// Deploy: npx vite build (repo root), then npx wrangler deploy (this dir).
// CI does exactly that on every merge to main (.github/workflows/deploy-site.yml).

import * as analyze        from "../../functions/analyze.js";
import * as candidates     from "../../functions/candidates.js";
import * as capexHistory   from "../../functions/capex-history.js";
import * as capexIntel     from "../../functions/capex-intel.js";
import * as capex          from "../../functions/capex.js";
import * as cnnFearGreed   from "../../functions/cnn-fear-greed.js";
import * as composite      from "../../functions/composite.js";
import * as exposure       from "../../functions/exposure.js";
import * as gapScanner     from "../../functions/gap-scanner.js";
import * as gauges         from "../../functions/gauges.js";
import * as marketNews     from "../../functions/market-news.js";
import * as muskCapex      from "../../functions/musk-capex.js";
import * as muskIntel      from "../../functions/musk-intel.js";
import * as news           from "../../functions/news.js";
import * as presence       from "../../functions/presence.js";
import * as prices         from "../../functions/prices.js";
import * as quote          from "../../functions/quote.js";
import * as roboticsCapex  from "../../functions/robotics-capex.js";
import * as roboticsIntel  from "../../functions/robotics-intel.js";
import * as scannerRanked  from "../../functions/scanner-ranked.js";
import * as scanner        from "../../functions/scanner.js";
import * as scoreboard     from "../../functions/scoreboard.js";
import * as shortlist      from "../../functions/shortlist.js";
import * as stress         from "../../functions/stress.js";

const ROUTES = {
  "/analyze":         analyze,
  "/candidates":      candidates,
  "/capex-history":   capexHistory,
  "/capex-intel":     capexIntel,
  "/capex":           capex,
  "/cnn-fear-greed":  cnnFearGreed,
  "/composite":       composite,
  "/exposure":        exposure,
  "/gap-scanner":     gapScanner,
  "/gauges":          gauges,
  "/market-news":     marketNews,
  "/musk-capex":      muskCapex,
  "/musk-intel":      muskIntel,
  "/news":            news,
  "/presence":        presence,
  "/prices":          prices,
  "/quote":           quote,
  "/robotics-capex":  roboticsCapex,
  "/robotics-intel":  roboticsIntel,
  "/scanner-ranked":  scannerRanked,
  "/scanner":         scanner,
  "/scoreboard":      scoreboard,
  "/shortlist":       shortlist,
  "/stress":          stress,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const route = ROUTES[pathname.replace(/\/$/, "") || "/"];
    if (route?.onRequest) {
      // Pages Functions context shim — every function here uses only
      // {request, env}; waitUntil included for safety.
      return route.onRequest({
        request,
        env,
        params: {},
        data: {},
        functionPath: pathname,
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: () => {},
        next: () => env.ASSETS.fetch(request),
      });
    }
    return env.ASSETS.fetch(request);
  },
};
