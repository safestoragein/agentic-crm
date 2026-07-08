"use client";
import { appHref } from "@/lib/paths";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, UserPlus, ArrowRight, AlertTriangle, Info } from "lucide-react";
import { createCustomer } from "@/lib/customer";
import { fetchCustomerFilters, fetchCustomers, fetchWarehouseForDistance } from "@/lib/customers";
import { getSession } from "@/lib/auth";
import PlacesAutocompleteInput from "@/components/PlacesAutocompleteInput";

const INITIALS = ["Mr", "Mrs", "Ms", "M/S"];
const FLOORS = ["ground", "1", "2", "3", "4", "5", "6-10", ">10"];
const LIFTS = ["Available", "Not Available"];
const INTERCITY_THRESHOLD_KM = 65; // pickup ≥ this from the warehouse → intercity

export default function CreateQuotationPage() {
  const router = useRouter();
  const [opts, setOpts] = useState({ cities: [], crm_users: [] });
  const [form, setForm] = useState({
    customer_initial: "Mr",
    customer_name: "",
    customer_contact1: "",
    customer_email: "",
    customer_local_city: "",
    relationship_manager_id: "",
    pickup_address: "",
    pickup_floor: "",
    pickup_lift: "",
    storage_month: "1",
    warehouse_arrival: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existInfo, setExistInfo] = useState(null);
  const [existName, setExistName] = useState("");
  const [existBy, setExistBy] = useState("phone");
  const [checking, setChecking] = useState(false);
  const [pickupLoc, setPickupLoc] = useState({ lat: null, lng: null });
  const [dist, setDist] = useState(null); // { km, intercity, warehouse } | { error:true } | null

  // Warehouse → pickup driving distance (Google DistanceMatrix), so the team sees
  // whether the quote is intercity — mirrors the legacy add_customer form.
  const runDistance = useCallback(async (lat, lng, citySlug) => {
    setDist(null);
    if (!lat || !lng || !citySlug || !window.google?.maps) return;
    try {
      const res = await fetchWarehouseForDistance(citySlug);
      if (res?.status !== "success" || !res.origin) { setDist({ error: true }); return; }
      const svc = new window.google.maps.DistanceMatrixService();
      svc.getDistanceMatrix(
        {
          origins: [res.origin],
          destinations: [new window.google.maps.LatLng(lat, lng)],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.METRIC,
        },
        (response, status) => {
          const el = response?.rows?.[0]?.elements?.[0];
          if (status !== "OK" || !el || el.status !== "OK") { setDist(null); return; }
          const km = el.distance.value / 1000;
          setDist({ km, intercity: km >= INTERCITY_THRESHOLD_KM, warehouse: res.warehouse_name || "" });
        }
      );
    } catch {
      setDist(null);
    }
  }, []);

  // The moment the rep finishes the phone or email field, check if a customer
  // with that number/email already exists (read-only search) and surface a link
  // to open them — same as the old dashboard, but shown immediately instead of
  // only on submit.
  const checkExisting = async (by = "phone") => {
    const phone = (form.customer_contact1 || "").trim();
    const email = (form.customer_email || "").trim().toLowerCase();
    let search = "", matches;
    if (by === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
      search = email;
      matches = (r) => String(r.customer_email || "").trim().toLowerCase() === email;
    } else {
      if (!/^\d{10}$/.test(phone)) return;
      search = phone;
      matches = (r) => String(r.customer_contact1 || "").replace(/\D/g, "").endsWith(phone);
    }
    setChecking(true);
    try {
      const { rows } = await fetchCustomers({ search, length: 5, customer_type: "" });
      const match = (rows || []).find(matches);
      if (match?.customer_id) {
        setExistInfo(String(match.customer_id));
        setExistName(match.customer_name || "");
        setExistBy(by);
      }
    } catch {
      /* best-effort; the submit-time check still catches duplicates */
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCustomerFilters({ signal: ctrl.signal })
      .then((d) => setOpts({ cities: d.cities || [], crm_users: d.crm_users || [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // Recompute the distance when the city changes (if a pickup point is already set).
  useEffect(() => {
    if (pickupLoc.lat && pickupLoc.lng && form.customer_local_city) {
      runDistance(pickupLoc.lat, pickupLoc.lng, form.customer_local_city);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_local_city]);

  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setError("");
    setExistInfo(null);
    setExistName("");
  };

  // Warehouse arrival ⇒ own transport, no pickup. Clear any pickup details and
  // the computed distance so a stale address can't add a transport charge later.
  const setWarehouseArrival = (checked) => {
    setForm((p) => ({
      ...p,
      warehouse_arrival: checked,
      ...(checked ? { pickup_address: "", pickup_floor: "", pickup_lift: "" } : {}),
    }));
    if (checked) {
      setPickupLoc({ lat: null, lng: null });
      setDist(null);
    }
    setError("");
  };

  const validate = () => {
    if (!form.customer_initial) return "Please select a title.";
    if (!form.customer_name.trim()) return "Please enter the customer name.";
    if (!/^\d{10}$/.test(form.customer_contact1.trim())) return "Please enter a valid 10-digit phone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customer_email.trim())) return "Please enter a valid email address.";
    if (!form.customer_local_city) return "Please select the city.";
    if (!form.relationship_manager_id) return "Please assign a CRM user.";
    // Warehouse arrival = the customer brings goods to the warehouse themselves
    // (own transport), so pickup address / floor / lift don't apply — same as the
    // legacy add_customer flow.
    if (!form.warehouse_arrival) {
      if (!form.pickup_address.trim()) return "Please enter the pickup address.";
      if (!form.pickup_floor) return "Please select the pickup floor.";
      if (!form.pickup_lift) return "Please select the lift option.";
    }
    if (!(Number(form.storage_month) >= 1)) return "Please enter the storage duration in months.";
    return "";
  };

  const proceed = async (forceExisting) => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const session = getSession();
      const r = await createCustomer({
        ...form,
        warehouse_arrival: form.warehouse_arrival ? "1" : "",
        storage_type: "household_storage",
        created_by: session?.user_id || "",
        // Warehouse→pickup distance + intercity flag (same as the legacy add_customer).
        pickup_lat: pickupLoc.lat || "",
        pickup_lang: pickupLoc.lng || "",
        pickup_distance_km: dist && !dist.error ? dist.km.toFixed(2) : "",
        is_intercity_quote: dist && !dist.error && dist.intercity ? "1" : "0",
      });
      if (r?.status === "success" && r?.customer_id) {
        router.push(`/customer/${r.customer_id}/new-quotation`);
      } else if (r?.status === "exist" && r?.customer_id) {
        if (forceExisting) {
          router.push(`/customer/${r.customer_id}/new-quotation`);
        } else {
          setExistInfo(r.customer_id);
        }
      } else {
        setError("Couldn't create the customer. Please try again.");
      }
    } catch {
      setError("Couldn't create the customer. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <Link
        href="/quotations"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to quotations
      </Link>

      {/* header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-6 shadow-sm">
        <div className="relative z-10 flex items-center gap-3.5">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur">
            <UserPlus className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Create Quotation</h1>
            <p className="mt-0.5 text-sm text-indigo-100">Add the customer, then pick items &amp; pricing.</p>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-bold text-slate-800">Customer details</h2>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Title" required>
            <select value={form.customer_initial} onChange={(e) => set("customer_initial", e.target.value)} className={inputCls}>
              {INITIALS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer name" required>
            <input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Phone" required>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">+91</span>
              <input
                value={form.customer_contact1}
                onChange={(e) => set("customer_contact1", e.target.value.replace(/\D/g, "").slice(0, 10))}
                onBlur={() => checkExisting("phone")}
                className={`${inputCls} pl-11`}
                placeholder="10-digit mobile"
                inputMode="numeric"
              />
            </div>
            {checking && (
              <p className="mt-1 text-xs text-slate-400">Checking for existing customer…</p>
            )}
            {existInfo && existBy === "phone" && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                Customer already exists{existName ? ` (${existName})` : ""}.{" "}
                <a href={appHref(`/customer/${existInfo}`)} className="underline hover:text-rose-700">
                  Click here
                </a>{" "}
                to open.
              </p>
            )}
          </Field>
          <Field label="Email" required>
            <input value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} onBlur={() => checkExisting("email")} className={inputCls} placeholder="name@example.com" type="email" />
            {existInfo && existBy === "email" && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                Customer already exists{existName ? ` (${existName})` : ""}.{" "}
                <a href={appHref(`/customer/${existInfo}`)} className="underline hover:text-rose-700">
                  Click here
                </a>{" "}
                to open.
              </p>
            )}
          </Field>
          <Field label="City" required>
            <select value={form.customer_local_city} onChange={(e) => set("customer_local_city", e.target.value)} className={inputCls}>
              <option value="">Select city</option>
              {opts.cities.map((c) => (
                <option key={c.city_slug} value={c.city_slug}>
                  {c.city_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned CRM user" required>
            <select value={form.relationship_manager_id} onChange={(e) => set("relationship_manager_id", e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {opts.crm_users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user_fname}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Transport">
              <label className="flex items-center gap-2 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.warehouse_arrival}
                  onChange={(e) => setWarehouseArrival(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Own transport (warehouse arrival)
              </label>
            </Field>
          </div>

          {form.warehouse_arrival ? (
            <div className="sm:col-span-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              The customer brings goods to the warehouse — no pickup address or transport charge needed.
            </div>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Field label="Pickup address" required>
                  <PlacesAutocompleteInput
                    value={form.pickup_address}
                    onChange={(v) => set("pickup_address", v)}
                    onPlace={({ address, lat, lng }) => {
                      if (address) set("pickup_address", address);
                      setPickupLoc({ lat, lng });
                      runDistance(lat, lng, form.customer_local_city);
                    }}
                    className={inputCls}
                    placeholder="Start typing building name, area, city…"
                  />
                  {dist && (
                    dist.error ? (
                      <p className="mt-1.5 text-xs font-semibold text-rose-600">No warehouse found for the selected city to compute distance.</p>
                    ) : (
                      <p className={`mt-1.5 flex items-center gap-1.5 text-sm font-semibold ${dist.intercity ? "text-rose-600" : "text-slate-700"}`}>
                        {dist.intercity && <AlertTriangle className="h-4 w-4 shrink-0" />}
                        Distance from warehouse {dist.warehouse} is {dist.km.toFixed(1)} km.{dist.intercity ? " It will come under intercity." : ""}
                      </p>
                    )
                  )}
                </Field>
              </div>
              <Field label="Pickup floor" required>
                <select value={form.pickup_floor} onChange={(e) => set("pickup_floor", e.target.value)} className={inputCls}>
                  <option value="">Select floor</option>
                  {FLOORS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lift" required>
                <select value={form.pickup_lift} onChange={(e) => set("pickup_lift", e.target.value)} className={inputCls}>
                  <option value="">Select</option>
                  {LIFTS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Storage duration (months)" required>
            <input
              value={form.storage_month}
              onChange={(e) => set("storage_month", e.target.value.replace(/\D/g, ""))}
              className={inputCls}
              inputMode="numeric"
            />
          </Field>
        </div>

        {error && (
          <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {existInfo && (
          <div className="mx-5 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            <Info className="h-4 w-4 shrink-0" />
            A customer with this phone/email already exists.
            <button onClick={() => proceed(true)} className="font-bold text-amber-900 underline">
              Create a quotation for them
            </button>
            <span>or</span>
            <a href={appHref(`/customer/${existInfo}`)} className="font-bold text-amber-900 underline">
              open their profile
            </a>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 p-4">
          <button
            onClick={() => proceed(false)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Creating…
              </>
            ) : (
              <>
                Continue to items &amp; pricing <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

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
