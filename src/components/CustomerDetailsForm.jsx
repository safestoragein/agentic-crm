"use client";

import { useState } from "react";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { updateCustomerDetails } from "@/lib/customer";
import PlacesAutocompleteInput from "@/components/PlacesAutocompleteInput";

// Select options keyed by column. Plain arrays render value=label; objects
// allow a distinct stored value vs. shown label.
const SELECTS = {
  customer_initial: ["Mr", "Mrs", "Ms", "M/S"],
  payment_type: ["Monthly", "Yearly", "Half Yearly", "Quarterly"],
  payment_plan: ["Prepaid", "Postpaid"],
  inventory_applicable: ["yes", "no"],
  pickup_floor: ["ground", "1", "2", "3", "4", "5", "6-10", ">10"],
  pickup_lift: ["Available", "Not Available"],
  is_business_cust: [
    { value: "0", label: "No (Household)" },
    { value: "1", label: "Yes (Business)" },
  ],
};

const PROFILE = [
  { key: "customer_initial", label: "Title", type: "select" },
  { key: "customer_name", label: "Name" },
  { key: "customer_email", label: "Email" },
  { key: "alternate_customer_email", label: "Alt. email" },
  { key: "customer_contact1", label: "Phone" },
  { key: "customer_contact2", label: "Alt. phone" },
  { key: "customer_local_city", label: "Local city" },
  { key: "payment_type", label: "Payment type", type: "select" },
  { key: "payment_plan", label: "Payment plan", type: "select" },
  { key: "referral_code", label: "Referral code" },
  { key: "customer_tier", label: "Customer tier" },
  { key: "is_business_cust", label: "Is business", type: "select" },
  { key: "business_storage_type", label: "Business storage" },
  { key: "inventory_applicable", label: "Inventory applicable", type: "select" },
  { key: "pan_no", label: "PAN" },
  { key: "gstin_no", label: "GSTIN" },
  { key: "promo_code", label: "Promo code" },
  { key: "tds_rate", label: "TDS rate" },
  { key: "proof_id_type", label: "Proof ID type" },
  { key: "proof_id_no", label: "Proof ID no" },
  { key: "warehouse_arrival", label: "Warehouse arrival", type: "checkbox" },
];

const ADDRESS = [
  { key: "permanent_address", label: "Permanent address", type: "address" },
  { key: "cust_gst_address", label: "GST address", type: "address" },
  { key: "cust_gst_pincode", label: "GST pincode" },
  { key: "pickup_address", label: "Pickup address", type: "address" },
  { key: "delivery_address", label: "Delivery address", type: "address" },
  { key: "pickup_gps_location", label: "Pickup GPS location" },
  { key: "pickup_floor", label: "Pickup floor", type: "select" },
  { key: "pickup_lift", label: "Lift availability", type: "select" },
];

const ALL = [...PROFILE, ...ADDRESS];

export default function CustomerDetailsForm({ customer, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const startEdit = () => {
    const init = {};
    ALL.forEach((f) => {
      let v = customer[f.key];
      if (f.key === "is_business_cust") v = String(v) === "1" ? "1" : "0";
      else if (f.type === "checkbox") v = isTrue(v) ? "1" : "0";
      init[f.key] = v == null ? "" : String(v);
    });
    setForm(init);
    setEditing(true);
  };

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await updateCustomerDetails(customer.customer_id, form);
      setEditing(false);
      onSaved?.();
    } catch {
      alert("Couldn't save customer details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-bold text-slate-800">Customer Details</h2>
        {!editing ? (
          <button
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit details
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </button>
          </div>
        )}
      </div>

      <div className="space-y-6 p-5">
        <Group title="Profile" fields={PROFILE} customer={customer} editing={editing} form={form} set={set} />
        <Group title="Address" fields={ADDRESS} customer={customer} editing={editing} form={form} set={set} />
      </div>
    </div>
  );
}

function Group({ title, fields, customer, editing, form, set }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) =>
          editing ? (
            <EditCell key={f.key} field={f} value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ) : (
            <ViewCell key={f.key} field={f} value={customer[f.key]} />
          )
        )}
      </div>
    </div>
  );
}

/* ----------------------------- view ----------------------------- */
function ViewCell({ field, value }) {
  const full = field.type === "textarea" || field.type === "address";
  const v = displayValue(field, value);
  const empty = v === "—";
  return (
    <div className={full ? "sm:col-span-2 lg:col-span-3" : ""}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{field.label}</dt>
      <dd className={`mt-1 break-words text-sm font-semibold ${empty ? "text-slate-300" : "text-slate-800"}`}>{v}</dd>
    </div>
  );
}

/* ----------------------------- edit ----------------------------- */
function EditCell({ field, value, onChange }) {
  const full = field.type === "textarea" || field.type === "address";
  const inputCls =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div className={full ? "sm:col-span-2 lg:col-span-3" : ""}>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">{field.label}</label>
      {field.type === "address" ? (
        <PlacesAutocompleteInput
          value={value}
          onChange={onChange}
          className={inputCls}
          placeholder="Start typing building name, area, city…"
        />
      ) : field.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">Select</option>
          {options(field.key).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={inputCls} />
      ) : field.type === "checkbox" ? (
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value === "1"}
            onChange={(e) => onChange(e.target.checked ? "1" : "0")}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Arrived at warehouse
        </label>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */
function options(key) {
  return (SELECTS[key] || []).map((o) => (typeof o === "string" ? { value: o, label: prettyWords(o) } : o));
}

function displayValue(field, value) {
  if (field.type === "checkbox") return isTrue(value) ? "Yes" : "No";
  if (field.key === "is_business_cust") return String(value) === "1" ? "Yes (Business)" : "No (Household)";
  if (value == null || value === "") return "—";
  if (field.type === "select") return prettyWords(value);
  return String(value);
}

function isTrue(v) {
  return ["1", "yes", "true", "on"].includes(String(v).toLowerCase());
}

function prettyWords(s) {
  if (!s && s !== 0) return "—";
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
