"use client";
import { useState } from "react";
import {
  Phone,
  MessageCircle,
  BadgeCheck,
  PhoneOff,
  Mail,
  Clock,
  Loader2,
  Eye,
  StickyNote,
  CalendarClock,
  MapPin,
} from "lucide-react";
import { ShieldAlert, ShieldCheck, Zap, Percent, Send, MailOpen, Warehouse, Check, AlertTriangle, ClipboardList } from "lucide-react";
import { appHref } from "@/lib/paths";
import { emailStatusInfo, mergedEmailStatus, shareWarehouseKit } from "@/lib/crm";
import { nextAction } from "@/lib/scoring";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SLA_MINUTES = 15; // first-response SLA: contact a new lead within 15 min

// Escalating severity by overdue minutes: 1 = breach, 2 = high (30m+), 3 = critical (60m+).
function slaSeverity(mins) {
  if (mins >= 60) return 3;
  if (mins >= 30) return 2;
  return 1;
}

/* ----------------------------- Quote card ----------------------------- */
export default function QuoteCard({ q, esc, score, email, otp, booking, life, wh, wa, breach, breachMins, compact, onLogActivity, onQuickFollowUp }) {
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
            {(q.city || q.pickupAddress) && (
              <div className="mt-1 flex items-start gap-1 text-[11px] text-slate-500">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-indigo-400" />
                <span className="min-w-0">
                  {q.city && <span className="font-medium capitalize text-slate-600">{q.city}</span>}
                  {q.city && q.pickupAddress && <span className="text-slate-400"> · </span>}
                  {q.pickupAddress && <span className="line-clamp-2" title={q.pickupAddress}>{q.pickupAddress}</span>}
                </span>
              </div>
            )}
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
            {/* Quick follow-up — always available (status + date + note). */}
            {onQuickFollowUp && (
              <button
                onClick={onQuickFollowUp}
                title="Add follow-up"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition-colors hover:bg-amber-100"
              >
                <CalendarClock className="h-3.5 w-3.5" />
              </button>
            )}
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

      {/* Footer: follow-up date + full note + next action */}
      <div className="mt-3 border-t border-slate-100 pt-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FollowCell q={q} />
            {q.status && <StatusChip status={q.status} />}
            {q.verified ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                <BadgeCheck className="h-3.5 w-3.5" /> {q.lastContactAgo || "logged"}
              </span>
            ) : (
              <span className="text-slate-400">Not called yet</span>
            )}
          </div>
          <NbaChip nba={nba} />
        </div>
        {q.noteFull && String(q.noteFull).trim() && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-2">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
            <p className="whitespace-pre-line break-words text-[12px] leading-relaxed text-slate-700">
              {String(q.noteFull).trim()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Follow-up date as a colored pill: rose = overdue, amber = due today,
// slate = later — so the team spots it at a glance.
function FollowCell({ q }) {
  const cls =
    q.bucket === "overdue"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : q.bucket === "today"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold ${cls}`}>
      <CalendarClock className="h-3.5 w-3.5" />
      {q.followDate ? fmtDate(q.followDate) : "—"}
    </span>
  );
}

// The follow_up status (RNR, Contacted, Call later, …) shown beside the date.
function StatusChip({ status }) {
  const key = String(status).toLowerCase().trim();
  const cls =
    key === "rnr" || key === "no-answer"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : key === "contacted" || key === "called"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : key === "lost" || key === "invalid"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : key === "booked" || key === "won" || key === "converted"
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  const label = key
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/i, "RNR")
    .replace(/\bOtp\b/i, "OTP");
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/* ----------------------------- helpers ----------------------------- */
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
  const when = email?.lastEventAt || email?.sentAt;
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
export function LifecycleLegend() {
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

function fmtDateTime(dt) {
  if (!dt) return "—";
  const [date, time] = String(dt).split(" ");
  const hm = (time || "").slice(0, 5);
  return hm ? `${fmtDate(date)} · ${hm}` : fmtDate(date);
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
