"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Loader2, RefreshCw, Search, Phone, MessageCircle, Mail, Plus, X, ShieldCheck, Clock } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ymd } from "@/lib/crm";
import { fetchHouseholdLeads, addHouseholdLead, fetchCrmUsers, transferLeads } from "@/lib/leads";
import { analyzeSentiment, INTENT_STYLE } from "@/lib/sentiment";

// Household / business / document leads — replicates the legacy household_leads
// list (ss_leads, not yet converted to quote), scoped to the logged-in rep.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORAGE = [
  { value: "", label: "All types" },
  { value: "household_storage", label: "Household" },
  { value: "room_storage", label: "Room" },
  { value: "business", label: "Business" },
  { value: "document", label: "Document" },
  { value: "products", label: "Products" },
];
const SOURCES = [
  { value: "", label: "All sources" },
  { value: "contact form", label: "Contact Form" },
  { value: "new_year", label: "Offer Leads" },
  { value: "Help Form", label: "Help Form" },
  { value: "quotation_lead", label: "Quotation Lead" },
  { value: "email", label: "Email" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "gmb", label: "GMB" },
  { value: "referral", label: "Referral" },
  { value: "knowlarity", label: "Knowlarity" },
  { value: "business", label: "Business" },
  { value: "furniture", label: "Furniture" },
  { value: "rent_saver_form", label: "Rent Saver Form" },
];
const FOLLOWUPS = [
  { value: "", label: "All follow-ups" },
  { value: "contacted", label: "Contacted" },
  { value: "rnr-lead", label: "RNR Lead" },
  { value: "invalid-lead", label: "Invalid Lead" },
  { value: "follow-up-needed", label: "Follow Up Needed" },
  { value: "converted-to-quote", label: "Converted To Quote" },
  { value: "retrieval-concern", label: "Retrieval Concern" },
  { value: "payment-concern", label: "Payment Concern" },
];
const VERIFIED = [
  { value: "", label: "Any verification" },
  { value: "yes", label: "Verified" },
  { value: "no", label: "Not verified" },
];

