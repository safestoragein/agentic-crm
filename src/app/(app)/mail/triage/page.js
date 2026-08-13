"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  Flame,
  Loader2,
  RefreshCw,
  Sparkles,
  Gauge,
  Mail,
  ChevronRight,
  X,
  UserPlus,
  MessageSquareWarning,
} from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import { MAILBOXES } from "@/lib/mailboxes";
import { fetchTriage, coachReply, shortDate } from "@/lib/mail";
import { PRIORITIES, TONES, humanAge } from "@/lib/triage";
import { gradeFor } from "@/lib/replyScore";

const RANGES = [3, 7, 14, 30];

export default function TriagePage() {
  return (
    <AdminOnly>
      <TriagePageInner />
    </AdminOnly>
  );
}

function TriagePageInner() {
  const [days, setDays] = useState(7);
  const [boxes, setBoxes] = useState([]); // [] = all
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [coachFor, setCoachFor] = useState(null); // thread being coached

  const key = `${days}|${boxes.join(",")}|${nonce}`;
  const [loadedKey, setLoadedKey] = useState(null);
  const loading = loadedKey !== key;

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTriage({ days, mailboxes: boxes, signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setError("");
        setLoadedKey(key);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Could not load the triage board");
        setData(null);
        setLoadedKey(key);
      });
    return () => ctrl.abort();
  }, [days, boxes, key]);

  const closeCoach = useCallback(() => setCoachFor(null), []);

  const toggleBox = useCallback((k) => {
    setBoxes((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }, []);

  const stats = data?.stats;
  const threads = data?.threads || [];
  const overdue = threads.filter((t) => t.overdue);
  const rest = threads.filter((t) => !t.overdue);

  return (
    <div className="px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <Gauge className="h-5 w-5 text-indigo-500" />
            Mail Triage
          </h1>
          <p className="text-xs text-slate-400">
            Every shared mailbox, ranked by how badly the customer needs an answer.
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {MAILBOXES.map((m) => (
            <button
              key={m.key}
              onClick={() => toggleBox(m.key)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                boxes.length === 0 || boxes.includes(m.key)
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-400 hover:bg-slate-50"
              }`}
            >
              {m.label}
            </button>
          ))}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600"
          >
            {RANGES.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          <button
            onClick={() => setNonce((n) => n + 1)}
            title="Refresh"
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        stats && (
          <>
            <StatRow stats={stats} />
            <MailboxTable stats={stats} />

            {/* Bucket 1 — the explicit ask: anything waiting on us > 3 days. */}
            <Bucket
              title="Waiting more than 3 days"
              subtitle="Nobody from the team has answered these. Clear this bucket first."
              tone="rose"
              icon={AlertTriangle}
              threads={overdue}
              onCoach={setCoachFor}
              emptyText="Nothing older than 3 days — the queue is clean."
            />

            {["P1", "P2", "P3"].map((p) => (
              <Bucket
                key={p}
                title={`${p} · ${PRIORITIES[p].name}`}
                subtitle={
                  p === "P1"
                    ? "New enquiries, angry customers, and anything threatening escalation."
                    : p === "P2"
                      ? "Negative tone or waiting over a day."
                      : "Routine and positive mail."
                }
                tone={p === "P1" ? "rose" : p === "P2" ? "amber" : "slate"}
                icon={p === "P1" ? Flame : p === "P2" ? Clock : Mail}
                threads={rest.filter((t) => t.priority === p)}
                onCoach={setCoachFor}
                collapsed={p === "P3"}
              />
            ))}
          </>
        )
      )}

      {coachFor && <CoachDrawer thread={coachFor} onClose={closeCoach} />}
    </div>
  );
}

function StatRow({ stats }) {
  const tiles = [
    { label: "Over 3 days", value: stats.overdue, tone: "rose", icon: AlertTriangle },
    { label: "P1 now", value: stats.p1, tone: "rose", icon: Flame },
    { label: "P2 today", value: stats.p2, tone: "amber", icon: Clock },
    { label: "P3 routine", value: stats.p3, tone: "slate", icon: Mail },
    { label: "New leads", value: stats.newEnquiries, tone: "indigo", icon: UserPlus },
    { label: "Escalations", value: stats.escalations, tone: "rose", icon: MessageSquareWarning },
    { label: "Awaiting", value: stats.unanswered, tone: "amber", icon: Clock },
    {
      label: "Median reply",
      value: stats.medianFirstResponseHours == null ? "—" : humanAge(stats.medianFirstResponseHours),
      tone: "slate",
      icon: Gauge,
    },
  ];
  const toneCls = {
    rose: "text-rose-600",
    amber: "text-amber-600",
    indigo: "text-indigo-600",
    slate: "text-slate-700",
  };

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <t.icon className="h-3.5 w-3.5" />
            <span className="truncate">{t.label}</span>
          </div>
          <p className={`mt-1 text-2xl font-bold ${toneCls[t.tone]}`}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

function MailboxTable({ stats }) {
  const rows = Object.entries(stats.byMailbox || {});
  if (!rows.length) return null;
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2 font-medium">Mailbox</th>
            <th className="px-4 py-2 font-medium">Threads</th>
            <th className="px-4 py-2 font-medium">&gt;3 days</th>
            <th className="px-4 py-2 font-medium">P1</th>
            <th className="px-4 py-2 font-medium">Awaiting</th>
            <th className="px-4 py-2 font-medium">Median 1st reply</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(([key, r]) => (
            <tr key={key}>
              <td className="px-4 py-2 font-medium text-slate-700">
                <Link href={`/mail/${key}`} className="hover:text-indigo-600">
                  {r.label}
                </Link>
                {r.error && <span className="ml-2 text-xs text-rose-500">({r.error})</span>}
              </td>
              <td className="px-4 py-2 text-slate-600">{r.total}</td>
              <td className={`px-4 py-2 font-semibold ${r.overdue ? "text-rose-600" : "text-slate-400"}`}>
                {r.overdue}
              </td>
              <td className={`px-4 py-2 font-semibold ${r.p1 ? "text-rose-600" : "text-slate-400"}`}>{r.p1}</td>
              <td className="px-4 py-2 text-slate-600">{r.unanswered}</td>
              <td className="px-4 py-2 text-slate-600">
                {r.medianFirstResponseHours == null ? "—" : humanAge(r.medianFirstResponseHours)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bucket({ title, subtitle, tone, icon: Icon, threads, onCoach, emptyText, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  const ring = {
    rose: "border-rose-200 bg-rose-50/40",
    amber: "border-amber-200 bg-amber-50/40",
    slate: "border-slate-200 bg-white",
  }[tone];
  const iconCls = { rose: "text-rose-500", amber: "text-amber-500", slate: "text-slate-400" }[tone];

  return (
    <section className={`mt-5 rounded-xl border ${ring}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Icon className={`h-5 w-5 shrink-0 ${iconCls}`} />
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-800">
            {title}
            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              {threads.length}
            </span>
          </span>
          <span className="block truncate text-xs text-slate-500">{subtitle}</span>
        </span>
        <ChevronRight
          className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          {threads.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-400">{emptyText || "Nothing here."}</p>
          ) : (
            threads.map((t) => <ThreadCard key={t.id} t={t} onCoach={onCoach} />)
          )}
        </div>
      )}
    </section>
  );
}

function ThreadCard({ t, onCoach }) {
  const pri = PRIORITIES[t.priority];
  const tone = TONES[t.tone] || TONES.neutral;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${pri.cls}`}>{t.priority}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.cls}`}>{tone.label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          {t.mailboxLabel}
        </span>
        {t.isNewEnquiry && (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
            New enquiry
          </span>
        )}
        {t.escalation && (
          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
            Escalation
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">
          {t.awaitingHours != null ? `waiting ${humanAge(t.awaitingHours)}` : shortDate(t.receivedDateTime)}
        </span>
      </div>

      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800">{t.subject}</p>
      <p className="truncate text-xs text-slate-500">
        {t.from} · {t.fromAddress}
        {t.customerMsgCount > 1 && ` · ${t.customerMsgCount} messages`}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.preview}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {t.reasons.map((r) => (
          <span key={r} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${pri.soft}`}>
            {r}
          </span>
        ))}
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => onCoach(t)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Reply check
          </button>
          <Link
            href={`/mail/${t.mailbox}?msg=${encodeURIComponent(t.id)}`}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}

// Right-hand drawer: the exchange, the score, and (one button away) a better reply.
function CoachDrawer({ thread, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showImproved, setShowImproved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Lock the board behind the drawer and wire Escape — without this the long
  // triage list keeps scrolling under the overlay.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const ctrl = new AbortController();
    coachReply({ box: thread.mailbox, conversationId: thread.conversationId, signal: ctrl.signal })
      .then(setData)
      .catch((e) => {
        if (e?.name !== "AbortError") setError(e?.message || "Could not score this thread");
      });
    return () => ctrl.abort();
  }, [thread]);

  const grade = data ? gradeFor(data.score.total) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-800">{thread.subject}</h2>
            <p className="truncate text-xs text-slate-400">
              {thread.from} · {thread.mailboxLabel}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <p className="px-5 py-8 text-sm text-rose-600">{error}</p>
        ) : !data ? (
          <div className="flex h-40 items-center justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5 px-5 py-4">
            {data.awaitingReply && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {data.neverAnswered
                    ? "This thread has never been answered."
                    : "The customer has written again since our last reply — the score below grades that earlier reply."}
                </span>
              </div>
            )}

            {/* score */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-slate-800">{data.score.total}</span>
                <span className="text-sm text-slate-400">/ 100</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${grade.cls}`}>
                  {grade.label}
                </span>
                {data.responseHours != null && (
                  <span className="ml-auto text-xs text-slate-500">
                    replied in {humanAge(data.responseHours)}
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {data.score.breakdown.map((b) => (
                  <div key={b.key}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-slate-600">{b.label}</span>
                      <span className="text-slate-400">
                        {b.score}/{b.max} · {b.note}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          b.score / b.max >= 0.75
                            ? "bg-emerald-400"
                            : b.score / b.max >= 0.45
                              ? "bg-amber-400"
                              : "bg-rose-400"
                        }`}
                        style={{ width: `${(b.score / b.max) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Exchange label="Customer wrote" text={data.customer.text} tone="slate" />
            <Exchange
              label={data.reply ? "We replied" : "We never replied"}
              text={data.reply?.text || "No reply was ever sent on this thread."}
              tone={data.reply ? "slate" : "rose"}
            />

            {/* the one button */}
            {!showImproved ? (
              <button
                onClick={() => setShowImproved(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Sparkles className="h-4 w-4" /> Show improved version
              </button>
            ) : data.ai ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Biggest miss
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{data.ai.biggestMiss}</p>
                  {data.ai.critique?.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {data.ai.critique.map((c, i) => (
                        <li key={i} className="flex gap-2 text-sm text-slate-600">
                          <span className="text-indigo-400">·</span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Suggested reply
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(data.ai.improvedReply);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="ml-auto rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {data.ai.improvedReply}
                  </p>
                  <p className="mt-3 text-[11px] text-emerald-800/70">
                    A draft to adapt — check any prices, dates and policies before sending.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {data.aiUnavailable || "AI coaching is unavailable right now."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Exchange({ label, text, tone }) {
  return (
    <div>
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          tone === "rose" ? "text-rose-600" : "text-slate-400"
        }`}
      >
        {label}
      </p>
      <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
        {text}
      </pre>
    </div>
  );
}
