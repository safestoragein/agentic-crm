"use client";

import { useMemo } from "react";
import { FOLLOWUP_STATUSES, normStatus } from "@/lib/crm";

// Follow-up status breakdown — one colour-coded card per canonical status (0 when
// absent, so nothing is ever hidden), computed from whatever rows are passed in
// (the caller should pass the filtered set WITHOUT the status filter). Tap a card
// to filter to that status; tap again / "All" to clear. Reused across tabs.

const STATUS_TONES = {
  rose: { dot: "bg-rose-500", badge: "bg-rose-100 text-rose-700", idle: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300", active: "border-rose-600 bg-rose-600 text-white" },
  amber: { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700", idle: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300", active: "border-amber-500 bg-amber-500 text-white" },
  emerald: { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", idle: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300", active: "border-emerald-600 bg-emerald-600 text-white" },
  sky: { dot: "bg-sky-500", badge: "bg-sky-100 text-sky-700", idle: "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300", active: "border-sky-600 bg-sky-600 text-white" },
  violet: { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700", idle: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300", active: "border-violet-600 bg-violet-600 text-white" },
  slate: { dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600", idle: "border-slate-200 bg-white text-slate-600 hover:border-slate-300", active: "border-slate-600 bg-slate-600 text-white" },
};
const STATUS_TONE_KEY = {
  rnr: "rose",
  "no-answer": "amber", "call-later": "amber", "follow-up-needed": "amber",
  contacted: "emerald", qualified: "emerald", booked: "emerald", won: "emerald", converted: "emerald",
  called: "sky", "sent-message": "sky", negotiation: "violet",
  lost: "slate", invalid: "slate", closed: "slate",
};
function statusTone(key) {
  return STATUS_TONES[STATUS_TONE_KEY[key] || "slate"];
}
function prettyStatus(s) {
  return String(s)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/gi, "RNR")
    .replace(/\bOtp\b/gi, "OTP");
}

export default function StatusBreakdown({ rows, status, onSelect, title = "By follow-up status" }) {
  const breakdown = useMemo(() => {
    const counts = new Map();
    for (const r of rows || []) {
      const key = normStatus(r.status) || "__none";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const keys = [...new Set([...FOLLOWUP_STATUSES, ...counts.keys()])].filter((k) => k !== "__none");
    const items = keys
      .map((key) => ({ key, count: counts.get(key) || 0, label: prettyStatus(key) }))
      .sort((a, b) => b.count - a.count || FOLLOWUP_STATUSES.indexOf(a.key) - FOLLOWUP_STATUSES.indexOf(b.key));
    return { total: (rows || []).length, items, none: counts.get("__none") || 0 };
  }, [rows]);

  if (!breakdown.total) return null;

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
        {status && (
          <button onClick={() => onSelect("")} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
            Clear filter
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <button
          onClick={() => onSelect("")}
          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${
            !status ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className={`h-2.5 w-2.5 rounded-full ${!status ? "bg-white/80" : "bg-indigo-500"}`} />
            All
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${!status ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"}`}>
            {breakdown.total}
          </span>
        </button>

        {breakdown.items.map(({ key, count, label }) => {
          const tone = statusTone(key);
          const active = status && normStatus(status) === key;
          const zero = count === 0;
          return (
            <button
              key={key}
              onClick={zero ? undefined : () => onSelect(active ? "" : key)}
              disabled={zero}
              className={`flex items-center justify-between rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${
                active ? tone.active : zero ? "border-slate-100 bg-slate-50 text-slate-300" : tone.idle
              }`}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-white/80" : zero ? "bg-slate-200" : tone.dot}`} />
                <span className="truncate">{label}</span>
              </span>
              <span className={`ml-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                active ? "bg-white/20 text-white" : zero ? "bg-slate-100 text-slate-300" : tone.badge
              }`}>
                {count}
              </span>
            </button>
          );
        })}

        {breakdown.none > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-slate-400 shadow-sm">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> No status
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-500">
              {breakdown.none}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
