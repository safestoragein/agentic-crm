"use client";

// Route-level error boundary for every screen under (app). Without this, any
// render error shows a fully blank page (and stays blank on refresh). Now the
// agent gets a clear message + one-tap recovery instead, on any device.

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// A stale-chunk error happens right after a deploy: the browser still has the
// old page loaded and asks for a JS chunk whose hashed filename no longer exists
// on the server. The fix is simply to reload once so it fetches the fresh build.
function isChunkLoadError(error) {
  const s = `${error?.name || ""} ${error?.message || ""}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    s
  );
}

export default function AppError({ error, reset }) {
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    // Surface to the console so it's visible in remote debugging.
    console.error("[agentic-crm] screen error:", error);

    // Auto-recover from stale-chunk errors by reloading once. A short-lived
    // sessionStorage guard prevents an endless reload loop if the reload doesn't
    // resolve it (e.g. the chunk is genuinely missing).
    if (chunkError && typeof window !== "undefined") {
      const KEY = "crm_chunk_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error, chunkError]);

  // While the reload is kicking in, show a neutral spinner instead of the scary
  // error card (the page is about to refresh anyway).
  if (chunkError) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
          <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" /> Updating to the latest version…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
        </div>
        <h2 className="text-base font-bold text-slate-800">Something went wrong on this screen</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          The page hit an error. Your data is safe — try loading it again.
        </p>
        {error?.message && (
          <p className="mt-3 break-words rounded-lg bg-slate-50 px-3 py-2 text-left text-[11px] text-slate-400">
            {String(error.message).slice(0, 200)}
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
