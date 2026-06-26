// End-to-end activity logger. Fire-and-forget POST to the backend audit log.
// Auto-captured by the app layout (page views + action clicks) and called
// explicitly for login/logout. Never throws — logging must not break the app.
import { apiGet, apiPostForm } from "./api";
import { getSession } from "./auth";

const MOD = "agentic_crm";

// Per-rep productivity summary for a day: calls / WhatsApp / customer opens +
// active window and idle ("time wasted") minutes.
export async function fetchActivitySummary({ date, userId, signal } = {}) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (userId != null && userId !== "") params.set("user_id", userId);
  const qs = params.toString();
  const res = await apiGet(`get_activity_summary${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return res?.data || [];
}

// Read the activity log, newest first. Filters: userId, type, date, q, limit.
export async function fetchActivityLogs({ userId, type, date, q, limit, signal } = {}) {
  const params = new URLSearchParams();
  if (userId != null && userId !== "") params.set("user_id", userId);
  if (type) params.set("type", type);
  if (date) params.set("date", date);
  if (q) params.set("q", q);
  if (limit != null) params.set("limit", limit);
  const qs = params.toString();
  const res = await apiGet(`get_activity_logs${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return res?.data || [];
}

export function logEvent(eventType, detail = "", meta = {}) {
  if (typeof window === "undefined") return;
  try {
    const s = getSession();
    const fields = {
      user_id: s?.user_id ?? "",
      user_name: s?.user_fname ?? "",
      event_type: String(eventType).slice(0, 40),
      detail: String(detail || "").slice(0, 255),
      page: window.location.pathname,
      meta: safeJson(meta).slice(0, 500),
    };
    // Prefer sendBeacon for unload-safe events (logout); fall back to fetch.
    apiPostForm("log_activity", fields, { module: MOD }).catch(() => {});
  } catch {
    /* logging is best-effort */
  }
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj || {});
  } catch {
    return "{}";
  }
}
