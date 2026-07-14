"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, GripVertical } from "lucide-react";
import { fetchLeaderboard, fetchTeamBookings } from "@/lib/crm";
import { getSession } from "@/lib/auth";

// An always-on standings panel filling the right column of every tab. Shows this
// month's top 3 by bookings and where the logged-in rep stands. It's a real
// layout column (not a floating overlay), so page content reserves space for it
// and nothing is covered. Reps can't dismiss it, but they CAN drag its left edge
// to resize it (narrower/wider) — the chosen width is remembered per browser.

const medals = ["🥇", "🥈", "🥉"];
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "—";
const DAILY_TARGET = 5; // bookings per rep per day
const pad2 = (n) => String(n).padStart(2, "0");
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dOnly = (s) => String(s || "").slice(0, 10);
const WIDTH_KEY = "standings_width";
// Min width is set so the widest column (medal + first name + booking count) stays
// legible — reps can shrink it, but only until names still show clearly.
const MIN_W = 230;
const MAX_W = 380;
const DEFAULT_W = 264;
const clampW = (w) => Math.max(MIN_W, Math.min(MAX_W, w));

export default function StandingsBanner() {
  const [list, setList] = useState(null);
  const [me, setMe] = useState(null);
  const [todayCount, setTodayCount] = useState(null);
  const [width, setWidth] = useState(DEFAULT_W);
  const widthRef = useRef(DEFAULT_W);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved >= MIN_W && saved <= MAX_W) { setWidth(saved); widthRef.current = saved; }
    } catch { /* ignore */ }
    const s = getSession();
    const meId = s?.user_id != null ? String(s.user_id) : null;
    setMe(meId);
    const ctrl = new AbortController();
    fetchLeaderboard({ signal: ctrl.signal }).then(setList).catch(() => setList([]));
    // Today's own bookings → progress toward the daily target.
    fetchTeamBookings({ signal: ctrl.signal })
      .then((bk) => {
        const t = todayYmd();
        setTodayCount(bk.filter((b) => meId && String(b.repId) === meId && dOnly(b.date) === t).length);
      })
      .catch(() => setTodayCount(0));
    return () => ctrl.abort();
  }, []);

  // Drag the left edge to resize. Dragging right → narrower, left → wider.
  const startResize = useCallback((e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    const startW = widthRef.current;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev) => {
      const w = clampW(startW - (ev.clientX - startX));
      widthRef.current = w;
      setWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const top3 = (list || []).slice(0, 3);
  const mine = me && list ? list.find((r) => r.userId === me) : null;
  const inTop3 = mine && mine.rank <= 3;
  const nextUp = mine && mine.rank > 1 && list ? list[mine.rank - 2] : null;

  return (
    <aside className="relative hidden shrink-0 border-l border-slate-200 bg-slate-50 md:block" style={{ width }}>
      {/* Resize handle on the left edge */}
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="group absolute left-0 top-0 z-10 flex h-full w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
      >
        <span className="h-full w-0.5 bg-transparent transition group-hover:bg-indigo-300" />
        <GripVertical className="absolute h-4 w-4 rounded bg-white text-slate-300 opacity-0 shadow ring-1 ring-slate-200 transition group-hover:opacity-100" />
      </div>

      <div className="sticky top-0 flex h-screen flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-4 text-white shadow-sm">
          <Trophy className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight">Booking Champions</p>
            <p className="text-xs text-white/80">This month</p>
          </div>
        </div>

        {list === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">No standings yet.</p>
        ) : (
          <>
            {/* Top 3 */}
            <ul className="space-y-2.5">
              {top3.map((r) => {
                const isMe = mine && r.userId === mine.userId;
                return (
                  <li key={r.userId}
                    className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm ${isMe ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200" : "border-slate-200 bg-white"}`}>
                    <span className="text-2xl leading-none">{medals[r.rank - 1] || r.rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{firstName(r.name)}{isMe ? " (you)" : ""}</p>
                      <p className="whitespace-nowrap text-[11px] text-slate-400">Rank #{r.rank}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold tabular-nums text-slate-900">{r.bookings}</p>
                      <p className="text-[10px] text-slate-400">bookings</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Today's target — the daily nudge */}
            <div className="my-auto">
              {(() => {
                const done = todayCount ?? 0;
                const hit = done >= DAILY_TARGET;
                const left = Math.max(0, DAILY_TARGET - done);
                const pct = Math.min(100, Math.round((done / DAILY_TARGET) * 100));
                return (
                  <div className={`rounded-2xl border p-4 text-center shadow-sm ${hit ? "border-emerald-200 bg-emerald-50" : "border-indigo-100 bg-indigo-50/60"}`}>
                    <p className="text-xs font-medium text-slate-500">Today&apos;s bookings</p>
                    <p className="my-1 text-3xl font-extrabold tabular-nums text-indigo-600">
                      {todayCount === null ? "—" : done}
                      <span className="text-lg font-bold text-slate-400"> / {DAILY_TARGET}</span>
                    </p>
                    <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-indigo-100">
                      <div className={`h-full rounded-full ${hit ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className={`mt-2 text-xs font-semibold ${hit ? "text-emerald-600" : "text-slate-600"}`}>
                      {todayCount === null ? " " : hit ? "🎯 Target smashed! 🔥" : done === 0 ? "Let's get the first one! 💪" : `${left} more to hit today's target`}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Your standing */}
            <div className={`rounded-2xl p-4 text-center shadow-sm ${inTop3 ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-white ring-1 ring-slate-200"}`}>
              {mine ? (
                inTop3 ? (
                  <>
                    <p className="text-3xl font-extrabold tabular-nums text-emerald-600">#{mine.rank}</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-700">You&apos;re on the podium 🎉</p>
                    <p className="mt-0.5 text-xs text-emerald-600/80">{mine.rank === 1 ? "Top of the board — keep it!" : "Keep climbing!"}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-slate-400">Your position</p>
                    <p className="text-3xl font-extrabold tabular-nums text-indigo-600">#{mine.rank}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{mine.bookings} booking{mine.bookings === 1 ? "" : "s"}</p>
                    {nextUp && (
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="font-bold text-indigo-600">{nextUp.bookings - mine.bookings + 1}</span> more to pass #{mine.rank - 1}
                      </p>
                    )}
                  </>
                )
              ) : (
                <>
                  <p className="text-2xl">💪</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">Not on the board yet</p>
                  <p className="mt-0.5 text-xs text-slate-500">Land a booking to get ranked!</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
