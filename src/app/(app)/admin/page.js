"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Users, Phone, MessageCircle, TrendingUp, Timer, AlertTriangle,
  Trophy, IndianRupee, X, ChevronRight, Clock, Lock, ArrowUpRight, Lightbulb,
  Flame, ThumbsUp, Target, Mail, MailOpen, BadgeCheck, FileText, MapPin, Layers,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { fetchAdminReport } from "@/lib/adminReport";
import { buildCoaching } from "@/lib/adminInsights";
import DateFilter from "@/components/DateFilter";
import { fmtMoney, fmtResp, ConvBadge, SectionTitle, RepDrawer, LostReasons, LostReasonsByAgent } from "@/components/admin/shared";

const REP_COLS = [
  { key: "name", label: "Rep", align: "left" },
  { key: "leads", label: "Leads" },
  { key: "quotes", label: "Quotes" },
  { key: "contactPct", label: "Contact %" },
  { key: "avgResponse", label: "Avg resp" },
  { key: "slaBreaches", label: "SLA breach" },
  { key: "emailSent", label: "Emailed" },
  { key: "opened", label: "Opened" },
  { key: "otp", label: "OTP" },
  { key: "calls", label: "Calls*" },
  { key: "whatsapps", label: "WA*" },
  { key: "bookings", label: "Booked" },
  { key: "conversion", label: "Conv %" },
  { key: "pipeline", label: "Pipeline" },
];

