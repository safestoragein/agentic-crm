// Server-side gate for the /api/mail/* routes.
//
// These routes read and send real company email, so they must not be open to
// anyone who can guess the URL. The client sends the logged-in CRM identity as
// `x-crm-user-email`; we verify server-side that the address belongs to an admin
// (role_id 18) in the CRM user list, or is in the MAIL_ADMIN_EMAILS allowlist.
//
// LIMITATION — read this before going live: the CRM's session is client-side
// (localStorage, see lib/auth.js), so this header is an *identity claim*, not
// proof. Someone who knows an admin's email address could forge it and read the
// mailboxes. It is a real improvement over an unauthenticated route, but the
// proper fix is a signed session cookie (or a server-verified login) — worth
// doing before this is exposed to anything outside the office network.

import { endpoint, toList } from "./api";

const ADMIN_ROLE_ID = "18";
const CRED_TTL_MS = 5 * 60 * 1000;

let _creds = null; // { at, users }

function allowlist() {
  return new Set(
    String(process.env.MAIL_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

// CRM user list from the PHP backend, cached briefly so a burst of mail requests
// doesn't re-pull it every time.
async function crmUsers() {
  if (_creds && Date.now() - _creds.at < CRED_TTL_MS) return _creds.users;
  const res = await fetch(endpoint("get_crm_login_credentials"), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CRM user list unavailable (${res.status})`);
  const users = toList(await res.json());
  _creds = { at: Date.now(), users };
  return users;
}

// Returns { ok: true, email } or { ok: false, response } — call the response
// straight back from the route handler.
export async function requireMailAdmin(req) {
  const email = (req.headers.get("x-crm-user-email") || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, response: Response.json({ error: "Not signed in" }, { status: 401 }) };
  }

  if (allowlist().has(email)) return { ok: true, email };

  let users;
  try {
    users = await crmUsers();
  } catch (e) {
    return {
      ok: false,
      response: Response.json({ error: e?.message || "Auth check failed" }, { status: 503 }),
    };
  }

  const match = users.find((u) => (u.user_email || "").trim().toLowerCase() === email);
  if (!match || String(match.role_id) !== ADMIN_ROLE_ID) {
    return {
      ok: false,
      response: Response.json({ error: "Mailboxes are restricted to admins" }, { status: 403 }),
    };
  }
  return { ok: true, email };
}
