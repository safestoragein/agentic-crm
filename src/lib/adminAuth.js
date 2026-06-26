// Admin access control for the Admin dashboard.
//
// Primary rule: a user is an admin when their ss_user.role_id == 18 (the admin
// role in the backend; 5 = sales rep). The login endpoint now returns role_id
// and auth.js stores it on the session — see get_crm_team_logins in
// Report_analysis_model.php.
//
// Optional override: extra admins can be granted via env (comma-separated),
// without a DB role change:
//   NEXT_PUBLIC_ADMIN_IDS=1,42
//   NEXT_PUBLIC_ADMIN_EMAILS=owner@safestorage.in

const ADMIN_ROLE_ID = "18";

function parseList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_IDS = new Set(parseList(process.env.NEXT_PUBLIC_ADMIN_IDS));
const ADMIN_EMAILS = new Set(parseList(process.env.NEXT_PUBLIC_ADMIN_EMAILS));

export function isAdmin(session) {
  if (!session) return false;
  if (String(session.role_id) === ADMIN_ROLE_ID) return true; // role-based (primary)
  const id = session.user_id != null ? String(session.user_id).toLowerCase() : "";
  const email = (session.user_email || "").trim().toLowerCase();
  return (id && ADMIN_IDS.has(id)) || (email && ADMIN_EMAILS.has(email)); // env override
}
