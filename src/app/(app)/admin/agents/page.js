"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Users, Lock, ChevronDown } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { fetchAdminReport, LOSS_LABELS } from "@/lib/adminReport";
import DateFilter from "@/components/DateFilter";
import { RepDrawer, ConvBadge, fmtResp, LostReasons, LossMiniBar, LossLegend } from "@/components/admin/shared";

// Columns grouped under section headers for readability.
const GROUPS = [
  { label: "Performance", tint: "bg-indigo-50/40", cols: [
    { key: "quotes", label: "Quotes" },
    { key: "bookings", label: "Booked", good: true },
    { key: "conversion", label: "Conv%", badge: true },
    { key: "leads", label: "Leads" },
  ]},
  { label: "Email & Warehouse", tint: "bg-sky-50/40", cols: [
    { key: "emailSent", label: "Emailed" },
    { key: "opened", label: "Opened" },
    { key: "clicked", label: "Clicked" },
    { key: "otp", label: "OTP" },
    { key: "whSent", label: "WH sent" },
    { key: "whViewed", label: "WH view" },
  ]},
  { label: "WhatsApp", tint: "bg-emerald-50/40", cols: [
    { key: "waSent", label: "Sent" },
    { key: "waSeen", label: "Seen" },
  ]},
  { label: "Follow-up quality", tint: "bg-amber-50/40", cols: [
    { key: "contactPct", label: "Contact%" },
    { key: "avgResponse", label: "Avg resp" },
    { key: "todayBlank", label: "Blank·tdy", danger: true },
    { key: "yesterdayBlank", label: "Blank·yst", danger: true },
    { key: "pending", label: "Pending", danger: true },
    { key: "slaBreaches", label: "SLA", danger: true },
    { key: "notContacted", label: "Uncontd", danger: true },
    { key: "fakeFollowups", label: "Fake", danger: true },
  ]},
  { label: "Activity", tint: "bg-slate-50", cols: [
    { key: "calls", label: "Calls" },
  ]},
  { label: "Losses", tint: "bg-rose-50/40", cols: [
    { key: "lost", label: "Lost", danger: true },
    { key: "lossMix", label: "Reason mix", graph: true },
  ]},
];
const COLS = GROUPS.flatMap((g) => g.cols);

function cellValue(r, key) {
  if (key === "conversion") return <ConvBadge pct={r.conversion} />;
  if (key === "contactPct") return r.contactPct == null ? "—" : `${r.contactPct}%`;
  if (key === "avgResponse") return fmtResp(r.avgResponse);
  if (key === "waSent") return r.waSent || "—";
  return r[key] || "—";
}

