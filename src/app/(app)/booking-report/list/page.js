"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Phone, MessageCircle, Mail, Filter, MapPin, Users, CalendarClock, UserRound, Eye, Search } from "lucide-react";
import {
  fetchReportListExact,
  fetchQuoteEmailStatus,
  fetchOtpVerifiedIds,
  fetchBookingSignals,
  fetchWhatsappStatus,
  bookingScore,
  customerLifecycle,
  FOLLOWUP_STATUSES,
  rangeForPreset,
} from "@/lib/crm";
import { evaluateEscalation } from "@/lib/escalations";
import { scoreQuote } from "@/lib/scoring";
import { fetchCustomerFilters } from "@/lib/customers";
import { appHref } from "@/lib/paths";
import DateFilter from "@/components/DateFilter";
import QuoteCard from "@/components/QuoteCard";
import QuoteTable from "@/components/QuoteTable";
import QuickFollowUpModal from "@/components/QuickFollowUpModal";

// Types backed by quotation data → render the rich QuoteCard (booking score etc.).
const QUOTE_TYPES = new Set(["quotation_customers", "follow_up_customers"]);

function prettyStatus(s) {
  return String(s)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/gi, "RNR")
    .replace(/\bOtp\b/gi, "OTP");
}

// "₹1,23,456" (Indian grouping), or "—" for zero/empty.
function fmtINR(v) {
  const n = Number(v);
  return n ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—";
}

