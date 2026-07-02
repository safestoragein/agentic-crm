"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Phone,
  Mail,
  MessageCircle,
  CalendarClock,
  Sparkles,
  Trophy,
  AlertTriangle,
  Target,
  TrendingUp,
  FileText,
  CheckCircle2,
  Loader2,
  RefreshCw,
  PhoneCall,
  Filter,
  BarChart3,
  Zap,
  Percent,
  ArrowRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { fetchCore, fetchLeads, countInRange, dateInRange, rangeForPreset, timeAgoLabel } from "@/lib/crm";
import { runDailyFollowupWhatsapp, fetchFollowupWhatsappStats } from "@/lib/whatsapp";
import { CheckCheck, Eye as EyeIcon, Send as SendIcon, XCircle } from "lucide-react";
import DateFilter from "@/components/DateFilter";

// Daily booking target per rep, the conversion-rate goal, and the speed-to-lead
// threshold — the levers that move bookings toward target.
const DAILY_BOOKING_TARGET = 5; // bookings per rep per day; scales with the range
const CONVERSION_TARGET = 20; // %
const FAST_RESPONSE_MIN = 30; // first response within this many minutes = "fast"

// Number of calendar days covered by a {from,to} range (inclusive), for scaling
// the daily booking target. Today → 1, Last 7 days → 7, This month → days so far.
function rangeDays(from, to) {
  if (!from || !to) return 1;
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (isNaN(a) || isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export default function DashboardPage() {
  const [session, setSession] = useState(null);
  const [core, setCore] = useState(null);
  const [leads, setLeads] = useState(null); // null = still loading
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(() => rangeForPreset("today"));
  const [waStats, setWaStats] = useState(null); // last WhatsApp follow-up sweep result

  const handleRange = useCallback((r) => setRange(r), []);
  const router = useRouter();

  // Admins don't get a personal sales queue — send them to the team dashboard.
  useEffect(() => {
    if (isAdmin(getSession())) router.replace("/admin");
  }, [router]);

  useEffect(() => {
    const s = getSession();
    if (!s) return;
    if (isAdmin(s)) return; // admin is being redirected to /admin
    setSession(s);

    const ctrl = new AbortController();

    // Core (queue, KPIs, rank) is light — refresh it on a timer and on focus so
    // the call queue advances automatically as the team logs calls in the app.
    const loadCore = () =>
      fetchCore(s.user_id, { signal: ctrl.signal })
        .then((d) => {
          setCore(d);
          setError("");
        })
        .catch(() => setError("Couldn't load your data. Please refresh."))
        .finally(() => setLoading(false));

    loadCore();

    // Heavy team-leads payload — loaded once, separately, so it never blocks above.
    fetchLeads(s.user_id, { signal: ctrl.signal })
      .then(setLeads)
      .catch(() => setLeads({ leadDates: [], newLeadsCount: 0, newLeads: [] }));

    // Fire the follow-up WhatsApp sweep once a day per browser (the backend
    // de-dups per customer, so this never spams). Best-effort.
    runDailyFollowupWhatsapp(ctrl.signal);

    // Team-wide WhatsApp delivery stats for today (sent / delivered / read /
    // failed). Refreshed on the timer so webhook-driven read/delivered counts
    // tick up live.
    const loadWaStats = () =>
      fetchFollowupWhatsappStats({ userId: s.user_id, signal: ctrl.signal })
        .then((st) => st && setWaStats(st))
        .catch(() => {});
    loadWaStats();

    const timer = setInterval(() => {
      loadCore();
      loadWaStats();
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadCore();
        loadWaStats();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }, []);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    []
  );

  // KPIs that respond to the date filter (computed from dated detail lists).
  const ranged = useMemo(() => {
    if (!core) return null;
    return {
      quotes: countInRange(core.quoteDates, range.from, range.to),
      bookings: countInRange(core.bookingDates, range.from, range.to),
      leads: leads ? countInRange(leads.leadDates, range.from, range.to) : null,
    };
  }, [core, leads, range]);

  // Funnel uses the SAME "created in this period" basis as the KPI tiles above
  // (leads / quotes / bookings), so the three stages always match the tiles and
  // there's no confusing second "quotes" number. (We deliberately do NOT use the
  // ss_leads.is_converted_to_quot same-day cohort here — it counts only quotes
  // whose lead also arrived in-range, which mismatched the "Quotes sent" tile.)
  const funnel = useMemo(() => {
    if (!core || !leads) return null;
    return {
      leads: countInRange(leads.leadDates, range.from, range.to),
      quotes: countInRange(core.quoteDates, range.from, range.to),
      bookings: countInRange(core.bookingDates, range.from, range.to),
      approx: false,
    };
  }, [core, leads, range]);

  // Booking target (5/day, scaled by the range) + conversion rate, for the range.
  const conv = useMemo(() => {
    if (!funnel) return null;
    const rate = funnel.leads > 0 ? (funnel.bookings / funnel.leads) * 100 : null;
    const days = rangeDays(range.from, range.to);
    const target = DAILY_BOOKING_TARGET * days;
    const need = Math.max(0, target - funnel.bookings);
    const metTarget = funnel.bookings >= target;
    return { rate, target, need, days, metTarget, ...funnel };
  }, [funnel, range]);

  // Speed-to-lead for the selected range: avg first-response + % answered fast.
  const speed = useMemo(() => {
    if (!core?.responseSamples) return null;
    const inRange = core.responseSamples.filter((r) => dateInRange(r.date, range.from, range.to));
    if (!inRange.length) return { count: 0, avg: null, fastPct: null };
    const avg = Math.round(inRange.reduce((s, r) => s + r.mins, 0) / inRange.length);
    const fast = inRange.filter((r) => r.mins <= FAST_RESPONSE_MIN).length;
    return { count: inRange.length, avg, fastPct: Math.round((fast / inRange.length) * 100) };
  }, [core, range]);

  // One-line "where you stand + what to do" headline under the greeting.
  const statusLine = useMemo(() => {
    if (!core || !conv) return null;
    const due = core.followUps.dueToday.length;
    let action;
    if (due > 0) action = `${due} follow-up${due > 1 ? "s" : ""} due today`;
    else action = "all clear — work fresh leads";
    return {
      goal: `${conv.bookings}/${conv.target} bookings`,
      action,
      onTrack: conv.metTarget,
    };
  }, [core, conv]);

  const fname = session?.user_fname || "there";

  return (
    <div className="w-full px-6 py-7 2xl:px-8">
      {/* Greeting + status line + date filter */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}, {fname} <span className="align-middle">👋</span>
          </h1>
          {statusLine ? (
            <p className="mt-1 text-sm text-slate-500">
              <span className={`font-semibold ${statusLine.onTrack ? "text-emerald-600" : "text-slate-700"}`}>
                {statusLine.goal}
              </span>{" "}
              · {statusLine.action}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">{dateLabel}</p>
          )}
        </div>
        <DateFilter onChange={handleRange} />
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        core && (
          <>
            {/* 1 — STAT CARDS */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Kpi icon={Target} label="Leads" value={ranged.leads == null ? "…" : ranged.leads} hint={range.label} tone="neutral" />
              <Kpi icon={FileText} label="Quotes sent" value={ranged.quotes} hint={range.label} tone="good" />
              <Kpi icon={CheckCircle2} label="Bookings" value={ranged.bookings} hint={range.label} tone={ranged.bookings > 0 ? "good" : "warn"} />
              <Kpi
                icon={CalendarClock}
                label="Follow-ups due today"
                value={core.followUps.dueToday.length}
                hint="Due today"
                tone={core.followUps.dueToday.length > 0 ? "warn" : "good"}
              />
              <Kpi
                icon={PhoneCall}
                label="Verified today"
                value={core.verifiedTodayCount}
                hint={`${core.doneTodayCount} logged · ${Math.max(0, core.doneTodayCount - core.verifiedTodayCount)} unverified`}
                tone={
                  core.doneTodayCount === 0
                    ? "neutral"
                    : core.verifiedTodayCount === 0
                      ? "bad"
                      : core.verifiedTodayCount < core.doneTodayCount
                        ? "warn"
                        : "good"
                }
              />
            </div>

            {/* Standing + leaderboard — alongside the stats */}
            <div className="mt-3 grid gap-5 lg:grid-cols-2">
              <StandingCard rank={core.rank} />
              <BoardCard rank={core.rank} />
            </div>

            {/* 2 — GRAPHS / INSIGHTS */}
            <SectionLabel icon={BarChart3}>Insights</SectionLabel>
            <ConversionCard conv={conv} speed={speed} core={core} label={range.label} />
            {waStats && <WhatsappStatsCard stats={waStats} />}
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <FunnelCard funnel={funnel} label={range.label} />
              <OpportunityCard funnel={funnel} core={core} leads={leads} label={range.label} />
            </div>
            <div className="mt-5">
              <PipelineCard pipeline={core.pipeline} />
            </div>

            {/* 3 — CONTENT / YOUR WORK */}
            <SectionLabel icon={Target}>Your work</SectionLabel>
            <CallNextCard queue={core.callQueue} />
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <FollowUpsCard followUps={core.followUps} doneToday={core.doneTodayCount} />
              <LeadsToCallCard leads={leads} />
            </div>
            <div className="mt-5">
              <CoachCard core={core} fname={fname} newLeadsCount={leads?.newLeadsCount ?? 0} />
            </div>
          </>
        )
      )}
    </div>
  );
}

/* ----------------------------- KPI ----------------------------- */
const TONES = {
  good: { dot: "bg-emerald-500" },
  warn: { dot: "bg-amber-500" },
  bad: { dot: "bg-rose-500" },
  neutral: { dot: "bg-slate-300" },
};

function Kpi({ icon: Icon, label, value, hint, tone = "neutral" }) {
  const t = TONES[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Icon className="h-4 w-4 text-slate-400" />
          {label}
        </div>
        <span className={`h-2 w-2 rounded-full ${t.dot}`} />
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

/* --------------------------- Section label --------------------------- */
function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="mt-8 mb-1 flex items-center gap-2 border-b border-slate-200 pb-2">
      {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{children}</span>
    </div>
  );
}

/* --------------------- Conversion vs goal + quality --------------------- */
function ConversionCard({ conv, speed, core, label }) {
  const bookings = conv?.bookings ?? 0;
  const target = conv?.target ?? DAILY_BOOKING_TARGET;
  const pctOfTarget = target > 0 ? Math.min(100, (bookings / target) * 100) : 0;
  const onTrack = !!conv?.metTarget;
  const rate = conv?.rate; // conversion %, shown as a secondary stat

  const logged = core?.doneTodayCount ?? 0;
  const verified = core?.verifiedTodayCount ?? 0;
  const unverified = Math.max(0, logged - verified);
  const verifyPct = logged > 0 ? Math.round((verified / logged) * 100) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-600">
        <Target className="h-4 w-4" /> Booking target
        <span className="ml-1 font-medium normal-case text-slate-400">· {label}</span>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* 1 — bookings vs daily target */}
        <div>
          <div className="flex items-end gap-2">
            <span className={`text-4xl font-bold tracking-tight ${onTrack ? "text-emerald-600" : "text-slate-900"}`}>
              {bookings}
            </span>
            <span className="mb-1 text-sm font-medium text-slate-400">/ {target} target</span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${onTrack ? "bg-emerald-500" : "bg-indigo-500"}`}
              style={{ width: `${pctOfTarget}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {onTrack ? (
              <span className="font-medium text-emerald-600">🎯 Target met — keep going.</span>
            ) : conv?.need ? (
              <>
                <span className="font-semibold text-slate-700">+{conv.need} booking{conv.need > 1 ? "s" : ""}</span> to hit target
              </>
            ) : (
              "Below target."
            )}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {DAILY_BOOKING_TARGET}/day{conv?.days > 1 ? ` × ${conv.days} days` : ""}
            {rate != null && ` · ${rate.toFixed(1)}% conversion`}
            {" · "}
            {conv?.leads ?? 0} → {conv?.quotes ?? 0} → {conv?.bookings ?? 0}
          </div>
        </div>

        {/* 2 — speed to lead */}
        <div className="lg:border-l lg:border-slate-100 lg:pl-6">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Speed to lead</div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-3xl font-bold tracking-tight">{speed?.avg == null ? "—" : fmtMins(speed.avg)}</span>
            <span className="mb-1 text-xs text-slate-400">avg 1st response</span>
          </div>
          <div className="mt-2 text-sm">
            <span className={`font-semibold ${pctTone(speed?.fastPct)}`}>{speed?.fastPct == null ? "—" : `${speed.fastPct}%`}</span>{" "}
            <span className="text-slate-500">answered &lt; {FAST_RESPONSE_MIN} min</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {speed?.count ? `${speed.count} leads measured · faster = higher conversion` : "No measured responses in range."}
          </div>
        </div>

        {/* 3 — contact quality today (anti-fake follow-up) */}
        <div className="lg:border-l lg:border-slate-100 lg:pl-6">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contact quality · today</div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-3xl font-bold tracking-tight">{verifyPct == null ? "—" : `${verifyPct}%`}</span>
            <span className="mb-1 text-xs text-slate-400">verified by a call</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> {verified} verified
            </span>
            {unverified > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {unverified} unverified
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {logged === 0
              ? "No follow-ups logged yet today."
              : "“Unverified” = status updated with no connected call logged."}
          </div>
        </div>
      </div>
    </section>
  );
}

function fmtMins(m) {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function pctTone(p) {
  if (p == null) return "text-slate-400";
  if (p >= 70) return "text-emerald-600";
  if (p >= 40) return "text-amber-600";
  return "text-rose-600";
}

/* --------------------------- Call queue --------------------------- */
function CallNextCard({ queue }) {
  const total = queue.length;
  const item = queue[0];
  const next = queue[1];

  return (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-600">
          <Target className="h-4 w-4" /> Call next
        </div>
        {total > 0 && (
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-100">
            {total} to call today
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-6 text-sm text-emerald-700">
          ✅ No follow-ups left to call right now. New ones appear here as they fall due.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-bold">{item.name}</h3>
            {item.stage && (
              <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                {item.stage}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            {item.city && <span className="capitalize">📍 {item.city}</span>}
            {item.status && <span className="capitalize">· {item.status}</span>}
            <span className="font-medium text-amber-600">· due today</span>
          </div>

          {/* contact details */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {item.contact && (
              <a
                href={`tel:+91${item.contact}`}
                className="inline-flex items-center gap-1.5 text-base font-bold text-slate-900 hover:text-emerald-700"
              >
                <Phone className="h-4 w-4 text-emerald-600" /> +91 {item.contact}
              </a>
            )}
            {item.email && (
              <a
                href={`mailto:${item.email}`}
                className="inline-flex items-center gap-1.5 text-base font-bold text-slate-900 hover:text-indigo-700"
              >
                <Mail className="h-4 w-4 text-indigo-500" /> {item.email}
              </a>
            )}
          </div>

          {item.note && (
            <div className="mt-4 rounded-xl border border-indigo-100 bg-white/70 px-4 py-3 text-sm text-slate-600">
              <span className="font-semibold text-indigo-600">Last note: </span>
              {item.note}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={`tel:+91${item.contact}`}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <Phone className="h-4 w-4" /> Click to call
            </a>
            <a
              href={`https://wa.me/91${item.contact}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <MessageCircle className="h-4 w-4 text-emerald-600" /> Send WhatsApp
            </a>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-indigo-100 pt-3 text-xs text-slate-500">
            {next ? (
              <span>
                Up next: <span className="font-medium text-slate-700">{next.name}</span>
                {" · due today"}
              </span>
            ) : (
              <span>Last one in the queue.</span>
            )}
            <span className="flex items-center gap-1 text-slate-400">
              <RefreshCw className="h-3 w-3" /> Auto-updates as calls are logged
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/* --------------------------- Standing --------------------------- */
function StandingCard({ rank }) {
  const isTop = rank.position === 1;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Trophy className="h-4.5 w-4.5 text-amber-500" /> Your standing
      </div>
      <div className="mt-5 flex items-center gap-5">
        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-amber-50 ring-4 ring-amber-100">
          <span className="text-2xl font-bold text-amber-600">
            {rank.position ? `#${rank.position}` : "—"}
          </span>
          <span className="text-[10px] font-medium text-amber-500">this month</span>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-slate-800">
            {isTop ? "🏆 You're leading the board!" : `${rank.myBookings} bookings so far`}
          </p>
          <p className="mt-1 text-slate-500">
            {rank.total ? `Ranked among ${rank.total} reps` : "Booking leaderboard"} ·
            top rep has {rank.top?.bookings ?? "—"} bookings.
          </p>
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Conversion funnel --------------------------- */
function FunnelCard({ funnel, label }) {
  const loading = funnel == null;
  const leads = funnel?.leads ?? null;
  const quotes = funnel?.quotes ?? null;
  const bookings = funnel?.bookings ?? null;
  const base = Math.max(leads || 0, quotes || 0, bookings || 0, 1);
  const stages = [
    { name: "Leads", value: leads, color: "bg-sky-500" },
    { name: "Converted to quote", value: quotes, color: "bg-indigo-500" },
    { name: "Bookings", value: bookings, color: "bg-emerald-500" },
  ];
  const q2l = leads ? Math.round((quotes / leads) * 100) : null;
  const b2q = quotes ? Math.round((bookings / quotes) * 100) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Filter className="h-4.5 w-4.5 text-indigo-500" /> Conversion funnel
        </div>
        <span className="text-xs text-slate-400">{label}</span>
      </div>

      <div className="mt-5 space-y-3">
        {stages.map((s) => {
          const pct = s.value == null ? 0 : Math.round((s.value / base) * 100);
          return (
            <div key={s.name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-slate-600">{s.name}</span>
                <span className="font-semibold text-slate-800">{loading || s.value == null ? "…" : s.value}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${s.color} transition-all`} style={{ width: `${Math.max(pct, 3)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <ConvChip label="Lead → Quote" value={q2l} />
        <ConvChip label="Quote → Booking" value={b2q} />
      </div>

      {funnel?.approx && (
        <p className="mt-3 text-[11px] text-amber-600">
          ⚠ Quote step approximated from quotations — deploy the backend to use ss_leads.is_converted_to_quot.
        </p>
      )}
    </section>
  );
}

function ConvChip({ label, value }) {
  return (
    <div className="flex-1 rounded-xl bg-slate-50 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-slate-800">{value == null ? "—" : `${value}%`}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

/* --------------------------- WhatsApp follow-ups --------------------------- */
function WhatsappStatsCard({ stats }) {
  const sent = stats.sent ?? 0;
  const delivered = stats.delivered ?? 0;
  const read = stats.read ?? 0;
  const failed = stats.failed ?? 0;
  const pct = (n) => (sent > 0 ? Math.round((n / sent) * 100) : 0);

  const steps = [
    { key: "sent", label: "Sent", value: sent, icon: SendIcon, tone: "text-slate-600", bar: "bg-slate-400", p: 100 },
    { key: "delivered", label: "Delivered", value: delivered, icon: CheckCheck, tone: "text-sky-600", bar: "bg-sky-400", p: pct(delivered) },
    { key: "read", label: "Read", value: read, icon: EyeIcon, tone: "text-emerald-600", bar: "bg-emerald-500", p: pct(read) },
  ];
  const by = stats.by_scenario || {};
  const scen = [
    { key: "quote_discount", label: "Quote offers" },
    { key: "callback", label: "Callbacks" },
    { key: "rnr", label: "RNR reach" },
  ];

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-slate-800">WhatsApp follow-ups · today</div>
            <div className="text-[11px] text-slate-400">Sent to your assigned customers · once per customer / 2 days · live delivery status</div>
          </div>
        </div>
        {failed > 0 && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
            <XCircle className="h-3.5 w-3.5" /> {failed} failed
          </span>
        )}
      </div>

      {/* delivery funnel: Sent -> Delivered -> Read */}
      <div className="mt-4 space-y-3">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex items-center gap-3">
              <div className={`flex w-24 shrink-0 items-center gap-1.5 text-xs font-semibold ${s.tone}`}>
                <Icon className="h-3.5 w-3.5" /> {s.label}
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
                <div className={`h-full rounded-md ${s.bar} transition-all`} style={{ width: `${Math.max(s.p, 2)}%` }} />
              </div>
              <div className="w-20 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">
                {s.value} <span className="font-medium text-slate-400">· {s.p}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* per-scenario sends */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
        {scen.map((s) => (
          <div key={s.key} className="rounded-xl bg-slate-50 px-3 py-2 text-center">
            <div className="text-lg font-bold tabular-nums text-slate-800">{by[s.key] ?? 0}</div>
            <div className="text-[11px] font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------- Booking opportunity --------------------------- */
// A "what-if" companion to the funnel: estimates how many MORE bookings are
// reachable from the deals already in hand, and exactly how to talk to win them.
function OpportunityCard({ funnel, core, leads, label }) {
  const loading = funnel == null;

  const bookings = funnel?.bookings ?? 0;
  const quotes = funnel?.quotes ?? 0;
  const openQuotes = Math.max(quotes - bookings, 0);
  const waiting = core?.followUps?.dueToday?.length ?? 0;
  const newLeads = leads?.newLeadsCount ?? 0;

  // Conservative recovery rates → estimated extra bookings per lever.
  const levers = [
    {
      key: "speed",
      icon: Zap,
      iconColor: "text-amber-600",
      ring: "bg-amber-50 ring-amber-100",
      bar: "bg-amber-400",
      title: "Follow up faster",
      gain: Math.round(waiting * 0.3),
      basis: `${waiting} waiting on a callback`,
      why: "A callback within the hour books ~3× more than next-day.",
      script:
        "Hi {name}, just making sure you got everything on your storage quote — I can lock in a slot for you this week. When works?",
      href: "/follow-ups?view=waiting",
      cta: "See who's waiting",
    },
    {
      key: "discount",
      icon: Percent,
      iconColor: "text-emerald-600",
      ring: "bg-emerald-50 ring-emerald-100",
      bar: "bg-emerald-400",
      title: "Offer a nudge or discount",
      gain: Math.round(openQuotes * 0.3),
      basis: `${openQuotes} quote${openQuotes === 1 ? "" : "s"} sent, not booked`,
      why: "A small first-month discount tips fence-sitters over the line.",
      script:
        "I can give you 10% off your first month if we confirm today — shall I reserve your unit before it's gone?",
      href: "/quotations",
      cta: "Open these quotes",
    },
    {
      key: "newleads",
      icon: Sparkles,
      iconColor: "text-indigo-600",
      ring: "bg-indigo-50 ring-indigo-100",
      bar: "bg-indigo-400",
      title: "Work fresh leads first",
      gain: Math.round(newLeads * 0.15),
      basis: `${newLeads} new lead${newLeads === 1 ? "" : "s"} just in`,
      why: "Fresh leads convert best inside the first 24 hours — strike now.",
      script:
        "Hi {name}, thanks for your enquiry! Tell me what you're storing and I'll get you the best size and price right away.",
      href: "/leads",
      cta: "See fresh leads",
    },
  ].filter((l) => l.gain > 0);

  const potential = levers.reduce((s, l) => s + l.gain, 0);
  const reachable = bookings + potential;
  const base = Math.max(reachable, 1);
  const uplift = bookings > 0 ? Math.round((potential / bookings) * 100) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <TrendingUp className="h-4.5 w-4.5 text-emerald-500" /> Booking opportunity
        </div>
        <span className="text-xs text-slate-400">{label}</span>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">Crunching your opportunities…</p>
      ) : potential === 0 ? (
        <p className="mt-6 text-sm text-emerald-700">
          ✅ Nothing left on the table right now — every open lead and quote is being worked.
        </p>
      ) : (
        <>
          {/* headline */}
          <div className="mt-4 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight text-emerald-600">+{potential}</span>
            <span className="pb-1 text-sm text-slate-500">
              more booking{potential === 1 ? "" : "s"} within reach
              {uplift != null && uplift > 0 && (
                <span className="font-semibold text-emerald-600"> · +{uplift}%</span>
              )}
            </span>
          </div>

          {/* booked now → reachable mini-funnel */}
          <div className="mt-4 space-y-3">
            {[
              { name: "Booked now", value: bookings, color: "bg-emerald-500" },
              { name: "Within reach", value: potential, color: "bg-emerald-300" },
              { name: "Total possible", value: reachable, color: "bg-slate-800" },
            ].map((s) => (
              <div key={s.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-600">{s.name}</span>
                  <span className="font-semibold text-slate-800">{s.value}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${s.color} transition-all`}
                    style={{ width: `${Math.max((s.value / base) * 100, 3)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* levers + how to talk */}
          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            {levers.map(({ key, ...rest }) => (
              <Lever key={key} {...rest} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Lever({ icon: Icon, iconColor, ring, title, gain, basis, why, script, href, cta }) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={`block rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 ${
        href ? "transition-colors hover:border-indigo-200 hover:bg-indigo-50/40" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${ring}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800">{title}</span>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              +{gain}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {basis} · {why}
          </p>
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <p className="text-xs italic text-slate-600">&ldquo;{script}&rdquo;</p>
          </div>
          {href && (
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">
              {cta || "View customers"} <ArrowRight className="h-3.5 w-3.5" />
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

/* --------------------------- Pipeline by stage --------------------------- */
function PipelineCard({ pipeline }) {
  const max = Math.max(...pipeline.map((p) => p.count), 1);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <BarChart3 className="h-4.5 w-4.5 text-indigo-500" /> Pipeline by stage
      </div>
      {pipeline.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">No active deals in your pipeline.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {pipeline.map((p) => (
            <div key={p.stage}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="truncate capitalize text-slate-600">{p.stage}</span>
                <span className="font-semibold text-slate-800">{p.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max((p.count / max) * 100, 4)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------- Follow-ups --------------------------- */
function FollowUpsCard({ followUps, doneToday = 0 }) {
  const rows = followUps.dueToday.slice(0, 6).map((r) => ({ ...r, badge: "Due today", tone: "warn" }));

  const pending = followUps.dueToday.length;
  const total = pending + doneToday;
  const pct = total ? Math.round((doneToday / total) * 100) : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <CalendarClock className="h-4.5 w-4.5 text-indigo-500" /> My follow-ups · today
        </div>
        {pending > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">
            {pending} due today
          </span>
        )}
      </div>

      {/* today's progress */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">{doneToday} done today</span>
          <span className="text-slate-400">{pending} still pending</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ul className="mt-5 divide-y divide-slate-100">
        {rows.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">No follow-ups due. Nice and clear ✨</li>
        )}
        {rows.map((r) => (
          <li key={`${r.id}-${r.badge}`} className="flex items-center gap-3 py-3">
            <Avatar name={r.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{r.name}</p>
              <p className="truncate text-xs text-slate-500">
                {r.note || r.stage || r.status || "Follow up"}
                {r.city ? ` · ${r.city}` : ""}
              </p>
            </div>
            <Badge tone={r.tone}>{r.badge}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}


/* --------------------------- Coach --------------------------- */
function CoachCard({ core, fname, newLeadsCount = 0 }) {
  const dueToday = core.followUps.dueToday.length;
  const tips = [];
  if (newLeadsCount > 0)
    tips.push({ icon: Sparkles, text: `${newLeadsCount} new leads are waiting for a first call. Speed-to-lead wins deals.` });
  if (dueToday > 0)
    tips.push({ icon: CalendarClock, text: `${dueToday} follow-ups are due today — line them up in your best-connect window.` });
  if (core.rank.position && core.rank.position > 1 && core.rank.top)
    tips.push({ icon: TrendingUp, text: `Top rep has ${core.rank.top.bookings} bookings. You're ${Math.max(0, core.rank.top.bookings - core.rank.myBookings)} away from #1.` });
  if (tips.length === 0)
    tips.push({ icon: CheckCircle2, text: `All clear, ${fname}. Keep the momentum going!` });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles className="h-4.5 w-4.5 text-indigo-500" /> Coach
        </div>
        <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">AI</span>
      </div>
      <div className="mt-4 space-y-3">
        {tips.slice(0, 4).map((t, i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl bg-indigo-50/60 px-3.5 py-3 text-sm text-slate-700">
            <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------- Leads to call --------------------------- */
function LeadsToCallCard({ leads }) {
  const loading = leads == null;
  const list = leads?.leadsToCall ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <AlertTriangle className="h-4.5 w-4.5 text-rose-500" /> Leads to call
        </div>
        {!loading && leads.callableCount > 0 && (
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
            {leads.callableCount} · speed to lead
          </span>
        )}
      </div>
      <ul className="mt-4 divide-y divide-slate-100">
        {loading && (
          <li className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading leads…
          </li>
        )}
        {!loading && list.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">No leads waiting to be called. You&apos;re on top of it 👏</li>
        )}
        {list.map((l) => (
          <li key={`${l.id}-${l.kind}`} className="flex items-center gap-3 py-3">
            <Avatar name={l.name} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="truncate">{l.name}</span>
                <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600">{l.source}</span>
              </p>
              <p className="truncate text-xs text-slate-500">
                {l.storage} · {l.kind === "new" ? `assigned ${timeAgoLabel(l.assignedAt)}` : l.badge}
              </p>
            </div>
            <Badge tone={l.tone}>{l.kind === "new" ? "New" : l.badge}</Badge>
            {l.contact && (
              <div className="flex items-center gap-1.5">
                <a
                  href={`tel:+91${l.contact}`}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-emerald-600 hover:bg-slate-50"
                  title="Call"
                >
                  <Phone className="h-3.5 w-3.5" />
                </a>
                <a
                  href={`https://wa.me/91${l.contact}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-emerald-600 hover:bg-slate-50"
                  title="WhatsApp"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-400">
        Overdue lead follow-ups first, then new leads — speed-to-lead is your biggest conversion lever.
      </p>
    </section>
  );
}

/* --------------------------- Board --------------------------- */
function BoardCard({ rank }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Trophy className="h-4.5 w-4.5 text-amber-500" /> Today on the board
      </div>
      <div className="mt-4 space-y-3">
        <Row label="Top rep this month" value={rank.top ? `${rank.top.bookings} bookings` : "—"} tone="good" tag="Leader" />
        <Row label="Your bookings" value={`${rank.myBookings}`} tone="info" tag={rank.position ? `#${rank.position}` : "—"} />
      </div>
    </section>
  );
}

function Row({ label, value, tone, tag }) {
  const tagStyle = {
    good: "bg-emerald-50 text-emerald-600",
    info: "bg-sky-50 text-sky-600",
  }[tone];
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <div>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{value}</p>
      </div>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tagStyle}`}>{tag}</span>
    </div>
  );
}

/* --------------------------- Shared bits --------------------------- */
function Avatar({ name }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
      {initials}
    </span>
  );
}

function Badge({ tone, children }) {
  const styles = {
    bad: "bg-rose-50 text-rose-600",
    warn: "bg-amber-50 text-amber-600",
    info: "bg-sky-50 text-sky-600",
  }[tone];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${styles}`}>{children}</span>;
}

function LoadingState() {
  return (
    <div className="mt-10 flex items-center justify-center gap-3 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
      <span className="text-sm font-medium">Loading your day…</span>
    </div>
  );
}
