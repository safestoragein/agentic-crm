"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, AlertTriangle, ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import { fetchBookingReport, rangeForPreset, triggerAutoShareWarehouse } from "@/lib/crm";
import { fetchCustomerFilters } from "@/lib/customers";
import { snapshotAllProductivity } from "@/lib/activity";
import { appHref } from "@/lib/paths";
import DateFilter from "@/components/DateFilter";

// Metric groups — mirrors the legacy report/booking_report layout. Each entry is
// [data key, label]; the comparison value is the same key prefixed with "c_".
const GROUPS = [
  {
    title: "Overview",
    color: "#6366F1",
    // 3rd element = legacy report page to open on click (?city=&search_date=).
    items: [
      ["leads_count", "Total Leads", "view_leads"],
      ["leads_count_active", "Open Leads", "view_leads"],
      ["leads_count_invalid", "Invalid Leads", "view_leads"],
      // Quotations = open quotes + bookings (matches the old dashboard, e.g. 127 + 30 = 157).
      ["total_customer_count", "Quotations", "quotation_customers"],
      ["booking_customer_count", "Total Bookings", "booked_customers"],
      ["cancelled_customer_count", "Cancelled Bookings", "booked_customers_cancel"],
    ],
  },
  {
    title: "Quotations",
    color: "#8B5CF6",
    items: [
      ["total_customer_count", "Quotations", "quotation_customers"],
      ["quotation_customer_count_invalid_attempt", "Invalid Quotes", "quotation_customers"],
      ["quotation_customer_count_lost_attempt", "Lost", "quotation_customers"],
      ["quotation_customer_count_not_called", "Not Called", "quotation_customers"],
    ],
  },
  {
    title: "Follow-ups",
    color: "#F59E0B",
    items: [
      ["today_followup_missed", "Quotation F/U Pending", "follow_up_customers"],
      ["today_lead_followup_null", "Lead F/U Pending", "lead_follow_up_customers"],
      ["today_lead_followup_tried", "Lead F/U Tried", "lead_follow_up_customers"],
      ["today_lead_verified_otp", "OTP Verified Leads", "lead_follow_up_customers"],
      ["today_lead_verified_otp_null", "OTP Not Verified", "lead_follow_up_customers"],
      ["today_lead_followup_tried_otp", "OTP F/U Tried", "lead_follow_up_customers"],
    ],
  },
  {
    title: "Pickups",
    color: "#10B981",
    items: [
      ["booking_customer_count", "Pickup Bookings", "booked_customers"],
      ["sstp_pickup_count", "SafeStorage Pickups"],
      ["wtp_pickup_count", "Self Transport"],
      ["vtp_pickup_count", "Vendor Pickups"],
      ["cancelled_customer_count", "Cancellations", "booked_customers_cancel"],
    ],
  },
];


// The pickup-type metrics come back as {order_count: N} from the legacy model;
// pull the number out, otherwise treat as a plain number.
function num(value) {
  if (value && typeof value === "object") return Number(value.order_count ?? value.count ?? 0);
  return Number(value ?? 0);
}

function shiftYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function rangeDays(from, to) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export default function BookingReportPage() {
  const [range, setRange] = useState(() => rangeForPreset("today"));
  const [city, setCity] = useState("");
  const [cities, setCities] = useState([]);
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const handleRange = useCallback((r) => setRange(r), []);

  // Link to the dedicated list page (opens in a new tab so the team can keep
  // several lists open at once). Carries the card's metric + current filters.
  const linkFor = useCallback(
    (type, label) => {
      const p = new URLSearchParams({ type, label, from: range.from, to: range.to });
      if (city) p.set("city", city);
      return appHref(`/booking-report/list?${p.toString()}`);
    },
    [range, city]
  );

  useEffect(() => {
    fetchCustomerFilters()
      .then((d) => setCities(d.cities || []))
      .catch(() => {});
    // No cron — sweep & send warehouse media (to customers created ~3 min ago,
    // once) whenever this page is opened.
    triggerAutoShareWarehouse();
    // Persist today's productivity for every active rep into ss_crm_productivity_daily
    // whenever this team page loads (server recomputes from the activity log + quotes).
    snapshotAllProductivity({});
  }, []);

  // Comparison period = the same number of days immediately before the range.
  const cmp = useMemo(() => {
    if (!compare) return {};
    const days = rangeDays(range.from, range.to);
    const compareTo = shiftYmd(range.from, -1);
    const compareFrom = shiftYmd(compareTo, -(days - 1));
    return { compareFrom, compareTo };
  }, [compare, range]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetchBookingReport({ from: range.from, to: range.to, city, ...cmp, signal: ctrl.signal })
      .then((d) => {
        setData(d);
        if (!d || Object.keys(d).length === 0) setError("No data returned. The booking_report_data endpoint may not be deployed yet.");
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load the booking report. Is the backend endpoint deployed?");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [range, city, cmp]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-7">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <BarChart3 className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Booking Report</h1>
            <p className="text-sm text-slate-500">Leads, quotations, bookings &amp; pickups · {range.label}</p>
          </div>
        </div>
        <DateFilter onChange={handleRange} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        >
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c.city_slug} value={c.city_slug}>
              {c.city_name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Compare to previous period
        </label>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
      </div>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Metric groups */}
      {!data && loading ? (
        <ReportSkeleton />
      ) : data ? (
        <div className="mt-6 space-y-7">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.color }} />
                {g.title}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {g.items.map(([key, label, special]) => (
                  <MetricCard
                    key={`${g.title}-${key}-${label}`}
                    label={label}
                    value={data[key]}
                    accent={g.color}
                    href={special ? linkFor(special, label) : undefined}
                    compareValue={compare ? data[`c_${key}`] : undefined}
                  />
                ))}
              </div>
            </section>
          ))}

          {Array.isArray(data.crm_wise_orders) && data.crm_wise_orders.length > 0 && (
            <TeamPerformance reps={data.crm_wise_orders} />
          )}
        </div>
      ) : null}

    </div>
  );
}

const AVATAR_COLORS = [
  "#6366F1", "#10B981", "#3B82F6", "#F97316", "#8B5CF6",
  "#14B8A6", "#64748B", "#F59E0B", "#EC4899", "#0EA5E9",
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function TeamPerformance({ reps }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        <span className="h-3 w-3 rounded-full bg-orange-500" />
        Team Performance
      </h2>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
        {reps.map((r) => {
          const name = r.user_fname || "Unassigned";
          const bookings = num(r.order_count);
          return (
            <div
              key={r.user_id ?? name}
              className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center shadow-sm"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: avatarColor(name) }}
              >
                {initials(name)}
              </span>
              <div className="mt-1.5 w-full truncate text-xs font-semibold text-slate-800">{name}</div>
              <div className="text-lg font-bold text-orange-500">{bookings}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({ label, value, accent, href, compareValue }) {
  const v = num(value);
  const hasCmp = compareValue !== undefined && compareValue !== null;
  const c = num(compareValue);
  const delta = v - c;
  const up = delta > 0;
  const down = delta < 0;
  const Tag = href ? "a" : "div";

  return (
    <Tag
      {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}
      className={`block w-full rounded-2xl border p-4 text-left shadow-sm transition-shadow hover:shadow-md ${href ? "cursor-pointer" : ""}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${accent}1f, ${accent}08)`,
        borderColor: `${accent}33`,
      }}
    >
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
        <span className="truncate">{label}</span>
        {href && <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
        {value == null ? "—" : v.toLocaleString("en-IN")}
      </div>
      {hasCmp && (
        <div className="mt-1 flex items-center gap-1 text-[11px]">
          <span
            className={`inline-flex items-center gap-0.5 font-semibold ${
              up ? "text-emerald-600" : down ? "text-rose-600" : "text-slate-400"
            }`}
          >
            {up && <ArrowUpRight className="h-3 w-3" />}
            {down && <ArrowDownRight className="h-3 w-3" />}
            {delta > 0 ? `+${delta}` : delta}
          </span>
          <span className="text-slate-400">vs {c.toLocaleString("en-IN")}</span>
        </div>
      )}
    </Tag>
  );
}

function ReportSkeleton() {
  return (
    <div className="mt-6 space-y-7">
      {GROUPS.map((g) => (
        <section key={g.title}>
          <div className="mb-3 h-3 w-24 rounded bg-slate-200" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {g.items.map((_, i) => (
              <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-slate-100 bg-slate-100" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
