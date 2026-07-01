"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  UserRound,
  Loader2,
  RefreshCw,
  Phone,
  MessageCircle,
  Eye,
  AlertTriangle,
  Clock,
  CheckCircle2,
  MapPin,
  Filter,
  ClipboardList,
  Search,
  Zap,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import {
  fetchFollowupCohort,
  FOLLOWUP_STATUSES,
  normStatus,
  fetchQuoteEmailStatus,
  fetchOtpVerifiedIds,
  fetchBookingSignals,
  fetchWhatsappStatus,
  bookingScore,
  customerLifecycle,
  ymd,
  triggerAutoShareWarehouse,
} from "@/lib/crm";
import { evaluateEscalation } from "@/lib/escalations";
import { scoreQuote } from "@/lib/scoring";
import { fetchHouseholdLeads } from "@/lib/leads";
import FollowUpModal from "@/components/FollowUpModal";
import QuickFollowUpModal from "@/components/QuickFollowUpModal";
import QuoteCard from "@/components/QuoteCard";

// A rep's focused follow-up queue: overdue → due-today → upcoming, with one-tap
// call / WhatsApp. Split into Quotations (all quotes bucketed by follow_up_date,
// including lost/invalid — matching the legacy view) and Leads (ss_leads).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function FollowUpsPage() {
  const [mode, setMode] = useState("quotations"); // "quotations" | "leads"
  const [quotes, setQuotes] = useState(null); // full mapped quotations (mapQuotationRow), like /quotations
  const [cohort, setCohort] = useState(null); // dashboard-sourced rows for ?view=
  const [leads, setLeads] = useState(null);
  // Engagement maps (same sources as /quotations) — power the rich card badges.
  const [emailStatus, setEmailStatus] = useState({}); // customer_id -> latest quote email status
  const [otpIds, setOtpIds] = useState(() => new Set()); // customer_ids with verified mobile OTP
  const [bookingSignals, setBookingSignals] = useState({}); // customer_id -> { opens, clicked, warehouseStatus, … }
  const [waStatus, setWaStatus] = useState({}); // customer_id -> { status, seen, lastSeen }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => ymd()); // today by default
  const [to, setTo] = useState(() => ymd());
  const [city, setCity] = useState("");
  const [status, setStatus] = useState(""); // follow_up status filter (RNR, Contacted, …)
  const [sort, setSort] = useState("booking"); // default: highest booking probability first (same as /quotations)
  const [query, setQuery] = useState(""); // search name / phone / email / customer_id / unique_id
  // Optional cohort view passed from the dashboard "Booking opportunity" levers,
  // e.g. ?view=waiting → only overdue + due-today (ignores the date range so all
  // overdue, however old, show). Cleared via the banner to return to date mode.
  const [view, setView] = useState(null);
  const [followUpRow, setFollowUpRow] = useState(null); // open the log-activity modal
  const [quickFollowFor, setQuickFollowFor] = useState(null); // open the quick follow-up modal

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "waiting" || v === "overdue" || v === "today") {
      setView(v);
      setMode("quotations"); // these cohorts are the quotation follow-up queue
    }
    // No cron — sweep & send the warehouse media kit (to customers created ~3 min
    // ago) once when this page opens. Sending is strictly once-per-customer:
    // the backend atomically claims warehouse_kit_sent_at (NULL→NOW), so repeated
    // page loads / multiple open tabs can never double-send.
    triggerAutoShareWarehouse();
  }, []);

  const load = useCallback(
    (signal) => {
      const s = getSession();
      if (!s) return Promise.resolve();
      setLoading(true);
      // Quotations mode (with or without a dashboard cohort view) loads the SAME
      // source as /quotations (crm_team_quotations_data → full mapQuotationRow),
      // so cards have all the data and the numbers match the dashboard. Leads
      // mode loads ss_leads.
      const p =
        mode === "leads"
          ? fetchHouseholdLeads({ userId: s.user_id, limit: 1000, signal }).then(setLeads)
          : fetchFollowupCohort(s.user_id, { signal }).then((d) => {
              setQuotes(d);
              setCohort(d);
            });
      // For quotations mode, also load the engagement maps the rich cards need.
      if (mode !== "leads") {
        fetchQuoteEmailStatus({ signal }).then(setEmailStatus).catch(() => {});
        fetchOtpVerifiedIds({ signal }).then(setOtpIds).catch(() => {});
        fetchBookingSignals({ signal }).then(setBookingSignals).catch(() => {});
        fetchWhatsappStatus({ signal }).then(setWaStatus).catch(() => {});
      }
      return p
        .then(() => setError(""))
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load your follow-ups. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [mode, view]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Unified shape ({ followUps:{overdue,dueToday,upcoming}, callQueue, doneTodayCount }).
  // Quotations mode (view or not) buckets the full mapQuotationRow objects exactly
  // like the dashboard (skip done, bucket by follow_up_date); leads mode buckets ss_leads.
  const data = useMemo(() => {
    if (mode === "leads") return leads ? bucketLeads(leads) : null;
    const src = view ? cohort : quotes;
    return src ? bucketCohort(src) : null;
  }, [view, cohort, mode, quotes, leads]);

  const fu = data?.followUps;
  const allItems = useMemo(() => (fu ? [...fu.overdue, ...fu.dueToday, ...fu.upcoming] : []), [fu]);

  const inRangeCount = useMemo(
    () => (view ? allItems.length : allItems.filter((r) => r.followDate >= from && r.followDate <= to).length),
    [allItems, from, to, view]
  );
  const counts = {
    overdue: fu?.overdue?.length ?? 0,
    today: fu?.dueToday?.length ?? 0,
    upcoming: fu?.upcoming?.length ?? 0,
  };

  const rows = useMemo(() => {
    let base = allItems;
    if (view === "waiting") base = base.filter((r) => r.bucket === "overdue" || r.bucket === "today");
    else if (view === "overdue") base = base.filter((r) => r.bucket === "overdue");
    else if (view === "today") base = base.filter((r) => r.bucket === "today");
    else base = base.filter((r) => r.followDate >= from && r.followDate <= to); // date mode
    const q = query.trim().toLowerCase();
    return base
      .filter((r) => !city || r.city === city)
      .filter((r) => !status || normStatus(r.status) === normStatus(status))
      .filter((r) => !q || matchesQuery(r, q))
      .sort((a, b) => String(b.followDate).localeCompare(String(a.followDate)) || String(a.name).localeCompare(String(b.name)));
  }, [allItems, from, to, city, status, view, query]);

  const cities = useMemo(
    () => [...new Set(allItems.map((r) => r.city).filter(Boolean))].sort(),
    [allItems]
  );

  // Full status list (union of the canonical set + anything present), so the
  // dropdown always offers every option regardless of the current view.
  const statuses = useMemo(() => {
    const present = allItems.map((r) => normStatus(r.status)).filter(Boolean);
    return [...new Set([...FOLLOWUP_STATUSES, ...present])];
  }, [allItems]);

  // Full mapped quote per customer_id — the rich cards render the FULL object
  // (uid, value, contacted, verified, …), not the simplified follow-up item.
  const quoteById = useMemo(() => {
    const m = new Map();
    (view ? cohort : quotes || []).forEach?.((q) => m.set(String(q.id), q));
    return m;
  }, [view, cohort, quotes]);

  // Escalation evaluation per quote (keyed by customer_id) — mirrors /quotations.
  const escMap = useMemo(() => {
    const m = new Map();
    (view ? cohort : quotes || []).forEach?.((q) => m.set(String(q.id), evaluateEscalation(q)));
    return m;
  }, [view, cohort, quotes]);

  // Win-probability score per quote (uses the escalation result as a signal) — mirrors /quotations.
  const scoreMap = useMemo(() => {
    const m = new Map();
    (view ? cohort : quotes || []).forEach?.((q) => m.set(String(q.id), scoreQuote(q, escMap.get(String(q.id)))));
    return m;
  }, [view, cohort, quotes, escMap]);

  // Booking-probability score per quote (OTP + email engagement + call signals).
  const bookingMap = useMemo(() => {
    const m = new Map();
    (view ? cohort : quotes || []).forEach?.((q) =>
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
  }, [view, cohort, quotes, otpIds, bookingSignals, emailStatus, waStatus]);

  // Lifecycle (funnel milestones) per quote — powers the per-card stepper.
  const lifecycleMap = useMemo(() => {
    const m = new Map();
    (view ? cohort : quotes || []).forEach?.((q) =>
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
  }, [view, cohort, quotes, otpIds, bookingSignals, emailStatus]);

  // The follow-up-due quotes (full objects). `rows` has already applied the
  // date-window / bucket + city + search filters; here we just re-order the
  // resulting full quote objects by the selected sort (same comparators as
  // /quotations).
  const quoteRows = useMemo(() => {
    if (mode === "leads") return [];
    const list = rows.map((r) => quoteById.get(String(r.id))).filter(Boolean);
    if (sort === "booking") {
      return [...list].sort(
        (a, b) =>
          (bookingMap.get(String(b.id))?.score || 0) - (bookingMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    if (sort === "score") {
      return [...list].sort(
        (a, b) =>
          (scoreMap.get(String(b.id))?.score || 0) - (scoreMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    if (sort === "engagement") {
      // OTP-verified + viewed first, then OTP-verified, then the rest; booking
      // score breaks ties within a tier.
      const rank = (q) => {
        const otp = otpIds.has(String(q.id));
        const raw = String(emailStatus[String(q.id)]?.raw || "");
        const opened = /opened|clicked/.test(raw);
        if (otp && opened) return 0;
        if (otp) return 1;
        if (opened) return 2;
        return 3;
      };
      return [...list].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (bookingMap.get(String(b.id))?.score || 0) - (bookingMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    return [...list].sort(sorters[sort]);
  }, [mode, rows, quoteById, sort, bookingMap, scoreMap, otpIds, emailStatus]);

  const engStats = useMemo(() => {
    let sent = 0, delivered = 0, opened = 0, clicked = 0, otpv = 0, whSent = 0, whViewed = 0;
    for (const q of quoteRows) {
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
  }, [quoteRows, emailStatus, bookingSignals, otpIds]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <CalendarClock className="h-5 w-5" />
            </span>
            Follow-ups
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "leads" ? "Your lead follow-ups" : "Your quotation follow-ups"} — overdue first, then due today. One tap to call or WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            {[
              { key: "leads", label: "Leads" },
              { key: "quotations", label: "Quotations" },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMode(m.key);
                  setView(null);
                }}
                className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                  mode === m.key ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* KPIs — reflect the active cohort when a dashboard view is on */}
      <div className={`grid grid-cols-2 gap-3 ${view ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        <Kpi
          label={view ? "Waiting" : "In range"}
          value={view ? counts.overdue + counts.today : inRangeCount}
          icon={CalendarClock}
          tone="indigo"
        />
        <Kpi label="Overdue" value={counts.overdue} icon={AlertTriangle} tone="rose" />
        <Kpi label="Due today" value={counts.today} icon={Clock} tone="amber" />
        {!view && <Kpi label="Upcoming" value={counts.upcoming} icon={CheckCircle2} tone="emerald" />}
      </div>

      {/* cohort banner (from a dashboard lever) */}
      {view && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-indigo-700">
            {view === "waiting" ? "Waiting on a callback" : view === "overdue" ? "Overdue follow-ups" : "Due today"}
          </span>
          <span className="text-indigo-500">
            {view === "waiting" ? "Overdue + due today" : view === "overdue" ? "All overdue, any date" : "Due today"} · {rows.length} customer{rows.length === 1 ? "" : "s"}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => setView(null)}
            className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Clear · show by date
          </button>
        </div>
      )}

      {/* follow-up date range filter — hidden while a cohort view is active */}
      <div className={`mt-4 flex flex-wrap items-center gap-2 ${view ? "hidden" : ""}`}>
        <div className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50/50 px-3 py-1.5 ring-1 ring-indigo-200">
          <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
            <CalendarClock className="h-3 w-3" /> Date
          </span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-sm font-semibold text-slate-700 focus:outline-none" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={to} min={from} max={ymd()} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-sm font-semibold text-slate-700 focus:outline-none" />
        </div>
        <Preset active={from === shiftDate(ymd(), -6) && to === ymd()} onClick={() => { setFrom(shiftDate(ymd(), -6)); setTo(ymd()); }}>Last 7 days</Preset>
        <Preset active={from === ymd() && to === ymd()} onClick={() => { setFrom(ymd()); setTo(ymd()); }}>Today</Preset>
        <Preset active={from === shiftDate(ymd(), -1) && to === shiftDate(ymd(), -1)} onClick={() => { const y = shiftDate(ymd(), -1); setFrom(y); setTo(y); }}>Yesterday</Preset>
        <span className="hidden text-xs text-slate-400 lg:inline">Follow-ups due {fmtDate(from)} – {fmtDate(to)}</span>
        <span className="flex-1" />
        {statuses.length > 0 && (
          <div className={`relative inline-flex items-center rounded-xl border ${status ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
            <Filter className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${status ? "text-indigo-500" : "text-slate-400"}`} />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`max-w-[170px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-3 text-sm focus:outline-none ${status ? "font-semibold text-indigo-700" : "text-slate-600"}`}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {prettyStatus(s)}
                </option>
              ))}
            </select>
          </div>
        )}
        {cities.length > 0 && (
          <div className={`relative inline-flex items-center rounded-xl border ${city ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
            <MapPin className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${city ? "text-indigo-500" : "text-slate-400"}`} />
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={`max-w-[160px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-3 text-sm focus:outline-none ${city ? "font-semibold text-indigo-700" : "text-slate-600"}`}
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* search — name / phone / email / customer id / unique id; + sort (quotations mode) */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, ID…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
          />
        </div>
        {mode !== "leads" && (
          <>
            <span className="flex-1" />
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
          </>
        )}
      </div>

      {/* Engagement stat tiles (emails, OTP, warehouse) */}
      {mode !== "leads" && data && (
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

      {/* Quotations mode — rich cards (same design + data as /quotations) */}
      {mode !== "leads" ? (
        <div className="mt-4 space-y-3">
          {!data && (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
            </div>
          )}
          {data && quoteRows.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
              No quotation follow-ups due {fmtDate(from)} – {fmtDate(to)}.
            </div>
          )}
          {(data ? quoteRows : []).map((q) => (
            <QuoteCard
              key={q.id}
              q={q}
              esc={escMap.get(String(q.id))}
              booking={bookingMap.get(String(q.id))}
              email={emailStatus[String(q.id)]}
              otp={otpIds.has(String(q.id))}
              life={lifecycleMap.get(String(q.id))}
              wh={bookingSignals[String(q.id)]}
              wa={waStatus[String(q.id)]}
              breach={false}
              breachMins={null}
              compact={false}
              onLogActivity={() => setFollowUpRow(q)}
              onQuickFollowUp={() => setQuickFollowFor(q)}
            />
          ))}
        </div>
      ) : (
      /* Leads mode — table */
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <Th>Customer</Th>
                <Th>When</Th>
                <Th className="hidden md:table-cell">Status</Th>
                <Th className="hidden lg:table-cell">Stage</Th>
                <Th className="hidden lg:table-cell">Last note</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!data &&
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-4">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {data && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-sm text-slate-400">
                    No lead follow-ups due {fmtDate(from)} – {fmtDate(to)}.
                  </td>
                </tr>
              )}
              {(data ? rows : []).map((r, i) => (
                <Row key={`${r.qid || r.id}-${r.followDate}-${i}`} r={r} onLogActivity={() => setFollowUpRow(r)} onQuickFollowUp={() => setQuickFollowFor(r)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Log-activity / follow-up update — only for called customers */}
      {followUpRow && (
        <FollowUpModal
          quote={followUpRow}
          onClose={() => setFollowUpRow(null)}
          onSaved={() => load()}
        />
      )}

      {/* Quick follow-up — status + date + note, for both quotations and leads */}
      {quickFollowFor && (
        <QuickFollowUpModal
          entity={quickFollowFor.kind === "lead" ? "lead" : "customer"}
          id={quickFollowFor.id}
          name={quickFollowFor.name}
          subtitle={quickFollowFor.uid || (quickFollowFor.kind === "lead" ? `Lead ${quickFollowFor.id}` : `ID ${quickFollowFor.id}`)}
          follow_up={quickFollowFor.status}
          follow_up_date={quickFollowFor.followDate}
          follow_up_note={quickFollowFor.noteFull || quickFollowFor.note}
          onClose={() => setQuickFollowFor(null)}
          onSaved={() => {
            setQuickFollowFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------- Row ----------------------------- */
function Row({ r, onLogActivity, onQuickFollowUp }) {
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} />
          <div className="min-w-0">
            {r.kind === "lead" ? (
              <span className="truncate text-sm font-semibold text-slate-800">{r.name}</span>
            ) : (
              <a href={appHref(`/customer/${r.id}`)} className="truncate text-sm font-semibold text-slate-800 hover:text-indigo-700">
                {r.name}
              </a>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
              {r.contact && <span className="tabular-nums">+91 {r.contact}</span>}
              {r.email && <span className="truncate">{r.email}</span>}
              {r.city && <span className="capitalize">· {r.city}</span>}
              {r.rep && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700" title="CRM user · relationship manager">
                  <UserRound className="h-2.5 w-2.5" /> {r.rep}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <WhenCell r={r} />
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="text-xs font-medium capitalize text-slate-600">{prettyWords(r.status) || "—"}</span>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="text-xs capitalize text-slate-600">{r.stage || "—"}</span>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <p className="line-clamp-2 max-w-[240px] text-xs leading-snug text-slate-500" title={r.note}>
          {r.note || "—"}
        </p>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {/* Quick follow-up — always available (status + date + note). */}
          <button
            onClick={onQuickFollowUp}
            title="Add follow-up"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition-colors hover:bg-amber-100"
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
          {/* Log activity — only for called customers (have follow-up start+end time). */}
          {r.kind !== "lead" && r.hasCallTimes && (
            <IconBtn title="Log activity" tone="view" onClick={onLogActivity}>
              <ClipboardList className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {r.kind !== "lead" && (
            <IconBtn href={appHref(`/customer/${r.id}`)} title="View" tone="view">
              <Eye className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {r.contact && (
            <>
              <IconBtn href={`tel:+91${r.contact}`} title="Call" tone="call">
                <Phone className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn href={`https://wa.me/91${r.contact}`} title="WhatsApp" tone="whatsapp" external>
                <MessageCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// Bucket the follow-up cohort (mapped by mapQuotationRow, from
// crm_team_quotations_data_follow_ups — per customer, is_customer='0', keyed on
// follow_up_date), bucketing by follow_up_date. Only 'closed' is skipped — the
// same rule as the home page's "Follow-ups due today", so the "Due today" count
// and customer list here match the dashboard exactly.
function bucketCohort(rows) {
  const overdue = [];
  const dueToday = [];
  const upcoming = [];
  for (const r of rows) {
    if (normStatus(r.status) === "closed") continue;
    if (!r.followDate) continue;
    const digits = String(r.contact || "").replace(/\D/g, "");
    const contact = digits.length >= 10 ? digits.slice(-10) : digits;
    const item = {
      id: r.id,
      uid: r.uid || "",
      kind: "quote",
      name: r.name,
      contact,
      email: r.email || "",
      city: r.city || "",
      stage: r.stage || "",
      status: r.status || "",
      note: r.note || "",
      noteFull: r.noteFull || "",
      contactMethod: r.contactMethod || "",
      callDuration: r.callDuration || "",
      hasCallTimes: Boolean(r.hasCallTimes),
      followDate: r.followDate,
      rep: r.rep || "",
    };
    if (r.bucket === "overdue") overdue.push({ ...item, overdueDays: r.overdueDays, bucket: "overdue" });
    else if (r.bucket === "today") dueToday.push({ ...item, bucket: "today" });
    else upcoming.push({ ...item, inDays: r.inDays, bucket: "upcoming" });
  }
  overdue.sort((a, b) => b.overdueDays - a.overdueDays);
  upcoming.sort((a, b) => a.inDays - b.inDays);
  const callQueue = [...overdue, ...dueToday].filter((x) => x.contact);
  return { followUps: { overdue, dueToday, upcoming }, callQueue, doneTodayCount: 0 };
}

// Bucket ss_leads into the same shape for the Leads mode.
function bucketLeads(leads) {
  const today = ymd();
  const overdue = [];
  const dueToday = [];
  const upcoming = [];
  for (const l of leads) {
    const fd = parseDateOnly(l.follow_up_date);
    if (!fd) continue;
    const digits = String(l.customer_mobile_no || "").replace(/\D/g, "");
    const contact = digits.length >= 10 ? digits.slice(-10) : digits;
    const item = {
      id: l.id,
      kind: "lead",
      name: l.customer_name || "Unknown",
      contact,
      email: l.customer_email || "",
      city: l.customer_local_city || "",
      stage: prettyStorage(l.storage_type),
      status: l.follow_up || "",
      note: l.follow_up_note || "",
      followDate: fd,
      rep: `${l.user_fname || ""} ${l.user_lname || ""}`.trim(),
    };
    const delta = daysBetween(fd, today);
    if (delta > 0) overdue.push({ ...item, overdueDays: delta, bucket: "overdue" });
    else if (delta === 0) dueToday.push({ ...item, bucket: "today" });
    else upcoming.push({ ...item, inDays: -delta, bucket: "upcoming" });
  }
  overdue.sort((a, b) => b.overdueDays - a.overdueDays);
  upcoming.sort((a, b) => a.inDays - b.inDays);
  const callQueue = [...overdue, ...dueToday].filter((x) => x.contact);
  return { followUps: { overdue, dueToday, upcoming }, callQueue, doneTodayCount: 0 };
}

// Sort comparators for the quotations-mode cards — mirror /quotations exactly.
const sorters = {
  id: (a, b) => Number(b.id) - Number(a.id), // customer_id DESC, like the backend
  priority: (a, b) => bucketRank(a) - bucketRank(b) || b.overdueDays - a.overdueDays,
  newest: (a, b) => createdMs(b) - createdMs(a),
  followup: (a, b) => (a.followDate || "9999").localeCompare(b.followDate || "9999"),
  value: (a, b) => (b.value || 0) - (a.value || 0),
};

function createdMs(q) {
  const t = Date.parse(String(q.createdAt || "").replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

function bucketRank(q) {
  if (q.done) return 4;
  return { overdue: 0, today: 1, upcoming: 2, none: 3 }[q.bucket] ?? 3;
}

// Unified search across name, phone, email, customer_id and customer_unique_id.
// Phone is matched digits-only so spaces/+91 still match.
function matchesQuery(r, q) {
  if (
    (r.name || "").toLowerCase().includes(q) ||
    (r.uid || "").toLowerCase().includes(q) || // customer_unique_id
    String(r.id || "").toLowerCase().includes(q) || // customer_id
    (r.email || "").toLowerCase().includes(q) ||
    (r.city || "").toLowerCase().includes(q) ||
    (r.contact || "").includes(q)
  ) {
    return true;
  }
  const digits = q.replace(/\D/g, "");
  return digits.length > 0 && String(r.contact || "").replace(/\D/g, "").includes(digits);
}

function parseDateOnly(v) {
  if (!v || String(v).startsWith("0000")) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function daysBetween(fromYmd, toYmd) {
  const a = new Date(fromYmd + "T00:00:00").getTime();
  const b = new Date(toYmd + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
function shiftDate(ymdStr, days) {
  const d = new Date((ymdStr || ymd()) + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Prettify a follow_up status key for the filter dropdown (e.g. "no-answer" →
// "No answer", "rnr" → "RNR").
function prettyStatus(s) {
  return String(s)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/gi, "RNR")
    .replace(/\bOtp\b/gi, "OTP");
}

function Preset({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
        active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
function prettyStorage(s) {
  if (!s) return "";
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function WhenCell({ r }) {
  if (r.bucket === "overdue")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
        <AlertTriangle className="h-3 w-3" /> {r.overdueDays}d overdue
      </span>
    );
  if (r.bucket === "today")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <Clock className="h-3 w-3" /> Due today
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      In {r.inDays}d · {fmtDate(r.followDate)}
    </span>
  );
}

/* ----------------------------- bits ----------------------------- */
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

function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
      {initials || "?"}
    </span>
  );
}

function IconBtn({ href, title, external, tone, onClick, children }) {
  const tones = {
    call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    whatsapp: "border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
    view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
  };
  const cls = tones[tone] || "border-slate-200 text-slate-500 hover:bg-indigo-50";
  const className = `flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${cls}`;
  if (!href) {
    return (
      <button type="button" title={title} onClick={onClick} className={className}>
        {children}
      </button>
    );
  }
  return (
    <a
      href={appHref(href)}
      title={title}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={className}
    >
      {children}
    </a>
  );
}

function prettyWords(s) {
  if (!s) return "";
  return String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function fmtDate(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  if (!m || !d) return "—";
  return `${+d} ${MONTHS[+m - 1]}`;
}
