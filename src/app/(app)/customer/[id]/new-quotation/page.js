"use client";
import { appHref } from "@/lib/paths";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Minus,
  Plus,
  Package,
  Building2,
  Home,
  Truck,
  ChevronLeft,
  ArrowRight,
  ShoppingCart,
  Trash2,
  Search,
  X,
  Info,
  ShieldCheck,
  // item icons
  Sofa,
  Armchair,
  BedDouble,
  Archive,
  LibraryBig,
  Table,
  Refrigerator,
  WashingMachine,
  Microwave,
  Tv,
  Monitor,
  Cpu,
  Laptop,
  Printer,
  Fan,
  Heater,
  Speaker,
  Camera,
  Projector,
  Radio,
  Coffee,
  CookingPot,
  Utensils,
  Wine,
  Fish,
  Drum,
  Guitar,
  Piano,
  Mic,
  Music,
  Dumbbell,
  Volleyball,
  Bike,
  Car,
  Baby,
  Gamepad2,
  Sprout,
  TreePine,
  Lamp,
  Clock,
  Frame,
  Shirt,
  Dog,
  Cat,
  Bird,
  Box,
  Luggage,
  Briefcase,
  Wrench,
  Paintbrush,
  Umbrella,
  Tent,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { fetchQuotationFormData, calculateQuotationPricing, saveQuotation, fetchQuotationItems } from "@/lib/customer";
import { getSession } from "@/lib/auth";

