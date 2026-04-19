import { memo, useEffect, useState } from "react";

const BloombergFeed = memo(function BloombergFeed() {
  const [news, setNews] = useState([]);
  const [feedMode, setFeedMode] = useState("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNews = () => {
      fetch("/market-news")
        .then(res => res.json())
        .then(data => {
          if (data.news) {
            setNews(data.news);
            setFeedMode(data.mode || "today");
            setError(null);
          } else {
            setError(data.error || "Failed to load feed");
          }
          setLoading(false);
        })
        .catch(() => {
          setError("Network error fetching feed");
          setLoading(false);
        });
    };

    fetchNews();
    const intervalId = setInterval(() => {
      if (!document.hidden) {
        fetchNews();
      }
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  if (loading && news.length === 0) {
    return <div style={{ padding: 16, color: "#475569", fontSize: 11, textAlign: "center" }}>Loading feeds...</div>;
  }

  if (error && news.length === 0) {
    return <div style={{ padding: 16, color: "#f87171", fontSize: 11, textAlign: "center" }}>⚠ {error}</div>;
  }

  if (news.length === 0) {
    return <div style={{ padding: 16, color: "#475569", fontSize: 11, textAlign: "center" }}>No recent Bloomberg headlines available yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 14px 0", color: "#64748b", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {feedMode === "today" ? "Today in New York market time" : "Latest available headlines"}
      </div>
      {news.map((item, i) => {
        const timeStr = new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
        return (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "12px 14px",
              borderBottom: i < news.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
              textDecoration: "none",
              display: "block",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <div style={{ fontSize: 9, color: "#fbbf24", fontWeight: 700, marginBottom: 4, letterSpacing: "0.05em", display: "flex", justifyContent: "space-between" }}>
              <span>{item.category}</span>
              <span style={{ color: "#64748b" }}>{timeStr} ET</span>
            </div>
            <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.4, fontWeight: 600 }}>
              {item.title}
            </div>
          </a>
        );
      })}
    </div>
  );
});

export default BloombergFeed;
