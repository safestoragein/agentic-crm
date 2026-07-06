"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, MailOpen, MousePointerClick, RefreshCw, Warehouse, X, Phone } from "lucide-react";
import { fetchRecentEngagement, timeAgoLabel } from "@/lib/crm";
import { getSession } from "@/lib/auth";

const TONES = {
  indigo: { dot: "bg-indigo-500", text: "text-indigo-700", ring: "ring-indigo-200" },
  amber: { dot: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-200" },
  emerald: { dot: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200" },
  violet: { dot: "bg-violet-500", text: "text-violet-700", ring: "ring-violet-200" },
};
const ICON = {
  opened: MailOpen,
  revisit: RefreshCw,
  clicked: MousePointerClick,
  wh_viewed: Warehouse,
  wh_clicked: Warehouse,
};

// short, attention-grabbing two-tone chime
let _aCtx = null;
function alertChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_aCtx) _aCtx = new Ctx();
    if (_aCtx.state === "suspended") _aCtx.resume();
    const ctx = _aCtx;
    [988, 1319].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.start(t0);
      o.stop(t0 + 0.2);
    });
  } catch {}
}
// Merge two alert lists keeping a single entry per `key` (customer+kind). Fresh
// entries win over existing ones; order is fresh-first, then the rest.
function mergeByKey(fresh, prev) {
  const seen = new Set();
  const out = [];
  for (const a of [...fresh, ...prev]) {
    const k = a.key ?? a.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function desktopNotify(a) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`🔔 ${a.name} ${a.message}`, { body: a.city || "", tag: `eng-${a.id}` });
    }
  } catch {}
}

export default function AlertCenter() {
  const router = useRouter();
  const [alerts, setAlerts] = useState([]); // full history (panel)
  const [toasts, setToasts] = useState([]); // bottom-right
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const lastSeen = useRef(0);
  const inited = useRef(false);
  const [mounted, setMounted] = useState(false); // portal target ready (client only)
  const panelRef = useRef(null); // bell + dropdown wrapper, for outside-click

  useEffect(() => setMounted(true), []);

  // Close the dropdown on any click/tap outside it. A document listener is used
  // instead of a full-screen overlay because this component lives inside the
  // TopBar's backdrop-filter, which traps `position: fixed` to the header box
  // (so an `inset-0` overlay wouldn't actually cover the page body).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const poll = useCallback((signal) => {
    const s = getSession();
    return fetchRecentEngagement(s?.user_id, { signal })
      .then((evs) => {
        if (!evs || !evs.length) return;
        const maxId = evs[0].id; // backend returns newest-first

        if (!inited.current) {
          const saved = Number(localStorage.getItem("alertLastSeen") || 0);
          const base = saved || maxId;
          setAlerts(evs);
          setUnread(saved ? evs.filter((e) => e.id > saved).length : 0);
          lastSeen.current = maxId;
          localStorage.setItem("alertLastSeen", String(maxId));
          inited.current = true;
          void base;
          return;
        }

        const fresh = evs.filter((e) => e.id > lastSeen.current);
        if (fresh.length) {
          lastSeen.current = maxId;
          localStorage.setItem("alertLastSeen", String(maxId));
          // Merge keeping one entry per customer+kind (key): a fresh event for a
          // customer who's already in the list replaces the old one instead of
          // stacking a duplicate.
          setAlerts((prev) => mergeByKey(fresh, prev).slice(0, 100));
          setUnread((u) => u + fresh.length);
          setToasts((prev) => mergeByKey(fresh.slice(0, 4), prev).slice(0, 4));
          alertChime();
          fresh.slice(0, 3).forEach(desktopNotify);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    poll(ctrl.signal);
    const t = setInterval(() => poll(), 45000);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const unlock = () => _aCtx && _aCtx.state === "suspended" && _aCtx.resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      ctrl.abort();
      clearInterval(t);
      window.removeEventListener("pointerdown", unlock);
    };
  }, [poll]);

  // Auto-dismiss each toast on its own 5s timer so the team never has to close
  // them by hand — even when alerts arrive in a burst. Each toast gets exactly
  // one timer (tracked by id); timers for toasts that were dismissed early are
  // cleared so nothing leaks.
  const toastTimers = useRef(new Map());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    toasts.forEach((t) => {
      if (toastTimers.current.has(t.id)) return;
      const handle = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        toastTimers.current.delete(t.id);
      }, 5000);
      toastTimers.current.set(t.id, handle);
    });
    for (const [id, handle] of toastTimers.current) {
      if (!live.has(id)) {
        clearTimeout(handle);
        toastTimers.current.delete(id);
      }
    }
  }, [toasts]);

  // Clear every pending timer on unmount.
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const goTo = (a) => {
    setOpen(false);
    setToasts((prev) => prev.filter((t) => t.id !== a.id));
    router.push(`/customer/${a.customerId}`);
  };

  return (
    <>
      {/* Top bell + dropdown */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={() => {
            setOpen((o) => !o);
            setUnread(0);
          }}
          title="Customer engagement alerts"
          className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50"
        >
          <Bell className={`h-4.5 w-4.5 ${unread > 0 ? "animate-swing text-amber-500" : ""}`} />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-11 z-40 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-sm font-bold text-slate-800">
              <Bell className="h-4 w-4 text-amber-500" /> Engagement alerts
              {alerts.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">{alerts.length}</span>
              )}
            </div>
            <div className="max-h-[28rem] overflow-y-auto">
              {alerts.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-slate-400">No engagement yet. Opens, revisits and clicks will appear here.</p>
              ) : (
                alerts.map((a) => <AlertRow key={a.id} a={a} onClick={() => goTo(a)} />)
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom-right live toasts — portaled to <body> so they aren't trapped by
          the TopBar's backdrop-filter (which would make `fixed` resolve against
          the header box and clip the toast at the top of the page). */}
      {mounted && toasts.length > 0 && createPortal(
        <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
          {toasts.length > 1 && (
            <div className="flex justify-end">
              <button
                onClick={() => setToasts([])}
                className="rounded-full bg-slate-800/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur hover:bg-slate-900"
              >
                Clear all ({toasts.length})
              </button>
            </div>
          )}
          {toasts.map((a) => {
            const t = TONES[a.tone] || TONES.indigo;
            const Icon = ICON[a.kind] || MailOpen;
            return (
              <div
                key={a.id}
                onClick={() => goTo(a)}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg ring-1 ${t.ring} animate-slidein`}
              >
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.dot} text-white`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-slate-800">{a.name}</span>
                    <StageBadge booked={a.booked} />
                  </div>
                  <div className={`text-xs font-semibold ${t.text}`}>{a.message}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    {a.city && <span className="capitalize">{a.city}</span>}
                    <span>· just now</span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setToasts((prev) => prev.filter((x) => x.id !== a.id));
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function AlertRow({ a, onClick }) {
  const t = TONES[a.tone] || TONES.indigo;
  const Icon = ICON[a.kind] || MailOpen;
  return (
    <button onClick={onClick} className="flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-50">
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.dot} text-white`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-800">{a.name}</span>
          <span className="text-[11px] font-normal text-slate-400">{a.uid}</span>
          <StageBadge booked={a.booked} />
        </div>
        <div className={`text-xs font-semibold ${t.text}`}>{a.message}</div>
      </div>
      <span className="shrink-0 text-[11px] text-slate-400">{a.at ? timeAgoLabel(a.at) : ""}</span>
    </button>
  );
}

// Shows whether the customer is already booked or still a quotation/lead.
function StageBadge({ booked }) {
  return booked ? (
    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
      Booked
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
      Quotation
    </span>
  );
}
