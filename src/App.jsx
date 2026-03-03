import { useState, useEffect, useCallback } from "react";

// ── MARKET DATA ───────────────────────────────────────────
const INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "XRP-USD"];
const HYPERSCALER_TICKERS = ["AMZN", "MSFT", "GOOG", "META", "ORCL"];

const [history, setHistory] = useState({});

async function fetchLivePrices(tickers) {
  try {
    const res = await fetch(`/.netlify/functions/prices?tickers=${tickers.join(",")}`);
    const json = await res.json();
    const prices = {};
    const histories = {};
    Object.entries(json.data ?? {}).forEach(([ticker, val]) => {
      prices[ticker] = val?.change ?? val;
      if (val?.history?.length) histories[ticker] = val.history;
    });
    return { prices, histories };
  } catch (err) {
    console.error("Price fetch failed:", err);
    return { prices: {}, histories: {} };
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
        { id: "asic", label: "Custom ASICs & TPUs", badge: null, tickers: ["AVGO","MRVL","QCOM"],
          materials: ["Advanced Packaging CoWoS","HBM","EUV Photomasks"] },
        { id: "foundry", label: "Leading-Edge Foundry", badge: "CAPACITY CONSTRAINED", badgeColor: "#f59e0b",
          tickers: ["TSM","TSEM","GFS"], materials: ["Silicon Carbide","Neon Gas","EUV Resist","Cobalt"] },
        { id: "equip", label: "Semiconductor Equipment", badge: null, tickers: ["AMAT","LRCX","KLAC","ASML"],
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
          tickers: ["LITE","COHR","POET"], materials: ["Indium Phosphide","Gallium Arsenide","Single-Mode Fiber"] },
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
          tickers: ["CIFR","IREN","CORZ","APLD","CRWV"],
          materials: ["Power Infrastructure","Cooling Systems","High-density Racks"] },
        { id: "servers", label: "AI Server Infrastructure", badge: null, tickers: ["SMCI","VRT","VRT"],
          materials: ["Copper Heat Pipes","PCB","Aluminum Extrusions"] },
      ],
    },
    {
      id: "power", label: "Power & Cooling", value: "~$45B", capex: 45,
      color: "#fb923c", borderColor: "#f97316",
      subsectors: [
        { id: "grid", label: "Power Generation & Utilities", badge: "GRID BOTTLENECK", badgeColor: "#ef4444",
          tickers: ["VST","NEE","BE","LEU","OKLO","SMR"], materials: ["Copper Grid","Silicon Steel Transformers","Lithium Storage"] },
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
      ],
    },
  ],
};

function getAllTickers(data = CAPEX_DATA) {
  return [...new Set(data.tracks.flatMap(t => t.subsectors.flatMap(s => s.tickers)))];
}

