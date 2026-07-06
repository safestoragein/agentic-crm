"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useRef, useState } from "react";
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
  CalendarClock,
} from "lucide-react";
import { fetchCustomers, fetchCustomerFilters, searchCustomerCreators } from "@/lib/customers";
import QuickFollowUpModal from "@/components/QuickFollowUpModal";
import DateFilter from "@/components/DateFilter";
import ExportButton from "@/components/ExportButton";
import { rangeForPreset } from "@/lib/crm";

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

// Columns for the "Export to Excel" button — mirrors the key visible table
// columns, formatting dates/nulls the same way the rows render them.
const CUSTOMER_EXPORT_COLS = [
  { header: "Customer", value: (c) => c.customer_name || "" },
  { header: "Customer ID", value: (c) => c.customer_unique_id || (c.customer_id ? `ID ${c.customer_id}` : "") },
  { header: "Phone", value: (c) => (c.customer_contact1 ? `+91 ${c.customer_contact1}` : "") },
  { header: "Email", value: (c) => c.customer_email || "" },
  { header: "City", value: (c) => c.customer_local_city || "" },
  { header: "Status", value: (c) => statusBadge(c.status).label },
  { header: "Follow-up", value: (c) => (c.follow_up ? prettyWords(c.follow_up) : "") },
  { header: "Follow-up date", value: (c) => fmtDate(c.follow_up_date) },
  { header: "Follow-up note", value: (c) => c.follow_up_note || "" },
  { header: "CRM user", value: (c) => c.crm_user || "" },
  { header: "Warehouse", value: (c) => c.warehouse_name || c.warehouse_no || "" },
  { header: "Created", value: (c) => fmtDateTime(c.customer_created_at) },
];

