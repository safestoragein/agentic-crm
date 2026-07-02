"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Timer,
  Loader2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  MapPin,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  fetchQuotations,
  fetchQuoteEmailStatus,
  fetchOtpVerifiedIds,
  fetchBookingSignals,
  fetchWhatsappStatus,
  bookingScore,
  customerLifecycle,
} from "@/lib/crm";
import { getSession } from "@/lib/auth";
import { evaluateEscalation } from "@/lib/escalations";
import { scoreQuote } from "@/lib/scoring";
import { slaFor, fmtDur } from "@/lib/sla";
import QuoteCard from "@/components/QuoteCard";
import QuoteTable from "@/components/QuoteTable";
import AdminOnly from "@/components/AdminOnly";

const SLA_LABELS = {
  first_response: "First response",
  rnr_age: "RNR age",
  time_in_stage: "Time in stage",
  overdue_followup: "Overdue follow-up",
};

const VIEW_TABS = [
  { key: "all", label: "All open" },
  { key: "breached", label: "Breached", tone: "rose" },
  { key: "soon", label: "Breaching soon", tone: "amber" },
];

export default function SlaBoardPage() {
  return (
    <AdminOnly>
      <SlaBoardPageInner />
    </AdminOnly>
  );
}

function SlaBoardPageInner() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [view, setView] = useState("all");
  const [city, setCity] = useState("");
  const [sort, setSort] = useState("booking");
  const [tableView, setTableView] = useState(false); // cards | table
  // Engagement maps (same sources as /quotations) — power the rich card badges.
  const [emailStatus, setEmailStatus] = useState({});
  const [otpIds, setOtpIds] = useState(() => new Set());
  const [bookingSignals, setBookingSignals] = useState({});
  const [waStatus, setWaStatus] = useState({});

  const load = useCallback((signal) => {
    const s = getSession();
    if (!s) return Promise.resolve();
    setLoading(true);
    fetchQuoteEmailStatus({ signal }).then(setEmailStatus).catch(() => {});
    fetchOtpVerifiedIds({ signal }).then(setOtpIds).catch(() => {});
    fetchBookingSignals({ signal }).then(setBookingSignals).catch(() => {});
    fetchWhatsappStatus({ signal }).then(setWaStatus).catch(() => {});
    return fetchQuotations(s.user_id, { signal })
      .then((d) => {
        setList(d);
        setError("");
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load the SLA board. Please refresh.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Live clock — re-renders the countdowns every second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Open quotes that have at least one active SLA timer, with escalation + sla.
  const rows = useMemo(() => {
    if (!list) return [];
    const out = [];
    for (const q of list) {
      const sla = slaFor(q, now);
      if (!sla) continue;
      out.push({ q, sla, esc: evaluateEscalation(q) });
    }
    return out.sort((a, b) => a.sla.worst.remaining - b.sla.worst.remaining);
  }, [list, now]);

  const counts = useMemo(() => {
    const c = { all: rows.length, breached: 0, soon: 0, ok: 0 };
    for (const r of rows) c[r.sla.status === "breached" ? "breached" : r.sla.status === "soon" ? "soon" : "ok"]++;
    return c;
  }, [rows]);

  // Filter options come from the static list, not the per-second tick.
  const cities = useMemo(() => [...new Set((list || []).map((q) => q.city).filter(Boolean))].sort(), [list]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (view === "breached" && r.sla.status !== "breached") return false;
      if (view === "soon" && r.sla.status !== "soon") return false;
      if (city && r.q.city !== city) return false;
      return true;
    });
  }, [rows, view, city]);

  // Win-probability score per quote (uses the escalation result as a signal).
  const scoreMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) => m.set(String(q.id), scoreQuote(q, evaluateEscalation(q))));
    return m;
  }, [list]);

  // Booking-probability score per quote (OTP + email engagement + call signals).
  const bookingMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) =>
      m.set(
        String(q.id),
        bookingScore(q, {
          otp: otpIds.has(String(q.id)),
          signals: bookingSignals[String(q.id)],
          email: emailStatus[String(q.id)],
          wa: waStatus[String(q.id)],
        })
      )
    );
    return m;
  }, [list, otpIds, bookingSignals, emailStatus, waStatus]);

  // Lifecycle (funnel milestones) per quote — powers the per-card stepper.
  const lifecycleMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) =>
      m.set(
        String(q.id),
        customerLifecycle(q, {
          otp: otpIds.has(String(q.id)),
          signals: bookingSignals[String(q.id)],
          email: emailStatus[String(q.id)],
        })
      )
    );
    return m;
  }, [list, otpIds, bookingSignals, emailStatus]);

  // Re-order the filtered SLA rows by the selected sort (same comparators as
  // /quotations). Default "booking" keeps the urgency-first feel via the
  // breach badge while surfacing the most likely bookings on top.
  const sortedRows = useMemo(() => {
    const arr = [...filtered];
    if (sort === "booking") {
      return arr.sort(
        (a, b) =>
          (bookingMap.get(String(b.q.id))?.score || 0) - (bookingMap.get(String(a.q.id))?.score || 0) ||
          Number(b.q.id) - Number(a.q.id)
      );
    }
    if (sort === "score") {
      return arr.sort(
        (a, b) =>
          (scoreMap.get(String(b.q.id))?.score || 0) - (scoreMap.get(String(a.q.id))?.score || 0) ||
          Number(b.q.id) - Number(a.q.id)
      );
    }
    if (sort === "engagement") {
      const rank = (q) => {
        const otp = otpIds.has(String(q.id));
        const raw = String(emailStatus[String(q.id)]?.raw || "");
        const opened = /opened|clicked/.test(raw);
        if (otp && opened) return 0;
        if (otp) return 1;
        if (opened) return 2;
        return 3;
      };
      return arr.sort(
        (a, b) =>
          rank(a.q) - rank(b.q) ||
          (bookingMap.get(String(b.q.id))?.score || 0) - (bookingMap.get(String(a.q.id))?.score || 0) ||
          Number(b.q.id) - Number(a.q.id)
      );
    }
    const cmp = sorters[sort];
    return cmp ? arr.sort((a, b) => cmp(a.q, b.q)) : arr;
  }, [filtered, sort, bookingMap, scoreMap, otpIds, emailStatus]);

  // Sorted most-urgent first; render only the top slice to stay smooth at scale.
  const RENDER_CAP = 200;
  const shown = sortedRows.slice(0, RENDER_CAP);

  const engStats = useMemo(() => {
    let sent = 0, delivered = 0, opened = 0, clicked = 0, otpv = 0, whSent = 0, whViewed = 0;
    for (const r of sortedRows) {
      const q = r.q;
      const id = String(q.id);
      const es = emailStatus[id];
      const raw = es ? String(es.raw || "").toLowerCase().replace(/^email\./, "") : "";
      const sig = bookingSignals[id] || {};
      if (es) sent++;
      if (["delivered", "opened", "clicked"].includes(raw)) delivered++;
      if (["opened", "clicked"].includes(raw) || (sig.opens || 0) >= 1) opened++;
      if (raw === "clicked" || sig.clicked) clicked++;
      if (otpIds.has(id)) otpv++;
      if (sig.warehouseStatus) whSent++;
      const wraw = sig.warehouseStatus ? String(sig.warehouseStatus).toLowerCase().replace(/^email\./, "") : "";
      if (["opened", "clicked"].includes(wraw) || sig.warehouseViewed) whViewed++;
    }
    return { sent, delivered, opened, clicked, otpv, whSent, whViewed };
  }, [sortedRows, emailStatus, bookingSignals, otpIds]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mt-1 text-sm text-slate-500">Live first-response, time-in-stage and RNR timers across the team.</p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Breached" value={counts.breached} icon={AlertTriangle} tone="rose" />
        <Kpi label="Breaching soon" value={counts.soon} icon={Clock} tone="amber" />
        <Kpi label="On track" value={counts.ok} icon={ShieldAlert} tone="emerald" />
        <Kpi label="Open with SLA" value={counts.all} icon={Timer} tone="slate" />
      </div>

      {/* tabs + filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
          {VIEW_TABS.map((t) => {
            const active = view === t.key;
            const n = counts[t.key === "all" ? "all" : t.key];
            return (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition-colors ${
                  active ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        <FilterSelect icon={MapPin} value={city} onChange={setCity}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <Zap className="h-3.5 w-3.5 text-indigo-500" /> Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="booking">Booking probability (high → low)</option>
            <option value="engagement">Engagement priority</option>
            <option value="score">Win % (most likely)</option>
            <option value="priority">Priority bucket</option>
            <option value="value">Value (high → low)</option>
            <option value="newest">Newest</option>
            <option value="followup">Follow-up date</option>
            <option value="id">Quote ID</option>
          </select>
        </label>
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button onClick={() => setTableView(false)} className={`px-3 py-2 text-xs font-semibold transition-colors ${!tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Cards</button>
          <button onClick={() => setTableView(true)} className={`px-3 py-2 text-xs font-semibold transition-colors ${tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Table</button>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
      </div>

      {/* Engagement stat tiles (emails, OTP, warehouse) */}
      {list && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile label="Emails sent" value={engStats.sent} tone="slate" />
          <StatTile label="Delivered" value={engStats.delivered} tone="sky" />
          <StatTile label="Opened" value={engStats.opened} tone="indigo" />
          <StatTile label="Clicked" value={engStats.clicked} tone="emerald" />
          <StatTile label="OTP verified" value={engStats.otpv} tone="emerald" />
          <StatTile label="Warehouse sent" value={engStats.whSent} tone="violet" />
          <StatTile label="Warehouse viewed" value={engStats.whViewed} tone="emerald" />
        </div>
      )}

      {/* Table view (with lifecycle) */}
      {list && tableView && shown.length > 0 && (
        <div className="mt-4">
          <QuoteTable rows={shown.map((x) => x.q)} getBooking={(q) => bookingMap.get(String(q.id))} getLife={(q) => lifecycleMap.get(String(q.id))} />
        </div>
      )}

      {/* SLA-timer alert strip + rich cards (same design + data as /quotations) */}
      <div className="mt-4 space-y-3">
        {!list && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
          </div>
        )}
        {list && filtered.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
            Nothing {view === "breached" ? "breached" : view === "soon" ? "breaching soon" : "open with an SLA"} right now. 🎉
          </div>
        )}
        {!tableView && shown.map(({ q, sla }) => {
          const worst = sla.worst;
          const breached = sla.status === "breached";
          const breachMins = breached ? Math.max(1, Math.round(-worst.remaining / 60000)) : null;
          return (
            <div key={`${q.id}-${q.stage}`}>
              {/* SLA timer summary — preserves the live countdown + label per quote */}
              <SlaStrip sla={sla} />
              <QuoteCard
                q={q}
                esc={escMap.get(String(q.id))}
                booking={bookingMap.get(String(q.id))}
                email={emailStatus[String(q.id)]}
                otp={otpIds.has(String(q.id))}
                life={lifecycleMap.get(String(q.id))}
                wh={bookingSignals[String(q.id)]}
                wa={waStatus[String(q.id)]}
                breach={breached}
                breachMins={breachMins}
                compact={false}
              />
            </div>
          );
        })}
        {list && filtered.length > RENDER_CAP && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/40 px-4 py-2.5 text-center text-xs text-slate-500">
            Showing the {RENDER_CAP} most urgent of {filtered.length.toLocaleString("en-IN")} — work the top of the list first.
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- escMap per-quote ----------------------------- */
// (escMap is computed inside the component below — see SlaBoardPage.)

/* ----------------------------- SLA timer strip ----------------------------- */
// Compact live-countdown strip rendered above each card so the SLA timers
// (first response / time-in-stage / RNR age / overdue follow-up) stay visible.
function SlaStrip({ sla }) {
  const worst = sla.worst;
  const tone = STATUS_TONE[sla.status];
  const others = sla.timers.filter((t) => t !== worst);
  return (
    <div className={`mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-l-4 ${tone.border} ${tone.pill} px-3 py-1.5`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {SLA_LABELS[worst.type] || worst.label}
      </span>
      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold tabular-nums ${tone.text}`}>
        {worst.remaining <= 0 ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {worst.remaining <= 0 ? `Breached ${fmtDur(worst.remaining)} ago` : `${fmtDur(worst.remaining)} left`}
      </span>
      {others.map((t, i) => (
        <span
          key={i}
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[t.status].pill}`}
          title={SLA_LABELS[t.type] || t.label}
        >
          {miniLabel(t.type)} {t.remaining <= 0 ? `+${fmtDur(t.remaining)}` : fmtDur(t.remaining)}
        </span>
      ))}
    </div>
  );
}

