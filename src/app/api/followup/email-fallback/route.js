// Email fallback for failed follow-up WhatsApps.
// Pulls the day's failed WhatsApp follow-ups from the agentic_crm backend and
// emails each customer (who has an email) via Resend. Safe to run repeatedly:
// every send uses an idempotency key of fallback-{customer_id}-{send_date}, so a
// customer is never emailed twice for the same day's failure.
//
// Triggers:
//   - Vercel Cron (GET) — see vercel.json. Vercel attaches Authorization:
//     Bearer ${CRON_SECRET}, which we verify below.
//   - Manual (POST) with the same Bearer token — for testing / backfills.
//     Body (optional): { date: "YYYY-MM-DD", limit: number, dryRun: boolean }
import { endpoint } from "@/lib/api";
import { emailReady, sendEmail, buildFallbackEmail } from "@/lib/email";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MOD = "agentic_crm";
const SEND_GAP_MS = 550; // stay under Resend's 2 req/s default rate limit

// IST (UTC+5:30) calendar date — matches how the backend stamps send_date.
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed until a secret is configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const looksLikeEmail = (e) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

async function fetchFailed({ date, limit }) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  const res = await fetch(endpoint(`get_followup_whatsapp_failed${qs ? `?${qs}` : ""}`, MOD), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`backend failed list ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

async function runFallback({ date, limit, dryRun }) {
  const day = date || istToday();
  const rows = await fetchFailed({ date: day, limit });

  // Dedupe within this run by customer (a customer can have >1 failed template/day)
  // and keep only rows with a usable email.
  const byCustomer = new Map();
  for (const r of rows) {
    if (!looksLikeEmail(r.customer_email)) continue;
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, r);
  }
  const targets = [...byCustomer.values()];

  const summary = {
    date: day,
    failed_total: rows.length,
    eligible: targets.length,
    no_email: rows.length - targets.length,
    sent: 0,
    errors: 0,
    dryRun: Boolean(dryRun),
    results: [],
  };

  if (dryRun) {
    summary.results = targets.map((r) => ({ customer_id: r.customer_id, email: r.customer_email, scenario: r.scenario }));
    return summary;
  }

  for (const r of targets) {
    const { subject, html } = buildFallbackEmail({
      customerName: r.customer_name,
      repName: r.rep_name,
      scenario: r.scenario,
    });
    const out = await sendEmail({
      to: r.customer_email.trim(),
      subject,
      html,
      idempotencyKey: `fallback-${r.customer_id}-${day}`,
    });
    if (out.ok) summary.sent++;
    else summary.errors++;
    summary.results.push({ customer_id: r.customer_id, email: r.customer_email, ok: out.ok, error: out.error, id: out.id });
    await sleep(SEND_GAP_MS);
  }
  return summary;
}

async function handle(req, body) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // dryRun previews targets without sending, so it doesn't need the API key.
  if (!body?.dryRun && !emailReady()) {
    return Response.json({ error: "Email not configured — add RESEND_API_KEY to env." }, { status: 400 });
  }
  try {
    const summary = await runFallback(body || {});
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e?.message || "Fallback run failed." }, { status: 500 });
  }
}

// Vercel Cron entrypoint.
export async function GET(req) {
  return handle(req, {});
}

// Manual / backfill entrypoint with optional { date, limit, dryRun }.
export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  return handle(req, body);
}
