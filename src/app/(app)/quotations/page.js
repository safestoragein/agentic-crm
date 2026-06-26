"use client";
import { appHref } from "@/lib/paths";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Phone,
  MessageCircle,
  ChevronRight,
  ChevronLeft,
  X,
  BadgeCheck,
  PhoneOff,
  MapPin,
  Filter,
  Mail,
  Clock,
  Loader2,
  Eye,
  Plus,
} from "lucide-react";
import { ShieldAlert, ShieldCheck, ArrowUpRight, ArrowLeftRight, Zap, Percent, Send, MailOpen, Warehouse, Check, AlertTriangle, ClipboardList } from "lucide-react";
import { getSession } from "@/lib/auth";
import { fetchQuotations, fetchQuoteEmailStatus, emailStatusInfo, mergedEmailStatus, fetchOtpVerifiedIds, fetchBookingSignals, bookingScore, customerLifecycle, shareWarehouseKit, fetchWhatsappStatus, minutesAgo, rangeForPreset, dateInRange, ymd, FOLLOWUP_STATUSES } from "@/lib/crm";

const SLA_MINUTES = 15; // first-response SLA: contact a new lead within 15 min

// Escalating severity by overdue minutes: 1 = breach, 2 = high (30m+), 3 = critical (60m+).
function slaSeverity(mins) {
  if (mins >= 60) return 3;
  if (mins >= 30) return 2;
  return 1;
}

// --- Continuous alerting helpers (sound + desktop notification) ---
let _audioCtx = null;
function slaBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_audioCtx) _audioCtx = new Ctx();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const ctx = _audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.37);
  } catch {}
}
function slaNotify(title, body) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "sla-breach", renotify: true });
    }
  } catch {}
}
import { evaluateEscalation, fmtMins } from "@/lib/escalations";
import { scoreQuote, nextAction } from "@/lib/scoring";
import { fetchTransferHistory, processReassignments } from "@/lib/rnr";
import { runDailyFollowupWhatsapp } from "@/lib/whatsapp";
import DateFilter from "@/components/DateFilter";
import FollowUpModal from "@/components/FollowUpModal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE_SIZE = 50;

const TABS = [
  { key: "all", label: "All", test: () => true },
  { key: "exceptions", label: "Exceptions", red: true, exceptions: true },
  { key: "overdue", label: "Overdue follow-up", red: true, test: (q) => q.bucket === "overdue" && !q.done },
  { key: "not_contacted", label: "Not contacted", red: true, test: (q) => !q.contacted && !q.done },
  { key: "today", label: "Due today", test: (q) => q.bucket === "today" && !q.done },
  { key: "negotiation", label: "Negotiation", test: (q) => /negoti/i.test(q.stage) },
  { key: "rnr", label: "RNR", test: (q) => q.statusKey === "rnr" },
  { key: "won", label: "Won", test: (q) => q.won },
];

