// Household / business / document leads from ss_leads — replicates the legacy
// customer/server_common_household_lead_list selection as clean JSON.
import { apiGet, apiPostForm, toList } from "./api";

const MOD = "agentic_crm";

// Active CRM users (id + name) — for the transfer-to dropdown.
export async function fetchCrmUsers({ signal } = {}) {
  const res = await apiGet("get_crm_users", { signal, module: MOD });
  return toList(res).map((u) => ({ id: String(u.user_id), name: `${u.user_fname || ""} ${u.user_lname || ""}`.trim() || `User ${u.user_id}` }));
}

// Transfer leads to another rep (replicates customer/transfer_lead_user).
export async function transferLeads({ toUserId, leadIds, signal } = {}) {
  return apiPostForm("transfer_leads", { to_user_id: toUserId, lead_ids: (leadIds || []).join(",") }, { signal, module: MOD });
}

// Create a lead (replicates customer/add_lead_data). name/mobile/email required.
export async function addHouseholdLead({ name, mobile, email, message, storageType, source, userId, signal } = {}) {
  return apiPostForm(
    "add_household_lead",
    {
      customer_name: name,
      customer_mobile_no: mobile,
      customer_email: email,
      customer_message: message || "",
      storage_type: storageType || "",
      source: source || "",
      relationship_manager_id: userId ?? "",
    },
    { signal, module: MOD }
  );
}

export async function fetchHouseholdLeads({ userId, from, to, status, city, storageType, source, followUp, verified, limit, signal } = {}) {
  const p = new URLSearchParams();
  if (userId != null && userId !== "") p.set("user_id", userId);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (status) p.set("status", status);
  if (city) p.set("city", city);
  if (storageType) p.set("storage_type", storageType);
  if (source) p.set("source", source);
  if (followUp) p.set("follow_up", followUp);
  if (verified) p.set("verified", verified);
  if (limit != null) p.set("limit", limit);
  const qs = p.toString();
  const res = await apiGet(`get_household_leads${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return toList(res);
}
