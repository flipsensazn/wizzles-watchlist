import { memo } from "react";

const StatusBanner = memo(function StatusBanner({ notice, onDismiss }) {
  if (!notice?.message) return null;

  const palette = notice.type === "error"
    ? { fg: "#fecaca", bg: "rgba(127,29,29,0.4)", border: "rgba(248,113,113,0.35)" }
    : { fg: "#bbf7d0", bg: "rgba(20,83,45,0.35)", border: "rgba(52,211,153,0.3)" };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      margin: "12px 16px 0",
      padding: "10px 14px",
      borderRadius: 10,
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.fg,
      fontSize: 12,
      lineHeight: 1.45,
    }}>
      <span>{notice.message}</span>
      <button
        onClick={onDismiss}
        style={{
          background: "transparent",
          border: "none",
          color: palette.fg,
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
        aria-label="Dismiss message"
      >
        ×
      </button>
    </div>
  );
});

export default StatusBanner;
