// RNR auto-reassignment client.
// Backend lives in the report_analysis module:
//   process_rnr_reassignments  — moves customers stuck in RNR > N days
//   get_rnr_transfer_history    — full from->to trail for one customer
//   get_rnr_transfers           — all transfers (optionally filtered)

import { apiGet, toList } from "./api";

// All RNR endpoints live in the agentic_crm module.
const MOD = "agentic_crm";

// Trigger a team-wide reassignment sweep (normally the CRM load hits this once
// a day). Candidates can be selected by RNR age (`days`) or — since rnr_since is
// never populated — by RNR attempts logged in the note trail (`minAttempts`).
// Unknown params are ignored server-side, so passing minAttempts is safe even
// before the backend honours it.
export async function processReassignments({ days, minAttempts, signal } = {}) {
  const params = new URLSearchParams();
  if (days != null) params.set("days", days);
  if (minAttempts != null) params.set("min_attempts", minAttempts);
  const qs = params.toString();
  return apiGet(`process_rnr_reassignments${qs ? `?${qs}` : ""}`, { signal, module: MOD });
}

// The from->to transfer trail for a single customer, oldest first.
export async function fetchTransferHistory(customerId, { signal } = {}) {
  if (!customerId) return [];
  const payload = await apiGet(
    `get_rnr_transfer_history?customer_id=${encodeURIComponent(customerId)}`,
    { signal, module: MOD }
  );
  return toList(payload).map(normalizeTransfer);
}

// All transfers, optionally filtered by user (either side) and date window.
export async function fetchTransfers({ userId, fromDate, toDate, signal } = {}) {
  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  const q = params.toString();
  const payload = await apiGet(`get_rnr_transfers${q ? `?${q}` : ""}`, { signal, module: MOD });
  return toList(payload).map(normalizeTransfer);
}

function normalizeTransfer(t) {
  return {
    id: t.id,
    customerId: t.customer_id,
    customerName: t.customer_name || "",
    fromUserId: t.from_user_id,
    fromName: t.from_user_name || `User ${t.from_user_id}`,
    toUserId: t.to_user_id,
    toName: t.to_user_name || `User ${t.to_user_id}`,
    reason: t.reason || "",
    rnrSince: t.rnr_since || null,
    rnrDays: t.rnr_days != null ? Number(t.rnr_days) : null,
    seq: t.transfer_seq != null ? Number(t.transfer_seq) : null,
    note: t.note || "",
    createdAt: t.created_at || null,
  };
}
