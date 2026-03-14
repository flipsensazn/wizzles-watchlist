import { useState, useEffect, useCallback, useRef, memo, useMemo, createContext, useContext } from "react";

// ── MOBILE CONTEXT ──────────────────────────────────────
const MobileCtx = createContext(false);
function useMobile() { return useContext(MobileCtx); }

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
const QUOTE_CACHE_TTL = 5 * 60 * 1000;
const QUOTE_CACHE_MAX = 50;

async function fetchQuoteSummary(ticker) {
  const now = Date.now();
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
    const newsResult = payload?.news;
    if (!r) return null;

    const profile = r.assetProfile ?? {};
    const detail  = r.summaryDetail ?? {};
    const price   = r.price ?? {};
    const events  = r.calendarEvents ?? {};

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
      earningsDate: events.earnings?.earningsDate?.[0]?.raw ?? null,
      news:         newsResult ? {
                      title: newsResult.title,
                      link: newsResult.link,
                      publisher: newsResult.publisher
                    } : null
    };

    const cacheKeys = Object.keys(quoteCache);
    if (cacheKeys.length >= QUOTE_CACHE_MAX) {
      const oldest = cacheKeys.reduce((a, b) => quoteCache[a].timestamp < quoteCache[b].timestamp ? a : b);
      delete quoteCache[oldest];
    }
    quoteCache[ticker] = { data, timestamp: now };
    return data;
  } catch (err) {
    return null;
  }
}

// ── DEFAULT CAPEX DATA ────────────────────────────────────
const CAPEX_DATA = {
  version: 2,
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
        { id: "equip", label: "Semiconductor Equipment", badge: null, tickers: ["AMAT","LRCX","ASML"],
          materials: ["Rare Earth Magnets","Fluorine Gas","Quartz"] },
        { id: "packaging", label: "Advanced Packaging", badge: null, tickers: ["AMKR","ASX","CAMT","ONTO","KLAC"],
          materials: ["Advanced Packaging CoWoS","HBM","Fan-Out Wafer"] },
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
        { id: "cyber", label: "Cybersecurity", badge: null, tickers: ["PANW","CRWD","ZS"],
          materials: ["Secure Enclaves","HSM Hardware","Zero Trust Infrastructure"] },
      ],
    },
    {
      id: "photonics", label: "Photonics & Interconnects", value: "~$40B", capex: 35,
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
        { id: "interconnects", label: "High-Speed Interconnects", badge: null, tickers: ["APH","TEL"],
          materials: ["High-Speed Copper","Differential Pair PCB","Signal Integrity"] },
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
        { id: "mep", label: "Mechanical, Electrical & Plumbing", badge: null, tickers: ["FIX","EME","MTZ"],
          materials: ["Electrical Conduit","HVAC Systems","Industrial Piping"] },
      ],
    },
    {
      id: "power", label: "Power & Cooling", value: "~$45B", capex: 45,
      color: "#fb923c", borderColor: "#f97316",
      subsectors: [
        { id: "grid", label: "Power Generation & Utilities", badge: "GRID BOTTLENECK", badgeColor: "#ef4444",
          tickers: ["VST","NEE","BE"],
          materials: ["Copper Grid","Silicon Steel Transformers","Lithium Storage"] },
        { id: "nuclear", label: "Nuclear", badge: "EMERGING", badgeColor: "#fb923c",
          tickers: ["OKLO","SMR","LEU","ASPI"],
          materials: ["Enriched Uranium","Zirconium Cladding","Boron Control Rods"] },
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
          tickers: ["RKLB","ASTS"], materials: ["Phase-Change Materials","Memristive Oxides","Hafnium Oxide"] },
        { id: "saas", label: "SaaS", badge: null, tickers: ["PLTR","SNOW","NOW"],
          materials: ["Cloud Infrastructure","API Gateways","Multi-tenant Architecture"] },
        { id: "robotics", label: "Robotics", badge: "EMERGING", badgeColor: "#c084fc",
          tickers: ["TER","SYM","TSLA"],
          materials: ["Servo Motors","LiDAR Sensors","Carbon Fiber Composites"] },
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

function MiniChart({ data, dates, color, ticker }) {
  if (!data || data.length < 2) return null;
  const min = data.reduce((a, b) => Math.min(a, b), Infinity);
  const max = data.reduce((a, b) => Math.max(a, b), -Infinity);
  const padding = (max - min) * 0.1 || 1; 
  const yMin = min - padding, yMax = max + padding, range = yMax - yMin;
  const width = 160, height = 120; 
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - yMin) / (range || 1)) * height;
    return `${x},${y}`;
  }).join(" ");

  const cleanColor = color ? color.replace(/[^#0-9a-fA-F]/g, '') : "ffffff";
  const gradientId = `grad-${ticker || "x"}-${cleanColor}`;
  const priceLabels = Array.from({ length: 10 }, (_, i) => max - (i * (max - min) / 9));

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {priceLabels.map((val, i) => {
             const yPos = height - ((val - yMin) / (range || 1)) * height;
             return <line key={i} x1="0" y1={yPos} x2={width} y2={yPos} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2,2" />
          })}
          <polygon fill={`url(#${gradientId})`} points={`${points} ${width},${height} 0,${height}`} />
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
        
        {/* Top Right Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data?.earningsDate && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.3)", padding: "4px 8px", borderRadius: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "#c084fc", letterSpacing: "0.05em" }}>EARNINGS:</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#e2e8f0" }}>
                {new Date(data.earningsDate * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </span>
            </div>
          )}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#64748b", width: 24, height: 24, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>×</button>
        </div>
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
                  <div><MiniChart data={data.chartData} dates={data.chartDates} color={chartColor} ticker={ticker} /></div>
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

// ── RESPONSIVE TOP BAR ───────────────────────────────────
const TOP_BAR_TICKERS = [
  { ticker: "^GSPC",   label: "S&P 500", color: "#60a5fa" },
  { ticker: "^DJI",    label: "DOW",     color: "#34d399" },
  { ticker: "^IXIC",   label: "NASDAQ",  color: "#c084fc" },
  { ticker: "BTC-USD", label: "BTC",     color: "#f59e0b" },
  { ticker: "ETH-USD", label: "ETH",     color: "#60a5fa" },
  { ticker: "XRP-USD", label: "XRP",     color: "#34d399" },
];

function TopBar({ marketData }) {
  const barRef   = useRef(null);
  const clockRef = useRef(null);
  const [scale, setScale]     = useState(1);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setIsMobile(w < 768);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Desktop-only scale calculation
  useEffect(() => {
    if (isMobile) return;
    const measure = () => {
      if (!barRef.current || !clockRef.current) return;
      const barW    = barRef.current.offsetWidth;
      const clockW  = clockRef.current.offsetWidth;
      const available = barW - 32 - 14 - clockW;
      const fullW   = 148 * 6 + 5 * 5;
      setScale(Math.min(1, Math.max(0.65, available / fullW)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (barRef.current) ro.observe(barRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  function formatPrice(p, t) {
    if (p == null) return "—";
    if (t === "BTC-USD" || t === "ETH-USD") return p.toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true });
    if (t === "XRP-USD") return p.toFixed(4);
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
  }

  // ── MOBILE LAYOUT ────────────────────────────────────────
  // 3×2 grid of cards + compact clock bar beneath
  if (isMobile) {
    return (
      <div ref={barRef} style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
        background: "rgba(14,14,14,0.98)",
        borderBottom: "1px solid rgba(255,255,255,.07)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 2px 20px rgba(0,0,0,0.7)",
      }}>
        {/* 3-column grid of ticker cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 3,
          padding: "4px 4px 0",
        }}>
          {TOP_BAR_TICKERS.map(({ ticker, label, color }) => {
            const entry      = marketData[ticker] || {};
            const price      = entry.price;
            const changePct  = entry.change;
            const pos        = (changePct ?? 0) >= 0;
            const changeColor = changePct == null ? "#475569" : pos ? "#10b981" : "#ef4444";
            const sessionLabel = entry?.session === "POST" || entry?.session === "CLOSED" ? "AH"
                               : entry?.session === "PRE" ? "PM" : null;
            let absChange = "—";
            if (price != null && changePct != null) {
              const diff = price - price / (1 + changePct / 100);
              absChange = (diff >= 0 ? "+" : "") + diff.toFixed(2);
            }
            return (
              <div key={ticker} style={{
                background: "linear-gradient(to bottom, #1c1c1c, #111)",
                border: "1px solid #222",
                borderRadius: 3,
                padding: "5px 7px 3px",
                fontFamily: "'Roboto Condensed', sans-serif",
                minWidth: 0,
              }}>
                {/* Label + session + abs change */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{label}</span>
                    {sessionLabel && <span style={{ fontSize: 6, fontWeight: 800, color: "#94a3b8", background: "#171717", border: "1px solid #333", borderRadius: 2, padding: "0px 2px" }}>{sessionLabel}</span>}
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: changeColor, whiteSpace: "nowrap" }}>{absChange}</span>
                </div>
                {/* Price + % */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatPrice(price, ticker)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: changeColor, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 2 }}>
                    {changePct != null ? `${pos ? "+" : ""}${changePct.toFixed(2)}%` : "—"}
                  </span>
                </div>
                {/* Mini sparkline */}
                <BloombergChart data={entry.chartData} timestamps={entry.chartTimestamps} color={changeColor} />
              </div>
            );
          })}
        </div>
        {/* Compact clock strip beneath the grid */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "3px 8px 4px", gap: 10,
          borderTop: "1px solid rgba(255,255,255,.04)",
        }}>
          <MarketClockCompact />
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ───────────────────────────────────────
  return (
    <div ref={barRef} style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
      display: "flex", alignItems: "center",
      padding: "0 16px", height: 72,
      background: "rgba(14,14,14,0.98)",
      borderBottom: "1px solid rgba(255,255,255,.07)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 2px 20px rgba(0,0,0,0.7)",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "stretch", gap: Math.round(5 * scale),
        flex: "1 1 0", minWidth: 0,
        transformOrigin: "left center",
        transform: `scaleX(${scale}) scaleY(${Math.min(1, scale + 0.15)})`,
      }}>
        {TOP_BAR_TICKERS.map(({ ticker, label, color }) => {
          const entry      = marketData[ticker] || {};
          const price      = entry.price;
          const changePct  = entry.change;
          const pos        = (changePct ?? 0) >= 0;
          const changeColor = changePct == null ? "#475569" : pos ? "#10b981" : "#ef4444";
          const sessionLabel = entry?.session === "POST" || entry?.session === "CLOSED" ? "AH"
                             : entry?.session === "PRE" ? "PM" : null;
          let absChange = "—";
          if (price != null && changePct != null) {
            const diff = price - price / (1 + changePct / 100);
            absChange = (diff >= 0 ? "+" : "") + diff.toFixed(2);
          }
          return (
            <div key={ticker} style={{
              display: "flex", flexDirection: "column", justifyContent: "center",
              padding: "6px 10px 4px", borderRadius: 3,
              background: "linear-gradient(to bottom, #1c1c1c, #111)",
              border: "1px solid #222",
              fontFamily: "'Roboto Condensed', sans-serif",
              flex: "1 1 0", minWidth: 0, boxSizing: "border-box",
              overflow: "hidden",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{label}</span>
                  {sessionLabel && <span style={{ fontSize: 7, fontWeight: 800, color: "#94a3b8", background: "#171717", border: "1px solid #333", borderRadius: 2, padding: "1px 3px", flexShrink: 0 }}>{sessionLabel}</span>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: changeColor, whiteSpace: "nowrap", flexShrink: 0 }}>{absChange}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2, gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatPrice(price, ticker)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: changeColor, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {changePct != null ? `${pos ? "+" : ""}${changePct.toFixed(2)}%` : "—"}
                </span>
              </div>
              <BloombergChart data={entry.chartData} timestamps={entry.chartTimestamps} color={changeColor} />
            </div>
          );
        })}
      </div>
      <div ref={clockRef} style={{ flexShrink: 0, marginLeft: 14 }}>
        <MarketClock />
      </div>
    </div>
  );
}