export default function AgentStatsPage() {
  const [session, setSession] = useState(undefined);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState(null);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState({ key: "bookings", dir: "desc" });

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
          if (e?.name !== "AbortError") setError("Couldn't load agent stats. Please refresh.");
        });
    },
    [admin, range]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const reps = useMemo(() => {
    if (!data?.perRep) return [];
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    return [...data.perRep].sort((a, b) => {
      if (key === "bookings") return ((a.bookings - b.bookings) || (a.conversion - b.conversion) || (a.quotes - b.quotes)) * mul;
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
        <p className="mt-1 text-sm text-slate-500">This page is restricted to admin accounts.</p>
      </div>
    );
  }

  return (
    <div className="px-5 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mt-0.5 text-sm text-slate-500">
            Full status per agent · <span className="font-medium text-slate-700">{range?.label || "…"}</span>
          </p>
        </div>
        <DateFilter onChange={handleRange} defaultPreset="today" />
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!data && !error && <div className="py-16 text-center text-sm text-slate-400">Loading agent stats…</div>}

      {data && (
        <>
          <LossLegend className="mb-2" />
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                {/* group header row */}
                <tr>
                  <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left" />
                  {GROUPS.map((g) => (
                    <th
                      key={g.label}
                      colSpan={g.cols.length}
                      className={`border-b border-l border-slate-200 ${g.tint} px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500`}
                    >
                      {g.label}
                    </th>
                  ))}
                  <th className="border-b border-l border-slate-200 bg-slate-50 px-3 py-2" />
                </tr>
                {/* column header row */}
                <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left font-semibold">Agent</th>
                  {GROUPS.map((g) =>
                    g.cols.map((c, ci) => (
                      <th
                        key={c.key}
                        onClick={() => !c.graph && toggleSort(c.key)}
                        className={`whitespace-nowrap border-b border-slate-200 px-3 py-2.5 font-semibold ${c.graph ? "text-left" : "cursor-pointer text-right hover:text-slate-700"} ${
                          ci === 0 ? "border-l border-slate-200" : ""
                        } ${sort.key === c.key ? "text-indigo-600" : ""}`}
                      >
                        {c.label}{!c.graph && sort.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                      </th>
                    ))
                  )}
                  <th className="whitespace-nowrap border-b border-l border-slate-200 px-3 py-2.5 text-center font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {reps.length === 0 && (
                  <tr><td colSpan={COLS.length + 2} className="px-3 py-10 text-center text-slate-400">No agent activity in this window.</td></tr>
                )}
                {reps.map((r, i) => {
                  const zebra = i % 2 ? "bg-slate-50/50" : "bg-white";
                  const isOpen = expanded === r.repId;
                  return (
                  <Fragment key={r.repId}>
                    <tr onClick={() => setSelected(r.repId)} className={`group cursor-pointer ${zebra} hover:!bg-indigo-50/60`}>
                      <td className={`sticky left-0 z-10 ${zebra} border-b border-slate-100 px-3 py-2.5 text-left group-hover:!bg-indigo-50/60`}>
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                          <span className="whitespace-nowrap font-semibold text-slate-800">{r.name}</span>
                        </div>
                      </td>
                      {GROUPS.map((g) =>
                        g.cols.map((c, ci) => {
                          if (c.graph) {
                            return (
                              <td key={c.key} className={`whitespace-nowrap border-b border-slate-100 px-3 py-2.5 ${ci === 0 ? "border-l border-slate-100" : ""}`}>
                                <LossMiniBar lostReasons={r.lostReasons} />
                              </td>
                            );
                          }
                          const danger = c.danger && r[c.key] > 0;
                          const good = c.good && r[c.key] > 0;
                          return (
                            <td
                              key={c.key}
                              className={`whitespace-nowrap border-b border-slate-100 px-3 py-2.5 text-right tabular-nums ${ci === 0 ? "border-l border-slate-100" : ""} ${
                                danger ? "font-semibold text-rose-600" : good ? "font-semibold text-emerald-600" : "text-slate-600"
                              }`}
                            >
                              {cellValue(r, c.key)}
                            </td>
                          );
                        })
                      )}
                      <td className="border-b border-l border-slate-100 px-2 py-2.5 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : r.repId); }}
                          className={`rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${isOpen ? "bg-slate-100 text-indigo-600" : ""}`}
                          title="Show flagged customers"
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={COLS.length + 2} className="border-b border-slate-200 bg-slate-50/70 px-4 py-4">
                          <FlaggedDetail flagged={(data.flagged || []).filter((f) => f.repKey === r.repId)} name={r.name} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Click a row for the agent drawer. <strong>Blank</strong> = quote with no note and no follow-up date. <strong>Pending</strong> = follow-up dated yesterday and not called (excl. lost/invalid). <strong>Fake</strong> = marked contacted but no call logged. Blank/Pending are <strong>date-fixed</strong> (today/yesterday). WA sent / Calls are today-only without the WhatsApp endpoint.
          </p>

          <LostReasons loss={data.loss} className="mt-6" />
        </>
      )}

      {selRep && <RepDrawer rep={selRep} quotes={selQuotes} onClose={() => setSelected(null)} />}
    </div>
  );
}

// Expanded breakdown: the actual customers behind SLA breach / blank / pending.
const TONE = {
  rose: { head: "text-rose-600", chip: "bg-rose-50 text-rose-600" },
  amber: { head: "text-amber-600", chip: "bg-amber-50 text-amber-600" },
  orange: { head: "text-orange-600", chip: "bg-orange-50 text-orange-600" },
  slate: { head: "text-slate-600", chip: "bg-slate-100 text-slate-600" },
};
function FlaggedDetail({ flagged, name }) {
  const groups = [
    { key: "sla", label: "SLA breached", tone: "rose", items: flagged.filter((f) => f.sla) },
    { key: "blankToday", label: "Blank · today", tone: "amber", items: flagged.filter((f) => f.blankToday) },
    { key: "blankYest", label: "Blank · yesterday", tone: "amber", items: flagged.filter((f) => f.blankYest) },
    { key: "pending", label: "Pending follow-up", tone: "orange", items: flagged.filter((f) => f.pending) },
    { key: "lost", label: "Lost", tone: "slate", items: flagged.filter((f) => f.lost) },
  ];
  const total = flagged.length;
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        {name} — flagged customers ({total})
      </div>
      {total === 0 ? (
        <p className="text-sm text-slate-400">No flagged customers for this agent. 🎉</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {groups.map((g) => (
            <div key={g.key} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className={`mb-2 flex items-center justify-between text-xs font-bold ${TONE[g.tone].head}`}>
                <span>{g.label}</span>
                <span className={`rounded-full px-2 py-0.5 ${TONE[g.tone].chip}`}>{g.items.length}</span>
              </div>
              {g.items.length === 0 ? (
                <p className="text-xs text-slate-300">None</p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {g.items.slice(0, 50).map((f) => (
                    <div key={f.id} className="rounded-lg border border-slate-100 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{f.name}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{f.city || "—"}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500">
                        {f.uid && <span className="rounded bg-slate-100 px-1.5 py-0.5">{f.uid}</span>}
                        {f.contact && <span className="text-sm font-bold text-slate-900">{f.contact}</span>}
                        {f.lostReason && (
                          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-sans font-semibold text-rose-600">
                            {LOSS_LABELS[f.lostReason] || f.lostReason}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400" title={f.note || ""}>
                        {f.status ? `${f.status} · ` : ""}{f.note ? `“${String(f.note).slice(0, 60)}”` : "no note"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
