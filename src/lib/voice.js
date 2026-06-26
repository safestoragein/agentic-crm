// Server-only AI voice-call helper (Bolna by default). Used as the escalation
// channel when a quotation breaches the 15-min first-response SLA and WhatsApp
// hasn't recovered it. We call the provider over plain fetch (no SDK) to avoid
// extra deps, mirroring src/lib/email.js.
//
// Provider is Bolna (India-first, Indic languages, DLT-aware). Swappable via
// VOICE_API_URL if you move telephony to Plivo/Exotel + your own agent.
//
// Server-only: import this from Route Handlers, never from client components.
//
// IMPORTANT (India compliance): the spoken script lives in the Bolna *agent*
// config, not here. That agent MUST (a) open with an AI disclosure
// ("automated call from SafeStorage"), (b) dial from a DLT-registered 160-series
// caller ID, and (c) be DND-scrubbed. This file only places the call + passes
// per-customer variables into the agent.

const VOICE_API_URL = process.env.VOICE_API_URL || "https://api.bolna.ai/call";

export function voiceReady() {
  return Boolean(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID);
}

// Normalize an Indian phone number to E.164 (+91XXXXXXXXXX). Accepts 10-digit,
// 0-prefixed, 91-prefixed, or already-+91 input. Returns null if it can't.
export function toE164India(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 || !/^[6-9]/.test(d)) return null; // valid Indian mobile starts 6-9
  return `+91${d}`;
}

// Place one outbound AI call. `variables` are injected into the agent prompt
// (e.g. {customer_name}, {city}, {quote_value}, {rep_name}). Returns
// { ok, callId?, error? }.
export async function placeCall({ phone, variables = {} }) {
  if (!voiceReady()) return { ok: false, error: "BOLNA_API_KEY / BOLNA_AGENT_ID not configured" };

  const e164 = toE164India(phone);
  if (!e164) return { ok: false, error: `unusable phone: ${phone}` };

  const payload = {
    agent_id: process.env.BOLNA_AGENT_ID,
    recipient_phone_number: e164,
    // Optional: pin the registered (160-series) caller ID. Bolna falls back to
    // the agent's default number if omitted.
    ...(process.env.BOLNA_FROM_NUMBER ? { from_phone_number: process.env.BOLNA_FROM_NUMBER } : {}),
    // Per-call variables the agent template can interpolate.
    user_data: variables,
  };

  let res;
  try {
    res = await fetch(VOICE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BOLNA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: e?.message || "network error" };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    return { ok: false, error: body?.message || body?.error || `provider ${res.status}` };
  }
  // Bolna returns a call/execution id under one of these keys depending on plan.
  const callId = body?.call_id || body?.execution_id || body?.id || null;
  return { ok: true, callId };
}
