import { useState, useEffect, useCallback, useRef, memo } from "react";

// ── MARKET DATA ───────────────────────────────────────────
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

// PERF: No longer return or store histories — sparklines removed
async function fetchLivePrices(tickers) {
  try {
    const res = await fetch(`/.netlify/functions/prices?tickers=${tickers.join(",")}`);
    const json = await res.json();
    const prices = {};
    Object.entries(json.data ?? {}).forEach(([ticker, val]) => {
      prices[ticker] = val?.change ?? val;
    });
    return prices;
  } catch (err) {
    console.error("Price fetch failed:", err);
    return {};
  }
}

async function fetchMarketData() {
  try {
    const tickers = [...INDEX_TICKERS, ...CRYPTO_TICKERS, ...HYPERSCALER_TICKERS];
    const res = await fetch(`/.netlify/functions/prices?tickers=${tickers.join(",")}`);
    const json = await res.json();
    return json.data ?? {};
  } catch {
    return {};
  }
}

// ── QUOTE SUMMARY (for company popup) ────────────────────
const quoteCache = {};
async function fetchQuoteSummary(ticker) {
  if (quoteCache[ticker]) return quoteCache[ticker];
  try {
    const url = `/.netlify/functions/quote?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url);
    const json = await res.json();

    // Log the raw payload so we can see exactly what the frontend sees!
    console.log(`[Quote Fetch] Raw JSON for ${ticker}:`, json);

    // Un-wrap the payload just in case the backend nested it inside a "data" property
    const payload = json.data ? json.data : json;
    const r = payload?.quoteSummary?.result?.[0];

    // If we still can't find the result, sound the alarm in the console
    if (!r) {
      console.warn(`[Quote Fetch] Could not find result array for ${ticker}. Payload was:`, payload);
      return null;
    }

    const profile = r.assetProfile ?? {};
    const detail  = r.summaryDetail ?? {};
    const price   = r.price ?? {};

    // A slightly more defensive formatter
    function fmt(n) {
      if (n == null || isNaN(n)) return "—";
      const num = Number(n);
      if (num >= 1e12) return "$" + (num / 1e12).toFixed(2) + "T";
      if (num >= 1e9)  return "$" + (num / 1e9).toFixed(2) + "B";
      if (num >= 1e6)  return "$" + (num / 1e6).toFixed(2) + "M";
      return "$" + num.toLocaleString();
    }

    const data = {
      name:        price.longName || price.shortName || ticker,
      sector:      profile.sector || "—",
      industry:    profile.industry || "—",
      description: profile.longBusinessSummary || null,
      marketCap:   fmt(price.marketCap?.raw ?? price.marketCap),
      peRatio:     detail.trailingPE?.raw != null ? Number(detail.trailingPE.raw).toFixed(1) : "—",
      week52Low:   detail.fiftyTwoWeekLow?.raw != null ? "$" + Number(detail.fiftyTwoWeekLow.raw).toFixed(2) : "—",
      week52High:  detail.fiftyTwoWeekHigh?.raw != null ? "$" + Number(detail.fiftyTwoWeekHigh.raw).toFixed(2) : "—",
      employees:   profile.fullTimeEmployees ? Number(profile.fullTimeEmployees).toLocaleString() : "—",
      country:     profile.country || "—",
      website:     profile.website || null,
    };

    quoteCache[ticker] = data;
    return data;
  } catch (err) {
    // If anything breaks during the mapping process, it will loudly log here
    console.error(`[Quote Fetch] Error mapping data for ${ticker}:`, err);
    return null;
  }
}

// ── DATA ──────────────────────────────────────────────────
const CAPEX_DATA = {
  companies: ["AMZN", "MSFT", "GOOG", "META", "ORCL"],
  tracks: [
    {
      id: "compute", label: "Compute & Silicon", value: "~$180B", capex: 180,
      color: "#60a5fa", borderColor: "#3b82f6",
      subsectors: [
        { id: "gpu", label: "GPU & AI Accelerators", badge: null, tickers: ["NVDA","AMD","INTC"],
          materials: ["Cobalt","Tungsten","Silicon Wafer 300mm","HBM DRAM"] },
        { id: "memory", label: "Memory & Storage", badge: "HBM CRITICAL", badgeColor: "#f59e0b",
          tickers: ["MU","WDC","SNDK"],
          materials: ["HBM3e Stacks","LPDDR5","3D NAND Flash","Silicon Wafer 300mm"] },
        { id: "asic", label: "Custom ASICs & TPUs", badge: null, tickers: ["AVGO","MRVL","QCOM"],
          materials: ["Advanced Packaging CoWoS","HBM","EUV Photomasks"] },
        { id: "foundry", label: "Leading-Edge Foundry", badge: "CAPACITY CONSTRAINED", badgeColor: "#f59e0b",
          tickers: ["TSM","TSEM","GFS"], materials: ["Silicon Carbide","Neon Gas","EUV Resist","Cobalt"] },
        { id: "equip", label: "Semiconductor Equipment", badge: null, tickers: ["AMAT","LRCX","KLAC","ASML","AMKR","ASX"],
          materials: ["Rare Earth Magnets","Fluorine Gas","Quartz"] },
      ],
    },
    {
      id: "networking", label: "Networking & Connectivity", value: "~$50B", capex: 50,
      color: "#34d399", borderColor: "#10b981",
      subsectors: [
        { id: "eth", label: "Ethernet Switching", badge: null, tickers: ["ANET","CSCO","HPE"],
          materials: ["Copper Cat8","PCB Laminate","Silicon"] },
        { id: "trans", label: "Optical Transceivers 400G/800G", badge: "HIGH DEMAND", badgeColor: "#f59e0b",
          tickers: ["LITE","COHR"], materials: ["Indium Phosphide","Gallium Arsenide","Single-Mode Fiber"] },
        { id: "cable", label: "Cables & Connectors", badge: null, tickers: ["FN"],
          materials: ["Copper","Optical Fiber SiO2","Polymer Cladding"] },
      ],
    },
    {
      id: "photonics", label: "Photonics & Optical Interconnect", value: "~$40B", capex: 35,
      color: "#fbbf24", borderColor: "#f59e0b",
      subsectors: [
        { id: "engine", label: "Optical Engine & Transceiver L1", badge: null,
          tickers: ["LITE","COHR","AAOI","ALMU","MTSI","FN","POET"],
          materials: ["InP Chips","Silicon Photonics Dies","Single-Mode Fiber"] },
        { id: "inp", label: "InP Substrate & Epiwafer L2", badge: "EXTREME BOTTLENECK", badgeColor: "#ef4444",
          tickers: ["AXTI","IQEPF","SLOIF"],
          materials: [
            { name: "Indium", constraint: "CRITICAL — 70% supply from China", color: "#ef4444" },
            { name: "Phosphorus", constraint: "Moderate supply risk", color: "#f59e0b" },
            { name: "InP Wafer 2-4\"", constraint: "Capacity severely limited", color: "#ef4444" },
            { name: "Gallium", constraint: "China export controls active", color: "#ef4444" },
          ] },
        { id: "epitaxy", label: "Epitaxy Equipment L3", badge: null, tickers: ["VECO"],
          materials: ["Trimethylindium TMIn","Phosphine PH3","Quartz Chambers"] },
        { id: "siph", label: "SiPh Foundry L4", badge: null, tickers: ["TSEM","GFS"],
          materials: ["Silicon-on-Insulator Wafers","Germanium","TiN Electrodes"] },
      ],
    },
    {
      id: "neoclouds", label: "Neoclouds & Data Centers", value: "~$120B", capex: 120,
      color: "#c084fc", borderColor: "#a855f7",
      subsectors: [
        { id: "reit", label: "Hyperscale REITs", badge: null, tickers: ["EQIX","DLR","AMT","COR"],
          materials: ["Structural Steel","Concrete","Copper Busbar","Fiber"] },
        { id: "neocloud", label: "GPU Cloud Operators", badge: "RAPID GROWTH", badgeColor: "#34d399",
          tickers: ["CIFR","IREN","CORZ","APLD","CRWV","NBIS"],
          materials: ["Power Infrastructure","Cooling Systems","High-density Racks"] },
        { id: "servers", label: "AI Server Infrastructure", badge: null, tickers: ["SMCI","VRT"],
          materials: ["Copper Heat Pipes","PCB","Aluminum Extrusions"] },
      ],
    },
    {
      id: "power", label: "Power & Cooling", value: "~$45B", capex: 45,
      color: "#fb923c", borderColor: "#f97316",
      subsectors: [
        { id: "grid", label: "Power Generation & Utilities", badge: "GRID BOTTLENECK", badgeColor: "#ef4444",
          tickers: ["VST","NEE","BE","LEU","OKLO","SMR"],
          materials: ["Copper Grid","Silicon Steel Transformers","Lithium Storage"] },
        { id: "ups", label: "Power Management & UPS", badge: null, tickers: ["ETN","VRT","PLPC","ENS"],
          materials: ["Silicon Carbide SiC","Electrolytic Capacitors","Copper Winding"] },
        { id: "cooling", label: "Liquid & Immersion Cooling", badge: "EMERGING", badgeColor: "#60a5fa",
          tickers: ["VRT","SMCI","TDC"], materials: ["Dielectric Fluid","Copper Cold Plates","Deionized Water"] },
      ],
    },
    {
      id: "frontier", label: "Frontier / Speculative", value: "Early", capex: 15,
      color: "#f472b6", borderColor: "#ec4899",
      subsectors: [
        { id: "quantum", label: "Quantum Computing", badge: "SPECULATIVE", badgeColor: "#f472b6",
          tickers: ["IONQ","RGTI","QUBT","ARQQ"],
          materials: [
            { name: "Helium-3", constraint: "CRITICAL — extremely scarce", color: "#ef4444" },
            { name: "Niobium", constraint: "Limited processing capacity", color: "#f59e0b" },
            { name: "Sapphire Substrate", constraint: "Moderate availability", color: "#60a5fa" },
          ] },
        { id: "neuro", label: "Neuromorphic & Edge AI", badge: "EARLY STAGE", badgeColor: "#c084fc",
          tickers: ["GTLB","OSS"], materials: ["Phase-Change Materials","Memristive Oxides","Hafnium Oxide"] },
        { id: "space", label: "Space", badge: "EARLY STAGE", badgeColor: "#c084fc",
          tickers: ["TSLA","RKLB","ASTS"], materials: ["Phase-Change Materials","Memristive Oxides","Hafnium Oxide"] },
        { id: "metals", label: "Precious Metals & Commodities", badge: "MACRO HEDGE", badgeColor: "#f59e0b",
          tickers: ["USAS","COPX","SLV","GLD","NEM"],
          materials: [
            { name: "Gold", constraint: "Safe haven demand rising", color: "#f59e0b" },
            { name: "Silver", constraint: "Industrial + monetary demand", color: "#94a3b8" },
            { name: "Copper", constraint: "CRITICAL — AI grid buildout demand", color: "#fb923c" },
          ] },
      ],
    },
  ],
};

function getAllTickers(data = CAPEX_DATA) {
  return [...new Set(data.tracks.flatMap(t => t.subsectors.flatMap(s => s.tickers)))];
}

// ── BADGE ─────────────────────────────────────────────────
// memo: pure display, never needs to re-render
const Badge = memo(function Badge({ text, color }) {
  return (
    <span style={{
      background: color + "22", border: `1px solid ${color}`, color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.15em",
      padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>{text}</span>
  );
});

// ── COMPANY POPUP ─────────────────────────────────────────
function CompanyPopup({ ticker, change, anchorRect, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const popupRef = useRef(null);
  const pos = (change ?? 0) >= 0;
  const changeColor = change === undefined ? "#475569" : pos ? "#34d399" : "#f87171";

  // Fetch on mount
  useEffect(() => {
    setLoading(true);
    fetchQuoteSummary(ticker).then(d => { setData(d); setLoading(false); });
  }, [ticker]);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose();
    }
    // Slight delay so the opening click doesn't immediately close it
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handler(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Smart positioning: try to appear above the anchor, flip below if too close to top
  const POPUP_W = 320;
  const POPUP_H = 300; // approximate
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchorRect ? anchorRect.left : vw / 2 - POPUP_W / 2;
  let top  = anchorRect ? anchorRect.top - POPUP_H - 10 : vh / 2 - POPUP_H / 2;
  // Flip below if not enough space above
  if (top < 10) top = anchorRect ? anchorRect.bottom + 10 : vh / 2 - POPUP_H / 2;
  // Clamp horizontally
  if (left + POPUP_W > vw - 12) left = vw - POPUP_W - 12;
  if (left < 12) left = 12;

  return (
    <div ref={popupRef} style={{
      position: "fixed", top, left, width: POPUP_W, zIndex: 3000,
      background: "rgba(6,3,22,0.97)",
      border: `1px solid ${changeColor}44`,
      borderRadius: 14,
      boxShadow: `0 8px 48px rgba(0,0,0,0.85), 0 0 30px ${changeColor}18`,
      fontFamily: "'DM Mono','Fira Code',monospace",
      animation: "fadeSlideIn .18s ease-out",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        padding: "14px 16px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: `linear-gradient(135deg, ${changeColor}12 0%, transparent 100%)`,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", letterSpacing: "0.04em" }}>{ticker}</span>
            {change !== undefined && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: changeColor,
                background: changeColor + "18", border: `1px solid ${changeColor}44`,
                borderRadius: 5, padding: "1px 7px",
              }}>{pos ? "+" : ""}{change}%</span>
            )}
          </div>
          {data?.name && data.name !== ticker && (
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{data.name}</div>
          )}
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, color: "#64748b", width: 24, height: 24,
          cursor: "pointer", fontSize: 14, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, fontFamily: "inherit",
        }}>×</button>
      </div>

      {/* Body */}
      <div style={{ padding: "12px 16px 14px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, color: "#475569", fontSize: 12 }}>
            Loading…
          </div>
        ) : !data ? (
          <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
            No data available for {ticker}
          </div>
        ) : (
          <>
            {/* Sector / Industry */}
            {(data.sector !== "—" || data.industry !== "—") && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {data.sector !== "—" && (
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa" }}>{data.sector}</span>
                )}
                {data.industry !== "—" && (
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8" }}>{data.industry}</span>
                )}
              </div>
            )}

            {/* Key stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 12 }}>
              {[
                { label: "Market Cap", value: data.marketCap },
                { label: "P/E Ratio",  value: data.peRatio },
                { label: "52W Low",    value: data.week52Low },
                { label: "52W High",   value: data.week52High },
                { label: "Employees",  value: data.employees },
                { label: "Country",    value: data.country },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Description */}
            {data.description && (
              <div style={{
                fontSize: 10.5, color: "#94a3b8", lineHeight: 1.55,
                borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 10,
                display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {data.description}
              </div>
            )}

            {/* Website link */}
            {data.website && (
              <a href={data.website} target="_blank" rel="noopener noreferrer" style={{
                display: "inline-block", marginTop: 10, fontSize: 10, color: "#60a5fa",
                textDecoration: "none", opacity: 0.7,
              }}
                onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>
                {data.website.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── MARKET STRIP ──────────────────────────────────────────
function MarketStrip({ data, tickers, labels, colors }) {
  function formatPrice(p, ticker) {
    if (p === null || p === undefined) return "—";
    if (ticker === "BTC-USD") return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (ticker === "ETH-USD") return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (ticker === "XRP-USD") return "$" + p.toFixed(3);
    return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return (
    <div className="market-strip" style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", padding: "0 20px" }}>
      {tickers.map((ticker, i) => {
        const entry = data[ticker];
        const price = entry?.price;
        const change = entry?.change;
        const pos = (change ?? 0) >= 0;
        return (
          // PERF: backdropFilter removed from each strip pill — was compositing
          // 6 blurred layers simultaneously, expensive on low-end GPUs
          <div key={ticker} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "8px 14px", borderRadius: 10, minWidth: 96,
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${colors[i]}28`,
            transition: "border-color .2s, box-shadow .2s",
            boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = colors[i] + "66"; e.currentTarget.style.boxShadow = `0 0 16px ${colors[i]}22`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = colors[i] + "28"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.3)"; }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors[i], letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{labels[i]}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>
              {formatPrice(price, ticker)}
            </span>
            {change !== undefined && change !== null ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>
                {pos ? "+" : ""}{change.toFixed(2)}%
              </span>
            ) : <span style={{ fontSize: 10, color: "#334155" }}>—</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── TICKER CHIP ───────────────────────────────────────────
// PERF: Removed sparkline tooltip entirely:
//   - No history prop
//   - No mousePos state (was firing setState on every mousemove)
//   - No onMouseMove handler
//   - No isTouchDevice check
//   - No Sparkline SVG render on hover
//   - No backdropFilter on the chip itself
//   - Wrapped in memo so chips only re-render when their own price changes
const TickerChip = memo(function TickerChip({ symbol, change, onRemove, onTickerClick }) {
  const [hovered, setHovered] = useState(false);
  const pos = (change ?? 0) >= 0;
  const changeColor = change === undefined ? "#475569" : pos ? "#34d399" : "#f87171";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => { e.stopPropagation(); onTickerClick?.(symbol, e.currentTarget.getBoundingClientRect()); }}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        background: hovered ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)"}`,
        borderRadius: 8, cursor: "pointer",
        transition: "background .15s, border-color .15s",
        position: "relative",
      }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{symbol}</span>
      {change !== undefined
        ? <span style={{ fontSize: 11, fontWeight: 600, color: changeColor }}>{pos ? "+" : ""}{change}%</span>
        : <span style={{ fontSize: 11, color: "#475569" }}>…</span>}
      {hovered && onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{
            position: "absolute", top: -6, right: -6, width: 16, height: 16,
            borderRadius: "50%", background: "#ef4444", border: "none",
            color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1, padding: 0, fontFamily: "inherit",
          }}>×</button>
      )}
    </div>
  );
});

