// roboticsData.js
//
// The Robotics view: investment flow + supply-chain dependency for the
// humanoid-robot buildout, structured on Goldman Sachs' framework (the money
// is in the ~40 repeating parts inside every body, not the robot maker).
//
// Tracks mirror Goldman's component categories; the bottleneck is precision
// motion (harmonic/strain-wave gears, planetary roller screws) and rare-earth
// magnets — the scarce parts almost nobody can build. Robot makers are mostly
// private or foreign (only TSLA, CCXI→AGLT, XPEV, BYDDY are accessible), so
// they appear as demand hubs on the Sankey; the investable edge is the
// component suppliers on the right.
//
// Ticker notes: 6324.T = Harmonic Drive Systems, 6481.T = THK (both Yahoo-
// covered). CCXI = Churchill Capital XI, the SPAC merging with Agility
// Robotics — becomes AGLT on close (the only US-listed pure-play maker).
// All US/ADR tickers validated against live quotes before inclusion.

export const ROBOTICS_CAPEX_DATA = {
  version: 1,
  companies: ["TSLA", "FIGURE", "AGILITY", "UNITREE", "ONEX", "XPEV", "BYD"],
  tracks: [
    {
      id: "brain", label: "Brain & Edge AI", value: "~$8B", capex: 8,
      color: "#60a5fa", borderColor: "#3b82f6",
      subsectors: [
        { id: "compute", label: "Foundation Models & Compute", tickers: ["NVDA", "QCOM"], materials: ["GR00T / Jetson", "RB6 Edge SoC", "Training Clusters"] },
        { id: "edge", label: "Edge AI Inference", tickers: ["AMBA", "LSCC", "CEVA"], materials: ["Edge Vision Processors", "Low-power FPGAs", "DSP / Inference IP"] },
      ],
    },
    {
      id: "sensors", label: "Sensors & Perception", value: "~$7B", capex: 7,
      color: "#34d399", borderColor: "#10b981",
      subsectors: [
        { id: "vision", label: "Vision (Camera / LiDAR)", tickers: ["OUST", "CGNX", "HSAI"], materials: ["Solid-state LiDAR", "Machine Vision", "Depth Cameras"] },
        { id: "force", label: "Force, Torque & Position Sensing", tickers: ["ALGM", "VPG", "NOVT"], materials: [ { name: "Magnetic Position Sensors", constraint: "Every joint needs them — quiet winner", color: "#34d399" }, "Strain Gauges", "6-Axis Force/Torque" ] },
      ],
    },
    {
      id: "motors", label: "Motors & Motion", value: "~$8B", capex: 8,
      color: "#fbbf24", borderColor: "#f59e0b",
      subsectors: [
        { id: "motors", label: "Motors & Drives", tickers: ["NJDCY", "AME", "RRX"], materials: ["Coreless Motors", "Frameless Torque Motors", "Servo Drives"] },
        { id: "bearings", label: "Precision Bearings & Components", tickers: ["RBC"], materials: ["Precision Bearings", "Slewing Rings", "Linear Guides"] },
      ],
    },
    {
      id: "joints", label: "Joints & Precision Motion", value: "~$9B", capex: 9,
      color: "#c084fc", borderColor: "#a855f7",
      subsectors: [
        { id: "harmonic", label: "Harmonic / Strain-Wave Gears", tickers: ["6324.T"], materials: [ { name: "Strain-Wave Gears", constraint: "EXTREME BOTTLENECK — every Optimus joint uses one; Harmonic Drive near-monopoly", color: "#ef4444" }, { name: "Flexspline Steel", constraint: "Specialized fatigue-grade alloy", color: "#f59e0b" } ] },
        { id: "screws", label: "Planetary Roller Screws & Linear", tickers: ["6481.T", "ALNT"], materials: [ { name: "Planetary Roller Screws", constraint: "Capacity-constrained; few qualified makers", color: "#ef4444" }, "Linear Bearings", "Ball Screws" ] },
      ],
    },
    {
      id: "power", label: "Power Electronics", value: "~$4B", capex: 4,
      color: "#fb923c", borderColor: "#f97316",
      subsectors: [
        { id: "gan_sic", label: "GaN / SiC Power", tickers: ["NVTS", "WOLF", "ON"], materials: ["GaN Power ICs", "SiC MOSFETs", "Power Management"] },
        { id: "mcu", label: "Motor-Control & Conversion", tickers: ["TXN", "STM", "MPWR", "IFNNY", "RNECY"], materials: ["Motor-Control MCUs", "Gate Drivers", "DC-DC Converters"] },
      ],
    },
    {
      id: "materials", label: "Rare Earth & Energy", value: "~$4B", capex: 4,
      color: "#f472b6", borderColor: "#ec4899",
      subsectors: [
        { id: "magnets", label: "Rare-Earth Magnets & Mining", tickers: ["MP", "USAR", "LYSCF", "UUUU"], materials: [ { name: "NdFeB Magnets", constraint: "CRITICAL — the scarce part; China dominates processing", color: "#ef4444" }, { name: "Neodymium / Praseodymium", constraint: "China export controls active", color: "#ef4444" }, "Dysprosium" ] },
        { id: "batteries", label: "Batteries & Power Storage", tickers: ["ENS"], materials: ["Industrial Battery Packs", "BMS", "Fast-Charge Cells"] },
      ],
    },
  ],
};

