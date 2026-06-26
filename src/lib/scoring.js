// Lead & quote prioritisation — transparent, tunable heuristics over the data
// already loaded for the quotations list (lib/crm.js → fetchQuotations) and the
// escalation evaluation (lib/escalations.js → evaluateEscalation).
//
// These are calibrated heuristics, NOT a learned model: we have no labelled
// won/lost history yet. Every term carries a human-readable reason so the score
// is explainable on hover. When outcomes are logged, the same feature set can be
// fitted with a logistic regression to produce real probabilities.

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Whole days since a datetime string ("YYYY-MM-DD HH:MM:SS").
function daysSince(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const t = new Date(String(dt).replace(" ", "T"));
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
}

// Win-probability (0–100) that this quotation converts. Additive log-odds (z),
// squashed with a logistic so z=0 → 50%. Returns { score, band, reasons }.
export function scoreQuote(q, esc) {
  if (!q) return { score: 0, band: "cold", reasons: [] };
  if (q.won) return { score: 100, band: "won", reasons: ["Won"] };
  if (q.lost) return { score: 0, band: "lost", reasons: ["Lost"] };

  let z = 0;
  const reasons = [];
  const add = (delta, why) => {
    z += delta;
    if (why) reasons.push({ delta, why });
  };

  // --- engagement ---
  if (q.verified) add(1.1, "Call logged");
  else if (!q.contacted) add(-0.7, "Never contacted");

  if (q.responseMins != null) {
    if (q.responseMins <= 15) add(0.6, "Fast first response");
    else if (q.responseMins > 120) add(-0.3, "Slow first response");
  }

  // --- follow-up discipline ---
  if (q.bucket === "overdue") add(-0.4 * Math.min(q.overdueDays || 1, 6), `${q.overdueDays}d overdue`);
  else if (q.bucket === "today") add(0.15, "Due today");

  // --- intent / status ---
  const s = String(q.statusKey || q.status || "").toLowerCase();
  if (/negoti/.test(String(q.stage || ""))) add(0.9, "In negotiation");
  else if (/quot/.test(String(q.stage || ""))) add(0.35, "Quote sent");
  if (s === "rnr" || s === "no-answer") add(-1.0, "RNR / no answer");
  else if (s === "call-later") add(-0.2, "Call-later");
  else if (s === "sent-message") add(0.3, "Message sent");

  // --- escalation pressure ---
  if (esc?.level === "L3") add(-1.2, "L3 escalation");
  else if (esc?.level === "L2") add(-0.6, "L2 escalation");

  // --- recency ---
  const age = daysSince(q.createdAt);
  if (age != null) {
    if (age <= 1) add(0.5, "Fresh (≤1d)");
    else if (age >= 14) add(-0.8, "Stale (>14d)");
    else if (age >= 7) add(-0.35, "Ageing (>7d)");
  }

  const score = Math.round(100 / (1 + Math.exp(-z)));
  const band = score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";
  // Show the strongest drivers first.
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { score, band, reasons: reasons.map((r) => r.why) };
}

// Next-best-action — a single, unambiguous step. First match wins. Returns
// { label, kind, tone, href } or null for terminal (won/lost) quotes.
//   kind: call | whatsapp | discount | resend | followup
export function nextAction(q, esc) {
  if (!q || q.won || q.lost) return null;
  const s = String(q.statusKey || q.status || "").toLowerCase();
  const tel = q.contact ? `tel:+91${q.contact}` : null;
  const wa = q.contact ? `https://wa.me/91${q.contact}` : null;

  // 1. fresh & never contacted → first-response window
  if (!q.contacted) return { label: "Call now", kind: "call", tone: "indigo", href: tel };
  // 2. overdue follow-up → call, framed by how late
  if (q.bucket === "overdue")
    return { label: `Call · ${q.overdueDays}d overdue`, kind: "call", tone: "rose", href: tel };
  // 3. RNR / no answer → switch channel
  if (s === "rnr" || s === "no-answer") return { label: "WhatsApp nudge", kind: "whatsapp", tone: "green", href: wa };
  // 4. negotiating → offer a discount quote (opens the quote builder/coupon)
  if (/negoti/.test(String(q.stage || "")))
    return { label: "Send −10% quote", kind: "discount", tone: "violet", href: `/customer/${q.id}/new-quotation` };
  // 5. quote sent / message sent but silent → resend
  if (s === "sent-message" || /quot/.test(String(q.stage || "")))
    return { label: "Resend quote", kind: "resend", tone: "amber", href: wa };
  // 6. due today
  if (q.bucket === "today") return { label: "Call today", kind: "call", tone: "amber", href: tel };
  // 7. fallback
  return { label: "Follow up", kind: "followup", tone: "slate", href: tel };
}