// ── MARKET CLOCK ─────────────────────────────────────────
const NYSE_HOLIDAYS_2025_2026 = new Set([
  "2025-01-01","2025-01-20","2025-02-17","2025-04-18",
  "2025-05-26","2025-06-19","2025-07-04","2025-09-01",
  "2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03",
  "2026-05-25","2026-06-19","2026-07-03","2026-09-07",
  "2026-11-26","2026-12-25",
]);

function getNYTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", second: "numeric",
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  const h = parseInt(get("hour")), m = parseInt(get("minute")), s = parseInt(get("second"));
  const dow = get("weekday");
  const month = get("month"), day = get("day"), year = get("year");
  const dateStr = `${year}-${month}-${day}`;
  return { h, m, s, dow, dateStr };
}

function getMarketState(date = new Date()) {
  const { h, m, s, dow, dateStr } = getNYTime(date);
  const isWeekend = dow === "Sat" || dow === "Sun";
  const isHoliday = NYSE_HOLIDAYS_2025_2026.has(dateStr);
  const totalMins = h * 60 + m;

  if (isWeekend || isHoliday) return { state: "closed", session: "weekend" };
  if (totalMins <  4 * 60)            return { state: "closed",   session: "overnight" };
  if (totalMins <  9 * 60 + 30)       return { state: "pre",      session: "premarket"  };
  if (totalMins < 16 * 60)            return { state: "open",     session: "regular"    };
  if (totalMins < 20 * 60)            return { state: "post",     session: "afterhours" };
  return                                     { state: "closed",   session: "overnight"  };
}

function secsUntilNextEvent(date = new Date()) {
  const { h, m, s, dow, dateStr } = getNYTime(date);
  const totalSecs = h * 3600 + m * 60 + s;
  const { state } = getMarketState(date);

  if (state === "pre")  return (9 * 3600 + 30 * 60) - totalSecs;
  if (state === "open") return (16 * 3600)           - totalSecs;
  if (state === "post") return (20 * 3600)           - totalSecs;

  const openSecs = 9 * 3600 + 30 * 60;

  const isWeekend = dow === "Sat" || dow === "Sun";
  const isHoliday = NYSE_HOLIDAYS_2025_2026.has(dateStr);
  if (!isWeekend && !isHoliday && totalSecs < openSecs) {
    return openSecs - totalSecs;
  }

  for (let d = 1; d <= 7; d++) {
    const candidate = new Date(date.getTime() + d * 86400000);
    const cny = getNYTime(candidate);
    if (cny.dow !== "Sat" && cny.dow !== "Sun" && !NYSE_HOLIDAYS_2025_2026.has(cny.dateStr)) {
      const secsLeftToday = 86400 - totalSecs;
      return secsLeftToday + (d - 1) * 86400 + openSecs;
    }
  }
  return 0;
}

function fmtCountdown(secs) {
  if (secs <= 0) return "00:00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function MarketClock() {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date(tick);
  const { state } = getMarketState(now);
  const secsLeft = secsUntilNextEvent(now);
  const countdown = fmtCountdown(secsLeft);

  const { h, m, s } = getNYTime(now);
  const etTime = `${String(h % 12 || 12).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"} ET`;

  const isOpen = state === "open";
  const isPre  = state === "pre";
  const isPost = state === "post";
  const isExtended = isPre || isPost;

  const dotColor   = isOpen ? "#34d399" : isExtended ? "#f59e0b" : "#475569";
  const labelColor = isOpen ? "#34d399" : isExtended ? "#f59e0b" : "#64748b";
  const label      = isOpen ? "MARKET OPEN" : isPre ? "PRE-MARKET" : isPost ? "AFTER HOURS" : "MARKET CLOSED";
  const subLabel   = isOpen ? "closes in" : isExtended ? (isPre ? "opens in" : "closes in") : "opens in";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block",
          boxShadow: isOpen ? `0 0 6px ${dotColor}` : "none",
          animation: isOpen ? "pulseDot 2s infinite" : "none",
        }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: labelColor, textTransform: "uppercase" }}>{label}</span>
      </div>

      <div style={{ fontFamily: "'DM Mono','Fira Code',monospace" }}>
        <span style={{ fontSize: 10, color: "#334155", letterSpacing: "0.05em" }}>{subLabel} </span>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.08em", color: isOpen ? "#34d399" : isExtended ? "#f59e0b" : "#475569" }}>
          {countdown}
        </span>
      </div>

      <div style={{ fontSize: 9, color: "#2d3a52", fontFamily: "'DM Mono','Fira Code',monospace", letterSpacing: "0.05em" }}>{etTime}</div>
    </div>
  );
}

// Compact single-line clock for mobile top bar
function MarketClockCompact() {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const now      = new Date(tick);
  const { state } = getMarketState(now);
  const secsLeft = secsUntilNextEvent(now);
  const countdown = fmtCountdown(secsLeft);
  const { h, m, s } = getNYTime(now);
  const etTime = `${String(h % 12 || 12).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"} ET`;

  const isOpen  = state === "open";
  const isPre   = state === "pre";
  const isPost  = state === "post";
  const isExt   = isPre || isPost;
  const dotColor   = isOpen ? "#34d399" : isExt ? "#f59e0b" : "#475569";
  const label      = isOpen ? "OPEN" : isPre ? "PRE" : isPost ? "AH" : "CLOSED";
  const labelColor = isOpen ? "#34d399" : isExt ? "#f59e0b" : "#64748b";
  const subLabel   = isOpen ? "closes" : isExt ? (isPre ? "opens" : "closes") : "opens";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'DM Mono','Fira Code',monospace" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, display: "inline-block", boxShadow: isOpen ? `0 0 5px ${dotColor}` : "none", animation: isOpen ? "pulseDot 2s infinite" : "none" }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.15em", color: labelColor }}>{label}</span>
      </div>
      <span style={{ fontSize: 9, color: "#334155" }}>{subLabel} in</span>
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", color: isOpen ? "#34d399" : isExt ? "#f59e0b" : "#475569" }}>{countdown}</span>
      <span style={{ fontSize: 9, color: "#2d3a52", letterSpacing: "0.04em" }}>{etTime}</span>
    </div>
  );
}

