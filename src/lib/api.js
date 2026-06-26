// Central API helper for the SafeStorage report_analysis backend.
// Base URL is overridable via NEXT_PUBLIC_API_BASE (see .env.local).

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "https://safestorage.in/back";

// CRM endpoints live across two CodeIgniter modules:
//   report_analysis — the original dashboard/quotation/lead endpoints
//   agentic_crm     — CRM-specific work (RNR reassignment, customer 360, ...)
// Pass { module: "agentic_crm" } to target the new module; default is report_analysis.
const DEFAULT_MODULE = "report_analysis";

export function endpoint(path, module = DEFAULT_MODULE) {
  return `${API_BASE}/${module}/${path.replace(/^\//, "")}`;
}

export async function apiGet(path, { signal, module } = {}) {
  const res = await fetch(endpoint(path, module), {
    method: "GET",
    headers: { Accept: "application/json" },
    mode: "cors",
    cache: "no-store", // always fresh — a just-created quote must appear immediately
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function apiPostForm(path, fields = {}, { signal, module } = {}) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.append(k, v);
  });
  const res = await fetch(endpoint(path, module), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    mode: "cors",
    body,
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// Like apiPostForm but supports nested arrays/objects as PHP-style params:
//   ["a","b"]        -> key[]=a&key[]=b
//   { slug: 2 }      -> key[slug]=2
// (matches what the legacy quotation wizard posts).
export async function apiPostNested(path, fields = {}, { signal, module } = {}) {
  const body = new URLSearchParams();
  const add = (key, val) => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) val.forEach((v) => add(`${key}[]`, v));
    else if (typeof val === "object") Object.entries(val).forEach(([k, v]) => add(`${key}[${k}]`, v));
    else body.append(key, val);
  };
  Object.entries(fields).forEach(([k, v]) => add(k, v));
  const res = await fetch(endpoint(path, module), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    mode: "cors",
    body,
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// Normalise the various shapes the PHP layer may return into a plain array.
export function toList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  if (Array.isArray(payload.users)) return payload.users;
  if (typeof payload === "object") return [payload];
  return [];
}
