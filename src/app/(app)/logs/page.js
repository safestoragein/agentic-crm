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
  Users,
  ArrowLeft,
  Split,
  ChevronRight,
} from "lucide-react";
import { fetchActivitySummary, fetchActivityLogs, saveProductivity } from "@/lib/activity";
import { fetchQuotations, fetchTeamQuotations } from "@/lib/crm";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";

// Productivity for a day: when each rep logged in / out, how long they worked,
// how much they sat idle, how fast they got to their first follow-up, and the
// gap between one follow-up and the next. Reps see their own day; admins get a
// whole-team overview and can drill into any single rep.

const WORK = new Set(["call", "whatsapp", "view_customer", "email"]);
const IDLE_GAP = 20; // minutes — a gap longer than this counts as "idle / not working"
const TEAM = "__team__"; // sentinel viewUserId for the admin team overview

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
  const [quotes, setQuotes] = useState(null); // for follow-up timing + gaps
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Admin team overview state.
  const [team, setTeam] = useState(null); // [{ user_id, ...metrics }]
  const [teamLoading, setTeamLoading] = useState(false);

  const admin = isAdmin(session);
  const teamMode = admin && viewUserId === TEAM;

  // Resolve the logged-in user on the client (getSession needs window).
  useEffect(() => {
    const s = getSession();
    setSession(s);
    setViewUserId(isAdmin(s) ? TEAM : (s?.user_id ?? null));
  }, []);

  // Admin-only: list of reps with activity that day, for the switcher.
  useEffect(() => {
    if (!admin) return;
    const ctrl = new AbortController();
    fetchActivitySummary({ date, signal: ctrl.signal })
      .then((rows) => setReps(rows || []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [admin, date]);

  // ---- Admin team overview: one summary call + one team-quotes call + a
  // per-rep login/logout log fetch, combined into a per-rep metrics table. ----
  const loadTeam = useCallback(
    (signal) => {
      if (!admin) return Promise.resolve();
      setTeamLoading(true);
      return Promise.all([
        fetchActivitySummary({ date, signal }),
        fetchTeamQuotations({ signal }).catch(() => []),
      ])
        .then(async ([sumArr, teamQuotes]) => {
          const sums = sumArr || [];
          // Follow-up start times that day, grouped by rep (for gap + count).
          const fuByRep = new Map();
          for (const q of teamQuotes || []) {
            if (!q.followUpStartTime || String(q.followUpStartTime).slice(0, 10) !== date) continue;
            const rid = String(q.repId ?? "");
            if (!rid) continue;
            if (!fuByRep.has(rid)) fuByRep.set(rid, []);
            fuByRep.get(rid).push(q.followUpStartTime);
          }
          // Login/logout per rep — small per-rep log reads, run in parallel.
          const logsByRep = new Map(
            await Promise.all(
              sums.map((r) =>
                fetchActivityLogs({ userId: r.user_id, date, limit: 500, signal })
                  .then((rows) => [String(r.user_id), rows || []])
                  .catch(() => [String(r.user_id), []])
              )
            )
          );
          const isToday = date === todayYmd();
          const now = new Date();
          const rows = sums.map((s) => {
            const lr = logsByRep.get(String(s.user_id)) || [];
            const logins = lr
              .filter((r) => r.event_type === "login")
              .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            const logouts = lr
              .filter((r) => r.event_type === "logout")
              .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            const loginAt = logins[0]?.created_at || null;
            const logoutAt = logouts.length ? logouts[logouts.length - 1].created_at : null;
            const workedFrom = loginAt || s.first_at || null;
            const workedTo = logoutAt || (isToday ? null : s.last_at) || s.last_at || null;
            const workedMin =
              workedFrom && (workedTo || isToday)
                ? minsBetween(parseTs(workedFrom), workedTo ? parseTs(workedTo) : now)
                : null;
            const fu = followupGaps(fuByRep.get(String(s.user_id)) || []);
            const idleNow = isToday && s.last_at ? minsBetween(parseTs(s.last_at), now) : null;
            return {
              user_id: s.user_id,
              user_name: s.user_name || `#${s.user_id}`,
              loginAt,
              logoutAt,
              loginCount: logins.length,
              workedMin,
              activeMin: s.active_min ?? 0,
              idleMin: s.idle_min ?? 0,
              longestIdle: s.longest_idle_min ?? 0,
              lastActionAt: s.last_at || null,
              idleNow,
              calls: s.calls ?? 0,
              whatsapps: s.whatsapps ?? 0,
              views: s.views ?? 0,
              emails: s.emails ?? 0,
              actions: s.actions ?? 0,
              fuCount: fu.count,
              fuAvgGap: fu.avgGap,
              fuLongestGap: fu.longestGap,
            };
          });
          // Busiest first: most follow-ups, then most actions.
          rows.sort((a, b) => b.fuCount - a.fuCount || b.actions - a.actions);
          setTeam(rows);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load team productivity. Please refresh.");
        })
        .finally(() => setTeamLoading(false));
    },
    [admin, date]
  );

  useEffect(() => {
    if (!teamMode) return;
    const ctrl = new AbortController();
    loadTeam(ctrl.signal);
    return () => ctrl.abort();
  }, [teamMode, loadTeam]);

  // ---- Single-rep load ----
  const load = useCallback(
    (signal) => {
      if (viewUserId == null || viewUserId === TEAM) return Promise.resolve();
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
    if (viewUserId === TEAM) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, viewUserId]);

  const repName =
    summary?.user_name ||
    reps.find((r) => String(r.user_id) === String(viewUserId))?.user_name ||
    (String(viewUserId) === String(session?.user_id) ? session?.user_fname : "") ||
    (viewUserId != null ? `#${viewUserId}` : "");

  // ---- derive the detailed single-rep metrics ----
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

    // total time worked: login → logout (or → last action / now if still on)
    const workedFrom = loginAt || firstActionAt;
    const workedTo = lastLogoutAt || (isToday ? null : lastActionAt) || lastActionAt;
    const workedMin =
      workedFrom && (workedTo || isToday)
        ? minsBetween(parseTs(workedFrom), workedTo ? parseTs(workedTo) : new Date())
        : null;

    // avg time to first follow-up: across quotes whose first follow-up happened on
    // this date. responseMins = lead-creation -> first contact (first-response SLA).
    const fuToday = (quotes || []).filter(
      (q) => q.followUpStartTime && String(q.followUpStartTime).slice(0, 10) === date && q.responseMins != null
    );
    const avgFirstFu = fuToday.length
      ? Math.round(fuToday.reduce((a, q) => a + q.responseMins, 0) / fuToday.length)
      : null;
    const fastFu = fuToday.filter((q) => q.responseMins <= 15).length; // within 15-min SLA

    // follow-up → follow-up rhythm: gap between one logged follow-up and the next.
    const fuGaps = followupGaps(
      (quotes || [])
        .filter((q) => q.followUpStartTime && String(q.followUpStartTime).slice(0, 10) === date)
        .map((q) => q.followUpStartTime)
    );

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
      workedMin,
      isToday,
      avgFirstFu,
      fuCount: fuToday.length,
      fastFu,
      fuToday,
      fuGaps,
      timeline,
    };
  }, [summary, logs, quotes, date]);

  // Persist the computed snapshot to ss_crm_productivity_daily whenever a real
  // day's data is loaded (so login/logout timing + productivity is stored, not
  // just shown). Fires once per load; skips empty days and the team view.
  useEffect(() => {
    if (loading || viewUserId == null || viewUserId === TEAM) return;
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
      worked_min: d.workedMin,
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
      followups_logged: d.fuGaps.count,
      avg_followup_gap_min: d.fuGaps.avgGap,
      longest_followup_gap_min: d.fuGaps.longestGap,
    });
  }, [d, viewUserId, date, repName, loading]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Team Productivity</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {teamMode ? (
              <>Login / logout, time worked, idle time and follow-up rhythm for every rep.</>
            ) : (
              <>
                {repName ? <span className="font-semibold text-slate-700">{repName}</span> : "—"} · login{admin ? " & idle" : ""} time,
                follow-up rhythm and the full action timeline for the day.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {admin && !teamMode && (
            <button
              onClick={() => setViewUserId(TEAM)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" /> Team overview
            </button>
          )}
          {admin && (
            <select
              value={viewUserId ?? ""}
              onChange={(e) => setViewUserId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
            >
              <option value={TEAM}>Whole team</option>
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
            onClick={() => (teamMode ? loadTeam() : load())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {loading || teamLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {teamMode ? (
        <TeamOverview
          rows={team}
          loading={teamLoading}
          isToday={date === todayYmd()}
          onPick={(id) => setViewUserId(String(id))}
        />
      ) : (
        <SingleRep d={d} logs={logs} quotes={quotes} showIdle={admin} />
      )}
    </div>
  );
}

/* ============================ admin team overview ============================ */
function TeamOverview({ rows, loading, isToday, onPick }) {
  const totals = useMemo(() => {
    const r = rows || [];
    const active = r.filter((x) => x.actions > 0 || x.loginAt).length;
    const fu = r.reduce((a, x) => a + x.fuCount, 0);
    const idle = r.reduce((a, x) => a + (x.idleMin || 0), 0);
    const gapRows = r.filter((x) => x.fuAvgGap != null);
    const avgGap = gapRows.length ? Math.round(gapRows.reduce((a, x) => a + x.fuAvgGap, 0) / gapRows.length) : null;
    return { active, fu, idle, avgGap, count: r.length };
  }, [rows]);

  if (loading && !rows) {
    return (
      <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white py-24 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (rows && rows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">No rep activity recorded for this day.</div>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Reps active" value={`${totals.active}/${totals.count}`} icon={Users} tone="indigo" />
        <Kpi label="Follow-ups logged" value={totals.fu} icon={Phone} tone="emerald" />
        <Kpi label="Avg follow-up gap" value={fmtMins(totals.avgGap)} sub="mean across reps" icon={Split} tone={totals.avgGap == null ? "slate" : totals.avgGap <= 20 ? "emerald" : totals.avgGap <= 45 ? "amber" : "rose"} />
        <Kpi label="Total idle time" value={fmtMins(totals.idle)} sub="all reps combined" icon={Hourglass} tone={totals.idle >= 240 ? "rose" : totals.idle > 0 ? "amber" : "emerald"} />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <Th className="pl-4">Rep</Th>
                <Th>Login</Th>
                <Th>Logout</Th>
                <Th title="Login → logout (or last action)">Worked</Th>
                <Th title="Minutes with activity on the site">Active</Th>
                <Th title="Total idle time · longest single gap">Idle</Th>
                <Th title="Follow-ups logged that day">Follow-ups</Th>
                <Th title="Average gap between consecutive follow-ups">Avg gap</Th>
                <Th title="Longest gap between two follow-ups">Longest gap</Th>
                <Th title="Calls · WhatsApp · customers opened">Calls / WA / Cust</Th>
                <Th>{isToday ? "Idle now" : "Last action"}</Th>
                <Th className="pr-4"> </Th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr
                  key={r.user_id}
                  onClick={() => onPick(r.user_id)}
                  className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-indigo-50/40"
                >
                  <Td className="pl-4 font-semibold text-slate-800">{r.user_name}</Td>
                  <Td className="tabular-nums text-slate-600">
                    {fmtTime(r.loginAt)}
                    {r.loginCount > 1 && <span className="ml-1 text-[10px] text-slate-400">×{r.loginCount}</span>}
                  </Td>
                  <Td className="tabular-nums text-slate-600">{fmtTime(r.logoutAt)}</Td>
                  <Td className="tabular-nums font-medium text-slate-700">{fmtMins(r.workedMin)}</Td>
                  <Td className="tabular-nums text-slate-600">{fmtMins(r.activeMin)}</Td>
                  <Td className="tabular-nums">
                    <span className={r.idleMin >= 60 ? "font-semibold text-rose-600" : r.idleMin > 0 ? "text-amber-600" : "text-slate-400"}>
                      {fmtMins(r.idleMin)}
                    </span>
                    {r.longestIdle > 0 && <span className="ml-1 text-[10px] text-slate-400">↑{fmtMins(r.longestIdle)}</span>}
                  </Td>
                  <Td className="tabular-nums font-semibold text-slate-800">{r.fuCount || <span className="text-slate-300">0</span>}</Td>
                  <Td className="tabular-nums">
                    <span className={gapTone(r.fuAvgGap)}>{fmtMins(r.fuAvgGap)}</span>
                  </Td>
                  <Td className="tabular-nums text-slate-600">{fmtMins(r.fuLongestGap)}</Td>
                  <Td className="tabular-nums text-slate-500">
                    {r.calls} / {r.whatsapps} / {r.views}
                  </Td>
                  <Td className="tabular-nums">
                    {isToday ? (
                      r.idleNow != null ? (
                        <span className={r.idleNow > IDLE_GAP ? "font-semibold text-rose-600" : "text-slate-500"}>{fmtMins(r.idleNow)} ago</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )
                    ) : (
                      <span className="text-slate-500">{fmtTime(r.lastActionAt)}</span>
                    )}
                  </Td>
                  <Td className="pr-4 text-slate-300">
                    <ChevronRight className="h-4 w-4" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Click a rep to open their full day. “Worked” = login → logout (or last action if still on). “Idle” = total time in gaps
        over {IDLE_GAP} min between actions. “Avg / longest gap” = time between one follow-up call and the next.
      </p>
    </>
  );
}

function Th({ children, className = "", title }) {
  return (
    <th className={`px-3 py-2.5 font-bold ${className}`} title={title}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

/* ============================ single-rep detail ============================ */
function SingleRep({ d, logs, quotes, showIdle }) {
  return (
    <>
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
          label="Time worked"
          value={fmtMins(d.workedMin)}
          sub={d.lastLogoutAt ? `until logout ${fmtTime(d.lastLogoutAt)}` : d.isToday ? "still on the clock" : "until last action"}
          icon={Timer}
          tone="sky"
        />
        {/* Idle time is admin-only — reps never see idle / "not working" metrics. */}
        {showIdle && (
          <Kpi
            label="Idle / not working"
            value={fmtMins(d.s.idle_min || 0)}
            sub={d.s.longest_idle_min ? `longest gap ${fmtMins(d.s.longest_idle_min)}` : "no long gaps"}
            icon={Hourglass}
            tone={(d.s.idle_min || 0) >= 60 ? "rose" : (d.s.idle_min || 0) > 0 ? "amber" : "emerald"}
          />
        )}
        {showIdle ? (
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
        ) : (
          <Kpi
            label="Ramp-up to 1st action"
            value={d.rampMins != null ? fmtMins(d.rampMins) : "—"}
            sub={d.loginAt ? "login → first action" : "—"}
            icon={Gauge}
            tone="slate"
          />
        )}
      </div>

      {/* follow-up + volume KPIs */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi
          label="Follow-up gap"
          value={fmtMins(d.fuGaps.avgGap)}
          sub={d.fuGaps.count ? `${d.fuGaps.count} done · longest ${fmtMins(d.fuGaps.longestGap)}` : "no follow-ups"}
          icon={Split}
          tone={gapKpiTone(d.fuGaps.avgGap)}
        />
        <Kpi
          label="Avg to 1st follow-up"
          value={d.avgFirstFu != null ? fmtMins(d.avgFirstFu) : "—"}
          sub={d.fuCount ? `${d.fastFu}/${d.fuCount} within SLA` : "no first follow-ups"}
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
              Every recorded action in order.{showIdle ? ` Gaps over ${IDLE_GAP} min are flagged as idle (no activity on the site).` : ""}
            </p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto px-2 py-2">
            {!logs && [...Array(6)].map((_, i) => <div key={i} className="m-2 h-5 animate-pulse rounded bg-slate-100" />)}
            {logs && d.timeline.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-400">No activity recorded for this day.</div>
            )}
            {logs && d.timeline.map((r, i) => <TimelineRow key={`${r.created_at}-${i}`} r={r} showIdle={showIdle} />)}
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
        {showIdle && (
          <>“Idle” = total time in gaps longer than {IDLE_GAP} min between actions (calls, WhatsApp, customer opens, emails — not page views). </>
        )}
        “Follow-up gap” = minutes between one follow-up call and the next. “Time to 1st follow-up” = minutes from lead creation to the
        first follow-up logged that day.
      </p>
    </>
  );
}

/* ----------------------------- timeline row ----------------------------- */
function TimelineRow({ r, showIdle }) {
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
      {showIdle && r.idle && (
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
// Gap (minutes) between consecutive follow-ups that day, from their start times.
function followupGaps(times) {
  const ts = (times || []).map(parseTs).filter(Boolean).sort((a, b) => a - b);
  if (ts.length < 2) {
    return { count: ts.length, avgGap: null, longestGap: null, firstAt: ts[0] || null, lastAt: ts[ts.length - 1] || null };
  }
  let total = 0;
  let longest = 0;
  for (let i = 1; i < ts.length; i++) {
    const g = Math.round((ts[i] - ts[i - 1]) / 60000);
    total += g;
    if (g > longest) longest = g;
  }
  return { count: ts.length, avgGap: Math.round(total / (ts.length - 1)), longestGap: longest, firstAt: ts[0], lastAt: ts[ts.length - 1] };
}

function gapTone(mins) {
  if (mins == null) return "text-slate-300";
  return mins <= 20 ? "text-emerald-700" : mins <= 45 ? "text-amber-700" : "text-rose-700";
}
function gapKpiTone(mins) {
  if (mins == null) return "slate";
  return mins <= 20 ? "emerald" : mins <= 45 ? "amber" : "rose";
}

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
