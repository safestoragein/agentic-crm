"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Clock,
  Zap,
  Target,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { fetchQuotations } from "@/lib/crm";

// AI-style coaching over the rep's own quotations: speed-to-lead, the hours they
// actually connect (best-connect window), pipeline health, and derived tips.
// All computed from data already in fetchQuotations — no new backend.

export default function AiAnalyticsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback((signal) => {
    const s = getSession();
    if (!s) return Promise.resolve();
    setLoading(true);
    return fetchQuotations(s.user_id, { signal })
      .then((d) => {
        setList(d);
        setError("");
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load analytics. Please refresh.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const m = useMemo(() => {
    if (!list) return null;
    const open = list.filter((q) => !q.done);
    const contacted = open.filter((q) => q.contacted).length;
    const resp = list.map((q) => q.responseMins).filter((v) => v != null && v >= 0);
    const avgResp = resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length) : null;
    const within15 = resp.length ? Math.round((resp.filter((v) => v <= 15).length / resp.length) * 100) : null;

    // best-connect window: hour-of-day the rep logs calls (follow_up_start_time)
    const hours = Array(24).fill(0);
    for (const q of list) {
      const h = hourOf(q.lastContactAt);
      if (h != null) hours[h]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));
    const peakCount = hours[peakHour] || 0;

    const rnr = open.filter((q) => q.statusKey === "rnr").length;
    const overdue = open.filter((q) => q.bucket === "overdue").length;
    const negotiation = open.filter((q) => /negoti/i.test(q.stage)).length;

    // coaching tips
    const tips = [];
    if (avgResp != null && avgResp > 15)
      tips.push({ tone: "rose", text: `First response averages ${fmtMins(avgResp)} — the 15-min SLA wins ~3× more. Pick up new leads faster.` });
    if (within15 != null && within15 < 60 && resp.length >= 5)
      tips.push({ tone: "amber", text: `Only ${within15}% of first responses hit the 15-min window. Aim for 80%+.` });
    if (overdue > 0)
      tips.push({ tone: "rose", text: `${overdue} overdue follow-up${overdue === 1 ? "" : "s"} — clear these before working fresh leads.` });
    if (rnr >= 5)
      tips.push({ tone: "amber", text: `${rnr} quotes stuck in RNR — switch to WhatsApp or an alternate number after 2 tries.` });
    if (peakCount > 0)
      tips.push({ tone: "indigo", text: `You connect most around ${fmtHour(peakHour)} — front-load your hardest calls there.` });
    if (negotiation > 0)
      tips.push({ tone: "emerald", text: `${negotiation} in negotiation — a small first-month discount tips fence-sitters over.` });
    if (tips.length === 0) tips.push({ tone: "emerald", text: "Pipeline looks healthy — keep the momentum and work the queue top-down." });

    return {
      openCount: open.length,
      contactedPct: open.length ? Math.round((contacted / open.length) * 100) : 0,
      avgResp,
      within15,
      hours,
      peakHour,
      peakCount,
      rnr,
      overdue,
      negotiation,
      tips,
    };
  }, [list]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </span>
            AI Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-500">Your speed-to-lead, best-connect window and coaching — from your live pipeline.</p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!m ? (
        <div className="mt-4 grid gap-4">
          <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Open quotes" value={m.openCount} icon={Target} tone="indigo" />
            <Kpi label="Contacted" value={`${m.contactedPct}%`} icon={Zap} tone="emerald" />
            <Kpi label="Avg 1st response" value={m.avgResp == null ? "—" : fmtMins(m.avgResp)} icon={Clock} tone={m.avgResp != null && m.avgResp > 15 ? "rose" : "emerald"} />
            <Kpi label="Within 15-min SLA" value={m.within15 == null ? "—" : `${m.within15}%`} icon={TrendingUp} tone={m.within15 != null && m.within15 < 60 ? "amber" : "emerald"} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* best-connect window */}
            <Panel
              title="Best-connect window"
              icon={Clock}
              insight={m.peakCount > 0 ? `You log the most calls around ${fmtHour(m.peakHour)} — your strongest connect hours.` : "Not enough call-time data yet."}
            >
              <HourHistogram counts={m.hours} />
            </Panel>

            {/* coaching tips */}
            <Panel title="Coaching" icon={Lightbulb} insight="Generated from your current pipeline.">
              <ul className="space-y-2.5">
                {m.tips.map((t, i) => (
                  <li key={i} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${TIP_TONES[t.tone]}`}>
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* pipeline health */}
          <Panel title="Pipeline health" icon={AlertTriangle} className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="In RNR" value={m.rnr} tone="rose" />
              <Mini label="Overdue" value={m.overdue} tone="amber" />
              <Mini label="Negotiation" value={m.negotiation} tone="emerald" />
              <Mini label="Open quotes" value={m.openCount} tone="indigo" />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Hour histogram ----------------------------- */
function HourHistogram({ counts }) {
  const max = Math.max(1, ...counts);
  const peak = counts.indexOf(Math.max(...counts));
  const hasData = counts.some((c) => c > 0);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[560px] items-end gap-1">
        {counts.map((c, h) => {
          const isPeak = hasData && h === peak && c > 0;
          return (
            <div key={h} className="flex flex-1 flex-col items-center gap-1.5">
              <span className={`text-[10px] font-bold tabular-nums ${c > 0 ? "text-slate-500" : "text-transparent"}`}>{c || 0}</span>
              <div className="flex h-24 w-full items-end" title={`${c} calls around ${fmtHour(h)}`}>
                <div
                  className={`w-full rounded-t ${isPeak ? "bg-violet-500" : c > 0 ? "bg-indigo-400" : "bg-slate-100"}`}
                  style={{ height: `${Math.max((c / max) * 100, c > 0 ? 6 : 3)}%` }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-slate-400">{h % 3 === 0 ? h : ""}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-400">Hour of day · calls logged</p>
    </div>
  );
}

/* ----------------------------- bits ----------------------------- */
const TIP_TONES = {
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function Panel({ title, icon: Icon, insight, className = "", children }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      {insight && <p className="mb-4 text-xs text-slate-500">{insight}</p>}
      {children}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }) {
  const tones = {
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
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

function Mini({ label, value, tone }) {
  const tones = { rose: "text-rose-600", amber: "text-amber-600", emerald: "text-emerald-600", indigo: "text-indigo-600" };
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
      <div className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</div>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
function hourOf(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const mm = String(dt).match(/[ T](\d{2}):/);
  return mm ? Number(mm[1]) : null;
}

function fmtHour(h) {
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${am ? "AM" : "PM"}`;
}

function fmtMins(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}