// ── SUBSECTOR CARD ────────────────────────────────────────
// PERF: backdropFilter removed; histories prop removed
function SubsectorCard({ sub, prices, onAddTicker, onRemoveTicker, onTickerClick }) {
  const [open, setOpen] = useState(false);
  const [addingTicker, setAddingTicker] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const isBottleneck = sub.badge === "EXTREME BOTTLENECK" || sub.badge === "GRID BOTTLENECK";
  const isHot = sub.badge === "HIGH DEMAND" || sub.badge === "RAPID GROWTH";

  function handleAdd() {
    if (newTicker.trim()) { onAddTicker(newTicker.trim()); setNewTicker(""); setAddingTicker(false); }
  }

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${isBottleneck ? "rgba(239,68,68,.35)" : isHot ? "rgba(245,158,11,.25)" : "rgba(255,255,255,0.07)"}`,
      background: isBottleneck ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)",
      padding: 14, display: "flex", flexDirection: "column", gap: 10,
      boxShadow: isBottleneck ? "0 0 20px rgba(239,68,68,0.08)" : "0 2px 16px rgba(0,0,0,0.25)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", lineHeight: 1.4 }}>{sub.label}</span>
        {sub.badge && <Badge text={sub.badge} color={sub.badgeColor} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sub.tickers.map(t => (
          <TickerChip key={t} symbol={t} change={prices[t]} onRemove={() => onRemoveTicker(t)} onTickerClick={onTickerClick} />
        ))}
      </div>
      {sub.materials?.length > 0 && (
        <div>
          <button onClick={() => setOpen(v => !v)} style={{
            background: "none", border: "none", color: "#64748b", fontSize: 11,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: 0, fontFamily: "inherit",
          }}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            Raw Materials ({sub.materials.length})
          </button>
          {open && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {sub.materials.map((m, i) => typeof m === "string"
                ? <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>{m}</span>
                : <span key={i} title={m.constraint} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: m.color + "15", border: `1px solid ${m.color}55`, color: m.color, fontWeight: 600 }}>⚠ {m.name}</span>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 2 }}>
        {!addingTicker ? (
          <button onClick={() => setAddingTicker(true)} style={{
            background: "none", border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 6, color: "#334155", fontSize: 11, padding: "4px 10px",
            cursor: "pointer", width: "100%", fontFamily: "inherit", transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "#64748b"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#334155"; }}>
            + add ticker
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <input autoFocus value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") { setAddingTicker(false); setNewTicker(""); } }}
              placeholder="e.g. NVDA"
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
            <button onClick={handleAdd} style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✓</button>
            <button onClick={() => { setAddingTicker(false); setNewTicker(""); }} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TRACK CARD ────────────────────────────────────────────
// PERF: memo + backdropFilter removed
const TrackCard = memo(function TrackCard({ track, isActive, onClick }) {
  return (
    <div onClick={onClick} style={{
      position: "relative", borderRadius: 14, padding: "14px 12px", minHeight: 120,
      cursor: "pointer", userSelect: "none",
      background: isActive
        ? `linear-gradient(135deg,${track.borderColor}28 0%,rgba(6,4,20,.95) 100%)`
        : "rgba(255,255,255,0.03)",
      border: `1px solid ${isActive ? track.borderColor : "rgba(255,255,255,0.09)"}`,
      boxShadow: isActive ? `0 0 28px ${track.borderColor}44, 0 4px 20px rgba(0,0,0,0.5)` : "0 2px 12px rgba(0,0,0,0.3)",
      display: "flex", flexDirection: "column", gap: 8,
      transition: "all .2s",
    }}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = `${track.color}44`; e.currentTarget.style.boxShadow = `0 0 16px ${track.color}22`; } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.3)"; } }}>
      {isActive && (
        <div style={{
          position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)",
          background: `linear-gradient(90deg, ${track.borderColor}, ${track.color})`,
          color: "#000", fontSize: 9, fontWeight: 800,
          padding: "2px 10px", borderRadius: 20, letterSpacing: "0.2em", whiteSpace: "nowrap",
          boxShadow: `0 0 12px ${track.color}88`,
        }}>YOUR FOCUS</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? track.color : "#e2e8f0", lineHeight: 1.3 }}>{track.label}</div>
      <div style={{ fontSize: 11, color: isActive ? track.color : "#94a3b8" }}>{track.value}</div>
      <div style={{ fontSize: 10, color: "#475569" }}>{track.subsectors.flatMap(s => s.tickers).length} tickers</div>
      <div style={{ height: 2, borderRadius: 2, background: `linear-gradient(90deg,${track.borderColor},${track.color},transparent)`, opacity: isActive ? 1 : 0.3, marginTop: "auto" }} />
      <div style={{ fontSize: 10, color: isActive ? track.color : "#334155", textAlign: "center" }}>{isActive ? "▲ collapse" : "▼ expand"}</div>
    </div>
  );
});

// ── TRACK PANE ────────────────────────────────────────────
// PERF: histories prop removed; backdropFilter removed
function TrackPane({ track, prices, onAddTicker, onRemoveTicker, onTickerClick }) {
  return (
    <div style={{
      borderRadius: 18, border: `1px solid ${track.borderColor}44`,
      background: "rgba(4,2,16,0.92)",
      boxShadow: `0 0 60px ${track.borderColor}18, 0 8px 40px rgba(0,0,0,0.6)`,
      padding: 22, marginTop: 8, animation: "fadeSlideIn .25s ease-out",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: track.color, boxShadow: `0 0 8px ${track.color}` }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: track.color }}>{track.label}</h3>
        </div>
        <span style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {track.subsectors.length} sub-sectors · {track.subsectors.flatMap(s => s.tickers).length} tickers
        </span>
      </div>
      <div className="subsector-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(track.subsectors.length, 4)}, minmax(0,1fr))`, gap: 12 }}>
        {track.subsectors.map(sub => (
          <SubsectorCard key={sub.id} sub={sub} prices={prices}
            onAddTicker={(ticker) => onAddTicker(track.id, sub.id, ticker)}
            onRemoveTicker={(ticker) => onRemoveTicker(track.id, sub.id, ticker)}
            onTickerClick={onTickerClick} />
        ))}
      </div>
    </div>
  );
}

