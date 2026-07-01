"use client";

// Last-resort boundary for errors thrown in the root layout itself (where the
// per-route error.js can't reach). Replaces the whole document, so it uses
// inline styles — global CSS may not be available when the root has errored.

import { useEffect } from "react";

function isChunkLoadError(error) {
  const s = `${error?.name || ""} ${error?.message || ""}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    s
  );
}

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("[agentic-crm] fatal error:", error);
    // Stale-chunk error after a deploy — reload once (guarded against loops).
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const KEY = "crm_chunk_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#1e293b",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: 360,
            width: "100%",
            textAlign: "center",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            background: "#fff",
            padding: 24,
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>
            The app hit an error
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 20px" }}>
            Please reload. If it keeps happening, close and reopen the app.
          </p>
          <button
            onClick={() => {
              try {
                reset();
              } catch {
                if (typeof window !== "undefined") window.location.reload();
              }
            }}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload app
          </button>
        </div>
      </body>
    </html>
  );
}
