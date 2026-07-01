"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, Loader2, RefreshCw, Crown, Medal, TrendingUp, Zap, Phone, MessageCircle, Eye, Flame } from "lucide-react";
import { getSession } from "@/lib/auth";
import { fetchLeaderboard, fetchQuotations } from "@/lib/crm";
import { scoreQuote, nextAction } from "@/lib/scoring";
import { evaluateEscalation } from "@/lib/escalations";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bookings leaderboard — team ranking from show_user_booking_ranking, with names
// and the logged-in rep highlighted.

export default function LeaderboardPage() {
  const [list, setList] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState(null);

  const load = useCallback((signal) => {
    const s = getSession();
    setLoading(true);
    const lb = fetchLeaderboard({ signal })
      .then((d) => {
        setList(d);
        setError("");
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load the leaderboard. Please refresh.");
      })
      .finally(() => setLoading(false));
    // your own quotations → quick-win candidates
    if (s) fetchQuotations(s.user_id, { signal }).then(setQuotes).catch(() => {});
    return lb;
  }, []);

  useEffect(() => {
    setMe(getSession()?.user_id != null ? String(getSession().user_id) : null);
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Quick wins: your warmest open quotes — close these for fast bookings. Scored
  // by win-probability, then ordered so the most bookable surface first.
  const quickWins = useMemo(() => {
    if (!quotes) return [];
    return quotes
      .filter((q) => !q.done && !q.lost)
      .map((q) => {
        const esc = evaluateEscalation(q);
        return { q, score: scoreQuote(q, esc), nba: nextAction(q, esc) };
      })
      .filter((c) => c.score.score >= 45 || /negoti/i.test(c.q.stage) || c.q.bucket === "today" || c.q.bucket === "overdue")
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, 12);
  }, [quotes]);

  const podium = useMemo(() => (list || []).slice(0, 3), [list]);
  const mine = useMemo(() => (list || []).find((r) => r.userId === me) || null, [list, me]);
  const maxBookings = useMemo(() => Math.max(1, ...(list || []).map((r) => r.bookings)), [list]);

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Trophy className="h-5 w-5" />
            </span>
            Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">Team rankings by bookings — see where you stand.</p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* your standing */}
      {mine && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-indigo-900">
              You&apos;re ranked #{mine.rank} of {list.length}
            </div>
            <div className="text-xs text-indigo-700">
              {mine.bookings} booking{mine.bookings === 1 ? "" : "s"}
              {mine.rank > 1 && list[mine.rank - 2] ? ` · ${list[mine.rank - 2].bookings - mine.bookings + 1} more to overtake #${mine.rank - 1}` : mine.rank === 1 ? " · top of the board 🎉" : ""}
            </div>
          </div>
        </div>
      )}

      {/* podium */}
      {!list ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((r, i) => (
            <PodiumCard key={r.userId} r={r} place={i + 1} isMe={r.userId === me} />
          ))}
        </div>
      )}

      {/* full table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <Th className="w-16">Rank</Th>
                <Th>Rep</Th>
                <Th>Bookings</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!list &&
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={3} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {list && list.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-16 text-center text-sm text-slate-400">No ranking data yet.</td>
                </tr>
              )}
              {(list || []).map((r) => (
                <Row key={r.userId} r={r} isMe={r.userId === me} max={maxBookings} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick wins — close these for fast bookings */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <Flame className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-bold text-slate-800">Quick wins — close these to climb</h2>
          {quotes && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600">{quickWins.length}</span>}
        </div>
        <p className="mb-3 text-xs text-slate-500">Your warmest open quotes, ranked by win-probability with their follow-up status.</p>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <Th>Customer</Th>
                  <Th>Follow-up</Th>
                  <Th className="hidden lg:table-cell">Last note</Th>
                  <Th>Win %</Th>
                  <Th className="hidden md:table-cell">Next action</Th>
                  <Th className="hidden xl:table-cell text-right">Value</Th>
                  <Th className="text-right">Go</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!quotes &&
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))}
                {quotes && quickWins.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                      No hot quotes right now — work your follow-up queue to warm some up.
                    </td>
                  </tr>
                )}
                {(quotes ? quickWins : []).map(({ q, score, nba }) => (
                  <WinRow key={q.id} q={q} score={score} nba={nba} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Quick-win row ----------------------------- */
function WinRow({ q, score, nba }) {
  const bandTone = score.band === "hot" ? "text-emerald-700" : score.band === "warm" ? "text-amber-700" : "text-slate-500";
  const bandBar = score.band === "hot" ? "bg-emerald-500" : score.band === "warm" ? "bg-amber-400" : "bg-slate-300";
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
            {String(q.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          <div className="min-w-0">
            <a href={appHref(`/customer/${q.id}`)} className="truncate text-sm font-semibold text-slate-800 hover:text-indigo-700">
              {q.name}
            </a>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
              {q.contact && <span className="tabular-nums">+91 {q.contact}</span>}
              {q.email && <span className="truncate">{q.email}</span>}
            </div>
            {(q.stage || q.status) && <div className="mt-0.5 text-[11px] capitalize text-slate-400">{q.stage || q.status}</div>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <FollowCell q={q} />
      </td>
      <td className="hidden px-4 py-3 align-top lg:table-cell">
        {q.note ? (
          <p
            className="line-clamp-3 max-w-[240px] break-words rounded-lg border border-l-4 border-amber-300 border-l-amber-500 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-slate-900 shadow-sm"
            title={q.noteFull || q.note}
          >
            {q.note}
          </p>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="min-w-[64px]" title={score.reasons?.length ? `Why: ${score.reasons.join(" · ")}` : ""}>
          <div className={`text-xs font-bold tabular-nums ${bandTone}`}>{score.score}%</div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${bandBar}`} style={{ width: `${score.score}%` }} />
          </div>
        </div>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {nba ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700">
            <Zap className="h-3 w-3" /> {nba.label}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-right xl:table-cell">
        <span className="text-xs font-semibold tabular-nums text-slate-700">{q.value ? `₹${q.value.toLocaleString("en-IN")}` : "—"}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <WinBtn href={appHref(`/customer/${q.id}`)} tone="view"><Eye className="h-3.5 w-3.5" /></WinBtn>
          {q.contact && (
            <>
              <WinBtn href={`tel:+91${q.contact}`} tone="call"><Phone className="h-3.5 w-3.5" /></WinBtn>
              <WinBtn href={`https://wa.me/91${q.contact}`} tone="whatsapp" external><MessageCircle className="h-3.5 w-3.5" /></WinBtn>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function FollowCell({ q }) {
  if (q.bucket === "overdue")
    return <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{q.overdueDays}d overdue</span>;
  if (q.bucket === "today")
    return <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Due today</span>;
  if (q.followDate)
    return <span className="text-xs text-slate-600">In {q.inDays}d · {fmtDate(q.followDate)}</span>;
  return <span className="text-xs text-slate-400">No date</span>;
}

function WinBtn({ href, tone, external, children }) {
  const tones = {
    call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    whatsapp: "border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
    view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
  };
  return (
    <a href={appHref(href)} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${tones[tone]}`}>
      {children}
    </a>
  );
}

function fmtDate(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  if (!m || !d) return "—";
  return `${+d} ${MONTHS[+m - 1]}`;
}

/* ----------------------------- Podium ----------------------------- */
function PodiumCard({ r, place, isMe }) {
  const styles = {
    1: { ring: "border-amber-300 bg-amber-50", badge: "bg-amber-400 text-white", icon: Crown, label: "🥇" },
    2: { ring: "border-slate-300 bg-slate-50", badge: "bg-slate-400 text-white", icon: Medal, label: "🥈" },
    3: { ring: "border-orange-300 bg-orange-50", badge: "bg-orange-400 text-white", icon: Medal, label: "🥉" },
  }[place];
  return (
    <div className={`relative rounded-2xl border-2 ${styles.ring} p-4 shadow-sm`}>
      {isMe && <span className="absolute right-3 top-3 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">You</span>}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{styles.label}</span>
        <Avatar name={r.name} large />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-900">{r.name}</div>
          <div className="text-xs text-slate-500">Rank #{r.rank}</div>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{r.bookings}</span>
        <span className="pb-1 text-xs text-slate-500">bookings</span>
      </div>
    </div>
  );
}

/* ----------------------------- Row ----------------------------- */
function Row({ r, isMe, max }) {
  const w = Math.round((r.bookings / max) * 100);
  return (
    <tr className={isMe ? "bg-indigo-50/60" : "hover:bg-slate-50/60"}>
      <td className="px-4 py-3">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
            r.rank === 1 ? "bg-amber-100 text-amber-700" : r.rank <= 3 ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-500"
          }`}
        >
          {r.rank}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} />
          <span className="text-sm font-semibold text-slate-800">{r.name}</span>
          {isMe && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">You</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${r.rank === 1 ? "bg-amber-400" : "bg-indigo-500"}`} style={{ width: `${Math.max(w, 3)}%` }} />
          </div>
          <span className="text-sm font-bold tabular-nums text-slate-700">{r.bookings}</span>
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- bits ----------------------------- */
function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name, large }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const size = large ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-700`}>
      {initials || "?"}
    </span>
  );
}
