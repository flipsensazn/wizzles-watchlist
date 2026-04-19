import { memo } from "react";

const TrackCard = memo(function TrackCard({ track, isActive, onClick, isAdmin, onRenameSector, EditableLabel }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: 14,
        padding: "14px 12px",
        minHeight: 120,
        cursor: "pointer",
        userSelect: "none",
        background: isActive ? `linear-gradient(135deg,${track.borderColor}28 0%,rgba(18,18,18,.95) 100%)` : "rgba(255,255,255,0.03)",
        border: `1px solid ${isActive ? track.borderColor : "rgba(255,255,255,0.09)"}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "all .2s",
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.borderColor = `${track.color}44`;
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
        }
      }}
    >
      {isActive && (
        <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: `linear-gradient(90deg, ${track.borderColor}, ${track.color})`, color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.2em", whiteSpace: "nowrap" }}>
          YOUR FOCUS
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? track.color : "#e2e8f0", lineHeight: 1.3 }}>
        <EditableLabel text={track.label} isAdmin={isAdmin} onSave={onRenameSector} />
      </div>
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

export default TrackCard;
