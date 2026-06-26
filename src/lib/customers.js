// Manage Customers — server-side list backed by agentic_crm/get_customers_list,
// which reuses the legacy customer_model->get_datatable_list/count_filtered/count_all
// (the exact same methods that power customer/view).

import { apiGet, apiPostForm } from "./api";

const MOD = "agentic_crm";

// Paginated/filtered customer list. `params`:
//   start, length, search, customer_type, city, status, crmuser_id, follow_up,
//   user_id (created-by), warehouse_id, is_active_reminder, search_date
export async function fetchCustomers(params = {}, { signal } = {}) {
  const p = await apiPostForm(
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

// Filter options (cities + CRM users) for the dropdowns.
export async function fetchCustomerFilters({ signal } = {}) {
  const p = await apiGet("get_customer_list_filters", { signal, module: MOD });
  return p?.data || { cities: [], crm_users: [] };
}
