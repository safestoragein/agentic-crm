// Server-only email helper (Resend REST API). Used as the fallback channel when
// a follow-up WhatsApp fails to deliver. We call Resend over plain fetch (no SDK)
// to avoid pulling extra deps, and use the Idempotency-Key header so the same
// customer is never emailed twice for the same day's failure — even if the route
// runs more than once.
// Server-only: import this from Route Handlers, never from client components.

const RESEND_URL = "https://api.resend.com/emails";

export function emailReady() {
  return Boolean(process.env.RESEND_API_KEY);
}

// Verified Resend sender. Domain safestorage.in is verified; override via env.
const FROM = process.env.FALLBACK_FROM_EMAIL || "SafeStorage <followups@safestorage.in>";
// Where customer replies should land (the From mailbox isn't monitored).
const REPLY_TO = process.env.FALLBACK_REPLY_TO || "safestorage.in@gmail.com";

// Send a single email through Resend. `idempotencyKey` makes retries safe — Resend
// returns the original send (no duplicate) for the same key within 24h.
// Returns { ok, id?, error? }.
export async function sendEmail({ to, subject, html, idempotencyKey }) {
  if (!emailReady()) return { ok: false, error: "RESEND_API_KEY not configured" };

  const headers = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
    });
  } catch (e) {
    return { ok: false, error: e?.message || "network error" };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    return { ok: false, error: body?.message || body?.error?.message || `HTTP ${res.status}` };
  }
  return { ok: true, id: body?.id };
}

// Per-scenario subject + lead line, keyed by the WhatsApp template scenario.
const SCENARIO_COPY = {
  quote_discount: {
    subject: "A special discount on your SafeStorage quote 📦",
    lead: "We have a limited-time discount on the storage quote we prepared for you, and we tried to share it with you on WhatsApp.",
  },
  callback: {
    subject: "We tried reaching you about your storage enquiry",
    lead: "We tried to reach you on WhatsApp to follow up on your storage enquiry but couldn't get through.",
  },
  rnr: {
    subject: "Let's pick up where we left off — SafeStorage",
    lead: "We tried calling and messaging you on WhatsApp about your storage requirement but couldn't connect.",
  },
};
const DEFAULT_COPY = {
  subject: "Following up on your SafeStorage enquiry",
  lead: "We tried to reach you on WhatsApp about your storage requirement but couldn't get through.",
};

// Build the fallback email ({ subject, html }) for one failed-WhatsApp row.
export function buildFallbackEmail({ customerName, repName, scenario }) {
  const copy = SCENARIO_COPY[scenario] || DEFAULT_COPY;
  const name = (customerName || "").trim().split(/\s+/)[0] || "there";
  const rep = (repName || "").trim();
  const cta = "https://safestorage.in";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e7eb;">
          <tr><td style="background:#0b5cab;padding:20px 28px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px;">SafeStorage</span>
          </td></tr>
          <tr><td style="padding:28px 28px 8px;">
            <p style="margin:0 0 14px;font-size:16px;">Hi ${name},</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${copy.lead}</p>
            <p style="margin:0 0 22px;font-size:15px;line-height:1.55;">We'd love to help you store your belongings safely — pickup, packing, and climate-controlled storage, all handled by our team. Reply to this email or tap below and we'll take it from here.</p>
            <p style="margin:0 0 26px;">
              <a href="${cta}" style="display:inline-block;background:#0b5cab;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">Talk to us</a>
            </p>
            <p style="margin:0 0 4px;font-size:14px;color:#52606d;">Warm regards,</p>
            <p style="margin:0;font-size:14px;color:#1f2933;font-weight:600;">${rep ? `${rep}, ` : ""}SafeStorage Team</p>
          </td></tr>
          <tr><td style="padding:18px 28px 26px;border-top:1px solid #f0f2f4;">
            <p style="margin:0;font-size:12px;color:#9aa5b1;line-height:1.5;">You're receiving this because you enquired with SafeStorage. If this isn't relevant, just ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: copy.subject, html };
}
