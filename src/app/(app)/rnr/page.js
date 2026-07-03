"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PhoneOff,
  Loader2,
  RefreshCw,
  Clock,
  Users,
  Radio,
  Hash,
  Percent,
  MapPin,
  CalendarClock,
  ArrowLeftRight,
  Repeat,
  Zap,
} from "lucide-react";
import {
  fetchQuotations,
  fetchTeamQuotations,
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
import QuoteCard from "@/components/QuoteCard";
import QuoteTable from "@/components/QuoteTable";
import QuickFollowUpModal from "@/components/QuickFollowUpModal";
import AdminOnly from "@/components/AdminOnly";

// A customer dialled this many times with no connect is eligible for the
// attempts-based RNR shuffle (the backend sweep should move them to a fresh
// rep). "More than 1 attempt" → 2+.
const REASSIGN_MIN_ATTEMPTS = 2;

// Only shuffle fresh leads: the customer must have been created within the last
// N days (by customer created_at). Older RNR is left where it is.
const SHUFFLE_WINDOW_DAYS = 4;

// True when an RNR row qualifies for the shuffle: dialled enough times AND the
// customer was created inside the shuffle window.
function isShuffleCandidate(r) {
  return r.attempts >= REASSIGN_MIN_ATTEMPTS && r.createdDaysAgo != null && r.createdDaysAgo <= SHUFFLE_WINDOW_DAYS;
}

// RNR = "Ring, No Response". A quote sits in RNR when the team dials and nobody
// picks up. This screen slices the live RNR pile four ways — by hour dialled,
// lead source, agent and the actual number dialled — so the reason RNR is high
// stops being a guess.

export default function RnrAnalyticsPage() {
  return (
    <AdminOnly>
      <RnrAnalyticsPageInner />
    </AdminOnly>
  );
}

function RnrAnalyticsPageInner() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("team"); // "team" | "mine"
  const [city, setCity] = useState("");
  const [tableView, setTableView] = useState(true); // cards | table — default to table
  const [sort, setSort] = useState("booking");
  // Engagement maps (same sources as /quotations) — power the rich card badges.
  const [emailStatus, setEmailStatus] = useState({});
  const [otpIds, setOtpIds] = useState(() => new Set());
  const [bookingSignals, setBookingSignals] = useState({});
  const [waStatus, setWaStatus] = useState({});
  const [followUpFor, setFollowUpFor] = useState(null); // quote whose follow-up is being edited

  const load = useCallback(
    (signal) => {
      const s = getSession();
      if (!s) return Promise.resolve();
      setLoading(true);
      fetchQuoteEmailStatus({ signal }).then(setEmailStatus).catch(() => {});
      fetchOtpVerifiedIds({ signal }).then(setOtpIds).catch(() => {});
      fetchBookingSignals({ signal }).then(setBookingSignals).catch(() => {});
      fetchWhatsappStatus({ signal }).then(setWaStatus).catch(() => {});
      const fetcher = scope === "mine" ? fetchQuotations(s.user_id, { signal }) : fetchTeamQuotations({ signal });
      return fetcher
        .then((d) => {
          setList(d);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load RNR analytics. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [scope]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setList(null);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Every RNR quote, enriched with the fields each breakdown needs.
  const rnr = useMemo(() => {
    if (!list) return [];
    return list
      .filter((q) => q.statusKey === "rnr")
      .filter((q) => !city || q.city === city)
      .map((q) => {
        const dialledAt = q.lastContactAt || q.rnrSince || null;
        return {
          ...q,
          attempts: rnrCount(q.noteFull || q.note),
          ageDays: q.rnrSince ? daysSince(q.rnrSince) : null,
          createdDaysAgo: daysSince(q.createdAt),
          dialledAt,
          dialDate: dateOf(dialledAt),
          hour: hourOf(dialledAt),
        };
      });
  }, [list, city]);

  const cities = useMemo(
    () => [...new Set((list || []).filter((q) => q.statusKey === "rnr").map((q) => q.city).filter(Boolean))].sort(),
    [list]
  );

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const total = rnr.length;
    const open = (list || []).filter((q) => !q.done).length;
    const totalAttempts = rnr.reduce((s, r) => s + r.attempts, 0);
    const candidates = rnr.filter(isShuffleCandidate).length;
    const loops = rnr.filter((r) => r.attempts >= 3).length;
    return {
      total,
      pctOpen: open ? Math.round((total / open) * 100) : 0,
      candidates,
      loops,
      avgAttempts: total ? totalAttempts / total : null,
    };
  }, [rnr, list]);

  // ---- Breakdowns ----
  const byHour = useMemo(() => {
    const counts = Array(24).fill(0);
    for (const r of rnr) if (r.hour != null) counts[r.hour]++;
    return counts;
  }, [rnr]);

  // Date × hour grid → answers "which date, at which hour". Only RNR rows that
  // carry a logged dial time (follow_up_start_time, else rnr_since) appear here.
  const byDateHour = useMemo(() => {
    const map = new Map(); // date -> { total, hours: number[24] }
    let timed = 0;
    for (const r of rnr) {
      if (!r.dialDate || r.hour == null) continue;
      timed++;
      let row = map.get(r.dialDate);
      if (!row) {
        row = { date: r.dialDate, total: 0, hours: Array(24).fill(0) };
        map.set(r.dialDate, row);
      }
      row.hours[r.hour]++;
      row.total++;
    }
    const dates = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
    let peak = null; // {date, hour, count}
    for (const row of dates) {
      for (let h = 0; h < 24; h++) {
        if (row.hours[h] > 0 && (!peak || row.hours[h] > peak.count)) peak = { date: row.date, hour: h, count: row.hours[h] };
      }
    }
    return { dates, peak, timed, untimed: rnr.length - timed };
  }, [rnr]);

  const bySource = useMemo(() => tally(rnr, (r) => r.source || "Unknown"), [rnr]);
  const byAgent = useMemo(() => tally(rnr, (r) => r.rep || "Unassigned"), [rnr]);

  // Shuffle candidates: dialled 2+ times, still no connect, and created within
  // the last SHUFFLE_WINDOW_DAYS → reassign to a fresh rep. Worst offenders first.
  const candidates = useMemo(
    () => [...rnr].filter(isShuffleCandidate).sort((a, b) => b.attempts - a.attempts),
    [rnr]
  );

  // Per-quote maps for the rich cards (keyed by customer_id) — mirrors /quotations.
  const escMap = useMemo(() => {
    const m = new Map();
    candidates.forEach((q) => m.set(String(q.id), evaluateEscalation(q)));
    return m;
  }, [candidates]);

  const scoreMap = useMemo(() => {
    const m = new Map();
    candidates.forEach((q) => m.set(String(q.id), scoreQuote(q, escMap.get(String(q.id)))));
    return m;
  }, [candidates, escMap]);

  const bookingMap = useMemo(() => {
    const m = new Map();
    candidates.forEach((q) =>
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
  }, [candidates, otpIds, bookingSignals, emailStatus, waStatus]);

  const lifecycleMap = useMemo(() => {
    const m = new Map();
    candidates.forEach((q) =>
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
  }, [candidates, otpIds, bookingSignals, emailStatus]);

  // Re-order the shuffle candidates by the selected sort (same comparators as
  // /quotations). Default "booking" surfaces the most likely bookings first;
  // the attempts badge on each card preserves the shuffle priority signal.
  const candidateCards = useMemo(() => {
    const arr = [...candidates];
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
    if (sort === "attempts") return arr.sort((a, b) => b.attempts - a.attempts);
    return arr.sort(sorters[sort] || (() => 0));
  }, [candidates, sort, bookingMap, scoreMap, otpIds, emailStatus]);

  const engStats = useMemo(() => {
    let sent = 0, delivered = 0, opened = 0, clicked = 0, otpv = 0, whSent = 0, whViewed = 0;
    for (const q of candidateCards) {
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
  }, [candidateCards, emailStatus, bookingSignals, otpIds]);

  // Distribution of RNR attempts — visualises the shuffle threshold.
  const byAttempts = useMemo(() => {
    const b = { one: 0, two: 0, three: 0, four: 0 };
    for (const r of rnr) {
      const a = r.attempts;
      if (a <= 1) b.one++;
      else if (a === 2) b.two++;
      else if (a === 3) b.three++;
      else b.four++;
    }
    return [
      { label: "1 attempt", value: b.one },
      { label: "2 attempts", value: b.two },
      { label: "3 attempts", value: b.three },
      { label: "4+ attempts", value: b.four },
    ];
  }, [rnr]);

  // ---- Insights (the "finally know why" payoff) ----
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakCount = byHour[peakHour] || 0;
  const hourInsight =
    rnr.length === 0
      ? "No RNR to slice yet."
      : peakCount === 0
      ? "No call-time data on these RNR rows."
      : `Peak at ${fmtHour(peakHour)} — ${peakCount} unanswered (${pct(peakCount, rnr.length)} of RNR).`;
  const sourceInsight =
    bySource.length > 0 && bySource[0].value > 0
      ? `${bySource[0].label} drives ${pct(bySource[0].value, rnr.length)} of RNR.`
      : "—";
  const agentInsight =
    byAgent.length > 0 && byAgent[0].value > 0 ? `${byAgent[0].label} holds the most — ${byAgent[0].value}.` : "—";

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mt-1 text-sm text-slate-500">Why is RNR high — by hour, source, agent and attempts — and who to reassign.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            {[
              { key: "team", label: "Team" },
              { key: "mine", label: "Mine" },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                className={`px-3 py-2 text-sm font-semibold transition-colors ${
                  scope === s.key ? "bg-rose-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s.label}
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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="In RNR" value={kpis.total} icon={PhoneOff} tone="rose" />
        <Kpi label="of open pipeline" value={`${kpis.pctOpen}%`} icon={Percent} tone="amber" />
        <Kpi label="To reassign · 2+ tries" value={kpis.candidates} icon={ArrowLeftRight} tone="rose" />
        <Kpi label="Chronic · 3+ tries" value={kpis.loops} icon={Hash} tone="amber" />
        <Kpi label="Avg attempts" value={kpis.avgAttempts == null ? "—" : kpis.avgAttempts.toFixed(1)} icon={Repeat} tone="slate" />
      </div>

      {/* filter */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterSelect icon={MapPin} value={city} onChange={setCity}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button onClick={() => setTableView(false)} className={`px-3 py-2 text-xs font-semibold transition-colors ${!tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Cards</button>
          <button onClick={() => setTableView(true)} className={`px-3 py-2 text-xs font-semibold transition-colors ${tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Table</button>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-rose-500" />}
        <span className="flex-1" />
        <span className="text-xs text-slate-400">
          {list == null ? "Loading…" : `${rnr.length.toLocaleString("en-IN")} RNR ${scope === "mine" ? "(yours)" : "(team)"}`}
        </span>
      </div>

      {!list ? (
        <div className="mt-4 grid gap-4">
          <SkeletonPanel h="h-40" />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonPanel h="h-56" />
            <SkeletonPanel h="h-56" />
          </div>
        </div>
      ) : rnr.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400 shadow-sm">
          No quotes are sitting in RNR right now. 🎉
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {/* Engagement stat tiles (emails, OTP, warehouse) */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <StatTile label="Emails sent" value={engStats.sent} tone="slate" />
            <StatTile label="Delivered" value={engStats.delivered} tone="sky" />
            <StatTile label="Opened" value={engStats.opened} tone="indigo" />
            <StatTile label="Clicked" value={engStats.clicked} tone="emerald" />
            <StatTile label="OTP verified" value={engStats.otpv} tone="emerald" />
            <StatTile label="Warehouse sent" value={engStats.whSent} tone="violet" />
            <StatTile label="Warehouse viewed" value={engStats.whViewed} tone="emerald" />
          </div>

          {/* Shuffle candidates — the actionable list */}
          <Panel
            title={`Shuffle candidates · ${kpis.candidates} to reassign`}
            icon={ArrowLeftRight}
            insight={`Dialled ${REASSIGN_MIN_ATTEMPTS}+ times with no connect, created in the last ${SHUFFLE_WINDOW_DAYS} days → hand to a fresh rep. Attempts are counted from the RNR note trail. The backend sweep performs the actual move (see note).`}
          >
            <div className="mb-3 flex items-center justify-end">
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
                  <option value="attempts">RNR attempts</option>
                  <option value="priority">Priority bucket</option>
                  <option value="value">Value (high → low)</option>
                  <option value="newest">Newest</option>
                  <option value="followup">Follow-up date</option>
                  <option value="id">Quote ID</option>
                </select>
              </label>
            </div>
            <CandidateCards
              rows={candidateCards}
              escMap={escMap}
              bookingMap={bookingMap}
              lifecycleMap={lifecycleMap}
              emailStatus={emailStatus}
              otpIds={otpIds}
              bookingSignals={bookingSignals}
              waStatus={waStatus}
              onQuickFollowUp={setFollowUpFor}
              tableView={tableView}
            />
          </Panel>

          {/* By hour (aggregate across all days) */}
          <Panel title="By hour dialled — all days" icon={Clock} insight={hourInsight}>
            <HourHistogram counts={byHour} />
          </Panel>

          {/* By date × hour */}
          <Panel
            title="By date × hour"
            icon={CalendarClock}
            insight={
              byDateHour.dates.length === 0
                ? "No RNR rows carry a logged dial time yet."
                : byDateHour.peak
                ? `Worst slot: ${fmtDay(byDateHour.peak.date)} at ${fmtHour(byDateHour.peak.hour)} — ${byDateHour.peak.count} RNR. Based on last-dial time of ${byDateHour.timed} timed rows${
                    byDateHour.untimed ? `; ${byDateHour.untimed} have no call time logged` : ""
                  }.`
                : "—"
            }
          >
            <DateHourHeatmap data={byDateHour} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* By source */}
            <Panel
              title="By source"
              icon={Radio}
              insight={`${sourceInsight} Source = Google Ad when a gclid is present, else the quote's updated_from channel.`}
            >
              <BarList rows={bySource} total={rnr.length} />
            </Panel>

            {/* By agent */}
            <Panel title="By agent" icon={Users} insight={agentInsight}>
              <BarList rows={byAgent} total={rnr.length} />
            </Panel>
          </div>

          {/* By RNR attempts (distribution) */}
          <Panel
            title="By RNR attempts"
            icon={Repeat}
            insight={`${kpis.candidates} of ${rnr.length} RNR (${pct(kpis.candidates, rnr.length)}) were dialled ${REASSIGN_MIN_ATTEMPTS}+ times and created in the last ${SHUFFLE_WINDOW_DAYS} days — the reassignment pool.`}
          >
            <BarList rows={byAttempts} total={rnr.length} />
          </Panel>
        </div>
      )}

      {followUpFor && (
        <QuickFollowUpModal
          entity="customer"
          id={followUpFor.id}
          name={followUpFor.name}
          subtitle={followUpFor.uid || `ID ${followUpFor.id}`}
          follow_up={followUpFor.status}
          follow_up_date={followUpFor.followDate}
          follow_up_note={followUpFor.noteFull}
          onClose={() => setFollowUpFor(null)}
          onSaved={() => {
            setFollowUpFor(null);
            load();
          }}
        />
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
      <div className="flex min-w-[640px] items-end gap-1">
        {counts.map((c, h) => {
          const isPeak = hasData && h === peak && c > 0;
          return (
            <div key={h} className="flex flex-1 flex-col items-center gap-1.5">
              <span className={`text-[10px] font-bold tabular-nums ${c > 0 ? "text-slate-500" : "text-transparent"}`}>{c || 0}</span>
              <div className="flex h-28 w-full items-end" title={`${c} RNR around ${fmtHour(h)}`}>
                <div
                  className={`w-full rounded-t transition-all ${isPeak ? "bg-rose-500" : c > 0 ? "bg-indigo-500" : "bg-slate-100"}`}
                  style={{ height: `${Math.max((c / max) * 100, c > 0 ? 6 : 3)}%` }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-slate-400">{h % 3 === 0 ? h : ""}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-400">Hour of day (24h)</p>
    </div>
  );
}

/* ----------------------------- Date × hour heatmap ----------------------------- */
// Only the hours we ever operate in keep the grid readable (7 AM–10 PM). Counts
// outside that window still surface in the "all days" histogram above.
const HEAT_HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7..22
const HEAT_ROWS = 14; // cap rows so a long pile stays scannable

function DateHourHeatmap({ data }) {
  if (!data.dates || data.dates.length === 0)
    return <p className="py-6 text-center text-xs text-slate-400">No dial-time data to plot.</p>;
  const rows = data.dates.slice(0, HEAT_ROWS);
  const max = data.peak ? data.peak.count : 1;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Date
            </th>
            {HEAT_HOURS.map((h) => (
              <th key={h} className="w-7 text-center text-[9px] font-semibold tabular-nums text-slate-400">
                {fmtHourShort(h)}
              </th>
            ))}
            <th className="px-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 text-[11px] font-semibold text-slate-600">
                {fmtDay(row.date)}
              </td>
              {HEAT_HOURS.map((h) => {
                const v = row.hours[h];
                const isPeak = data.peak && data.peak.date === row.date && data.peak.hour === h;
                return (
                  <td key={h} className="p-0">
                    <div
                      title={`${v} RNR · ${fmtDay(row.date)} ${fmtHour(h)}`}
                      className={`mx-auto flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold ${heatColor(v, max)} ${
                        isPeak ? "ring-2 ring-rose-600" : ""
                      }`}
                    >
                      {v || ""}
                    </div>
                  </td>
                );
              })}
              <td className="px-2 text-right text-[11px] font-bold tabular-nums text-slate-700">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.dates.length > HEAT_ROWS && (
        <p className="mt-2 text-[11px] text-slate-400">
          Showing the {HEAT_ROWS} most recent of {data.dates.length} dates.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
        <span>Fewer</span>
        <span className="h-3 w-3 rounded bg-slate-100" />
        <span className="h-3 w-3 rounded bg-indigo-200" />
        <span className="h-3 w-3 rounded bg-rose-300" />
        <span className="h-3 w-3 rounded bg-rose-500" />
        <span>More · hours 7 AM–10 PM</span>
      </div>
    </div>
  );
}

function heatColor(v, max) {
  if (!v) return "bg-slate-100 text-transparent";
  const r = v / max;
  if (r > 0.66) return "bg-rose-500 text-white";
  if (r > 0.33) return "bg-rose-300 text-rose-900";
  return "bg-indigo-200 text-indigo-800";
}

/* ----------------------------- Bar list ----------------------------- */
function BarList({ rows, total }) {
  if (!rows || rows.length === 0) return <p className="py-6 text-center text-xs text-slate-400">No data.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.slice(0, 8).map((r, i) => {
        const w = Math.round((r.value / max) * 100);
        return (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs font-medium text-slate-600" title={r.label}>
              {r.label}
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div className={`h-full rounded-md ${i === 0 ? "bg-rose-400" : "bg-indigo-500"}`} style={{ width: `${Math.max(w, 3)}%` }} />
            </div>
            <div className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-600">
              {r.value} <span className="text-slate-400">· {pct(r.value, total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- Candidate cards ----------------------------- */
const CANDIDATE_CAP = 50;

// Same rich card as /quotations, one per shuffle candidate. Attempts/RNR signals
// surface via the card's RNR badge + note; the card itself carries booking %,
// lifecycle, OTP, email/WhatsApp status and the next-best-action.
function CandidateCards({ rows, escMap, bookingMap, lifecycleMap, emailStatus, otpIds, bookingSignals, waStatus, onQuickFollowUp, tableView }) {
  if (!rows || rows.length === 0)
    return <p className="py-6 text-center text-xs text-slate-400">No RNR customer has hit the attempt threshold. 🎉</p>;
  const shown = rows.slice(0, CANDIDATE_CAP);
  if (tableView) {
    return <QuoteTable rows={shown} getBooking={(q) => bookingMap.get(String(q.id))} getLife={(q) => lifecycleMap.get(String(q.id))} onQuickFollowUp={onQuickFollowUp} />;
  }
  return (
    <div className="space-y-3">
      {shown.map((q) => (
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
          onQuickFollowUp={() => onQuickFollowUp?.(q)}
        />
      ))}
      {rows.length > CANDIDATE_CAP && (
        <p className="mt-2 text-[11px] text-slate-400">
          Showing the {CANDIDATE_CAP} highest-attempt of {rows.length.toLocaleString("en-IN")} candidates.
        </p>
      )}
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
function Panel({ title, icon: Icon, insight, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
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
    slate: "bg-slate-100 text-slate-500",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function FilterSelect({ icon: Icon, value, onChange, children }) {
  const active = value !== "";
  return (
    <div className={`relative inline-flex items-center rounded-xl border ${active ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <Icon className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${active ? "text-rose-500" : "text-slate-400"}`} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`max-w-[160px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-3 text-sm focus:outline-none ${
          active ? "font-semibold text-rose-700" : "text-slate-600"
        }`}
      >
        {children}
      </select>
    </div>
  );
}


function SkeletonPanel({ h }) {
  return <div className={`w-full animate-pulse rounded-2xl border border-slate-200 bg-white ${h} shadow-sm`} />;
}

/* ----------------------------- helpers ----------------------------- */
// RNR attempts logged in the note trail (each ring-no-response appends "RNR").
function rnrCount(note) {
  if (!note) return 0;
  return (String(note).match(/rnr/gi) || []).length;
}

function daysSince(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const t = new Date(String(dt).replace(" ", "T")).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 86400000);
}

// Hour-of-day (0–23) from a "YYYY-MM-DD HH:MM:SS" stamp.
function hourOf(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const m = String(dt).match(/[ T](\d{2}):/);
  return m ? Number(m[1]) : null;
}

// Date part (YYYY-MM-DD) from a stamp, or null if absent/zero.
function dateOf(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const m = String(dt).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "14 Jun" — compact day label for the heatmap rows.
function fmtDay(ymd) {
  const [y, m, d] = String(ymd).split("-");
  if (!m || !d) return ymd;
  return `${+d} ${MONTHS[+m - 1]}`;
}

function fmtHour(h) {
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${am ? "AM" : "PM"}`;
}

// "9a" / "6p" — single-char meridiem for tight column headers.
function fmtHourShort(h) {
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${h < 12 ? "a" : "p"}`;
}

function pct(n, total) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// Count items by a key fn → sorted [{label, value}] desc.
function tally(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
