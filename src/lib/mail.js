// Client-side helpers for the mailbox pages.
//
// Two things every call here must get right:
//   1. basePath — these are plain fetch() calls, which Next does NOT prefix with
//      /agentic-crm (only <Link>/router do). Hence appHref().
//   2. identity — the route handlers gate on `x-crm-user-email`, so every call
//      carries the logged-in CRM session email.

import { appHref } from "./paths";
import { getSession } from "./auth";

function authHeaders() {
  const s = getSession();
  return s?.user_email ? { "x-crm-user-email": s.user_email } : {};
}

async function call(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(appHref(`/api/mail${path}`), {
    method,
    headers: {
      Accept: "application/json",
      ...authHeaders(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : null),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export function fetchMailCounts({ signal } = {}) {
  return call("/counts", { signal });
}

export function fetchMessages(box, { folder = "inbox", q = "", unread = false, top = 25, skip = 0, signal } = {}) {
  const p = new URLSearchParams({ folder, top: String(top) });
  if (skip) p.set("skip", String(skip));
  if (unread) p.set("unread", "1");
  if (q) p.set("q", q);
  return call(`/${box}/messages?${p}`, { signal });
}

export function fetchMessage(box, id, { signal } = {}) {
  return call(`/${box}/messages/${encodeURIComponent(id)}`, { signal });
}

export function setRead(box, id, isRead) {
  return call(`/${box}/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: { isRead } });
}

export function sendReply(box, id, { html, replyAll = false }) {
  return call(`/${box}/messages/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    body: { html, replyAll },
  });
}

// Priority board across every mailbox.
export function fetchTriage({ days = 7, mailboxes = [], signal } = {}) {
  const p = new URLSearchParams({ days: String(days) });
  mailboxes.forEach((m) => p.append("mailbox", m));
  return call(`/triage?${p}`, { signal });
}

// Score one thread's reply, and (with an AI key) get an improved version.
export function coachReply({ box, conversationId, signal }) {
  return call("/coach", { method: "POST", body: { box, conversationId }, signal });
}

export function attachmentUrl(box, id, attId) {
  return appHref(
    `/api/mail/${box}/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attId)}`
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function addressOf(recipient) {
  return recipient?.emailAddress?.address || "";
}

export function nameOf(recipient) {
  const e = recipient?.emailAddress;
  return e?.name || e?.address || "";
}

export function recipientLine(list) {
  return (list || []).map(nameOf).filter(Boolean).join(", ");
}

// "14:32" today, "12 Aug" this year, "12 Aug 25" otherwise — the compact form
// mail lists want.
export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString([], opts);
}

export function fullDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function initialsFor(text) {
  const t = String(text || "").trim();
  if (!t) return "?";
  const parts = t.split(/[\s.@]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || t[0].toUpperCase();
}
