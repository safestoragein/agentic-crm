"use client";
import { appHref } from "@/lib/paths";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Loader2,
  Building2,
  Home,
  FileText,
  Calendar,
  IndianRupee,
  Wallet,
  Package,
  StickyNote,
  PackageCheck,
  Pencil,
  Eye,
  BarChart3,
  Trash2,
  FileDown,
  Plus,
  X,
  FolderOpen,
  CheckCircle2,
  Truck,
  Layers,
  Route,
  Users,
  ArrowUpDown,
  Warehouse,
  Copy,
  ClipboardList,
  Undo2,
  Images,
  KeyRound,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import { fetchCustomerDetails, fetchQuotationItems, fetchQuoteVsWarehouse, deleteQuotation, fetchCustomerDetailsExtra } from "@/lib/customer";
import { scoreCustomer, auditFollowup, contactSecs, TIER_STYLE } from "@/lib/leadScore";
import CustomerDetailsForm from "@/components/CustomerDetailsForm";

// Existing admin endpoints (these pages/flows already live on the server).
const ADMIN_BASE = API_BASE; // e.g. https://safestorage.in/back
const SITE_BASE = API_BASE.replace(/\/back\/?$/, ""); // e.g. https://safestorage.in

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CustomerPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState(null); // work orders, retrieval, documents, account login
  const [extraError, setExtraError] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("details");

  const load = useCallback(
    (signal) =>
      fetchCustomerDetails(id, { signal })
        .then((d) => setData(d))
        .catch((e) => {
          if (e?.name !== "AbortError") setError("Couldn't load this customer. Please try again.");
        }),
    [id]
  );

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [id, load]);

  // Extra detail sections (work orders, retrieval, documents, account login) —
  // loaded in the background so the main 360 paints first.
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetchCustomerDetailsExtra(id, { signal: ctrl.signal })
      .then((d) => {
        setExtra(d || {});
        setExtraError(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        // Stop the perpetual spinner and surface the failure (e.g. endpoint not
        // deployed yet) instead of leaving the tabs loading forever.
        setExtra({});
        setExtraError(true);
      });
    return () => ctrl.abort();
  }, [id]);

  const c = data?.customer;
  // Newest quotation first, so a just-created quote shows at the top. Sort by
  // actual creation time, falling back to quotation_id (insert order) on ties.
  const quotes = useMemo(() => {
    const list = data?.quotations || [];
    const ts = (q) => {
      const t = Date.parse(String(q.created_at || "").replace(" ", "T"));
      return Number.isNaN(t) ? 0 : t;
    };
    return [...list].sort(
      (a, b) => ts(b) - ts(a) || Number(b.quotation_id || 0) - Number(a.quotation_id || 0)
    );
  }, [data]);
  const transactions = data?.transactions || [];
  const payments = data?.payments || [];
  const inventory = data?.inventory || [];
  const notes = data?.notes || [];
  const accountSummary = data?.accountSummary || [];
  const orders = data?.orders || [];
  const workOrders = extra?.work_orders || [];
  const documents = extra?.documents || [];
  const retrievalSummary = extra?.retrieval_summary || null;
  const retrievalLog = extra?.retrieval_log || [];
  // Show the Retrieval tab only when this customer actually has a retrieval —
  // a retrieval summary/log, or a work order of a retrieval type.
  const hasRetrieval =
    Boolean(retrievalSummary) ||
    retrievalLog.length > 0 ||
    workOrders.some((o) => /retriev/i.test(`${o.order_type || ""} ${o.order_sub_type || ""}`));
  const isBusiness = c && String(c.is_business_cust) === "1";
  // is_customer = '1' -> converted customer: show all tabs. '0' -> lead/quote: only Details + Quotations.
  const isConverted = c && String(c.is_customer) === "1";

  return (
    <div className="px-6 py-6">
      <div className="w-full">
        <Link
          href="/quotations"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to quotations
        </Link>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        )}

        {c && (
          <div className="space-y-4">
            {/* Hero */}
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-6 shadow-sm">
              <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold text-white ring-1 ring-white/25 backdrop-blur">
                  {initials(c.customer_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-bold tracking-tight text-white">
                      {c.customer_name || "Unknown"}
                    </h1>
                    <HeroBadge>
                      {isBusiness ? <Building2 className="h-3 w-3" /> : <Home className="h-3 w-3" />}
                      {isBusiness ? "Business" : "Household"}
                    </HeroBadge>
                    <HeroBadge tone={isConverted ? "emerald" : "amber"}>
                      <CheckCircle2 className="h-3 w-3" />
                      {isConverted ? "Customer" : "Lead"}
                    </HeroBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-indigo-100">
                    <span className="font-semibold text-white">{c.customer_unique_id || `ID ${c.customer_id}`}</span>
                    {c.customer_local_city && (
                      <span className="inline-flex items-center gap-1 capitalize">
                        <MapPin className="h-3.5 w-3.5" /> {c.customer_local_city}
                      </span>
                    )}
                    {c.customer_contact1 && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone className="h-3.5 w-3.5" /> +91 {c.customer_contact1}
                      </span>
                    )}
                    {c.customer_email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" /> {c.customer_email}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap gap-2">
                  {c.customer_contact1 && (
                    <>
                      <a
                        href={`tel:+91${c.customer_contact1}`}
                        data-cid={id}
                        data-cname={c.customer_name || ""}
                        data-ccontact={c.customer_contact1}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
                      >
                        <Phone className="h-4 w-4" /> Call
                      </a>
                      <a
                        href={`https://wa.me/91${c.customer_contact1}`}
                        target="_blank"
                        rel="noreferrer"
                        title="WhatsApp"
                        className="inline-flex items-center justify-center rounded-xl bg-white/15 px-3 py-2.5 text-white ring-1 ring-white/20 transition-colors hover:bg-white/25"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </>
                  )}
                  {c.customer_email && (
                    <a
                      href={`mailto:${c.customer_email}`}
                      title="Email"
                      className="inline-flex items-center justify-center rounded-xl bg-white/15 px-3 py-2.5 text-white ring-1 ring-white/20 transition-colors hover:bg-white/25"
                    >
                      <Mail className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
              {isBusiness ? (
                <Building2 className="pointer-events-none absolute -right-6 -bottom-8 h-44 w-44 text-white/5" />
              ) : (
                <Home className="pointer-events-none absolute -right-6 -bottom-8 h-44 w-44 text-white/5" />
              )}
            </section>

            {/* Local AI: priority score + fake/low-effort follow-up flag */}
            <ScoreFlagCard c={c} quotes={quotes} />

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <TabBtn active={tab === "details"} onClick={() => setTab("details")}>
                Customer Details
              </TabBtn>
              <TabBtn active={tab === "quotes"} onClick={() => setTab("quotes")} count={quotes.length}>
                Quotations
              </TabBtn>
              {/* Extra tabs only for converted customers (is_customer = '1'). */}
              {isConverted && (
                <>
                  <TabBtn active={tab === "workorders"} onClick={() => setTab("workorders")} count={workOrders.length}>
                    Work Orders
                  </TabBtn>
                  <TabBtn active={tab === "transactions"} onClick={() => setTab("transactions")} count={transactions.length}>
                    Payment
                  </TabBtn>
                  <TabBtn active={tab === "inventory"} onClick={() => setTab("inventory")} count={inventory.length}>
                    Inventory
                  </TabBtn>
                  <TabBtn active={tab === "documents"} onClick={() => setTab("documents")} count={documents.length}>
                    Documents
                  </TabBtn>
                  {hasRetrieval && (
                    <TabBtn active={tab === "retrieval"} onClick={() => setTab("retrieval")}>
                      Retrieval
                    </TabBtn>
                  )}
                </>
              )}
            </div>

            {/* Tab: Customer Details (view + inline edit) */}
            {tab === "details" && (
              <div className="space-y-4">
                {extra?.account && (
                  <AccountLoginCard account={extra.account} nextBill={extra.next_bill_date} isZoho={extra.is_zoho_customer} />
                )}
                <CustomerDetailsForm customer={c} onSaved={() => load()} />
              </div>
            )}

            {/* Tab: Quotations */}
            {tab === "quotes" && (
              <QuotationsTab quotes={quotes} customer={c} onChanged={() => load()} />
            )}

            {/* Tab: Payment (Account Summary · Due Payment · Transaction) */}
            {tab === "transactions" && (
              <PaymentTab quotes={quotes} transactions={transactions} payments={payments} />
            )}

            {/* Tab: Inventory */}
            {tab === "inventory" && <InventoryTab inventory={inventory} />}

            {/* Tab: Notes */}
            {tab === "notes" && <NotesTab notes={notes} />}

            {/* Tab: Account */}
            {tab === "account" && <AccountTab accountSummary={accountSummary} orders={orders} />}

            {/* Tab: Work Orders */}
            {tab === "workorders" && <WorkOrdersTab orders={workOrders} loading={!extra} error={extraError} />}

            {/* Tab: Documents */}
            {tab === "documents" && <DocumentsTab documents={documents} loading={!extra} error={extraError} />}

            {/* Tab: Retrieval Summary */}
            {tab === "retrieval" && <RetrievalTab summary={retrievalSummary} log={retrievalLog} loading={!extra} error={extraError} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------- Local priority score + fake-follow-up flag ----------------- */
function ScoreFlagCard({ c, quotes }) {
  const score = useMemo(() => scoreCustomer(c, quotes), [c, quotes]);
  const audit = useMemo(() => auditFollowup(c, quotes), [c, quotes]);
  const t = TIER_STYLE[score.tier];
  const secs = contactSecs(c, quotes);

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      {/* Priority score */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <BarChart3 className="h-4 w-4 text-indigo-500" /> Lead priority
          <span className="ml-1 font-medium normal-case text-slate-400">· auto-scored</span>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex flex-col items-center">
            <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold ring-2 ${t.cls}`}>
              {score.score}
            </span>
            <span className={`mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ${t.cls}`}>{t.label}</span>
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {score.reasons.length === 0 ? (
              <li className="text-xs text-slate-400">Not enough signal to score yet.</li>
            ) : (
              score.reasons.map((r, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className={`tabular-nums font-bold ${r.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {r.delta >= 0 ? "+" : ""}
                    {r.delta}
                  </span>
                  <span className="truncate">{r.text}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          Last call logged: {secs > 0 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : "none"} · status: {c.follow_up || "new"}
        </div>
      </div>

      {/* Fake / low-effort follow-up warning */}
      {audit.flagged ? (
        <div className={`rounded-2xl border p-5 shadow-sm ${audit.severity === "high" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
          <div className={`flex items-center gap-2 text-sm font-bold ${audit.severity === "high" ? "text-rose-700" : "text-amber-700"}`}>
            <AlertTriangle className="h-4.5 w-4.5" />
            {audit.severity === "high" ? "⚠ Possible fake / no-contact follow-up" : "⚠ Low-effort follow-up"}
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${audit.severity === "high" ? "bg-rose-200 text-rose-800" : "bg-amber-200 text-amber-800"}`}>
              {audit.severity} risk
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {audit.issues.map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${it.severity === "high" ? "bg-rose-500" : "bg-amber-500"}`} />
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-black/5 pt-2 text-[11px] text-slate-500">
            Based on the follow-up status, note trail and whether a call was actually logged. Verify before crediting this as a real contact.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <div className="text-sm font-bold text-emerald-700">Follow-up looks genuine</div>
            <div className="text-xs text-emerald-600/80">No fake / low-effort signals — status, notes and call activity are consistent.</div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ----------------------------- Quotations (exact replica) ----------------------------- */
function QuotationsTab({ quotes, customer, onChanged }) {
  const [itemsFor, setItemsFor] = useState(null); // quotation for the items popup
  const [compareFor, setCompareFor] = useState(null); // quotation for the vs-warehouse popup
  const [deletingId, setDeletingId] = useState(null);
  const newDoc = customer && String(customer.new_document) === "1";

  const onDelete = async (q) => {
    if (!window.confirm(`Delete quotation ${qtLabel(q.quotation_id)}? This can't be undone.`)) return;
    setDeletingId(q.quotation_id);
    try {
      await deleteQuotation(q.quotation_id, q.customer_id || customer.customer_id);
      onChanged?.();
    } catch {
      alert("Couldn't delete the quotation.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FileText className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-bold text-slate-800">Quotations</h2>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{quotes.length}</span>
        </div>
        <a
          href={appHref(`/customer/${customer.customer_id}/new-quotation`)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> New Quotation
        </a>
      </div>

      {quotes.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-400">No quotations for this customer.</div>
      ) : (
        <div className="space-y-4 p-4">
          {quotes.map((q, i) => {
            const newQuote = String(q.is_new_quotation) === "1";
            const isLatest = i === 0;
            const editHref = newQuote
              ? `/customer/${q.customer_id || customer.customer_id}/quotation/${q.quotation_id}`
              : `${ADMIN_BASE}/customer/edit_quotation/${q.quotation_id}`;
            const canPickup = String(q.is_valid_link) === "0";
            const viewHref = `${SITE_BASE}/customer/view_quotation_book/?quotation_id=${q.quotation_id}`;
            return (
              <div
                key={q.quotation_id}
                className={`overflow-hidden rounded-xl border shadow-sm transition-colors ${
                  isLatest
                    ? "border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500"
                    : "border-indigo-300"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-indigo-600">{qtLabel(q.quotation_id)}</span>
                    {isLatest && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Latest
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Calendar className="h-3.5 w-3.5" /> {fmtDMY(q.created_at)}
                    </span>
                  </div>
                  <a
                    href={viewHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3.5 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
                  >
                    <Eye className="h-4 w-4" /> View Quotation
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
                  <Stat label="Storage Charges (Ex. GST)" value={rupeeOrDash(q.storage_charges)} />
                  <Stat label="Storage Coupon" value={q.storage_coupen || "—"} />
                  <Stat label="Transport Charges" value={rupeeOrDash(q.pickup_charges)} />
                  <Stat label="Transport Coupon" value={q.transport_coupon || "—"} />
                  <Stat label="Token Advance" value={rupeeOrDash(q.transport_token_amt)} />
                  <Stat label="Storage Duration" value={q.storage_duration || "—"} />
                  {newDoc && <Stat label="No. of boxes" value={numOrDash(q.box_no)} />}
                  {newDoc && <Stat label="Price per box" value={numOrDash(q.box_qty)} />}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
                  <ActionBtn href={editHref} icon={FolderOpen}>{newQuote ? "Open" : "Edit"}</ActionBtn>
                  <ActionBtn icon={Package} onClick={() => setItemsFor(q)}>Items</ActionBtn>
                  <ActionBtn icon={BarChart3} onClick={() => setCompareFor(q)}>Quote vs pickup</ActionBtn>
                  {q.file_name ? <ActionBtn href={`${ADMIN_BASE}/uploads/pdf/${q.file_name}`} icon={FileDown}>PDF</ActionBtn> : null}
                  {canPickup ? (
                    <ActionBtn
                      href={appHref(`/customer/${q.customer_id || customer.customer_id}/schedule-pickup/${q.quotation_id}`)}
                      icon={CheckCircle2}
                      tone="primary"
                      newTab={false}
                    >
                      Confirm pickup
                    </ActionBtn>
                  ) : null}
                  {canPickup ? (
                    <ActionBtn icon={Trash2} tone="danger" onClick={() => onDelete(q)} disabled={deletingId === q.quotation_id}>
                      Delete
                    </ActionBtn>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <QuoteDetailModal
        quote={itemsFor}
        address={customer?.pickup_address || customer?.customer_address}
        onClose={() => setItemsFor(null)}
      />
      <QuoteVsPickupModal quote={compareFor} onClose={() => setCompareFor(null)} />
    </div>
  );
}

function ActionBtn({ href, onClick, icon: Icon, tone, disabled, newTab = true, children }) {
  const tones = {
    primary: "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700",
    danger: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
  };
  const cls = tones[tone] || "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600";
  const className = `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${cls}`;
  const content = (
    <>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </>
  );
  if (href) {
    const linkProps = newTab ? { target: "_blank", rel: "noreferrer" } : {};
    return (
      <a href={appHref(href)} {...linkProps} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function QuoteDetailModal({ quote, address, onClose }) {
  const [items, setItems] = useState(null);
  const open = Boolean(quote);
  const quotationId = quote?.quotation_id;

  useEffect(() => {
    if (!quotationId) return;
    let active = true;
    const ctrl = new AbortController();
    setItems(null);
    fetchQuotationItems(quotationId, { signal: ctrl.signal })
      .then((d) => active && setItems(d))
      .catch((e) => {
        if (e?.name !== "AbortError" && active) setItems([]);
      });
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [quotationId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div onClick={onClose} className="fixed inset-0" aria-hidden />
      <div className="relative z-10 my-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* gradient header */}
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-indigo-100">Quotation</div>
              <div className="text-xl font-bold leading-tight">{qtLabel(quotationId)}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[82vh] space-y-5 overflow-y-auto bg-slate-50/60 p-5">
          {address ? (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
                <MapPin className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pickup location</div>
                <div className="text-sm font-semibold text-slate-700">{address}</div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetaChip icon={Layers} tone="indigo" label="Total Pallet" value={numOrDash(quote.total_pallet)} />
            <MetaChip icon={Route} tone="sky" label="Distance" value={quote.total_distance ? `${quote.total_distance} km` : "—"} />
            <MetaChip icon={Building2} tone="amber" label="Floor" value={quote.floor || "—"} />
            <MetaChip icon={ArrowUpDown} tone="emerald" label="Lift" value={quote.lift || "—"} />
          </div>

          {/* costs + items side by side so the whole quote fits one screenshot */}
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                <Wallet className="h-3.5 w-3.5 text-indigo-500" /> System calculated costs
              </h4>
              <div className="space-y-1">
                <CostRow icon={ArrowUpDown} label="Lift Cost" value={money(quote.lift_cost)} />
                <CostRow icon={Truck} label="Transport Cost" value={money(quote.transport_cost)} />
                <CostRow icon={Users} label="Labour Cost" value={money(quote.labour_cost)} />
                <CostRow icon={Package} label="Storage Cost" value={money(quote.storage_charges)} />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-sm">
                <span>Total Transport with GST</span>
                <span className="text-base tabular-nums">{money(quote.total_pickup_charges_with_gst)}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                <Package className="h-3.5 w-3.5 text-indigo-500" /> Items
                {items && items.length > 0 && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                    {items.reduce((a, it) => a + (Number(it.item_count) || 0), 0)} units · {items.length} lines
                  </span>
                )}
              </h4>
              {!items ? (
                <div className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
                </div>
              ) : items.length === 0 ? (
                <Empty>No items in this quotation.</Empty>
              ) : (
                <div className="space-y-1.5">
                  {items.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                        <Package className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-slate-700">
                        {it.item_name || "—"}
                      </span>
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-indigo-600 px-2 text-xs font-bold text-white">
                        {it.item_count ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHIP_TONES = {
  indigo: "bg-indigo-50 text-indigo-500",
  sky: "bg-sky-50 text-sky-500",
  amber: "bg-amber-50 text-amber-500",
  emerald: "bg-emerald-50 text-emerald-600",
};
/* ---------------- Quote vs pickup (quotation ⇆ warehouse) ---------------- */
function couponLabel(code) {
  if (!code) return "—";
  const parts = String(code).split("-");
  const kind = parts[1];
  const val = parts[2];
  if (kind === "percent" && val) return `${val}%`;
  if (kind === "flat" && val) return `₹${val}`;
  return code;
}

function QuoteVsPickupModal({ quote, onClose }) {
  const [cmp, setCmp] = useState(null); // normalized comparison data
  const open = Boolean(quote);
  const quotationId = quote?.quotation_id;

  useEffect(() => {
    if (!quotationId) return;
    let active = true;
    const ctrl = new AbortController();
    setCmp(null);
    // Try the JSON comparison endpoint (real warehouse items + diffs).
    fetchQuoteVsWarehouse(quotationId, { signal: ctrl.signal })
      .then((d) => {
        if (!active) return;
        if (d && Array.isArray(d.quotation_items)) setCmp(normalizeCompare(d));
        else throw new Error("no-endpoint");
      })
      .catch(async (e) => {
        if (e?.name === "AbortError" || !active) return;
        // Fallback (endpoint not deployed yet): quotation items + quote charges.
        try {
          const items = await fetchQuotationItems(quotationId, { signal: ctrl.signal });
          if (active) setCmp(fallbackCompare(quote, items));
        } catch {
          if (active) setCmp(fallbackCompare(quote, []));
        }
      });
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [quotationId, quote]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copySummary = () => {
    if (!cmp) return;
    const lines = [
      `Quotation ${qtLabel(quotationId)}`,
      "",
      "Quotation Items:",
      ...cmp.quotationItems.map((it) => `  ${it.name} × ${it.qty}`),
      "",
      "In Warehouse Items:",
      ...(cmp.warehouseItems.length ? cmp.warehouseItems.map((it) => `  ${it.name} × ${it.qty}`) : ["  (none yet)"]),
      "",
      "Quotation Charges:",
      ...cmp.quotationCharges.map(([d, a]) => `  ${d}: ${a}`),
      "",
      "Inventory Charges:",
      ...cmp.inventoryCharges.map(([d, a]) => `  ${d}: ${a}`),
    ];
    if (cmp.increased.length) {
      lines.push("", "Increased Items:", ...cmp.increased.map((r) => `  ${r.item_name}: +${r.diff}`));
    }
    if (cmp.decreased.length) {
      lines.push("", "Decreased Items:", ...cmp.decreased.map((r) => `  ${r.item_name}: ${r.diff}`));
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div onClick={onClose} className="fixed inset-0" aria-hidden />
      <div className="relative z-10 my-auto w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-6 py-4 text-white">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <FileText className="h-5 w-5" /> Quotation &amp; Warehouse Items
            <span className="ml-2 text-sm font-medium text-slate-300">{qtLabel(quotationId)}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={copySummary}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button onClick={onClose} className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[82vh] space-y-5 overflow-y-auto bg-slate-50 p-5">
          {/* item tables */}
          <div className="grid gap-5 lg:grid-cols-2">
            <CompareCard icon={FileText} iconColor="text-sky-500" title="Quotation Items">
              <CompareTable headerClass="bg-sky-100" cols={["Item Name", "Quantity"]}>
                {!cmp ? (
                  <TableLoading />
                ) : cmp.quotationItems.length === 0 ? (
                  <TableEmpty>No items in this quotation.</TableEmpty>
                ) : (
                  cmp.quotationItems.map((it, i) => (
                    <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                      <td className="px-4 py-2.5 capitalize text-slate-700">{it.name || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{it.qty ?? "—"}</td>
                    </tr>
                  ))
                )}
              </CompareTable>
            </CompareCard>

            <CompareCard icon={Warehouse} iconColor="text-emerald-600" title="In Warehouse Items">
              <CompareTable headerClass="bg-emerald-100" cols={["Item Name", "Quantity"]}>
                {!cmp ? (
                  <TableLoading />
                ) : cmp.warehouseItems.length === 0 ? (
                  <TableEmpty>No warehouse items yet — these appear after pickup.</TableEmpty>
                ) : (
                  cmp.warehouseItems.map((it, i) => (
                    <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                      <td className="px-4 py-2.5 capitalize text-slate-700">{it.name || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{it.qty ?? "—"}</td>
                    </tr>
                  ))
                )}
              </CompareTable>
            </CompareCard>
          </div>

          {/* charge tables */}
          <div className="grid gap-5 lg:grid-cols-2">
            <CompareCard icon={IndianRupee} iconColor="text-emerald-600" title="Quotation Charges">
              <CompareTable headerClass="bg-emerald-100" cols={["Description", "Amount"]}>
                {(cmp?.quotationCharges || []).map(([d, a], i) => (
                  <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-slate-700">{d}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{a}</td>
                  </tr>
                ))}
              </CompareTable>
            </CompareCard>

            <CompareCard icon={Wallet} iconColor="text-amber-500" title="Inventory Charges">
              <CompareTable headerClass="bg-amber-100" cols={["Description", "Amount"]}>
                {(cmp?.inventoryCharges || []).map(([d, a], i) => (
                  <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-slate-700">{d}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{a}</td>
                  </tr>
                ))}
              </CompareTable>
            </CompareCard>
          </div>

          {/* increased / decreased diffs */}
          <DiffCard title="Increased Items" icon={ArrowUpDown} accent="rose" rows={cmp?.increased || []} loading={!cmp} />
          <DiffCard title="Decreased Items" icon={ArrowUpDown} accent="sky" rows={cmp?.decreased || []} loading={!cmp} />
        </div>
      </div>
    </div>
  );
}

// Map the JSON endpoint payload into the display shape the modal uses.
function normalizeCompare(d) {
  const qc = d.quotation_charges || {};
  const ic = d.inventory_charges || {};
  return {
    quotationItems: (d.quotation_items || []).map((it) => ({ name: it.item_name, qty: it.item_count })),
    warehouseItems: (d.warehouse_items || []).map((it) => ({ name: it.goods_name, qty: it.goods_quantity })),
    quotationCharges: [
      ["Transport Charges", money(qc.transport_charges)],
      ["Transport Coupon", qc.transport_coupon || "—"],
      ["Storage Charges", money(qc.storage_charges)],
      ["Storage Coupon", qc.storage_coupon || "—"],
    ],
    inventoryCharges: [
      ["Transport Charges", money(ic.transport_charges)],
      ["Transport Coupon", ic.transport_coupon || "—"],
      ["Storage Charges", money(ic.storage_charges)],
      ["Storage Coupon", ic.storage_coupon || "—"],
    ],
    increased: d.increased_items || [],
    decreased: d.decreased_items || [],
  };
}

// Fallback when the comparison endpoint isn't deployed: build from the quote record.
function fallbackCompare(quote, items) {
  return {
    quotationItems: (items || []).map((it) => ({ name: it.item_name, qty: it.item_count })),
    warehouseItems: [],
    quotationCharges: [
      ["Transport Charges", money(quote.pickup_charges)],
      ["Transport Coupon", couponLabel(quote.transport_coupon)],
      ["Storage Charges", money(quote.storage_charges)],
      ["Storage Coupon", couponLabel(quote.storage_coupen)],
    ],
    inventoryCharges: [
      ["Transport Charges", money(quote.total_pickup_charges_with_gst)],
      ["Transport Coupon", couponLabel(quote.transport_coupon)],
      ["Storage Charges", money(quote.total_storage_charges_with_gst)],
      ["Storage Coupon", couponLabel(quote.storage_coupen)],
    ],
    increased: [],
    decreased: [],
  };
}

function DiffCard({ title, icon: Icon, accent, rows, loading }) {
  const head = accent === "rose" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700";
  const diffColor = accent === "rose" ? "text-rose-600" : "text-sky-600";
  const titleColor = accent === "rose" ? "text-rose-600" : "text-sky-600";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className={`mb-3 flex items-center gap-2 text-base font-bold ${titleColor}`}>
        <Icon className="h-5 w-5" /> {title}
      </h4>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className={head}>
              <th className="px-4 py-2.5 text-left font-bold">Item Name</th>
              <th className="px-4 py-2.5 text-center font-bold">Quoted</th>
              <th className="px-4 py-2.5 text-center font-bold">Actual</th>
              <th className="px-4 py-2.5 text-center font-bold">Diff</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No {title.toLowerCase()}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                  <td className="px-4 py-2.5 capitalize text-slate-700">{r.item_name}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{r.quoted_qty}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{r.pickup_qty}</td>
                  <td className={`px-4 py-2.5 text-center font-bold tabular-nums ${diffColor}`}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareCard({ icon: Icon, iconColor, title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
        {Icon && <Icon className={`h-5 w-5 ${iconColor}`} />}
        {title}
      </h4>
      {children}
    </div>
  );
}

function CompareTable({ headerClass, cols, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className={headerClass}>
            <th className="px-4 py-2.5 text-left font-bold text-slate-700">{cols[0]}</th>
            <th className="px-4 py-2.5 text-right font-bold text-slate-700">{cols[1]}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TableLoading() {
  return (
    <tr>
      <td colSpan={2} className="px-4 py-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
      </td>
    </tr>
  );
}

function TableEmpty({ children }) {
  return (
    <tr>
      <td colSpan={2} className="px-4 py-10 text-center text-sm text-slate-400">
        {children}
      </td>
    </tr>
  );
}

function MetaChip({ icon: Icon, tone = "indigo", label, value }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      {Icon && (
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHIP_TONES[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate text-sm font-bold capitalize text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function CostRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
      <span className="flex items-center gap-2 text-slate-600">
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

/* ----------------------------- tab panels ----------------------------- */
function Panel({ icon: Icon, title, count, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {Icon && <Icon className="h-4 w-4 text-indigo-500" />}
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {count != null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <div className="px-5 py-10 text-center text-sm text-slate-400">{children}</div>;
}

/* ----------------------------- Payment (3 sub-sections) ----------------------------- */
function PaymentTab({ quotes, transactions, payments }) {
  const [sub, setSub] = useState("summary");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5 overflow-x-auto border-b border-slate-200">
        <SubTab active={sub === "summary"} onClick={() => setSub("summary")}>
          Account Summary
        </SubTab>
        <SubTab active={sub === "due"} onClick={() => setSub("due")} count={payments.length}>
          Due Payment
        </SubTab>
        <SubTab active={sub === "txn"} onClick={() => setSub("txn")} count={transactions.length}>
          Transaction
        </SubTab>
      </div>
      {sub === "summary" && <AccountSummarySub quotes={quotes} />}
      {sub === "due" && <DuePaymentSub payments={payments} />}
      {sub === "txn" && <TransactionSub transactions={transactions} />}
    </div>
  );
}

// Per-quotation "Total Charges" — verbatim port of the legacy payment_section
// Account Summary math (storage × multi-factor, minus coupon, +18% GST).
function accountSummaryRows(q) {
  let total = num(q.total_storage_charges);
  const mf = num(q.storage_multi_factor);
  if (mf) total = mf * total;
  let couponAmt = 0;
  if (q.storage_coupen) {
    const a = String(q.storage_coupen).split("-");
    if (a[1] === "flat") couponAmt = num(a[2]);
    else couponAmt = (num(a[2]) / 100) * total;
  }
  const extraItems = num(q.extra_item_storage_charges);
  const itemReduced = num(q.item_reduced_charges);
  // PHP uses (int) casts (truncate toward zero) on each term.
  const revised = trunc(total) + trunc(extraItems) - (trunc(itemReduced) + trunc(couponAmt));
  const withTax = Math.round(revised + (revised * 18) / 100);
  return { monthly: trunc(total), extraItems, revised, withTax };
}
function trunc(v) {
  return Math.trunc(num(v));
}

function AccountSummarySub({ quotes }) {
  const [qt, setQt] = useState("all");
  const shown = qt === "all" ? quotes : quotes.filter((q) => String(q.quotation_id) === qt);
  return (
    <div className="space-y-4">
      {/* per-quotation tabs */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200">
        <MiniTab active={qt === "all"} onClick={() => setQt("all")}>
          All
        </MiniTab>
        {quotes.map((q) => (
          <MiniTab key={q.quotation_id} active={qt === String(q.quotation_id)} onClick={() => setQt(String(q.quotation_id))}>
            {qtLabel(q.quotation_id)}
          </MiniTab>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => alert("Refund requests are processed from the admin panel.")}
          className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Refund Request
        </button>
      </div>

      {shown.length === 0 ? (
        <Empty>No quotations to summarise.</Empty>
      ) : (
        <div className="space-y-5">
          {shown.map((q) => (
            <TotalChargesCard key={q.quotation_id} q={q} showQt={qt === "all"} />
          ))}
        </div>
      )}
    </div>
  );
}

function TotalChargesCard({ q, showQt }) {
  const r = accountSummaryRows(q);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <IndianRupee className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-bold text-slate-800">Total Charges</h3>
        {showQt && (
          <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{qtLabel(q.quotation_id)}</span>
        )}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <Th>Storage charges</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          <SumRow label="Monthly Storage Charges" value={rupee(r.monthly)} />
          <SumRow label="Extra Items Storage Charges" value={rupee(r.extraItems)} />
          <SumRow label="Revised Monthly Storage Charges" value={rupee(r.revised)} />
          <SumRow label="Total Tax" value="18%" />
          <SumRow label="Monthly Storage Charges (incl. tax)" value={rupee(r.withTax)} strong />
        </tbody>
      </table>
    </section>
  );
}

function SumRow({ label, value, strong }) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-4 py-2.5 text-slate-700">{label}</td>
      <td className={`px-4 py-2.5 text-right tabular-nums ${strong ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>{value}</td>
    </tr>
  );
}

function SubTab({ active, onClick, count, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-2.5 pt-1.5 text-sm font-bold transition-colors ${
        active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-600"
      }`}
    >
      {children}
      {count != null && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function MiniTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px whitespace-nowrap border-b-2 px-1 pb-2 pt-1 text-sm font-semibold transition-colors ${
        active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function DuePaymentSub({ payments }) {
  return (
    <Panel icon={IndianRupee} title="Due payment" count={payments.length}>
      {payments.length === 0 ? (
        <Empty>No charges recorded.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <Th>Billing date</Th>
                <Th>Type</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Payable</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.payment_id || i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(p.billing_date)}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-700">{chargeLabel(p.charges_type)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{rupee(p.total_amount || p.payable_amount)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{rupee(p.payable_amount)}</td>
                  <td className="px-4 py-2.5">{payStatus(p.payment_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function TransactionSub({ transactions }) {
  const received = transactions.reduce((s, t) => s + num(t.paid_amount), 0);
  return (
    <div className="space-y-4">
      <Panel icon={Wallet} title="Transactions" count={transactions.length}>
        {transactions.length === 0 ? (
          <Empty>No payments recorded.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <Th>Invoice</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={t.transaction_id || t.invoice_no || i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{t.invoice_no || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDateTime(t.transaction_created_at)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{rupee(t.paid_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400" colSpan={2}>
                      Total received
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-emerald-700">{rupee(received)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function InventoryTab({ inventory }) {
  return (
    <Panel icon={Package} title="Inventory items" count={inventory.length}>
      {inventory.length === 0 ? (
        <Empty>No inventory items for this customer.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <Th>Item</Th>
                <Th className="hidden sm:table-cell">Type</Th>
                <Th className="text-right">Qty</Th>
                <Th className="hidden md:table-cell">Size</Th>
                <Th>Status</Th>
                <Th className="hidden lg:table-cell">Barcode</Th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((it) => {
                const removed = String(it.is_removed_item) === "1";
                return (
                  <tr key={it.inventory_id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${removed ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium capitalize text-slate-800">{it.goods_name || "—"}</td>
                    <td className="hidden px-4 py-2.5 capitalize text-slate-600 sm:table-cell">{it.goods_type || it.goods_slug || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{it.goods_quantity ?? "—"}</td>
                    <td className="hidden px-4 py-2.5 capitalize text-slate-600 md:table-cell">{it.goods_size || "—"}</td>
                    <td className="px-4 py-2.5">
                      {removed ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">Removed</span>
                      ) : (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-emerald-700">
                          {it.inventory_status || "Stored"}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 lg:table-cell">{it.barcode || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function NotesTab({ notes }) {
  return (
    <Panel icon={StickyNote} title="Customer notes" count={notes.length}>
      {notes.length === 0 ? (
        <Empty>No notes for this customer.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {notes.map((n, i) => (
            <li key={n.note_id || n.id || i} className="px-5 py-3.5">
              <p className="whitespace-pre-line text-sm text-slate-700">{noteText(n)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> {fmtDateTime(n.created_at)}
                </span>
                {n.created_by && <span>by {n.created_by}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AccountTab({ accountSummary, orders }) {
  const monthly = accountSummary.reduce((s, a) => s + num(a.total_monthly_charges), 0);
  return (
    <div className="space-y-4">
      <Panel icon={IndianRupee} title="Account summary">
        {accountSummary.length === 0 ? (
          <Empty>No account summary.</Empty>
        ) : (
          <div className="p-5">
            <div className="inline-flex flex-col rounded-xl border border-slate-200 bg-slate-50 px-5 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Recurring monthly charges
              </span>
              <span className="mt-0.5 text-2xl font-bold text-slate-900">{rupee(monthly)}</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel icon={PackageCheck} title="Orders" count={orders.length}>
        {orders.length === 0 ? (
          <Empty>No orders for this customer.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <Th>Order</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Scheduled</Th>
                  <Th className="hidden sm:table-cell">Created</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-700">#{o.order_id}</td>
                    <td className="px-4 py-2.5 capitalize text-slate-700">{prettyWords(o.order_type)}</td>
                    <td className="px-4 py-2.5">{orderStatus(o.order_status)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(o.order_schedule_date)}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-slate-600 sm:table-cell">{fmtDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ExtraError() {
  return (
    <div className="px-5 py-10 text-center text-sm text-slate-400">
      Couldn&apos;t load this section. The customer-details endpoint may not be deployed on the server yet.
    </div>
  );
}

/* ----------------------------- Account login ----------------------------- */
function AccountLoginCard({ account, nextBill, isZoho }) {
  const [show, setShow] = useState(false);
  const hasBill = String(isZoho) === "1" && nextBill && !String(nextBill).startsWith("0000");
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <KeyRound className="h-4 w-4 text-indigo-500" />
        <h2 className="text-sm font-bold text-slate-800">Account login</h2>
        {hasBill && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
            <Calendar className="h-3 w-3" /> Next billing {fmtDMY(nextBill)}
          </span>
        )}
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Username</div>
          <div className="mt-1 break-all text-sm font-semibold text-slate-800">{account.username || "—"}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Password</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-800">
              {account.password ? (show ? account.password : "••••••••") : "—"}
            </span>
            {account.password && (
              <button onClick={() => setShow((s) => !s)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                {show ? "Hide" : "Show"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Work Orders ----------------------------- */
function WorkOrdersTab({ orders, loading, error }) {
  return (
    <Panel icon={ClipboardList} title="Work orders" count={orders.length}>
      {error ? (
        <ExtraError />
      ) : loading ? (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
        </div>
      ) : orders.length === 0 ? (
        <Empty>No work orders for this customer.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <Th>Order</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th className="hidden sm:table-cell">Pickup date</Th>
                <Th className="hidden md:table-cell">Manager</Th>
                <Th className="hidden lg:table-cell">Supervisor</Th>
                <Th>Intercity</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-indigo-600">WO{o.order_id}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-700">{prettyWords(o.order_sub_type || o.order_type)}</td>
                  <td className="px-4 py-2.5">{orderStatus(o.order_status)}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-slate-600 sm:table-cell">{fmtDate(o.schedule_date)}</td>
                  <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">{o.manager || "—"}</td>
                  <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">{o.supervisor || "—"}</td>
                  <td className="px-4 py-2.5">
                    {String(o.is_intercity) === "1" ? (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">Yes</span>
                    ) : (
                      <span className="text-xs text-slate-400">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------- Retrieval ----------------------------- */
function RetrievalTab({ summary, log, loading, error }) {
  if (error) {
    return (
      <Panel icon={Undo2} title="Retrieval summary">
        <ExtraError />
      </Panel>
    );
  }
  if (loading) {
    return (
      <Panel icon={Undo2} title="Retrieval summary">
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
        </div>
      </Panel>
    );
  }
  if (!summary) {
    return (
      <Panel icon={Undo2} title="Retrieval summary">
        <Empty>No retrieval summary for this customer.</Empty>
      </Panel>
    );
  }
  const s = summary;
  const ret = num(s.log_return_amt) > 0;
  const isReturn = num(s.final_return_amt) > 0;
  return (
    <div className="space-y-4">
      <Panel icon={Undo2} title="Retrieval summary">
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Storage charges</h4>
            <div className="space-y-1">
              {s.log1_note ? <CostRow label={s.log1_note} value={money(s.log1_amt)} /> : null}
              {s.log2_note ? <CostRow label={s.log2_note} value={money(s.log2_amt)} /> : null}
              {ret ? (
                <CostRow label="Total return storage charges" value={money(s.log_return_amt)} />
              ) : (
                <CostRow label="Total storage charges" value={money(s.log_due_amt)} />
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{s.trp_type || "Transport"}</h4>
            <div className="space-y-1">
              {s.log_transport_note ? <CostRow label={s.log_transport_note} value={money(s.transport_charges)} /> : null}
              {s.retrieval_amount ? <CostRow label={`Retrieval coupon (${s.retrieval_coupon || "—"})`} value={money(s.retrieval_amount)} /> : null}
              <CostRow label="Tax amount" value={money(s.transport_tax_amt)} />
              <CostRow label="Total transport charges" value={money(s.total_transport_charges)} />
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-bold text-white sm:inline-flex">
            <span>{isReturn ? "Total return amount" : "Total payable amount"}</span>
            <span className="text-base tabular-nums">{money(isReturn ? s.final_return_amt : s.final_payable_amt)}</span>
          </div>
        </div>
      </Panel>

      <Panel icon={FileText} title="Retrieval log" count={log.length}>
        {log.length === 0 ? (
          <Empty>No retrieval log entries.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {log.map((l, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-line text-slate-700">{l.message}</p>
                  <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(l.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- Documents ----------------------------- */
function DocumentsTab({ documents, loading, error }) {
  const groups = useMemo(() => {
    const m = {};
    for (const d of documents) (m[d.document_type] = m[d.document_type] || []).push(d);
    return Object.entries(m);
  }, [documents]);
  if (error) {
    return (
      <Panel icon={Images} title="Documents">
        <ExtraError />
      </Panel>
    );
  }
  if (loading) {
    return (
      <Panel icon={Images} title="Documents">
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-500" />
        </div>
      </Panel>
    );
  }
  return (
    <Panel icon={Images} title="Documents" count={documents.length}>
      {documents.length === 0 ? (
        <Empty>No documents uploaded for this customer.</Empty>
      ) : (
        <div className="space-y-6 p-5">
          {groups.map(([type, imgs]) => (
            <div key={type}>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                {prettyWords(type)} <span className="text-slate-300">· {imgs.length}</span>
              </h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {imgs.map((d, i) => (
                  <a
                    key={i}
                    href={d.image_url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                  >
                    {d.is_doc ? (
                      <div className="flex h-32 items-center justify-center text-slate-400">
                        <FileText className="h-8 w-8" />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.image_url} alt="" loading="lazy" className="h-32 w-full object-cover transition-transform group-hover:scale-105" />
                    )}
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[10px] text-slate-500">
                      <span>{d.quotation_id ? `QT${d.quotation_id}` : ""}</span>
                      <ExternalLink className="h-3 w-3" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------- bits ----------------------------- */
function TabBtn({ active, onClick, count, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      {children}
      {count != null && (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function HeroBadge({ tone, children }) {
  const tones = {
    emerald: "bg-emerald-400/20 text-emerald-50 ring-emerald-300/30",
    amber: "bg-amber-400/20 text-amber-50 ring-amber-300/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ${
        tones[tone] || "bg-white/15 text-white ring-white/20"
      }`}
    >
      {children}
    </span>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-4 py-2.5 font-bold ${className}`}>{children}</th>;
}

/* ----------------------------- helpers ----------------------------- */
function initials(name) {
  return String(name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// "QT" + zero-padded id, matching the admin (sprintf('%03d')).
function qtLabel(id) {
  return "QT" + String(id ?? "").padStart(3, "0");
}

// Show a number as-is (trimmed) or a dash when empty/null.
function numOrDash(v) {
  if (v === null || v === undefined || v === "") return "—";
  return v;
}

function rupeeOrDash(v) {
  if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "—";
  return rupee(v);
}

// Created At in d/m/Y, matching the admin table.
function fmtDMY(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

function prettyWords(s) {
  if (!s) return "—";
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// charges_type NULL = storage; otherwise strip "_charges" and prettify.
function chargeLabel(t) {
  if (!t) return "Storage";
  return prettyWords(String(t).replace(/_charges$/, ""));
}

// Note text column name varies — pick the first sensible text field.
function noteText(n) {
  const keys = ["note", "notes", "customer_note", "note_text", "comments", "comment", "description", "message"];
  for (const k of keys) {
    if (n[k] && String(n[k]).trim()) return String(n[k]);
  }
  return "—";
}

function payStatus(s) {
  const paid = String(s || "").toLowerCase() === "paid";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${paid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
      {s || "—"}
    </span>
  );
}

function orderStatus(s) {
  const v = String(s || "").toLowerCase();
  const cls = /complet|deliver|done/.test(v)
    ? "bg-emerald-50 text-emerald-700"
    : /cancel|fail/.test(v)
    ? "bg-rose-50 text-rose-600"
    : "bg-slate-100 text-slate-600";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>{prettyWords(s)}</span>;
}

function rupee(n) {
  return "₹" + num(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function money(v) {
  if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "—";
  return "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-");
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
