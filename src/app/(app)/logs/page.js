"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  Phone,
  MessageCircle,
  Eye,
  Clock,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { fetchActivitySummary } from "@/lib/activity";

// Rep productivity for a day: how many calls / WhatsApp / customers worked, the
// active window, and idle ("time wasted") gaps between actions.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProductivityPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(todayYmd());

  const load = useCallback(
    (signal) => {
      setLoading(true);
      return fetchActivitySummary({ date, signal })
        .then((d) => {
          setList(d);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load productivity data. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [date]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const totals = useMemo(() => {
    const t = { calls: 0, whatsapps: 0, views: 0, reps: 0 };
    for (const r of list || []) {
      t.calls += r.calls;
      t.whatsapps += r.whatsapps;
      t.views += r.views;
      t.reps++;
    }
    return t;
  }, [list]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-700 text-white shadow-sm">
              <Activity className="h-5 w-5" />
            </span>
            Team productivity
          </h1>
          <p className="mt-1 text-sm text-slate-500">Calls, WhatsApp and customers worked per rep — plus idle gaps (time wasted).</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayYmd()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
          />
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Calls made" value={totals.calls} icon={Phone} tone="emerald" />
        <Kpi label="WhatsApp" value={totals.whatsapps} icon={MessageCircle} tone="green" />
        <Kpi label="Customers worked" value={totals.views} icon={Eye} tone="sky" />
        <Kpi label="Active reps" value={totals.reps} icon={Zap} tone="indigo" />
      </div>

      {/* table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <Th>Rep</Th>
                <Th className="text-center">Calls</Th>
                <Th className="text-center">WhatsApp</Th>
                <Th className="text-center">Customers</Th>
                <Th className="text-center">Actions</Th>
                <Th className="hidden md:table-cell">Active window</Th>
                <Th className="text-right">Idle / wasted</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!list &&
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {list && list.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm text-slate-400">
                    No activity recorded for this day yet.
                  </td>
                </tr>
              )}
              {(list || []).map((r) => (
                <Row key={r.user_id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        “Idle” = total time in gaps longer than 20 min between actions. Tracks calls, WhatsApp, customer opens and emails (not page views).
      </p>
    </div>
  );
}

/* ----------------------------- Row ----------------------------- */
function Row({ r }) {
  const wasted = r.idle_min >= 60; // flag an hour+ of idle
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.user_name} />
          <span className="text-sm font-semibold text-slate-800">{r.user_name || `#${r.user_id}`}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center text-sm font-bold tabular-nums text-emerald-700">{r.calls}</td>
      <td className="px-4 py-3 text-center text-sm font-bold tabular-nums text-green-700">{r.whatsapps}</td>
      <td className="px-4 py-3 text-center text-sm font-bold tabular-nums text-sky-700">{r.views}</td>
      <td className="px-4 py-3 text-center text-sm font-semibold tabular-nums text-slate-700">{r.actions}</td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="whitespace-nowrap text-xs text-slate-600">
          {fmtTime(r.first_at)} – {fmtTime(r.last_at)} <span className="text-slate-400">· {fmtMins(r.active_min)}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            wasted ? "bg-rose-50 text-rose-700" : r.idle_min > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
          }`}
          title={`Longest single gap: ${fmtMins(r.longest_idle_min)}`}
        >
          {wasted ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {r.idle_min > 0 ? `${fmtMins(r.idle_min)} idle` : "no gaps"}
        </span>
      </td>
    </tr>
  );
}

/* ----------------------------- bits ----------------------------- */
function Kpi({ label, value, icon: Icon, tone }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-600",
    green: "bg-green-50 text-green-600",
    sky: "bg-sky-50 text-sky-600",
    indigo: "bg-indigo-50 text-indigo-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
      {initials || "?"}
    </span>
  );
}

function fmtMins(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

function fmtTime(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const time = String(value).split(" ")[1] || "";
  return time.slice(0, 5);
}
