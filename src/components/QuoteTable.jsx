"use client";

import { Phone, MessageCircle, Eye, CalendarClock } from "lucide-react";
import { appHref } from "@/lib/paths";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Lifecycle stage → dot colour (matches the card stepper).
const DOT = {
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  cyan: "bg-cyan-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
};

function fmtMoney(v) {
  const n = Number(v);
  if (!n) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function fmtDate(ymd) {
  if (!ymd) return "—";
  const [, m, d] = String(ymd).split("-");
  return `${+d} ${MONTHS[+m - 1]}`;
}
function fmtDateTime(dt) {
  if (!dt) return "—";
  const [date, time] = String(dt).split(" ");
  const hm = (time || "").slice(0, 5);
  return hm ? `${fmtDate(date)} · ${hm}` : fmtDate(date);
}
function stageBadge(stage) {
  const s = String(stage || "").toLowerCase();
  if (!stage) return { label: "—", cls: "bg-slate-100 text-slate-500" };
  if (/negoti/.test(s)) return { label: stage, cls: "bg-amber-100 text-amber-800 ring-1 ring-amber-200" };
  if (/won|book/.test(s)) return { label: stage, cls: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200" };
  if (/lost|invalid/.test(s)) return { label: stage, cls: "bg-rose-100 text-rose-700 ring-1 ring-rose-200" };
  if (/quot/.test(s)) return { label: stage, cls: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200" };
  if (/contact/.test(s)) return { label: stage, cls: "bg-violet-100 text-violet-800 ring-1 ring-violet-200" };
  if (/new/.test(s)) return { label: stage, cls: "bg-sky-100 text-sky-800 ring-1 ring-sky-200" };
  return { label: stage, cls: "bg-slate-200 text-slate-700 ring-1 ring-slate-300" };
}

// Bigger lifecycle stepper for a table cell — connected stage nodes (checkmark for
// done, ring for current) with the current step label. Lifecycle is mandatory.
function MiniLifecycle({ life }) {
  if (!life || !life.steps) return <span className="text-slate-300">—</span>;
  const { steps, furthest, total } = life;
  const cur = steps[furthest];
  return (
    <div className="whitespace-nowrap" title={`Step ${furthest + 1} of ${total} — ${cur?.label || ""}`}>
      <div className="flex items-center">
        {steps.map((s, i) => {
          const reached = i <= furthest;
          const isCur = i === furthest;
          const last = i === steps.length - 1;
          return (
            <div key={s.key} className="flex items-center">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${reached ? DOT[s.tone] || "bg-emerald-500" : "bg-slate-200 text-slate-400"} ${isCur ? "ring-2 ring-slate-300 ring-offset-1" : ""}`}
              >
                {reached && !isCur ? "✓" : isCur ? "●" : ""}
              </span>
              {!last && <span className={`h-1 w-4 ${i < furthest ? DOT[s.tone] || "bg-emerald-500" : "bg-slate-200"}`} />}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-xs font-bold text-slate-700">
        {cur?.label} <span className="font-medium text-slate-400">· {furthest + 1}/{total}</span>
      </div>
    </div>
  );
}

const IB = {
  call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  whatsapp: "border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
  view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
  follow: "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100",
};

// Shared table view for quote/customer cohorts. Each page passes accessors so it
// can key its own enrichment maps (getBooking / getLife). When `onQuickFollowUp`
// is provided, each row gets an "add / update follow-up note" action (parity
// with the card view's quick follow-up button).
export default function QuoteTable({ rows, getBooking, getLife, onQuickFollowUp }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 bg-slate-50 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3 pl-5">Customer</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">City</th>
            <th className="px-4 py-3">Pickup address</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3 text-center">Booking</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Follow-up</th>
            <th className="px-4 py-3">Follow-up note</th>
            <th className="px-4 py-3">Rep</th>
            <th className="whitespace-nowrap px-4 py-3">Created</th>
            <th className="px-4 py-3">Lifecycle</th>
            <th className="px-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const booking = getBooking ? getBooking(q) : null;
            const life = getLife ? getLife(q) : null;
            const st = stageBadge(q.stage || q.status);
            return (
              <tr key={q.id} className="border-b-2 border-slate-100 align-middle transition-colors odd:bg-white even:bg-slate-50/40 last:border-0 hover:bg-indigo-50/50">
                <td className="px-4 py-3 pl-5">
                  <a href={appHref(`/customer/${q.id}`)} className="font-semibold text-slate-900 hover:text-indigo-700">{q.name}</a>
                  {q.uid && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{q.uid}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-bold tabular-nums text-slate-900">{q.contact ? `+91 ${q.contact}` : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3">
                  {q.email ? (
                    <a href={`mailto:${q.email}`} title={q.email} className="block min-w-[200px] break-all font-medium text-slate-700 hover:text-indigo-600">{q.email}</a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 capitalize text-slate-600">{q.city || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 align-top">
                  {q.pickupAddress ? (
                    <div className="min-w-[220px] max-w-[360px] whitespace-pre-line break-words text-xs font-medium leading-snug text-slate-700">
                      {q.pickupAddress}
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-800">{fmtMoney(q.value)}</td>
                <td className="px-4 py-3 text-center"><BookingPill booking={booking} /></td>
                <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold capitalize ${st.cls}`}>{st.label}</span></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{q.followDate ? fmtDate(q.followDate) : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 align-top">
                  {q.noteFull || q.note ? (
                    <div className="max-h-32 min-w-[200px] max-w-[320px] overflow-y-auto whitespace-pre-line break-words rounded-lg border border-l-4 border-amber-300 border-l-amber-500 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-slate-900 shadow-sm">
                      {q.noteFull || q.note}
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{q.rep || <span className="text-slate-300">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[11px] text-slate-400">{fmtDateTime(q.createdAt)}</td>
                <td className="px-4 py-3"><MiniLifecycle life={life} /></td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    {onQuickFollowUp && (
                      <button
                        type="button"
                        onClick={() => onQuickFollowUp(q)}
                        title="Add / update follow-up note"
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border ${IB.follow}`}
                      >
                        <CalendarClock className="h-4 w-4" />
                      </button>
                    )}
                    {q.contact && (
                      <>
                        <a href={`tel:+91${q.contact}`} title="Call" className={`flex h-8 w-8 items-center justify-center rounded-lg border ${IB.call}`}><Phone className="h-4 w-4" /></a>
                        <a href={`https://wa.me/91${q.contact}`} target="_blank" rel="noreferrer" title="WhatsApp" className={`flex h-8 w-8 items-center justify-center rounded-lg border ${IB.whatsapp}`}><MessageCircle className="h-4 w-4" /></a>
                      </>
                    )}
                    <a href={appHref(`/customer/${q.id}`)} title="View" className={`flex h-8 w-8 items-center justify-center rounded-lg border ${IB.view}`}><Eye className="h-4 w-4" /></a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Booking-probability as a colour-graded pill (green ≥60, amber ≥30, else grey).
function BookingPill({ booking }) {
  if (!booking) return <span className="text-slate-300">—</span>;
  const s = booking.score;
  const cls = s >= 60 ? "bg-emerald-100 text-emerald-700" : s >= 30 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`inline-flex min-w-[46px] justify-center rounded-full px-2 py-1 text-[11px] font-bold tabular-nums ${cls}`}>{s}%</span>;
}