// ── MARKET STRIP (BLOOMBERG STYLE) ──────────────────────────
function BloombergChart({ data, timestamps, color }) {
  if (!data || !timestamps || data.length < 2) return (
    <div style={{ height: 24, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
      <span style={{ fontSize: 8, color: "#475569" }}>NO CHART DATA</span>
    </div>
  );

  const vbWidth = 160;
  const height = 24;
  
  // Find the separator between yesterday and today
  let splitIndex = -1;
  let maxGap = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i-1];
    if (gap > maxGap) { maxGap = gap; splitIndex = i; }
  }
  
  // If no overnight gap exists (Crypto is 24/7), separate at exactly 24 hours ago
  if (maxGap < 4 * 3600) {
    const dayAgo = timestamps[timestamps.length - 1] - 24 * 3600;
    splitIndex = timestamps.findIndex(t => t >= dayAgo);
  }
  if (splitIndex <= 0) splitIndex = Math.floor(data.length / 2);

  const validData = [];
  for(let i=0; i<data.length; i++) {
    if (data[i] != null) validData.push({ val: data[i], idx: i });
  }
  if (validData.length < 2) return null;

  const min = Math.min(...validData.map(d => d.val));
  const max = Math.max(...validData.map(d => d.val));
  const yRange = (max - min) || 1;
  const yMin = min - (yRange * 0.1);
  const yMax = max + (yRange * 0.1);
  const scaleY = yMax - yMin;

  const getX = (idx) => (idx / (data.length - 1)) * vbWidth;
  const getY = (val) => height - ((val - yMin) / scaleY) * height;

  const part1 = validData.filter(d => d.idx <= splitIndex);
  const part2 = validData.filter(d => d.idx >= splitIndex); // Overlap so the line connects seamlessly

  const path1 = part1.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(d.idx)},${getY(d.val)}`).join(" ");
  const path2 = part2.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(d.idx)},${getY(d.val)}`).join(" ");
  const splitX = getX(splitIndex);

  return (
    <div style={{ height, marginTop: 4, position: "relative", zIndex: 0, overflow: "hidden" }}>
      <svg width="100%" height={height} viewBox={`0 0 ${vbWidth} ${height}`} preserveAspectRatio="none" style={{ overflow: "hidden", display: "block" }}>
        <defs>
          <clipPath id="bloomberg-clip">
            <rect x="0" y="0" width={vbWidth} height={height} />
          </clipPath>
        </defs>
        <g clipPath="url(#bloomberg-clip)">
          <line x1={splitX} y1={0} x2={splitX} y2={height} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="2,2" />
          {path1 && <path d={path1} fill="none" stroke="#f8fafc" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
          {path2 && <path d={path2} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
        </g>
      </svg>
    </div>
  );
}

function MarketStrip({ data, tickers, labels, colors }) {
  function formatPrice(p, ticker) {
    if (p === null || p === undefined) return "—";
    if (ticker === "BTC-USD" || ticker === "ETH-USD") return p.toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: false });
    if (ticker === "XRP-USD") return p.toFixed(4);
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  }
  
  return (
    <div className="market-strip" style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "flex-start", padding: "0 10px" }}>
      {tickers.map((ticker, i) => {
        const entry = data[ticker] || {};
        const price = entry.price;
        const changePct = entry.change;
        const pos = (changePct ?? 0) >= 0;
        
        // Bloomberg uses very stark red/green
        const changeColor = changePct === undefined || changePct === null ? "#475569" : pos ? "#10b981" : "#ef4444";

        // Reverse-engineer absolute point change (since our backend only provides percentage)
        let absChange = "—";
        if (price != null && changePct != null) {
           const prevPrice = price / (1 + (changePct / 100));
           const diff = price - prevPrice;
           absChange = (diff >= 0 ? "+" : "") + diff.toFixed(2);
        }
        
        return (
          <div key={ticker} style={{
            display: "flex", flexDirection: "column",
            padding: "6px 10px", borderRadius: 2, width: 160, flexShrink: 0, boxSizing: "border-box",
            background: "linear-gradient(to bottom, #262626, #0a0a0a)", 
            border: "1px solid #171717",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.5)",
            fontFamily: "'Roboto Condensed', sans-serif"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: colors[i] || "#fbbf24", letterSpacing: "0.02em" }}>
                {labels[i]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: changeColor }}>
                {absChange}
              </span>
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                {formatPrice(price, ticker)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: changeColor }}>
                {changePct != null ? `${pos ? "+" : ""}${changePct.toFixed(2)}%` : "—"}
              </span>
            </div>

            <BloombergChart data={entry.chartData} timestamps={entry.chartTimestamps} color={changeColor} />
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
  const sessionLabel = session === "POST" || session === "CLOSED" ? "AH" : session === "PRE" ? "PM" : null;

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
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <div style={{ fontSize: 11, color: isActive ? track.color : "#94a3b8", fontWeight: track.isLiveIntel ? 700 : 400 }}>{track.value}</div>
        {track.isLiveIntel && (
          <span title="Updated by live intel" style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 5px #34d399", flexShrink: 0 }} />
        )}
      </div>
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
function getNear52WLowInfo(priceEntry) {
  if (!priceEntry) return null;
  const { price, week52Low } = priceEntry;
  if (price == null || week52Low == null || week52Low <= 0) return null;
  const pctAboveLow = ((price - week52Low) / week52Low) * 100;
  if (pctAboveLow >= 0 && pctAboveLow <= 25) {
    return { raw52Low: week52Low };
  }
  return null;
}

function getNear52WHighInfo(priceEntry) {
  if (!priceEntry) return null;
  const { price, week52High } = priceEntry;
  if (price == null || week52High == null || week52High <= 0) return null;
  const pctBelowHigh = ((week52High - price) / week52High) * 100;
  if (pctBelowHigh >= 0 && pctBelowHigh <= 10) {
    return { raw52High: week52High };
  }
  return null;
}

function HeatMap({ prices, capexData, onTickerClick }) {
  const isMobile = useMobile();
  const [tooltip, setTooltip] = useState(null);

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
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: isMobile ? "12px 8px" : 20, height: "100%", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Portfolio Heat Map</h3>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>All tracked tickers · color = 1D performance</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "#64748b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "rgba(251,191,36,0.25)", border: "1px solid #f59e0b", boxShadow: "0 0 6px #f59e0b88" }} />
            <span>within 25% of 52W low</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "rgba(52,211,153,0.25)", border: "1px solid #34d399", boxShadow: "0 0 6px #34d39988" }} />
            <span>within 10% of 52W high</span>
          </div>
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 4 : 6, minHeight: 40 }}>
              {cells.map(ticker => {
                const entry = prices[ticker];
                const change = entry?.change ?? entry;
                const currentPrice = entry?.price;
                const session = entry?.session;
                const sessionLabel = session === "POST" || session === "CLOSED" ? "AH" : session === "PRE" ? "PM" : null;
                const bg = getHeatColor(change);
                const pos = change === undefined || change >= 0;
                const near52W = getNear52WLowInfo(entry);
                const near52WH = !near52W ? getNear52WHighInfo(entry) : null;
                
                const earningsDate = entry?.earningsDate;
                const isUpcomingEarnings = earningsDate && (earningsDate * 1000 - Date.now() <= 3 * 86400000) && (earningsDate * 1000 - Date.now() >= -86400000);

                return (
                  <div key={ticker}
                    onMouseEnter={e => setTooltip({ ticker, change, price: currentPrice, session: sessionLabel, track: track.label, near52W, near52WH, isUpcomingEarnings, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={e => { e.stopPropagation(); onTickerClick?.(ticker, e.currentTarget.getBoundingClientRect()); }}
                    style={{
                      position: "relative",
                      background: near52W
                        ? `linear-gradient(135deg, ${bg} 60%, rgba(245,158,11,0.18) 100%)`
                        : near52WH
                        ? `linear-gradient(135deg, ${bg} 60%, rgba(52,211,153,0.18) 100%)`
                        : bg,
                      borderRadius: 8,
                      padding: "8px 12px",
                      height: 48,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      border: near52W
                        ? "1px solid #f59e0b"
                        : near52WH
                        ? "1px solid #34d399"
                        : `1px solid ${bg === "rgba(255,255,255,0.04)" ? "rgba(255,255,255,0.06)" : bg}`,
                      boxShadow: near52W
                        ? "0 0 10px rgba(245,158,11,0.45), inset 0 0 12px rgba(245,158,11,0.08)"
                        : near52WH
                        ? "0 0 10px rgba(52,211,153,0.45), inset 0 0 12px rgba(52,211,153,0.08)"
                        : "none",
                      animation: near52W
                        ? "glowPulse52W 2.4s ease-in-out infinite"
                        : near52WH
                        ? "glowPulse52WH 2.4s ease-in-out infinite"
                        : "none",
                      minWidth: 52,
                      textAlign: "center",
                      cursor: "pointer",
                      transition: "filter .15s, transform .15s",
                    }}
                    onMouseOver={e => { e.currentTarget.style.filter = "brightness(1.4)"; e.currentTarget.style.transform = "scale(1.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}>
                    
                    {isUpcomingEarnings && (
                      <div style={{ position: "absolute", top: 3, left: 4, fontSize: 8, fontWeight: 800, color: "#c084fc", letterSpacing: "0.05em", lineHeight: 1 }}>E</div>
                    )}

                    {sessionLabel && !near52W && !near52WH && (
                      <div style={{ position: "absolute", top: 3, right: 4, fontSize: 7, fontWeight: 800, color: "rgba(255,255,255,0.55)", letterSpacing: "0.05em", lineHeight: 1 }}>{sessionLabel}</div>
                    )}
                    {near52W && (
                      <div style={{ position: "absolute", top: 3, right: 4, fontSize: 7, fontWeight: 800, color: "#f59e0b", letterSpacing: "0.05em", lineHeight: 1 }}>▼52W</div>
                    )}
                    {near52WH && (
                      <div style={{ position: "absolute", top: 3, right: 4, fontSize: 7, fontWeight: 800, color: "#34d399", letterSpacing: "0.05em", lineHeight: 1 }}>▲52W</div>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 700, color: near52W ? "#fef3c7" : near52WH ? "#d1fae5" : "#f1f5f9" }}>{ticker}</div>
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
        <div style={{ position: "fixed", top: tooltip.rect.top - (tooltip.near52W || tooltip.near52WH || tooltip.isUpcomingEarnings ? 68 : 52), left: tooltip.rect.left, background: "rgba(18,18,18,0.95)", border: `1px solid ${tooltip.near52W ? "#f59e0b" : tooltip.near52WH ? "#34d399" : (tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171"}44`, borderRadius: 8, padding: "7px 12px", pointerEvents: "none", zIndex: 1000, display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tooltip.ticker}</span>
            {tooltip.price !== undefined && <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>${tooltip.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
            {tooltip.change !== undefined && <span style={{ fontSize: 12, fontWeight: 700, color: (tooltip.change ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{typeof tooltip.change === 'number' ? (tooltip.change >= 0 ? "+" : "") + tooltip.change + "%" : "—"}</span>}
            {tooltip.session && <span style={{ fontSize: 9, fontWeight: 700, color: "#64748b", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.05em" }}>{tooltip.session}</span>}
            <span style={{ fontSize: 10, color: "#475569" }}>{tooltip.track}</span>
          </div>
          
          {tooltip.isUpcomingEarnings && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 8, fontWeight: 800, color: "#c084fc", background: "rgba(192,132,252,0.15)", border: "1px solid rgba(192,132,252,0.4)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.08em" }}>E EARNINGS SOON</span>
              <span style={{ fontSize: 10, color: "#c084fc" }}>Within 3 Days</span>
            </div>
          )}

          {tooltip.near52W && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 8, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.08em" }}>▼ 52W LOW ZONE</span>
              <span style={{ fontSize: 10, color: "#f59e0b" }}>within 25% of ${Number(tooltip.near52W.raw52Low).toFixed(2)}</span>
            </div>
          )}
          {tooltip.near52WH && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 8, fontWeight: 800, color: "#34d399", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.08em" }}>▲ 52W HIGH ZONE</span>
              <span style={{ fontSize: 10, color: "#34d399" }}>within 10% of ${Number(tooltip.near52WH.raw52High).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DONUT CHART ───────────────────────────────────────────
function DonutChart({ prices, capexData, capexIntel, capexIntelStatus, capexIntelError }) {
  const isMobile = useMobile();
  const [hovered, setHovered] = useState(null);
  const total = useMemo(() => capexData.tracks.reduce((s, t) => s + (t.capex || 0), 0), [capexData]);
  const cx = 130, cy = 130, R = 90, r = 52;

  const isLive    = capexIntelStatus === "success" && !!(capexIntel?.allocations?.length);
  const isLoading = capexIntelStatus === "loading";
  const isError   = capexIntelStatus === "error";
  const intelAge = capexIntel?.fetchedAt
    ? (() => {
        const diffMs  = Date.now() - capexIntel.fetchedAt;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr  = Math.floor(diffMin / 60);
        if (diffHr >= 1) return `${diffHr}h ago`;
        if (diffMin >= 1) return `${diffMin}m ago`;
        return "just now";
      })()
    : null;

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

  const trackPerf = useMemo(() =>
    capexData.tracks.map(track => {
      const tickers = [...new Set(track.subsectors.flatMap(s => s.tickers))];
      const changes = tickers.map(t => prices[t]?.change ?? prices[t]).filter(v => typeof v === 'number');
      const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
      return { ...track, avg };
    }).sort((a, b) => b.avg - a.avg),
  [capexData, prices]);

  const segments = useMemo(() =>
    segmentShapes.map(s => {
      const perf = trackPerf.find(t => t.id === s.track.id);
      return { ...s, avg: perf?.avg ?? 0 };
    }),
  [segmentShapes, trackPerf]);

  const hov = hovered ? segments.find(s => s.track.id === hovered) : null;

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: isMobile ? "12px 8px" : 20, height: "100%", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", width: "100%" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Sector Allocation</h3>
          {isLoading && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "2px 7px" }}>
              ⟳ FETCHING LIVE INTEL…
            </span>
          )}
          {isLive && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, padding: "2px 7px" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 5px #34d399" }} />
                LIVE INTEL
              </span>
              {intelAge && <span style={{ fontSize: 9, color: "#475569" }}>{intelAge}</span>}
            </div>
          )}
          {isError && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 4, padding: "2px 7px", display: "block", whiteSpace: "normal", lineHeight: 1.5 }}>
              ⚠ {capexIntelError}
            </span>
          )}
          {!isLoading && !isLive && !isError && (
            <span style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>ESTIMATED</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
          {isLive ? "Claude web search · hyperscaler filings & earnings · hover to inspect"
           : isError ? "Showing static estimates — check GEMINI_API_KEY env var & redeploy capex-intel.js"
           : "Capex weight · hover to inspect avg performance"}
        </p>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <svg viewBox="0 0 260 260" style={{ width: "100%", maxWidth: 260, height: "auto" }}>
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
              <text x={cx} y={cy + 14} textAnchor="middle" fill="#fbbf24" fontSize="20" fontWeight="800">${total}B</text>
              <text x={cx} y={cy + 30} textAnchor="middle" fill={isLive ? "#34d399" : "#475569"} fontSize="10">{isLive ? "live intel" : "tracked"}</text>
            </>
          )}
        </svg>
        <div style={{ flex: "1 1 140px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {trackPerf.map(track => (
            <div key={track.id} onMouseEnter={() => setHovered(track.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: "default", opacity: hovered && hovered !== track.id ? 0.35 : 1, transition: "opacity .2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color }} />
                  <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>{track.label}</span>
                  {isLive && track.intelConfidence === "high" && (
                    <span style={{ fontSize: 8, color: "#34d399", opacity: 0.7 }}>●</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 10, color: isLive ? "#94a3b8" : "#475569" }}>${track.capex}B</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: track.avg >= 0 ? "#34d399" : "#f87171", minWidth: 46, textAlign: "right" }}>{track.avg >= 0 ? "+" : ""}{track.avg.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, width: `${(track.capex / total) * 100}%`, background: `linear-gradient(90deg,${track.borderColor},${track.color})`, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
              </div>
              {isLive && track.rationale && hovered === track.id && (
                <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, lineHeight: 1.4, fontStyle: "italic" }}>{track.rationale}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── WATCHLIST ─────────────────────────────────────────────
function Watchlist({ prices, capexData, onTickerClick, isAdmin, shortList, onSaveShortlist }) {
  const isMobile = useMobile();
  const [tab, setTab]         = useState("watch");
  const [input, setInput]     = useState("");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter]   = useState("all");

  const isShort = tab === "short";
  const accent  = isShort ? "#f59e0b" : "#60a5fa";

  // Watchlist is always derived live from capexData — no local state needed
  const watchList = useMemo(
    () => [...new Set(capexData.tracks.flatMap(t => t.subsectors.flatMap(s => s.tickers)))],
    [capexData]
  );

  const list = isShort ? shortList : watchList;

  function switchTab(t) { setTab(t); setFilter("all"); setInput(""); }

  function addTicker(sym) {
    if (!sym || shortList.includes(sym)) return;
    onSaveShortlist([...shortList, sym]);
  }
  function removeTicker(sym) {
    onSaveShortlist(shortList.filter(x => x !== sym));
  }

  function handleAdd() {
    const sym = input.trim().toUpperCase();
    if (sym) { addTicker(sym); setInput(""); }
  }

  const sectorMap = useMemo(() => {
    const map = {};
    for (const track of capexData.tracks)
      for (const sub of track.subsectors)
        for (const t of sub.tickers) map[t] = track;
    return map;
  }, [capexData]);

  const TRACK_SHORT = { compute: "Compute", networking: "Network", photonics: "Photonics", neoclouds: "Data Ctr", power: "Power", frontier: "Frontier" };

  const enriched     = list.map(t => ({ ticker: t, change: prices[t]?.change ?? prices[t], track: sectorMap[t] ?? null }));
  const filtered     = filter === "all" ? enriched : enriched.filter(x => x.track?.id === filter);
  const sorted       = [...filtered].sort((a, b) => sortDir === "desc"
    ? ((typeof b.change === 'number' ? b.change : -999) - (typeof a.change === 'number' ? a.change : -999))
    : ((typeof a.change === 'number' ? a.change : 999)  - (typeof b.change === 'number' ? b.change : 999)));
  const validChanges = filtered.filter(x => typeof x.change === 'number');
  const avg          = validChanges.reduce((s, x) => s + x.change, 0) / (validChanges.length || 1);

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: isMobile ? "12px 8px" : 20, display: "flex", flexDirection: "column", gap: 14, height: "100%", boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
          {[["watch","👁 Watchlist"],["short","⭐ Shortlist"]].map(([id, label]) => (
            <button key={id} onClick={() => switchTab(id)} style={{
              background: tab === id ? (id === "short" ? "rgba(245,158,11,0.15)" : "rgba(96,165,250,0.12)") : "transparent",
              border: `1px solid ${tab === id ? (id === "short" ? "rgba(245,158,11,0.35)" : "rgba(96,165,250,0.25)") : "transparent"}`,
              color: tab === id ? (id === "short" ? "#f59e0b" : "#60a5fa") : "#475569",
              borderRadius: 7, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
              fontWeight: tab === id ? 700 : 400, transition: "all .15s",
            }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
          <div style={{ textAlign: "center" }}><div style={{ color: "#34d399", fontWeight: 700 }}>{filtered.filter(x => (typeof x.change === 'number' ? x.change : -1) >= 0).length}</div><div style={{ color: "#475569", fontSize: 10 }}>UP</div></div>
          <div style={{ textAlign: "center" }}><div style={{ color: "#f87171", fontWeight: 700 }}>{filtered.filter(x => (typeof x.change === 'number' ? x.change : 0) < 0).length}</div><div style={{ color: "#475569", fontSize: 10 }}>DOWN</div></div>
          <div style={{ textAlign: "center" }}><div style={{ color: avg >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{validChanges.length ? (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%" : "—"}</div><div style={{ color: "#475569", fontSize: 10 }}>AVG</div></div>
        </div>
      </div>

      {isShort ? (
        <p style={{ fontSize: 11, color: "#64748b", margin: 0, marginTop: -6 }}>
          Potential investment opportunities · shared with all users
        </p>
      ) : (
        <p style={{ fontSize: 11, color: "#475569", margin: 0, marginTop: -6, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: "#334155" }}>⟳</span> Auto-synced from Portfolio Heat Map
        </p>
      )}

      {isShort && (
        !isAdmin ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 14 }}>🔒</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>Login to add or remove tickers from the Shortlist</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="Add opportunity… e.g. NVDA"
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={handleAdd} style={{ background: `${accent}1a`, border: `1px solid ${accent}40`, color: accent, borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+ Add</button>
          </div>
        )
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${filter === "all" ? "rgba(255,255,255,0.1)" : (capexData.tracks.find(t => t.id === filter)?.color ?? "#60a5fa") + "66"}`,
            borderRadius: 8,
            padding: "5px 10px",
            color: filter === "all" ? "#e2e8f0" : (capexData.tracks.find(t => t.id === filter)?.color ?? "#e2e8f0"),
            fontSize: 11,
            fontFamily: "inherit",
            cursor: "pointer",
            outline: "none",
            appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
            paddingRight: 28,
          }}
        >
          <option value="all" style={{ background: "#1e293b", color: "#e2e8f0" }}>All Sectors</option>
          {capexData.tracks.map(track => {
            const label = TRACK_SHORT[track.id] ?? track.label.split(" ")[0];
            return (
              <option key={track.id} value={track.id} style={{ background: "#1e293b", color: "#e2e8f0" }}>{label}</option>
            );
          })}
        </select>
        <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")} style={{ flexShrink: 0, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Sort {sortDir === "desc" ? "↓" : "↑"}</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0, paddingRight: 4 }}>
        {sorted.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#334155", fontSize: 12 }}>
            <span style={{ fontSize: 28 }}>{isShort ? "⭐" : "👁"}</span>
            <span>{isShort ? "Add tickers you're watching for entry" : "No tickers match this filter"}</span>
          </div>
        )}
        {sorted.map((item, idx) => {
          const pos  = (typeof item.change === 'number' ? item.change : 0) >= 0;
          const pData = prices[item.ticker] || {};
          const w52L = pData.week52Low;
          const w52H = pData.week52High;
          const pLive = pData.price;
          const has52W = w52L != null && w52H != null && pLive != null && (w52H > w52L);
          const dotPos = has52W ? Math.max(0, Math.min(100, ((pLive - w52L) / (w52H - w52L)) * 100)) : 50;
          const dotColor = pos ? "#34d399" : "#f87171";

          return (
            <div key={item.ticker} style={{ borderRadius: 8, padding: "10px 10px", display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background .15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span style={{ fontSize: 10, color: "#334155", width: 16, textAlign: "right", flexShrink: 0 }}>{idx + 1}</span>
              <div style={{ flex: "0 0 auto", minWidth: isMobile ? 46 : 60, cursor: "pointer" }} onClick={e => onTickerClick?.(item.ticker, e.currentTarget.getBoundingClientRect())}>
                <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: "#f1f5f9" }}>{item.ticker}</div>
                {item.track
                  ? <div style={{ fontSize: 9, color: item.track.color, marginTop: 1 }}>{item.track.label.split(" ").slice(0,2).join(" ")}</div>
                  : isShort && <div style={{ fontSize: 9, color: "#f59e0b", marginTop: 1 }}>Shortlist</div>
                }
              </div>

              {/* 52W Range Tracker */}
              {(() => {
                const pData = prices[item.ticker] || {};
                const w52L = pData.week52Low;
                const w52H = pData.week52High;
                const pLive = pData.price;
                const has52W = w52L != null && w52H != null && pLive != null && (w52H > w52L);
                const dotPos = has52W ? Math.max(0, Math.min(100, ((pLive - w52L) / (w52H - w52L)) * 100)) : 50;
                const dotColor = pos ? "#34d399" : "#f87171";
                
                return (
                  <div className="range-52w" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, fontFamily: "monospace", minWidth: 100 }}>
                    {has52W ? (
                      <>
                        {/* Bar + dot + current price label above dot */}
                        <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
                          <div style={{ position: "absolute", left: `${dotPos}%`, top: "50%", transform: "translate(-50%, -50%)", zIndex: 2 }}>
                            <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 3, background: "rgba(24,24,24,0.85)", padding: "1px 5px", borderRadius: 4, fontSize: 8.5, fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap" }}>
                              ${pLive.toFixed(2)}
                            </div>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: `0 0 6px ${dotColor}88` }} />
                          </div>
                        </div>
                        {/* Low / High labels below the bar */}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#475569" }}>
                          <span>{w52L}</span>
                          <span>{w52H}</span>
                        </div>
                      </>
                    ) : (
                      <span style={{ textAlign: "center", color: "#475569", fontSize: 9 }}>—</span>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, fontSize: isMobile ? 11 : 13, fontWeight: 700, minWidth: isMobile ? 54 : 68, textAlign: "right", flexShrink: 0, color: typeof item.change !== 'number' ? "#334155" : pos ? "#34d399" : "#f87171" }}>
                {typeof item.change !== 'number' ? "—" : <><span style={{ fontSize: 10 }}>{pos ? "▲" : "▼"}</span>{Math.abs(item.change).toFixed(2)}%</>}
              </div>
              <button onClick={() => removeTicker(item.ticker)} style={{ background: "none", border: "none", color: "#1e293b", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1, transition: "color .15s", fontFamily: "inherit", visibility: !isShort || !isAdmin ? "hidden" : "visible", flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = "#ef4444"} onMouseLeave={e => e.currentTarget.style.color = "#1e293b"}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MULTIBAGGER PANEL ─────────────────────────────────────
function MultibaggerPanel({ prices, scannerPool, isAdmin, onSaveScanner, onTickerClick }) {
  const isMobile = useMobile();
  const [allData, setAllData]           = useState([]);
  const [data, setData]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [newTicker, setNewTicker]       = useState("");
  const [showImport, setShowImport]     = useState(false);
  const [importText, setImportText]     = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [lastUpdated, setLastUpdated]   = useState(null);

  const fetchRanked = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/scanner-ranked");
      const json = await res.json();
      if (json.success && json.data?.length > 0) {
        setAllData(json.data);
        setData(json.data);
        setLastUpdated(new Date().toLocaleDateString());
      } else {
        // Change this line to show the real API error if it fails
        setError(json.message || "No ranked data available yet. Run the ETL pipeline to populate the scanner.");
        setAllData([]);
        setData([]);
      }
    } catch (err) {
      setError("Could not reach scanner API. Check your Cloudflare deployment.");
      setAllData([]);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRanked(); }, []);

  useEffect(() => {
    if (sectorFilter) {
      setData(allData.filter(d => d.sector === sectorFilter));
    } else {
      setData(allData);
    }
  }, [sectorFilter, allData]);

  const addTicker = () => {
    const sym = newTicker.trim().toUpperCase();
    if (sym && !scannerPool.includes(sym)) { onSaveScanner([...scannerPool, sym]); setNewTicker(""); }
  };

  const handleImport = () => {
    const words = importText.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
    const ignoreList = ["INC","CORP","CO","LTD","PLC","LLC","USD","EUR","CAD","M","B","K","TRUE","FALSE"];
    const found = [...new Set(words)].filter(w => !ignoreList.includes(w));
    if (found.length > 0) { onSaveScanner(found); setShowImport(false); setImportText(""); }
    else { alert("No valid tickers found."); }
  };

  const removeTicker = (ticker) => { onSaveScanner(scannerPool.filter(t => t !== ticker)); };

  const getScoreColor = (score) => {
    if (score >= 70) return "#34d399";
    if (score >= 45) return "#fbbf24";
    return "#f87171";
  };

  const get52wColor = (pct) => {
    if (pct == null) return "#475569";
    if (pct <= 20)  return "#34d399";
    if (pct <= 50)  return "#fbbf24";
    return "#64748b";
  };

  const sectors = [...new Set(allData.map(d => d.sector).filter(Boolean))].sort();

  return (
    <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(24,24,24,0.7)", padding: isMobile ? "12px 8px" : 20, display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8, flexShrink: 0, minWidth: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>Small-cap Scanner</h3>
            <span style={{ fontSize: 9, color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, padding: "2px 7px", fontWeight: 700, letterSpacing: "0.1em" }}>● DB RANKED</span>
          </div>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
            ETL-ranked · FCF(35%) B/M(20%) ROA(15%) Growth(15%) Rev(15%) · updated {lastUpdated ?? "weekly"}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {sectors.length > 0 && (
            <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
              <option value="">All Sectors</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button onClick={() => fetchRanked()}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            ↻ Refresh
          </button>
          {isAdmin && (
            <>
              <button onClick={() => setShowImport(!showImport)}
                style={{ background: "transparent", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
                {showImport ? "Close Import" : "⎘ Smart Import"}
              </button>
              <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker..."
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 12, outline: "none", width: 100 }} />
              <button onClick={addTicker}
                style={{ background: "#fbbf24", color: "#000", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", border: "none" }}>+</button>
            </>
          )}
        </div>
      </div>

      {showImport && isAdmin && (
        <div style={{ marginBottom: 16, background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", animation: "fadeSlideIn .2s ease-out", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Paste raw tickers to instantly update the dashboard globally.</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="e.g. NVDA, MSFT, AAPL"
              style={{ flex: 1, height: 60, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 8, color: "#e2e8f0", fontSize: 12, fontFamily: "monospace", outline: "none", resize: "vertical" }} />
            <button onClick={handleImport}
              style={{ background: "#60a5fa", color: "#000", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Update Global</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", minHeight: 400, paddingRight: isMobile ? 0 : 4, WebkitOverflowScrolling: "touch" }}>
        {error && (
          <div style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: "#f87171", fontSize: 12 }}>⚠ {error} — showing live-scored fallback.</div>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 10 : 11, textAlign: "left" }}>
          <thead>
            <tr style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "sticky", top: 0, background: "rgba(14,17,23,0.95)", zIndex: 10 }}>
              {...['#','TICKER','PRICE','MKT CAP','FCF YLD','B/M','ROA','REV GR','52W LOW'].map((h,i) => <th key={h} style={{ padding: isMobile ? '6px 4px' : '10px 8px', whiteSpace: 'nowrap' }}>{h}</th>)}
              <th style={{ padding: isMobile ? '6px 4px' : '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>SCORE</th>
              {isAdmin && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="11" style={{ padding: 20, color: "#475569" }}>
                Loading ranked candidates from Neon...
              </td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan="11" style={{ padding: 20, color: "#475569" }}>
                No candidates found{sectorFilter ? ` in ${sectorFilter}` : ""}.
              </td></tr>
            ) : data.map((stock) => {
              const priceEntry = prices[stock.ticker];
              const livePrice  = priceEntry?.price;
              const change     = priceEntry?.change;

              const priceStr = livePrice
                ? "$" + livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : stock.price != null
                  ? "$" + Number(stock.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "—";

              const marketCapRaw = (stock.market_cap ?? 0) * 1_000_000;
              const marketCapStr = marketCapRaw > 0 ? fmtMarketCap(marketCapRaw) : "—";

              const score    = Number(stock.composite_score);
              const fcfYield = Number(stock.fcf_yield);
              const bm       = Number(stock.book_to_market);
              const roa      = Number(stock.roa);
              const revGr    = stock.revenue_growth != null ? Number(stock.revenue_growth) : null;
              const pct52w   = stock.pct_above_52w_low != null ? Number(stock.pct_above_52w_low) : null;
              const penalty  = stock.quality_penalty ?? 0;

              const fcfDisplay = !isNaN(fcfYield) ? (fcfYield * 100).toFixed(2) + "%" : "—";
              const roaDisplay = !isNaN(roa) ? (roa * 100).toFixed(1) + "%" : "—";
              const revDisplay = revGr != null && !isNaN(revGr)
                ? (revGr >= 0 ? "+" : "") + (revGr * 100).toFixed(1) + "%" : "—";
              const pct52wDisplay = pct52w != null
                ? "+" + pct52w.toFixed(1) + "%" : "—";

              return (
                <tr key={stock.ticker}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background .15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: "#334155", fontSize: 10 }}>
                    {stock.rank_overall ?? "—"}
                  </td>

                  <td onClick={e => onTickerClick(stock.ticker, e.currentTarget.getBoundingClientRect())}
                    style={{ padding: isMobile ? "8px 4px" : "12px 8px", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{stock.ticker}</span>
                      {penalty > 0 && (
                        <span title={`Quality penalty: ${penalty} flag${penalty > 1 ? "s" : ""}`}
                          style={{ fontSize: 9, color: "#f87171", fontWeight: 700 }}>
                          {"⚑".repeat(penalty)}
                        </span>
                      )}
                    </div>
                    {stock.sector && <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>{stock.sector}</div>}
                    {change !== undefined && (
                      <div style={{ fontSize: 9, color: change >= 0 ? "#34d399" : "#f87171" }}>
                        {change >= 0 ? "+" : ""}{change}%
                      </div>
                    )}
                  </td>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: "#e2e8f0", fontWeight: 600 }}>{priceStr}</td>
                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: "#cbd5e1" }}>{marketCapStr}</td>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: !isNaN(fcfYield) && fcfYield > 0.08 ? "#34d399" : "#cbd5e1" }}>
                    {fcfDisplay}
                  </td>
                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: "#cbd5e1" }}>
                    {!isNaN(bm) ? bm.toFixed(3) : "—"}
                  </td>
                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: !isNaN(roa) && roa < 0 ? "#f87171" : "#cbd5e1" }}>
                    {roaDisplay}
                  </td>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: revGr != null && revGr > 0 ? "#34d399" : revGr != null && revGr < -0.1 ? "#f87171" : "#cbd5e1" }}>
                    {revDisplay}
                  </td>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", color: get52wColor(pct52w), fontWeight: pct52w != null && pct52w <= 20 ? 700 : 400 }}>
                    {pct52wDisplay}
                  </td>

                  <td style={{ padding: isMobile ? "8px 4px" : "12px 8px", textAlign: "right", fontWeight: 800, color: getScoreColor(score * 100), fontSize: 13 }}>
                    {!isNaN(score) ? (score * 100).toFixed(1) : "—"}
                  </td>

                  {isAdmin && (
                    <td style={{ textAlign: "right" }}>
                      <button onClick={() => removeTicker(stock.ticker)}
                        style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 16, transition: "color .15s" }}
                        onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                        onMouseLeave={e => e.currentTarget.style.color = "#334155"}>×</button>
                    </td>
                  )}
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

// ── GLOBAL STYLES ─────────────────────────────────────────
const GLOBAL_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; box-shadow: none !important; }
  html, body { background: #1a1a1f; font-family: 'Inter', sans-serif; max-width: 100vw; overflow-x: hidden; }
  img, svg, video, table { max-width: 100%; }
  :root { --topbar-h: 72px; }
  @media (max-width: 767px) { :root { --topbar-h: 172px; } }
  
  html.light-mode { filter: invert(1) hue-rotate(180deg); }
  
  table, .market-strip span, .ticker-tape, .capex-number { font-family: 'Roboto Condensed', sans-serif !important; letter-spacing: 0.02em; }
  div[style*="border-radius: 12px"], div[style*="border-radius: 14px"], div[style*="border-radius: 18px"], div[style*="border-radius: 22px"] { border-radius: 6px !important; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
  @keyframes scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes glowPulse52W {
    0%, 100% { box-shadow: 0 0 10px rgba(245,158,11,0.45), inset 0 0 12px rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.7); }
    50% { box-shadow: 0 0 18px rgba(245,158,11,0.75), 0 0 32px rgba(245,158,11,0.25), inset 0 0 16px rgba(245,158,11,0.14); border-color: #f59e0b; }
  }
  @keyframes glowPulse52WH {
    0%, 100% { box-shadow: 0 0 10px rgba(52,211,153,0.45), inset 0 0 12px rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.7); }
    50% { box-shadow: 0 0 18px rgba(52,211,153,0.75), 0 0 32px rgba(52,211,153,0.25), inset 0 0 16px rgba(52,211,153,0.14); border-color: #34d399; }
  }
  @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.4; transform:scale(.7); } }
  .ticker-tape { animation: scroll-left 130s linear infinite; white-space: nowrap; display: inline-flex; gap: 24px; }
  .pulse { animation: pulseDot 2s infinite; }
  .bottom-grid-all { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .span-2 { grid-column: span 2; }
  .span-1 { grid-column: span 1; }
  .panel-wrapper { position: relative; height: 600px; min-height: 600px; }
  .panel-inner { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
  @media (max-width: 1024px) {
    .bottom-grid-all { grid-template-columns: 1fr !important; }
    .span-2, .span-1 { grid-column: 1 / -1 !important; }
    .panel-wrapper { min-height: 500px; height: auto; }
    .panel-inner { position: relative; height: 100%; }
  }
  @media (max-width: 767px) {
    html, body { overflow-x: hidden; }
    .track-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
    .top-node-layout { flex-direction: column !important; align-items: stretch !important; gap: 12px !important; }
    .top-node-center { width: 100% !important; max-width: 100% !important; }
    .top-node-center > div:first-child { width: 100% !important; box-sizing: border-box !important; }
    .capex-number { font-size: 44px !important; }
    .subsector-grid { grid-template-columns: 1fr !important; }
    .main-content { padding: 12px 8px !important; max-width: 100vw !important; }
    .header-controls { gap: 8px !important; }
    .panel-wrapper { min-height: 400px; }
    .bottom-grid-all { gap: 10px !important; }
    .range-52w { flex: 1 1 40px !important; min-width: 0 !important; overflow: hidden !important; }
  }
`;

// ── ROOT APP ──────────────────────────────────────────────
export default function App() {
  
  const [isLightMode, setIsLightMode] = useState(() => {
    return localStorage.getItem("theme") === "light";
  });
  const [isMobileApp, setIsMobileApp] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobileApp(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  useEffect(() => {
    if (isLightMode) {
      document.documentElement.classList.add("light-mode");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.remove("light-mode");
      localStorage.setItem("theme", "dark");
    }
  }, [isLightMode]);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);

  const [scannerPool, setScannerPool] = useState(DEFAULT_MULTIBAGGER);
  const [shortList, setShortList] = useState([]);
  const [capexData, setCapexData] = useState(CAPEX_DATA);
  const [capexIntel, setCapexIntel] = useState(null);
  const [capexIntelStatus, setCapexIntelStatus] = useState("idle");
  const [capexIntelError, setCapexIntelError] = useState(null);
  
  const [activeTrack, setActiveTrack] = useState(null);
  const [prices, setPrices] = useState({});
  const pricesRef = useRef({});
  const capexDataRef   = useRef(capexData);
  const scannerPoolRef = useRef(scannerPool);
  const shortListRef   = useRef([]);
  const [marketData, setMarketData] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bottomTab, setBottomTab] = useState("all");
  const [popup, setPopup] = useState(null); 

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
  }, []);

  useEffect(() => { capexDataRef.current   = capexData;   }, [capexData]);
  useEffect(() => { scannerPoolRef.current = scannerPool; }, [scannerPool]);
  useEffect(() => { shortListRef.current   = shortList;   }, [shortList]);

  useEffect(() => {
    fetch("/scanner")
      .then(res => res.json())
      .then(data => { if (data.tickers) { setScannerPool(data.tickers); scannerPoolRef.current = data.tickers; } })
      .catch(e => console.log("Scanner fetch failed"));

    fetch("/capex")
      .then(res => res.json())
      .then(data => { if (data.capexData && (data.capexData.version ?? 0) >= CAPEX_DATA.version) { setCapexData(data.capexData); capexDataRef.current = data.capexData; } })
      .catch(e => console.log("Capex fetch failed"));

    setCapexIntelStatus("loading");
    const intelController = new AbortController();
    const intelTimeout = setTimeout(() => intelController.abort(), 20000);
    fetch("/capex-intel", { signal: intelController.signal })
      .then(res => res.json())
      .then(data => {
        clearTimeout(intelTimeout);
        if (data.error) {
          setCapexIntelStatus("error");
          setCapexIntelError(data.detail ? `${data.error} — ${data.detail}` : data.error);
        } else if (data.allocations?.length) {
          setCapexIntel(data);
          setCapexIntelStatus("success");
        } else {
          setCapexIntelStatus("error");
          setCapexIntelError("No allocations returned from API.");
        }
      })
      .catch(e => {
        clearTimeout(intelTimeout);
        setCapexIntelStatus("error");
        setCapexIntelError(e.name === "AbortError" ? "Request timed out — Gemini took too long" : (e.message || "Network error"));
      });

    fetch("/shortlist")
      .then(res => res.json())
      .then(data => { if (Array.isArray(data.tickers)) { setShortList(data.tickers); shortListRef.current = data.tickers; } })
      .catch(e => console.log("Shortlist fetch failed"));
  }, []);

  const openPopup = useCallback((ticker, rect) => {
    const change = pricesRef.current[ticker]?.change ?? pricesRef.current[ticker];
    setPopup(prev => (prev?.ticker === ticker ? null : { ticker, change, rect }));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const marketTickers = [...INDEX_TICKERS, ...CRYPTO_TICKERS, ...HYPERSCALER_TICKERS];
    const allTickers = [...new Set([...getAllTickers(capexDataRef.current), ...scannerPoolRef.current, ...shortListRef.current, ...marketTickers])];

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
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 30000); 
    return () => clearInterval(id);
  }, [refresh]);

  // Fast 5s refresh for the 6 market-strip tickers only (indices + crypto).
  // Runs independently of the full 30s cycle so the strip stays near-live
  // without hammering the /prices endpoint with the entire watchlist.
  useEffect(() => {
    const fastRefresh = async () => {
      if (document.hidden) return;
      try {
        const stripTickers = [...INDEX_TICKERS, ...CRYPTO_TICKERS];
        const data = await fetchAllPrices(stripTickers);
        setMarketData(prev => {
          const merged = { ...prev };
          stripTickers.forEach(ticker => {
            const val = data[ticker];
            if (val != null) {
              // Shallow-merge at the per-ticker level so chartData written by
              // the 30s refresh is preserved — fast path only updates price/change/session
              merged[ticker] = { ...prev[ticker], ...val };
            }
          });
          return merged;
        });
      } catch (err) {
        console.warn("[strip] fast-refresh error:", err);
      }
    };
    const id = setInterval(fastRefresh, 5000);
    return () => clearInterval(id);
  }, []);

  const handleUnlock = () => setShowAdminModal(true);

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

  const saveGlobalShortlist = async (newList) => {
    try {
      const res = await fetch("/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: newList, password: adminPassword })
      });
      if (res.ok) { setShortList(newList); shortListRef.current = newList; refresh(); }
      else {
        const json = await res.json();
        alert(json.error || "Shortlist update failed.");
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

  const liveCapexData = useMemo(() => {
    if (!capexIntel?.allocations?.length) return capexData;
    const intelMap = Object.fromEntries(capexIntel.allocations.map(a => [a.id, a]));
    return {
      ...capexData,
      tracks: capexData.tracks.map(track => {
        const intel = intelMap[track.id];
        if (!intel) return track;
        const liveValue = intel.value || (intel.capex ? `~$${intel.capex}B` : track.value);
        return {
          ...track,
          capex:           intel.capex ?? track.capex,
          value:           liveValue,
          rationale:       intel.rationale,
          intelConfidence: intel.confidence,
          isLiveIntel:     true,
        };
      }),
    };
  }, [capexData, capexIntel]);

  const watchlistTickers = useMemo(() => getAllTickers(capexData), [capexData]);
  const gainers = watchlistTickers.filter(t => (prices[t]?.change ?? prices[t]) > 0).length;
  const losers  = watchlistTickers.filter(t => (prices[t]?.change ?? prices[t]) < 0).length;
  const activeData = liveCapexData.tracks.find(t => t.id === activeTrack);
  const tickerEntries = Object.entries(prices);

  return (
    <MobileCtx.Provider value={isMobileApp}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", color: "#fff" }}>
        
        {/* FIXED TOP BAR: 6 Tickers + Market Clock */}
        <TopBar marketData={marketData} />

        {/* HEADER — offset below fixed bar (mobile bar is ~168px, desktop ~72px) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", marginTop: "var(--topbar-h, 72px)", borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(24,24,24,0.6)", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#2d3a52", letterSpacing: "0.35em", textTransform: "uppercase", marginBottom: 3 }}>HOW ~$600B+ IN HYPERSCALER CAPEX FLOWS THROUGH AI INFRASTRUCTURE TRACKS</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#e2e8f0", letterSpacing: "-0.01em" }}>AI Capex Flow Intelligence</div>
          </div>

          {/* Theme Toggle (clock moved to fixed bar) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button 
              onClick={() => setIsLightMode(!isLightMode)} 
              style={{ 
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", 
                color: "#e2e8f0", borderRadius: 6, padding: "3px 8px", cursor: "pointer", 
                fontSize: 10, fontWeight: 600, fontFamily: "inherit", display: "flex", 
                alignItems: "center", gap: 4, transition: "background .2s" 
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            >
              {isLightMode ? "🌙 Dark Mode" : "☀️ Light Mode"}
            </button>
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
            <a
              href="https://wizzleswatchlist.substack.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 11, fontWeight: 700, color: "#f59e0b",
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 8, padding: "5px 13px", textDecoration: "none",
                letterSpacing: "0.04em", transition: "all .18s",
                fontFamily: "'DM Mono','Fira Code',monospace",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,158,11,0.16)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.6)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,158,11,0.08)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.3)"; }}
            >
              <span style={{ fontSize: 13 }}>✉</span> Wizzle's Watchlist ↗
            </a>
          </div>
        </div>

        <div className="main-content" style={{ maxWidth: 1480, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 28, overflowX: "hidden", boxSizing: "border-box", width: "100%" }}>
          
          <div className="top-node-layout" style={{ display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
            <div className="top-node-center" style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <div style={{ 
                width: "100%", maxWidth: 540, 
                borderRadius: 4, 
                padding: "26px 30px", 
                textAlign: "center", 
                background: "linear-gradient(to bottom, #1c1917, #0a0a0a)", 
                border: "1px solid #27272a", 
                borderTop: "3px solid #fbbf24", 
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.6)" 
              }}>
                <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 6, fontFamily: "'Roboto Condensed', sans-serif" }}>Total Investment Flow</div>
                <div className="capex-number" style={{ fontSize: 68, fontWeight: 800, color: "#fbbf24", lineHeight: 1, marginBottom: 8, textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>~$600B+</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 20, letterSpacing: "0.08em", textTransform: "uppercase" }}>Hyperscaler AI Capex <span style={{ color: "#d97706" }}>(2026 Est.)</span></div>
                
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {CAPEX_DATA.companies.map(co => {
                    const entry = marketData[co];
                    const pos = (entry?.change ?? 0) >= 0;
                    const sessionLabel = entry?.session === "POST" || entry?.session === "CLOSED" ? "AH" : entry?.session === "PRE" ? "PM" : null;
                    return (
                      <div key={co} style={{ 
                        display: "flex", flexDirection: "column", alignItems: "center", 
                        padding: "8px 12px", borderRadius: 2, minWidth: 85, 
                        background: "linear-gradient(to bottom, #262626, #0a0a0a)", 
                        border: "1px solid #171717",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), 0 2px 4px rgba(0,0,0,0.5)",
                        fontFamily: "'Roboto Condensed', sans-serif"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc", letterSpacing: "0.02em" }}>{co}</span>
                          {sessionLabel && <span style={{ fontSize: 7, fontWeight: 800, color: "#94a3b8", background: "#171717", border: "1px solid #333", borderRadius: 2, padding: "1px 3px" }}>{sessionLabel}</span>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: sessionLabel ? "rgba(255,255,255,0.6)" : "#f8fafc", marginBottom: 2 }}>
                          {entry?.price ? "$" + entry.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                        </span>
                        {entry?.change !== undefined && entry?.change !== null ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: pos ? "#10b981" : "#ef4444" }}>
                            {pos ? "+" : ""}{entry.change.toFixed(2)}%
                          </span>
                        ) : <span style={{ fontSize: 11, color: "#475569" }}>—</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Data Flow Lines underneath the box */}
              <div style={{ width: 1, height: 28, background: "linear-gradient(to bottom,#fbbf24,transparent)" }} />
              <div style={{ position: "relative", width: "100%", height: 1, background: "linear-gradient(90deg,transparent 5%,rgba(255,255,255,.1) 20%,rgba(255,255,255,.1) 80%,transparent 95%)" }}>
                {capexData.tracks.map((_, i, arr) => <div key={i} style={{ position: "absolute", top: 0, left: `${(i / (arr.length - 1)) * 70 + 15}%`, width: 1, height: 18, background: "linear-gradient(to bottom,rgba(255,255,255,.15),transparent)" }} />)}
              </div>
            </div>
          </div>

          <div className="track-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, paddingTop: 8 }}>
            {liveCapexData.tracks.map(track => (
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
                <div className="span-2 panel-wrapper"><div className="panel-inner"><HeatMap prices={prices} capexData={liveCapexData} onTickerClick={openPopup} /></div></div>
                <div className="span-1 panel-wrapper"><div className="panel-inner"><Watchlist prices={prices} capexData={liveCapexData} onTickerClick={openPopup} isAdmin={isAdmin} shortList={shortList} onSaveShortlist={saveGlobalShortlist} /></div></div>
                <div className="span-1 panel-wrapper"><div className="panel-inner"><DonutChart prices={prices} capexData={liveCapexData} capexIntel={capexIntel} capexIntelStatus={capexIntelStatus} capexIntelError={capexIntelError} /></div></div>
                <div className="span-2 panel-wrapper"><div className="panel-inner"><MultibaggerPanel prices={prices} scannerPool={scannerPool} isAdmin={isAdmin} onSaveScanner={saveGlobalScanner} onTickerClick={openPopup} /></div></div>
              </div>
            ) : bottomTab === "heatmap" ? <HeatMap prices={prices} capexData={liveCapexData} onTickerClick={openPopup} />
              : bottomTab === "donut" ? <DonutChart prices={prices} capexData={liveCapexData} capexIntel={capexIntel} capexIntelStatus={capexIntelStatus} capexIntelError={capexIntelError} />
              : bottomTab === "watchlist" ? <Watchlist prices={prices} capexData={liveCapexData} onTickerClick={openPopup} isAdmin={isAdmin} shortList={shortList} onSaveShortlist={saveGlobalShortlist} />
              : <MultibaggerPanel prices={prices} scannerPool={scannerPool} isAdmin={isAdmin} onSaveScanner={saveGlobalScanner} onTickerClick={openPopup} />
            }
          </div>
        </div>
      </div>
      {/* TICKER TAPE */}
      <div style={{ position: "sticky", bottom: 0, zIndex: 50, height: 34, overflow: "hidden", borderTop: "1px solid rgba(255,255,255,.04)", background: "rgba(18,18,18,0.95)", padding: "6px 0" }}>
        {tickerEntries.length > 0 && (
          <div className="ticker-tape">
            {[...tickerEntries, ...tickerEntries].map(([sym, val], i) => {
              const chg = val?.change ?? val;
              const sessionLabel = val?.session === "POST" || val?.session === "CLOSED" ? "AH" : val?.session === "PRE" ? "PM" : null;
              return (
                <span key={`${sym}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#64748b", fontSize: 11 }}>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{sym}</span>
                  {sessionLabel && <span style={{ fontSize: 8, fontWeight: 700, color: "#475569", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2, padding: "0px 3px" }}>{sessionLabel}</span>}
                  {chg !== undefined && <span style={{ color: chg >= 0 ? "#34d399" : "#f87171" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span>}
                </span>
              )
            })}
          </div>
        )}
      </div>
      {popup && <CompanyPopup ticker={popup.ticker} change={popup.change} anchorRect={popup.rect} onClose={() => setPopup(null)} />}
      {showAdminModal && (
        <AdminModal
          onClose={() => setShowAdminModal(false)}
          onSuccess={(pwd) => { setAdminPassword(pwd); setIsAdmin(true); }}
        />
      )}
    </MobileCtx.Provider>
  );
}
