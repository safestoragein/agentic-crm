"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Loader2,
  Phone,
  MessageCircle,
  Mail,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  X,
  MapPin,
  UserPlus,
  UserCog,
  Warehouse,
  Activity,
  PhoneCall,
  Bell,
  CalendarDays,
  CalendarClock,
} from "lucide-react";
import { fetchCustomers, fetchCustomerFilters } from "@/lib/customers";
import QuickFollowUpModal from "@/components/QuickFollowUpModal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE_SIZE = 25;

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "retrieved", label: "Retrieved" },
  { value: "discard", label: "Discarded" },
  { value: "cancelled", label: "Cancelled" },
];

const FOLLOW_UPS = [
  { value: "", label: "All follow-ups" },
  { value: "called", label: "Called" },
  { value: "no-answer", label: "No answer" },
  { value: "call-later", label: "Call later" },
  { value: "sent-message", label: "Sent message" },
  { value: "closed", label: "Closed" },
  { value: "discard", label: "Discard" },
];

const REMINDERS = [
  { value: "", label: "All reminders" },
  { value: "0", label: "Active reminder" },
  { value: "1", label: "Inactive reminder" },
];

const EMPTY_FILTERS = {
  city: "",
  status: "",
  crmuser: "",
  user_id: "",
  follow_up: "",
  warehouse_id: "",
  is_active_reminder: "",
  dateFrom: "",
  dateTo: "",
};

