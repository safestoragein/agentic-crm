"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { rangeForPreset, ymd } from "@/lib/crm";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "all", label: "All" },
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// yyyy-mm-dd <-> Date (local, no timezone surprises).
function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s) {
  const [y, m, d] = String(s || "").split("-").map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1) : new Date();
}
function prettyYmd(s) {
  if (!s) return "";
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export default function DateFilter({ onChange, defaultPreset = "today" }) {
  const [preset, setPreset] = useState(defaultPreset);
  const [custom, setCustom] = useState({ from: ymd(), to: ymd() });
  const [open, setOpen] = useState(false);         // calendar popover open?
  const [view, setView] = useState(() => new Date()); // month being displayed
  const [pick, setPick] = useState({ from: null, to: null }); // in-progress selection
  const wrapRef = useRef(null);

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

  // Close the calendar on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choosePreset = (key) => {
    setPreset(key);
    setOpen(false);
  };

  // "Custom" → open the calendar right away, seeded on the current range.
  const openCustom = () => {
    setPreset("custom");
    setView(parseYmd(custom.from || ymd()));
    setPick({ from: null, to: null });
    setOpen(true);
  };

  // First click sets the start; second click sets the end (auto-ordered) and
  // commits. Clicking one day then the same day = a single day.
  const selectDay = (dYmd) => {
    if (!pick.from || pick.to) {
      setPick({ from: dYmd, to: null });
      return;
    }
    let from = pick.from;
    let to = dYmd;
    if (to < from) [from, to] = [to, from];
    setPick({ from, to });
    setCustom({ from, to });
    setOpen(false);
  };

  // Days grid for the displayed month (leading blanks + 1..daysInMonth).
  const cells = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(toYmd(new Date(y, m, d)));
    return out;
  }, [view]);

  // What to highlight: an in-progress pick takes priority, else the committed range.
  const hlFrom = pick.from || custom.from;
  const hlTo = pick.from ? pick.to : custom.to;
  const today = ymd();

  return (
    <div ref={wrapRef} className="relative flex flex-col items-stretch gap-2 sm:items-end">
      <div className="inline-flex items-center gap-1 rounded-xl border border-indigo-300 bg-indigo-50/50 p-1 shadow-sm ring-1 ring-indigo-200">
        <span className="ml-0.5 mr-0.5 inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
          <CalendarDays className="h-3.5 w-3.5" /> Date
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePreset(p.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === p.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={openCustom}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            preset === "custom" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {preset === "custom" && custom.from
            ? custom.from === custom.to
              ? prettyYmd(custom.from)
              : `${prettyYmd(custom.from)} – ${prettyYmd(custom.to)}`
            : "Custom"}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[19rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          {/* month nav */}
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold text-slate-800">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* weekday header */}
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-slate-400">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          {/* days */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const isFrom = d === hlFrom;
              const isTo = d === hlTo;
              const inRange = hlFrom && hlTo && d > hlFrom && d < hlTo;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  onClick={() => selectDay(d)}
                  className={`flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                    isFrom || isTo
                      ? "bg-indigo-600 text-white"
                      : inRange
                      ? "bg-indigo-100 text-indigo-700"
                      : "text-slate-700 hover:bg-slate-100"
                  } ${isToday && !(isFrom || isTo) ? "ring-1 ring-indigo-300" : ""}`}
                >
                  {Number(d.slice(-2))}
                </button>
              );
            })}
          </div>

          {/* footer */}
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <button
              onClick={() => setView(new Date())}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              This month
            </button>
            <span className="text-[11px] text-slate-400">
              {pick.from && !pick.to ? "Pick end date…" : "Click a day, then another for a range"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
