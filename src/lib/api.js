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

// ---------------------------------------------------------------------------
// Read cache + in-flight dedup.
//
// Every page in this app is client-rendered and remounts on tab navigation, so
// without a cache each tab switch re-downloads the full backend payloads (the
// leads list alone is ~6MB). Two things fix that:
//   1. TTL cache  — an identical GET/read-POST within CACHE_TTL_MS returns the
//      already-parsed JSON instantly (no network, no re-parse), so revisiting a
//      tab is instant and data is at most CACHE_TTL_MS stale.
//   2. Dedup      — concurrent identical requests share ONE network promise, so
//      the sidebar badge and the dashboard don't each pull the 6MB leads list.
//
// Any write (apiPostForm / apiPostNested) clears the cache on success, so a
// just-saved follow-up / quote is reflected the next time a list is read.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000; // reads are considered fresh for 60s
const _cache = new Map(); // key -> { at: epochMs, data }
const _inflight = new Map(); // key -> Promise<data>

function cacheKey(method, path, module, body) {
  return `${method} ${module || DEFAULT_MODULE} ${path}${body ? ` ${body}` : ""}`;
}

// Clear all cached reads. Called after any write so lists refetch fresh.
export function clearApiCache() {
  _cache.clear();
  _inflight.clear();
}

// Drop cached reads whose key contains any of the given path substrings.
// Lets a targeted write invalidate only the lists it affects (optional; writes
// already clear everything via clearApiCache()).
export function invalidateApiCache(...pathParts) {
  for (const key of _cache.keys()) {
    if (pathParts.some((p) => key.includes(p))) _cache.delete(key);
  }
}

async function rawFetch(method, path, module, body) {
  const init = {
    method,
    mode: "cors",
    cache: "no-store",
    headers: method === "GET"
      ? { Accept: "application/json" }
      : { "Content-Type": "application/x-www-form-urlencoded" },
  };
  if (body != null) init.body = body;
  const res = await fetch(endpoint(path, module), init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// Shared read path: TTL cache + in-flight dedup. The network request is NOT
// tied to any single caller's AbortSignal (so an unmount can't kill a request
// other callers are awaiting, and a completed fetch always warms the cache);
// instead each caller races its own signal against the shared promise, so
// caller-side cancellation still rejects with AbortError exactly as before.
async function cachedRead(method, path, module, body, { signal, ttl = CACHE_TTL_MS } = {}) {
  const key = cacheKey(method, path, module, body);
  const now = Date.now();

  const hit = _cache.get(key);
  if (hit && now - hit.at < ttl) return withSignal(Promise.resolve(hit.data), signal);

  let inflight = _inflight.get(key);
  if (!inflight) {
    inflight = rawFetch(method, path, module, body)
      .then((data) => {
        _cache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        if (_inflight.get(key) === inflight) _inflight.delete(key);
      });
    _inflight.set(key, inflight);
  }
  return withSignal(inflight, signal);
}

// Reject as soon as `signal` aborts, otherwise resolve with the shared promise.
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); }
    );
  });
}

function abortError() {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

// Cached GET. Pass { noCache: true } to bypass the cache (login, side-effecting
// triggers) — those must always hit the backend.
export async function apiGet(path, { signal, module, noCache, ttl } = {}) {
  if (noCache) return rawFetch("GET", path, module, null);
  return cachedRead("GET", path, module, null, { signal, ttl });
}

function encodeForm(fields = {}) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.append(k, v);
  });
  return body.toString();
}

// Cached read over POST-form (some list endpoints are POST-only, e.g.
// crm_team_quotations_data). Same TTL + dedup as apiGet.
export async function apiGetForm(path, fields = {}, { signal, module, ttl } = {}) {
  return cachedRead("POST", path, module, encodeForm(fields), { signal, ttl });
}

// Write over POST-form. NOT cached, and clears the read cache on success so any
// list refetch after the write returns fresh data.
export async function apiPostForm(path, fields = {}, { signal, module } = {}) {
  const res = await fetch(endpoint(path, module), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    mode: "cors",
    body: encodeForm(fields),
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const json = await res.json();
  clearApiCache();
  return json;
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
  const json = await res.json();
  clearApiCache(); // create/edit quotation writes — flush stale list reads
  return json;
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