export default function ManageCustomersPage() {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [f, setF] = useState(EMPTY_FILTERS);
  const [start, setStart] = useState(0);

  const [opts, setOpts] = useState({ cities: [], crm_users: [], warehouses: [], users: [] });

  // Customer whose follow-up is being edited (null = modal closed).
  const [followUpFor, setFollowUpFor] = useState(null);

  const setFilter = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Patch a single row in place after a follow-up save (no full reload flash).
  const patchRow = (customerId, patch) =>
    setRows((prev) => (prev ? prev.map((r) => (r.customer_id === customerId ? { ...r, ...patch } : r)) : prev));

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setStart(0), [search, f]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCustomerFilters({ signal: ctrl.signal })
      .then((d) => setOpts({ cities: d.cities || [], crm_users: d.crm_users || [], warehouses: d.warehouses || [], users: d.users || [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const searchDate = f.dateFrom && f.dateTo ? `${f.dateFrom.replaceAll("-", "/")}-${f.dateTo.replaceAll("-", "/")}` : "";

  const load = useCallback(
    (signal) => {
      setLoading(true);
      return fetchCustomers(
        {
          start,
          length: PAGE_SIZE,
          search,
          customer_type: "active_customer",
          city: f.city,
          status: f.status,
          crmuser_id: f.crmuser,
          user_id: f.user_id,
          follow_up: f.follow_up,
          warehouse_id: f.warehouse_id,
          is_active_reminder: f.is_active_reminder,
          search_date: searchDate,
        },
        { signal }
      )
        .then((d) => {
          setRows(d.rows);
          setTotal(d.total);
          setFiltered(d.filtered);
          setError("");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load customers. Please refresh.");
        })
        .finally(() => setLoading(false));
    },
    [start, search, f, searchDate]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const page = Math.floor(start / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
  const activeFilterCount = (search ? 1 : 0) + Object.entries(f).filter(([k, v]) => v && k !== "dateTo").length;
  const anyFilter = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setF(EMPTY_FILTERS);
  };

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Users className="h-5 w-5" />
            </span>
            Manage Customers
          </h1>
          <p className="mt-1 text-sm text-slate-500">All active customers across SafeStorage, with live filters.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatPill label="Total" value={rows ? total.toLocaleString("en-IN") : "—"} tone="slate" />
          <StatPill label="Matching" value={rows ? filtered.toLocaleString("en-IN") : "—"} tone="indigo" />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* search + filter pills */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, email, ID, city, address…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-9 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />}
          {anyFilter && (
            <button
              onClick={clearFilters}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Clear {activeFilterCount}
            </button>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Pill icon={MapPin} value={f.city} onChange={(v) => setFilter("city", v)}>
            <option value="">All cities</option>
            {opts.cities.map((c) => (
              <option key={c.city_slug} value={c.city_slug}>
                {c.city_name}
              </option>
            ))}
          </Pill>

          <Pill icon={UserPlus} value={f.user_id} onChange={(v) => setFilter("user_id", v)}>
            <option value="">Created by · all</option>
            {opts.users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {`${u.user_fname || ""} ${u.user_lname || ""}`.trim()}
              </option>
            ))}
          </Pill>

          <Pill icon={UserCog} value={f.crmuser} onChange={(v) => setFilter("crmuser", v)}>
            <option value="">CRM user · all</option>
            {opts.crm_users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.user_fname}
              </option>
            ))}
          </Pill>

          <Pill icon={Warehouse} value={f.warehouse_id} onChange={(v) => setFilter("warehouse_id", v)}>
            <option value="">All warehouses</option>
            {opts.warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </Pill>

          <Pill icon={Activity} value={f.status} onChange={(v) => setFilter("status", v)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Pill>

          <Pill icon={PhoneCall} value={f.follow_up} onChange={(v) => setFilter("follow_up", v)}>
            {FOLLOW_UPS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Pill>

          <Pill icon={Bell} value={f.is_active_reminder} onChange={(v) => setFilter("is_active_reminder", v)}>
            {REMINDERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Pill>

          {/* date range pill */}
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50/50 px-2.5 py-1.5 ring-1 ring-indigo-200">
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              <CalendarDays className="h-3 w-3" /> Date
            </span>
            <input
              type="date"
              value={f.dateFrom}
              max={f.dateTo || undefined}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
              className="bg-transparent text-xs text-slate-600 focus:outline-none"
            />
            <span className="text-xs text-slate-400">–</span>
            <input
              type="date"
              value={f.dateTo}
              min={f.dateFrom || undefined}
              onChange={(e) => setFilter("dateTo", e.target.value)}
              className="bg-transparent text-xs text-slate-600 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/90 text-left text-[11px] uppercase tracking-wider text-slate-500 backdrop-blur">
                <Th>Customer</Th>
                <Th className="hidden lg:table-cell">City</Th>
                <Th>Status</Th>
                <Th className="hidden md:table-cell">Follow-up</Th>
                <Th className="hidden md:table-cell">Follow-up date</Th>
                <Th className="hidden lg:table-cell">Follow-up note</Th>
                <Th className="hidden xl:table-cell">CRM</Th>
                <Th className="hidden lg:table-cell">Warehouse</Th>
                <Th className="hidden xl:table-cell">Created</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!rows && [...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-20 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <Users className="h-6 w-6" />
                      </span>
                      <p className="mt-3 text-sm font-semibold text-slate-600">No customers found</p>
                      <p className="mt-1 text-xs text-slate-400">Try clearing some filters or a different search.</p>
                    </div>
                  </td>
                </tr>
              )}
              {rows?.map((c) => (
                <Row key={c.customer_id} c={c} onFollowUp={setFollowUpFor} />
              ))}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {rows && filtered > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-4 py-3 text-sm text-slate-500">
            <span>
              <span className="font-semibold text-slate-700">
                {start + 1}–{Math.min(start + PAGE_SIZE, filtered)}
              </span>{" "}
              of {filtered.toLocaleString("en-IN")}
            </span>
            <div className="flex items-center gap-1.5">
              <PagerBtn disabled={start === 0} onClick={() => setStart((s) => Math.max(0, s - PAGE_SIZE))}>
                <ChevronLeft className="h-4 w-4" />
              </PagerBtn>
              <span className="px-2 text-xs font-medium text-slate-600">
                Page {page} / {totalPages}
              </span>
              <PagerBtn disabled={page >= totalPages} onClick={() => setStart((s) => s + PAGE_SIZE)}>
                <ChevronRight className="h-4 w-4" />
              </PagerBtn>
            </div>
          </div>
        )}
      </div>

      {followUpFor && (
        <QuickFollowUpModal
          entity="customer"
          id={followUpFor.customer_id}
          name={followUpFor.customer_name}
          subtitle={followUpFor.customer_unique_id || `ID ${followUpFor.customer_id}`}
          follow_up={followUpFor.follow_up}
          follow_up_date={followUpFor.follow_up_date}
          follow_up_note={followUpFor.follow_up_note}
          onClose={() => setFollowUpFor(null)}
          onSaved={(patch) => {
            patchRow(followUpFor.customer_id, patch);
            setFollowUpFor(null);
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------- Row ----------------------------- */
function Row({ c, onFollowUp }) {
  const st = statusBadge(c.status);
  const tone = ROW_TONES[toneIndex(c.customer_name)];
  return (
    <tr className={`group border-l-4 transition-colors ${tone.border} ${tone.hover}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={c.customer_name} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a href={appHref(`/customer/${c.customer_id}`)} className="truncate text-sm font-semibold text-slate-800 group-hover:text-indigo-700">
                {c.customer_name || "Unknown"}
              </a>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                {c.customer_unique_id || `ID ${c.customer_id}`}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-slate-500">
              {c.customer_contact1 && <span className="tabular-nums">+91 {c.customer_contact1}</span>}
              {c.customer_email && <span className="truncate">{c.customer_email}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="inline-flex items-center gap-1 text-sm capitalize text-slate-600">
          {c.customer_local_city ? <MapPin className="h-3.5 w-3.5 text-slate-300" /> : null}
          {c.customer_local_city || "—"}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {st.label}
        </span>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {c.follow_up ? (
          <span className="whitespace-nowrap text-xs font-semibold capitalize text-slate-700">{prettyWords(c.follow_up)}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {c.follow_up_date && !String(c.follow_up_date).startsWith("0000") ? (
          <span className="whitespace-nowrap text-xs text-slate-600">{fmtDate(c.follow_up_date)}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 lg:table-cell align-top">
        {c.follow_up_note ? (
          <div className="max-h-40 max-w-[340px] min-w-[220px] overflow-y-auto whitespace-pre-line break-words text-xs leading-snug text-slate-600">
            {c.follow_up_note}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 xl:table-cell">
        {c.crm_user ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700" title="CRM user · relationship manager">
            <UserCog className="h-3 w-3" /> {c.crm_user}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="whitespace-nowrap text-xs text-slate-600">{c.warehouse_name || c.warehouse_no || "—"}</span>
      </td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <span className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(c.customer_created_at)}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => onFollowUp?.(c)}
            title="Add follow-up"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition-colors hover:bg-amber-100"
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
          <IconBtn href={appHref(`/customer/${c.customer_id}`)} title="View details" tone="view">
            <Eye className="h-3.5 w-3.5" />
          </IconBtn>
          {c.customer_contact1 && (
            <>
              <IconBtn href={`tel:+91${c.customer_contact1}`} title="Call" tone="call">
                <Phone className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn href={`https://wa.me/91${c.customer_contact1}`} title="WhatsApp" tone="whatsapp" external>
                <MessageCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
          {c.customer_email && (
            <IconBtn href={`mailto:${c.customer_email}`} title="Email" tone="email">
              <Mail className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

function SkeletonRow() {
  return (
    <tr>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="space-y-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
            <div className="h-2.5 w-28 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      </td>
      {[...Array(8)].map((_, i) => (
        <td key={i} className={`px-4 py-3.5 ${i > 1 ? "hidden lg:table-cell" : ""}`}>
          <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
        </td>
      ))}
      <td className="px-4 py-3.5">
        <div className="ml-auto h-7 w-20 animate-pulse rounded-lg bg-slate-100" />
      </td>
    </tr>
  );
}

/* ----------------------------- bits ----------------------------- */
function StatPill({ label, value, tone }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  };
  return (
    <div className={`rounded-xl border px-3.5 py-1.5 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-base font-bold leading-tight tabular-nums">{value}</div>
    </div>
  );
}

function Pill({ icon: Icon, value, onChange, children }) {
  const active = value !== "" && value != null;
  return (
    <div
      className={`relative inline-flex items-center rounded-xl border transition-colors ${
        active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <Icon className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${active ? "text-indigo-500" : "text-slate-400"}`} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`max-w-[170px] cursor-pointer appearance-none truncate bg-transparent py-2 pl-8 pr-7 text-sm focus:outline-none ${
          active ? "font-semibold text-indigo-700" : "text-slate-600"
        }`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-slate-400" />
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

// Per-customer color, hashed from the name so it's stable. The avatar and the
// row's left border share the same index, giving each customer a consistent hue.
const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700",
  "bg-violet-100 text-violet-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-teal-100 text-teal-700",
];
const ROW_TONES = [
  { border: "border-l-indigo-300", hover: "hover:bg-indigo-50/50" },
  { border: "border-l-violet-300", hover: "hover:bg-violet-50/50" },
  { border: "border-l-sky-300", hover: "hover:bg-sky-50/50" },
  { border: "border-l-emerald-300", hover: "hover:bg-emerald-50/50" },
  { border: "border-l-amber-300", hover: "hover:bg-amber-50/50" },
  { border: "border-l-rose-300", hover: "hover:bg-rose-50/50" },
  { border: "border-l-fuchsia-300", hover: "hover:bg-fuchsia-50/50" },
  { border: "border-l-teal-300", hover: "hover:bg-teal-50/50" },
];
function toneIndex(name) {
  const s = String(name || "?");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % AVATAR_TONES.length;
}
function Avatar({ name }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${AVATAR_TONES[toneIndex(name)]}`}>
      {initials || "?"}
    </span>
  );
}

function IconBtn({ href, title, external, tone, children }) {
  const tones = {
    call: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    whatsapp: "border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
    view: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
    email: "border-slate-200 bg-white text-indigo-500 hover:bg-indigo-50",
  };
  const cls = tones[tone] || "border-slate-200 text-slate-500 hover:bg-indigo-50";
  return (
    <a
      href={appHref(href)}
      title={title}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${cls}`}
    >
      {children}
    </a>
  );
}

function PagerBtn({ disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* ----------------------------- helpers ----------------------------- */
function statusBadge(s) {
  const map = {
    0: { label: "Active", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    1: { label: "Retrieved", cls: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
    2: { label: "Discarded", cls: "bg-slate-100 text-slate-500", dot: "bg-slate-400" },
    3: { label: "Cancelled", cls: "bg-rose-50 text-rose-600", dot: "bg-rose-500" },
  };
  return map[String(s)] || { label: "—", cls: "bg-slate-100 text-slate-500", dot: "bg-slate-300" };
}

function prettyWords(s) {
  if (!s) return "—";
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
