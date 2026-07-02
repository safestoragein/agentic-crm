"use client";
import { appHref } from "@/lib/paths";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  CheckCheck,
  Eye,
  Reply,
  Loader2,
  RefreshCw,
  Phone,
  Mail,
  Search,
  AlertTriangle,
  MailOpen,
  Send,
  MousePointerClick,
  Eye as EyeView,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { ymd } from "@/lib/crm";
import { fetchEngagedWhatsapp, fetchFailedWhatsapp, fetchFollowupEmails } from "@/lib/whatsapp";
import { analyzeSentiment, SENTIMENT_STYLE, INTENT_STYLE } from "@/lib/sentiment";
import AdminOnly from "@/components/AdminOnly";

// Customers who actually engaged with a WhatsApp follow-up — delivered, seen
// (read) or replied. These are the warm ones worth a same-day callback.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
  { key: "replied", label: "Replied", tone: "emerald" },
  { key: "read", label: "Seen", tone: "sky" },
  { key: "delivered", label: "Delivered", tone: "slate" },
  { key: "all", label: "All engaged" },
  { key: "failed", label: "Failed", tone: "rose" },
  { key: "email", label: "Email fallback", tone: "violet" },
];

// Date filter for the Failed tab (by send_date). days=0 → today, null → all.
const RANGES = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All", days: null },
];

export default function WhatsappEngagedPage() {
  return (
    <AdminOnly>
      <WhatsappEngagedPageInner />
    </AdminOnly>
  );
}

