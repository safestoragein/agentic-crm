"use client";
import { appHref } from "@/lib/paths";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  FileText,
  User,
  Package,
  Wallet,
  Truck,
  Home,
  CheckCircle2,
  Save,
  Pencil,
} from "lucide-react";
import { fetchQuotationEditData, saveQuotationData } from "@/lib/customer";
import { getSession } from "@/lib/auth";
import PlacesAutocompleteInput from "@/components/PlacesAutocompleteInput";
import ItemsList from "@/components/ItemsList";

export default function QuotationDetailPage() {
  const { id, quotationId } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Until the rep edits a charge, show the EXACT stored values (so the page
  // always matches the old dashboard). Recompute only on an actual edit.
  const [dirty, setDirty] = useState({ storage: false, transport: false });

  useEffect(() => {
    if (!quotationId) return;
    const ctrl = new AbortController();
    fetchQuotationEditData(quotationId, { signal: ctrl.signal })
      .then((d) => {
        if (!d) throw new Error("not found");
        setData(d);
        setForm(seedForm(d.quotation, d.customer));
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load this quotation. Please try again.");
      });
    return () => ctrl.abort();
  }, [quotationId]);

  const c = data?.customer;
  const q = data?.quotation;
  const items = data?.items || [];

  const TRANSPORT_KEYS = new Set([
    "transport_cost",
    "item_packing_charges",
    "labour_cost",
    "lift_cost",
    "extra_km_charges",
    "transport_token_amtextra",
    "transport_coupon",
  ]);
  const STORAGE_KEYS = new Set(["storage_charges", "storage_coupen"]);

  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setSaved(false);
    if (TRANSPORT_KEYS.has(k)) setDirty((d) => ({ ...d, transport: true }));
    if (STORAGE_KEYS.has(k)) setDirty((d) => ({ ...d, storage: true }));
  };

  // Selecting a vehicle pulls its charge from hometypeprice and revises the
  // transport — exactly like the old dashboard's get_vehicle_for_calculation.
  const onVehicleChange = (vehicleSlug) => {
    const ht = (data?.hometypes || []).find((h) => (h.vehicle_slug || h.vehicle_type) === vehicleSlug);
    setForm((p) => ({
      ...p,
      vehicle_type: vehicleSlug,
      ...(ht ? { transport_cost: ht.vehicle_charges, hometype: ht.home_type } : {}),
    }));
    setSaved(false);
    setDirty((d) => ({ ...d, transport: true }));
  };

  // Transport recompute (used only when the rep edits a charge/coupon) — matches
  // the customer controller: gross = (vehicle + packing + labour + lift + extra km
  // + pallet surcharge) × multi-factor, then − coupon. The pallet surcharge is part
  // of the engine's transport total (get_data_for_step3), so it's included here so a
  // re-quote lands on the same number the engine/email produce.
  const transportCalc = useMemo(() => {
    const lineItems =
      num(form?.transport_cost) +
      num(form?.item_packing_charges) +
      num(form?.labour_cost) +
      num(form?.lift_cost) +
      num(form?.extra_km_charges);
    const base = lineItems + palletSurcharge(q?.total_pallet);
    const mf = num(q?.transport_multi_factor) || 1;
    const withMf = base * mf;
    const activeCoupon = form?.transport_coupon || q?.transport_coupon || "";
    const total = Math.max(Math.ceil(withMf - couponAmount(activeCoupon, withMf)), 0);
    const token = 1000;
    const due = Math.max(Math.ceil(total - token - num(form?.transport_token_amtextra)), 0);
    return { base, lineItems, mf, total, token, due };
  }, [form, q]);

  // Live storage recalculation — port of do_storage_calculation.
  // base × multi-factor → +18% GST → minus active coupon → total; then 3/6/12-month.
  // The old dashboard shows the coupon-APPLIED figure as "Total storage charges"
  // (e.g. ₹3628.50 incl. GST − 20% = ₹2903), and derives the multi-month prices
  // from it. We match that exactly (round, not ceil, to line up on the rupee).
  const storageCalc = useMemo(() => {
    const base = num(form?.storage_charges);
    const mf = num(q?.storage_multi_factor) || 1;
    const gross = base * mf * 1.18; // GST-inclusive (not pre-rounded)
    const activeCoupon = form?.storage_coupen || q?.storage_coupen || ""; // new overrides existing
    const total = Math.round(gross - couponAmount(activeCoupon, gross));
    const month3 = Math.round(total * 0.97 * 3);
    const month6 = Math.round(total * 0.9 * 6);
    const month12 = Math.round(total * 0.8 * 12);
    return { base, mf, incGst: Math.round(gross), total, month3, month6, month12 };
  }, [form, q]);

  // Display values — faithful to customer_detailsnew:
  //   • Transport: show the STORED value (total_pickup_charges_with_gst / due) on
  //     load — customer_detailsnew renders these stored columns and does NOT
  //     recompute transport on load. Only once the rep edits a transport charge or
  //     coupon (dirty.transport) do we recompute (do_transport_calculation).
  //   • Storage: customer_detailsnew recomputes storage on load
  //     (do_storage_calculation), so we always show the recompute.
  const transportTotal = dirty.transport ? transportCalc.total : (num(q?.total_pickup_charges_with_gst) || transportCalc.total);
  const transportDue = dirty.transport ? transportCalc.due : (num(q?.transport_due_charges) || transportCalc.due);
  const storageTotal = storageCalc.total;
  const storageMonth3 = storageCalc.month3;
  const storageMonth6 = storageCalc.month6;
  const storageMonth12 = storageCalc.month12;

  const handleSave = async () => {
    if (!form || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const r = await saveQuotationData({
        customer_id: id,
        quotation_id: quotationId,
        created_by: getSession()?.user_id || "",
        // personal details
        customer_name: form.customer_name,
        customer_email: form.customer_email,
        customer_contact1: form.customer_contact1,
        // transport
        transport_cost: form.transport_cost,
        item_packing_charges: form.item_packing_charges,
        labour_cost: form.labour_cost,
        lift_cost: form.lift_cost,
        extra_km_charges: form.extra_km_charges,
        total_transportcharges: transportTotal,
        transport_token_amtextra: form.transport_token_amtextra,
        transport_due_charges: transportDue,
        transport_coupon: form.transport_coupon,
        referee_id: form.referee_id,
        // self transport
        door_to_loading_distance: form.door_to_loading_distance,
        packing_charges: form.packing_charges,
        loading_charges: form.loading_charges,
        packing_helper_charges: form.packing_helper_charges,
        // storage
        storage_coupen: form.storage_coupen,
        // pickup / vehicle
        hometype: form.hometype,
        vehicle_type: form.vehicle_type,
        pickup_floor: form.pickup_floor,
        pickup_lift: form.pickup_lift,
        // customer
        pickup_gps_location: form.pickup_gps_location,
        customer_contact2: form.customer_contact2,
        permanent_address: form.permanent_address,
        time_restriction: form.time_restriction,
      });
      if (r?.status === "success") {
        setSaved(true);
        if (r.quotation) setData((d) => ({ ...d, quotation: r.quotation }));
      } else {
        setError("Save didn't go through. Please try again.");
      }
    } catch {
      setError("Couldn't save the quotation. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <a
        href={appHref(`/customer/${id}`)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to customer
      </a>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</div>
      )}
      {!data && !error && (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      )}

      {c && q && form && (
        <>
          {/* header */}
          <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 to-indigo-900 p-6 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-white backdrop-blur">
                  <FileText className="h-6 w-6" />
                </span>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white">Quotation Details · {qt(quotationId)}</h1>
                  <div className="text-sm text-indigo-100">
                    {c.customer_name} · {c.customer_unique_id || `ID ${c.customer_id}`} ·{" "}
                    <span className="capitalize">{c.customer_local_city || "—"}</span>
                  </div>
                </div>
              </div>
              <SaveBtn saving={saving} saved={saved} onClick={handleSave} light />
            </div>
            {/* summary chips */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HeadStat label="Home type" value={form.hometype ? form.hometype.toUpperCase() : "—"} />
              <HeadStat label="Vehicle" value={form.vehicle_type || "—"} />
              <HeadStat label="Storage" value={money(storageTotal)} />
              <HeadStat label="Transport" value={money(transportTotal)} />
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            {/* left: summary + items */}
            <div className="space-y-5">
              <Card icon={User} title="Customer" tone="sky">
                <EditRow label="Name" value={form.customer_name} onChange={(v) => set("customer_name", v)} wide />
                <EditRow label="Email address" value={form.customer_email} onChange={(v) => set("customer_email", v)} wide />
                <EditRow label="Contact number" value={form.customer_contact1} onChange={(v) => set("customer_contact1", v)} />
                <EditRow label="Alternate contact" value={form.customer_contact2} onChange={(v) => set("customer_contact2", v)} />
                <Field label="Pickup address" value={c.pickup_address} />
                <AddressRow label="Permanent address" value={form.permanent_address} onChange={(v) => set("permanent_address", v)} />
                <EditRow label="Pickup GPS" value={form.pickup_gps_location} onChange={(v) => set("pickup_gps_location", v)} />
              </Card>

              <Card icon={Home} title="Pickup & vehicle" tone="amber">
                <EditRow label="Home type" value={form.hometype} onChange={(v) => set("hometype", v)} />
                <SelectRow
                  label="Vehicle"
                  value={form.vehicle_type}
                  onChange={onVehicleChange}
                  options={(data.hometypes || []).map((h) => ({
                    value: h.vehicle_slug || h.vehicle_type,
                    label: `${h.vehicle_type} (₹${h.vehicle_charges})`,
                  }))}
                />
                <EditRow label="Pickup floor" value={form.pickup_floor} onChange={(v) => set("pickup_floor", v)} />
                <SelectRow
                  label="Lift"
                  value={form.pickup_lift}
                  onChange={(v) => set("pickup_lift", v)}
                  options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                />
                <EditRow label="Time restriction" value={form.time_restriction} onChange={(v) => set("time_restriction", v)} />
              </Card>

              <Card
                icon={Package}
                title={`Items (${items.length})`}
                tone="violet"
                action={
                  <a
                    href={appHref(`/customer/${id}/new-quotation?from=${quotationId}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit items
                  </a>
                }
              >
                {items.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">No items.</p>
                ) : (
                  <ItemsList items={items} />
                )}
              </Card>

            </div>

            {/* right: pricing */}
            <div className="space-y-5">
              <Card icon={Wallet} title="Storage Charges" tone="emerald">
                <EditRow
                  label={`Storage charges${q.storage_multi_factor ? ` (${q.storage_multi_factor}% multi-factor)` : ""}`}
                  value={form.storage_charges}
                  readOnly
                  money
                />
                <EditRow label="GST (18%)" value="18" readOnly />
                <EditRow label="Total storage charges" value={storageTotal} readOnly money bold />
                <EditRow label="3 months storage charges (3% discount)" value={storageMonth3} readOnly money />
                <EditRow label="6 months storage charges (10% discount)" value={storageMonth6} readOnly money />
                <EditRow label="12 months storage charges (20% discount)" value={storageMonth12} readOnly money />
                {q.storage_coupen && (
                  <EditRow label="Existing storage coupon (on billing)" value={couponText(q.storage_coupen)} readOnly />
                )}
                <SelectRow
                  label="New storage coupon"
                  value={form.storage_coupen}
                  onChange={(v) => set("storage_coupen", v)}
                  options={[{ value: "", label: "Select coupon" }, ...(data.storage_coupons || [])]}
                />
              </Card>

              <Card icon={Truck} title="SafeStorage Transport Charges" tone="indigo">
                <EditRow label="Vehicle charges" value={form.transport_cost} onChange={(v) => set("transport_cost", v)} money />
                <EditRow label="Item packing charges" value={form.item_packing_charges} onChange={(v) => set("item_packing_charges", v)} money />
                <EditRow label="Labor cost" value={form.labour_cost} onChange={(v) => set("labour_cost", v)} money />
                <EditRow label="Lift charges" value={form.lift_cost} onChange={(v) => set("lift_cost", v)} money />
                <EditRow label="Extra km charges" value={form.extra_km_charges} onChange={(v) => set("extra_km_charges", v)} money />
                <div className="my-2 border-t border-slate-100" />
                <EditRow
                  label={`Total transport charges${q.transport_multi_factor ? ` (${q.transport_multi_factor}% multi-factor)` : ""}`}
                  value={transportTotal}
                  readOnly
                  money
                  bold
                />
                <EditRow label="Token amount" value="1000" readOnly money />
                <EditRow label="Token amount (extra)" value={form.transport_token_amtextra} onChange={(v) => set("transport_token_amtextra", v)} money />
                <EditRow label="Due amount" value={transportDue} readOnly money />
                {q.transport_coupon && (
                  <EditRow label="Existing transport coupon" value={couponText(q.transport_coupon)} readOnly />
                )}
                <SelectRow
                  label="New transport coupon"
                  value={form.transport_coupon}
                  onChange={(v) => set("transport_coupon", v)}
                  options={[{ value: "", label: "Select coupon" }, ...(data.transport_coupons || [])]}
                />
                <EditRow label="Referral code" value={form.referee_id} onChange={(v) => set("referee_id", v)} />
              </Card>

              <Card icon={Truck} title="Self Transport Charges" tone="teal">
                <EditRow label="Door → loading distance" value={form.door_to_loading_distance} onChange={(v) => set("door_to_loading_distance", v)} />
                <EditRow label="Packing material charges" value={form.packing_charges} onChange={(v) => set("packing_charges", v)} money />
                <EditRow label="Loading / unloading charges" value={form.loading_charges} onChange={(v) => set("loading_charges", v)} money />
                <EditRow label="Packing helper charges" value={form.packing_helper_charges} onChange={(v) => set("packing_helper_charges", v)} money />
              </Card>

              <div className="flex justify-end">
                <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- bits ----------------------------- */
function seedForm(q, c) {
  return {
    customer_name: c?.customer_name ?? "",
    customer_email: c?.customer_email ?? "",
    customer_contact1: c?.customer_contact1 ?? "",
    storage_charges: q.storage_charges ?? "",
    storage_coupen: "",
    transport_cost: q.transport_cost ?? "",
    item_packing_charges: q.item_packing_charges ?? "",
    labour_cost: q.labour_cost ?? "",
    lift_cost: q.lift_cost ?? "",
    extra_km_charges: q.extra_km_charges ?? "",
    transport_token_amtextra: q.transport_token_amtextra ?? "",
    transport_coupon: "",
    referee_id: q.referee_id ?? "",
    door_to_loading_distance: q.door_to_loading_distance ?? "",
    packing_charges: q.packing_charges ?? "",
    loading_charges: q.loading_charges ?? "",
    packing_helper_charges: q.packing_helper_charges ?? "",
    hometype: q.hometype ?? "",
    vehicle_type: q.vehicle_type ?? "",
    pickup_floor: q.floor ?? c?.pickup_floor ?? "",
    pickup_lift: q.lift ?? c?.pickup_lift ?? "",
    time_restriction: c?.restriction_movement_good ?? "",
    pickup_gps_location: c?.pickup_gps_location ?? "",
    customer_contact2: c?.customer_contact2 ?? "",
    permanent_address: c?.permanent_address ?? "",
  };
}

function SaveBtn({ saving, saved, onClick, light }) {
  const base = "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold shadow-sm transition-colors disabled:opacity-60";
  const cls = saved
    ? "bg-emerald-500 text-white hover:bg-emerald-600"
    : light
    ? "bg-white text-indigo-700 hover:bg-indigo-50"
    : "bg-indigo-600 text-white hover:bg-indigo-700";
  return (
    <button onClick={onClick} disabled={saving} className={`${base} ${cls}`}>
      {saving ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Saving…
        </>
      ) : saved ? (
        <>
          <CheckCircle2 className="h-4 w-4" /> Saved &amp; sent
        </>
      ) : (
        <>
          <Save className="h-4 w-4" /> Save &amp; Send Email
        </>
      )}
    </button>
  );
}

const CARD_TONES = {
  sky: { tile: "bg-sky-100 text-sky-600", bar: "bg-sky-400" },
  amber: { tile: "bg-amber-100 text-amber-600", bar: "bg-amber-400" },
  violet: { tile: "bg-violet-100 text-violet-600", bar: "bg-violet-400" },
  slate: { tile: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
  emerald: { tile: "bg-emerald-100 text-emerald-600", bar: "bg-emerald-400" },
  indigo: { tile: "bg-indigo-100 text-indigo-600", bar: "bg-indigo-400" },
  teal: { tile: "bg-teal-100 text-teal-600", bar: "bg-teal-400" },
};
function Card({ icon: Icon, title, tone = "slate", action, children }) {
  const t = CARD_TONES[tone] || CARD_TONES.slate;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`h-1 w-full ${t.bar}`} />
      <div className="p-5">
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-800">
            {Icon && (
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.tile}`}>
                <Icon className="h-4 w-4" />
              </span>
            )}
            {title}
          </h2>
          {action}
        </div>
        <div className="space-y-2.5">{children}</div>
      </div>
    </section>
  );
}

function HeadStat({ label, value }) {
  return (
    <div className="rounded-xl bg-white/15 px-3 py-2 backdrop-blur">
      <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-100">{label}</div>
      <div className="truncate text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[60%] text-right font-medium text-slate-700">{value || "—"}</span>
    </div>
  );
}

function EditRow({ label, value, onChange, readOnly, money, bold, wide }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className={`text-sm ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>{label}</label>
      <div className={`relative ${wide ? "w-56" : "w-40"}`}>
        {money && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>}
        <input
          value={value ?? ""}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          readOnly={readOnly || !onChange}
          className={`w-full rounded-lg border px-2.5 py-1.5 text-sm ${wide ? "text-left" : "text-right tabular-nums"} ${money ? "pl-6" : ""} ${
            readOnly || !onChange
              ? "border-slate-100 bg-slate-50 text-slate-600"
              : "border-slate-200 text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          } ${bold ? "font-bold" : ""}`}
        />
      </div>
    </div>
  );
}

function AddressRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm text-slate-500">{label}</label>
      <div className="relative w-56">
        <PlacesAutocompleteInput
          value={value ?? ""}
          onChange={onChange}
          placeholder="Start typing address…"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
    </div>
  );
}

function SelectRow({ label, value, onChange, options, hint }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm text-slate-500">
        {label}
        {hint && <span className="ml-1 text-[11px] text-slate-400">(now: {hint})</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      >
        {options.map((o, i) => (
          <option key={`${o.value}-${i}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
// Pallet handling surcharge the pricing engine (get_data_for_step3) folds into the
// transport total — bands: ≤3 pallets → ₹2000, >3 & <6 → ₹3600, ≥6 → ₹4800. Used
// only in the recompute-on-edit path so a re-quote matches the engine/email.
function palletSurcharge(pallets) {
  const p = num(pallets);
  if (p <= 0) return 0;
  if (p <= 3) return 2000;
  if (p < 6) return 3600;
  return 4800;
}
// Coupon "safestorage-{flat|percent}-{amount}" → discount value off `base`.
function couponAmount(code, base) {
  if (!code) return 0;
  const a = String(code).split("-");
  if (a[1] === "flat") return num(a[2]);
  if (a[2]) return (num(a[2]) / 100) * num(base);
  return 0;
}
function couponText(code) {
  if (!code) return "—";
  const a = String(code).split("-");
  if (a[1] === "flat") return `Flat ₹ ${a[2]} OFF`;
  if (a[2]) return `${a[2]}% OFF`;
  return code;
}
function money(v) {
  if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "—";
  return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function qt(id) {
  return "QT" + String(id ?? "").padStart(3, "0");
}