// ── HEAT MAP ──────────────────────────────────────────────
// PERF: histories prop removed; tooltip simplified to text-only (no Sparkline)
function HeatMap({ prices, capexData, onTickerClick }) {
  const [tooltip, setTooltip] = useState(null);

  function getHeatColor(change) {
    if (change === undefined) return "rgba(255,255,255,0.04)";
    if (change >= 15) return "#064e3b";
    if (change >= 8)  return "#065f46";
    if (change >= 4)  return "#047857";
    if (change >= 1)  return "#059669";
    if (change >= 0)  return "#10b981";
    if (change >= -1) return "#ef4444";
    if (change >= -4) return "#dc2626";
    if (change >= -8) return "#b91c1c";
    return "#7f1d1d";
  }

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(4,2,16,0.7)", padding: 20, boxShadow: "0 4px 30px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Portfolio Heat Map</h3>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>All tracked tickers · color = 1D performance</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[{ label: "+15%", c: "#064e3b" }, { label: "+4%", c: "#047857" }, { label: "0%", c: "#10b981" }, { label: "-4%", c: "#dc2626" }, { label: "-8%", c: "#7f1d1d" }].map((x, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: x.c }} />
              <span style={{ fontSize: 10, color: "#475569" }}>{x.label}</span>
            </div>
          ))}
        </div>
      </div>
      {capexData.tracks.map(track => {
        const cells = [...new Set(track.subsectors.flatMap(s => s.tickers))];
        if (!cells.length) return null;
        return (
          <div key={track.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: track.color, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 7, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: track.color, boxShadow: `0 0 6px ${track.color}`, flexShrink: 0 }} />
              {track.label}
              <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${track.color}44,transparent)` }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cells.map(ticker => {
                const change = prices[ticker];
                const bg = getHeatColor(change);
                const pos = change === undefined || change >= 0;
                return (
                  <div key={ticker}
                    onMouseEnter={e => setTooltip({ ticker, change, track: track.label, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={e => { e.stopPropagation(); onTickerClick?.(ticker, e.currentTarget.getBoundingClientRect()); }}
                    style={{ background: bg, borderRadius: 8, padding: "8px 12px", border: `1px solid ${bg === "rgba(255,255,255,0.04)" ? "rgba(255,255,255,0.06)" : bg}`, minWidth: 60, textAlign: "center", cursor: "pointer", transition: "filter .15s, transform .15s" }}
                    onMouseOver={e => { e.currentTarget.style.filter = "brightness(1.4)"; e.currentTarget.style.transform = "scale(1.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{ticker}</div>
                    {change !== undefined && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: pos ? "#a7f3d0" : "#fca5a5", marginTop: 2 }}>
                        {change >= 0 ? "+" : ""}{change}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {/* Lightweight text-only tooltip — no Sparkline SVG */}
      {tooltip && (
        <div style={{
          position: "fixed",
          top: tooltip.rect.top - 52,
          left: tooltip.rect.left,
          background: "rgba(6,3,20,0.95)",
          border: `1px solid ${(tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171"}44`,
          borderRadius: 8, padding: "7px 12px",
          pointerEvents: "none", zIndex: 1000,
          boxShadow: "0 4px 20px rgba(0,0,0,.7)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tooltip.ticker}</span>
          {tooltip.change !== undefined && (
            <span style={{ fontSize: 12, fontWeight: 700, color: (tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171" }}>
              {(tooltip.change ?? 0) >= 0 ? "+" : ""}{tooltip.change}%
            </span>
          )}
          <span style={{ fontSize: 10, color: "#475569" }}>{tooltip.track}</span>
        </div>
      )}
    </div>
  );
}

// ── DONUT CHART ───────────────────────────────────────────
function DonutChart({ prices, capexData }) {
  const [hovered, setHovered] = useState(null);
  const total = capexData.tracks.reduce((s, t) => s + (t.capex || 0), 0);
  const cx = 130, cy = 130, R = 90, r = 52;
  let cumAngle = -Math.PI / 2;

  const segments = capexData.tracks.map(track => {
    const frac = (track.capex || 0) / total;
    const angle = frac * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(startAngle + angle), y2 = cy + R * Math.sin(startAngle + angle);
    const xi1 = cx + r * Math.cos(startAngle), yi1 = cy + r * Math.sin(startAngle);
    const xi2 = cx + r * Math.cos(startAngle + angle), yi2 = cy + r * Math.sin(startAngle + angle);
    const large = angle > Math.PI ? 1 : 0;
    const tickers = [...new Set(track.subsectors.flatMap(s => s.tickers))];
    const changes = tickers.map(t => prices[t]).filter(v => v !== undefined);
    const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    return {
      track, frac, avg, tickerCount: tickers.length,
      path: `M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z`,
    };
  });

  const hov = hovered ? segments.find(s => s.track.id === hovered) : null;
  const trackPerf = capexData.tracks.map(track => {
    const tickers = [...new Set(track.subsectors.flatMap(s => s.tickers))];
    const changes = tickers.map(t => prices[t]).filter(v => v !== undefined);
    const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    return { ...track, avg };
  }).sort((a, b) => b.avg - a.avg);

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(4,2,16,0.7)", padding: 20, boxShadow: "0 4px 30px rgba(0,0,0,0.4)" }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Sector Allocation</h3>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Capex weight · hover to inspect avg performance</p>
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <svg width="260" height="260">
          {segments.map(seg => {
            const isHov = hovered === seg.track.id;
            return (
              <g key={seg.track.id}
                onMouseEnter={() => setHovered(seg.track.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${isHov ? 1.06 : 1})`, transition: "transform .2s", cursor: "pointer" }}>
                <path d={seg.path} fill={isHov ? seg.track.color : seg.track.borderColor}
                  opacity={isHov ? 1 : hovered ? 0.35 : 0.82} stroke="rgba(4,2,16,0.8)" strokeWidth="2.5" />
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={r - 2} fill="rgba(4,2,16,0.95)" />
          {hov ? (
            <>
              <text x={cx} y={cy - 14} textAnchor="middle" fill={hov.track.color} fontSize="11" fontWeight="600">{hov.track.label.split(" ")[0]}</text>
              <text x={cx} y={cy + 6} textAnchor="middle" fill="#f1f5f9" fontSize="20" fontWeight="800">{hov.track.value}</text>
              <text x={cx} y={cy + 24} textAnchor="middle" fill={hov.avg >= 0 ? "#34d399" : "#f87171"} fontSize="12">avg {hov.avg >= 0 ? "+" : ""}{hov.avg.toFixed(1)}%</text>
              <text x={cx} y={cy + 38} textAnchor="middle" fill="#475569" fontSize="10">{hov.tickerCount} tickers</text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize="10">TOTAL CAPEX</text>
              <text x={cx} y={cy + 14} textAnchor="middle" fill="#fbbf24" fontSize="20" fontWeight="800">~$445B</text>
              <text x={cx} y={cy + 30} textAnchor="middle" fill="#475569" fontSize="10">tracked</text>
            </>
          )}
        </svg>
        <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 10 }}>
          {trackPerf.map(track => (
            <div key={track.id}
              onMouseEnter={() => setHovered(track.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "default", opacity: hovered && hovered !== track.id ? 0.35 : 1, transition: "opacity .2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color, boxShadow: `0 0 6px ${track.color}88` }} />
                  <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>{track.label}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>${track.capex}B</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: track.avg >= 0 ? "#34d399" : "#f87171", minWidth: 46, textAlign: "right" }}>
                    {track.avg >= 0 ? "+" : ""}{track.avg.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, width: `${(track.capex / total) * 100}%`, background: `linear-gradient(90deg,${track.borderColor},${track.color})`, transition: "width .6s cubic-bezier(.4,0,.2,1)", boxShadow: `0 0 8px ${track.color}44` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── WATCHLIST ─────────────────────────────────────────────
function Watchlist({ prices, capexData }) {
  const [list, setList] = useState(["NVDA","LITE","COHR","AXTI","IQEPF","SMCI","IONQ","ANET","VST","CORZ"]);
  const [input, setInput] = useState("");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("all");

  function getSector(ticker) {
    for (const track of capexData.tracks)
      for (const sub of track.subsectors)
        if (sub.tickers.includes(ticker)) return track;
    return null;
  }

  const enriched = list.map(t => ({ ticker: t, change: prices[t], track: getSector(t) }));
  const filtered = filter === "all" ? enriched : filter === "gainers"
    ? enriched.filter(x => (x.change ?? 0) >= 0)
    : enriched.filter(x => (x.change ?? 0) < 0);
  const sorted = [...filtered].sort((a, b) => sortDir === "desc"
    ? ((b.change ?? -999) - (a.change ?? -999))
    : ((a.change ?? 999) - (b.change ?? 999)));
  const avg = enriched.filter(x => x.change !== undefined).reduce((s, x) => s + x.change, 0)
    / (enriched.filter(x => x.change !== undefined).length || 1);
  const maxAbs = Math.max(...enriched.map(x => Math.abs(x.change ?? 0)), 1);

  function add() {
    const sym = input.trim().toUpperCase();
    if (sym && !list.includes(sym)) setList(l => [...l, sym]);
    setInput("");
  }

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(4,2,16,0.7)", padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 4px 30px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Watchlist</h3>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Track positions · add any ticker</p>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#34d399", fontWeight: 700 }}>{enriched.filter(x => (x.change ?? -1) >= 0).length}</div>
            <div style={{ color: "#475569", fontSize: 10 }}>UP</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#f87171", fontWeight: 700 }}>{enriched.filter(x => (x.change ?? 0) < 0).length}</div>
            <div style={{ color: "#475569", fontSize: 10 }}>DOWN</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: avg >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{avg >= 0 ? "+" : ""}{avg.toFixed(2)}%</div>
            <div style={{ color: "#475569", fontSize: 10 }}>AVG</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="Add ticker… e.g. NVDA"
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
        <button onClick={add} style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {["all", "gainers", "losers"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? "rgba(255,255,255,0.08)" : "transparent",
            border: `1px solid ${filter === f ? "rgba(255,255,255,0.15)" : "transparent"}`,
            color: filter === f ? "#e2e8f0" : "#475569",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", textTransform: "capitalize",
          }}>{f}</button>
        ))}
        <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
          Sort {sortDir === "desc" ? "↓" : "↑"}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 380, overflowY: "auto" }}>
        {sorted.map((item, idx) => {
          const pos = (item.change ?? 0) >= 0;
          const barW = item.change !== undefined ? Math.abs(item.change) / maxAbs * 100 : 0;
          return (
            <div key={item.ticker} style={{ borderRadius: 8, padding: "10px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background .15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span style={{ fontSize: 10, color: "#334155", width: 16, textAlign: "right" }}>{idx + 1}</span>
              <div style={{ flex: "0 0 auto", minWidth: 60 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{item.ticker}</div>
                {item.track && <div style={{ fontSize: 9, color: item.track.color, marginTop: 1 }}>{item.track.label.split(" ").slice(0, 2).join(" ")}</div>}
              </div>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                {item.change !== undefined && (
                  <div style={{ height: "100%", borderRadius: 2, width: `${barW}%`, background: pos ? "linear-gradient(90deg,#065f46,#34d399)" : "linear-gradient(90deg,#7f1d1d,#ef4444)", transition: "width .4s ease" }} />
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, minWidth: 54, textAlign: "right", fontFamily: "monospace", color: item.change === undefined ? "#334155" : pos ? "#34d399" : "#f87171" }}>
                {item.change === undefined ? "—" : (pos ? "+" : "") + item.change + "%"}
              </div>
              <button onClick={() => setList(l => l.filter(x => x !== item.ticker))} style={{ background: "none", border: "none", color: "#1e293b", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1, transition: "color .15s", fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                onMouseLeave={e => e.currentTarget.style.color = "#1e293b"}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ROOT APP ──────────────────────────────────────────────
export default function App() {
  const [capexData, setCapexData] = useState(() => {
    try {
      const saved = localStorage.getItem("capexData");
      return saved ? JSON.parse(saved) : CAPEX_DATA;
    } catch { return CAPEX_DATA; }
  });
  const [activeTrack, setActiveTrack] = useState(null);
  const [prices, setPrices] = useState({});
  // PERF: history state entirely removed — no longer fetched, stored, or passed down
  const [marketData, setMarketData] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bottomTab, setBottomTab] = useState("all");
  const [popup, setPopup] = useState(null); // { ticker, change, rect }

  const openPopup = useCallback((ticker, rect) => {
    setPopup(prev => (prev?.ticker === ticker ? null : { ticker, change: prices[ticker], rect }));
  }, [prices]);

  useEffect(() => {
    try { localStorage.setItem("capexData", JSON.stringify(capexData)); }
    catch {}
  }, [capexData]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [newPrices, newMarket] = await Promise.all([
      fetchLivePrices(getAllTickers(capexData)),
      fetchMarketData(),
    ]);
    setPrices(prev => ({ ...prev, ...newPrices }));
    setMarketData(prev => {
      const merged = { ...prev };
      Object.entries(newMarket).forEach(([ticker, val]) => {
        if (val !== null && val !== undefined) {
          if (typeof val === "object") {
            if (val.price !== null && val.price !== undefined) merged[ticker] = val;
          } else { merged[ticker] = val; }
        }
      });
      return merged;
    });
    setLastUpdated(new Date().toLocaleTimeString());
    setRefreshing(false);
  }, [capexData]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  function addTickerToSubsector(trackId, subsectorId, ticker) {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setCapexData(prev => ({
      ...prev,
      tracks: prev.tracks.map(track =>
        track.id !== trackId ? track : {
          ...track,
          subsectors: track.subsectors.map(sub =>
            sub.id !== subsectorId ? sub : {
              ...sub,
              tickers: sub.tickers.includes(sym) ? sub.tickers : [...sub.tickers, sym],
            }
          ),
        }
      ),
    }));
    fetchLivePrices([sym]).then(newPrices => {
      setPrices(prev => ({ ...prev, ...newPrices }));
    });
  }

  function removeTickerFromSubsector(trackId, subsectorId, ticker) {
    setCapexData(prev => ({
      ...prev,
      tracks: prev.tracks.map(track =>
        track.id !== trackId ? track : {
          ...track,
          subsectors: track.subsectors.map(sub =>
            sub.id !== subsectorId ? sub : {
              ...sub,
              tickers: sub.tickers.filter(t => t !== ticker),
            }
          ),
        }
      ),
    }));
  }

  const gainers = Object.values(prices).filter(v => v > 0).length;
  const losers = Object.values(prices).filter(v => v < 0).length;
  const activeData = capexData.tracks.find(t => t.id === activeTrack);
  // PERF: build tape entries once, avoid re-spreading on every render
  const tickerEntries = Object.entries(prices);

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #121212; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 3px; }
    @keyframes scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.4; transform:scale(.7); } }
    .ticker-tape { animation: scroll-left 80s linear infinite; white-space: nowrap; display: inline-flex; gap: 24px; }
    .pulse { animation: pulseDot 2s infinite; }
    .capex-box { /* animation removed */ }

    /* ── MOBILE ───────────────────────────────────────────── */
    @media (max-width: 640px) {
      .track-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
      .top-node-layout { flex-direction: column !important; align-items: center !important; gap: 12px !important; }
      .market-strip { flex-direction: row !important; flex-wrap: wrap !important; justify-content: center !important; padding: 0 8px !important; gap: 8px !important; }
      .top-node-center { width: 100% !important; max-width: 100% !important; }
      .capex-number { font-size: 44px !important; }
      .bottom-grid { grid-template-columns: 1fr !important; }
      .subsector-grid { grid-template-columns: 1fr !important; }
      .main-content { padding: 16px 12px !important; }
      .header-controls { gap: 8px !important; }
    }
  `;

  return (
    <>
      <style>{styles}</style>

      <div style={{
        position: "relative", zIndex: 1,
        minHeight: "100vh", color: "#fff",
        fontFamily: "'DM Mono','Fira Code',monospace",
      }}>
        
        {/* TICKER TAPE */}
        {tickerEntries.length > 0 && (
          <div style={{ overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(4,2,14,0.75)", padding: "6px 0" }}>
            <div className="ticker-tape">
              {[...tickerEntries, ...tickerEntries].map(([sym, chg], i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: 11 }}>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{sym}</span>
                  <span style={{ color: chg >= 0 ? "#34d399" : "#f87171" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(4,2,14,0.6)", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#2d3a52", letterSpacing: "0.35em", textTransform: "uppercase", marginBottom: 3 }}>
              HOW ~$600B+ IN HYPERSCALER CAPEX FLOWS THROUGH AI INFRASTRUCTURE TRACKS
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#e2e8f0", fontFamily: "'Syne',sans-serif", letterSpacing: "-0.01em" }}>
              AI Capex Flow Intelligence
            </div>
          </div>
          <div className="header-controls" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pulse" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 6px #34d399" }} />
              {gainers} advancing
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", display: "inline-block", boxShadow: "0 0 6px #f87171" }} />
              {losers} declining
            </span>
            <span style={{ fontSize: 11, color: "#2d3a52" }}>{getAllTickers(capexData).length} tickers</span>
            <button
              onClick={() => {
                if (window.confirm("Reset all tickers to defaults?")) {
                  setCapexData(CAPEX_DATA);
                  localStorage.removeItem("capexData");
                }
              }}
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
              ↺ reset
            </button>
            <button onClick={refresh} disabled={refreshing} style={{
              background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)",
              borderRadius: 8, color: "#64748b", padding: "5px 12px", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit", opacity: refreshing ? 0.5 : 1,
            }}>
              {refreshing ? "↻" : `↻${lastUpdated ? " · " + lastUpdated : ""}`}
            </button>
          </div>
        </div>

        <div className="main-content" style={{ maxWidth: 1480, margin: "0 auto", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

          {/* TOP NODE WITH FLANKING MARKET DATA */}
          <div className="top-node-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MarketStrip data={marketData} tickers={["^GSPC","^DJI","^IXIC"]} labels={["S&P 500","DOW","NASDAQ"]} colors={["#60a5fa","#34d399","#c084fc"]} />

            <div className="top-node-center" style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <div className="capex-box" style={{
                width: 480, borderRadius: 22, padding: "26px 30px", textAlign: "center",
                background: "linear-gradient(135deg,rgba(251,191,36,.1) 0%,rgba(180,120,10,.04) 50%,rgba(4,2,14,.9) 100%)",
                border: "1.5px solid rgba(251,191,36,.45)",
              }}>
                <div style={{ fontSize: 10, color: "rgba(251,191,36,.5)", letterSpacing: "0.4em", textTransform: "uppercase", marginBottom: 6 }}>Total Investment Flow</div>
                <div className="capex-number" style={{ fontSize: 64, color: "#fbbf24", lineHeight: 1, marginBottom: 6, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", textShadow: "0 0 40px rgba(251,191,36,0.5)" }}>~$600B+</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 18 }}>
                  Hyperscaler AI Capex <span style={{ color: "rgba(251,191,36,.6)" }}>(2026 Est.)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {CAPEX_DATA.companies.map(co => {
                    const entry = marketData[co];
                    const price = entry?.price;
                    const change = entry?.change;
                    const pos = (change ?? 0) >= 0;
                    const priceStr = price ? "$" + price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
                    return (
                      <div key={co} style={{
                        display: "flex", flexDirection: "column", alignItems: "center",
                        padding: "6px 12px", borderRadius: 10, minWidth: 72,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.09)", transition: "all .2s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.45)"; e.currentTarget.style.boxShadow = "0 0 12px rgba(251,191,36,0.15)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.boxShadow = "none"; }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: "0.1em", marginBottom: 2 }}>{co}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", fontFamily: "'DM Mono', monospace", marginBottom: 1 }}>{priceStr}</span>
                        {change !== undefined && change !== null
                          ? <span style={{ fontSize: 10, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>{pos ? "+" : ""}{change.toFixed(2)}%</span>
                          : <span style={{ fontSize: 10, color: "#334155" }}>—</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ width: 1, height: 28, background: "linear-gradient(to bottom,rgba(251,191,36,.5),transparent)" }} />
              <div style={{ position: "relative", width: "100%", height: 1, background: "linear-gradient(90deg,transparent 5%,rgba(255,255,255,.06) 20%,rgba(255,255,255,.06) 80%,transparent 95%)" }}>
                {capexData.tracks.map((_, i, arr) => (
                  <div key={i} style={{ position: "absolute", top: 0, left: `${(i / (arr.length - 1)) * 70 + 15}%`, width: 1, height: 18, background: "linear-gradient(to bottom,rgba(255,255,255,.12),transparent)" }} />
                ))}
              </div>
            </div>

            <MarketStrip data={marketData} tickers={["BTC-USD","ETH-USD","XRP-USD"]} labels={["BTC","ETH","XRP"]} colors={["#f59e0b","#60a5fa","#34d399"]} />
          </div>

          {/* TRACK CARDS */}
          <div className="track-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, paddingTop: 8 }}>
            {capexData.tracks.map(track => (
              <div key={track.id} style={{ paddingTop: activeTrack === track.id ? 14 : 0 }}>
                <TrackCard track={track} isActive={activeTrack === track.id}
                  onClick={() => setActiveTrack(p => p === track.id ? null : track.id)} />
              </div>
            ))}
          </div>

          {/* EXPANDED PANE */}
          {activeData && (
            <TrackPane track={activeData} prices={prices}
              onAddTicker={addTickerToSubsector}
              onRemoveTicker={removeTickerFromSubsector}
              onTickerClick={openPopup} />
          )}

          {/* BOTTOM PANELS */}
          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid rgba(255,255,255,.04)", paddingBottom: 4, flexWrap: "wrap" }}>
              {[
                { id: "all", label: "⬛ All Panels" },
                { id: "heatmap", label: "📊 Heat Map" },
                { id: "donut", label: "🥧 Allocation" },
                { id: "watchlist", label: "👁 Watchlist" },
              ].map(tab => (
                <button key={tab.id} onClick={() => setBottomTab(tab.id)} style={{
                  background: bottomTab === tab.id ? "rgba(255,255,255,.06)" : "transparent",
                  border: `1px solid ${bottomTab === tab.id ? "rgba(255,255,255,.1)" : "transparent"}`,
                  color: bottomTab === tab.id ? "#e2e8f0" : "#334155",
                  borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all .2s",
                }}>{tab.label}</button>
              ))}
            </div>
            {bottomTab === "all" ? (
              <div className="bottom-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "1/-1" }}><HeatMap prices={prices} capexData={capexData} onTickerClick={openPopup} /></div>
                <DonutChart prices={prices} capexData={capexData} />
                <Watchlist prices={prices} capexData={capexData} />
              </div>
            ) : bottomTab === "heatmap" ? <HeatMap prices={prices} capexData={capexData} onTickerClick={openPopup} />
              : bottomTab === "donut" ? <DonutChart prices={prices} capexData={capexData} />
              : <Watchlist prices={prices} capexData={capexData} />}
          </div>

          {/* FOOTER */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, color: "#1e2638", borderTop: "1px solid rgba(255,255,255,.03)", paddingTop: 16, flexWrap: "wrap" }}>
            <span style={{ color: "#2d3a52", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Legend:</span>
            {[{ c: "#ef4444", l: "Extreme Bottleneck" }, { c: "#f59e0b", l: "Constrained" }, { c: "#34d399", l: "Rapid Growth" }, { c: "#60a5fa", l: "Emerging" }, { c: "#f472b6", l: "Speculative" }].map(x => (
              <span key={x.l} style={{ display: "flex", alignItems: "center", gap: 5, color: "#2d3a52" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: x.c, display: "inline-block", opacity: 0.6, boxShadow: `0 0 5px ${x.c}66` }} />{x.l}
              </span>
            ))}
            <span style={{ marginLeft: "auto", color: "#1e2638" }}>Live via Finnhub + Yahoo · server-cached · auto-refreshes 30s</span>
          </div>
        </div>
      </div>
      {/* COMPANY POPUP */}
      {popup && (
        <CompanyPopup
          ticker={popup.ticker}
          change={popup.change}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}
