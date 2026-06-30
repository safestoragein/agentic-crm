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

// Persist a rep's full daily productivity snapshot to ss_crm_productivity_daily.
// Best-effort: nulls become "" so the backend keeps any existing datetime value.
export function saveProductivity(snapshot = {}) {
  if (typeof window === "undefined") return Promise.resolve();
  const fields = {};
  for (const [k, v] of Object.entries(snapshot)) fields[k] = v == null ? "" : String(v);
  return apiPostForm("save_productivity", fields, { module: MOD }).catch(() => {});
}

// Recompute & persist productivity for ALL reps for a day, server-side. Fired
// when a team page (booking-report) loads so the rollup stays fresh for everyone.
export function snapshotAllProductivity({ date } = {}) {
  if (typeof window === "undefined") return Promise.resolve();
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiGet(`snapshot_productivity_all${qs}`, { module: MOD }).catch(() => {});
}

// Stamp the logged-in rep's logout time into the daily rollup at sign-out.
export function saveLogoutTime() {
  if (typeof window === "undefined") return Promise.resolve();
  try {
    const s = getSession();
    if (!s?.user_id) return Promise.resolve();
    const fields = {
      user_id: s.user_id,
      user_name: s.user_fname ?? "",
      work_date: localYmd(),
      logout_at: localDateTime(),
    };
    return apiPostForm("save_logout_time", fields, { module: MOD }).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function localYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateTime(d = new Date()) {
  return `${localYmd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
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
