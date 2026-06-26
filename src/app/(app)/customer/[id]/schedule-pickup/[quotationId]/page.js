"use client";
import { appHref } from "@/lib/paths";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Truck,
  Home,
  CalendarDays,
  Wallet,
  FileText,
  CheckCircle2,
  Info,
  ShieldCheck,
  AlertTriangle,
  Receipt,
  ImageUp,
} from "lucide-react";
import {
  fetchSchedulePickupData,
  fetchPickupDisabledDates,
  fetchPickupSlots,
  confirmPickup,
} from "@/lib/customer";
import { getSession } from "@/lib/auth";

const PAYMENT_TYPES = [
  { value: "monthly", label: "Monthly" },
  { value: "three_monthly", label: "3 months (5% discount)" },
  { value: "half_yearly", label: "6 months (10% discount)" },
  { value: "nine_monthly", label: "9 months (15% discount)" },
  { value: "yearly", label: "Yearly (20% discount)" },
];

const ORDER_TYPES = [
  { value: "free_pickup", label: "Free Pickup" },
  { value: "normal_pickup", label: "Normal Pickup" },
];

export default function SchedulePickupPage() {
  const { id, quotationId } = useParams();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [disabledDates, setDisabledDates] = useState({ disabled_date_arr: [], arrival_disabled_date_arr: [] });

  const [form, setForm] = useState({
    pickup_type: "pickup",
    pickup_date: "",
    pickup_timeslot: "",
    payment_type: "",
    gstin_no: "",
    restriction_movement_good: "",
    packers_movers_name: "",
    is_intercity: "",
    paid_amount: "",
    transaction_note: "",
    order_id: "",
    custom_order_type: "",
    is_read: false,
    is_terms_condition: false,
  });
  const [txnImage, setTxnImage] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotMsg, setSlotMsg] = useState("");

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Core form data — fast.
  useEffect(() => {
    if (!quotationId) return;
    const ctrl = new AbortController();
    fetchSchedulePickupData(quotationId, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setForm((p) => ({
          ...p,
          pickup_type: d.quotation?.transport_type === "safestorage_transport" ? "pickup" : "warehouse_arrival",
        }));
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        if (e?.code === "already_confirmed_or_not_found") setBlocked(true);
        else setError("Couldn't load the pickup form. Please try again.");
      });
    return () => ctrl.abort();
  }, [quotationId]);

  // Booked-out dates — background.
  useEffect(() => {
    if (!quotationId || blocked) return;
    const ctrl = new AbortController();
    fetchPickupDisabledDates(quotationId, { signal: ctrl.signal })
      .then((d) => setDisabledDates(d))
      .catch(() => {});
    return () => ctrl.abort();
  }, [quotationId, blocked]);

  const c = data?.customer;
  const q = data?.quotation;
  const isNew = String(data?.is_new_quotation) === "1";
  const tokenAdvance = data?.token_advance;
  const isWarehouse = form.pickup_type === "warehouse_arrival";

  const disabledSet = useMemo(() => {
    const arr = isWarehouse ? disabledDates.arrival_disabled_date_arr : disabledDates.disabled_date_arr;
    return new Set((arr || []).map(String));
  }, [disabledDates, isWarehouse]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Old quotations use a visible timeslot dropdown loaded on date change.
  useEffect(() => {
    if (isNew || !form.pickup_date || isWarehouse) {
      setSlots([]);
      setSlotMsg("");
      return;
    }
    const ctrl = new AbortController();
    setSlots([]);
    setSlotMsg("");
    fetchPickupSlots(
      { quotation_id: quotationId, pickup_date: toDMY(form.pickup_date), pickup_type: form.pickup_type },
      { signal: ctrl.signal }
    )
      .then((r) => {
        setSlots(parseOptions(r?.info || ""));
        if (r?.is_empty_slot === "no") setSlotMsg("No timeslot available for this date.");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [form.pickup_date, form.pickup_type, isNew, isWarehouse, quotationId]);

  const dateDisabled = form.pickup_date && disabledSet.has(form.pickup_date);

  const validate = () => {
    if (!form.pickup_date) return "Please choose a pickup date.";
    if (dateDisabled) return "That date is fully booked. Please pick another date.";
    if (!form.payment_type) return "Please select a storage charges payment type.";
    if (!form.restriction_movement_good.trim()) return "Please fill the time-restriction field.";
    if (isWarehouse && !form.packers_movers_name.trim()) return "Please enter the packers & movers name.";
    if (!form.paid_amount.trim()) return "Please enter the paid amount.";
    if (!form.transaction_note.trim()) return "Please enter a transaction note.";
    if (!form.custom_order_type) return "Please select a pickup type.";
    if (form.is_intercity === "") return "Please choose whether this is an intercity pickup.";
    if (!form.is_read) return "Please confirm you have read the pickup checklist.";
    if (!form.is_terms_condition) return "Please accept the terms & conditions.";
    return "";
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      setConfirmOpen(false);
      return;
    }
    setError("");
    setConfirmOpen(false);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("customer_id", id);
      fd.append("quotation_id", quotationId);
      fd.append("pickup_type", form.pickup_type);
      fd.append("pickup_date", toDMY(form.pickup_date));
      fd.append("pickup_timeslot", form.pickup_timeslot);
      fd.append("payment_type", form.payment_type);
      fd.append("gstin_no", form.gstin_no);
      fd.append("restriction_movement_good", form.restriction_movement_good);
      fd.append("customer_local_city", c?.customer_local_city || "");
      fd.append("is_intercity", form.is_intercity || "0");
      if (isWarehouse) fd.append("packers_movers_name", form.packers_movers_name);
      fd.append("is_admin_confirm", "yes");
      fd.append("paid_amount", form.paid_amount);
      fd.append("transaction_note", form.transaction_note);
      fd.append("order_id", form.order_id);
      fd.append("custom_order_type", form.custom_order_type);
      fd.append("customer_pay_amt", tokenAdvance ?? "");
      if (txnImage) fd.append("transaction_image", txnImage);
      const session = getSession();
      if (session?.user_id) fd.append("created_by", session.user_id);

      const res = await confirmPickup(fd);
      if (res === "success") {
        setDone(true);
        setTimeout(() => router.push(`/customer/${id}`), 1800);
      } else {
        setError("The booking didn't go through (the link may already be confirmed). Please refresh and try again.");
      }
    } catch {
      setError("Couldn't confirm the pickup. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const tryOpenConfirm = () => {
    const v = validate();
    if (v) setError(v);
    else {
      setError("");
      setConfirmOpen(true);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col">
      {/* breadcrumb bar */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <a
          href={appHref(`/customer/${id}`)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" /> Back to customer
        </a>
        <span className="text-sm font-medium text-slate-400">
          Bookings · <span className="font-bold text-slate-700">{qt(quotationId)}</span>
        </span>
      </div>

      <div className="flex-1 px-6 py-6 pb-28">
        <div className="mx-auto max-w-6xl">
          {blocked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              This quotation is already confirmed (or no longer schedulable). Nothing to do here.
            </div>
          )}

          {!data && !blocked && !error && (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          )}
          {!data && error && (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {c && q && !blocked && (
            <>
              {/* gradient header */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-6 shadow-sm">
                <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/20 backdrop-blur">
                      <Truck className="h-6 w-6" />
                    </span>
                    <div>
                      <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Confirm Pickup · {qt(quotationId)}</h1>
                      <div className="mt-0.5 text-sm text-indigo-100">
                        {c.customer_name} · {c.customer_unique_id || `ID ${c.customer_id}`} ·{" "}
                        <span className="capitalize">{c.customer_local_city || "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/10 px-4 py-2 text-center ring-1 ring-white/15 backdrop-blur">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-100">Token advance</div>
                    <div className="text-xl font-bold text-white">₹{tokenAdvance ?? "—"}</div>
                  </div>
                </div>
                <Truck className="pointer-events-none absolute -right-6 -bottom-7 h-40 w-40 text-white/5" />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
                {/* ---------------- left: form ---------------- */}
                <div className="space-y-5">
                  {/* transport */}
                  <Card icon={Truck} title="Transport" right="Choose one">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RadioTile
                        active={form.pickup_type === "pickup"}
                        onClick={() => set("pickup_type", "pickup")}
                        icon={Truck}
                        title="SafeStorage Transport"
                        sub={`Token advance · ₹${tokenAdvance ?? "—"}`}
                      />
                      <RadioTile
                        active={isWarehouse}
                        onClick={() => set("pickup_type", "warehouse_arrival")}
                        icon={Home}
                        title="Own Transport"
                        sub={`Warehouse arrival · ₹${tokenAdvance ?? "—"}`}
                      />
                    </div>
                    {isWarehouse && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Unpacked / semi-packed items are not allowed. Please ensure everything is fully packed (bubble wrap,
                        corrugated sheet, stretch film; miscellaneous items in carton boxes).
                      </div>
                    )}
                  </Card>

                  {/* booking details */}
                  <Card icon={FileText} title="Booking details">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Pickup date" required>
                        <input
                          type="date"
                          value={form.pickup_date}
                          min={today()}
                          onChange={(e) => set("pickup_date", e.target.value)}
                          className={`${inputCls} ${dateDisabled ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/20" : ""}`}
                        />
                        {dateDisabled && (
                          <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-rose-600">
                            <AlertTriangle className="h-3 w-3" /> Fully booked — pick another date.
                          </p>
                        )}
                      </Field>
                      <Field label="Intercity pickup?" required>
                        <select value={form.is_intercity} onChange={(e) => set("is_intercity", e.target.value)} className={inputCls}>
                          <option value="">Select</option>
                          <option value="1">Yes</option>
                          <option value="0">No</option>
                        </select>
                      </Field>
                      {!isNew && !isWarehouse && (
                        <Field label="Time-slot">
                          <select value={form.pickup_timeslot} onChange={(e) => set("pickup_timeslot", e.target.value)} className={inputCls}>
                            <option value="">Select option</option>
                            {slots.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          {slotMsg && <p className="mt-1.5 text-xs font-semibold text-amber-600">{slotMsg}</p>}
                        </Field>
                      )}
                      <Field label="Storage charges payment type" required>
                        <select value={form.payment_type} onChange={(e) => set("payment_type", e.target.value)} className={inputCls}>
                          <option value="">Select option</option>
                          {PAYMENT_TYPES.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="GSTIN no">
                        <input value={form.gstin_no} onChange={(e) => set("gstin_no", e.target.value)} className={inputCls} placeholder="Enter GSTIN no" />
                      </Field>
                      <Field label="City">
                        <input value={c.customer_local_city || ""} disabled className={`${inputCls} bg-slate-50 capitalize text-slate-500`} />
                      </Field>
                      <Field label="Any time restrictions for movement of goods?" required>
                        <input
                          value={form.restriction_movement_good}
                          onChange={(e) => set("restriction_movement_good", e.target.value)}
                          className={inputCls}
                          placeholder="e.g. After 6 PM only"
                        />
                      </Field>
                      {isWarehouse && (
                        <Field label="Packers & movers name" required>
                          <input
                            value={form.packers_movers_name}
                            onChange={(e) => set("packers_movers_name", e.target.value)}
                            className={inputCls}
                          />
                        </Field>
                      )}
                    </div>
                  </Card>

                  {/* payment & order */}
                  <Card icon={Receipt} title="Payment & order">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Paid amount" required>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
                          <input
                            value={form.paid_amount}
                            onChange={(e) => set("paid_amount", e.target.value)}
                            className={`${inputCls} pl-7`}
                            placeholder="Enter paid amount"
                            inputMode="decimal"
                          />
                        </div>
                      </Field>
                      <Field label="Pickup type" required>
                        <select value={form.custom_order_type} onChange={(e) => set("custom_order_type", e.target.value)} className={inputCls}>
                          <option value="">Select pickup type</option>
                          {ORDER_TYPES.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Transaction note" required>
                        <input
                          value={form.transaction_note}
                          onChange={(e) => set("transaction_note", e.target.value)}
                          className={inputCls}
                          placeholder="Transaction note"
                        />
                      </Field>
                      <Field label="Order ID">
                        <input value={form.order_id} onChange={(e) => set("order_id", e.target.value)} className={inputCls} placeholder="Order ID" />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Transaction image">
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
                            <ImageUp className="h-4 w-4" />
                            <span className="truncate">{txnImage ? txnImage.name : "Upload transaction image"}</span>
                            <input type="file" accept="image/*" onChange={(e) => setTxnImage(e.target.files?.[0] || null)} className="hidden" />
                          </label>
                        </Field>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* ---------------- right ---------------- */}
                <div className="space-y-5">
                  {/* summary */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="px-5 pt-4">
                      <h2 className="text-sm font-bold text-slate-800">Summary</h2>
                    </div>
                    <div className="divide-y divide-slate-100 px-5 pt-1">
                      <SummaryRow label="Quotation" value={qt(quotationId)} />
                      <SummaryRow label="Customer" value={c.customer_name} />
                      <SummaryRow label="Location" value={c.customer_local_city || "—"} cap />
                      <SummaryRow label="Transport" value={isWarehouse ? "Own (warehouse arrival)" : "SafeStorage Transport"} />
                      {form.pickup_date && <SummaryRow label="Pickup date" value={toDMY(form.pickup_date)} />}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between rounded-xl bg-indigo-50 px-4 py-3">
                        <span className="text-sm font-semibold text-indigo-700">Token advance</span>
                        <span className="text-lg font-bold text-indigo-700">₹{tokenAdvance ?? "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* confirmation */}
                  <Card icon={ShieldCheck} title="Confirmation">
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Zero cancellation charges before 24 hours of pickup. Transport (SafeStorage / Vendor Partner) will be
                      assigned.
                    </div>
                    <label className="mb-2.5 flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.is_read}
                        onChange={(e) => set("is_read", e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      I have read the pickup checklist
                    </label>
                    <label className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.is_terms_condition}
                        onChange={(e) => set("is_terms_condition", e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      I agree with the terms &amp; conditions of SafeStorage
                    </label>
                    {error && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* bottom sticky action bar */}
      {c && q && !blocked && (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              Quote <span className="font-bold text-slate-700">{qt(quotationId)}</span> · Token advance{" "}
              <span className="font-bold text-slate-700">₹{tokenAdvance ?? "—"}</span>
            </div>
            {done ? (
              <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Pickup confirmed — opening customer…
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <a
                  href={appHref(`/customer/${id}`)}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </a>
                <button
                  onClick={tryOpenConfirm}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Confirm pickup
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmOpen && <ConfirmModal customerName={c.customer_name} onCancel={() => setConfirmOpen(false)} onConfirm={submit} />}
    </div>
  );
}

/* ----------------------------- bits ----------------------------- */
const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function Card({ icon: Icon, title, right, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {right && <span className="ml-auto text-xs font-medium text-slate-400">{right}</span>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function RadioTile({ active, onClick, icon: Icon, title, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
        active
          ? "border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-600"
          : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm"
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-400">{sub}</span>
      </span>
      {active && <CheckCircle2 className="absolute right-2.5 top-2.5 h-4 w-4 text-indigo-600" />}
    </button>
  );
}

function SummaryRow({ label, value, cap }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-semibold text-slate-800 ${cap ? "capitalize" : ""}`}>{value}</span>
    </div>
  );
}

function ConfirmModal({ customerName, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
            <Truck className="h-7 w-7" />
          </span>
          <h3 className="mt-4 text-lg font-bold text-slate-900">Confirm this pickup?</h3>
          <p className="mt-1 text-sm text-slate-500">
            This creates the order for <span className="font-semibold text-slate-700">{customerName}</span> and emails the
            customer, manager and transport team.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>This is the real production confirmation — it cannot be undone from here.</span>
          </div>
        </div>
        <div className="flex gap-2 p-5">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700">
            Yes, confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
function qt(id) {
  return "QT" + String(id ?? "").padStart(3, "0");
}
function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function toDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function parseOptions(html) {
  const out = [];
  const re = /<option[^>]*value=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const value = m[1].trim();
    const label = m[2].replace(/<[^>]*>/g, "").trim();
    if (value) out.push({ value, label: label || value });
  }
  return out;
}
