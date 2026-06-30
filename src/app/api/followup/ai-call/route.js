// AI voice-call escalation for SLA-breached quotations.
// Pulls every open team quotation from the agentic_crm backend, finds the ones
// that breach the 15-min first-response SLA (uncontacted, not done, created >15
// min ago) and places an outbound AI call (Bolna) to each — the escalation tier
// above the WhatsApp follow-up.
//
// Idempotent: a per-IST-day JSON guard (.ai-call-log/<date>.json) records every
// customer already called today, so re-running (cron fires every few minutes)
// never double-dials the same lead. Safe to run repeatedly.
//
// Triggers:
//   - System crontab (POST) every ~5 min — see scripts/trigger-ai-calls.sh.
//     (vercel.json also lists it, but Vercel cron is inert on the self-hosted
//     server; the crontab is the real trigger.)
//   - Manual (POST) with the same Bearer token — for testing / backfills.
//     Body (optional): { limit, dryRun, maxAgeMins, minValue }
import { endpoint } from "@/lib/api";
import { voiceReady, placeCall, toE164India } from "@/lib/voice";
import { promises as fs } from "node:fs";
import path from "node:path";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MOD = "agentic_crm";
const SLA_MINUTES = 15; // must match quotations/page.js
const DEFAULT_MAX_AGE_MINS = 180; // don't cold-call quotes older than this
const CALL_GAP_MS = 1200; // pace dials so we don't burst the provider

// Follow-up statuses that count as "closed" — never AI-call these.
const DONE_STATES = new Set(["booked", "won", "converted", "lost", "invalid", "not-interested"]);

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed until a secret is configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IST calendar date — matches how the backend stamps timestamps.
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function minutesSince(datetime) {
  if (!datetime) return null;
  const t = Date.parse(String(datetime).replace(" ", "T"));
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

// --- per-day dedupe guard (file-based; the app runs as one persistent process
// on the self-hosted server, so a JSON file is a reliable once-per-day store) ---
function logPath(day) {
  return path.join(process.cwd(), ".ai-call-log", `${day}.json`);
}
async function readCalled(day) {
  try {
    const txt = await fs.readFile(logPath(day), "utf8");
    return JSON.parse(txt) || {};
  } catch {
    return {}; // no file yet (or unreadable) — treat as nobody called
  }
}
async function writeCalled(day, map) {
  try {
    const p = logPath(day);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(map, null, 2));
    return true;
  } catch {
    return false; // FS not writable (e.g. serverless) — dedupe holds only in-run
  }
}

// Pull every open team quotation (no relationship_manager_id => all open quotes).
async function fetchOpenQuotations() {
  const res = await fetch(endpoint("crm_team_quotations_data", MOD), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({}), // empty body = all reps
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`backend quotations ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : json?.data || json?.result || [];
  return Array.isArray(rows) ? rows : [];
}

// A row breaches if: uncontacted, not closed, created >15 min ago (and within
// the max-age window so we never cold-call stale quotes).
function isBreached(q, { maxAgeMins, minValue }) {
  const statusKey = String(q.follow_up || "").toLowerCase().trim().replace(/\s+/g, "-");
  const contacted = Boolean(q.follow_up) || Boolean(q.follow_up_start_time);
  if (contacted) return false;
  if (DONE_STATES.has(statusKey)) return false;
  const mins = minutesSince(q.created_at);
  if (mins == null || mins <= SLA_MINUTES || mins > maxAgeMins) return false;
  if (minValue) {
    const value =
      Number(q.total_storage_charges_with_gst || 0) + Number(q.total_pickup_charges_with_gst || 0);
    if (value < minValue) return false;
  }
  return true;
}

async function runAiCalls({ limit, dryRun, maxAgeMins, minValue } = {}) {
  const day = istToday();
  maxAgeMins = maxAgeMins || DEFAULT_MAX_AGE_MINS;

  const rows = await fetchOpenQuotations();
  const already = await readCalled(day);

  // Eligible = breached, has a usable Indian mobile, and not already called today.
  const targets = [];
  let noPhone = 0;
  for (const q of rows) {
    if (!isBreached(q, { maxAgeMins, minValue })) continue;
    const id = String(q.customer_id);
    if (already[id]) continue;
    const phone = toE164India(q.customer_contact1);
    if (!phone) {
      noPhone++;
      continue;
    }
    targets.push({
      id,
      phone,
      name: q.customer_name || "Customer",
      city: q.customer_local_city || "",
      rep: `${q.user_fname || ""} ${q.user_lname || ""}`.trim() || "our team",
      value:
        Number(q.total_storage_charges_with_gst || 0) + Number(q.total_pickup_charges_with_gst || 0),
      mins: minutesSince(q.created_at),
    });
    if (limit && targets.length >= limit) break;
  }
  // Worst breaches first.
  targets.sort((a, b) => b.mins - a.mins);

  const summary = {
    day,
    open_total: rows.length,
    eligible: targets.length,
    no_phone: noPhone,
    called: 0,
    errors: 0,
    dryRun: Boolean(dryRun),
    results: [],
  };

  if (dryRun) {
    summary.results = targets.map((t) => ({
      customer_id: t.id,
      phone: t.phone,
      name: t.name,
      overdue_mins: t.mins,
    }));
    return summary;
  }

  for (const t of targets) {
    const out = await placeCall({
      phone: t.phone,
      variables: {
        customer_name: t.name,
        city: t.city,
        rep_name: t.rep,
        quote_value: String(t.value || ""),
      },
    });
    if (out.ok) {
      summary.called++;
      already[t.id] = { at: new Date().toISOString(), callId: out.callId || null };
    } else {
      summary.errors++;
    }
    summary.results.push({ customer_id: t.id, phone: t.phone, ok: out.ok, callId: out.callId, error: out.error });
    await writeCalled(day, already); // persist after each call (crash-safe)
    await sleep(CALL_GAP_MS);
  }
  return summary;
}

async function handle(req, body) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // dryRun previews targets without dialing, so it doesn't need the provider key.
  if (!body?.dryRun && !voiceReady()) {
    return Response.json(
      { error: "Voice not configured — add BOLNA_API_KEY and BOLNA_AGENT_ID to env." },
      { status: 400 }
    );
  }
  try {
    const summary = await runAiCalls(body || {});
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e?.message || "AI-call run failed." }, { status: 500 });
  }
}

// Vercel Cron entrypoint (inert on the self-hosted server; crontab is the real one).
export async function GET(req) {
  return handle(req, {});
}

// Crontab / manual entrypoint with optional { limit, dryRun, maxAgeMins, minValue }.
export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  return handle(req, body);
}
