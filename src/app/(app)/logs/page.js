"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  Phone,
  MessageCircle,
  Eye,
  Mail,
  Clock,
  AlertTriangle,
  LogIn,
  LogOut,
  Timer,
  Hourglass,
  Gauge,
  CalendarDays,
} from "lucide-react";
import { fetchActivitySummary, fetchActivityLogs, saveProductivity } from "@/lib/activity";
import { fetchQuotations } from "@/lib/crm";
import { getSession } from "@/lib/auth";

// Single-rep productivity for a day: when they logged in, how long they sat idle
// (no action on the site), how fast they got to their first follow-up, and the
// full timeline of what they did. Scoped to the logged-in user; admins (role 18)
// can switch reps.

const WORK = new Set(["call", "whatsapp", "view_customer", "email"]);
const IDLE_GAP = 20; // minutes — a gap longer than this counts as "idle / not working"

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProductivityPage() {
  const [session, setSession] = useState(null);
  const [viewUserId, setViewUserId] = useState(null);
  const [reps, setReps] = useState([]); // admin rep picker
  const [date, setDate] = useState(todayYmd());

  const [summary, setSummary] = useState(null); // single-rep row
  const [logs, setLogs] = useState(null); // raw timeline rows
  const [quotes, setQuotes] = useState(null); // for time-to-first-follow-up
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = String(session?.role_id) === "18";

  // Resolve the logged-in user on the client (getSession needs window).
  useEffect(() => {
    const s = getSession();
    setSession(s);
    setViewUserId(s?.user_id ?? null);
  }, []);

  // Admin-only: list of reps with activity that day, for the switcher.
  useEffect(() => {
    if (!isAdmin) return;
    const ctrl = new AbortController();
    fetchActivitySummary({ date, signal: ctrl.signal })
      .then((rows) => setReps(rows || []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [isAdmin, date]);

  const load = useCallback(
    (signal) => {
      if (viewUserId == null) return Promise.resolve();
      setLoading(true);
      return Promise.all([
        fetchActivitySummary({ date, userId: viewUserId, signal }),
        fetchActivityLogs({ userId: viewUserId, date, limit: 1000, signal }),
        fetchQuotations(viewUserId, { signal }).catch(() => []),
      ])
        .then(([sumArr, logRows, qRows]) => {
          setSummary((sumArr && sumArr[0]) || null);
          setLogs(logRows || []);
          setQuotes(qRows || []);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load productivity data. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [date, viewUserId]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const repName =
    summary?.user_name ||
    reps.find((r) => String(r.user_id) === String(viewUserId))?.user_name ||
    (String(viewUserId) === String(session?.user_id) ? session?.user_fname : "") ||
    (viewUserId != null ? `#${viewUserId}` : "");

  // ---- derive the detailed metrics ----
  const d = useMemo(() => {
    const s = summary || {};
    const rows = (logs || [])
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))); // ascending
    const loginRows = rows.filter((r) => r.event_type === "login");
    const logoutRows = rows.filter((r) => r.event_type === "logout");
    const workRows = rows.filter((r) => WORK.has(r.event_type));

    const loginAt = loginRows[0]?.created_at || null;
    const lastLogoutAt = logoutRows.length ? logoutRows[logoutRows.length - 1].created_at : null;
    const firstActionAt = workRows[0]?.created_at || s.first_at || null;
    const lastActionAt = workRows.length ? workRows[workRows.length - 1].created_at : s.last_at || null;

    // ramp-up: minutes from login to the first real action of the day
    const rampMins = loginAt && firstActionAt ? minsBetween(parseTs(loginAt), parseTs(firstActionAt)) : null;

    // idle right now (only meaningful when viewing today): time since last action
    const isToday = date === todayYmd();
    const idleNow = isToday && lastActionAt ? minsBetween(parseTs(lastActionAt), new Date()) : null;

    // avg time to first follow-up: across quotes whose first follow-up happened on
    // this date. responseMins = lead-creation -> first contact (first-response SLA).
    const fuToday = (quotes || []).filter(
      (q) => q.followUpStartTime && String(q.followUpStartTime).slice(0, 10) === date && q.responseMins != null
    );
    const avgFirstFu = fuToday.length
      ? Math.round(fuToday.reduce((a, q) => a + q.responseMins, 0) / fuToday.length)
      : null;
    const fastFu = fuToday.filter((q) => q.responseMins <= 15).length; // within 15-min SLA

    // full timeline (login + actions + logout) with gap since previous event
    const timeline = rows.map((r, i) => {
      const gap = i > 0 ? minsBetween(parseTs(rows[i - 1].created_at), parseTs(r.created_at)) : null;
      return { ...r, gap, idle: gap != null && gap > IDLE_GAP };
    });

    return {
      s,
      loginAt,
      lastLogoutAt,
      loginCount: loginRows.length,
      firstActionAt,
      lastActionAt,
      rampMins,
      idleNow,
      isToday,
      avgFirstFu,
      fuCount: fuToday.length,
      fastFu,
      fuToday,
      timeline,
    };
  }, [summary, logs, quotes, date]);

  const noData = !loading && summary == null && (logs || []).length === 0;

  // Persist the computed snapshot to ss_crm_productivity_daily whenever a real
  // day's data is loaded (so login/logout timing + productivity is stored, not
  // just shown). Fires once per load; skips empty days.
  useEffect(() => {
    if (loading || viewUserId == null) return;
    if (!d.loginAt && !(d.s.actions > 0)) return; // nothing worth storing yet
    saveProductivity({
      user_id: viewUserId,
      user_name: repName,
      work_date: date,
      login_at: d.loginAt,
      logout_at: d.lastLogoutAt,
      login_count: d.loginCount,
      first_action_at: d.firstActionAt,
      last_action_at: d.lastActionAt,
      active_min: d.s.active_min ?? 0,
      idle_min: d.s.idle_min ?? 0,
      longest_idle_min: d.s.longest_idle_min ?? 0,
      ramp_up_min: d.rampMins,
      calls: d.s.calls ?? 0,
      whatsapps: d.s.whatsapps ?? 0,
      views: d.s.views ?? 0,
      emails: d.s.emails ?? 0,
      actions: d.s.actions ?? 0,
      first_followups: d.fuCount,
      fast_first_followups: d.fastFu,
      avg_first_followup_min: d.avgFirstFu,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, viewUserId, date, repName, loading]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mt-1 text-sm text-slate-500">
            {repName ? <span className="font-semibold text-slate-700">{repName}</span> : "—"} · login &amp; idle time,
            time-to-first-follow-up and the full action timeline for the day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={viewUserId ?? ""}
              onChange={(e) => setViewUserId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
            >
              {session?.user_id != null && !reps.some((r) => String(r.user_id) === String(session.user_id)) && (
                <option value={session.user_id}>{session.user_fname || `#${session.user_id}`} (me)</option>
              )}
              {reps.map((r) => (
                <option key={r.user_id} value={r.user_id}>
                  {r.user_name || `#${r.user_id}`}
                </option>
              ))}
            </select>
          )}
          <div className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50/50 px-2 py-1 ring-1 ring-indigo-200">
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              <CalendarDays className="h-3 w-3" /> Date
            </span>
            <input
              type="date"
              value={date}
              max={todayYmd()}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent px-1 py-1 text-sm text-slate-700 focus:outline-none"
            />
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

      {/* timing KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Logged in at"
          value={fmtTime(d.loginAt)}
          sub={d.loginCount > 1 ? `${d.loginCount} logins today` : d.lastLogoutAt ? `out ${fmtTime(d.lastLogoutAt)}` : "first login"}
          icon={LogIn}
          tone="indigo"
        />
        <Kpi
          label="Active window"
          value={d.firstActionAt ? `${fmtTime(d.firstActionAt)} – ${fmtTime(d.lastActionAt)}` : "—"}
          sub={d.s.active_min != null ? `${fmtMins(d.s.active_min)} on the clock` : "no actions"}
          icon={Timer}
          tone="sky"
        />
        <Kpi
          label="Idle / not working"
          value={fmtMins(d.s.idle_min || 0)}
          sub={d.s.longest_idle_min ? `longest gap ${fmtMins(d.s.longest_idle_min)}` : "no long gaps"}
          icon={Hourglass}
          tone={(d.s.idle_min || 0) >= 60 ? "rose" : (d.s.idle_min || 0) > 0 ? "amber" : "emerald"}
        />
        <Kpi
          label={d.isToday ? "Idle right now" : "Ramp-up to 1st action"}
          value={d.isToday ? (d.idleNow != null ? fmtMins(d.idleNow) : "—") : d.rampMins != null ? fmtMins(d.rampMins) : "—"}
          sub={
            d.isToday
              ? d.lastActionAt
                ? `last action ${fmtTime(d.lastActionAt)}`
                : "no action yet"
              : d.loginAt
                ? "login → first action"
                : "—"
          }
          icon={AlertTriangle}
          tone={d.isToday && d.idleNow != null && d.idleNow > IDLE_GAP ? "rose" : "slate"}
        />
      </div>

      {/* first-follow-up + volume KPIs */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Avg time to 1st follow-up"
          value={d.avgFirstFu != null ? fmtMins(d.avgFirstFu) : "—"}
          sub={d.fuCount ? `${d.fastFu}/${d.fuCount} within 15-min SLA` : "no first follow-ups"}
          icon={Gauge}
          tone={d.avgFirstFu == null ? "slate" : d.avgFirstFu <= 15 ? "emerald" : d.avgFirstFu <= 120 ? "amber" : "rose"}
        />
        <Kpi label="Calls" value={d.s.calls || 0} icon={Phone} tone="emerald" />
        <Kpi label="WhatsApp" value={d.s.whatsapps || 0} icon={MessageCircle} tone="green" />
        <Kpi label="Customers worked" value={d.s.views || 0} icon={Eye} tone="sky" />
        <Kpi label="Total actions" value={d.s.actions || 0} icon={Activity} tone="indigo" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* action timeline with idle gaps */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">Action timeline</h2>
            <p className="text-[11px] text-slate-400">
              Every recorded action in order. Gaps over {IDLE_GAP} min are flagged as idle (no activity on the site).
            </p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto px-2 py-2">
            {!logs && [...Array(6)].map((_, i) => <div key={i} className="m-2 h-5 animate-pulse rounded bg-slate-100" />)}
            {logs && d.timeline.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-400">No activity recorded for this day.</div>
            )}
            {logs &&
              d.timeline.map((r, i) => (
                <TimelineRow key={`${r.created_at}-${i}`} r={r} />
              ))}
          </div>
        </div>

        {/* first follow-ups completed that day */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">First follow-ups today</h2>
            <p className="text-[11px] text-slate-400">
              Leads first contacted today and how long after lead creation it took (first-response time).
            </p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {!quotes && [...Array(6)].map((_, i) => <div key={i} className="m-3 h-5 animate-pulse rounded bg-slate-100" />)}
            {quotes && d.fuToday.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-400">No first follow-ups logged today.</div>
            )}
            {quotes &&
              d.fuToday
                .slice()
                .sort((a, b) => String(b.followUpStartTime).localeCompare(String(a.followUpStartTime)))
                .map((q) => <FollowUpRow key={q.id} q={q} />)}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        “Idle” = total time in gaps longer than {IDLE_GAP} min between actions (calls, WhatsApp, customer opens, emails — not page
        views). “Time to 1st follow-up” = minutes from lead creation to the first follow-up logged that day.
      </p>
    </div>
  );
}

/* ----------------------------- timeline row ----------------------------- */
function TimelineRow({ r }) {
  const meta = EVENT_META[r.event_type] || { label: r.event_type, icon: Activity, tone: "slate" };
  const Icon = meta.icon;
  const tones = {
    emerald: "bg-emerald-50 text-emerald-600",
    green: "bg-green-50 text-green-600",
    sky: "bg-sky-50 text-sky-600",
    violet: "bg-violet-50 text-violet-600",
    indigo: "bg-indigo-50 text-indigo-600",
    slate: "bg-slate-100 text-slate-500",
  };
  return (
    <>
      {r.idle && (
        <div className="mx-2 my-1 flex items-center gap-2 text-[11px] font-semibold text-rose-500">
          <span className="h-px flex-1 bg-rose-100" />
          <Clock className="h-3 w-3" /> idle {fmtMins(r.gap)}
          <span className="h-px flex-1 bg-rose-100" />
        </div>
      )}
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tones[meta.tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-slate-500">{fmtTime(r.created_at)}</span>
        <span className="text-xs font-medium text-slate-700">{meta.label}</span>
        {r.detail && <span className="truncate text-xs text-slate-400">· {r.detail}</span>}
      </div>
    </>
  );
}

/* ----------------------------- follow-up row ----------------------------- */
function FollowUpRow({ q }) {
  const mins = q.responseMins;
  const tone = mins <= 15 ? "text-emerald-700" : mins <= 120 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="flex items-center justify-between border-b border-slate-50 px-4 py-2.5 last:border-0 hover:bg-slate-50/60">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-800">{q.name}</div>
        <div className="text-[11px] text-slate-400">
          {q.city ? `${q.city} · ` : ""}first contact {fmtTime(q.followUpStartTime)}
        </div>
      </div>
      <span className={`shrink-0 text-xs font-bold tabular-nums ${tone}`} title="Lead creation → first follow-up">
        {fmtMins(mins)}
      </span>
    </div>
  );
}

const EVENT_META = {
  call: { label: "Call", icon: Phone, tone: "emerald" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, tone: "green" },
  view_customer: { label: "Opened customer", icon: Eye, tone: "sky" },
  email: { label: "Email", icon: Mail, tone: "violet" },
  login: { label: "Logged in", icon: LogIn, tone: "indigo" },
  logout: { label: "Logged out", icon: LogOut, tone: "slate" },
};

/* ----------------------------- bits ----------------------------- */
function Kpi({ label, value, sub, icon: Icon, tone }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-600",
    green: "bg-green-50 text-green-600",
    sky: "bg-sky-50 text-sky-600",
    indigo: "bg-indigo-50 text-indigo-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-500",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate text-lg font-bold tabular-nums text-slate-900">{value}</div>
        {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
function parseTs(s) {
  if (!s || String(s).startsWith("0000")) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function minsBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b - a) / 60000));
}

function fmtMins(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

function fmtTime(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const time = String(value).split(" ")[1] || String(value).split("T")[1] || "";
  return time.slice(0, 5);
}
