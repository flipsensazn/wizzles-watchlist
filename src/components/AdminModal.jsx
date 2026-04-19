import { useEffect, useRef, useState } from "react";

export default function AdminModal({ onClose, onSubmit }) {
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
    const result = await onSubmit(pwd);
    if (result?.ok) {
      onClose();
      return;
    }
    setError(result?.error || "Verification failed.");
    setLoading(false);
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