function ReportListInner() {
  const sp = useSearchParams();
  const type = sp.get("type") || "quotation_customers";
  const label = sp.get("label") || "Customers";
  const initFrom = sp.get("from");
  const initTo = sp.get("to");
  const isQuote = QUOTE_TYPES.has(type);
  const isBooking = /booked/.test(type); // booked_customers → show charges + coupons

  const [range, setRange] = useState(() =>
    initFrom && initTo
      ? { from: initFrom, to: initTo, label: initFrom === initTo ? initFrom : `${initFrom} → ${initTo}` }
      : rangeForPreset("today")
  );
  const [city, setCity] = useState(sp.get("city") || "");
  const [rep, setRep] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  const [cities, setCities] = useState([]);
  const [crmUsers, setCrmUsers] = useState([]);
  const [tableView, setTableView] = useState(true); // cards | table — default to table

  // Simple list (leads / bookings)
  const [rows, setRows] = useState(null);
  // Quotation cohort + enrichments
  const [quotes, setQuotes] = useState(null);
  const [emailStatus, setEmailStatus] = useState({});
  const [otpIds, setOtpIds] = useState(() => new Set());
  const [signals, setSignals] = useState({});
  const [wa, setWa] = useState({});
  const [error, setError] = useState("");
  const [followUpFor, setFollowUpFor] = useState(null); // { entity, id, name, subtitle, follow_up, follow_up_date, follow_up_note }
  const [refresh, setRefresh] = useState(0);

  // Lead-type report lists (lead_follow_up_customers, …) write to ss_leads; every
  // other list is customer/quotation backed.
  const listEntity = /lead/i.test(type) ? "lead" : "customer";

  const handleRange = useCallback((r) => setRange(r), []);

  useEffect(() => {
    fetchCustomerFilters()
      .then((d) => {
        setCities(d.cities || []);
        setCrmUsers(d.crm_users || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    setQuotes(null);
    setRows(null);
    // The backend list endpoint already applies the same date + city filter as
    // the card's metric, so the returned count matches the card exactly.
    fetchReportListExact(type, { from: range.from, to: range.to, city, signal: ctrl.signal })
      .then((res) => {
        if (res.quote) setQuotes(res.rows);
        else setRows(res.rows);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load this list.");
      });
    if (isQuote) {
      fetchQuoteEmailStatus({ signal: ctrl.signal }).then(setEmailStatus).catch(() => {});
      fetchOtpVerifiedIds({ signal: ctrl.signal }).then(setOtpIds).catch(() => {});
      fetchBookingSignals({ signal: ctrl.signal }).then(setSignals).catch(() => {});
      fetchWhatsappStatus({ signal: ctrl.signal }).then(setWa).catch(() => {});
    }
    return () => ctrl.abort();
  }, [type, isQuote, range, city, refresh]);

  // Per-quote computed maps (quotation types only).
  const escMap = useMemo(() => new Map((quotes || []).map((q) => [String(q.id), evaluateEscalation(q)])), [quotes]);
  const scoreMap = useMemo(
    () => new Map((quotes || []).map((q) => [String(q.id), scoreQuote(q, escMap.get(String(q.id)))])),
    [quotes, escMap]
  );
  const bookingMap = useMemo(
    () =>
      new Map(
        (quotes || []).map((q) => [
          String(q.id),
          bookingScore(q, { otp: otpIds.has(String(q.id)), signals: signals[String(q.id)], email: emailStatus[String(q.id)], wa: wa[String(q.id)] }),
        ])
      ),
    [quotes, otpIds, signals, emailStatus, wa]
  );
  const lifecycleMap = useMemo(
    () =>
      new Map(
        (quotes || []).map((q) => [
          String(q.id),
          customerLifecycle(q, { otp: otpIds.has(String(q.id)), signals: signals[String(q.id)], email: emailStatus[String(q.id)] }),
        ])
      ),
    [quotes, otpIds, signals, emailStatus]
  );

  const filteredQuotes = useMemo(() => {
    if (!quotes) return [];
    const q = query.trim().toLowerCase();
    return quotes
      .filter((x) => !rep || x.repId === rep)
      .filter((x) => !status || x.statusKey === status)
      .filter(
        (x) =>
          !q ||
          String(x.name || "").toLowerCase().includes(q) ||
          String(x.contact || "").includes(q) ||
          String(x.email || "").toLowerCase().includes(q) ||
          String(x.uid || "").toLowerCase().includes(q)
      )
      .sort((a, b) => (bookingMap.get(String(b.id))?.score || 0) - (bookingMap.get(String(a.id))?.score || 0));
  }, [quotes, rep, status, query, bookingMap]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !rep || r.repId === rep)
      .filter((r) => !status || String(r.status || "").toLowerCase().trim() === status)
      .filter(
        (r) =>
          !q ||
          String(r.name || "").toLowerCase().includes(q) ||
          String(r.phone || "").includes(q) ||
          String(r.email || "").toLowerCase().includes(q) ||
          String(r.uid || "").toLowerCase().includes(q)
      );
  }, [rows, rep, status, query]);

  const loaded = isQuote ? quotes != null : rows != null;
  const count = isQuote ? filteredQuotes.length : filteredRows.length;
  const total = isQuote ? quotes?.length ?? 0 : rows?.length ?? 0;

  // Cohort summary tiles (quotation types) — derived from the same data, no new fetch.
  const pipelineValue = useMemo(() => (quotes || []).reduce((s, q) => s + (Number(q.value) || 0), 0), [quotes]);
  const stats = useMemo(() => {
    const qs = quotes || [];
    return {
      total: qs.length,
      value: pipelineValue,
      dueToday: qs.filter((q) => q.bucket === "today").length,
      overdue: qs.filter((q) => q.bucket === "overdue").length,
      notContacted: qs.filter((q) => !q.contacted).length,
      rnr: qs.filter((q) => q.statusKey === "rnr").length,
    };
  }, [quotes, pipelineValue]);

  return (
    <div className="px-5 py-6">
      <Link href="/booking-report" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to report
      </Link>

      {/* Header — mirrors /quotations */}
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">{label}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {loaded ? (
            <>
              <span className="font-medium text-slate-700">{count}</span> of {total} customers
              {isQuote && (
                <>
                  {" "}· <span className="font-medium text-slate-700">{fmtMoney(pipelineValue)}</span> pipeline
                </>
              )}
              {city ? ` · ${city}` : ""} · {range.label}
            </>
          ) : (
            "Loading…"
          )}
        </p>
      </div>

      {/* Stat tiles — mirrors /quotations */}
      {isQuote && loaded && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Quotations" value={stats.total} tone="slate" />
          <StatTile label="Pipeline" value={fmtMoney(stats.value)} tone="indigo" />
          <StatTile label="Due today" value={stats.dueToday} tone="amber" />
          <StatTile label="Overdue" value={stats.overdue} tone="rose" />
          <StatTile label="Not contacted" value={stats.notContacted} tone="rose" />
          <StatTile label="RNR" value={stats.rnr} tone="rose" />
        </div>
      )}

      {/* All filters in ONE row — search · date · city · status · CRM user */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, ID…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
          />
        </div>
        <DateFilter onChange={handleRange} />
        <FilterSelect icon={MapPin} active={!!city} value={city} onChange={setCity} placeholder="All cities">
          {cities.map((c) => (
            <option key={c.city_slug} value={c.city_slug}>
              {c.city_name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect icon={Filter} active={!!status} value={status} onChange={setStatus} placeholder="All statuses">
          {FOLLOWUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {prettyStatus(s)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect icon={Users} active={!!rep} value={rep} onChange={setRep} placeholder="All CRM users">
          {crmUsers.map((u) => (
            <option key={u.user_id} value={String(u.user_id)}>
              {u.user_fname} {u.user_lname || ""}
            </option>
          ))}
        </FilterSelect>
        {isQuote && (
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button onClick={() => setTableView(false)} className={`px-3 py-2 text-xs font-semibold transition-colors ${!tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Cards</button>
            <button onClick={() => setTableView(true)} className={`px-3 py-2 text-xs font-semibold transition-colors ${tableView ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Table</button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {!loaded && !error && (
        <div className="mt-4 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      )}

      {/* Table view (with lifecycle) */}
      {isQuote && loaded && tableView && filteredQuotes.length > 0 && (
        <div className="mt-4">
          <QuoteTable
            rows={filteredQuotes}
            getBooking={(q) => bookingMap.get(String(q.id))}
            getLife={(q) => lifecycleMap.get(String(q.id))}
            onQuickFollowUp={(q) =>
              setFollowUpFor({
                entity: "customer",
                id: q.id,
                name: q.name,
                subtitle: q.uid || `ID ${q.id}`,
                follow_up: q.status,
                follow_up_date: q.followDate,
                follow_up_note: q.noteFull,
              })
            }
          />
        </div>
      )}

      {/* Rich quotation cards */}
      {isQuote && loaded && !tableView && (
        <div className="mt-4 space-y-3">
          {filteredQuotes.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">No customers match these filters.</div>
          )}
          {filteredQuotes.map((q) => (
            <QuoteCard
              key={q.id}
              q={q}
              esc={escMap.get(String(q.id))}
              booking={bookingMap.get(String(q.id))}
              email={emailStatus[String(q.id)]}
              otp={otpIds.has(String(q.id))}
              life={lifecycleMap.get(String(q.id))}
              wh={signals[String(q.id)]}
              wa={wa[String(q.id)]}
              breach={false}
              breachMins={null}
              compact={false}
              hideValue
              onQuickFollowUp={() =>
                setFollowUpFor({
                  entity: "customer",
                  id: q.id,
                  name: q.name,
                  subtitle: q.uid || `ID ${q.id}`,
                  follow_up: q.status,
                  follow_up_date: q.followDate,
                  follow_up_note: q.noteFull,
                })
              }
            />
          ))}
        </div>
      )}

      {/* Table (leads / bookings) — booked_customers also shows charges + coupons */}
      {!isQuote && loaded && filteredRows.length === 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">No customers match these filters.</div>
      )}
      {!isQuote && loaded && filteredRows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 pl-5">Customer</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">City</th>
                {isBooking && <th className="px-4 py-3 text-right">Storage &#8377;</th>}
                {isBooking && <th className="px-4 py-3 text-right">Transport &#8377;</th>}
                {isBooking && <th className="px-4 py-3 text-center">Storage coupon</th>}
                {isBooking && <th className="px-4 py-3 text-center">Transport coupon</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rep</th>
                <th className="px-3" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => (
                <tr key={`${r.id}-${i}`} className="border-b-2 border-slate-100 align-middle transition-colors odd:bg-white even:bg-slate-50/40 last:border-0 hover:bg-indigo-50/50">
                  <td className="px-4 py-3 pl-5">
                    <a href={appHref(`/customer/${r.id}`)} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-indigo-700">{r.name}</a>
                    {r.uid && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{r.uid}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold tabular-nums text-slate-900">{r.phone ? `+91 ${r.phone}` : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">{r.email ? <a href={`mailto:${r.email}`} title={r.email} className="block max-w-[200px] truncate font-medium text-slate-700 hover:text-indigo-600">{r.email}</a> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{r.city || <span className="text-slate-300">—</span>}</td>
                  {isBooking && <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-800">{fmtINR(r.storageCharges)}</td>}
                  {isBooking && <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-800">{fmtINR(r.transportCharges)}</td>}
                  {isBooking && <td className="px-4 py-3 text-center">{r.storageCoupon ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{r.storageCoupon}</span> : <span className="text-slate-300">—</span>}</td>}
                  {isBooking && <td className="px-4 py-3 text-center">{r.transportCoupon ? <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{r.transportCoupon}</span> : <span className="text-slate-300">—</span>}</td>}
                  <td className="px-4 py-3">{r.status ? <span className="inline-block whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600">{prettyStatus(r.status)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.rep || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      {r.phone && <a href={`tel:+91${r.phone}`} title="Call" className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><Phone className="h-4 w-4" /></a>}
                      <a href={appHref(`/customer/${r.id}`)} target="_blank" rel="noreferrer" title="View" className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"><Eye className="h-4 w-4" /></a>
                      <button
                        onClick={() => setFollowUpFor({ entity: listEntity, id: r.id, name: r.name, subtitle: r.uid || (listEntity === "lead" ? `Lead ${r.id}` : `ID ${r.id}`), follow_up: r.status, follow_up_date: r.followDate, follow_up_note: "" })}
                        title="Add follow-up"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100"
                      >
                        <CalendarClock className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {followUpFor && (
        <QuickFollowUpModal
          entity={followUpFor.entity}
          id={followUpFor.id}
          name={followUpFor.name}
          subtitle={followUpFor.subtitle}
          follow_up={followUpFor.follow_up}
          follow_up_date={followUpFor.follow_up_date}
          follow_up_note={followUpFor.follow_up_note}
          onClose={() => setFollowUpFor(null)}
          onSaved={() => {
            setFollowUpFor(null);
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function FilterSelect({ icon: Icon, active, value, onChange, placeholder, children }) {
  return (
    <div className={`relative inline-flex items-center rounded-lg border ${active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
      <Icon className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${active ? "text-indigo-500" : "text-slate-400"}`} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`max-w-[180px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-3 text-sm focus:outline-none ${active ? "font-semibold text-indigo-700" : "text-slate-600"}`}
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
    </div>
  );
}

// "₹1,23,456" (Indian grouping), or "—" for zero/empty. Mirrors /quotations.
function fmtMoney(v) {
  const n = Number(v);
  if (!n) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function StatTile({ label, value, tone, onClick }) {
  const tones = {
    slate: "text-slate-700",
    indigo: "text-indigo-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    sky: "text-sky-600",
    violet: "text-violet-600",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm ${onClick ? "transition-colors hover:border-indigo-300 hover:bg-slate-50" : ""}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tones[tone] || "text-slate-700"}`}>{value}</div>
    </Comp>
  );
}

function ListRow({ r, onFollowUp }) {
  const phone = String(r.phone || "").replace(/\D/g, "").slice(-10);
  return (
    <div className="flex items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0 hover:bg-slate-50/60">
      <div className="min-w-0 flex-1">
        <a
          href={r.id ? appHref(`/customer/${r.id}`) : undefined}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-semibold text-slate-800 hover:text-indigo-700"
        >
          {r.name} {r.uid && <span className="text-[11px] font-normal text-slate-400">{r.uid}</span>}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          {phone && <span className="text-sm font-bold text-slate-900 tabular-nums">+91 {phone}</span>}
          {r.email && (
            <span className="inline-flex items-center gap-1 truncate text-sm font-bold text-slate-900">
              <Mail className="h-4 w-4 text-slate-400" /> {r.email}
            </span>
          )}
          {r.city && <span className="capitalize">· {r.city}</span>}
          {r.status && <span className="font-semibold text-amber-600">· {prettyStatus(r.status)}</span>}
          {r.followDate && <span>· F/U {String(r.followDate).slice(0, 10)}</span>}
          {r.rep && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700" title="CRM user · relationship manager">
              <UserRound className="h-2.5 w-2.5" /> {r.rep}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {r.id && (
          <a
            href={appHref(`/customer/${r.id}`)}
            title="View customer details"
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100"
          >
            <Eye className="h-4 w-4" /> View
          </a>
        )}
        <button
          onClick={() => onFollowUp?.()}
          title="Add follow-up"
          className="rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100"
        >
          <CalendarClock className="h-4 w-4" />
        </button>
        {r.email && (
          <a href={`mailto:${r.email}`} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100">
            <Mail className="h-4 w-4" />
          </a>
        )}
        {phone && (
          <>
            <a href={`tel:+91${phone}`} className="rounded-lg border border-emerald-200 p-1.5 text-emerald-600 hover:bg-emerald-50">
              <Phone className="h-4 w-4" />
            </a>
            <a href={`https://wa.me/91${phone}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 p-1.5 text-emerald-600 hover:bg-emerald-50">
              <MessageCircle className="h-4 w-4" />
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReportListPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>}>
      <ReportListInner />
    </Suspense>
  );
}
