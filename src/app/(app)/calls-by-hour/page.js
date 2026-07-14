"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw, Loader2 } from "lucide-react";
import { fetchQuotations, fetchTeamQuotations } from "@/lib/crm";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";

// Calls by Hour — the selected day's tracked follow-up calls bucketed by the hour
// they started, so you can see WHEN in the day the calling happened. Same source
// as Call Analysis (quotation follow_up_start_time). Reps see their own; admins
// the whole team.

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const parseTs = (s) => {
  if (!s) return null;
  const d = new Date(String(s).includes("T") ? s : String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
};
const dayOf = (s) => (s ? String(s).slice(0, 10) : "");
// A one-hour window, e.g. 9 -> "9–10 AM", 11 -> "11 AM–12 PM", 23 -> "11 PM–12 AM".
const hourLabel = (h) => {
  const part = (x) => ({ t: x % 12 === 0 ? 12 : x % 12, ap: x < 12 || x === 24 ? "AM" : "PM" });
  const s = part(h);
  const e = part((h + 1) % 24 === 0 ? 24 : (h + 1) % 24);
  return s.ap === e.ap ? `${s.t}–${e.t} ${e.ap}` : `${s.t} ${s.ap}–${e.t} ${e.ap}`;
};

export default function CallsByHourPage() {
  const [session, setSession] = useState(null);
  const [date, setDate] = useState(todayYmd());
  const [hours, setHours] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setSession(getSession()); }, []);
  const admin = isAdmin(session);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const rows = admin ? await fetchTeamQuotations() : await fetchQuotations(session.user_id);
      const counts = new Array(24).fill(0);
      let n = 0;
      for (const q of rows) {
        if (!q.followUpStartTime || dayOf(q.followUpStartTime) !== date) continue;
        const d = parseTs(q.followUpStartTime);
        if (!d) continue;
        counts[d.getHours()]++; n++;
      }
      const active = counts.map((v, h) => ({ v, h })).filter((x) => x.v > 0);
      const lo = active.length ? active[0].h : 9;
      const hi = active.length ? active[active.length - 1].h : 18;
      const series = [];
      for (let h = lo; h <= hi; h++) series.push({ label: hourLabel(h), count: counts[h] });
      setHours(series); setTotal(n);
    } catch (e) {
      setError(e?.message || "Failed to load calls."); setHours([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [session, admin, date]);

  useEffect(() => { load(); }, [load]);

  const peak = useMemo(() => hours.reduce((best, h) => (h.count > best.count ? h : best), { label: "—", count: 0 }), [hours]);
  const max = useMemo(() => hours.reduce((m, h) => Math.max(m, h.count), 0), [hours]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BarChart3 className="h-5 w-5 text-indigo-600" /> Calls by Hour
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            When {admin ? "the team" : "you"} made follow-up calls through the day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(todayYmd())}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Today</button>
          <input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50" title="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Calls made" value={String(total)} />
        <Stat label="Busiest hour" value={peak.count > 0 ? peak.label : "—"} />
        <Stat label="In peak hour" value={peak.count > 0 ? String(peak.count) : "—"} />
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">{error}</div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">No calls logged</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">No tracked follow-up calls were recorded on this date.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-slate-700">Calls per hour</p>
          <div className="space-y-2.5">
            {hours.map((h) => {
              const pct = max > 0 ? Math.round((h.count / max) * 100) : 0;
              const isPeak = h.count === max && max > 0;
              return (
                <div key={h.label} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-right text-xs font-medium tabular-nums text-slate-500">{h.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
                    <div className={`flex h-full items-center justify-end rounded-md px-2 text-[11px] font-bold text-white transition-[width] ${isPeak ? "bg-indigo-600" : "bg-indigo-400"}`}
                      style={{ width: `${Math.max(pct, h.count > 0 ? 8 : 0)}%` }}>
                      {h.count > 0 ? h.count : ""}
                    </div>
                  </div>
                  {h.count === 0 && <span className="w-4 text-[11px] text-slate-300">0</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  );
}
