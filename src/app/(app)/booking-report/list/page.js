"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Phone, MessageCircle, Mail, Filter, MapPin, Users } from "lucide-react";
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

// Types backed by quotation data → render the rich QuoteCard (booking score etc.).
const QUOTE_TYPES = new Set(["quotation_customers", "follow_up_customers"]);

function prettyStatus(s) {
  return String(s)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bRnr\b/gi, "RNR")
    .replace(/\bOtp\b/gi, "OTP");
}

function ReportListInner() {
  const sp = useSearchParams();
  const type = sp.get("type") || "quotation_customers";
  const label = sp.get("label") || "Customers";
  const initFrom = sp.get("from");
  const initTo = sp.get("to");
  const isQuote = QUOTE_TYPES.has(type);

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

  // Simple list (leads / bookings)
  const [rows, setRows] = useState(null);
  // Quotation cohort + enrichments
  const [quotes, setQuotes] = useState(null);
  const [emailStatus, setEmailStatus] = useState({});
  const [otpIds, setOtpIds] = useState(() => new Set());
  const [signals, setSignals] = useState({});
  const [wa, setWa] = useState({});
  const [error, setError] = useState("");

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
  }, [type, isQuote, range, city]);

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

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <Link href="/booking-report" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to report
      </Link>

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
            <p className="mt-0.5 text-sm text-indigo-100">
              {range.label}
              {city ? ` · ${city}` : ""} · {loaded ? `${count} of ${total} customers` : "loading…"}
            </p>
          </div>
          <DateFilter onChange={handleRange} />
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterSelect icon={Users} active={!!rep} value={rep} onChange={setRep} placeholder="All CRM users">
          {crmUsers.map((u) => (
            <option key={u.user_id} value={String(u.user_id)}>
              {u.user_fname} {u.user_lname || ""}
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
        <FilterSelect icon={MapPin} active={!!city} value={city} onChange={setCity} placeholder="All cities">
          {cities.map((c) => (
            <option key={c.city_slug} value={c.city_slug}>
              {c.city_name}
            </option>
          ))}
        </FilterSelect>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, email, ID…"
          className="min-w-44 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
        />
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {!loaded && !error && (
        <div className="mt-4 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      )}

      {/* Rich quotation cards */}
      {isQuote && loaded && (
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
            />
          ))}
        </div>
      )}

      {/* Simple list (leads / bookings) */}
      {!isQuote && loaded && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {filteredRows.length === 0 && <p className="px-5 py-16 text-center text-sm text-slate-400">No customers match these filters.</p>}
          {filteredRows.map((r, i) => (
            <ListRow key={`${r.id}-${i}`} r={r} />
          ))}
        </div>
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

function ListRow({ r }) {
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
          {phone && <span>+91 {phone}</span>}
          {r.email && (
            <span className="inline-flex items-center gap-1 truncate">
              <Mail className="h-3 w-3 text-slate-400" /> {r.email}
            </span>
          )}
          {r.city && <span className="capitalize">· {r.city}</span>}
          {r.status && <span className="font-semibold text-amber-600">· {prettyStatus(r.status)}</span>}
          {r.followDate && <span>· F/U {String(r.followDate).slice(0, 10)}</span>}
          {r.rep && <span className="text-slate-400">· {r.rep}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
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
