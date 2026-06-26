"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX, Loader2, RefreshCw, Search, Zap } from "lucide-react";
import { getSession } from "@/lib/auth";
import {
  fetchQuotations,
  fetchQuoteEmailStatus,
  fetchOtpVerifiedIds,
  fetchBookingSignals,
  fetchWhatsappStatus,
  bookingScore,
  customerLifecycle,
} from "@/lib/crm";
import { evaluateEscalation } from "@/lib/escalations";
import { scoreQuote } from "@/lib/scoring";
import QuoteCard from "@/components/QuoteCard";

// Customers created yesterday & today that have NOT been followed up yet (blank
// or un-actioned follow-up) — the fresh ones that need first contact.

function ymdOffset(days = 0) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TABS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
];

export default function BlankFollowupsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("booking");
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
        if (e?.name !== "AbortError") setError("Couldn't load. Please refresh.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const today = ymdOffset(0);
  const yesterday = ymdOffset(-1);

  // Created yesterday/today AND blank / not followed up.
  const fresh = useMemo(() => {
    if (!list) return [];
    return list
      .filter((q) => {
        const d = String(q.createdAt || "").slice(0, 10);
        if (d !== today && d !== yesterday) return false;
        return !q.contacted || !q.status || q.statusKey === "none";
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [list, today, yesterday]);

  const counts = useMemo(() => {
    const c = { all: fresh.length, today: 0, yesterday: 0 };
    for (const q of fresh) (String(q.createdAt).slice(0, 10) === today ? (c.today++) : (c.yesterday++));
    return c;
  }, [fresh, today]);

  const rows = useMemo(() => {
    let r = fresh;
    const s = query.trim().toLowerCase();
    if (s) {
      // Search spans all tabs (name, phone, email, customer_id, unique id).
      const digits = s.replace(/\D/g, "");
      r = r.filter(
        (q) =>
          (q.name || "").toLowerCase().includes(s) ||
          (q.contact || "").includes(s) ||
          (q.email || "").toLowerCase().includes(s) ||
          String(q.id || "").includes(s) ||
          String(q.uid || "").toLowerCase().includes(s) ||
          (!!digits && String(q.contact || "").replace(/\D/g, "").includes(digits))
      );
    } else if (tab === "today") {
      r = r.filter((q) => String(q.createdAt).slice(0, 10) === today);
    } else if (tab === "yesterday") {
      r = r.filter((q) => String(q.createdAt).slice(0, 10) === yesterday);
    }
    return r;
  }, [fresh, tab, query, today, yesterday]);

  // Escalation evaluation per quote (keyed by customer_id) — mirrors /quotations.
  const escMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) => m.set(String(q.id), evaluateEscalation(q)));
    return m;
  }, [list]);

  // Win-probability score per quote (uses the escalation result as a signal).
  const scoreMap = useMemo(() => {
    const m = new Map();
    (list || []).forEach((q) => m.set(String(q.id), scoreQuote(q, escMap.get(String(q.id)))));
    return m;
  }, [list, escMap]);

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

  // Apply the selected sort to the already-filtered rows (same comparators as /quotations).
  const quoteRows = useMemo(() => {
    const arr = [...rows];
    if (sort === "booking") {
      return arr.sort(
        (a, b) =>
          (bookingMap.get(String(b.id))?.score || 0) - (bookingMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    if (sort === "score") {
      return arr.sort(
        (a, b) =>
          (scoreMap.get(String(b.id))?.score || 0) - (scoreMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
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
          rank(a) - rank(b) ||
          (bookingMap.get(String(b.id))?.score || 0) - (bookingMap.get(String(a.id))?.score || 0) ||
          Number(b.id) - Number(a.id)
      );
    }
    return arr.sort(sorters[sort]);
  }, [rows, sort, bookingMap, scoreMap, otpIds, emailStatus]);

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
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-white shadow-sm">
              <CalendarX className="h-5 w-5" />
            </span>
            Blank follow-ups
          </h1>
          <p className="mt-1 text-sm text-slate-500">Customers created yesterday &amp; today with no follow-up yet — call these first.</p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition-colors ${
                  active ? "bg-rose-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                  {counts[t.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        <div className="relative min-w-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-rose-400 focus:outline-none"
          />
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

      {/* cards — same rich design + data as /quotations */}
      <div className="mt-4 space-y-3">
        {!list && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-rose-500" />
          </div>
        )}
        {list && quoteRows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
            All caught up — every new customer has been followed up. 🎉
          </div>
        )}
        {(list ? quoteRows : []).map((q) => (
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
          />
        ))}
      </div>
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