// Sankey left side — the robot makers (demand). share = fallback split until
// the grounded robotics-intel byCompany arrives. Most makers are private or
// foreign; only TSLA / AGILITY(CCXI) / XPEV / BYD are accessible.
export const ROBOTICS_COMPANIES = [
  { id: "TSLA",    label: "Tesla (Optimus)", share: 0.30, isPublic: true },
  { id: "FIGURE",  label: "Figure AI",       share: 0.16, isPublic: false },
  { id: "AGILITY", label: "Agility (CCXI)",  share: 0.12, isPublic: true },
  { id: "UNITREE", label: "Unitree",         share: 0.12, isPublic: false },
  { id: "ONEX",    label: "1X",              share: 0.10, isPublic: false },
  { id: "XPEV",    label: "XPeng (Iron)",    share: 0.10, isPublic: true },
  { id: "BYD",     label: "BYD",             share: 0.10, isPublic: true },
];

// ── DEPENDENCY GRAPH ─────────────────────────────────────

export const ROBOTICS_LAYERS = [
  "Raw / External",
  "Materials & Power",
  "Precision Motion & Motors",
  "Sensors & Brain",
  "Robot Makers",
];

export const ROBOTICS_GRAPH_NODES = [
  // L0 — external chokepoints (no US listing / price)
  { id: "CN_MAGNETS",  label: "RE Magnets (CN)",   layer: 0, type: "external", baseStress: 78, note: "China dominates NdFeB magnet processing; export controls active" },
  { id: "CN_DEXHAND",  label: "Dexterous Hands (CN)", layer: 0, type: "external", baseStress: 60, note: "China leads dexterous hand modules (Zhaowei, Inovance, PaXini)" },
  { id: "SCHAEFFLER",  label: "Schaeffler (DE)",   layer: 0, type: "external", baseStress: 45, note: "Roller screws — German, not US-listed" },

  // L1 — materials & power
  { id: "MP",    label: "MP Materials · REE",   layer: 1 },
  { id: "USAR",  label: "USA Rare Earth · magnets", layer: 1 },
  { id: "LYSCF", label: "Lynas · REE (ex-China)", layer: 1 },
  { id: "UUUU",  label: "Energy Fuels · REE",   layer: 1 },
  { id: "NVTS",  label: "Navitas · GaN",        layer: 1 },
  { id: "WOLF",  label: "Wolfspeed · SiC",      layer: 1 },
  { id: "ON",    label: "onsemi · power",       layer: 1 },
  { id: "STM",   label: "ST · motor-control",   layer: 1 },

  // L2 — precision motion & motors (the bottleneck layer)
  { id: "6324.T", label: "Harmonic Drive · gears", layer: 2 },
  { id: "6481.T", label: "THK · roller screws",  layer: 2 },
  { id: "ALNT",  label: "Allient · motion",     layer: 2 },
  { id: "NJDCY", label: "Nidec · motors",        layer: 2 },
  { id: "AME",   label: "AMETEK · motion",       layer: 2 },
  { id: "RRX",   label: "Regal Rexnord · motors", layer: 2 },
  { id: "RBC",   label: "RBC Bearings",          layer: 2 },

  // L3 — sensors & brain
  { id: "NVDA",  label: "NVIDIA · GR00T/Jetson", layer: 3 },
  { id: "QCOM",  label: "Qualcomm · edge",       layer: 3 },
  { id: "AMBA",  label: "Ambarella · vision",    layer: 3 },
  { id: "ALGM",  label: "Allegro · position",    layer: 3 },
  { id: "NOVT",  label: "Novanta · force/torque", layer: 3 },
  { id: "OUST",  label: "Ouster · LiDAR",        layer: 3 },
  { id: "CGNX",  label: "Cognex · vision",       layer: 3 },
  { id: "HSAI",  label: "Hesai · LiDAR",         layer: 3 },

  // L4 — robot makers (only TSLA/CCXI/XPEV/BYDDY tradeable)
  { id: "TSLA",    label: "Tesla · Optimus",    layer: 4 },
  { id: "FIGURE",  label: "Figure AI",          layer: 4, type: "external", note: "Private — ~$39B valuation" },
  { id: "AGILITY", label: "Agility (CCXI)",     layer: 4, type: "external", note: "Via Churchill Capital XI SPAC → AGLT on close" },
  { id: "UNITREE", label: "Unitree",            layer: 4, type: "external", note: "Private — China" },
  { id: "ONEX",    label: "1X",                 layer: 4, type: "external", note: "Private — Norway/US" },
  { id: "XPEV",    label: "XPeng · Iron",       layer: 4 },
  { id: "BYD",     label: "BYD",                layer: 4 },
];