export default function NewQuotationPage() {
  const { id } = useParams();
  const fromQuotation = useSearchParams().get("from"); // editing items of an existing quote
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1); // 1 = items, 2 = pickup & pricing
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState({}); // { storage_item_slug: count }
  const [pricing, setPricing] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  // Editable charges (rep can override before proceeding), seeded from the engine.
  const [charges, setCharges] = useState({ storage: 0, transport: 0, token: 0 });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // { ok, quotationId } | { ok:false, msg }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetchQuotationFormData(id, { signal: ctrl.signal })
      .then((d) => setData(d))
      .catch((e) => {
        if (e?.name !== "AbortError") setError("Couldn't load the quotation form. Please try again.");
      });
    return () => ctrl.abort();
  }, [id]);

  // When editing an existing quote's items (?from=<quotation_id>), pre-seed the
  // cart with that quote's items. Saving still creates a NEW quotation revision,
  // matching the legacy get_edit_quotation_for_modal behavior.
  useEffect(() => {
    if (!fromQuotation) return;
    const ctrl = new AbortController();
    fetchQuotationItems(fromQuotation, { signal: ctrl.signal })
      .then((rows) => {
        const seed = {};
        (rows || []).forEach((it) => {
          const slug = it.item_slug || it.storage_item_slug;
          const n = Number(it.item_count) || 0;
          if (slug && n > 0) seed[slug] = n;
        });
        if (Object.keys(seed).length) setQty(seed);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [fromQuotation]);

  const c = data?.customer;
  const items = data?.items || {};
  const prices = data?.itemPrices || {};
  const hometypes = data?.hometypes || [];
  const isBusiness = c && String(c.is_business_cust) === "1";

  const setItemQty = (slug, n) =>
    setQty((p) => {
      const next = { ...p };
      if (n <= 0) delete next[slug];
      else next[slug] = n;
      return next;
    });

  // Home-size quick pick (1RK / 1BHK / ...): mirrors the legacy
  // get_selected_storage_item_hometype — each item's storage_item_hometype JSON
  // ([{hometype, quantity}]) provides the preset count for that home size.
  const applyHomeSize = (homeType) => {
    const preset = presetForHomeType(items, homeType);
    // Replace the selection with this home size's preset (mirrors the legacy
    // wizard) so switching sizes never leaves leftovers from a previous pick.
    setQty(preset);
    setSearch("");
  };

  // Save the quotation (writes to ss_customer_quotation + items, notifies customer).
  // Field mapping mirrors the legacy step-3 form → add_new_quotation_data.
  const handleSave = async () => {
    if (!pricing || saving) return;
    setConfirmOpen(false);
    setSaving(true);
    setSaveResult(null);
    try {
      const session = getSession();
      const r = await saveQuotation({
        customer_id: id,
        customer_local_city: c.customer_local_city || "",
        hometype: recommended?.ht || "",
        storage_item_slug: Object.keys(qty),
        storage_item_qty: qty,
        // rep-editable charges
        storage_charges: charges.storage,
        total_storage_charges: charges.storage,
        pickup_charges: charges.transport,
        total_pickup_charges: charges.transport,
        stack_barcode_charges: charges.token,
        total_stack_barcode_charges: charges.token,
        // engine breakdown (record-keeping, exactly as the legacy step-3 form posts)
        transport_cost: num(pricing.total_transport_cost),
        lift_cost: num(pricing.total_lift_cost),
        labour_cost: num(pricing.total_labor_cost),
        item_packing_charges: num(pricing.additional_pallet_cost),
        extra_km_charges: num(pricing.extra_km_charges),
        total_distance: num(pricing.input_distance),
        total_pallet: num(pricing.input_pallet),
        coupon_code: pricing.coupon_code || "",
        transport_coupon: pricing.transport_coupon || "",
        created_by: session?.user_id || "",
      });
      if (r?.status === "success" && r?.quotation_id) {
        setSaveResult({ ok: true, quotationId: r.quotation_id });
        setTimeout(() => router.push(`/customer/${id}`), 1600);
      } else {
        setSaveResult({ ok: false, msg: "Save didn't go through. Please try again." });
      }
    } catch {
      setSaveResult({ ok: false, msg: "Couldn't save the quotation. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const selected = useMemo(() => {
    const rows = [];
    let subtotal = 0;
    for (const [slug, n] of Object.entries(qty)) {
      const item = findItem(items, slug);
      const price = num(prices[slug]);
      subtotal += price * n;
      rows.push({ slug, name: itemName(item, slug), type: item?.storage_type_slug, qty: n, price, line: price * n });
    }
    return { rows, subtotal };
  }, [qty, items, prices]);

  const totalUnits = useMemo(() => Object.values(qty).reduce((a, b) => a + b, 0), [qty]);
  const canContinue = totalUnits > 0;

  // Recommended home size: the smallest one whose charge band the running total
  // fits under (price field = band ceiling). Mirrors the legacy wizard's vehicle
  // picker, which sums the ORIGINAL `storage_item_charges` (not the changed/display
  // charge `storage_item_charges_change`) — so a ₹1679 load picks 1BHK even though
  // the displayed storage charge is ₹1452.
  const recommended = useMemo(() => {
    if (totalUnits === 0) return null;
    let basis = 0;
    for (const [slug, n] of Object.entries(qty)) {
      basis += num(findItem(items, slug)?.storage_item_charges) * n;
    }
    // Use the OLD dashboard's exact hardcoded thresholds (not the DB price field,
    // whose 2BHK ceiling is 4500 vs the old 5000) so a newly created quote picks
    // the same home size / vehicle as the old dashboard.
    const HOME_BANDS = { "1rk": 1500, "1bhk": 3000, "2bhk": 5000, "3bhk": 7000, "4bhk": 10000 };
    const bands = hometypes
      .filter((h) => h.home_type)
      .map((h) => ({ ht: h.home_type, price: HOME_BANDS[h.home_type] ?? num(h.price), vehicle: h.vehicle_type }))
      .sort((a, b) => a.price - b.price);
    if (bands.length === 0) return null;
    return bands.find((b) => basis <= b.price) || bands[bands.length - 1];
  }, [hometypes, qty, items, totalUnits]);

  // When a search term is present we ignore the active tab and match items
  // across every storage type (by display name or slug).
  const searching = search.trim().length > 0;
  const visibleItems = useMemo(() => {
    const all = Object.values(items).flat();
    if (!searching) return all;
    const q = search.trim().toLowerCase();
    return all.filter((it) => {
      const slug = it.storage_item_slug || "";
      return itemName(it, slug).toLowerCase().includes(q) || slug.toLowerCase().includes(q);
    });
  }, [searching, search, items]);

  // Live pricing from the ported engine (debounced). Pickup floor/lift come from
  // the customer record and the home type from the auto-recommendation — exactly
  // like the legacy wizard, so step 2 needs no questions.
  useEffect(() => {
    const slugs = Object.keys(qty);
    if (!c || slugs.length === 0) {
      setPricing(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setPricingLoading(true);
      calculateQuotationPricing(
        {
          customer_id: id,
          customer_local_city: c.customer_local_city || "",
          storage_item_slug: slugs,
          storage_item_qty: qty,
          hometype: recommended?.ht || "",
          storage_month: "1",
          pickup_floor: c.pickup_floor || "",
          pickup_lift: c.pickup_lift || "",
          // Needed for the distance → transport calc; engine returns 0 km without these.
          pickup_lat: c.pickup_lat || "",
          pickup_lang: c.pickup_lang || "",
        },
        { signal: ctrl.signal }
      )
        .then((r) => setPricing(r?.data || null))
        .catch((e) => {
          if (e?.name !== "AbortError") setPricing(null);
        })
        .finally(() => setPricingLoading(false));
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [qty, recommended, c, id]);

  // Seed editable charge fields whenever the engine returns fresh numbers.
  useEffect(() => {
    if (!pricing) return;
    setCharges({
      storage: Math.round(num(pricing.total_storage_charges)),
      transport: Math.round(num(pricing.total_transport_charges)),
      token: Math.round(num(pricing.stacking_barcode_charges)),
    });
  }, [pricing]);

  const goStep2 = () => {
    if (!canContinue) return;
    setStep(2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goStep1 = () => {
    setStep(1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <a
        href={appHref(`/customer/${id}`)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to customer
      </a>

      {fromQuotation && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" />
          Editing items from <span className="font-semibold">QT{String(fromQuotation).padStart(3, "0")}</span> — saving
          creates a new quotation revision (the original is kept).
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</div>
      )}
      {!data && !error && (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      )}

      {c && (
        <>
          {/* header */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <div className="relative z-10 flex flex-wrap items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-base font-bold text-indigo-700">
                {initials(c.customer_name)}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">New quotation</h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${
                      isBusiness ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"
                    }`}
                  >
                    {isBusiness ? <Building2 className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
                    {isBusiness ? "Business" : "Household"}
                  </span>
                </div>
                <div className="mt-0.5 text-sm text-slate-500">
                  {c.customer_name} · {c.customer_unique_id || `ID ${c.customer_id}`} ·{" "}
                  <span className="capitalize">{c.customer_local_city || "—"}</span>
                </div>
              </div>
            </div>
            <HeaderArt />
          </div>

          {/* step progress */}
          <StepsBar step={step} canStep2={canContinue} onStep={(n) => (n === 1 ? goStep1() : goStep2())} />

          {/* ---------------- STEP 1: item selection ---------------- */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
              <div className="space-y-4">
                {/* home-size quick pick */}
                {!searching && hometypes.length > 0 && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-800">Quick fill by home size</h2>
                      {totalUnits > 0 && (
                        <button
                          onClick={() => setQty({})}
                          className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {hometypes.map((h) => {
                        const ht = h.home_type;
                        if (!ht) return null;
                        // Highlight the size the current load fits under (by charges),
                        // exactly like the legacy wizard — updates live as items change.
                        const on = recommended?.ht === ht;
                        return (
                          <button
                            key={ht}
                            onClick={() => applyHomeSize(ht)}
                            className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3.5 text-center transition-all ${
                              on
                                ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600"
                                : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm"
                            }`}
                          >
                            <span
                              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                                on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              <Truck className="h-5 w-5" />
                            </span>
                            <span className="text-sm font-bold uppercase text-slate-800">{ht}</span>
                            {h.vehicle_type && <span className="text-[11px] text-slate-400">{h.vehicle_type}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {recommended ? (
                      <p className="mt-3 text-xs text-slate-500">
                        Your items fit a{" "}
                        <span className="font-bold uppercase text-indigo-600">{recommended.ht}</span>
                        {recommended.vehicle ? <span className="text-slate-400"> · {String(recommended.vehicle).trim()}</span> : null}
                      </p>
                    ) : (
                      <p className="mt-3 text-xs text-slate-400">
                        Tap a size to quick-fill, or add items — we&apos;ll highlight the vehicle that fits.
                      </p>
                    )}
                  </div>
                )}

                {/* items card */}
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  {/* search */}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search item name…"
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    {searching && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        title="Clear"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* result count */}
                  <div className="mt-4 flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm">
                    <Package className="h-4 w-4 text-indigo-500" />
                    <span className="font-semibold text-slate-700">
                      {visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}
                      {searching ? " found" : ""}
                    </span>
                  </div>

                  {/* items */}
                  <div className="divide-y divide-slate-100">
                    {visibleItems.map((it) => {
                      const slug = it.storage_item_slug;
                      const n = qty[slug] || 0;
                      const { Icon, tone } = iconForItem(itemName(it, slug));
                      return (
                        <div key={slug} className="flex items-center gap-3 py-3">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.bg} ${tone.text}`}>
                            <Icon className="h-5 w-5" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold capitalize text-slate-800">
                                {itemName(it, slug)}
                              </span>
                              {it.storage_type_slug && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-slate-500">
                                  {prettyWords(it.storage_type_slug)}
                                </span>
                              )}
                            </div>
                          </div>
                          <Stepper value={n} onChange={(v) => setItemQty(slug, v)} />
                        </div>
                      );
                    })}
                    {visibleItems.length === 0 && (
                      <div className="py-12 text-center text-sm text-slate-400">
                        {searching ? `No items match “${search.trim()}”.` : "No items for this storage type."}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* cart */}
              <div>
                <div className="sticky top-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-indigo-500" />
                    <h2 className="text-base font-bold text-slate-800">Selected items</h2>
                    {totalUnits > 0 && (
                      <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                        {totalUnits}
                      </span>
                    )}
                  </div>

                  {selected.rows.length === 0 ? (
                    <div className="mt-4 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 px-4 py-8 text-center">
                      <img
                        src="/selected_items_box_icon.png"
                        alt=""
                        aria-hidden="true"
                        className="h-24 w-auto select-none object-contain"
                      />
                      <p className="mt-3 text-sm font-semibold text-slate-700">No items selected yet</p>
                      <p className="mt-1 text-xs text-slate-400">Pick items from the list to build the quote.</p>
                    </div>
                  ) : (
                    <ul className="mt-3 max-h-[42vh] space-y-1 overflow-y-auto">
                      {selected.rows.map((r) => {
                        const { Icon: RIcon, tone } = iconForItem(r.name);
                        return (
                        <li key={r.slug} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}>
                            <RIcon className="h-4 w-4" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm capitalize text-slate-700">{r.name}</span>
                          <Stepper value={r.qty} onChange={(v) => setItemQty(r.slug, v)} compact />
                          <button
                            onClick={() => setItemQty(r.slug, 0)}
                            className="text-slate-300 hover:text-rose-500"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                        Est. storage charges
                        <span title="Indicative storage charge. Transport, labour & GST are added in the next step.">
                          <Info className="h-3.5 w-3.5 text-slate-400" />
                        </span>
                      </span>
                      <span className="text-xl font-bold text-slate-900">{rupee(selected.subtotal)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">Transport, labour &amp; GST will be added in the next step.</p>
                  </div>

                  <button
                    onClick={goStep2}
                    disabled={!canContinue}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue to pickup &amp; pricing <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- STEP 2: charges (no questions, like legacy) ---------------- */}
          {step === 2 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
              {/* quotation item list */}
              <div>
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-indigo-500" />
                      <h2 className="text-base font-bold text-slate-800">Quotation item list</h2>
                    </div>
                    <button onClick={goStep1} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      Edit items
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-y border-slate-100 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <span>Item name</span>
                    <span>Qty</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {selected.rows.map((r) => {
                      const { Icon, tone } = iconForItem(r.name);
                      return (
                        <li key={r.slug} className="flex items-center gap-3 py-2.5 text-sm">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}>
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1 truncate capitalize text-slate-700">{r.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-700">{r.qty}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                    <span className="font-semibold text-slate-600">Total distance</span>
                    <span className="font-semibold tabular-nums text-slate-800">
                      {pricing ? `${num(pricing.input_distance)} km` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* charges */}
              <div>
                <div className="sticky top-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-base font-bold text-slate-800">Charges</h2>

                  {!pricing ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> Calculating charges…
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <ChargeField
                        label="Storage charges"
                        value={charges.storage}
                        onChange={(v) => setCharges((c) => ({ ...c, storage: v }))}
                      />
                      <ChargeField
                        label="Transport charges"
                        value={charges.transport}
                        onChange={(v) => setCharges((c) => ({ ...c, transport: v }))}
                      />
                      <ChargeField
                        label="Warehouse arrival token charges"
                        value={charges.token}
                        onChange={(v) => setCharges((c) => ({ ...c, token: v }))}
                      />

                      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                        <span className="text-sm font-semibold text-slate-600">Total (pre-GST)</span>
                        <span className="text-xl font-bold text-slate-900">
                          {rupee(charges.storage + charges.transport + charges.token)}
                        </span>
                      </div>

                      {(pricing.coupon_code || pricing.transport_coupon) && (
                        <div className="text-[11px] text-slate-400">
                          {pricing.coupon_code} · {pricing.transport_coupon}
                        </div>
                      )}
                    </div>
                  )}

                  {saveResult?.ok ? (
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Quotation #{saveResult.quotationId} created — opening customer…
                    </div>
                  ) : (
                    <>
                      {saveResult?.ok === false && (
                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                          {saveResult.msg}
                        </div>
                      )}
                      <div className="mt-5 flex items-center gap-2">
                        <button
                          onClick={goStep1}
                          disabled={saving}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <ChevronLeft className="h-4 w-4" /> Back to items
                        </button>
                        <button
                          onClick={() => setConfirmOpen(true)}
                          disabled={!pricing || saving}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                            </>
                          ) : (
                            <>
                              Proceed <ArrowRight className="h-4 w-4" />
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* confirm-save modal */}
          <ConfirmSaveModal
            open={confirmOpen}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={handleSave}
            customerName={c.customer_name}
            total={charges.storage + charges.transport + charges.token}
          />

          {/* footer */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <ShieldCheck className="h-4 w-4" /> Your data is secure and encrypted
            </span>
            <span className="text-slate-400">
              Need help? <span className="font-semibold text-indigo-600">Contact support</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- header art ----------------------------- */
function HeaderArt() {
  // Decorative storage illustration, hidden on small screens.
  return (
    <img
      src="/storage_illustration.png"
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute right-4 top-1/2 hidden h-[88%] w-auto -translate-y-1/2 select-none object-contain md:block"
    />
  );
}

/* ----------------------------- confirm modal ----------------------------- */
function ConfirmSaveModal({ open, onCancel, onConfirm, customerName, total }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "popIn .18s ease-out" }}
      >
        <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
            <FileText className="h-7 w-7" />
          </span>
          <h3 className="mt-4 text-lg font-bold text-slate-900">Create this quotation?</h3>
          <p className="mt-1 text-sm text-slate-500">
            For <span className="font-semibold text-slate-700">{customerName}</span> · total{" "}
            <span className="font-semibold text-slate-700">{rupee(total)}</span> (pre-GST).
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>It will be saved and the customer may be emailed / SMSed the quote.</span>
          </div>
        </div>
        <div className="flex gap-2 p-5">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700"
          >
            Yes, create
          </button>
        </div>
      </div>
      <style jsx>{`
        @keyframes popIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(6px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

/* ----------------------------- steps ----------------------------- */
function StepsBar({ step, canStep2, onStep }) {
  return (
    <div className="my-6 flex items-center">
      <StepDot n={1} label="Select items" active={step === 1} done={step > 1} clickable onClick={() => onStep(1)} />
      <div className={`mx-3 h-0.5 flex-1 rounded-full ${step > 1 ? "bg-indigo-600" : "bg-slate-200"}`} />
      <StepDot
        n={2}
        label="Pickup & pricing"
        active={step === 2}
        done={false}
        clickable={canStep2}
        onClick={() => canStep2 && onStep(2)}
      />
    </div>
  );
}

function StepDot({ n, label, active, done, clickable, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`flex items-center gap-2.5 ${clickable ? "cursor-pointer" : "cursor-default"}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
          active || done ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-400"
        }`}
      >
        {n}
      </span>
      <span className={`text-sm font-semibold ${active ? "text-slate-900" : done ? "text-slate-700" : "text-slate-400"}`}>
        {label}
      </span>
    </button>
  );
}

/* ----------------------------- bits ----------------------------- */
function Stepper({ value, onChange, compact }) {
  const sz = compact ? "h-7 w-7" : "h-9 w-9";
  const icon = compact ? "h-3 w-3" : "h-4 w-4";
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        className={`flex ${sz} items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 disabled:opacity-40`}
      >
        <Minus className={icon} />
      </button>
      <span className={`${compact ? "w-5" : "w-7"} text-center text-sm font-bold tabular-nums text-slate-800`}>
        {value}
      </span>
      <button
        onClick={() => onChange(value + 1)}
        className={`flex ${sz} items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 transition-colors hover:bg-indigo-100`}
      >
        <Plus className={icon} />
      </button>
    </div>
  );
}

function ChargeField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className="w-full rounded-xl border border-slate-200 py-2.5 pl-7 pr-3 text-sm font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
    </div>
  );
}

/* --------------- item → colored icon (keyword match, first wins) --------------- */
// Static class pairs so Tailwind keeps them (no dynamic `bg-${x}` strings).
const TONES = {
  violet: { text: "text-violet-500", bg: "bg-violet-50" },
  indigo: { text: "text-indigo-500", bg: "bg-indigo-50" },
  sky: { text: "text-sky-500", bg: "bg-sky-50" },
  blue: { text: "text-blue-500", bg: "bg-blue-50" },
  cyan: { text: "text-cyan-500", bg: "bg-cyan-50" },
  teal: { text: "text-teal-500", bg: "bg-teal-50" },
  emerald: { text: "text-emerald-500", bg: "bg-emerald-50" },
  green: { text: "text-green-600", bg: "bg-green-50" },
  lime: { text: "text-lime-600", bg: "bg-lime-50" },
  amber: { text: "text-amber-500", bg: "bg-amber-50" },
  orange: { text: "text-orange-500", bg: "bg-orange-50" },
  red: { text: "text-red-500", bg: "bg-red-50" },
  rose: { text: "text-rose-500", bg: "bg-rose-50" },
  pink: { text: "text-pink-500", bg: "bg-pink-50" },
  fuchsia: { text: "text-fuchsia-500", bg: "bg-fuchsia-50" },
  purple: { text: "text-purple-500", bg: "bg-purple-50" },
  slate: { text: "text-slate-400", bg: "bg-slate-100" },
};

const ITEM_ICONS = [
  // pets & aquatic (before "tree"/"table" so "cat tree" → Cat)
  [["aquarium", "fish tank", "fish"], Fish, "cyan"],
  [["dog", "kennel"], Dog, "amber"],
  [["cat tree", "cat "], Cat, "amber"],
  [["bird", "parrot", "pigeon"], Bird, "teal"],
  // kids
  [["baby", "pram", "stroller", "crib", "cradle", "kids", "toy"], Baby, "pink"],
  // seating (before bag/table)
  [["sofa", "couch", "settee", "divan", "recliner"], Sofa, "violet"],
  [["arm chair", "armchair", "bean bag", "beanbag", "chair", "stool", "bench"], Armchair, "violet"],
  // beds
  [["mattress", "matress", "bunker", "bunk bed", "bed", "cot"], BedDouble, "indigo"],
  // storage furniture
  [["wardrobe", "almirah", "cupboard", "cabinet", "dresser", "drawer", "locker"], Archive, "amber"],
  [["bookshelf", "book shelf", "bookcase", "shelf", "rack", "library"], LibraryBig, "orange"],
  // tables (catches "computer/coffee/dining/console table")
  [["table", "desk", "counter"], Table, "amber"],
  // large appliances
  [["refrigerator", "fridge"], Refrigerator, "sky"],
  [["washing machine", "washer", "dryer"], WashingMachine, "cyan"],
  [["microwave", "oven", "otg", "toaster"], Microwave, "rose"],
  [["chimney", "exhaust", "air purifier", "purifier", "cooler", "fan"], Fan, "teal"],
  [["heater", "geyser"], Heater, "orange"],
  [["air fryer", "fryer", "induction", "stove", "gas ", "cooking", "steamer", "chakki", "cook"], CookingPot, "red"],
  [["coffee machine", "coffee maker", "espresso"], Coffee, "amber"],
  // electronics
  [["television", "tv", "crt"], Tv, "blue"],
  [["monitor", "screen", "display"], Monitor, "blue"],
  [["laptop", "macbook", "notebook"], Laptop, "slate"],
  [["cpu", "desktop", "computer", "server"], Cpu, "slate"],
  [["printer", "scanner", "xerox"], Printer, "slate"],
  [["projector"], Projector, "blue"],
  [["camera"], Camera, "purple"],
  [["amplifier", "speaker", "woofer", "home theatre", "home theater", "sound"], Speaker, "purple"],
  [["radio"], Radio, "purple"],
  // music
  [["drum", "cajon", "tabla", "dhol", "percussion"], Drum, "fuchsia"],
  [["guitar", "ukulele"], Guitar, "fuchsia"],
  [["piano", "keyboard", "harmonium", "synth"], Piano, "fuchsia"],
  [["mic", "microphone"], Mic, "fuchsia"],
  [["violin", "veena", "flute", "instrument", "music"], Music, "fuchsia"],
  // fitness & sports
  [["treadmill", "gym", "dumbbell", "weight", "exercise", "elliptical", "massager", "massage"], Dumbbell, "emerald"],
  [["cricket", "bat ", "badminton", "archery", "boxing", "carrom", "tennis", "football", "skate", "hockey", "golf", "ball"], Volleyball, "green"],
  [["bicycle", "bike", "cycle", "scooter"], Bike, "lime"],
  [["car ", "car-", "motor car"], Car, "blue"], // narrow so "cart"/"carpet"/"carton" don't match
  [["gamepad", "gaming", "playstation", "xbox"], Gamepad2, "indigo"],
  // kitchen & bar
  [["plate", "pot", "vessel", "utensil", "kadai", "cooker", "tiffin", "crockery", "brass"], Utensils, "orange"],
  [["wine", "bar "], Wine, "rose"],
  // textiles & clothing
  [["cloth", "blanket", "curtain", "carpet", "rug", "quilt", "linen", "towel", "saree", "dress", "shirt"], Shirt, "cyan"],
  // lighting & decor
  [["chandelier", "chandler", "lamp", "lantern", "light"], Lamp, "amber"],
  [["clock"], Clock, "slate"],
  [["painting", "photo", "mirror", "frame", "portrait", "statue", "idol", "buddha", "sculpture", "carved"], Frame, "violet"],
  // plants
  [["christmas tree"], TreePine, "green"],
  [["plant", "bonsai", "sapling", "bamboo", "tree"], Sprout, "emerald"],
  // luggage, bags, boxes
  [["suitcase", "luggage", "trolley bag"], Luggage, "indigo"],
  [["backpack", "handbag", "gunny", "sack", "bag"], Briefcase, "amber"],
  [["box", "crate", "carton", "trunk", "container"], Box, "amber"],
  // tools
  [["drill", "hammer", "ladder", "spanner", "tool kit", "toolkit"], Wrench, "slate"],
  [["paint", "brush", "roller"], Paintbrush, "pink"],
  // misc
  [["umbrella"], Umbrella, "indigo"],
  [["tent", "swing", "gazebo"], Tent, "green"],
];
function iconForItem(name) {
  const s = String(name || "").toLowerCase();
  for (const [keys, Icon, tone] of ITEM_ICONS) {
    if (keys.some((k) => s.includes(k))) return { Icon, tone: TONES[tone] };
  }
  return { Icon: Package, tone: TONES.slate };
}

/* ----------------------------- helpers ----------------------------- */
function findItem(items, slug) {
  for (const list of Object.values(items)) {
    const hit = list.find((i) => i.storage_item_slug === slug);
    if (hit) return hit;
  }
  return null;
}
// Build { slug: quantity } for a home size from each item's storage_item_hometype
// JSON, e.g. [{"hometype":"1rk","quantity":2}, ...]. Verbatim logic of the
// legacy get_selected_storage_item_hometype.
function presetForHomeType(items, homeType) {
  const out = {};
  const target = String(homeType).trim();
  for (const list of Object.values(items)) {
    for (const it of list) {
      const raw = it?.storage_item_hometype;
      if (!raw) continue;
      let arr;
      try {
        arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (e && String(e.hometype ?? "").trim() === target) {
          const q = Number(e.quantity) || 0;
          if (q > 0) out[it.storage_item_slug] = q;
        }
      }
    }
  }
  return out;
}
function itemName(it, slug) {
  return it?.storage_item_name || it?.item_name || prettyWords(slug);
}
function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function rupee(n) {
  return "₹" + num(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function initials(name) {
  return String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function prettyWords(s) {
  if (!s) return "";
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
