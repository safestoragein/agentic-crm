"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, RefreshCw, Loader2, Clock, ArrowDown } from "lucide-react";
import { fetchQuotations, fetchTeamQuotations } from "@/lib/crm";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";

// Call Analysis — a chronological feed of the day's tracked follow-up calls
// (the start/end time the mobile app stamps on each quotation when a call
// disconnects), in order, with the idle gap between consecutive calls. Reps see
// their own day; admins see the whole team's. Leads carry no call-timing, so
// this is quotation calls only.

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
const hhmm = (d) =>
  d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase() : "—";
const fmtDur = (secs) => {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const humanGap = (ms) => {
  if (ms == null) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const gapTone = (ms) => {
  if (ms == null) return "bg-slate-100 text-slate-500 ring-slate-200";
  const m = ms / 60000;
  if (m < 3) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (m < 15) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
};
const AV = ["#dbeafe:#2563eb", "#ede9fe:#7c3aed", "#dcfce7:#16a34a", "#fef3c7:#d97706", "#fee2e2:#dc2626", "#cffafe:#0891b2"];
const avatarFor = (key) => AV[[...String(key)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length].split(":");
const initials = (name) => (name || "?").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

export default function CallAnalysisPage() {
  const [session, setSession] = useState(null);
  const [date, setDate] = useState(todayYmd());
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setSession(getSession()); }, []);
  const admin = isAdmin(session);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const rows = admin
        ? await fetchTeamQuotations()
        : await fetchQuotations(session.user_id);

      const items = rows
        .filter((q) => q.followUpStartTime && dayOf(q.followUpStartTime) === date)
        .map((q) => {
          const start = parseTs(q.followUpStartTime);
          const end = parseTs(q.followUpEndTime);
          return {
            key: String(q.id),
            name: q.name,
            contact: q.contact,
            city: q.city,
            status: q.status || "",
            note: q.note || "",
            start,
            end,
            secs: start && end && end >= start ? Math.round((end - start) / 1000) : null,
          };
        })
        .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));

      for (let i = 1; i < items.length; i++) {
        const prevEnd = items[i - 1].end ?? items[i - 1].start;
        if (prevEnd && items[i].start) items[i].gapMs = items[i].start.getTime() - prevEnd.getTime();
      }
      setCalls(items);
    } catch (e) {
      setError(e?.message || "Failed to load calls.");
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [session, admin, date]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const withStart = calls.filter((c) => c.start);
    const gaps = calls.map((c) => c.gapMs).filter((g) => g != null && g >= 0);
    const talk = calls.reduce((a, c) => a + (c.secs ?? 0), 0);
    const dispo = new Map();
    for (const c of calls) {
      const k = (c.status || "").trim() || "Unmarked";
      dispo.set(k, (dispo.get(k) ?? 0) + 1);
    }
    return {
      total: calls.length,
      customers: new Set(calls.map((c) => c.key)).size,
      first: withStart[0]?.start ?? null,
      last: withStart.length ? withStart[withStart.length - 1].start : null,
      avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      talk,
      dispositions: [...dispo.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    };
  }, [calls]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Phone className="h-5 w-5 text-indigo-600" /> Call Analysis
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {admin ? "The team's" : "Your"} tracked follow-up calls in order, with the gap between each.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(todayYmd())}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
            Today
          </button>
          <input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50" title="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Disposition chips */}
      {stats.dispositions.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {stats.dispositions.map((d) => (
            <span key={d.label} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              <span className="uppercase tracking-wide">{d.label}</span>
              <span className="tabular-nums">{d.count}</span>
              <span className="font-normal opacity-70">· {stats.total ? Math.round((d.count / stats.total) * 100) : 0}%</span>
            </span>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Calls made" value={String(stats.total)} />
        <Stat label="Customers" value={String(stats.customers)} />
        <Stat label="First call" value={hhmm(stats.first)} />
        <Stat label="Last call" value={hhmm(stats.last)} />
        <Stat label="Avg gap" value={stats.avgGap != null ? humanGap(stats.avgGap) : "—"} />
        <Stat label="Talk time" value={stats.talk ? fmtDur(stats.talk) : "—"} />
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">{error}</div>
      ) : calls.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">No calls logged</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">No tracked follow-up calls were recorded on this date.</p>
        </div>
      ) : (
        <ol className="space-y-1">
          {calls.map((c, i) => {
            const [bg, fg] = avatarFor(c.key);
            return (
              <li key={c.key + i}>
                {i > 0 && (
                  <div className="flex h-9 items-center pl-[26px]">
                    <span className="h-full border-l-2 border-dashed border-slate-300" />
                    <span className={`ml-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${gapTone(c.gapMs)}`}>
                      <ArrowDown className="h-3 w-3" />
                      {c.gapMs != null ? `${humanGap(c.gapMs)} gap` : "first call"}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <span className="w-12 shrink-0 pt-1 text-right text-xs font-semibold tabular-nums text-slate-500">{hhmm(c.start)}</span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{ backgroundColor: bg, color: fg }}>{initials(c.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">{c.name}</span>
                      {c.status && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.status}</span>}
                      <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                        {c.secs != null && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-600 ring-1 ring-indigo-200 tabular-nums">
                            <Clock className="h-3 w-3" />{fmtDur(c.secs)}
                          </span>
                        )}
                        {c.start && c.end && <span className="tabular-nums">{hhmm(c.start)}–{hhmm(c.end)}</span>}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                      {c.city && <span>{c.city}</span>}
                      {c.contact && <span className="tabular-nums">{c.contact}</span>}
                    </div>
                    {c.note && <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{c.note}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
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