export const ROBOTICS_GRAPH_EDGES = [
  // magnets/REE → motors (the scarce input)
  { from: "CN_MAGNETS", to: "NJDCY", what: "NdFeB magnets", criticality: 3 },
  { from: "CN_MAGNETS", to: "RRX",   what: "NdFeB magnets", criticality: 3 },
  { from: "CN_MAGNETS", to: "6324.T", what: "magnets for actuators", criticality: 2 },
  { from: "MP",   to: "USAR",  what: "REE feedstock", criticality: 2 },
  { from: "MP",   to: "NJDCY", what: "magnets (ex-China)", criticality: 1 },
  { from: "USAR", to: "TSLA",  what: "domestic magnets", criticality: 2 },
  { from: "LYSCF", to: "NJDCY", what: "REE (ex-China)", criticality: 1 },

  // power semis → motors/makers
  { from: "NVTS", to: "TSLA", what: "GaN power", criticality: 2 },
  { from: "WOLF", to: "TSLA", what: "SiC", criticality: 1 },
  { from: "ON",   to: "TSLA", what: "power mgmt", criticality: 1 },
  { from: "STM",  to: "ALNT", what: "motor-control", criticality: 1 },

  // precision motion → makers (THE bottleneck path)
  { from: "6324.T", to: "TSLA",    what: "harmonic gears", criticality: 3 },
  { from: "6324.T", to: "FIGURE",  what: "harmonic gears", criticality: 3 },
  { from: "6324.T", to: "AGILITY", what: "harmonic gears", criticality: 3 },
  { from: "6324.T", to: "UNITREE", what: "harmonic gears", criticality: 2 },
  { from: "6481.T", to: "TSLA",    what: "roller screws", criticality: 3 },
  { from: "6481.T", to: "FIGURE",  what: "roller screws", criticality: 3 },
  { from: "6481.T", to: "ONEX",    what: "linear actuators", criticality: 2 },
  { from: "SCHAEFFLER", to: "TSLA", what: "roller screws (2nd src)", criticality: 2 },
  { from: "ALNT", to: "AGILITY", what: "integrated motion", criticality: 2 },
  { from: "ALNT", to: "ONEX",    what: "integrated motion", criticality: 1 },

  // motors → makers
  { from: "NJDCY", to: "TSLA",    what: "motors", criticality: 2 },
  { from: "NJDCY", to: "XPEV",    what: "motors", criticality: 2 },
  { from: "AME",   to: "FIGURE",  what: "precision motion", criticality: 1 },
  { from: "RRX",   to: "TSLA",    what: "motors/drives", criticality: 1 },
  { from: "RBC",   to: "TSLA",    what: "precision bearings", criticality: 2 },
  { from: "RBC",   to: "FIGURE",  what: "precision bearings", criticality: 1 },

  // dexterous hands chokepoint → makers
  { from: "CN_DEXHAND", to: "TSLA",    what: "hand modules / tactile", criticality: 2 },
  { from: "CN_DEXHAND", to: "UNITREE", what: "hand modules", criticality: 2 },
  { from: "CN_DEXHAND", to: "XPEV",    what: "hand modules", criticality: 2 },

  // sensors & brain → makers
  { from: "NVDA", to: "TSLA",    what: "GR00T/Jetson compute", criticality: 2 },
  { from: "NVDA", to: "FIGURE",  what: "GR00T compute", criticality: 3 },
  { from: "NVDA", to: "AGILITY", what: "compute", criticality: 2 },
  { from: "QCOM", to: "UNITREE", what: "edge SoC", criticality: 1 },
  { from: "AMBA", to: "FIGURE",  what: "edge vision", criticality: 1 },
  { from: "ALGM", to: "TSLA",    what: "joint position sensors", criticality: 3 },
  { from: "ALGM", to: "FIGURE",  what: "joint position sensors", criticality: 3 },
  { from: "ALGM", to: "AGILITY", what: "position sensors", criticality: 2 },
  { from: "NOVT", to: "FIGURE",  what: "6-axis force/torque", criticality: 2 },
  { from: "OUST", to: "AGILITY", what: "LiDAR", criticality: 1 },
  { from: "CGNX", to: "TSLA",    what: "machine vision", criticality: 1 },
  { from: "HSAI", to: "XPEV",    what: "LiDAR", criticality: 2 },
];

export function getRoboticsTickers(data = ROBOTICS_CAPEX_DATA) {
  return [...new Set(data.tracks.flatMap(t => t.subsectors.flatMap(s => s.tickers)))];
}
