// Customer details + quotations for the details popup.
// Backed by report_analysis/get_customer_full_details?customer_id=...

import { apiGet, apiPostForm, apiPostNested, endpoint } from "./api";

// Customer 360 endpoints live in the agentic_crm module.
const MOD = "agentic_crm";

export async function fetchCustomerDetails(customerId, { signal } = {}) {
  const payload = await apiGet(
    `get_customer_full_details?customer_id=${encodeURIComponent(customerId)}`,
    { signal, module: MOD }
  );
  const data = payload?.data || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    customer: data.customer || null,
    quotations: arr(data.quotations),
    transactions: arr(data.transactions),
    payments: arr(data.payments),
    inventory: arr(data.inventory),
    notes: arr(data.notes),
    accountSummary: arr(data.account_summary),
    orders: arr(data.orders),
  };
}

// Extra customer-details sections (account login, next-billing, work orders,
// retrieval summary + log, documents) — port of the legacy customer/customer_details
// page tabs the customer-360 endpoint doesn't include.
export async function fetchCustomerDetailsExtra(customerId, { signal } = {}) {
  const p = await apiGet(`get_customer_details_extra?customer_id=${encodeURIComponent(customerId)}`, {
    signal,
    module: MOD,
  });
  return p?.data || null;
}

// Inventory items of a single quotation (eye / chart popup).
export async function fetchQuotationItems(quotationId, { signal } = {}) {
  const p = await apiGet(`get_quotation_items?quotation_id=${encodeURIComponent(quotationId)}`, {
    signal,
    module: MOD,
  });
  return Array.isArray(p?.data) ? p.data : [];
}

// Full quotation edit data (customer_detailsnew pricing): quotation row, customer,
// items, coupon lists, home types.
export async function fetchQuotationEditData(quotationId, { signal } = {}) {
  const p = await apiGet(`get_quotation_edit_data?quotation_id=${encodeURIComponent(quotationId)}`, {
    signal,
    module: MOD,
  });
  return p?.data || null;
}

// Save the quotation pricing (port of customer/savedata_new_q).
export async function saveQuotationData(fields, { signal } = {}) {
  return apiPostForm("save_quotation_data", fields, { signal, module: MOD });
}

// Update the customer's account email (port of customer/update_account_info).
export async function updateAccountInfo(customerId, email, { signal } = {}) {
  return apiPostForm("update_account_info", { customer_id: customerId, email }, { signal, module: MOD });
}

// Save the per-work-order customer note (Work orders → Add Notes). Mirrors the
// legacy customer/save_customer_note — updates ss_order.customer_notes + logs it.
export async function saveOrderNote({ orderId, notes, createdBy }, { signal } = {}) {
  return apiPostForm(
    "save_customer_note",
    { order_id: orderId, notes, created_by: createdBy || "" },
    { signal, module: MOD }
  );
}

// Work-order edit form data (port of customer/edit_work_order GET): the order
// row + city-scoped manager / supervisor / warehouse / order-type / vendor lists.
export async function fetchWorkOrderEditData({ customerId, orderId }, { signal } = {}) {
  const p = await apiGet(
    `get_work_order_edit_data?customer_id=${encodeURIComponent(customerId)}&order_id=${encodeURIComponent(orderId)}`,
    { signal, module: MOD }
  );
  return p?.data || null;
}

// POST form fields to an agentic_crm endpoint that echoes PLAIN TEXT (e.g.
// "success") rather than JSON. Returns the trimmed response text.
async function postText(path, fields, { signal } = {}) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.append(k, v);
  });
  const res = await fetch(endpoint(path, MOD), {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.text()).trim();
}

// Save an edited work order — re-dispatches to the EXACT legacy
// customer/add_work_order, which echoes the plain text "success" (not JSON).
// `fields` mirrors the legacy form post (see get_work_order_edit_data doc).
export async function saveWorkOrder(fields, { signal } = {}) {
  return postText("save_work_order", fields, { signal });
}

// Delete a work order (re-dispatch to order/delete_work_order). -> "success"
export async function deleteWorkOrder({ orderId, createdBy }, { signal } = {}) {
  return postText("delete_work_order", { order_id: orderId, created_by: createdBy || "" }, { signal });
}

// Change a work order's status ("pending" = Mark Booked, "scheduled"). -> "success"
export async function markOrderStatus({ orderId, status }, { signal } = {}) {
  return postText("mark_order_status", { order_id: orderId, order_status: status }, { signal });
}

// Reschedule modal data (order + customer + quotation charges + per-pallet vendors).
export async function fetchWorkOrderRescheduleData(orderId, { signal } = {}) {
  const p = await apiGet(`get_work_order_reschedule_data?order_id=${encodeURIComponent(orderId)}`, { signal, module: MOD });
  return p?.data || null;
}

// Save a reschedule — re-dispatches to the EXACT legacy order/add_reschedule_data
// (new date, prorated charges/payments, transactions, e-mails). -> "success"|"exist"
export async function saveWorkOrderReschedule(fields, { signal } = {}) {
  return postText("save_work_order_reschedule", fields, { signal });
}

// Quotation vs warehouse comparison (items, charges, increased/decreased diffs).
export async function fetchQuoteVsWarehouse(quotationId, { signal } = {}) {
  const p = await apiGet(`get_both_quotation_order_items?quotation_id=${encodeURIComponent(quotationId)}`, {
    signal,
    module: MOD,
  });
  return p?.data || null;
}

