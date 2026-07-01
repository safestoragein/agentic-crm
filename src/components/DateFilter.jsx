"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { rangeForPreset, ymd } from "@/lib/crm";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All" },
];

export default function DateFilter({ onChange, defaultPreset = "today" }) {
  const [preset, setPreset] = useState(defaultPreset);
  const [custom, setCustom] = useState({ from: ymd(), to: ymd() });

  useEffect(() => {
    if (preset === "custom") {
      const { from, to } = custom;
      if (from && to && from <= to) {
        onChange({ from, to, label: from === to ? from : `${from} → ${to}` });
      }
    } else {
      onChange(rangeForPreset(preset));
    }
  }, [preset, custom, onChange]);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="inline-flex items-center gap-1 rounded-xl border border-indigo-300 bg-indigo-50/50 p-1 shadow-sm ring-1 ring-indigo-200">
        <span className="ml-0.5 mr-0.5 inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
          <CalendarDays className="h-3.5 w-3.5" /> Date
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === p.key
                ? "bg-indigo-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPreset("custom")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            preset === "custom" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Custom
        </button>
      </div>

      {preset === "custom" && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50/50 px-2 py-1.5 shadow-sm ring-1 ring-indigo-200">
          <input
            type="date"
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={custom.to}
            min={custom.from}
            max={ymd()}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
