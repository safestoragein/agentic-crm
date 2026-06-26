// Daily follow-up WhatsApp sweep (Interakt). Sends scenario templates
// (quote-discount / callback / RNR) to the right customers, signed with the
// assigned rep's name + number. The backend de-dups so a customer gets at most
// one message every 2 days (any template) — safe to trigger on each load.
// Pass { dryRun: true } to count candidates without sending.
import { apiGet } from "./api";
import { ymd } from "./crm";

const MOD = "agentic_crm";
const SWEEP_KEY = "followupWaDate"; // once-per-day-per-browser guard
const STATS_KEY = "followupWaStats"; // last run result, for the dashboard card

export async function sendFollowupWhatsapp({ dryRun, limit, signal } = {}) {
  const params = new URLSearchParams();
  if (dryRun) params.set("dry_run", "1");
  if (limit != null) params.set("limit", limit);
  const qs = params.toString();
  return apiGet(`send_followup_whatsapp${qs ? `?${qs}` : ""}`, { signal, module: MOD });
}

// Team-wide follow-up WhatsApp stats for a day (default today): sent / delivered
// / read / failed + per-scenario. Reads the ss_crm_followup_whatsapp log.
export async function fetchFollowupWhatsappStats({ date, userId, signal } = {}) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (userId != null) params.set("user_id", userId); // scope to the rep's customers
  const qs = params.toString();
  const res = await apiGet(`get_followup_whatsapp_stats${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return res?.stats || null;
}

// Customers who engaged (delivered / read / replied) with a follow-up, with
// their contact + follow-up data. For the WhatsApp "Engaged" tab.
export async function fetchEngagedWhatsapp({ limit, userId, signal } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", limit);
  if (userId != null) params.set("user_id", userId);
  const qs = params.toString();
  const res = await apiGet(`get_followup_whatsapp_engaged${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return res?.data || [];
}

// Follow-up emails (the fallback sent when a WhatsApp fails), with full status
// detail — sent / delivered / opened / clicked / bounced + open & click counts.
// Optional date (single day) or from/to range, and userId scope.
export async function fetchFollowupEmails({ limit, userId, date, from, to, signal } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", limit);
  if (userId != null) params.set("user_id", userId);
  if (date) params.set("date", date);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await apiGet(`get_followup_emails${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return res?.data || [];
}

// Follow-up WhatsApps that failed to send, with the failure reason. For the
// WhatsApp "Failed" tab. Optional date (default all dates) and userId scope.
export async function fetchFailedWhatsapp({ limit, userId, date, from, to, signal } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", limit);
  if (userId != null) params.set("user_id", userId);
  if (date) params.set("date", date);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await apiGet(`get_followup_whatsapp_failed${qs ? `?${qs}` : ""}`, { signal, module: MOD });
  return (res?.data || []).map((r) => ({ ...r, failReason: parseWaFailReason(r.response) }));
}

// Turn Interakt's raw error response (a JSON string, usually) into a short,
// human-readable reason. Falls back to the trimmed raw text.
export function parseWaFailReason(response) {
  if (!response) return "Unknown error";
  let body = response;
  if (typeof response === "string") {
    try {
      body = JSON.parse(response);
    } catch {
      return response.slice(0, 160); // not JSON — show the raw text
    }
  }
  if (body && typeof body === "object") {
    const msg =
      body.message ||
      body.error ||
      body.result?.message ||
      body.errors?.[0]?.message ||
      body.data?.message ||
      (typeof body.result === "string" ? body.result : null);
    if (msg) return String(msg).slice(0, 160);
  }
  return String(response).slice(0, 160);
}

// Fire the sweep at most once per calendar day per browser, shared across the
// dashboard and quotations pages (one localStorage stamp for both). The real
// "no repeated reminders" guard (once / 2 days per customer) lives server-side,
// so the per-browser stamp here only avoids redundant calls. Returns the run
// result (or the last cached result when today's run already happened).
export async function runDailyFollowupWhatsapp(signal) {
  if (typeof window === "undefined") return null;
  const today = ymd();
  try {
    if (window.localStorage.getItem(SWEEP_KEY) === today) return getLastFollowupWhatsappStats();
    const res = await sendFollowupWhatsapp({ signal });
    window.localStorage.setItem(SWEEP_KEY, today);
    try {
      window.localStorage.setItem(STATS_KEY, JSON.stringify({ at: today, ...res }));
    } catch {
      /* storage full / disabled — stats are best-effort */
    }
    return res;
  } catch {
    return getLastFollowupWhatsappStats(); // best-effort; retried on next load
  }
}

// Last persisted sweep result ({ at, sent, skipped, failed, by_scenario, ... })
// or null if it has never run on this browser.
export function getLastFollowupWhatsappStats() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(STATS_KEY) || "null");
  } catch {
    return null;
  }
}