export default function QuotationsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState(""); // follow_up status filter
  const [sort, setSort] = useState("booking"); // default: highest booking probability first
  const [page, setPage] = useState(1);
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState(null);
  const [followUpQuote, setFollowUpQuote] = useState(null); // open the log-activity modal
  const [emailStatus, setEmailStatus] = useState({}); // customer_id -> latest quote email status
  const [otpIds, setOtpIds] = useState(() => new Set()); // customer_ids with verified mobile OTP
  const [bookingSignals, setBookingSignals] = useState({}); // customer_id -> { opens, clicked }
  const [waStatus, setWaStatus] = useState({}); // customer_id -> { status, seen, lastSeen }
  const [range, setRange] = useState(() => rangeForPreset("today"));
  const [tick, setTick] = useState(0); // forces SLA timers to recompute live

  // When the user picks a date (Today/Yesterday/All/…), clear any active search
  // so the date filter actually takes effect. Search spans all dates, so without
  // this, clicking "Today" would keep showing the all-dates search result. The
  // ref skips the first call (DateFilter fires onChange once on mount).
  const rangeTouched = useRef(false);
  const handleRange = useCallback((r) => {
    setRange(r);
    if (rangeTouched.current) {
      setQuery("");
      setPage(1);
    }
    rangeTouched.current = true;
  }, []);

  // Pre-fill the search from a ?q= param (the top-bar search routes here), so a
  // header search for a phone/name lands on this page already filtered. Also
  // listen for the top-bar's broadcast so it works when we're ALREADY on this
  // page (no remount happens, so the ?q read alone wouldn't fire).
  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get("q");
    if (term) setQuery(term);
    const onSearch = (e) => setQuery(e.detail || "");
    window.addEventListener("crm-search", onSearch);
    return () => window.removeEventListener("crm-search", onSearch);
  }, []);

  // Re-evaluate SLA breaches every 30s (continuous alerting), even without a reload.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const loadQuotes = useCallback((signal) => {
    const s = getSession();
    if (!s) return Promise.resolve();
    return fetchQuotations(s.user_id, { signal })
      .then((d) => {
        setList(d);
        setError("");
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load quotations. Please refresh.");
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadQuotes(ctrl.signal);
    // Latest quotation-email status per customer (Resend webhook tracking).
    fetchQuoteEmailStatus({ signal: ctrl.signal })
      .then(setEmailStatus)
      .catch(() => {}); // non-critical — table still renders without it
    // OTP-verified customer ids (mobile OTP) for the "OTP" badge.
    fetchOtpVerifiedIds({ signal: ctrl.signal })
      .then(setOtpIds)
      .catch(() => {});
    // Email engagement (opens/clicks) for the booking-probability score.
    fetchBookingSignals({ signal: ctrl.signal })
      .then(setBookingSignals)
      .catch(() => {});
    // WhatsApp (RNR follow-up) read status — seen / last-seen time.
    fetchWhatsappStatus({ signal: ctrl.signal })
      .then(setWaStatus)
      .catch(() => {});
    // Run the RNR reassignment sweep on page load (replaces a cron). Guarded to
    // fire at most once per calendar day per browser; the backend is idempotent
    // per day (a reassigned customer's clock resets to today), so refreshing
    // never bounces a customer to another rep before its day is up.
    runDailyRnrSweep(ctrl.signal).then((moved) => {
      if (moved) loadQuotes(ctrl.signal); // reflect any reassignments
    });
    // Also fire the daily follow-up WhatsApp sweep here — shares the same
    // once-per-day-per-browser guard as the dashboard, so opening either page
    // first triggers it (and never twice the same day).
    runDailyFollowupWhatsapp(ctrl.signal);
    return () => ctrl.abort();
  }, [loadQuotes]);

  // Quotations created within the selected date window (default: today).
  const inRange = useMemo(() => {
    if (!list) return [];
    return list.filter((q) => dateInRange(q.customerDate || q.createdAt, range.from, range.to));
  }, [list, range]);

  // Escalation evaluation per quote (keyed by customer_id).
  const escMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) => m.set(q.id, evaluateEscalation(q)));
    return m;
  }, [list]);

  // Win-probability score per quote (uses the escalation result as a signal).
  const scoreMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) => m.set(q.id, scoreQuote(q, escMap.get(q.id))));
    return m;
  }, [list, escMap]);

  // Booking-probability score per quote (OTP + email engagement + call signals).
  const bookingMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) =>
      m.set(
        q.id,
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

  // Lifecycle (funnel milestones) per quote — powers the per-row mini stepper.
  const lifecycleMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) =>
      m.set(
        q.id,
        customerLifecycle(q, {
          otp: otpIds.has(String(q.id)),
          signals: bookingSignals[String(q.id)],
          email: emailStatus[String(q.id)],
        })
      )
    );
    return m;
  }, [list, otpIds, bookingSignals, emailStatus]);

  const cities = useMemo(() => {
    return [...new Set(inRange.map((q) => q.city).filter(Boolean))].sort();
  }, [inRange]);

  // Total quoted value (storage + pickup, incl. GST) created in the window.
  const pipelineValue = useMemo(() => inRange.reduce((s, q) => s + (q.value || 0), 0), [inRange]);

  const counts = useMemo(() => {
    const c = {};
    for (const t of TABS) {
      c[t.key] = t.exceptions
        ? inRange.filter((q) => escMap.get(q.id)?.triggers.length).length
        : inRange.filter(t.test).length;
    }
    return c;
  }, [inRange, escMap]);

  // Headline stats for the tile strip (over the date window).
  const stats = useMemo(() => {
    const total = inRange.length;
    const won = counts.won || 0;
    return {
      total,
      value: pipelineValue,
      won,
      winRate: total ? Math.round((won / total) * 100) : 0,
      dueToday: counts.today || 0,
      overdue: counts.overdue || 0,
      notContacted: counts.not_contacted || 0,
      rnr: counts.rnr || 0,
    };
  }, [inRange, counts, pipelineValue]);

  // Engagement stats (emails, OTP, warehouse) over the window.
  const engStats = useMemo(() => {
    let sent = 0, delivered = 0, opened = 0, clicked = 0, otpv = 0, whSent = 0, whViewed = 0;
    for (const q of inRange) {
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
  }, [inRange, emailStatus, bookingSignals, otpIds]);

  // Live 15-min first-response SLA breaches: uncontacted, not done, created >15 min ago.
  const breaches = useMemo(() => {
    void tick; // recompute on each tick
    return inRange
      .filter((q) => {
        if (q.contacted || q.done) return false;
        const m = minutesAgo(q.createdAt);
        return m != null && m > SLA_MINUTES;
      })
      .map((q) => ({ q, mins: minutesAgo(q.createdAt) }))
      .sort((a, b) => b.mins - a.mins);
  }, [inRange, tick]);
  const breachSet = useMemo(() => new Set(breaches.map((b) => b.q.id)), [breaches]);

  // Ask for desktop-notification permission once, and unlock audio on first click.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const unlock = () => {
      if (_audioCtx && _audioCtx.state === "suspended") _audioCtx.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Continuous alert: beep + desktop notification each cycle while breaches exist.
  useEffect(() => {
    if (breaches.length === 0) return;
    slaBeep();
    const worst = breaches[0]; // sorted by minutes desc
    slaNotify(
      `⚠ ${breaches.length} SLA breach${breaches.length > 1 ? "es" : ""} — contact now`,
      breaches.slice(0, 4).map((b) => `${b.q.name} · ${b.mins}m overdue`).join("\n")
    );
    void worst;
  }, [breaches]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const tabDef = TABS.find((t) => t.key === tab) || TABS[0];
    const q = query.trim().toLowerCase();
    // "All dates" with no search = search-only mode: don't build/sort the whole
    // history (that's what would make the tab slow). Wait for the user to type.
    if (range.label === "All dates" && !q) return [];
    // When searching, span ALL tabs AND ALL DATES — match across the rep's
    // whole quotation history (not just the selected date range), so a customer
    // who quoted long ago is still found by name/phone/ID without having to
    // clear the date filter first. Otherwise filter by the active tab in-range.
    let rows = q
      ? list.filter((r) => matchesQuery(r, q))
      : tabDef.exceptions
        ? inRange.filter((r) => escMap.get(r.id)?.triggers.length)
        : inRange.filter(tabDef.test);
    if (city) rows = rows.filter((r) => r.city === city);
    if (status) rows = rows.filter((r) => String(r.status || "").toLowerCase().trim() === status);
    if (sort === "booking") {
      // Highest booking-probability score first.
      return [...rows].sort(
        (a, b) => (bookingMap.get(b.id)?.score || 0) - (bookingMap.get(a.id)?.score || 0) || Number(b.id) - Number(a.id)
      );
    }
    if (sort === "score") {
      return [...rows].sort(
        (a, b) => (scoreMap.get(b.id)?.score || 0) - (scoreMap.get(a.id)?.score || 0) || Number(b.id) - Number(a.id)
      );
    }
    if (sort === "engagement") {
      // OTP-verified + viewed first, then OTP-verified, then the rest (OTP-not-
      // verified) at the bottom; booking score breaks ties within a tier.
      const rank = (q) => {
        const otp = otpIds.has(String(q.id));
        const raw = String(emailStatus[String(q.id)]?.raw || "");
        const opened = /opened|clicked/.test(raw);
        if (otp && opened) return 0;
        if (otp) return 1;
        if (opened) return 2;
        return 3;
      };
      return [...rows].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (bookingMap.get(b.id)?.score || 0) - (bookingMap.get(a.id)?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    return [...rows].sort(sorters[sort]);
  }, [list, inRange, escMap, scoreMap, bookingMap, otpIds, emailStatus, tab, query, city, status, sort, range]);

  // reset page when filters change
  useEffect(() => setPage(1), [tab, query, city, sort, range]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // "All dates" with nothing typed yet → show a search prompt, not the list.
  const searchOnly = range.label === "All dates" && !query.trim();

  return (
    <div className="px-5 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Quotations</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {list ? (
              query.trim() ? (
                <>
                  <span className="font-medium text-slate-700">{filtered.length}</span> result{filtered.length === 1 ? "" : "s"} for “{query.trim()}” ·{" "}
                  <span className="font-medium text-indigo-600">searching all dates</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-700">{inRange.length}</span> quotations ·{" "}
                  <span className="font-medium text-slate-700">{fmtMoney(pipelineValue)}</span> pipeline · {range.label}
                </>
              )
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/quotations/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Create quotation
          </Link>
          <DateFilter onChange={handleRange} defaultPreset="today" />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Live 15-min SLA breach alert (continuous) */}
      <SlaAlert breaches={breaches} onJump={() => { setTab("not_contacted"); setSort("followup"); }} />

      {/* Stat tiles (clickable ones jump to the matching tab) */}
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label="Quotations" value={stats.total} tone="slate" />
          <StatTile label="Pipeline" value={fmtMoney(stats.value)} tone="indigo" />
          <StatTile label="Won" value={stats.won} tone="emerald" onClick={() => setTab("won")} />
          <StatTile label="Win rate" value={`${stats.winRate}%`} tone="emerald" />
          <StatTile label="Due today" value={stats.dueToday} tone="amber" onClick={() => setTab("today")} />
          <StatTile label="Overdue" value={stats.overdue} tone="rose" onClick={() => setTab("overdue")} />
          <StatTile label="Not contacted" value={stats.notContacted} tone="rose" onClick={() => setTab("not_contacted")} />
          <StatTile label="RNR" value={stats.rnr} tone="rose" onClick={() => setTab("rnr")} />
        </div>
      )}

      {/* Engagement stat tiles (emails, OTP, warehouse) */}
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile label="Emails sent" value={engStats.sent} tone="slate" />
          <StatTile label="Delivered" value={engStats.delivered} tone="sky" />
          <StatTile label="Opened" value={engStats.opened} tone="indigo" />
          <StatTile label="Clicked" value={engStats.clicked} tone="emerald" />
          <StatTile label="OTP verified" value={engStats.otpv} tone="emerald" />
          <StatTile label="Warehouse sent" value={engStats.whSent} tone="violet" />
          <StatTile label="Warehouse viewed" value={engStats.whViewed} tone="emerald" />
        </div>
      )}

      {/* Tabs / saved views */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  t.red && counts[t.key] > 0
                    ? "bg-rose-50 text-rose-600"
                    : active
                    ? "bg-indigo-50 text-indigo-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* City filter — horizontal */}
      {cities.length > 0 && (
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
            <MapPin className="h-3.5 w-3.5" /> City
          </span>
          <CityChip active={city === ""} onClick={() => setCity("")}>
            All
          </CityChip>
          {cities.map((c) => (
            <CityChip key={c} active={city === c} onClick={() => setCity(c)}>
              {c}
            </CityChip>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, city, ID…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
          />
        </div>

        <span className="flex-1" />

        <div className={`relative inline-flex items-center rounded-lg border ${status ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
          <Filter className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${status ? "text-indigo-500" : "text-slate-400"}`} />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`max-w-[170px] cursor-pointer appearance-none truncate bg-transparent py-1.5 pl-8 pr-3 text-xs font-semibold focus:outline-none ${status ? "text-indigo-700" : "text-slate-600"}`}
          >
            <option value="">All statuses</option>
            {FOLLOWUP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {prettyFollowUp(s)}
              </option>
            ))}
          </select>
        </div>

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
          <DensityBtn on={!compact} onClick={() => setCompact(false)}>Comfort</DensityBtn>
          <DensityBtn on={compact} onClick={() => setCompact(true)}>Compact</DensityBtn>
        </div>
      </div>

      {/* Lifecycle colour key (shown once for all cards) */}
      {list && !searchOnly && pageRows.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
          <LifecycleLegend />
        </div>
      )}

      {/* Cards */}
      <div className="mt-3 space-y-3">
        {!list && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
          </div>
        )}
        {list && searchOnly && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-500">
            <Search className="mx-auto mb-2 h-5 w-5 text-slate-400" />
            Type a name, phone number, or quote # above to search across all dates.
          </div>
        )}
        {list && !searchOnly && pageRows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
            No quotations match this view.
          </div>
        )}
        {!searchOnly && pageRows.map((q) => (
          <QuoteCard
            key={q.id}
            q={q}
            esc={escMap.get(q.id)}
            score={scoreMap.get(q.id)}
            email={emailStatus[String(q.id)]}
            otp={otpIds.has(String(q.id))}
            booking={bookingMap.get(q.id)}
            life={lifecycleMap.get(q.id)}
            wh={bookingSignals[String(q.id)]}
            wa={waStatus[String(q.id)]}
            breach={breachSet.has(q.id)}
            breachMins={breachSet.has(q.id) ? minutesAgo(q.createdAt) : null}
            compact={compact}
            onLogActivity={() => setFollowUpQuote(q)}
          />
        ))}
      </div>

      {/* Footer / pagination */}
      {list && filtered.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerBtn disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </PagerBtn>
            <span className="px-2 text-xs font-medium text-slate-600">
              Page {page} of {totalPages}
            </span>
            <PagerBtn disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </PagerBtn>
          </div>
        </div>
      )}

      {/* Log-activity / follow-up update — only opened for called customers */}
      {followUpQuote && (
        <FollowUpModal
          quote={followUpQuote}
          onClose={() => setFollowUpQuote(null)}
          onSaved={() => loadQuotes()}
        />
      )}
    </div>
  );
}

