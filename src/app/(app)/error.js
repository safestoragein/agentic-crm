"use client";

// Route-level error boundary for every screen under (app). Without this, any
// render error shows a fully blank page (and stays blank on refresh). Now the
// agent gets a clear message + one-tap recovery instead, on any device.

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({ error, reset }) {
  useEffect(() => {
    // Surface to the console so it's visible in remote debugging.
    console.error("[agentic-crm] screen error:", error);
  }, [error]);

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