export default function ManageCustomersPage() {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Default view = this month (fast). Search ignores the date so any customer,
  // even years back, is findable — see `searchDate` below.
  const [f, setF] = useState(() => {
    const m = rangeForPreset("month");
    return { ...EMPTY_FILTERS, dateFrom: m.from, dateTo: m.to };
  });
  const [start, setStart] = useState(0);

  const [opts, setOpts] = useState({ cities: [], crm_users: [], warehouses: [] });

  // Customer whose follow-up is being edited (null = modal closed).
  const [followUpFor, setFollowUpFor] = useState(null);

  const setFilter = (k, v) => setF((p) => ({ ...p, [k]: v }));
  // Shared DateFilter → created-date range. "All" (from 2000-01-01) maps back to
  // empty so the default stays "no date filter" (every customer), unchanged.
  const handleDateChange = useCallback((r) => {
    const all = r.from === "2000-01-01";
    setF((p) => ({ ...p, dateFrom: all ? "" : r.from, dateTo: all ? "" : r.to }));
  }, []);

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
      .then((d) => setOpts({ cities: d.cities || [], crm_users: d.crm_users || [], warehouses: d.warehouses || [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // While searching, drop the date window so the query spans ALL customers
  // (a 5-years-back customer is still found). No search → the date filter applies.
  const searchDate = search
    ? ""
    : f.dateFrom && f.dateTo
    ? `${f.dateFrom.replaceAll("-", "/")}-${f.dateTo.replaceAll("-", "/")}`
    : "";

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

  // The list is server-paginated (25/page); for Export we re-fetch the WHOLE
  // matching set in one call (same filters, start 0) so the file has every row,
  // not just the current page. Capped at 20k for safety.
  const exportAllRows = useCallback(async () => {
    const d = await fetchCustomers({
      start: 0,
      length: Math.min(Math.max(filtered || 0, PAGE_SIZE), 20000),
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
    });
    return d.rows;
  }, [filtered, search, f, searchDate]);

  const page = Math.floor(start / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
  // Date is the default month window, not a user-applied filter, so it doesn't
  // count toward the active-filter badge / clear button.
  const activeFilterCount =
    (search ? 1 : 0) + Object.entries(f).filter(([k, v]) => v && k !== "dateTo" && k !== "dateFrom").length;
  const anyFilter = activeFilterCount > 0;

  // Clear the other filters + search but keep the current date window (the
  // DateFilter control is uncontrolled, so leave its month selection in place).
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setF((p) => ({ ...EMPTY_FILTERS, dateFrom: p.dateFrom, dateTo: p.dateTo }));
  };

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">All active customers across SafeStorage, with live filters.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            filename="customers"
            columns={CUSTOMER_EXPORT_COLS}
            rows={rows || []}
            getRows={exportAllRows}
          />
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

          {/* Created-by can hold tens of thousands of users, so it's searched
              server-side (agentic_crm/search_users) as you type — never shipped
              or rendered whole. */}
          <SearchableSelect
            icon={UserPlus}
            value={f.user_id}
            onChange={(v) => setFilter("user_id", v)}
            allLabel="Created by · all"
            search={searchCustomerCreators}
          />

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

          {/* date range — shared DateFilter (created-date), default = this month */}
          <DateFilter onChange={handleDateChange} defaultPreset="month" />
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
              <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-0.5 text-sm font-bold tabular-nums text-indigo-700 ring-1 ring-indigo-100">
                {c.customer_unique_id || `ID ${c.customer_id}`}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-slate-500">
              {c.customer_contact1 && <span className="text-sm font-bold text-slate-900 tabular-nums">+91 {c.customer_contact1}</span>}
              {c.customer_email && <span className="truncate text-sm font-bold text-slate-900">{c.customer_email}</span>}
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
          <div className="max-h-40 min-w-[220px] max-w-[340px] overflow-y-auto whitespace-pre-line break-words rounded-lg border border-l-4 border-amber-300 border-l-amber-500 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-slate-900 shadow-sm">
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

// Searchable single-select backed by a server-side `search` fn — for option
// lists too large to ship to the client (e.g. the ~40k "Created by" users).
// `search({ q, ids, signal })` returns [{ value, label }]; pass `ids` to resolve
// the currently-selected value to its label. Only the matched handful is ever
// fetched or rendered, so the control costs nothing until it's opened.
function SearchableSelect({ icon: Icon, value, onChange, allLabel, search }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const ref = useRef(null);
  const active = value !== "" && value != null;

  // Resolve the selected value's label (e.g. on first load with a preset filter).
  useEffect(() => {
    if (!active) { setSelectedLabel(""); return; }
    const known = results.find((it) => it.value === String(value));
    if (known) { setSelectedLabel(known.label); return; }
    const ctrl = new AbortController();
    search({ ids: [String(value)], signal: ctrl.signal })
      .then((rows) => setSelectedLabel(rows[0]?.label || `User ${value}`))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced server search while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      search({ q: q.trim(), signal: ctrl.signal })
        .then((rows) => setResults(rows))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, q, search]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (v, label) => {
    onChange(v);
    if (label != null) setSelectedLabel(label);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={ref} className="relative inline-block">
      <div
        className={`relative inline-flex items-center rounded-xl border transition-colors ${
          active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
        }`}
      >
        <Icon className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${active ? "text-indigo-500" : "text-slate-400"}`} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`max-w-[190px] cursor-pointer truncate bg-transparent py-2 pl-8 pr-7 text-left text-sm focus:outline-none ${
            active ? "font-semibold text-indigo-700" : "text-slate-600"
          }`}
        >
          {active ? (selectedLabel || `User ${value}`) : allLabel}
        </button>
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-slate-400" />
      </div>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or ID…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => pick("", "")}
              className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 ${
                !active ? "font-semibold text-indigo-700" : "text-slate-600"
              }`}
            >
              {allLabel}
            </button>
            {results.map((it) => (
              <button
                key={it.value}
                type="button"
                onClick={() => pick(it.value, it.label)}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 ${
                  it.value === String(value) ? "font-semibold text-indigo-700" : "text-slate-700"
                }`}
              >
                {it.label} <span className="text-slate-400">#{it.value}</span>
              </button>
            ))}
            {loading && <div className="px-2.5 py-2 text-sm text-slate-400">Searching…</div>}
            {!loading && q.trim() && results.length === 0 && (
              <div className="px-2.5 py-2 text-sm text-slate-400">No matches.</div>
            )}
            {!loading && !q.trim() && results.length === 0 && (
              <div className="px-2.5 py-1.5 text-xs text-slate-400">Type a name or ID to search.</div>
            )}
          </div>
        </div>
      )}
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
