// Manage Customers — server-side list backed by agentic_crm/get_customers_list,
// which reuses the legacy customer_model->get_datatable_list/count_filtered/count_all
// (the exact same methods that power customer/view).

import { apiGet, apiGetForm, apiPostForm } from "./api";

const MOD = "agentic_crm";

// Nearest warehouse origin for a city → used to compute pickup-distance/intercity.
// Returns { status, origin, warehouse_id, warehouse_name }.
export async function fetchWarehouseForDistance(citySlug, { signal } = {}) {
  return apiPostForm("get_warehouse_for_distance", { customer_local_city: citySlug }, { signal, module: MOD });
}

// Paginated/filtered customer list. `params`:
//   start, length, search, customer_type, city, status, crmuser_id, follow_up,
//   user_id (created-by), warehouse_id, is_active_reminder, search_date
export async function fetchCustomers(params = {}, { signal } = {}) {
  const p = await apiGetForm(
    "get_customers_list",
    {
      length: params.length ?? 25,
      start: params.start ?? 0,
      search_value: params.search ?? "",
      customer_type: params.customer_type ?? "active_customer",
      status: params.status ?? "",
      customer_local_city: params.city ?? "",
      crmuser_id: params.crmuser_id ?? "",
      follow_up: params.follow_up ?? "",
      user_id: params.user_id ?? "",
      warehouse_id: params.warehouse_id ?? "",
      is_active_reminder: params.is_active_reminder ?? "",
      search_date: params.search_date ?? "",
    },
    { signal, module: MOD }
  );
  return {
    rows: Array.isArray(p?.data) ? p.data : [],
    total: Number(p?.recordsTotal) || 0,
    filtered: Number(p?.recordsFiltered) || 0,
  };
}

// Filter options (cities + CRM users + warehouses) for the dropdowns. The
// "Created by" users list is NOT here — it's ~40k rows, so it's searched on
// demand via searchCustomerCreators() instead (keeps this payload ~16KB).
export async function fetchCustomerFilters({ signal } = {}) {
  const p = await apiGet("get_customer_list_filters", { signal, module: MOD });
  return p?.data || { cities: [], crm_users: [] };
}

// Type-ahead search for the "Created by" filter, backed by agentic_crm/search_users.
// Pass { q } to search by name/id, or { ids } to resolve specific ids to names
// (so a pre-selected filter can show its label). Returns [{ value, label }].
export async function searchCustomerCreators({ q = "", ids = null, limit = 30, signal } = {}) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (ids && ids.length) p.set("ids", ids.join(","));
  if (limit) p.set("limit", limit);
  const qs = p.toString();
  const res = await apiGet(`search_users${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((u) => ({
    value: String(u.user_id),
    label: `${u.user_fname || ""} ${u.user_lname || ""}`.trim() || `User ${u.user_id}`,
  }));
}

// Lightweight follow-up save for a customer row — updates only follow_up,
// follow_up_date and (appends) follow_up_note. Backed by agentic_crm/update_customer_follow_up,
// which won't clobber pipeline_stage / contact_method. Returns true on success.
export async function updateCustomerFollowUp(
  { customerId, followUp, followUpDate, followUpNote },
  { signal } = {}
) {
  const fields = { customer_id: customerId };
  if (followUp != null) fields.follow_up = followUp;
  if (followUpDate != null) fields.follow_up_date = followUpDate;
  if (followUpNote != null) fields.follow_up_note = followUpNote;
  const res = await apiPostForm("update_customer_follow_up", fields, { signal, module: MOD });
  return res?.status === "success" || res?.status === true;
}