/* ----------------------------- sort comparators ----------------------------- */
// Mirror /quotations exactly.
const sorters = {
  id: (a, b) => Number(b.id) - Number(a.id),
  priority: (a, b) => bucketRank(a) - bucketRank(b) || (b.overdueDays || 0) - (a.overdueDays || 0),
  newest: (a, b) => createdMs(b) - createdMs(a),
  followup: (a, b) => (a.followDate || "9999").localeCompare(b.followDate || "9999"),
  value: (a, b) => (b.value || 0) - (a.value || 0),
};

function StatTile({ label, value, tone, onClick }) {
  const tones = {
    slate: "text-slate-700",
    indigo: "text-indigo-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    sky: "text-sky-600",
    violet: "text-violet-600",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm ${onClick ? "transition-colors hover:border-indigo-300 hover:bg-slate-50" : ""}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tones[tone] || "text-slate-700"}`}>{value}</div>
    </Comp>
  );
}

function createdMs(q) {
  const t = Date.parse(String(q.createdAt || "").replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

function bucketRank(q) {
  if (q.done) return 4;
  return { overdue: 0, today: 1, upcoming: 2, none: 3 }[q.bucket] ?? 3;
}

/* ----------------------------- bits ----------------------------- */
const STATUS_TONE = {
  breached: { text: "text-rose-700", pill: "bg-rose-50 text-rose-700", dot: "bg-rose-500", bar: "bg-rose-500", border: "border-l-rose-400" },
  soon: { text: "text-amber-700", pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500", bar: "bg-amber-400", border: "border-l-amber-300" },
  ok: { text: "text-emerald-700", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500", border: "border-l-emerald-200" },
};

function miniLabel(type) {
  return { first_response: "1st", rnr_age: "RNR", time_in_stage: "Stage", overdue_followup: "F/up" }[type] || type;
}

function Kpi({ label, value, icon: Icon, tone }) {
  const tones = {
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    slate: "bg-slate-100 text-slate-500",
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

function FilterSelect({ icon: Icon, value, onChange, children }) {
  const active = value !== "";
  return (
    <div className={`relative inline-flex items-center rounded-xl border ${active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
      <Icon className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${active ? "text-indigo-500" : "text-slate-400"}`} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`max-w-[160px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-3 text-sm focus:outline-none ${active ? "font-semibold text-indigo-700" : "text-slate-600"}`}
      >
        {children}
      </select>
    </div>
  );
}