// ── BADGE ─────────────────────────────────────────────────
function Badge({ text, color }) {
  return (
    <span style={{
      background: color + "22", border: `1px solid ${color}`, color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.15em",
      padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

// ── MARKET STRIP ──────────────────────────────────────────
function MarketStrip({ data, tickers, labels, colors }) {
  function formatPrice(p, ticker) {
    if (p === null || p === undefined) return "—";
    if (ticker === "BTC-USD") return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (ticker === "ETH-USD") return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (ticker === "SOL-USD") return "$" + p.toFixed(2);
    if (ticker === "XRP-USD") return "$" + p.toFixed(3);
    // Indices — no $ sign, comma formatted
    return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      justifyContent: "center", padding: "0 20px",
    }}>
      {tickers.map((ticker, i) => {
        const entry = data[ticker];
        // entry is { change, price } object from Yahoo
        const price = entry?.price;
        const change = entry?.change;
        const pos = (change ?? 0) >= 0;

        return (
          <div key={ticker} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "8px 14px", borderRadius: 10, minWidth: 100,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${colors[i]}22`,
            transition: "border-color .2s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = colors[i] + "55"}
            onMouseLeave={e => e.currentTarget.style.borderColor = colors[i] + "22"}>

            {/* Label */}
            <span style={{
              fontSize: 10, fontWeight: 700, color: colors[i],
              letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3,
            }}>{labels[i]}</span>

            {/* Current Price — large */}
            <span style={{
              fontSize: 13, fontWeight: 700, color: "#f1f5f9",
              fontFamily: "'DM Mono', monospace", marginBottom: 2,
            }}>
              {formatPrice(price, ticker)}
            </span>

            {/* % change — small subtitle */}
            {change !== undefined && change !== null ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>
                {pos ? "+" : ""}{change.toFixed(2)}%
              </span>
            ) : (
              <span style={{ fontSize: 10, color: "#334155" }}>—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── SPARKLINE ─────────────────────────────────────────────
function Sparkline({ data, color, width = 120, height = 40 }) {
  if (!data || data.length < 2) return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 10, color: "#334155" }}>no history</span>
    </div>
  );

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Filled area path
  const first = points[0].split(",");
  const last = points[points.length - 1].split(",");
  const areaPath = `M${first[0]},${height - pad} L${polyline.replace(/(\d+\.?\d*),(\d+\.?\d*)/g, "$1,$2")} L${last[0]},${height - pad} Z`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Gradient fill */}
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <polyline
        points={`${first[0]},${height - pad} ${polyline} ${last[0]},${height - pad}`}
        fill={`url(#sg-${color.replace("#","")})`}
        stroke="none"
      />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last price dot */}
      <circle
        cx={last[0]} cy={last[1]}
        r="2.5"
        fill={color}
        stroke="#0f172a"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ── TICKER CHIP ───────────────────────────────────────────
function TickerChip({ symbol, change, onRemove, history }) {
  const [hovered, setHovered] = useState(false);
  const [pos2, setPos2] = useState({ x: 0, y: 0 });
  const pos = change >= 0;
  const sparkColor = change === undefined ? "#475569" : change >= 0 ? "#34d399" : "#f87171";

  return (
    <div
      onMouseEnter={e => {
        setHovered(true);
        setPos2({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={e => setPos2({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        background: "rgba(255,255,255,0.05)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 8, cursor: "default", transition: "border-color .15s", position: "relative",
      }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{symbol}</span>
      {change !== undefined
        ? <span style={{ fontSize: 11, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>
            {pos ? "+" : ""}{change}%
          </span>
        : <span style={{ fontSize: 11, color: "#475569" }}>…</span>}

      {/* Remove button */}
      {hovered && onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{
          position: "absolute", top: -6, right: -6, width: 16, height: 16,
          borderRadius: "50%", background: "#ef4444", border: "none",
          color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          lineHeight: 1, padding: 0, fontFamily: "inherit",
        }}>×</button>
      )}

      {/* Sparkline tooltip */}
      {hovered && (
        <div style={{
          position: "fixed",
          top: pos2.y - 110,
          left: pos2.x - 70,
          background: "#0f172a",
          border: `1px solid ${sparkColor}44`,
          borderRadius: 10,
          padding: "10px 12px",
          pointerEvents: "none",
          zIndex: 2000,
          boxShadow: `0 8px 32px rgba(0,0,0,.6), 0 0 20px ${sparkColor}11`,
          minWidth: 150,
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{symbol}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: sparkColor }}>
              {change !== undefined ? (change >= 0 ? "+" : "") + change + "%" : "—"}
            </span>
          </div>
          {/* Sparkline */}
          <Sparkline data={history} color={sparkColor} width={126} height={44} />
          {/* Labels */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 9, color: "#334155" }}>5D ago</span>
            <span style={{ fontSize: 9, color: "#334155" }}>today</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SUBSECTOR CARD ────────────────────────────────────────
function SubsectorCard({ sub, prices, histories, onAddTicker, onRemoveTicker }) {
  const [open, setOpen] = useState(false);
  const [addingTicker, setAddingTicker] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const isBottleneck = sub.badge === "EXTREME BOTTLENECK" || sub.badge === "GRID BOTTLENECK";
  const isHot = sub.badge === "HIGH DEMAND" || sub.badge === "RAPID GROWTH";

  function handleAdd() {
    if (newTicker.trim()) {
      onAddTicker(newTicker.trim());
      setNewTicker("");
      setAddingTicker(false);
    }
  }

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${isBottleneck ? "rgba(239,68,68,.4)" : isHot ? "rgba(245,158,11,.3)" : "rgba(255,255,255,0.08)"}`,
      background: isBottleneck ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.02)",
      padding: 14, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", lineHeight: 1.4 }}>{sub.label}</span>
        {sub.badge && <Badge text={sub.badge} color={sub.badgeColor} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
{sub.tickers.map(t => (
  <TickerChip key={t} symbol={t} change={prices[t]}
    history={histories?.[t]}
    onRemove={() => onRemoveTicker(t)} />
))}
      </div>
      {sub.materials?.length > 0 && (
        <div>
          <button onClick={() => setOpen(v => !v)} style={{
            background: "none", border: "none", color: "#64748b", fontSize: 11,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
            padding: 0, fontFamily: "inherit",
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
              style={{
                flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 12,
                fontFamily: "inherit", outline: "none",
              }} />
            <button onClick={handleAdd} style={{
              background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)",
              color: "#60a5fa", borderRadius: 6, padding: "5px 10px", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit",
            }}>✓</button>
            <button onClick={() => { setAddingTicker(false); setNewTicker(""); }} style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              color: "#64748b", borderRadius: 6, padding: "5px 10px", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit",
            }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TRACK CARD ────────────────────────────────────────────
function TrackCard({ track, isActive, onClick }) {
  return (
    <div onClick={onClick} style={{
      position: "relative", borderRadius: 12, padding: "14px 12px", minHeight: 120,
      cursor: "pointer", userSelect: "none",
      background: isActive ? `linear-gradient(135deg,${track.borderColor}20 0%,rgba(10,14,26,.95) 100%)` : "rgba(255,255,255,0.03)",
      border: `1px solid ${isActive ? track.borderColor : "rgba(255,255,255,0.1)"}`,
      boxShadow: isActive ? `0 0 20px ${track.borderColor}44` : "none",
      display: "flex", flexDirection: "column", gap: 8, transition: "transform .2s",
    }}>
      {isActive && (
        <div style={{
          position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)",
          background: track.borderColor, color: "#000", fontSize: 9, fontWeight: 800,
          padding: "2px 8px", borderRadius: 20, letterSpacing: "0.2em", whiteSpace: "nowrap",
        }}>YOUR FOCUS</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? track.color : "#e2e8f0", lineHeight: 1.3 }}>{track.label}</div>
      <div style={{ fontSize: 11, color: isActive ? track.color : "#94a3b8" }}>{track.value}</div>
      <div style={{ fontSize: 10, color: "#475569" }}>{track.subsectors.flatMap(s => s.tickers).length} tickers</div>
      <div style={{ fontSize: 10, color: isActive ? track.color : "#334155", textAlign: "center" }}>{isActive ? "▲ collapse" : "▼ expand"}</div>
    </div>
  );
}

// ── TRACK PANE ────────────────────────────────────────────
function TrackPane({ track, prices, histories, onAddTicker, onRemoveTicker }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {track.subsectors.map(sub => (
        <SubsectorCard
          key={sub.id}
          sub={sub}
          prices={prices}
          histories={histories}
          onAddTicker={(ticker) => onAddTicker(track.id, sub.id, ticker)}
          onRemoveTicker={(ticker) => onRemoveTicker(track.id, sub.id, ticker)}
        />
      ))}
    </div>
  );
}

// ── HEAT MAP ──────────────────────────────────────────────
function HeatMap({ prices, capexData, histories }) {
  const [tooltip, setTooltip] = useState(null);

  function getHeatColor(change) {
    if (change === undefined) return "#1e293b";
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
    <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", padding: 20 }}>
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
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: track.color, flexShrink: 0 }} />
              {track.label}
              <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${track.color}33,transparent)` }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cells.map(ticker => {
                const change = prices[ticker];
                const bg = getHeatColor(change);
                const pos = change === undefined || change >= 0;
                return (
                  <div key={ticker}
                    onMouseEnter={e => setTooltip({ 
  ticker, change, track: track.label, 
  history: histories?.[ticker],
  rect: e.currentTarget.getBoundingClientRect() 
})}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ background: bg, borderRadius: 8, padding: "8px 12px", border: `1px solid ${bg}`, minWidth: 60, textAlign: "center", cursor: "pointer", transition: "filter .15s, transform .15s" }}
                    onMouseOver={e => { e.currentTarget.style.filter = "brightness(1.3)"; e.currentTarget.style.transform = "scale(1.06)"; }}
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
    {tooltip && (
      <div style={{
        position: "fixed", top: tooltip.rect.top - 130, left: tooltip.rect.left,
        background: "#0f172a", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 10, padding: "10px 12px", pointerEvents: "none", zIndex: 1000,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)", minWidth: 150,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{tooltip.ticker}</div>
          {tooltip.change !== undefined && (
            <div style={{ fontSize: 12, fontWeight: 600, color: tooltip.change >= 0 ? "#34d399" : "#f87171" }}>
              {tooltip.change >= 0 ? "+" : ""}{tooltip.change}% today
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{tooltip.track}</div>
        <Sparkline
          data={tooltip.history}
          color={tooltip.change >= 0 ? "#34d399" : "#f87171"}
          width={126} height={44}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "#334155" }}>5D ago</span>
          <span style={{ fontSize: 9, color: "#334155" }}>today</span>
        </div>
      </div>
    )}
    </div> 
  );        
}        

// ── DONUT CHART ─────────────────────────────
function DonutChart({ prices, capexData }) {

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
    <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", padding: 20 }}>
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
                style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${isHov ? 1.05 : 1})`, transition: "transform .2s", cursor: "pointer" }}>
                <path d={seg.path} fill={isHov ? seg.track.color : seg.track.borderColor}
                  opacity={isHov ? 1 : hovered ? 0.4 : 0.85} stroke="#080c18" strokeWidth="2" />
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={r - 2} fill="#080c18" />
          {hov ? (
            <>
              <text x={cx} y={cy - 14} textAnchor="middle" fill={hov.track.color} fontSize="11" fontWeight="600">{hov.track.label.split(" ")[0]}</text>
              <text x={cx} y={cy + 6} textAnchor="middle" fill="#f1f5f9" fontSize="20" fontWeight="800">{hov.track.value}</text>
              <text x={cx} y={cy + 24} textAnchor="middle" fill={hov.avg >= 0 ? "#34d399" : "#f87171"} fontSize="12">
                avg {hov.avg >= 0 ? "+" : ""}{hov.avg.toFixed(1)}%
              </text>
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
              style={{ cursor: "default", opacity: hovered && hovered !== track.id ? 0.4 : 1, transition: "opacity .2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color }} />
                  <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>{track.label}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>${track.capex}B</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: track.avg >= 0 ? "#34d399" : "#f87171", minWidth: 46, textAlign: "right" }}>
                    {track.avg >= 0 ? "+" : ""}{track.avg.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${(track.capex / total) * 100}%`, background: `linear-gradient(90deg,${track.borderColor},${track.color})`, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
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
  const filtered = filter === "all" ? enriched : filter === "gainers" ? enriched.filter(x => (x.change ?? 0) >= 0) : enriched.filter(x => (x.change ?? 0) < 0);
  const sorted = [...filtered].sort((a, b) => sortDir === "desc" ? ((b.change ?? -999) - (a.change ?? -999)) : ((a.change ?? 999) - (b.change ?? 999)));
  const avg = enriched.filter(x => x.change !== undefined).reduce((s, x) => s + x.change, 0) / (enriched.filter(x => x.change !== undefined).length || 1);
  const maxAbs = Math.max(...enriched.map(x => Math.abs(x.change ?? 0)), 1);

  function add() {
    const sym = input.trim().toUpperCase();
    if (sym && !list.includes(sym)) setList(l => [...l, sym]);
    setInput("");
  }

  return (
    <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
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
        <button onClick={add} style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+ Add</button>
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
  const [marketData, setMarketData] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bottomTab, setBottomTab] = useState("all");

  useEffect(() => {
    try { localStorage.setItem("capexData", JSON.stringify(capexData)); }
    catch {}
  }, [capexData]);

const refresh = useCallback(async () => {
  setRefreshing(true);
  const [priceResult, newMarket] = await Promise.all([
    fetchLivePrices(getAllTickers(capexData)),
    fetchMarketData(),
  ]);
  setPrices(prev => ({ ...prev, ...priceResult.prices }));
  setHistory(prev => ({ ...prev, ...priceResult.histories }));
  setMarketData(prev => {
    const merged = { ...prev };
    Object.entries(newMarket).forEach(([ticker, val]) => {
      if (val !== null && val !== undefined) {
        if (typeof val === "object") {
          if (val.price !== null && val.price !== undefined) merged[ticker] = val;
        } else {
          merged[ticker] = val;
        }
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
    fetchLivePrices([sym]).then(newPrice => {
      setPrices(prev => ({ ...prev, ...newPrice }));
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
  const tickerPairs = [...Object.entries(prices), ...Object.entries(prices)];

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080c18; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 3px; }
    @keyframes scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.8); } }
    .ticker-tape { animation: scroll-left 80s linear infinite; white-space: nowrap; display: inline-flex; gap: 24px; }
    .pulse { animation: pulseDot 2s infinite; }
    .grid-bg {
      background-image: linear-gradient(rgba(255,255,255,.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px);
      background-size: 40px 40px;
    }
  `;

  return (
    <>
      <style>{styles}</style>
      <div className="grid-bg" style={{
        minHeight: "100vh", color: "#fff",
        background: "radial-gradient(ellipse at 15% 10%,rgba(59,130,246,.08) 0%,transparent 55%), radial-gradient(ellipse at 85% 85%,rgba(168,85,247,.07) 0%,transparent 55%), #080c18",
        fontFamily: "'DM Mono','Fira Code',monospace",
      }}>

        {/* TICKER TAPE */}
        {Object.keys(prices).length > 0 && (
          <div style={{ overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,.05)", background: "rgba(0,0,0,.6)", padding: "6px 0" }}>
            <div className="ticker-tape">
              {tickerPairs.map(([sym, chg], i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: 11 }}>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{sym}</span>
                  <span style={{ color: chg >= 0 ? "#34d399" : "#f87171" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,.04)", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 2 }}>
              HOW ~$600B+ IN HYPERSCALER CAPEX FLOWS THROUGH AI INFRASTRUCTURE TRACKS
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>
              AI Capex Flow Intelligence
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pulse" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
              {gainers} advancing
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", display: "inline-block" }} />
              {losers} declining
            </span>
            <span style={{ fontSize: 11, color: "#334155" }}>{getAllTickers(capexData).length} tickers</span>
            <button
              onClick={() => {
                if (window.confirm("Reset all tickers to defaults?")) {
                  setCapexData(CAPEX_DATA);
                  localStorage.removeItem("capexData");
                }
              }}
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
              ↺ reset
            </button>
            <button onClick={refresh} disabled={refreshing} style={{
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 8, color: "#64748b", padding: "5px 12px", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit", opacity: refreshing ? 0.5 : 1,
            }}>
              {refreshing ? "↻ syncing…" : `↻ refresh${lastUpdated ? " · " + lastUpdated : ""}`}
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* TOP NODE WITH FLANKING MARKET DATA */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>

            {/* LEFT — Indices */}
            <MarketStrip
              data={marketData}
              tickers={["^GSPC", "^DJI", "^IXIC"]}
              labels={["S&P 500", "DOW", "NASDAQ"]}
              colors={["#60a5fa", "#34d399", "#c084fc"]}
            />

            {/* CENTER — Top node */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <div style={{
                width: 480, borderRadius: 20, padding: "24px 28px", textAlign: "center",
                background: "linear-gradient(135deg,rgba(251,191,36,.12) 0%,rgba(251,191,36,.03) 100%)",
                border: "1.5px solid rgba(251,191,36,.5)",
                boxShadow: "0 0 60px rgba(251,191,36,.12),0 0 120px rgba(251,191,36,.06)",
              }}>
                <div style={{ fontSize: 10, color: "rgba(251,191,36,.6)", letterSpacing: "0.35em", textTransform: "uppercase", marginBottom: 4 }}>Total Investment Flow</div>
                <div style={{
                  fontSize: 64, color: "#fbbf24", lineHeight: 1, marginBottom: 4,
                  fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em",
                }}>~$600B+</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
                  Hyperscaler AI Capex <span style={{ color: "rgba(251,191,36,.7)" }}>(2026 Est.)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
  {CAPEX_DATA.companies.map(co => {
    const entry = marketData[co];
    const price = entry?.price;
    const change = entry?.change;
    const pos = (change ?? 0) >= 0;

    function formatPrice(p) {
      if (!p) return "—";
      return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }

    return (
      <div key={co} style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "6px 12px", borderRadius: 8, minWidth: 72,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
        transition: "border-color .2s",
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(251,191,36,0.4)"}
        onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"}>
        {/* Ticker */}
        <span style={{
          fontSize: 10, fontWeight: 800, color: "#fbbf24",
          letterSpacing: "0.1em", marginBottom: 2,
        }}>{co}</span>
        {/* Price */}
        <span style={{
          fontSize: 12, fontWeight: 700, color: "#f1f5f9",
          fontFamily: "'DM Mono', monospace", marginBottom: 1,
        }}>
          {formatPrice(price)}
        </span>
        {/* % change */}
        {change !== undefined && change !== null ? (
          <span style={{ fontSize: 10, fontWeight: 600, color: pos ? "#34d399" : "#f87171" }}>
            {pos ? "+" : ""}{change.toFixed(2)}%
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "#334155" }}>—</span>
        )}
      </div>
    );
  })}
</div>
              </div>
              <div style={{ width: 1, height: 28, background: "linear-gradient(to bottom,rgba(251,191,36,.4),transparent)" }} />
              <div style={{ position: "relative", width: "100%", height: 2, background: "linear-gradient(90deg,transparent 5%,rgba(255,255,255,.08) 20%,rgba(255,255,255,.08) 80%,transparent 95%)" }}>
                {capexData.tracks.map((_, i, arr) => (
                  <div key={i} style={{ position: "absolute", top: 0, left: `${(i / (arr.length - 1)) * 70 + 15}%`, width: 1, height: 20, background: "linear-gradient(to bottom,rgba(255,255,255,.15),transparent)" }} />
                ))}
              </div>
            </div>

            {/* RIGHT — Crypto */}
            <MarketStrip
  data={marketData}
  tickers={["BTC-USD", "ETH-USD", "XRP-USD"]}
  labels={["BTC", "ETH", "XRP"]}
  colors={["#f59e0b", "#60a5fa", "#34d399"]}
/>
          </div>

          {/* TRACK CARDS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, paddingTop: 8 }}>
            {capexData.tracks.map(track => (
              <div key={track.id} style={{ paddingTop: activeTrack === track.id ? 14 : 0 }}>
                <TrackCard track={track} isActive={activeTrack === track.id}
                  onClick={() => setActiveTrack(p => p === track.id ? null : track.id)} />
              </div>
            ))}
          </div>

          {/* EXPANDED PANE */}
{activeData && (
  <TrackPane
    track={activeData}
    prices={prices}
    histories={history}
    onAddTicker={addTickerToSubsector}
    onRemoveTicker={removeTickerFromSubsector}
  />
)}

          {/* BOTTOM PANELS */}
          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,.05)", paddingBottom: 4, flexWrap: "wrap" }}>
              {[
                { id: "all", label: "⬛ All Panels" },
                { id: "heatmap", label: "📊 Heat Map" },
                { id: "donut", label: "🥧 Sector Allocation" },
                { id: "watchlist", label: "👁 Watchlist" },
              ].map(tab => (
                <button key={tab.id} onClick={() => setBottomTab(tab.id)} style={{
                  background: bottomTab === tab.id ? "rgba(255,255,255,.07)" : "transparent",
                  border: `1px solid ${bottomTab === tab.id ? "rgba(255,255,255,.12)" : "transparent"}`,
                  color: bottomTab === tab.id ? "#e2e8f0" : "#475569",
                  borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all .2s",
                }}>{tab.label}</button>
              ))}
            </div>
            {bottomTab === "all" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "1/-1" }}><HeatMap prices={prices} capexData={capexData} histories={history} /></div>
                <DonutChart prices={prices} capexData={capexData} />
                <Watchlist prices={prices} capexData={capexData} />
              </div>
            ) : bottomTab === "heatmap" ? <HeatMap prices={prices} capexData={capexData} />
              : bottomTab === "donut" ? <DonutChart prices={prices} capexData={capexData} />
              : <Watchlist prices={prices} capexData={capexData} />}
          </div>

          {/* FOOTER */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, color: "#1e293b", borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, flexWrap: "wrap" }}>
            <span style={{ color: "#334155", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Legend:</span>
            {[{ c: "#ef4444", l: "Extreme Bottleneck" }, { c: "#f59e0b", l: "Constrained" }, { c: "#34d399", l: "Rapid Growth" }, { c: "#60a5fa", l: "Emerging" }, { c: "#f472b6", l: "Speculative" }].map(x => (
              <span key={x.l} style={{ display: "flex", alignItems: "center", gap: 5, color: "#334155" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: x.c, display: "inline-block", opacity: 0.7 }} />{x.l}
              </span>
            ))}
            <span style={{ marginLeft: "auto", color: "#1e293b" }}>Live via Finnhub + Yahoo · server-cached · auto-refreshes 30s</span>
          </div>
        </div>
      </div>
    </>
  );
}
