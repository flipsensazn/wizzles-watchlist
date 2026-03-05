import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";

// ── MARKET DATA ───────────────────────────────────────────
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

// The default Multibagger Scanner list
const DEFAULT_MULTIBAGGER = [
  "YELP", "NVRI", "CXM", "SFL", "WWW", "FIVN", "STGW", "ECVT", "CRI", 
  "TRIP", "OLPX", "LZ", "GLDD", "ARHS", "ACEL", "CRCT", "PGY", "TDAY", 
  "NABL", "NRDS", "STKL", "UDMY", "GOGO", "YEXT", "EHAB", "AHH", "RIGL", 
  "RPD", "AKBA"
];

// ── PRICE FETCHING ────────────────────────────────────────
// Single unified fetch — callers pass ALL tickers they need and split the
// result themselves. This replaces the old fetchLivePrices + fetchMarketData
// pair which fired two separate HTTP round trips on every refresh.
async function fetchAllPrices(tickers) {
  try {
    const res = await fetch(`/prices?tickers=${tickers.join(",")}`);
    const json = await res.json();
    return json.data ?? {};
  } catch {
    return {};
  }
}

// ── SHARED UTILITIES ──────────────────────────────────────
// Defined first so fetchQuoteSummary (and MultibaggerPanel) can both use it.
function fmtMarketCap(n) {
  if (n == null || isNaN(n)) return "—";
  const num = Number(n);
  if (num >= 1e12) return "$" + (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return "$" + (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6)  return "$" + (num / 1e6).toFixed(2) + "M";
  return "$" + num.toLocaleString();
}

// ── QUOTE SUMMARY (for company popup) ────────────────────
const quoteCache = {};
const QUOTE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const QUOTE_CACHE_MAX = 50; // max entries before evicting the oldest

async function fetchQuoteSummary(ticker) {
  const now = Date.now();
  // Check if we have cached data AND if it is less than 5 minutes old
  if (quoteCache[ticker] && (now - quoteCache[ticker].timestamp < QUOTE_CACHE_TTL)) {
    return quoteCache[ticker].data;
  }

  try {
    const url = `/quote?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url);
    const json = await res.json();
    const payload = json.data ? json.data : json;
    const r = payload?.quoteSummary?.result?.[0];
    const chartResult = payload?.chart?.result?.[0];
    const newsResult = payload?.news; // Extract the news payload
    if (!r) return null;

    const profile = r.assetProfile ?? {};
    const detail  = r.summaryDetail ?? {};
    const price   = r.price ?? {};

    let chartPoints = [], chartDates = [];
    if (chartResult && chartResult.indicators?.quote?.[0]?.close && chartResult.timestamp) {
      const closes = chartResult.indicators.quote[0].close;
      const timestamps = chartResult.timestamp;
      for (let i = 0; i < closes.length; i++) {
        if (closes[i] !== null) {
          chartPoints.push(closes[i]);
          chartDates.push(timestamps[i] * 1000); 
        }
      }
    }

    const currentPriceRaw = price.regularMarketPrice?.raw ?? price.regularMarketPrice;

    const data = {
      name:         price.longName || price.shortName || ticker,
      currentPrice: currentPriceRaw != null ? "$" + Number(currentPriceRaw).toFixed(2) : null,
      sector:       profile.sector || "—",
      industry:     profile.industry || "—",
      description:  profile.longBusinessSummary || null,
      marketCap:    fmtMarketCap(price.marketCap?.raw ?? price.marketCap),
      peRatio:      detail.trailingPE?.raw != null ? Number(detail.trailingPE.raw).toFixed(1) : "—",
      week52Low:    detail.fiftyTwoWeekLow?.raw != null ? "$" + Number(detail.fiftyTwoWeekLow.raw).toFixed(2) : "—",
      week52High:   detail.fiftyTwoWeekHigh?.raw != null ? "$" + Number(detail.fiftyTwoWeekHigh.raw).toFixed(2) : "—",
      employees:    profile.fullTimeEmployees ? Number(profile.fullTimeEmployees).toLocaleString() : "—",
      country:      profile.country || "—",
      website:      profile.website || null,
      chartData:    chartPoints,
      chartDates:   chartDates,
      rawPrice:     currentPriceRaw,
      raw52Low:     detail.fiftyTwoWeekLow?.raw,
      raw52High:    detail.fiftyTwoWeekHigh?.raw,
      news:         newsResult ? {
                      title: newsResult.title,
                      link: newsResult.link,
                      publisher: newsResult.publisher
                    } : null
    };

    // Evict oldest entry if cache is at capacity
    const cacheKeys = Object.keys(quoteCache);
    if (cacheKeys.length >= QUOTE_CACHE_MAX) {
      const oldest = cacheKeys.reduce((a, b) => quoteCache[a].timestamp < quoteCache[b].timestamp ? a : b);
      delete quoteCache[oldest];
    }
    quoteCache[ticker] = { data, timestamp: now }; // Store with timestamp
    return data;
  } catch (err) {
    return null;
  }
}

// ── DEFAULT CAPEX DATA ────────────────────────────────────
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

// ── UI COMPONENTS ─────────────────────────────────────────
const Badge = memo(function Badge({ text, color }) {
  return (
    <span style={{
      background: color + "22", border: `1px solid ${color}`, color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.15em",
      padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>{text}</span>
  );
});

function MiniChart({ data, dates, color }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const padding = (max - min) * 0.1 || 1; 
  const yMin = min - padding, yMax = max + padding, range = yMax - yMin;
  const width = 160, height = 120; 
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - yMin) / (range || 1)) * height;
    return `${x},${y}`;
  }).join(" ");

  const cleanColor = color ? color.replace(/[^#0-9a-fA-F]/g, '') : "ffffff";
  const priceLabels = Array.from({ length: 10 }, (_, i) => max - (i * (max - min) / 9));

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }}>
          <defs>
            <linearGradient id={`grad-${cleanColor}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {priceLabels.map((val, i) => {
             const yPos = height - ((val - yMin) / (range || 1)) * height;
             return <line key={i} x1="0" y1={yPos} x2={width} y2={yPos} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2,2" />
          })}
          <polygon fill={`url(#grad-${cleanColor})`} points={`${points} ${width},${height} 0,${height}`} />
          <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
        </svg>
        <div style={{ position: 'relative', height: height, width: 45, marginLeft: 8, fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>
          {priceLabels.map((val, i) => {
              const yPos = height - ((val - yMin) / (range || 1)) * height;
              return <span key={i} style={{ position: 'absolute', top: yPos, transform: 'translateY(-50%)', left: 0 }}>${val.toFixed(2)}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

// ── COMPANY POPUP ─────────────────────────────────────────
function CompanyPopup({ ticker, change, anchorRect, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const popupRef = useRef(null);
  const pos = (change ?? 0) >= 0;
  const changeColor = change === undefined ? "#475569" : pos ? "#34d399" : "#f87171";

  useEffect(() => {
    setLoading(true);
    fetchQuoteSummary(ticker).then(d => { setData(d); setLoading(false); });
  }, [ticker]);

  useEffect(() => {
    function handler(e) { if (popupRef.current && !popupRef.current.contains(e.target)) onClose(); }
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  useEffect(() => {
    function handler(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Height increased to 400 to accommodate the news banner without squishing the chart
  const POPUP_W = 500, POPUP_H = 400; 
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = anchorRect ? anchorRect.left : vw / 2 - POPUP_W / 2;
  let top  = anchorRect ? anchorRect.top - POPUP_H - 10 : vh / 2 - POPUP_H / 2;
  
  if (top < 10) top = anchorRect ? anchorRect.bottom + 10 : vh / 2 - POPUP_H / 2;
  if (top + POPUP_H > vh - 12) top = vh - POPUP_H - 12;
  if (top < 12) top = 12;
  if (left + POPUP_W > vw - 12) left = vw - POPUP_W - 12;
  if (left < 12) left = 12;

  let chartColor = changeColor;
  let monthChangePct = null; 
  if (data?.chartData && data.chartData.length >= 2) {
      const firstPrice = data.chartData[0];
      const lastPrice = data.chartData[data.chartData.length - 1];
      chartColor = lastPrice >= firstPrice ? "#34d399" : "#f87171";
      monthChangePct = ((lastPrice - firstPrice) / firstPrice) * 100;
  }

  return (
    <div ref={popupRef} style={{
      position: "fixed", top, left, width: POPUP_W, zIndex: 3000,
      background: "rgba(18,18,18,0.97)", border: `1px solid ${changeColor}44`,
      borderRadius: 14, boxShadow: `0 8px 48px rgba(0,0,0,0.85), 0 0 30px ${changeColor}18`,
      fontFamily: "'DM Mono','Fira Code',monospace", animation: "fadeSlideIn .18s ease-out",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: `linear-gradient(135deg, ${changeColor}12 0%, transparent 100%)`,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", letterSpacing: "0.04em" }}>{ticker}</span>
            {data?.currentPrice && <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{data.currentPrice}</span>}
            {change !== undefined && (
              <span style={{ fontSize: 11, fontWeight: 700, color: changeColor, background: changeColor + "18", border: `1px solid ${changeColor}44`, borderRadius: 5, padding: "1px 7px" }}>
                {pos ? "+" : ""}{change}%
              </span>
            )}
          </div>
          {data?.name && data.name !== ticker && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{data.name}</div>}
        </div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#64748b", width: 24, height: 24, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>×</button>
      </div>

      <div style={{ padding: "12px 16px 14px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, color: "#475569", fontSize: 12 }}>Loading…</div>
        ) : !data ? (
          <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>No data available for {ticker}</div>
        ) : (
          <div style={{ display: "flex", gap: 20 }}>
            
            {/* LEFT COLUMN: Data Stats */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              {(data.sector !== "—" || data.industry !== "—") && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {data.sector !== "—" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa" }}>{data.sector}</span>}
                  {data.industry !== "—" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8" }}>{data.industry}</span>}
                </div>
              )}

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

              {data.description && (
                <div style={{ fontSize: 10.5, color: "#94a3b8", lineHeight: 1.55, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 10, overflowY: "auto", maxHeight: 130, paddingRight: 6 }}>
                  {data.description}
                </div>
              )}
              {data.website && (
                <a href={data.website} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: "auto", paddingTop: 8, fontSize: 10, color: "#60a5fa", textDecoration: "none", opacity: 0.7 }} onMouseEnter={e => e.currentTarget.style.opacity = "1"} onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>
                  {data.website.replace(/^https?:\/\//, "")} ↗
                </a>
              )}
            </div>

            {/* RIGHT COLUMN: News & Charts */}
            <div style={{ width: 220, display: "flex", flexDirection: "column", flexShrink: 0 }}>
              
              {/* LATEST NEWS BANNER */}
              {data.news && (
                <div style={{ marginBottom: 14, padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>🗞 Latest News</span>
                    <a href={data.news.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#60a5fa", textDecoration: "none", fontWeight: 600, background: "rgba(96,165,250,0.15)", padding: "2px 6px", borderRadius: 4 }}>
                      Read ↗
                    </a>
                  </div>
                  <div style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", fontWeight: 500 }} title={data.news.title}>
                    {data.news.title}
                  </div>
                  {data.news.publisher && (
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>via {data.news.publisher}</div>
                  )}
                </div>
              )}

              {data.chartData && data.chartData.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase" }}>1-Month Trend</div>
                  {monthChangePct !== null && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: chartColor, background: chartColor + "15", padding: "1px 6px", borderRadius: 4, border: `1px solid ${chartColor}44` }}>
                      {monthChangePct >= 0 ? "+" : ""}{monthChangePct.toFixed(2)}%
                    </div>
                  )}
                </div>
              )}
              
              <div style={{ marginTop: "auto", marginBottom: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                {data.chartData && data.chartData.length > 0 && (
                  <div><MiniChart data={data.chartData} dates={data.chartDates} color={chartColor} /></div>
                )}
                {data.raw52Low != null && data.raw52High != null && data.rawPrice != null && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", marginBottom: 6, fontFamily: "monospace" }}>
                      <span>{data.week52Low}</span>
                      <span style={{ color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em" }}>52W Range</span>
                      <span>{data.week52High}</span>
                    </div>
                    <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
                      <div style={{ position: "absolute", left: `${Math.max(0, Math.min(100, (data.raw52High - data.raw52Low) > 0 ? ((data.rawPrice - data.raw52Low) / (data.raw52High - data.raw52Low)) * 100 : 50))}%`, top: "50%", transform: "translate(-50%, -50%)", width: 8, height: 8, borderRadius: "50%", background: chartColor, boxShadow: `0 0 8px ${chartColor}88` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── MARKET STRIP ──────────────────────────────────────────
function MarketStrip({ data, tickers, labels, colors }) {
  function formatPrice(p, ticker) {
    if (p === null || p === undefined) return "—";
    if (ticker === "BTC-USD" || ticker === "ETH-USD") return p.toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: false });
    if (ticker === "XRP-USD") return p.toFixed(3);
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  }
  
  return (
    <div className="market-strip" style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", padding: "0 20px" }}>
      {tickers.map((ticker, i) => {
        const entry = data[ticker];
        const price = entry?.price;
        const change = entry?.change;
        const session = entry?.session;
        const pos = (change ?? 0) >= 0;
        const sessionLabel = session === "POST" ? "AH" : session === "PRE" ? "PM" : null;
        
        return (
          <div key={ticker} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            padding: "10px 14px", borderRadius: 6, minWidth: 230,
            background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.05)`, transition: "background .2s, border-color .2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors[i], letterSpacing: "0.05em", textTransform: "uppercase" }}>{labels[i]}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {sessionLabel && (
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#64748b", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "1px 5px" }}>{sessionLabel}</span>
              )}
              <span style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{formatPrice(price, ticker)}</span>
              {change !== undefined && change !== null ? (
                <span style={{ fontSize: 14, fontWeight: 700, color: pos ? "#34d399" : "#f87171", display: "flex", alignItems: "center", gap: 4, width: 64, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 10 }}>{pos ? "▲" : "▼"}</span> {Math.abs(change).toFixed(2)}%
                </span>
              ) : <span style={{ fontSize: 14, color: "#475569", width: 64, textAlign: "right" }}>—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TICKER CHIP ───────────────────────────────────────────
const TickerChip = memo(function TickerChip({ symbol, changeData, onRemove, onTickerClick }) {
  const [hovered, setHovered] = useState(false);
  const change = changeData?.change ?? changeData;
  const session = changeData?.session;
  const pos = (change ?? 0) >= 0;
  const changeColor = change === undefined ? "#475569" : pos ? "#34d399" : "#f87171";
  const sessionLabel = session === "POST" ? "AH" : session === "PRE" ? "PM" : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={e => { e.stopPropagation(); onTickerClick?.(symbol, e.currentTarget.getBoundingClientRect()); }}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        background: hovered ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)"}`,
        borderRadius: 8, cursor: "pointer", transition: "background .15s, border-color .15s", position: "relative",
      }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{symbol}</span>
      {change !== undefined ? <span style={{ fontSize: 11, fontWeight: 600, color: changeColor }}>{pos ? "+" : ""}{change}%</span> : <span style={{ fontSize: 11, color: "#475569" }}>…</span>}
      {sessionLabel && <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 2, padding: "1px 3px", letterSpacing: "0.05em" }}>{sessionLabel}</span>}
      {/* Hide delete button if onRemove is not provided (User is not Admin) */}
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
function SubsectorCard({ sub, prices, isAdmin, onAddTicker, onRemoveTicker, onTickerClick }) {
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
      borderRadius: 12, border: `1px solid ${isBottleneck ? "rgba(239,68,68,.35)" : isHot ? "rgba(245,158,11,.25)" : "rgba(255,255,255,0.07)"}`,
      background: isBottleneck ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)", padding: 14, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", lineHeight: 1.4 }}>{sub.label}</span>
        {sub.badge && <Badge text={sub.badge} color={sub.badgeColor} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sub.tickers.map(t => (
          <TickerChip key={t} symbol={t} changeData={prices[t]} 
            onRemove={isAdmin ? () => onRemoveTicker(t) : undefined} 
            onTickerClick={onTickerClick} />
        ))}
      </div>
      {sub.materials?.length > 0 && (
        <div>
          <button onClick={() => setOpen(v => !v)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: 0, fontFamily: "inherit" }}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span> Raw Materials ({sub.materials.length})
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
      
      {/* ADD TICKER CONTROLS - ONLY SHOW IF ADMIN IS LOGGED IN */}
      <div style={{ marginTop: 2 }}>
        {isAdmin && (
          !addingTicker ? (
            <button onClick={() => setAddingTicker(true)} style={{
              background: "none", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6, color: "#334155", fontSize: 11, padding: "4px 10px", cursor: "pointer", width: "100%", fontFamily: "inherit", transition: "all .15s",
            }} onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "#64748b"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#334155"; }}>
              + add ticker
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <input autoFocus value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") { setAddingTicker(false); setNewTicker(""); } }} placeholder="e.g. NVDA" style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <button onClick={handleAdd} style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✓</button>
              <button onClick={() => { setAddingTicker(false); setNewTicker(""); }} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── TRACK CARD ────────────────────────────────────────────
const TrackCard = memo(function TrackCard({ track, isActive, onClick }) {
  return (
    <div onClick={onClick} style={{
      position: "relative", borderRadius: 14, padding: "14px 12px", minHeight: 120, cursor: "pointer", userSelect: "none",
      background: isActive ? `linear-gradient(135deg,${track.borderColor}28 0%,rgba(18,18,18,.95) 100%)` : "rgba(255,255,255,0.03)",
      border: `1px solid ${isActive ? track.borderColor : "rgba(255,255,255,0.09)"}`, display: "flex", flexDirection: "column", gap: 8, transition: "all .2s",
    }} onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = `${track.color}44`; } }} onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; } }}>
      {isActive && (
        <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: `linear-gradient(90deg, ${track.borderColor}, ${track.color})`, color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.2em", whiteSpace: "nowrap" }}>YOUR FOCUS</div>
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
function TrackPane({ track, prices, isAdmin, onAddTicker, onRemoveTicker, onTickerClick }) {
  return (
    <div style={{
      borderRadius: 18, border: `1px solid ${track.borderColor}44`, background: "rgba(24,24,24,0.92)", padding: 22, marginTop: 8, animation: "fadeSlideIn .25s ease-out",
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
          <SubsectorCard key={sub.id} sub={sub} prices={prices} isAdmin={isAdmin}
            onAddTicker={(ticker) => onAddTicker(track.id, sub.id, ticker)}
            onRemoveTicker={(ticker) => onRemoveTicker(track.id, sub.id, ticker)}
            onTickerClick={onTickerClick} />
        ))}
      </div>
    </div>
  );
}

// ── HEAT MAP ──────────────────────────────────────────────
function HeatMap({ prices, capexData, onTickerClick }) {
  const [tooltip, setTooltip] = useState(null);

  // Memoized: capexData changes rarely — no need to recompute cells on every price tick
  const trackCells = useMemo(() =>
    capexData.tracks.map(track => ({
      track,
      cells: [...new Set(track.subsectors.flatMap(s => s.tickers))],
    })).filter(({ cells }) => cells.length > 0),
  [capexData]);

  function getHeatColor(change) {
    if (typeof change !== 'number') return "rgba(255,255,255,0.04)";
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
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Portfolio Heat Map</h3>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>All tracked tickers · color = 1D performance</p>
        </div>
      </div>
      {trackCells.map(({ track, cells }) => {
        return (
          <div key={track.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: track.color, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 7, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: track.color, flexShrink: 0 }} />
              {track.label}
              <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${track.color}44,transparent)` }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cells.map(ticker => {
                const change = prices[ticker]?.change ?? prices[ticker];
                const currentPrice = prices[ticker]?.price; 
                const bg = getHeatColor(change);
                const pos = change === undefined || change >= 0;
                return (
                  <div key={ticker}
                    onMouseEnter={e => setTooltip({ ticker, change, price: currentPrice, track: track.label, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={e => { e.stopPropagation(); onTickerClick?.(ticker, e.currentTarget.getBoundingClientRect()); }}
                    style={{ background: bg, borderRadius: 8, padding: "8px 12px", border: `1px solid ${bg === "rgba(255,255,255,0.04)" ? "rgba(255,255,255,0.06)" : bg}`, minWidth: 60, textAlign: "center", cursor: "pointer", transition: "filter .15s, transform .15s" }}
                    onMouseOver={e => { e.currentTarget.style.filter = "brightness(1.4)"; e.currentTarget.style.transform = "scale(1.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{ticker}</div>
                    {change !== undefined && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: pos ? "#a7f3d0" : "#fca5a5", marginTop: 2 }}>
                        {typeof change === 'number' ? (change >= 0 ? "+" : "") + change + "%" : "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      
      {tooltip && (
        <div style={{ position: "fixed", top: tooltip.rect.top - 52, left: tooltip.rect.left, background: "rgba(18,18,18,0.95)", border: `1px solid ${(tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171"}44`, borderRadius: 8, padding: "7px 12px", pointerEvents: "none", zIndex: 1000, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tooltip.ticker}</span>
          {tooltip.price !== undefined && <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>${tooltip.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
          {tooltip.change !== undefined && <span style={{ fontSize: 12, fontWeight: 700, color: (tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{typeof tooltip.change === 'number' ? (tooltip.change >= 0 ? "+" : "") + tooltip.change + "%" : "—"}</span>}
          <span style={{ fontSize: 10, color: "#475569" }}>{tooltip.track}</span>
        </div>
      )}
    </div>
  );
}

// ── DONUT CHART ───────────────────────────────────────────
function DonutChart({ prices, capexData }) {
  const [hovered, setHovered] = useState(null);
  const total = useMemo(() => capexData.tracks.reduce((s, t) => s + (t.capex || 0), 0), [capexData]);
  const cx = 130, cy = 130, R = 90, r = 52;

  // Memoized: SVG path geometry only changes when capexData changes, not on every price tick.
  // avg performance (which uses prices) is kept separate in trackPerf below.
  const segmentShapes = useMemo(() => {
    let cumAngle = -Math.PI / 2;
    return capexData.tracks.map(track => {
      const frac = (track.capex || 0) / total;
      const angle = frac * 2 * Math.PI;
      const startAngle = cumAngle;
      cumAngle += angle;
      const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(startAngle + angle), y2 = cy + R * Math.sin(startAngle + angle);
      const xi1 = cx + r * Math.cos(startAngle), yi1 = cy + r * Math.sin(startAngle);
      const xi2 = cx + r * Math.cos(startAngle + angle), yi2 = cy + r * Math.sin(startAngle + angle);
      const large = angle > Math.PI ? 1 : 0;
      const tickerCount = new Set(track.subsectors.flatMap(s => s.tickers)).size;
      return { track, frac, tickerCount, path: `M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z` };
    });
  }, [capexData, total]);

  // Memoized: avg performance changes with prices, so depends on both
  const trackPerf = useMemo(() =>
    capexData.tracks.map(track => {
      const tickers = [...new Set(track.subsectors.flatMap(s => s.tickers))];
      const changes = tickers.map(t => prices[t]?.change ?? prices[t]).filter(v => typeof v === 'number');
      const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
      return { ...track, avg };
    }).sort((a, b) => b.avg - a.avg),
  [capexData, prices]);

  // Merge avg performance into segments for rendering
  const segments = useMemo(() =>
    segmentShapes.map(s => {
      const perf = trackPerf.find(t => t.id === s.track.id);
      return { ...s, avg: perf?.avg ?? 0 };
    }),
  [segmentShapes, trackPerf]);

  const hov = hovered ? segments.find(s => s.track.id === hovered) : null;

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Sector Allocation</h3>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Capex weight · hover to inspect avg performance</p>
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <svg width="260" height="260">
          {segments.map(seg => {
            const isHov = hovered === seg.track.id;
            return (
              <g key={seg.track.id} onMouseEnter={() => setHovered(seg.track.id)} onMouseLeave={() => setHovered(null)} style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${isHov ? 1.06 : 1})`, transition: "transform .2s", cursor: "pointer" }}>
                <path d={seg.path} fill={isHov ? seg.track.color : seg.track.borderColor} opacity={isHov ? 1 : hovered ? 0.35 : 0.82} stroke="rgba(24,24,24,0.8)" strokeWidth="2.5" />
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={r - 2} fill="rgba(24,24,24,0.95)" />
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
            <div key={track.id} onMouseEnter={() => setHovered(track.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: "default", opacity: hovered && hovered !== track.id ? 0.35 : 1, transition: "opacity .2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color }} />
                  <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>{track.label}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>${track.capex}B</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: track.avg >= 0 ? "#34d399" : "#f87171", minWidth: 46, textAlign: "right" }}>{track.avg >= 0 ? "+" : ""}{track.avg.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, width: `${(track.capex / total) * 100}%`, background: `linear-gradient(90deg,${track.borderColor},${track.color})`, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── WATCHLIST ─────────────────────────────────────────────
function Watchlist({ prices, capexData, onTickerClick }) {
  const [list, setList] = useState(() => [...new Set(capexData.tracks.flatMap(t => t.subsectors.flatMap(s => s.tickers)))]);
  const [input, setInput] = useState("");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("all");

  // Memoized O(1) lookup map — replaces the O(n²) getSector linear search
  const sectorMap = useMemo(() => {
    const map = {};
    for (const track of capexData.tracks)
      for (const sub of track.subsectors)
        for (const t of sub.tickers) map[t] = track;
    return map;
  }, [capexData]);

  const enriched = list.map(t => ({ ticker: t, change: prices[t]?.change ?? prices[t], track: sectorMap[t] ?? null }));
  const filtered = filter === "all" ? enriched : filter === "gainers" ? enriched.filter(x => (typeof x.change === 'number' ? x.change : 0) >= 0) : enriched.filter(x => (typeof x.change === 'number' ? x.change : 0) < 0);
  const sorted = [...filtered].sort((a, b) => sortDir === "desc" ? ((typeof b.change === 'number' ? b.change : -999) - (typeof a.change === 'number' ? a.change : -999)) : ((typeof a.change === 'number' ? a.change : 999) - (typeof b.change === 'number' ? b.change : 999)));
  const validChanges = enriched.filter(x => typeof x.change === 'number');
  const avg = validChanges.reduce((s, x) => s + x.change, 0) / (validChanges.length || 1);
  const maxAbs = Math.max(...enriched.map(x => Math.abs(typeof x.change === 'number' ? x.change : 0)), 1);

  function add() {
    const sym = input.trim().toUpperCase();
    if (sym && !list.includes(sym)) setList(l => [...l, sym]);
    setInput("");
  }

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: 20, display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Watchlist</h3>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Track positions · add any ticker</p>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
          <div style={{ textAlign: "center" }}><div style={{ color: "#34d399", fontWeight: 700 }}>{enriched.filter(x => (typeof x.change === 'number' ? x.change : -1) >= 0).length}</div><div style={{ color: "#475569", fontSize: 10 }}>UP</div></div>
          <div style={{ textAlign: "center" }}><div style={{ color: "#f87171", fontWeight: 700 }}>{enriched.filter(x => (typeof x.change === 'number' ? x.change : 0) < 0).length}</div><div style={{ color: "#475569", fontSize: 10 }}>DOWN</div></div>
          <div style={{ textAlign: "center" }}><div style={{ color: avg >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{avg >= 0 ? "+" : ""}{avg.toFixed(2)}%</div><div style={{ color: "#475569", fontSize: 10 }}>AVG</div></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add ticker… e.g. NVDA" style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
        <button onClick={add} style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {["all", "gainers", "losers"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${filter === f ? "rgba(255,255,255,0.15)" : "transparent"}`, color: filter === f ? "#e2e8f0" : "#475569", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", textTransform: "capitalize" }}>{f}</button>
        ))}
        <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Sort {sortDir === "desc" ? "↓" : "↑"}</button>
      </div>
      
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0, paddingRight: 4 }}>
        {sorted.map((item, idx) => {
          const pos = (typeof item.change === 'number' ? item.change : 0) >= 0;
          const barW = typeof item.change === 'number' ? Math.abs(item.change) / maxAbs * 100 : 0;
          return (
            <div key={item.ticker} style={{ borderRadius: 8, padding: "10px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background .15s" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"} onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span style={{ fontSize: 10, color: "#334155", width: 16, textAlign: "right" }}>{idx + 1}</span>
              <div 
                style={{ flex: "0 0 auto", minWidth: 60, cursor: "pointer" }}
                onClick={(e) => onTickerClick?.(item.ticker, e.currentTarget.getBoundingClientRect())}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{item.ticker}</div>
                {item.track && <div style={{ fontSize: 9, color: item.track.color, marginTop: 1 }}>{item.track.label.split(" ").slice(0, 2).join(" ")}</div>}
              </div>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                {typeof item.change === 'number' && <div style={{ height: "100%", borderRadius: 2, width: `${barW}%`, background: pos ? "linear-gradient(90deg,#065f46,#34d399)" : "linear-gradient(90deg,#7f1d1d,#ef4444)", transition: "width .4s ease" }} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, fontSize: 13, fontWeight: 700, minWidth: 68, textAlign: "right", color: typeof item.change !== 'number' ? "#334155" : pos ? "#34d399" : "#f87171" }}>
                {typeof item.change !== 'number' ? "—" : <><span style={{ fontSize: 10 }}>{pos ? "▲" : "▼"}</span>{Math.abs(item.change).toFixed(2)}%</>}
              </div>
              <button onClick={() => setList(l => l.filter(x => x !== item.ticker))} style={{ background: "none", border: "none", color: "#1e293b", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1, transition: "color .15s", fontFamily: "inherit" }} onMouseEnter={e => e.currentTarget.style.color = "#ef4444"} onMouseLeave={e => e.currentTarget.style.color = "#1e293b"}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MULTIBAGGER PANEL ─────────────────────────────────────
function MultibaggerPanel({ prices, scannerPool, isAdmin, onSaveScanner, onTickerClick }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTicker, setNewTicker] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;

    // ── FIX #4: Throttled queue — max CONCURRENCY fetches at once instead of
    // firing all 29+ simultaneously. Each /quote call fans out to 3 Yahoo
    // requests on the backend, so a concurrency of 4 keeps things manageable.
    async function getFundamentals() {
      if (data.length === 0) setLoading(true);
      const CONCURRENCY = 4;

      async function fetchOne(ticker) {
        try {
          const res = await fetch(`/quote?ticker=${ticker}`);
          if (currentFetchId !== fetchIdRef.current) return null;
          const json = await res.json();
          const r = json?.quoteSummary?.result?.[0];
          if (!r) return null;

          const fcf = r.financialData?.freeCashflow?.raw || 0;
          const marketCapRaw = r.price?.marketCap?.raw || 1;
          const roa = (r.financialData?.returnOnAssets?.raw || 0) * 100;
          const pb = r.defaultKeyStatistics?.priceToBook?.raw || 0;
          const pe = r.summaryDetail?.trailingPE?.raw || null;

          const fcfYield = (fcf / marketCapRaw) * 100;
          const bookToMarket = pb > 0 ? (1 / pb) : 0;
          const marketCapFmt = fmtMarketCap(marketCapRaw);
          const score = (fcfYield * 15) + (bookToMarket * 10) + (roa * 2);

          return { ticker, fcfYield, roa, bookToMarket, pe, marketCapFmt, score };
        } catch (err) { return null; }
      }

      // Simple concurrency-limited runner
      const results = [];
      const queue = [...scannerPool];
      async function worker() {
        while (queue.length > 0) {
          const ticker = queue.shift();
          const result = await fetchOne(ticker);
          if (currentFetchId !== fetchIdRef.current) return;
          results.push(result);
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      if (currentFetchId === fetchIdRef.current) {
        setData(results.filter(x => x !== null).sort((a, b) => b.score - a.score));
        setLoading(false);
      }
    }
    getFundamentals();
  }, [scannerPool]);

  const addTicker = () => {
    const sym = newTicker.trim().toUpperCase();
    if (sym && !scannerPool.includes(sym)) { onSaveScanner([...scannerPool, sym]); setNewTicker(""); }
  };

  const handleImport = () => {
    const words = importText.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
    const ignoreList = ["INC", "CORP", "CO", "LTD", "PLC", "LLC", "USD", "EUR", "CAD", "M", "B", "K", "TRUE", "FALSE"];
    const foundTickers = [...new Set(words)].filter(w => !ignoreList.includes(w));
    if (foundTickers.length > 0) { onSaveScanner(foundTickers); setShowImport(false); setImportText(""); } else { alert("No valid tickers found."); }
  };

  const removeTicker = (ticker) => { onSaveScanner(scannerPool.filter(t => t !== ticker)); };
  
  const getScoreColor = (score) => {
    if (score > 40) return "#34d399"; 
    if (score > 15) return "#fbbf24"; 
    return "#f87171"; 
  };

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: 20, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>Small-cap Scanner</h3>
          </div>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Prioritizing FCF Yield, B/M, and ROA</p>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setShowImport(!showImport)} style={{ background: "transparent", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
              {showImport ? "Close Import" : "⎘ Smart Import"}
            </button>
            <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker..." 
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 12, outline: "none", width: 100 }} />
            <button onClick={addTicker} style={{ background: "#fbbf24", color: "#000", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", border: "none" }}>+</button>
          </div>
        )}
      </div>

      {showImport && isAdmin && (
        <div style={{ marginBottom: 16, background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", animation: "fadeSlideIn .2s ease-out", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Paste raw tickers below to instantly update the dashboard globally.</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="e.g. NVDA, MSFT, AAPL" style={{ flex: 1, height: 60, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 8, color: "#e2e8f0", fontSize: 12, fontFamily: "monospace", outline: "none", resize: "vertical" }} />
            <button onClick={handleImport} style={{ background: "#60a5fa", color: "#000", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Update Global</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" }}>
          <thead>
            <tr style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "sticky", top: 0, background: "rgba(14,17,23,0.95)", zIndex: 10 }}>
              <th style={{ padding: "10px 8px" }}>TICKER</th>
              <th style={{ padding: "10px 8px" }}>PRICE</th>
              <th style={{ padding: "10px 8px" }}>MKT CAP</th>
              <th style={{ padding: "10px 8px" }}>P/E</th>
              <th style={{ padding: "10px 8px" }}>FCF YLD</th>
              <th style={{ padding: "10px 8px" }}>B/M</th>
              <th style={{ padding: "10px 8px" }}>ROA</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>SCORE</th>
              {isAdmin && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="9" style={{ padding: 20, color: "#475569" }}>Fetching live data...</td></tr> : 
             data.map((stock) => {
              const change = prices[stock.ticker]?.change;
              const currentPrice = Number(prices[stock.ticker]?.price);
              const priceStr = !isNaN(currentPrice) && currentPrice !== 0 ? "$" + currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
              
              return (
                <tr key={stock.ticker} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td onClick={(e) => onTickerClick(stock.ticker, e.currentTarget.getBoundingClientRect())} style={{ padding: "12px 8px", cursor: "pointer" }}>
                    <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{stock.ticker}</div>
                    <div style={{ fontSize: 9, color: (change >= 0 ? "#34d399" : "#f87171") }}>{typeof change === 'number' ? `${change >= 0 ? "+" : ""}${change}%` : "—"}</div>
                  </td>
                  <td style={{ padding: "12px 8px", color: "#e2e8f0", fontWeight: 600 }}>{priceStr}</td>
                  <td style={{ padding: "12px 8px", color: "#cbd5e1" }}>{stock.marketCapFmt}</td>
                  <td style={{ padding: "12px 8px", color: "#cbd5e1" }}>{typeof stock.pe === 'number' ? stock.pe.toFixed(1) : "—"}</td>
                  <td style={{ padding: "12px 8px", color: stock.fcfYield > 8 ? "#34d399" : "#cbd5e1" }}>{typeof stock.fcfYield === 'number' && !isNaN(stock.fcfYield) ? stock.fcfYield.toFixed(2) + "%" : "—"}</td>
                  <td style={{ padding: "12px 8px", color: "#cbd5e1" }}>{typeof stock.bookToMarket === 'number' && !isNaN(stock.bookToMarket) ? stock.bookToMarket.toFixed(2) : "—"}</td>
                  <td style={{ padding: "12px 8px", color: "#cbd5e1" }}>{typeof stock.roa === 'number' && !isNaN(stock.roa) ? stock.roa.toFixed(1) + "%" : "—"}</td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 800, color: getScoreColor(stock.score), fontSize: 13 }}>{typeof stock.score === 'number' && !isNaN(stock.score) ? stock.score.toFixed(1) : "—"}</td>
                  {isAdmin && <td style={{ textAlign: "right" }}><button onClick={() => removeTicker(stock.ticker)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 16 }}>×</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ADMIN LOGIN MODAL ─────────────────────────────────────
function AdminModal({ onClose, onSuccess }) {
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus the input when modal opens
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function handler(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit() {
    if (!pwd.trim()) return;
    setLoading(true);
    setError("");
    // Validate the password by making a no-op POST to /scanner
    // (an empty tickers array with the password — the server will reject
    // bad passwords with 401 before touching KV)
    try {
      const res = await fetch("/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd, tickers: null }),
      });
      if (res.status === 401) {
        setError("Incorrect password.");
        setLoading(false);
        return;
      }
      // 200 or 500 (missing tickers body) both mean the password was accepted
      onSuccess(pwd);
      onClose();
    } catch {
      setError("Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 4000,
        background: "rgba(0,0,0,0.65)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "rgba(18,18,18,0.98)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 14, padding: "28px 32px", width: 340,
          fontFamily: "'DM Mono','Fira Code',monospace",
          boxShadow: "0 16px 64px rgba(0,0,0,0.85)",
          animation: "fadeSlideIn .18s ease-out",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", marginBottom: 6 }}>Admin Login</div>
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 20 }}>Enter the admin password to enable global editing.</div>

        <input
          ref={inputRef}
          type="password"
          value={pwd}
          onChange={e => { setPwd(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="Password"
          style={{
            width: "100%", background: "rgba(255,255,255,0.05)",
            border: `1px solid ${error ? "#ef4444" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 8, padding: "9px 12px", color: "#e2e8f0",
            fontSize: 13, fontFamily: "inherit", outline: "none",
            marginBottom: error ? 6 : 16,
          }}
        />
        {error && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 14 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSubmit}
            disabled={loading || !pwd.trim()}
            style={{
              flex: 1, background: "rgba(96,165,250,0.15)",
              border: "1px solid rgba(96,165,250,0.35)", color: "#60a5fa",
              borderRadius: 8, padding: "9px 0", cursor: "pointer",
              fontSize: 12, fontWeight: 700, fontFamily: "inherit",
              opacity: loading || !pwd.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Verifying…" : "Unlock"}
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1, background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)", color: "#64748b",
              borderRadius: 8, padding: "9px 0", cursor: "pointer",
              fontSize: 12, fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ROOT APP ──────────────────────────────────────────────
export default function App() {
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);

  const [scannerPool, setScannerPool] = useState(DEFAULT_MULTIBAGGER);
  const [capexData, setCapexData] = useState(CAPEX_DATA);
  
  const [activeTrack, setActiveTrack] = useState(null);
  const [prices, setPrices] = useState({});
  const pricesRef = useRef({});  // ref so openPopup never needs to be recreated
  const [marketData, setMarketData] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bottomTab, setBottomTab] = useState("all");
  const [popup, setPopup] = useState(null); 

  // ── FAST PREFETCH: load the 11 visible market tickers immediately on mount.
  // This is intentionally separate from refresh() so it fires right away,
  // before the /scanner and /capex KV fetches complete and before the full
  // ~100-ticker refresh() call returns. Users see the top-of-page strip
  // populated within ~1-2 seconds instead of waiting for the full batch.
  useEffect(() => {
    const marketTickers = [...INDEX_TICKERS, ...CRYPTO_TICKERS, ...HYPERSCALER_TICKERS];
    fetchAllPrices(marketTickers).then(data => {
      setMarketData(prev => {
        const merged = { ...prev };
        marketTickers.forEach(ticker => {
          const val = data[ticker];
          if (val != null) merged[ticker] = val;
        });
        return merged;
      });
      setPrices(prev => { const next = { ...prev, ...data }; pricesRef.current = next; return next; });
    });
  }, []); // runs once on mount only

  // Mount: Fetch Global Data for both panels
  useEffect(() => {
    fetch("/scanner")
      .then(res => res.json())
      .then(data => { if (data.tickers) setScannerPool(data.tickers); })
      .catch(e => console.log("Scanner fetch failed"));

    fetch("/capex")
      .then(res => res.json())
      .then(data => { if (data.capexData) setCapexData(data.capexData); })
      .catch(e => console.log("Capex fetch failed"));
  }, []);

  // Reads from pricesRef (not prices state) so this callback is stable and
  // never needs to be recreated when prices update, avoiding refresh() churn.
  const openPopup = useCallback((ticker, rect) => {
    const change = pricesRef.current[ticker]?.change ?? pricesRef.current[ticker];
    setPopup(prev => (prev?.ticker === ticker ? null : { ticker, change, rect }));
  }, []); // stable — no deps needed

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const marketTickers = [...INDEX_TICKERS, ...CRYPTO_TICKERS, ...HYPERSCALER_TICKERS];
    const allTickers = [...new Set([...getAllTickers(capexData), ...scannerPool, ...marketTickers])];

    // Single HTTP round trip — split result into prices vs marketData on the frontend
    const allData = await fetchAllPrices(allTickers);

    setPrices(prev => { const next = { ...prev, ...allData }; pricesRef.current = next; return next; });
    setMarketData(prev => {
      const merged = { ...prev };
      marketTickers.forEach(ticker => {
        const val = allData[ticker];
        if (val != null && typeof val === "object" && val.price != null) merged[ticker] = val;
        else if (val != null) merged[ticker] = val;
      });
      return merged;
    });
    setLastUpdated(new Date().toLocaleTimeString());
    setRefreshing(false);
  }, [capexData, scannerPool]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 15000); 
    return () => clearInterval(id);
  }, [refresh]);

  const handleUnlock = () => setShowAdminModal(true);

  // Admin save functions for the KV Databases
  const saveGlobalScanner = async (newList) => {
    try {
      const res = await fetch("/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: newList, password: adminPassword })
      });
      if (res.ok) { setScannerPool(newList); refresh(); } 
      else {
        const json = await res.json();
        alert(json.error || "Update failed.");
        if (res.status === 401) { setIsAdmin(false); setAdminPassword(""); }
      }
    } catch (e) { alert("Network error."); }
  };

  const saveGlobalCapex = async (newData) => {
    try {
      const res = await fetch("/capex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capexData: newData, password: adminPassword })
      });
      if (res.ok) { setCapexData(newData); refresh(); } 
      else {
        const json = await res.json();
        alert(json.error || "Update failed.");
        if (res.status === 401) { setIsAdmin(false); setAdminPassword(""); }
      }
    } catch (e) { alert("Network error."); }
  };

  function addTickerToSubsector(trackId, subsectorId, ticker) {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    const newData = {
      ...capexData,
      tracks: capexData.tracks.map(track =>
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
    };
    saveGlobalCapex(newData);
  }

  function removeTickerFromSubsector(trackId, subsectorId, ticker) {
    const newData = {
      ...capexData,
      tracks: capexData.tracks.map(track =>
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
    };
    saveGlobalCapex(newData);
  }

  const allTickerCount = useMemo(() => getAllTickers(capexData).length, [capexData]);
  const gainers = Object.values(prices).filter(v => (v?.change ?? v) > 0).length;
  const losers = Object.values(prices).filter(v => (v?.change ?? v) < 0).length;
  const activeData = capexData.tracks.find(t => t.id === activeTrack);
  const tickerEntries = Object.entries(prices);

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Condensed:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; box-shadow: none !important; }
    html, body { background: #0E1117; font-family: 'Inter', sans-serif; }
    table, .market-strip span, .ticker-tape, .capex-number { font-family: 'Roboto Condensed', sans-serif !important; letter-spacing: 0.02em; }
    div[style*="border-radius: 12px"], div[style*="border-radius: 14px"], div[style*="border-radius: 18px"], div[style*="border-radius: 22px"] { border-radius: 6px !important; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
    @keyframes scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.4; transform:scale(.7); } }
    .ticker-tape { animation: scroll-left 80s linear infinite; white-space: nowrap; display: inline-flex; gap: 24px; }
    .pulse { animation: pulseDot 2s infinite; }
    .bottom-grid-all { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .span-2 { grid-column: span 2; }
    .span-1 { grid-column: span 1; }
    .panel-wrapper { position: relative; height: 100%; }
    .panel-inner { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
    @media (max-width: 1024px) {
      .bottom-grid-all { grid-template-columns: 1fr !important; }
      .span-2, .span-1 { grid-column: 1 / -1 !important; }
      .panel-wrapper { min-height: 450px; }
      .panel-inner { position: relative; height: 100%; }
    }
    @media (max-width: 640px) {
      .track-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
      .top-node-layout { flex-direction: column !important; align-items: stretch !important; gap: 12px !important; }
      .market-strip { flex-direction: row !important; flex-wrap: wrap !important; justify-content: center !important; padding: 0 8px !important; gap: 8px !important; }
      .top-node-center { width: 100% !important; max-width: 100% !important; }
      .capex-number { font-size: 44px !important; }
      .subsector-grid { grid-template-columns: 1fr !important; }
      .main-content { padding: 16px 12px !important; }
      .header-controls { gap: 8px !important; }
    }
  `;

  return (
    <>
      <style>{styles}</style>
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", color: "#fff" }}>
        
        {/* TICKER TAPE */}
        {tickerEntries.length > 0 && (
          <div style={{ overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(18,18,18,0.75)", padding: "6px 0" }}>
            <div className="ticker-tape">
              {[...tickerEntries, ...tickerEntries].map(([sym, val], i) => {
                const chg = val?.change ?? val;
                const sessionLabel = val?.session === "POST" ? "AH" : val?.session === "PRE" ? "PM" : null;
                return (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#64748b", fontSize: 11 }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{sym}</span>
                    {sessionLabel && <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2, padding: "0px 3px" }}>{sessionLabel}</span>}
                    {chg !== undefined && <span style={{ color: chg >= 0 ? "#34d399" : "#f87171" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span>}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(24,24,24,0.6)", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#2d3a52", letterSpacing: "0.35em", textTransform: "uppercase", marginBottom: 3 }}>HOW ~$600B+ IN HYPERSCALER CAPEX FLOWS THROUGH AI INFRASTRUCTURE TRACKS</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#e2e8f0", letterSpacing: "-0.01em" }}>AI Capex Flow Intelligence</div>
          </div>
          <div className="header-controls" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            
            {!isAdmin ? (
              <button onClick={handleUnlock} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#64748b", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                🔒 Login
              </button>
            ) : (
              <span style={{ fontSize: 10, background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", padding: "4px 10px", borderRadius: 6, fontWeight: 700 }}>
                🔓 EDITING ACTIVE
              </span>
            )}

            <span className="pulse" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 6px #34d399" }} />{gainers} advancing
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", display: "inline-block", boxShadow: "0 0 6px #f87171" }} />{losers} declining
            </span>
            <span style={{ fontSize: 11, color: "#2d3a52" }}>{allTickerCount} tickers</span>
            <button onClick={refresh} disabled={refreshing} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8, color: "#64748b", padding: "5px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", opacity: refreshing ? 0.5 : 1 }}>
              {refreshing ? "↻" : `↻${lastUpdated ? " · " + lastUpdated : ""}`}
            </button>
          </div>
        </div>

        <div className="main-content" style={{ maxWidth: 1480, margin: "0 auto", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 28 }}>
          
          <div className="top-node-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MarketStrip data={marketData} tickers={["^GSPC","^DJI","^IXIC"]} labels={["S&P 500","DOW","NASDAQ"]} colors={["#60a5fa","#34d399","#c084fc"]} />
            <div className="top-node-center" style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <div style={{ width: 480, borderRadius: 22, padding: "26px 30px", textAlign: "center", background: "linear-gradient(135deg,rgba(251,191,36,.1) 0%,rgba(180,120,10,.04) 50%,rgba(18,18,18,.9) 100%)", border: "1.5px solid rgba(251,191,36,.45)" }}>
                <div style={{ fontSize: 10, color: "rgba(251,191,36,.5)", letterSpacing: "0.4em", textTransform: "uppercase", marginBottom: 6 }}>Total Investment Flow</div>
                <div className="capex-number" style={{ fontSize: 64, color: "#fbbf24", lineHeight: 1, marginBottom: 6, letterSpacing: "0.04em" }}>~$600B+</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 18 }}>Hyperscaler AI Capex <span style={{ color: "rgba(251,191,36,.6)" }}>(2026 Est.)</span></div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {CAPEX_DATA.companies.map(co => {
                    const entry = marketData[co];
                    const pos = (entry?.change ?? 0) >= 0;
                    const sessionLabel = entry?.session === "POST" ? "AH" : entry?.session === "PRE" ? "PM" : null;
                    return (
                      <div key={co} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 12px", borderRadius: 10, minWidth: 72, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", transition: "all .2s" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.45)"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: "0.1em" }}>{co}</span>
                          {sessionLabel && <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 2, padding: "1px 3px" }}>{sessionLabel}</span>}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: sessionLabel ? "rgba(255,255,255,0.7)" : "#f1f5f9", marginBottom: 1 }}>{entry?.price ? "$" + entry.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</span>
                        {entry?.change !== undefined && entry?.change !== null ? <span style={{ fontSize: 10, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>{pos ? "+" : ""}{entry.change.toFixed(2)}%</span> : <span style={{ fontSize: 10, color: "#334155" }}>—</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ width: 1, height: 28, background: "linear-gradient(to bottom,rgba(251,191,36,.5),transparent)" }} />
              <div style={{ position: "relative", width: "100%", height: 1, background: "linear-gradient(90deg,transparent 5%,rgba(255,255,255,.06) 20%,rgba(255,255,255,.06) 80%,transparent 95%)" }}>
                {capexData.tracks.map((_, i, arr) => <div key={i} style={{ position: "absolute", top: 0, left: `${(i / (arr.length - 1)) * 70 + 15}%`, width: 1, height: 18, background: "linear-gradient(to bottom,rgba(255,255,255,.12),transparent)" }} />)}
              </div>
            </div>
            <MarketStrip data={marketData} tickers={["BTC-USD","ETH-USD","XRP-USD"]} labels={["BTC","ETH","XRP"]} colors={["#f59e0b","#60a5fa","#34d399"]} />
          </div>

          <div className="track-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, paddingTop: 8 }}>
            {capexData.tracks.map(track => (
              <div key={track.id} style={{ paddingTop: activeTrack === track.id ? 14 : 0 }}>
                <TrackCard track={track} isActive={activeTrack === track.id} onClick={() => setActiveTrack(p => p === track.id ? null : track.id)} />
              </div>
            ))}
          </div>

          {activeData && (
            <TrackPane track={activeData} prices={prices} isAdmin={isAdmin} onAddTicker={addTickerToSubsector} onRemoveTicker={removeTickerFromSubsector} onTickerClick={openPopup} />
          )}

          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid rgba(255,255,255,.04)", paddingBottom: 4, flexWrap: "wrap" }}>
              {[{ id: "all", label: "⬛ All Panels" }, { id: "heatmap", label: "📊 Heat Map" }, { id: "donut", label: "🥧 Allocation" }, { id: "watchlist", label: "👁 Watchlist" }, { id: "multibagger", label: "🚀 Multibagger" }].map(tab => (
                <button key={tab.id} onClick={() => setBottomTab(tab.id)} style={{ background: bottomTab === tab.id ? "rgba(255,255,255,.06)" : "transparent", border: `1px solid ${bottomTab === tab.id ? "rgba(255,255,255,.1)" : "transparent"}`, color: bottomTab === tab.id ? "#e2e8f0" : "#334155", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all .2s" }}>{tab.label}</button>
              ))}
            </div>
            
            {bottomTab === "all" ? (
              <div className="bottom-grid-all">
                <div className="span-2"><HeatMap prices={prices} capexData={capexData} onTickerClick={openPopup} /></div>
                <div className="span-1 panel-wrapper"><div className="panel-inner"><Watchlist prices={prices} capexData={capexData} onTickerClick={openPopup} /></div></div>
                <div className="span-1"><DonutChart prices={prices} capexData={capexData} /></div>
                <div className="span-2 panel-wrapper"><div className="panel-inner"><MultibaggerPanel prices={prices} scannerPool={scannerPool} isAdmin={isAdmin} onSaveScanner={saveGlobalScanner} onTickerClick={openPopup} /></div></div>
              </div>
            ) : bottomTab === "heatmap" ? <HeatMap prices={prices} capexData={capexData} onTickerClick={openPopup} />
              : bottomTab === "donut" ? <DonutChart prices={prices} capexData={capexData} />
              : bottomTab === "watchlist" ? <Watchlist prices={prices} capexData={capexData} onTickerClick={openPopup} />
              : <MultibaggerPanel prices={prices} scannerPool={scannerPool} isAdmin={isAdmin} onSaveScanner={saveGlobalScanner} onTickerClick={openPopup} />
            }
          </div>
        </div>
      </div>
      {popup && <CompanyPopup ticker={popup.ticker} change={popup.change} anchorRect={popup.rect} onClose={() => setPopup(null)} />}
      {showAdminModal && (
        <AdminModal
          onClose={() => setShowAdminModal(false)}
          onSuccess={(pwd) => { setAdminPassword(pwd); setIsAdmin(true); }}
        />
      )}
    </>
  );
}