/* ----------------------------- SLA alert banner ----------------------------- */
// Continuous, pulsing alert for new leads breaching the 15-min first-response SLA.
function SlaAlert({ breaches, onJump }) {
  if (!breaches || breaches.length === 0) return null;
  const top = breaches.slice(0, 4);
  return (
    <div className="mb-4 animate-pulse rounded-xl border-2 border-rose-400 bg-rose-50 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-rose-700">
          <AlertTriangle className="h-5 w-5" />
          {breaches.length} follow-up{breaches.length > 1 ? "s" : ""} breaching the {SLA_MINUTES}-min SLA — contact now
        </div>
        <button
          onClick={onJump}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
        >
          Show uncontacted
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {top.map((b) => (
          <span key={b.q.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
            {b.q.name}
            <span className="font-bold">{b.mins}m</span>
            {b.q.contact && (
              <a href={`tel:+91${b.q.contact}`} onClick={(e) => e.stopPropagation()} className="ml-0.5 text-emerald-600">
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
          </span>
        ))}
        {breaches.length > top.length && (
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
            +{breaches.length - top.length} more
          </span>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Quote card ----------------------------- */
function QuoteCard({ q, esc, score, email, otp, booking, life, wh, wa, breach, breachMins, compact, onLogActivity }) {
  const nba = nextAction(q, esc);
  const st = stageBadge(q.stage || q.status);
  const [share, setShare] = useState("idle"); // idle | sending | sent | error

  async function onShareWarehouse(e) {
    e.stopPropagation();
    if (share === "sending") return;
    if (!window.confirm(`Send warehouse photos & video to ${q.name} via WhatsApp + Email?`)) return;
    setShare("sending");
    try {
      const res = await shareWarehouseKit(q.id);
      setShare(res?.status === "success" ? "sent" : "error");
    } catch {
      setShare("error");
    }
  }

  const escalated = esc?.triggers?.length > 0;
  const sev = breach ? slaSeverity(breachMins) : 0; // 1 breach · 2 high(30m) · 3 critical(60m)
  const accent = sev
    ? "border-l-rose-500"
    : esc?.level === "L3"
    ? "border-l-rose-500"
    : escalated
    ? "border-l-amber-400"
    : "border-l-slate-200";
  const cardBg =
    sev === 3
      ? "border-rose-600 bg-rose-100 animate-pulse"
      : sev === 2
      ? "border-rose-400 bg-rose-100"
      : sev === 1
      ? "border-rose-300 bg-rose-50"
      : "border-slate-200 bg-white hover:border-slate-300";
  const sevBadge = sev === 3 ? "bg-rose-700" : sev === 2 ? "bg-rose-600" : "bg-rose-500";
  return (
    <div className={`rounded-xl border border-l-4 ${accent} ${cardBg} p-4 shadow-sm transition-colors`}>
      {/* Header: identity + badges + score + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={q.name} large />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-800">{q.name}</span>
              <span className="text-[11px] text-slate-400">{q.uid}</span>
              {breach && (
                <span className={`inline-flex animate-pulse items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${sevBadge}`}>
                  <AlertTriangle className="h-3 w-3" /> {sev === 3 ? "CRITICAL" : sev === 2 ? "URGENT" : "SLA"} {breachMins}m
                </span>
              )}
              {otp && (
                <span title="Mobile OTP verified" className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  <ShieldCheck className="h-3 w-3" /> OTP
                </span>
              )}
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${st.cls}`}>{st.label}</span>
              {esc?.top && <EscBadge level={esc.level} label={esc.top.label} />}
              {!esc?.top && q.statusKey === "rnr" && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600">
                  <PhoneOff className="h-3 w-3" /> RNR
                </span>
              )}
              {!esc?.top && !q.contacted && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600">New</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className="capitalize">{q.city || "—"}</span>
              <span>·</span>
              <span className="font-semibold text-slate-700">{fmtMoney(q.value)}</span>
              {q.contact && (<><span>·</span><span>+91 {q.contact}</span></>)}
              {q.email && (
                <>
                  <span>·</span>
                  <a href={`mailto:${q.email}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-indigo-600" title={q.email}>
                    <Mail className="h-3 w-3" /> {q.email}
                  </a>
                </>
              )}
              <span>·</span>
              <span>{fmtDateTime(q.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Booking</div>
            <BookingCell booking={booking} />
          </div>
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Email</div>
            <div className="mt-1"><EmailBadge email={email} signals={wh} /></div>
            {(() => {
              const info = emailStatusInfo(mergedEmailStatus(email, wh));
              return info?.viewed && email?.lastEventAt ? (
                <div className="mt-0.5 text-[10px] text-slate-400">{info.label} {fmtDateTime(email.lastEventAt)}</div>
              ) : null;
            })()}
          </div>
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">WhatsApp</div>
            <div className="mt-1"><WhatsappStatus wa={wa} /></div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={onShareWarehouse}
              disabled={share === "sending"}
              title="Share warehouse images & videos (WhatsApp + Email)"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                share === "sent"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : share === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              } disabled:opacity-60`}
            >
              {share === "sending" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : share === "sent" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Warehouse className="h-3.5 w-3.5" />
              )}
              {share === "sending" ? "Sending…" : share === "sent" ? "Shared" : share === "error" ? "Retry" : "Share warehouse"}
            </button>
            <WarehouseStatus wh={wh} />
          </div>
          <div className="flex items-center gap-1.5">
            {/* Log activity — only for customers that were actually called
                (have follow_up_start_time AND follow_up_end_time). */}
            {q.hasCallTimes && (
              <IconBtn title="Log activity" tone="view" onClick={onLogActivity}>
                <ClipboardList className="h-3.5 w-3.5" />
              </IconBtn>
            )}
            <IconBtn href={appHref(`/customer/${q.id}`)} title="View details" tone="view" external><Eye className="h-3.5 w-3.5" /></IconBtn>
            {q.contact && (
              <>
                <IconBtn href={`tel:+91${q.contact}`} title="Call" tone="call"><Phone className="h-3.5 w-3.5" /></IconBtn>
                <IconBtn href={`https://wa.me/91${q.contact}`} title="WhatsApp" tone="whatsapp" external><MessageCircle className="h-3.5 w-3.5" /></IconBtn>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Inline lifecycle */}
      {!compact && life && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
          <LifecycleStepper lifecycle={life} showLegend={false} wh={wh} />
        </div>
      )}

      {/* Footer: follow-up + note + next action */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-slate-500">
            Follow-up: <FollowCell q={q} />
          </span>
          {q.verified ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
              <BadgeCheck className="h-3.5 w-3.5" /> {q.lastContactAgo || "logged"}
            </span>
          ) : (
            <span className="text-slate-400">Not called yet</span>
          )}
          {q.note && <span className="line-clamp-1 max-w-[420px] text-slate-400" title={q.noteFull}>{q.note}</span>}
        </div>
        <NbaChip nba={nba} />
      </div>
    </div>
  );
}

function FollowCell({ q }) {
  const tone =
    q.bucket === "overdue" ? "text-rose-600" : q.bucket === "today" ? "text-amber-600" : "text-slate-700";
  return q.followDate ? (
    <span className={`text-sm font-semibold ${tone}`}>{fmtDate(q.followDate)}</span>
  ) : (
    <span className="text-sm text-slate-400">—</span>
  );
}

/* ----------------------------- Drawer ----------------------------- */
function Drawer({ quote, esc, booking, lifecycle, onClose }) {
  const open = Boolean(quote);
  const st = quote ? stageBadge(quote.stage || quote.status) : null;
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 transition-opacity sm:p-6 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {quote && (
          <div className="my-auto w-full max-w-[1120px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Header: identity + status chips + actions */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <Avatar name={quote.name} large />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold text-slate-900">{quote.name}</span>
                    {st && <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${st.cls}`}>{st.label}</span>}
                    {booking && (
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                        {booking.score}% booking
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {quote.uid} · <span className="capitalize">{quote.city || "—"}</span> · {fmtMoney(quote.value)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {quote.contact && (
                  <>
                    <a
                      href={`tel:+91${quote.contact}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Phone className="h-3.5 w-3.5" /> Call
                    </a>
                    <a
                      href={`https://wa.me/91${quote.contact}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </>
                )}
                {quote.email && (
                  <a
                    href={`mailto:${quote.email}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Mail className="h-3.5 w-3.5 text-indigo-500" /> Email
                  </a>
                )}
                <a
                  href={appHref(`/customer/${quote.id}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Eye className="h-3.5 w-3.5" /> Profile
                </a>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Full-width lifecycle */}
            {lifecycle && (
              <div className="border-b border-slate-200 px-6 py-5">
                <LifecycleStepper lifecycle={lifecycle} />
              </div>
            )}

            {/* Two-column body */}
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              {/* Left: customer & quote details */}
              <div>
                {esc?.triggers?.length > 0 && (
                  <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-rose-700">
                      <ShieldAlert className="h-4 w-4" /> Needs attention
                    </div>
                    <ul className="mt-2 space-y-2">
                      {esc.triggers.map((t) => (
                        <li key={t.key} className="rounded-lg bg-white/70 px-2.5 py-2 text-xs">
                          <div className="font-semibold text-slate-800">{t.label}</div>
                          <div className="mt-0.5 text-slate-600">{t.reason}</div>
                          <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                            <ArrowUpRight className="h-3 w-3" /> {t.action}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Details</div>
                <div className="mt-1">
                  <DRow k="Quote value" v={fmtMoney(quote.value)} />
                  <DRow k="Stage" v={quote.stage || "—"} />
                  <DRow k="Status" v={quote.status || "—"} />
                  {quote.source && <DRow k="Source" v={quote.source} />}
                  {quote.hometype && <DRow k="Home type" v={quote.hometype} />}
                  <DRow
                    k="Next follow-up"
                    v={
                      quote.followDate
                        ? `${fmtDate(quote.followDate)} · ${
                            quote.bucket === "overdue"
                              ? `${quote.overdueDays}d overdue`
                              : quote.bucket === "today"
                              ? "today"
                              : `in ${quote.inDays}d`
                          }`
                        : "—"
                    }
                  />
                  <DRow k="Created" v={fmtDateTime(quote.createdAt)} />
                  {quote.rnrSince && <DRow k="In RNR since" v={fmtDateTime(quote.rnrSince)} />}
                  {quote.callDuration && <DRow k="Last call duration" v={quote.callDuration} />}
                  {quote.contact && <DRow k="Phone" v={`+91 ${quote.contact}`} />}
                  {quote.email && <DRow k="Email" v={quote.email} />}
                  {quote.contactMethod && <DRow k="Preferred channel" v={quote.contactMethod} />}
                  {quote.pincode && <DRow k="Pincode" v={quote.pincode} />}
                </div>
                {quote.pickupAddress && (
                  <div className="border-b border-slate-100 py-2.5 text-sm">
                    <div className="text-slate-500">Pickup address</div>
                    <div className="mt-1 font-medium text-slate-700">{quote.pickupAddress}</div>
                  </div>
                )}
                <div
                  className={`mt-3 rounded-xl border p-3 text-xs ${
                    quote.verified ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 font-bold ${
                      quote.verified ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {quote.verified ? <BadgeCheck className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    {quote.verified ? `Last call logged ${quote.lastContactAgo}` : "No call logged yet"}
                  </div>
                  {quote.noteFull && (
                    <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-line leading-relaxed text-slate-600">
                      {quote.noteFull}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: engagement & history */}
              <div className="space-y-4">
                {booking && <BookingBreakdown booking={booking} />}
                <RnrTrail customerId={quote.id} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Fire the RNR reassignment sweep at most once per calendar day per browser.
// Resolves true if any customers were actually reassigned (so the caller can
// refresh the list). The localStorage date is only stamped on success, so a
// transient network failure retries on the next load instead of skipping a day.
// Team-wide: the sweep call carries no user filter, so the first team member to
// open /quotations on a given day shuffles the whole team's eligible RNR.
// Candidates are RNR customers dialled 2+ times (rnr_since is never populated,
// so we select by attempts). The backend must honour min_attempts for transfers
// to actually happen — until then this returns reassigned: 0.
const RNR_SWEEP_KEY = "rnrSweepDate";
const RNR_MIN_ATTEMPTS = 2;
async function runDailyRnrSweep(signal) {
  if (typeof window === "undefined") return false;
  const today = ymd();
  try {
    if (window.localStorage.getItem(RNR_SWEEP_KEY) === today) return false;
    const res = await processReassignments({ minAttempts: RNR_MIN_ATTEMPTS, signal });
    window.localStorage.setItem(RNR_SWEEP_KEY, today);
    return (res?.reassigned || 0) > 0;
  } catch {
    return false;
  }
}

/* ----------------------------- RNR transfer trail ----------------------------- */
function RnrTrail({ customerId }) {
  const [trail, setTrail] = useState(null);

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    const ctrl = new AbortController();
    fetchTransferHistory(customerId, { signal: ctrl.signal })
      .then((d) => active && setTrail(d))
      .catch((e) => {
        if (e?.name !== "AbortError" && active) setTrail([]);
      });
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [customerId]);

  if (!trail || trail.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
        <ArrowLeftRight className="h-4 w-4" />
        Reassignment history
        <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
          {trail.length} transfer{trail.length !== 1 ? "s" : ""}
        </span>
      </div>
      <ol className="mt-2 space-y-2">
        {trail.map((t) => (
          <li key={t.id} className="rounded-lg bg-white/80 px-2.5 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                #{t.seq}
              </span>
              <span>{t.fromName}</span>
              <ArrowUpRight className="h-3 w-3 rotate-45 text-indigo-500" />
              <span className="text-indigo-700">{t.toName}</span>
            </div>
            <div className="mt-0.5 text-slate-500">
              {t.rnrDays != null && <>Stuck in RNR {t.rnrDays}d · </>}
              {fmtDateTime(t.createdAt)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
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

// Unified search across name, phone number, email, customer_id and
// customer_unique_id. Phone is matched digits-only so spaces/+91 still match.
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

function bucketRank(q) {
  if (q.done) return 4;
  return { overdue: 0, today: 1, upcoming: 2, none: 3 }[q.bucket] ?? 3;
}

// Warehouse-share email status (sent / delivered / viewed / clicked) under the button.
function WarehouseStatus({ wh }) {
  const status = wh?.warehouseStatus;
  const info = status ? emailStatusInfo(status) : null;
  if (!info) return null;
  const tones = {
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    cyan: "text-cyan-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    slate: "text-slate-500",
  };
  return (
    <div
      title={wh.warehouseAt ? `Warehouse mail ${info.label} · ${wh.warehouseAt}` : `Warehouse mail ${info.label}`}
      className={`flex items-center gap-1 text-[10px] font-semibold ${tones[info.tone] || tones.slate}`}
    >
      <Warehouse className="h-3 w-3" /> {info.label}
    </div>
  );
}

// WhatsApp (RNR follow-up) read status — Seen + last-seen time, from Interakt.
function WhatsappStatus({ wa }) {
  if (!wa) return <span className="text-xs text-slate-300">—</span>;
  const seen = wa.seen;
  const label = seen ? "Seen" : wa.status === "delivered" ? "Delivered" : "Sent";
  const tone = seen
    ? "bg-emerald-50 text-emerald-700"
    : wa.status === "delivered"
    ? "bg-sky-50 text-sky-700"
    : "bg-slate-100 text-slate-600";
  return (
    <div>
      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
        <MessageCircle className="h-3 w-3" /> {label}
      </span>
      {seen && wa.lastSeen && <div className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(wa.lastSeen)}</div>}
    </div>
  );
}

// Quotation-email delivery status (latest quote per customer) from Resend tracking.
// Merges the stored last_status with the engagement signals (opens/clicks) so a
// recorded click shows "Clicked" even when last_status still lags at "opened".
function EmailBadge({ email, signals }) {
  const info = emailStatusInfo(mergedEmailStatus(email, signals));
  if (!info) return <span className="text-xs text-slate-300">—</span>;
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
  };
  const Icon = info.viewed ? MailOpen : Mail;
  const when = email.lastEventAt || email.sentAt;
  return (
    <span
      title={`${info.label}${when ? ` · ${when}` : ""}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${tones[info.tone] || tones.slate}`}
    >
      <Icon className="h-3 w-3" /> {info.label}
    </span>
  );
}

// Per-stage colours, shared by the mini (row) and full (drawer) lifecycle.
const STAGE_TONES = {
  slate:   { dot: "bg-slate-400",   ring: "ring-slate-200",   line: "bg-slate-300",   text: "text-slate-600" },
  sky:     { dot: "bg-sky-500",     ring: "ring-sky-200",     line: "bg-sky-400",     text: "text-sky-700" },
  cyan:    { dot: "bg-cyan-500",    ring: "ring-cyan-200",    line: "bg-cyan-400",    text: "text-cyan-700" },
  indigo:  { dot: "bg-indigo-500",  ring: "ring-indigo-200",  line: "bg-indigo-400",  text: "text-indigo-700" },
  amber:   { dot: "bg-amber-500",   ring: "ring-amber-200",   line: "bg-amber-400",   text: "text-amber-700" },
  violet:  { dot: "bg-violet-500",  ring: "ring-violet-200",  line: "bg-violet-400",  text: "text-violet-700" },
  emerald: { dot: "bg-emerald-500", ring: "ring-emerald-200", line: "bg-emerald-400", text: "text-emerald-700" },
};
const toneOf = (key) => STAGE_TONES[key] || STAGE_TONES.emerald;

// Compact horizontal lifecycle (7 dots + connectors) shown inside each row.
function MiniLifecycle({ life }) {
  const { steps, furthest, total } = life;
  const tip = `Step ${furthest + 1} of ${total} — ${steps[furthest]?.label}`;
  return (
    <div className="mt-1 flex items-center" title={tip}>
      {steps.map((s, i) => {
        const isCurrent = i === furthest;
        const isDone = s.done && i < furthest;
        const t = toneOf(s.tone);
        return (
          <span key={s.key} className="flex items-center">
            <span
              className={`block h-2 w-2 rounded-full ${
                isCurrent ? `${t.dot} ring-2 ${t.ring}` : isDone ? t.dot : "bg-slate-200"
              }`}
            />
            {i < steps.length - 1 && (
              <span className={`h-0.5 w-3 ${i < furthest ? toneOf(s.tone).line : "bg-slate-200"}`} />
            )}
          </span>
        );
      })}
    </div>
  );
}

// Horizontal customer lifecycle stepper for the drawer (funnel of milestones).
function LifecycleStepper({ lifecycle, showLegend = true, wh }) {
  const { steps, furthest, total } = lifecycle;
  const current = steps[furthest];
  const whInfo = wh?.warehouseStatus ? emailStatusInfo(wh.warehouseStatus) : null;
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold uppercase tracking-wide text-orange-600">Lifecycle</span>
          <span className="text-sm text-slate-500">
            Step {furthest + 1} of {total} — <span className="font-semibold text-slate-700">{current?.label}</span>
          </span>
        </div>
        <span className="text-sm font-bold text-slate-400">{furthest + 1}/{total}</span>
      </div>

      <div className="flex items-start">
        {steps.map((s, i) => {
          const isCurrent = i === furthest;
          const isDone = s.done && i < furthest;
          const last = i === steps.length - 1;
          const t = toneOf(s.tone);
          // a segment is "reached" once we've progressed past its left node
          const leftReached = i <= furthest;
          const rightReached = i < furthest;
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center">
              {/* node row: left connector · node · right connector */}
              <div className="flex w-full items-center">
                <span
                  className={`h-1 flex-1 rounded-full ${i === 0 ? "opacity-0" : leftReached ? toneOf(steps[i - 1].tone).line : "bg-slate-200"}`}
                />
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${
                    isCurrent ? `${t.dot} ring-4 ${t.ring}` : isDone ? t.dot : "bg-white text-slate-300 ring-2 ring-slate-200"
                  }`}
                >
                  {isDone ? "✓" : isCurrent ? "●" : ""}
                </span>
                <span
                  className={`h-1 flex-1 rounded-full ${last ? "opacity-0" : rightReached ? t.line : "bg-slate-200"}`}
                />
              </div>
              {/* label + sublabel under the node */}
              <div className="mt-2.5 px-1 text-center">
                <div
                  className={`text-xs leading-tight ${
                    isCurrent ? `font-bold ${t.text}` : isDone ? "font-semibold text-slate-700" : "text-slate-400"
                  }`}
                >
                  {s.label}
                </div>
                {s.at && (isDone || isCurrent) && (
                  <div className="mt-1 text-[11px] leading-tight text-slate-400">{fmtDateTime(s.at)}</div>
                )}
                {s.note && (isDone || isCurrent) && (
                  <div className={`mt-1 inline-block rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold ${t.text}`}>
                    {s.note}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {whInfo && (
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
            <Warehouse className="h-3.5 w-3.5 text-indigo-500" />
            Warehouse media shared —
            <span className={whInfo.viewed ? "text-emerald-700" : "text-slate-700"}>{whInfo.label}</span>
            {wh.warehouseAt && <span className="font-normal text-slate-400">· {fmtDateTime(wh.warehouseAt)}</span>}
          </span>
        </div>
      )}

      {showLegend && <LifecycleLegend />}
    </div>
  );
}

// Colour key for the lifecycle stages.
function LifecycleLegend() {
  const items = [
    { label: "Created", tone: "slate" },
    { label: "Sent", tone: "sky" },
    { label: "Delivered", tone: "cyan" },
    { label: "Viewed", tone: "indigo" },
    { label: "OTP", tone: "violet" },
    { label: "Engaged", tone: "amber" },
    { label: "Booked", tone: "emerald" },
  ];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3.5">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className={`h-2.5 w-2.5 rounded-full ${toneOf(it.tone).dot}`} /> {it.label}
        </span>
      ))}
    </div>
  );
}

// Full booking-probability breakdown for the drawer — each signal + its points.
function BookingBreakdown({ booking }) {
  const { score, parts } = booking;
  const ring =
    score >= 60 ? "text-emerald-600" : score >= 30 ? "text-amber-600" : "text-slate-500";
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-800">Booking probability</div>
        <div className={`text-lg font-extrabold tabular-nums ${ring}`}>{score}%</div>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${score >= 60 ? "bg-emerald-500" : score >= 30 ? "bg-amber-400" : "bg-slate-300"}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between text-xs">
            <span className={`flex items-center gap-1.5 ${p.on ? "font-semibold text-slate-700" : "text-slate-400"}`}>
              <span
                className={`inline-block h-2 w-2 rounded-full ${p.on ? "bg-emerald-500" : "bg-slate-200"}`}
              />
              {p.label}
            </span>
            <span className={`tabular-nums ${p.on ? "font-bold text-emerald-700" : "text-slate-300"}`}>
              +{p.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Booking-probability score (0–100) from engagement signals, drivers on hover.
function BookingCell({ booking }) {
  if (!booking) return <span className="text-xs text-slate-400">—</span>;
  const { score, parts } = booking;
  const bar = score >= 60 ? "bg-emerald-500" : score >= 30 ? "bg-amber-400" : "bg-slate-300";
  const text = score >= 60 ? "text-emerald-700" : score >= 30 ? "text-amber-700" : "text-slate-500";
  const on = parts.filter((p) => p.on);
  const tip = on.length ? on.map((p) => `${p.label} +${p.points}`).join(" · ") : "No engagement signals yet";
  return (
    <div className="min-w-[120px]" title={tip}>
      <div className={`text-3xl font-extrabold leading-none tabular-nums ${text}`}>{score}%</div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// Win-probability bar + %, with the score's drivers on hover.
function WinCell({ score }) {
  if (!score) return <span className="text-xs text-slate-400">—</span>;
  const bar =
    score.band === "hot" ? "bg-emerald-500" : score.band === "warm" ? "bg-amber-400" : "bg-slate-300";
  const text =
    score.band === "hot" ? "text-emerald-700" : score.band === "warm" ? "text-amber-700" : "text-slate-500";
  return (
    <div className="min-w-[70px]" title={score.reasons?.length ? `Why: ${score.reasons.join(" · ")}` : ""}>
      <div className={`text-xs font-bold tabular-nums ${text}`}>{score.score}%</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score.score}%` }} />
      </div>
    </div>
  );
}

// Next-best-action chip — clickable (call / WhatsApp / open quote builder).
const NBA_ICONS = { call: Phone, whatsapp: MessageCircle, discount: Percent, resend: Send, followup: Clock };
const NBA_TONES = {
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
  rose: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  green: "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
  violet: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
  amber: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  slate: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
};
function NbaChip({ nba }) {
  if (!nba) return <span className="text-xs text-slate-300">—</span>;
  const Icon = NBA_ICONS[nba.kind] || Zap;
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${NBA_TONES[nba.tone] || NBA_TONES.slate}`;
  const inner = (
    <>
      <Icon className="h-3 w-3" /> {nba.label}
    </>
  );
  if (!nba.href) return <span className={cls}>{inner}</span>;
  const internal = nba.href.startsWith("/");
  return (
    <a
      href={nba.href}
      onClick={(e) => e.stopPropagation()}
      {...(internal ? {} : { target: "_blank", rel: "noreferrer" })}
      className={cls}
    >
      {inner}
    </a>
  );
}

function priorityOf(q) {
  if (q.won) return { label: "Won", cls: "bg-emerald-50 text-emerald-700" };
  if (q.lost) return { label: "Lost", cls: "bg-slate-100 text-slate-500" };
  if (q.bucket === "overdue" || /negoti/i.test(q.stage)) return { label: "High", cls: "bg-rose-50 text-rose-600" };
  if (q.bucket === "today" || /quot/i.test(q.stage)) return { label: "Medium", cls: "bg-amber-50 text-amber-600" };
  return { label: "Low", cls: "bg-slate-100 text-slate-500" };
}

function stageBadge(stage) {
  const s = String(stage || "").toLowerCase();
  if (!stage) return { label: "—", cls: "bg-slate-100 text-slate-500" };
  if (/negoti/.test(s)) return { label: stage, cls: "bg-amber-50 text-amber-700" };
  if (/won|book/.test(s)) return { label: stage, cls: "bg-emerald-50 text-emerald-700" };
  if (/lost|invalid/.test(s)) return { label: stage, cls: "bg-slate-100 text-slate-500" };
  if (/quot/.test(s)) return { label: stage, cls: "bg-indigo-50 text-indigo-700" };
  if (/new/.test(s)) return { label: stage, cls: "bg-sky-50 text-sky-700" };
  return { label: stage, cls: "bg-slate-100 text-slate-600" };
}

function fmtDate(ymd) {
  if (!ymd) return "—";
  const [, m, d] = ymd.split("-");
  return `${+d} ${MONTHS[+m - 1]}`;
}

// "₹1,23,456" (Indian grouping), or "—" for zero/empty.
function fmtMoney(v) {
  const n = Number(v);
  if (!n) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
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

function fmtDateTime(dt) {
  if (!dt) return "—";
  const [date, time] = String(dt).split(" ");
  const hm = (time || "").slice(0, 5);
  return hm ? `${fmtDate(date)} · ${hm}` : fmtDate(date);
}

function Th({ children, className = "" }) {
  return <th className={`px-3 py-2.5 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name, large }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const size = large ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700`}>
      {initials}
    </span>
  );
}

function IconBtn({ href, title, external, tone, onClick, children }) {
  const tones = {
    call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100",
    whatsapp: "border-green-200 bg-green-50 text-green-600 hover:border-green-300 hover:bg-green-100",
    view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100",
  };
  const cls = tones[tone] || "border-slate-200 text-slate-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600";
  const className = `flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${cls}`;

  // Render a real button for in-app actions (no navigation target).
  if (!href) {
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        className={className}
      >
        {children}
      </button>
    );
  }

  return (
    <a
      href={appHref(href)}
      title={title}
      onClick={(e) => e.stopPropagation()}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={className}
    >
      {children}
    </a>
  );
}

function EscBadge({ level, label }) {
  const cls = level === "L3" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      <ShieldAlert className="h-3 w-3" />
      {label}
    </span>
  );
}

function prettyFollowUp(s) {
  return String(s)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/gi, "RNR")
    .replace(/\bOtp\b/gi, "OTP");
}

function CityChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function DensityBtn({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-semibold transition-colors ${
        on ? "bg-indigo-50 text-indigo-600" : "bg-white text-slate-500 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function PagerBtn({ disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function DRow({ k, v }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="font-semibold capitalize text-slate-800">{v}</span>
    </div>
  );
}