export default function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState(null);
  const [sort, setSort] = useState({ key: "bookings", dir: "desc" });
  const [selected, setSelected] = useState(null);

  useEffect(() => setSession(getSession()), []);
  const handleRange = useCallback((r) => setRange(r), []);
  const admin = isAdmin(session);

  const load = useCallback(
    (signal) => {
      if (!admin || !range) return;
      setError("");
      setData(null);
      fetchAdminReport({ from: range.from, to: range.to, signal })
        .then(setData)
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load the report. Please refresh.");
        });
    },
    [admin, range]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const coaching = useMemo(
    () => (data ? buildCoaching(data.perRep.map((r) => ({ ...r, open: r.openQuotes ?? r.quotesDetail }))) : null),
    [data]
  );

  const reps = useMemo(() => {
    if (!data?.perRep) return [];
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    return [...data.perRep].sort((a, b) => {
      // Bookings sort matches the #-rank: bookings, then conversion, then quotes.
      if (key === "bookings") {
        return ((a.bookings - b.bookings) || (a.conversion - b.conversion) || (a.quotes - b.quotes)) * mul;
      }
      const av = a[key] ?? (key === "name" ? "" : -1);
      const bv = b[key] ?? (key === "name" ? "" : -1);
      if (typeof av === "string") return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
  }, [data, sort]);

  const selRep = useMemo(() => (selected ? data?.perRep.find((r) => r.repId === selected) : null), [selected, data]);
  const selQuotes = useMemo(
    () => (selected ? (data?.quotes || []).filter((q) => q._repKey === selected) : []),
    [selected, data]
  );
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  if (session === undefined) return <div className="px-5 py-10 text-sm text-slate-400">Loading…</div>;
  if (!admin) {
    return (
      <div className="px-5 py-16 text-center">
        <Lock className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-lg font-bold text-slate-800">Admins only</h1>
        <p className="mt-1 text-sm text-slate-500">This dashboard is restricted to admin accounts.</p>
      </div>
    );
  }

  const t = data?.totals;

  return (
    <div className="px-5 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-indigo-600" /> Team Report
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {t ? (
              <>
                End-to-end · <span className="font-medium text-slate-700">{range?.label}</span> ·{" "}
                <span className="font-medium text-slate-700">{t.reps}</span> reps
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <DateFilter onChange={handleRange} defaultPreset="today" />
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!data && !error && <div className="py-16 text-center text-sm text-slate-400">Building report…</div>}

      {data && t && (
        <>
          {/* Executive KPIs */}
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Leads" value={t.leads} icon={Users} tone="slate" />
            <Kpi label="Quotes" value={t.quotes} icon={FileText} tone="sky" />
            <Kpi label="Bookings" value={t.booked} icon={Trophy} tone="emerald" />
            <Kpi label="Conversion" value={`${t.conversion}%`} icon={TrendingUp} tone="emerald" />
            <Kpi label="Pipeline" value={fmtMoney(t.pipeline)} icon={IndianRupee} tone="indigo" />
            <Kpi label="Avg response" value={fmtResp(t.avgResponse)} icon={Timer} tone="amber" />
            <Kpi label="SLA breaches" value={t.slaBreaches} icon={AlertTriangle} tone="rose" />
            <Kpi label="Not contacted" value={t.notContacted} icon={Phone} tone="rose" />
            <Kpi label="Calls today" value={t.calls} icon={Phone} tone="sky" />
            <Kpi label="WhatsApp today" value={t.whatsapps} icon={MessageCircle} tone="emerald" />
            <Kpi label="Contacted" value={t.contacted} icon={BadgeCheck} tone="slate" />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            {/* Funnel */}
            <Panel title="Conversion funnel" icon={Layers}>
              <FunnelChart steps={data.funnel} />
            </Panel>

            {/* Channels */}
            <Panel title="Channel performance" icon={Mail}>
              <ChannelGrid c={data.channels} />
              <SlaDistribution sla={data.sla} />
            </Panel>
          </div>

          {/* Recommendations */}
          {coaching && (
            <div className="mb-5">
              <SectionTitle icon={Lightbulb} text="What to fix first — quantified" />
              {coaching.team.upliftPts > 0 && (
                <p className="mb-2 text-sm text-slate-600">
                  Team conversion <strong>{coaching.team.conversion}%</strong> → closing these gaps could reach{" "}
                  <strong className="text-emerald-700">{coaching.team.projectedConversion}% (+{coaching.team.upliftPts} pts)</strong>.
                </p>
              )}
              <div className="grid gap-2.5 lg:grid-cols-3">
                {coaching.opportunities.length === 0 ? (
                  <Empty>No clear gaps in this window.</Empty>
                ) : (
                  coaching.opportunities.map((o, i) => <OpportunityCard key={o.key} o={o} rank={i + 1} />)
                )}
              </div>
            </div>
          )}

          {/* Per-rep detailed table */}
          <SectionTitle icon={Users} text="Per-rep detail" />
          <div className="mb-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5 text-left font-semibold">#</th>
                  {REP_COLS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 font-semibold hover:text-slate-800 ${
                        c.align === "left" ? "text-left" : "text-right"
                      } ${sort.key === c.key ? "text-indigo-600" : ""}`}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th className="px-2" />
                </tr>
              </thead>
              <tbody>
                {reps.length === 0 && (
                  <tr><td colSpan={REP_COLS.length + 2} className="px-3 py-10 text-center text-slate-400">No rep activity in this window.</td></tr>
                )}
                {reps.map((r, i) => (
                  <tr key={r.repId} onClick={() => setSelected(r.repId)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                    <td className="px-3 py-2.5 text-left font-semibold tabular-nums text-slate-400">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-slate-800">
                      {r.name}{r.bookingRank ? <span className="ml-2 text-[11px] font-medium text-amber-600">#{r.bookingRank}</span> : null}
                    </td>
                    <Td>{r.leads || "—"}</Td>
                    <Td>{r.quotes}</Td>
                    <Td>{r.contactPct == null ? "—" : <ConvBadge pct={r.contactPct} />}</Td>
                    <Td>{fmtResp(r.avgResponse)}</Td>
                    <Td className={r.slaBreaches ? "font-semibold text-rose-600" : "text-slate-400"}>{r.slaBreaches || "—"}</Td>
                    <Td>{r.emailSent || "—"}</Td>
                    <Td>{r.opened || "—"}</Td>
                    <Td>{r.otp || "—"}</Td>
                    <Td>{r.calls || "—"}</Td>
                    <Td>{r.whatsapps || "—"}</Td>
                    <Td className="font-semibold text-emerald-700">{r.bookings || "—"}</Td>
                    <Td><ConvBadge pct={r.conversion} /></Td>
                    <Td className="font-medium text-indigo-700">{fmtMoney(r.pipeline)}</Td>
                    <td className="px-2 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mb-5 text-xs text-slate-400">
            All metrics reflect <strong>{range?.label}</strong>. The <strong>#</strong> badge ranks reps by bookings in this window. * Calls / WhatsApp are <strong>today only</strong> (activity tracking is per-day).
          </p>

          {/* Why we lose — lost-reason analysis + per-agent improvement points */}
          <LostReasons loss={data.loss} className="mb-5" />
          <LostReasonsByAgent reps={reps} className="mb-5" />

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Lead sources" icon={Users}>
              <BarList items={data.leadSources.map((s) => ({ name: s.name, value: s.count }))} empty="No leads in window." />
            </Panel>
            <Panel title="Quote sources" icon={Target}>
              <BarList items={data.sources.map((s) => ({ name: s.name, value: s.quotes, note: `${s.bookings} booked` }))} empty="No quotes." />
            </Panel>
            <Panel title="Pipeline by city" icon={MapPin}>
              <BarList items={data.cities.map((c) => ({ name: c.name, value: c.quotes, note: fmtMoney(c.pipeline) }))} empty="No cities." />
            </Panel>
          </div>
          <div className="mt-4">
            <Panel title="Pipeline by stage" icon={Layers}>
              <BarList items={data.stages.map((s) => ({ name: s.name, value: s.count }))} empty="No staged quotes." horizontal />
            </Panel>
          </div>
        </>
      )}

      {selRep && <RepDrawer rep={selRep} quotes={selQuotes} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ---------- small presentational components ---------- */
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2.5 text-right tabular-nums ${className}`}>{children}</td>;
}
function Kpi({ label, value, icon: Icon, tone }) {
  const tones = { slate: "text-slate-700", indigo: "text-indigo-600", emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", sky: "text-sky-600" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${tones[tone] || tones.slate}`}>{value}</div>
    </div>
  );
}
function Panel({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
        <Icon className="h-4 w-4 text-indigo-500" /> {title}
      </h3>
      {children}
    </div>
  );
}
function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-400">{children}</div>;
}

function FunnelChart({ steps }) {
  const top = steps[0]?.count || 1;
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const widthOfTop = Math.round((s.count / (top || 1)) * 100);
        const stepPct = s.of ? Math.round((s.count / s.of) * 100) : null;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-slate-500">{s.label}</span>
            <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
              <div className={`flex h-full items-center justify-end pr-2 ${i === steps.length - 1 ? "bg-emerald-500" : "bg-indigo-400"}`} style={{ width: `${Math.max(6, widthOfTop)}%` }}>
                <span className="text-[11px] font-bold text-white">{s.count}</span>
              </div>
            </div>
            <span className="w-12 shrink-0 text-right text-xs font-semibold text-slate-500">{stepPct != null ? `${stepPct}%` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChannelGrid({ c }) {
  const cells = [
    { label: "Emailed", value: c.emailSent, icon: Mail },
    { label: "Delivered", value: c.delivered, icon: BadgeCheck },
    { label: "Opened", value: c.opened, icon: MailOpen },
    { label: "Clicked", value: c.clicked, icon: TrendingUp },
    { label: "OTP verified", value: c.otp, icon: BadgeCheck },
    { label: "WhatsApp seen", value: c.waSeen, icon: MessageCircle },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cells.map((x) => (
        <div key={x.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2">
          <div className="flex items-center gap-1 text-[10px] font-medium text-slate-400"><x.icon className="h-3 w-3" /> {x.label}</div>
          <div className="text-base font-bold tabular-nums text-slate-800">{x.value}</div>
        </div>
      ))}
    </div>
  );
}

function SlaDistribution({ sla }) {
  const b = sla.buckets;
  const total = b.b0 + b.b15 + b.b30 + b.b60 || 1;
  const segs = [
    { label: "<15m", value: b.b0, color: "bg-emerald-500" },
    { label: "15–30m", value: b.b15, color: "bg-amber-400" },
    { label: "30–60m", value: b.b30, color: "bg-orange-500" },
    { label: "60m+", value: b.b60, color: "bg-rose-500" },
  ];
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600">First-response time</span>
        <span className="text-slate-400">avg {fmtResp(sla.avgResponse)}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segs.map((s) => <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {segs.map((s) => <span key={s.label} className="flex items-center gap-1"><span className={`inline-block h-2 w-2 rounded-full ${s.color}`} />{s.label} {s.value}</span>)}
      </div>
    </div>
  );
}

function BarList({ items, empty, horizontal }) {
  if (!items?.length) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.slice(0, 12).map((i) => (
        <div key={i.name} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs capitalize text-slate-600" title={i.name}>{i.name}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <div className={horizontal ? "h-full bg-violet-400" : "h-full bg-indigo-400"} style={{ width: `${Math.round((i.value / max) * 100)}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-slate-700">{i.value}</span>
          {i.note && <span className="w-16 shrink-0 text-right text-[11px] text-slate-400">{i.note}</span>}
        </div>
      ))}
    </div>
  );
}

const OPP_ICON = { contact: Phone, speed: Timer, breach: Flame };
function OpportunityCard({ o, rank }) {
  const Icon = OPP_ICON[o.key] || Lightbulb;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800"><span className="mr-1 text-slate-300">#{rank}</span>{o.title}</h3>
            {o.bookings > 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">+~{o.bookings}</span>}
          </div>
          <p className="mt-1 text-xs text-slate-600">{o.detail}</p>
          {o.who?.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">Focus: <span className="font-medium text-slate-600">{o.who.join(", ")}</span></p>}
        </div>
      </div>
    </div>
  );
}