// Delete a quotation (and its items). Mirrors customer/delete_quotation_data.
export async function deleteQuotation(quotationId, customerId, { signal } = {}) {
  return apiPostForm(
    "delete_quotation",
    { quotation_id: quotationId, customer_id: customerId },
    { signal, module: MOD }
  );
}

// Save editable customer profile fields. `fields` is a flat { column: value } map.
export async function updateCustomerDetails(customerId, fields, { signal } = {}) {
  return apiPostForm(
    "update_customer_details",
    { customer_id: customerId, ...fields },
    { signal, module: MOD }
  );
}

// Run the (ported) pricing engine — exact charges from your existing prices.
// `fields` mirrors what the legacy wizard posts (storage_item_slug[], qty map,
// city, hometype, floor, lift, months...). Returns { status, data: {...charges} }.
export async function calculateQuotationPricing(fields, { signal } = {}) {
  return apiPostNested("get_data_for_step3", fields, { signal, module: MOD });
}

// Persist the quotation. `fields` mirrors what the legacy step-3 form posts
// (charges, item slugs + qty map, hometype, distance, coupons, created_by).
// Returns { status, customer_id, quotation_id }.
export async function saveQuotation(fields, { signal } = {}) {
  return apiPostNested("add_new_quotation_data", fields, { signal, module: MOD });
}

// Edit-items recalculation — port of the legacy customer/get_edit_quotation_for_modal
// (the "Edit" button on customer_detailsnew). This is the ONLY faithful charge path
// for editing a quotation's items (it applies the pallet surcharge, reads floor/lift
// from the quotation row, and brackets hometype from storage_item_charges_change).
//
// previewEditQuotation: compute charges WITHOUT writing (live display).
// `fields`: { customer_id, q_id, storage_item_slug[], storage_item_qty{}, hometype }
export async function previewEditQuotation(fields, { signal } = {}) {
  return apiPostNested("edit_quotation_for_modal", { ...fields, preview: 1 }, { signal, module: MOD });
}

// saveEditQuotation: create a new quotation revision (+ items + price history) from
// the edited items, exactly like the legacy modal. Returns { status, quotation_id }.
export async function saveEditQuotation(fields, { signal } = {}) {
  return apiPostNested("edit_quotation_for_modal", fields, { signal, module: MOD });
}

// ---------------------------------------------------------------------------
// Schedule / Confirm pickup — bridges to the legacy customer/schedule_pickup flow
// (re-dispatched through agentic_crm to the exact public auth endpoints).
// ---------------------------------------------------------------------------

// Page data for the schedule-pickup form (customer, quotation, timeslots, floors,
// cities, vendors, token advance, disabled-date arrays, is_new_quotation).
export async function fetchSchedulePickupData(quotationId, { signal } = {}) {
  const p = await apiGet(`get_schedule_pickup_data?quotation_id=${encodeURIComponent(quotationId)}`, {
    signal,
    module: MOD,
  });
  if (p?.status !== "success") {
    const err = new Error(p?.message || "schedule_pickup_unavailable");
    err.code = p?.message;
    throw err;
  }
  return p.data;
}

// Fully-booked dates for the datepicker (fetched separately so the form renders
// instantly — the legacy helpers loop 90 days with per-day DB queries).
// Returns { disabled_date_arr, arrival_disabled_date_arr } (yyyy-mm-dd strings).
export async function fetchPickupDisabledDates(quotationId, { signal } = {}) {
  const p = await apiGet(`get_pickup_disabled_dates?quotation_id=${encodeURIComponent(quotationId)}`, {
    signal,
    module: MOD,
  });
  return p?.data || { disabled_date_arr: [], arrival_disabled_date_arr: [] };
}

// Available timeslots for a date (port of auth/get_available_slots).
// Returns { info: "<option>…</option>", is_empty_slot: "yes"|"no" }.
export async function fetchPickupSlots(fields, { signal } = {}) {
  return apiPostForm("get_pickup_slots", fields, { signal, module: MOD });
}

// Confirm pickup — multipart POST (carries the optional transaction_image file)
// to the exact production save. Returns the raw response text ("success" on ok).
export async function confirmPickup(formData, { signal } = {}) {
  const res = await fetch(endpoint("confirm_pickup", MOD), {
    method: "POST",
    mode: "cors",
    body: formData, // FormData -> multipart/form-data, no preflight
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.text()).trim();
}

// Create a new customer from scratch (port of customer/add_customer_step_form's
// customer-creation half). Returns { status, customer_id }. status 'exist' means
// a customer with that email/contact already exists (customer_id returned).
export async function createCustomer(fields, { signal } = {}) {
  return apiPostForm("create_customer", fields, { signal, module: MOD });
}

// Everything the new-quotation builder needs (customer, storage items, home types).
export async function fetchQuotationFormData(customerId, { signal } = {}) {
  const p = await apiGet(`get_quotation_form_data?customer_id=${encodeURIComponent(customerId)}`, {
    signal,
    module: MOD,
  });
  const d = p?.data || {};
  return {
    customer: d.customer || null,
    customerStorageType: Array.isArray(d.customer_storage_type) ? d.customer_storage_type : [],
    items: d.items || {}, // { storage_type_slug: [item, ...] }
    itemPrices: d.item_prices || {},
    hometypes: Array.isArray(d.hometypes) ? d.hometypes : [],
  };
}