function WhatsappEngagedPageInner() {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(null);
  const [emails, setEmails] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("replied");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("7d");

  // from/to (send_date) for the failed-tab date filter. "all" → no bounds.
  const failWindow = useMemo(() => {
    const r = RANGES.find((x) => x.key === range) || RANGES[1];
    if (r.days == null) return {};
    const to = ymd();
    const from = r.days === 0 ? to : ymd(new Date(Date.now() - r.days * 86400000));
    return { from, to };
  }, [range]);

  const loadEngaged = useCallback((signal) => {
    const s = getSession();
    if (!s) return Promise.resolve();
    return fetchEngagedWhatsapp({ userId: s.user_id, signal })
      .then(setList)
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load engaged customers. Please refresh.");
      });
  }, []);

  const loadFailed = useCallback(
    (signal) => {
      const s = getSession();
      if (!s) return Promise.resolve();
      return fetchFailedWhatsapp({ userId: s.user_id, ...failWindow, signal })
        .then(setFailed)
        .catch((e) => {
          if (e?.name !== "AbortError") setFailed([]);
        });
    },
    [failWindow]
  );

  const loadEmails = useCallback(
    (signal) => {
      const s = getSession();
      if (!s) return Promise.resolve();
      return fetchFollowupEmails({ userId: s.user_id, ...failWindow, signal })
        .then(setEmails)
        .catch((e) => {
          if (e?.name !== "AbortError") setEmails([]);
        });
    },
    [failWindow]
  );

  const load = useCallback(
    (signal) => {
      setLoading(true);
      return Promise.all([loadEngaged(signal), loadFailed(signal), loadEmails(signal)]).finally(() => setLoading(false));
    },
    [loadEngaged, loadFailed, loadEmails]
  );

  // initial engaged load (once)
  useEffect(() => {
    const ctrl = new AbortController();
    loadEngaged(ctrl.signal);
    return () => ctrl.abort();
  }, [loadEngaged]);

  // failed + email lists reload whenever the date range changes
  useEffect(() => {
    const ctrl = new AbortController();
    setFailed(null);
    setEmails(null);
    loadFailed(ctrl.signal);
    loadEmails(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFailed, loadEmails]);

  const tier = (r) => (r.replied_at ? "replied" : r.read_at || r.status === "read" ? "read" : "delivered");
  const isFailedTab = tab === "failed";
  const isEmailTab = tab === "email";
  const usesRange = isFailedTab || isEmailTab; // both share the date filter

  const counts = useMemo(() => {
    const c = { all: 0, replied: 0, read: 0, delivered: 0, failed: (failed || []).length, email: (emails || []).length };
    for (const r of list || []) {
      c.all++;
      c[tier(r)]++;
    }
    return c;
  }, [list, failed, emails]);

  const matchesQuery = (r, q) => {
    const digits = q.replace(/\D/g, "");
    return (
      (r.customer_name || "").toLowerCase().includes(q) ||
      (r.customer_mobile || "").includes(q) ||
      (r.customer_contact1 || "").includes(q) ||
      (r.customer_email || "").toLowerCase().includes(q) ||
      String(r.customer_id ?? "").includes(q) ||
      String(r.customer_unique_id ?? "").toLowerCase().includes(q) ||
      (!!digits &&
        (String(r.customer_mobile || "").replace(/\D/g, "").includes(digits) ||
          String(r.customer_contact1 || "").replace(/\D/g, "").includes(digits)))
    );
  };

  const filtered = useMemo(() => {
    let rows = isEmailTab ? emails || [] : isFailedTab ? failed || [] : list || [];
    if (!usesRange && tab !== "all") rows = rows.filter((r) => tier(r) === tab);
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => matchesQuery(r, q));
    return rows;
  }, [list, failed, emails, tab, query, isFailedTab, isEmailTab, usesRange]);

  const ready = isEmailTab ? emails != null : isFailedTab ? failed != null : list != null;

  return (
    <div className="px-5 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <MessageCircle className="h-5 w-5" />
            </span>
            WhatsApp engaged
          </h1>
          <p className="mt-1 text-sm text-slate-500">Follow-up outreach: who engaged, what failed, and the email fallback sent when WhatsApp couldn't reach them.</p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Replied" value={counts.replied} icon={Reply} tone="emerald" />
        <Kpi label="Seen" value={counts.read} icon={Eye} tone="sky" />
        <Kpi label="Delivered" value={counts.delivered} icon={CheckCheck} tone="slate" />
        <Kpi label="Total engaged" value={counts.all} icon={MessageCircle} tone="indigo" />
        <Kpi label="Failed" value={counts.failed} icon={AlertTriangle} tone="rose" />
        <Kpi label="Email fallback" value={counts.email} icon={Mail} tone="violet" />
      </div>

      {/* tabs + search */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? t.tone === "rose"
                      ? "bg-rose-600 text-white"
                      : t.tone === "violet"
                        ? "bg-violet-600 text-white"
                        : "bg-emerald-600 text-white"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                  {counts[t.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        {/* date range — shared by the Failed + Email tabs */}
        {usesRange && (
          <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
            {RANGES.map((r) => {
              const active = range === r.key;
              return (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${
                    active ? (isEmailTab ? "bg-violet-600 text-white" : "bg-rose-600 text-white") : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="relative min-w-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, ID…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
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
                {isEmailTab ? <Th>Email</Th> : <Th>Phone</Th>}
                {isEmailTab ? (
                  <>
                    <Th>Status</Th>
                    <Th className="hidden md:table-cell">Opened</Th>
                    <Th className="hidden md:table-cell">Clicked</Th>
                    <Th className="hidden lg:table-cell">Sent at</Th>
                    <Th className="hidden xl:table-cell">Scenario</Th>
                  </>
                ) : (
                  <>
                    <Th className="hidden md:table-cell">Email</Th>
                    {isFailedTab ? <Th>Reason failed</Th> : <Th>Engagement</Th>}
                    <Th className="hidden lg:table-cell">{isFailedTab ? "Sent at" : "Follow-up"}</Th>
                    <Th className="hidden xl:table-cell">Scenario</Th>
                  </>
                )}
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!ready &&
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {ready && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm text-slate-400">
                    {isEmailTab
                      ? counts.email === 0
                        ? "No fallback emails yet — these appear when a follow-up WhatsApp fails and the customer has an email."
                        : "Nothing matches your search."
                      : isFailedTab
                        ? counts.failed === 0
                          ? "No failed messages — every follow-up went out cleanly. 🎉"
                          : "Nothing matches your search."
                        : counts.all === 0
                          ? "No engagement yet — once customers see or reply to a follow-up, they'll show here."
                          : "Nothing in this view."}
                  </td>
                </tr>
              )}
              {ready &&
                filtered.map((r) =>
                  isEmailTab ? (
                    <EmailRow key={`${r.customer_id}-${r.customer_email}-${r.sent_at}`} r={r} />
                  ) : isFailedTab ? (
                    <FailedRow key={`${r.customer_id}-${r.customer_mobile}-${r.sent_at}`} r={r} />
                  ) : (
                    <Row key={`${r.customer_id}-${r.customer_mobile}`} r={r} tier={tier(r)} />
                  )
                )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* --------- Local sentiment + intent chips (no AI key needed) --------- */
function SentimentChips({ text }) {
  const { label, intent } = analyzeSentiment(text);
  const s = SENTIMENT_STYLE[label];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${s.cls}`}>
        {s.emoji} {s.label}
      </span>
      {intent && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${INTENT_STYLE[intent.tone]}`}>
          {intent.label}
        </span>
      )}
    </div>
  );
}

/* ----------------------------- Row ----------------------------- */
function Row({ r, tier }) {
  const id = r.customer_id;
  const phone10 = ten(r.customer_mobile);
  const eng = ENGAGE[tier];
  const when = r.replied_at || r.read_at || r.delivered_at || r.sent_at;
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.customer_name} />
          <div className="min-w-0">
            <a href={appHref(`/customer/${id}`)} className="truncate text-sm font-semibold text-slate-800 hover:text-emerald-700">
              {r.customer_name || "Unknown"}
            </a>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
              <span>ID {id}</span>
              {r.customer_local_city && <span className="capitalize">· {r.customer_local_city}</span>}
            </div>
            {r.reply_text && (
              <>
                <p className="mt-1 max-w-[260px] rounded-lg rounded-tl-sm bg-emerald-50 px-2 py-1 text-[11px] italic text-emerald-800" title={r.reply_text}>
                  “{r.reply_text}”
                </p>
                <SentimentChips text={r.reply_text} />
              </>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-base font-bold tabular-nums text-slate-900">{phone10 ? `+91 ${phone10}` : "—"}</td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="truncate text-sm font-bold text-slate-900">{r.customer_email || "—"}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${eng.cls}`}>
          <eng.icon className="h-3 w-3" /> {eng.label}
        </span>
        <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(when)}</div>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        {r.follow_up ? (
          <div className="leading-tight">
            <div className="whitespace-nowrap text-xs font-semibold capitalize text-slate-700">{prettyWords(r.follow_up)}</div>
            {r.follow_up_date && !String(r.follow_up_date).startsWith("0000") && (
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">{fmtDate(r.follow_up_date)}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <span className="text-xs capitalize text-slate-600">{SCEN[r.scenario] || r.scenario || "—"}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <IconBtn href={appHref(`/customer/${id}`)} title="View" tone="view">
            <EyeView className="h-3.5 w-3.5" />
          </IconBtn>
          {phone10 && (
            <>
              <IconBtn href={`tel:+91${phone10}`} title="Call" tone="call">
                <Phone className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn href={`https://wa.me/91${phone10}`} title="WhatsApp" tone="whatsapp" external>
                <MessageCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
          {r.customer_email && (
            <IconBtn href={`mailto:${r.customer_email}`} title="Email" tone="view">
              <Mail className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- FailedRow ----------------------------- */
function FailedRow({ r }) {
  const id = r.customer_id;
  const phone10 = ten(r.customer_mobile);
  return (
    <tr className="hover:bg-rose-50/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.customer_name} />
          <div className="min-w-0">
            <a href={appHref(`/customer/${id}`)} className="truncate text-sm font-semibold text-slate-800 hover:text-rose-700">
              {r.customer_name || "Unknown"}
            </a>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
              <span>ID {id}</span>
              {r.customer_local_city && <span className="capitalize">· {r.customer_local_city}</span>}
              {r.rep_name && <span>· {r.rep_name}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-base font-bold tabular-nums text-slate-900">{phone10 ? `+91 ${phone10}` : "—"}</td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="truncate text-sm font-bold text-slate-900">{r.customer_email || "—"}</span>
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex max-w-[280px] items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700"
          title={r.failReason}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{r.failReason || "Unknown error"}</span>
        </span>
      </td>
      <td className="hidden px-4 py-3 text-[11px] text-slate-500 lg:table-cell">{fmtDateTime(r.sent_at)}</td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <span className="text-xs capitalize text-slate-600">{SCEN[r.scenario] || r.scenario || "—"}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <IconBtn href={appHref(`/customer/${id}`)} title="View" tone="view">
            <EyeView className="h-3.5 w-3.5" />
          </IconBtn>
          {phone10 && (
            <>
              <IconBtn href={`tel:+91${phone10}`} title="Call" tone="call">
                <Phone className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn href={`https://wa.me/91${phone10}`} title="WhatsApp" tone="whatsapp" external>
                <MessageCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- EmailRow ----------------------------- */
// Detailed status for the email fallback: sent → delivered → opened → clicked,
// or a terminal bounced / spam / failed.
const EMAIL_STATUS = {
  queued: { label: "Queued", cls: "bg-slate-100 text-slate-500", icon: Mail },
  sent: { label: "Sent", cls: "bg-sky-50 text-sky-700", icon: Send },
  delivered: { label: "Delivered", cls: "bg-indigo-50 text-indigo-700", icon: CheckCheck },
  opened: { label: "Opened", cls: "bg-emerald-50 text-emerald-700", icon: MailOpen },
  clicked: { label: "Clicked", cls: "bg-emerald-100 text-emerald-800", icon: MousePointerClick },
  bounced: { label: "Bounced", cls: "bg-rose-50 text-rose-700", icon: AlertTriangle },
  spam: { label: "Spam", cls: "bg-rose-100 text-rose-800", icon: AlertTriangle },
  failed: { label: "Failed", cls: "bg-rose-50 text-rose-700", icon: AlertTriangle },
};

function EmailRow({ r }) {
  const id = r.customer_id;
  const phone10 = ten(r.customer_contact1);
  const st = EMAIL_STATUS[r.status] || EMAIL_STATUS.sent;
  return (
    <tr className="hover:bg-violet-50/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={r.customer_name} />
          <div className="min-w-0">
            <a href={appHref(`/customer/${id}`)} className="truncate text-sm font-semibold text-slate-800 hover:text-violet-700">
              {r.customer_name || "Unknown"}
            </a>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
              <span>ID {id}</span>
              {r.customer_local_city && <span className="capitalize">· {r.customer_local_city}</span>}
              {r.rep_name && <span>· {r.rep_name}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="truncate text-xs text-slate-600">{r.customer_email || "—"}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
          <st.icon className="h-3 w-3" /> {st.label}
        </span>
        {(r.status === "bounced" || r.status === "spam" || r.status === "failed") && (r.bounce_reason || r.error) && (
          <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-rose-500" title={r.bounce_reason || r.error}>
            {r.bounce_reason || r.error}
          </div>
        )}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {r.open_count > 0 ? (
          <div className="leading-tight">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <MailOpen className="h-3.5 w-3.5" /> {r.open_count}×
            </span>
            <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(r.opened_at)}</div>
          </div>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {r.click_count > 0 ? (
          <div className="leading-tight">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">
              <MousePointerClick className="h-3.5 w-3.5" /> {r.click_count}×
            </span>
            <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(r.clicked_at)}</div>
          </div>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-[11px] text-slate-500 lg:table-cell">{fmtDateTime(r.sent_at)}</td>
      <td className="hidden px-4 py-3 xl:table-cell">
        <span className="text-xs capitalize text-slate-600">{SCEN[r.scenario] || r.scenario || "—"}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <IconBtn href={appHref(`/customer/${id}`)} title="View" tone="view">
            <EyeView className="h-3.5 w-3.5" />
          </IconBtn>
          {r.customer_email && (
            <IconBtn href={`mailto:${r.customer_email}`} title="Email" tone="view">
              <Mail className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {phone10 && (
            <IconBtn href={`tel:+91${phone10}`} title="Call" tone="call">
              <Phone className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- bits ----------------------------- */
const ENGAGE = {
  replied: { label: "Replied", cls: "bg-emerald-50 text-emerald-700", icon: Reply },
  read: { label: "Seen", cls: "bg-sky-50 text-sky-700", icon: Eye },
  delivered: { label: "Delivered", cls: "bg-slate-100 text-slate-600", icon: CheckCheck },
};
const SCEN = { quote_discount: "Quote offer", callback: "Callback", rnr: "RNR reach" };

function Kpi({ label, value, icon: Icon, tone }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-600",
    sky: "bg-sky-50 text-sky-600",
    slate: "bg-slate-100 text-slate-500",
    indigo: "bg-indigo-50 text-indigo-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`whitespace-nowrap px-4 py-3 font-bold ${className}`}>{children}</th>;
}

function Avatar({ name }) {
  const initials = String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
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

/* ----------------------------- helpers ----------------------------- */
function ten(mobile) {
  const d = String(mobile || "").replace(/\D+/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
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
