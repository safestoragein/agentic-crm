"use client";

// Shared admin presentational components — used by both the Team Report
// (/admin) and the Agent-wise Stats (/admin/agents) pages.
import { X, Phone, MessageCircle, Mail, MailOpen, BadgeCheck, Clock, AlertTriangle, ShieldCheck, Flame, Lightbulb } from "lucide-react";
import { fmtMins } from "@/lib/escalations";
import { isFakeFollowup, LOSS_LABELS, LOSS_ACTION } from "@/lib/adminReport";

export function fmtMoney(v) {
  const n = Number(v);
  if (!n) return "₹0";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
export const fmtResp = (m) => (m == null ? "—" : fmtMins(m));

export function SectionTitle({ icon: Icon, text }) {
  return <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="h-4 w-4 text-indigo-500" /> {text}</h2>;
}

export function ConvBadge({ pct }) {
  const tone = pct >= 25 ? "bg-emerald-50 text-emerald-700" : pct >= 10 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{pct}%</span>;
}

// Highlight reps logging fake / low-effort follow-ups (claimed contact, no call).
export function FakeFollowupCallout({ reps }) {
  const flagged = reps.filter((r) => r.fakeFollowups > 0).sort((a, b) => b.fakeFollowups - a.fakeFollowups);
  if (flagged.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-2.5 text-sm text-emerald-700">
        <ShieldCheck className="h-4 w-4" /> No fake / low-effort follow-ups detected in this window.
      </div>
    );
  }
  return (
    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-bold text-rose-700">
        <AlertTriangle className="h-4 w-4" /> Fake / low-effort follow-ups — contact claimed but no call logged
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {flagged.map((r) => (
          <span key={r.repId} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
            {r.name} · {r.fakeFollowups}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AgentStat({ label, value, tone = "text-slate-800", danger }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${danger ? "border-rose-200 bg-rose-50/60" : "border-slate-100 bg-slate-50/60"}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${danger ? "text-rose-600" : tone}`}>{value}</div>
    </div>
  );
}

export function AgentCard({ r, rank, onClick }) {
  return (
    <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/30">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{rank}</span>
          <span className="font-bold text-slate-800">{r.name}</span>
        </div>
        <ConvBadge pct={r.conversion} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <AgentStat label="Quotes" value={r.quotes} />
        <AgentStat label="Booked" value={r.bookings} tone="text-emerald-600" />
        <AgentStat label="Leads" value={r.leads || "—"} />
        <AgentStat label={r.waWindowed ? "WA sent" : "WA sent*"} value={r.waSent || "—"} />
        <AgentStat label="WA seen" value={r.waSeen || "—"} />
        <AgentStat label="Emailed" value={r.emailSent || "—"} />
        <AgentStat label="Opened" value={r.opened || "—"} />
        <AgentStat label="OTP" value={r.otp || "—"} />
        <AgentStat label="Contact %" value={r.contactPct == null ? "—" : `${r.contactPct}%`} />
        <AgentStat label="Avg resp" value={fmtResp(r.avgResponse)} />
        <AgentStat label="Pending FUs" value={r.overdue || "—"} tone={r.overdue ? "text-amber-600" : "text-slate-800"} />
        <AgentStat label="SLA breach" value={r.slaBreaches || "—"} danger={r.slaBreaches > 0} />
        <AgentStat label="Not contacted" value={r.notContacted || "—"} tone={r.notContacted ? "text-rose-600" : "text-slate-800"} />
        <AgentStat label="Calls*" value={r.calls || "—"} />
        <AgentStat label="Fake FUs" value={r.fakeFollowups || "—"} danger={r.fakeFollowups > 0} />
      </div>
    </button>
  );
}

export function Mini({ label, value, tone = "text-slate-700", icon: Icon }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">{Icon ? <Icon className="h-3 w-3" /> : null}{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export function Funnel({ steps }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-1.5">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-slate-500">{s.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100"><div className={`h-full ${s.tone}`} style={{ width: `${Math.round((s.value / max) * 100)}%` }} /></div>
          <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-slate-700">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// Lists the specific quotes flagged as fake / low-effort follow-ups for a rep.
export function FakeFollowupList({ quotes }) {
  const fakes = (quotes || []).filter(isFakeFollowup);
  if (fakes.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-600">
        <AlertTriangle className="h-3.5 w-3.5" /> Fake / low-effort follow-ups ({fakes.length})
      </h3>
      <p className="mb-2 text-[11px] text-slate-400">Marked contacted but no connected call logged — review these.</p>
      <div className="space-y-1.5">
        {fakes.slice(0, 30).map((q) => (
          <div key={q.id} className="rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-slate-800">{q.name}</span>
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold capitalize text-rose-600 ring-1 ring-rose-200">{q.status || "contacted"}</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500" title={q.noteFull || ""}>
              {q.noteFull ? `“${q.noteFull.slice(0, 80)}”` : "no note"} · {q.city || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RepDrawer({ rep, quotes, onClose }) {
  const stages = Object.entries(rep.stages || {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{rep.name}</h2>
            <p className="text-xs text-slate-500">{rep.bookingRank ? `#${rep.bookingRank} this window · ` : ""}{rep.quotes} quotes · {rep.bookings} booked</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 px-5 py-4">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Funnel (window)</h3>
            <Funnel steps={[
              { label: "Leads", value: rep.leads, tone: "bg-slate-400" },
              { label: "Quotes", value: rep.quotes, tone: "bg-sky-500" },
              { label: "Contacted", value: rep.contacted, tone: "bg-indigo-500" },
              { label: "Opened", value: rep.opened, tone: "bg-violet-500" },
              { label: "Booked", value: rep.bookings, tone: "bg-emerald-500" },
            ]} />
            <div className="mt-2 text-xs text-slate-500">Conversion <strong className="text-slate-700">{rep.conversion}%</strong> · Lost {rep.lost}</div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Performance</h3>
            <div className="grid grid-cols-2 gap-2">
              <Mini label="Pipeline" value={fmtMoney(rep.pipeline)} tone="text-indigo-600" />
              <Mini label="Avg response" value={fmtResp(rep.avgResponse)} tone="text-amber-600" />
              <Mini label="SLA breaches" value={rep.slaBreaches} tone={rep.slaBreaches ? "text-rose-600" : "text-slate-600"} />
              <Mini label="Contact %" value={rep.contactPct == null ? "—" : `${rep.contactPct}%`} />
              <Mini label="Not contacted" value={rep.notContacted} tone={rep.notContacted ? "text-rose-600" : "text-slate-600"} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Channels & effort</h3>
            <div className="grid grid-cols-2 gap-2">
              <Mini label="Emailed" value={rep.emailSent} icon={Mail} />
              <Mini label="Opened" value={rep.opened} icon={MailOpen} />
              <Mini label="OTP verified" value={rep.otp} icon={BadgeCheck} />
              <Mini label="WhatsApp seen" value={rep.waSeen} icon={MessageCircle} />
              <Mini label="Warehouse sent" value={rep.whSent} />
              <Mini label="Warehouse viewed" value={rep.whViewed} />
              <Mini label="Calls today" value={rep.calls} icon={Phone} />
              <Mini label="Idle today" value={rep.idleMin ? fmtMins(rep.idleMin) : "0"} tone={rep.idleMin >= 60 ? "text-rose-600" : "text-slate-600"} icon={Clock} />
            </div>
          </div>
          {stages.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Pipeline by stage</h3>
              <div className="space-y-1.5">
                {stages.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-600">{name}</span>
                    <span className="font-semibold tabular-nums text-slate-800">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <FakeFollowupList quotes={quotes} />
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Quotes in window ({quotes.length})</h3>
            <div className="space-y-1.5">
              {quotes.slice(0, 30).map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{q.name}</div>
                    <div className="truncate text-xs text-slate-400">{q.city || "—"} · {q.status || "open"}</div>
                  </div>
                  <div className="ml-2 shrink-0 text-right">
                    <div className="font-semibold tabular-nums text-slate-700">{fmtMoney(q.value)}</div>
                    {!q.contacted && <div className="text-[11px] font-medium text-rose-500">not contacted</div>}
                  </div>
                </div>
              ))}
              {quotes.length === 0 && <p className="text-sm text-slate-400">No quotes in this window.</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Lost-reason analysis: team breakdown + per-agent improvement points.
export function LostReasons({ loss, className = "" }) {
  if (!loss || !loss.total) {
    return (
      <div className={className}>
        <SectionTitle icon={Flame} text="Why we lose — lost-reason analysis" />
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-400">
          No lost/invalid quotes in this window. Pick a wider range (e.g. This month) to see patterns.
        </div>
      </div>
    );
  }
  const entries = Object.entries(loss.team).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className={className}>
      <SectionTitle icon={Flame} text="Why we lose — lost-reason analysis" />
      <p className="mb-3 text-sm text-slate-500">
        <span className="font-medium text-slate-700">{loss.total}</span> lost/invalid quotes in this window, categorized from rep notes.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Team — reasons we lose</h3>
          <div className="space-y-2">
            {entries.map(([cat, n]) => (
              <div key={cat} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-xs text-slate-600">{LOSS_LABELS[cat] || cat}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-rose-400" style={{ width: `${Math.round((n / max) * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">
                  {n} · {Math.round((n / loss.total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-amber-800">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Real improvement points (by agent)
          </h3>
          {loss.insights.length === 0 ? (
            <p className="text-sm text-slate-500">No single reason dominates any agent — losses are spread evenly.</p>
          ) : (
            <div className="space-y-2.5">
              {loss.insights.map((ins, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-bold text-slate-800">{ins.rep}</span>
                    <span className="text-slate-500">loses</span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                      {ins.share}% on {LOSS_LABELS[ins.category]}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({ins.count}/{ins.repTotal} losses{ins.teamShare ? ` · team ${ins.teamShare}%` : ""})
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">→ {LOSS_ACTION[ins.category]}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Per-agent loss composition — one stacked bar per agent, segmented by reason.
const CAT_COLOR = {
  price: "bg-rose-500", competitor: "bg-orange-500", no_response: "bg-amber-400",
  postponed: "bg-sky-500", local_self: "bg-violet-500", distance: "bg-cyan-500",
  not_interested: "bg-slate-400", invalid: "bg-zinc-400", other: "bg-slate-300",
};
export function LostReasonsByAgent({ reps, className = "" }) {
  const rows = (reps || [])
    .map((r) => ({ name: r.name, repId: r.repId, lr: r.lostReasons || {}, total: Object.values(r.lostReasons || {}).reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return null;

  // categories actually present (for the legend), in CAT_COLOR order
  const present = Object.keys(CAT_COLOR).filter((c) => rows.some((r) => r.lr[c]));
  const maxTotal = Math.max(...rows.map((r) => r.total));

  return (
    <div className={className}>
      <SectionTitle icon={Flame} text="Losses by agent" />
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {present.map((c) => (
          <span key={c} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${CAT_COLOR[c]}`} />
            {LOSS_LABELS[c] || c}
          </span>
        ))}
      </div>
      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4">
        {rows.map((r) => (
          <div key={r.repId}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">{r.name}</span>
              <span className="tabular-nums text-slate-400">{r.total} lost</span>
            </div>
            {/* bar width scaled to the busiest agent (volume); segments = reason mix */}
            <div className="flex h-5 overflow-hidden rounded bg-slate-50" style={{ width: `${Math.max(8, Math.round((r.total / maxTotal) * 100))}%` }}>
              {present.map((c) =>
                r.lr[c] ? (
                  <div
                    key={c}
                    className={`${CAT_COLOR[c]} flex items-center justify-center`}
                    style={{ width: `${(r.lr[c] / r.total) * 100}%` }}
                    title={`${LOSS_LABELS[c] || c}: ${r.lr[c]}`}
                  >
                    {r.lr[c] >= 2 ? <span className="text-[10px] font-bold text-white">{r.lr[c]}</span> : null}
                  </div>
                ) : null
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">Bar length = total losses (vs the busiest agent); colored segments = reason mix.</p>
    </div>
  );
}

// Compact loss-mix bar for use inside the agent table (one cell per agent).
export function LossMiniBar({ lostReasons }) {
  const lr = lostReasons || {};
  const total = Object.values(lr).reduce((a, b) => a + b, 0);
  if (!total) return <span className="text-slate-300">—</span>;
  const present = Object.keys(CAT_COLOR).filter((c) => lr[c]);
  return (
    <div className="flex items-center gap-1.5" title={present.map((c) => `${LOSS_LABELS[c] || c}: ${lr[c]}`).join(" · ")}>
      <div className="flex h-3.5 w-24 overflow-hidden rounded bg-slate-100">
        {present.map((c) => (
          <div key={c} className={CAT_COLOR[c]} style={{ width: `${(lr[c] / total) * 100}%` }} />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-slate-400">{total}</span>
    </div>
  );
}

// Color legend for the loss-mix bars.
export function LossLegend({ className = "" }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 ${className}`}>
      {Object.keys(CAT_COLOR).map((c) => (
        <span key={c} className="flex items-center gap-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${CAT_COLOR[c]}`} />
          {LOSS_LABELS[c] || c}
        </span>
      ))}
    </div>
  );
}