export default function LeadsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [storageType, setStorageType] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [source, setSource] = useState("");
  const [verified, setVerified] = useState("");
  const [from, setFrom] = useState(() => ymd()); // default: today
  const [to, setTo] = useState(() => ymd());
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [reps, setReps] = useState([]);
  const [transferTo, setTransferTo] = useState("");
  const [transferring, setTransferring] = useState(false);

  const load = useCallback(
    (signal) => {
      const s = getSession();
      if (!s) return Promise.resolve();
      setLoading(true);
      return fetchHouseholdLeads({ userId: s.user_id, storageType, followUp, source, verified, from, to, limit: 500, signal })
        .then((d) => {
          setList(d);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load leads. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [storageType, followUp, source, verified, from, to]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // clear selection whenever the list reloads
  useEffect(() => setSelected(new Set()), [list]);

  // CRM users for the transfer-to dropdown (once)
  useEffect(() => {
    const ctrl = new AbortController();
    fetchCrmUsers({ signal: ctrl.signal }).then(setReps).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const doTransfer = async () => {
    if (!transferTo || selected.size === 0) return;
    setTransferring(true);
    try {
      await transferLeads({ toUserId: transferTo, leadIds: [...selected] });
      setSelected(new Set());
      setTransferTo("");
      load();
    } catch {
      setError("Couldn't transfer the leads. Please try again.");
    } finally {
      setTransferring(false);
    }
  };

  // Status triage counts (like the legacy tiles) — from the loaded set.
  const stats = useMemo(() => {
    const s = { total: 0, new: 0, contacted: 0, rnr: 0, followup: 0, converted: 0, invalid: 0, verified: 0 };
    for (const l of list || []) {
      s.total++;
      if (String(l.verified).toLowerCase() === "yes") s.verified++;
      const f = String(l.follow_up || "").toLowerCase();
      if (!f) s.new++;
      else if (f === "contacted") s.contacted++;
      else if (f === "rnr-lead") s.rnr++;
      else if (f === "follow-up-needed") s.followup++;
      else if (f === "converted-to-quote") s.converted++;
      else if (f === "invalid-lead" || f === "lost-lead") s.invalid++;
    }
    return s;
  }, [list]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list || [];
    const digits = q.replace(/\D/g, "");
    return (list || []).filter(
      (l) =>
        (l.customer_name || "").toLowerCase().includes(q) ||
        (l.customer_email || "").toLowerCase().includes(q) ||
        (l.customer_local_city || "").toLowerCase().includes(q) ||
        String(l.id || "").includes(q) || // lead id
        String(l.customer_id || "").includes(q) ||
        String(l.customer_unique_id || "").toLowerCase().includes(q) ||
        (l.customer_mobile_no || "").includes(q) ||
        (!!digits && String(l.customer_mobile_no || "").replace(/\D/g, "").includes(digits))
    );
  }, [list, query]);


  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Users className="h-5 w-5" />
            </span>
            Leads
          </h1>
          <p className="mt-1 text-sm text-slate-500">Your household, business & document leads not yet converted to a quote. Showing today by default — change the date range to see more.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> Create lead
          </button>
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>
      </div>

      {showCreate && <CreateLeadModal onClose={() => setShowCreate(false)} onCreated={() => load()} />}

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* status triage tiles */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="Total" value={stats.total} tone="slate" />
        <StatTile label="New" value={stats.new} tone="amber" />
        <StatTile label="Contacted" value={stats.contacted} tone="sky" />
        <StatTile label="RNR" value={stats.rnr} tone="rose" />
        <StatTile label="Follow-up" value={stats.followup} tone="indigo" />
        <StatTile label="Converted" value={stats.converted} tone="emerald" />
        <StatTile label="Invalid/Lost" value={stats.invalid} tone="slate" />
        <StatTile label="Verified" value={stats.verified} tone="emerald" />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={storageType} onChange={setStorageType} options={STORAGE} />
        <FilterSelect value={source} onChange={setSource} options={SOURCES} />
        <FilterSelect value={followUp} onChange={setFollowUp} options={FOLLOWUPS} />
        <FilterSelect value={verified} onChange={setVerified} options={VERIFIED} />
        <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">
          <span className="font-semibold">From</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-slate-700 focus:outline-none" />
        </label>
        <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">
          <span className="font-semibold">To</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-slate-700 focus:outline-none" />
        </label>
        <span className="flex-1" />
        <span className="text-xs text-slate-400">{list ? `${rows.length.toLocaleString("en-IN")} leads` : "Loading…"}</span>
        <div className="relative min-w-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, city…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
          />
        </div>
      </div>

      {/* table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <Th>Customer</Th>
                <Th className="hidden lg:table-cell">Message</Th>
                <Th>Type</Th>
                <Th className="hidden md:table-cell">Source</Th>
                <Th>Follow-up</Th>
                <Th className="hidden lg:table-cell">Follow-up note</Th>
                <Th className="hidden xl:table-cell">Created</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!list &&
                [...Array(10)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-4">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {list && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-slate-400">No leads match this view.</td>
                </tr>
              )}
              {(list ? rows : []).map((l) => (
                <Row key={l.id} l={l} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* --------- Lead message intent (local sentiment, no AI key) --------- */
function MsgSentiment({ text }) {
  const { intent } = analyzeSentiment(text);
  if (!intent) return null;
  return (
    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${INTENT_STYLE[intent.tone]}`}>
      {intent.label}
    </span>
  );
}

/* ----------------------------- StatTile ----------------------------- */
function StatTile({ label, value, tone }) {
  const tones = {
    slate: "text-slate-700",
    amber: "text-amber-600",
    sky: "text-sky-600",
    rose: "text-rose-600",
    indigo: "text-indigo-600",
    emerald: "text-emerald-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tones[tone] || "text-slate-700"}`}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

// Seconds spent on a follow-up (start → end). 0 when not logged — the signal a
// "contacted" status may have no real call behind it.
function callSecs(l) {
  const s = l.follow_up_start_time;
  const e = l.follow_up_end_time;
  if (!s || !e || String(s).startsWith("0000") || String(e).startsWith("0000")) return 0;
  const a = new Date(String(s).replace(" ", "T")).getTime();
  const b = new Date(String(e).replace(" ", "T")).getTime();
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  return Math.round((b - a) / 1000);
}

// Time spent on a follow-up as "Xm Ys" (for display), or null.
function callDur(l) {
  const secs = callSecs(l);
  if (!secs) return null;
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

/* ----------------------------- Row ----------------------------- */
function Row({ l }) {
  const phone = String(l.customer_mobile_no || "").replace(/\D+/g, "");
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={l.customer_name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-slate-800">{l.customer_name || "Unknown"}</span>
              {String(l.verified).toLowerCase() === "yes" && (
                <span title="OTP verified" className="inline-flex items-center text-emerald-600">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
              {l.customer_mobile_no && <span className="tabular-nums">{l.customer_mobile_no}</span>}
              {l.customer_email && <span className="truncate">{l.customer_email}</span>}
              {l.customer_local_city && <span className="capitalize">· {l.customer_local_city}</span>}
              {(l.user_fname || l.user_lname) && (
                <span className="text-slate-400">· {`${l.user_fname || ""} ${l.user_lname || ""}`.trim()}</span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <p className="line-clamp-2 max-w-[220px] text-xs leading-snug text-slate-500" title={l.customer_message}>
          {l.customer_message || "—"}
        </p>
        {l.customer_message && <MsgSentiment text={l.customer_message} />}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-indigo-700">
          {prettyWords(l.storage_type).replace(" Storage", "")}
        </span>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="text-xs capitalize text-slate-600">{prettyWords(l.source) || "—"}</span>
      </td>
      <td className="px-4 py-3">
        {l.follow_up ? (
          <div className="leading-tight">
            <div className="whitespace-nowrap text-xs font-semibold capitalize text-slate-700">{prettyWords(l.follow_up)}</div>
            {l.follow_up_date && !String(l.follow_up_date).startsWith("0000") && (
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">{fmtDate(l.follow_up_date)}</div>
            )}
            {callDur(l) && (
              <div className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-emerald-600" title="Time spent on this follow-up">
                <Clock className="h-3 w-3" /> {callDur(l)}
              </div>
            )}
          </div>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">New</span>
        )}
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <p className="line-clamp-2 max-w-[240px] text-xs leading-snug text-slate-500" title={l.follow_up_note}>
          {l.follow_up_note || "—"}
        </p>
      </td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <span className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(l.date)}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {phone && (
            <>
              <IconBtn href={`tel:${phone}`} title="Call" tone="call">
                <Phone className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn href={`https://wa.me/${phone.length === 10 ? "91" + phone : phone}`} title="WhatsApp" tone="whatsapp" external>
                <MessageCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
          {l.customer_email && (
            <IconBtn href={`mailto:${l.customer_email}`} title="Email" tone="view">
              <Mail className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- Create Lead modal ----------------------------- */
function CreateLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", mobile: "", email: "", message: "", storageType: "household_storage", source: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim()) return setError("Name and email are required.");
    if (!/^\d{10}$/.test(form.mobile.trim())) return setError("Enter a valid 10-digit mobile number.");
    setSaving(true);
    try {
      const s = getSession();
      const res = await addHouseholdLead({ ...form, userId: s?.user_id });
      if (res?.status === "success") {
        onCreated?.();
        onClose();
      } else {
        setError(res?.message || "Couldn't create the lead. Please try again.");
      }
    } catch {
      setError("Couldn't create the lead. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Plus className="h-4 w-4 text-indigo-600" /> Create lead
          </h2>
          <button onClick={onClose} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-5">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          <Field label="Customer name *">
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Full name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile *">
              <input value={form.mobile} onChange={(e) => set("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} className={inputCls} placeholder="10-digit" inputMode="numeric" />
            </Field>
            <Field label="Email *">
              <input value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="name@email.com" type="email" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Storage type">
              <select value={form.storageType} onChange={(e) => set("storageType", e.target.value)} className={inputCls}>
                {STORAGE.filter((s) => s.value).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <select value={form.source} onChange={(e) => set("source", e.target.value)} className={inputCls}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Message / requirement">
            <textarea value={form.message} onChange={(e) => set("message", e.target.value)} rows={3} className={inputCls} placeholder="What are they storing?" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create lead
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/* ----------------------------- bits ----------------------------- */
function FilterSelect({ value, onChange, options }) {
  const active = value !== "";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
        active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
      {initials || "?"}
    </span>
  );
}

function IconBtn({ href, title, external, tone, children }) {
  const tones = {
    call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    whatsapp: "border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
    view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
  };
  const cls = tones[tone] || "border-slate-200 text-slate-500 hover:bg-indigo-50";
  return (
    <a href={appHref(href)} title={title} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${cls}`}>
      {children}
    </a>
  );
}

function prettyWords(s) {
  if (!s) return "";
  return String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function fmtDate(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  if (!m || !d) return "—";
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}

function fmtDateTime(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const [date, time] = String(value).split(" ");
  const hm = (time || "").slice(0, 5);
  const d = fmtDate(date);
  return hm ? `${d} · ${hm}` : d;
}
