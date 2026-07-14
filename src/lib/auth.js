// Client-side auth against the CRM credential list.
// The backend `get_crm_login_credentials` returns every CRM user (role_id 5)
// with a base64-decoded password; we match email + password locally — the same
// mechanism the existing CRM uses.

import { apiGet, toList } from "./api";

const SESSION_KEY = "userSession";
const SESSION_START_KEY = "sessionStartTime";

// In-memory fallback. Some mobile browsers (Safari Private Mode, in-app WebViews,
// storage-restricted privacy settings) THROW the moment you touch
// window.localStorage. Every storage access below is wrapped so it can never
// throw — a thrown getSession() used to leave the whole app blank. When storage
// is unavailable we keep the session in memory for the life of the tab, so the
// app still works (the user just re-logs in on their next visit).
let memSession = null;

// Read a key from localStorage, then sessionStorage. window[...] access is inside
// the try because the property getter itself can throw when storage is blocked.
function readStored(key) {
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      const v = window[name].getItem(key);
      if (v != null) return v;
    } catch {
      /* storage blocked — try the next, then fall back to memory */
    }
  }
  return null;
}

function writeStored(useLocal, key, val) {
  try {
    window[useLocal ? "localStorage" : "sessionStorage"].setItem(key, val);
  } catch {
    /* storage blocked — memSession already holds it */
  }
}

function removeStored(key) {
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      window[name].removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export async function login(email, password, { signal } = {}) {
  const payload = await apiGet("get_crm_login_credentials", { signal, noCache: true });
  const users = toList(payload);

  const cleanEmail = email.trim().toLowerCase();
  const match = users.find(
    (u) =>
      (u.user_email || "").trim().toLowerCase() === cleanEmail &&
      (u.user_password || "") === password
  );

  if (!match) {
    const err = new Error("Invalid email or password. Please try again.");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const session = {
    user_id: match.user_id,
    user_email: match.user_email,
    user_fname: match.user_fname,
    user_contact1: match.user_contact1 ?? null,
    role_id: match.role_id ?? null, // 5 = sales rep, 18 = admin (gates Admin dashboard)
    loginTime: new Date().toISOString(),
  };

  return session;
}

export function persistSession(session, { remember = true } = {}) {
  memSession = session || null;
  if (typeof window === "undefined") return;
  writeStored(remember, SESSION_KEY, JSON.stringify(session));
  writeStored(remember, SESSION_START_KEY, Date.now().toString());
}

export function getSession() {
  if (typeof window === "undefined") return null;
  const raw = readStored(SESSION_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* corrupt value — fall back to the in-memory session */
    }
  }
  return memSession;
}

export function clearSession() {
  memSession = null;
  if (typeof window === "undefined") return;
  removeStored(SESSION_KEY);
  removeStored(SESSION_START_KEY);
}

// Daily fresh-session cutover at 08:00 local time. The most recent 08:00 that has
// already passed; before 8 AM that's yesterday's.
export function morningCutoverMs(now = Date.now()) {
  const d = new Date(now);
  const cut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 0, 0).getTime();
  return now < cut ? cut - 86400000 : cut;
}

// A session started before today's 08:00 is stale — the rep must re-login, so
// each workday gets a clean session and a correct in-office login time.
export function isSessionStale(session) {
  if (!session) return false;
  const t = Date.parse(session.loginTime);
  return !isNaN(t) && t < morningCutoverMs();
}
