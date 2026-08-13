// Deterministic quality score for one customer-email -> team-reply exchange.
//
// Runs with no API key so the daily numbers always exist; the AI coach layers a
// rewritten reply and a written critique on top (see /api/mail/coach).
//
// Five dimensions, 100 points total. The weights say what the team is actually
// judged on: answering fast and completely matters more than sounding nice.

const APOLOGY = ["sorry", "apolog", "regret", "inconvenience", "understand your", "we realise", "we realize"];
const OWNERSHIP = [
  "we will", "we'll", "i will", "i'll", "we have arranged", "i have arranged",
  "our team will", "will be done", "by tomorrow", "by today", "within",
  "i have escalated", "we have escalated", "raised with", "assigned",
];
const NEXT_STEP = [
  "will get back", "will update", "will call", "will share", "please confirm",
  "let us know", "kindly confirm", "we will contact", "expect", "by ",
];
const TEMPLATE_TELLS = [
  "dear customer", "dear sir/madam", "dear sir / madam", "to whom it may concern",
  "greetings from safestorage", "thank you for contacting us",
];

const has = (text, terms) => terms.some((t) => text.includes(t));
const countHits = (text, terms) => terms.filter((t) => text.includes(t)).length;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Strip quoted history so we score what the rep actually WROTE, not the thread
// they replied on top of.
export function stripQuoted(raw) {
  let t = String(raw || "").replace(/\r/g, "");
  const cuts = [
    /^\s*On .{5,80}wrote:\s*$/im,
    /^\s*-----\s*Original Message\s*-----/im,
    /^\s*From:\s.+$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*>{1,}\s?/m,
  ];
  for (const re of cuts) {
    const m = t.match(re);
    if (m && m.index != null && m.index > 40) t = t.slice(0, m.index);
  }
  return t.trim();
}

function speedScore(hours) {
  if (hours == null) return { score: 0, note: "No reply sent" };
  if (hours <= 2) return { score: 30, note: `Replied in ${hours.toFixed(1)}h` };
  if (hours <= 6) return { score: 26, note: `Replied in ${hours.toFixed(1)}h` };
  if (hours <= 24) return { score: 20, note: `Replied in ${Math.round(hours)}h` };
  if (hours <= 72) return { score: 10, note: `Replied after ${Math.round(hours / 24)}d` };
  return { score: 3, note: `Replied after ${Math.round(hours / 24)}d` };
}

/**
 * scoreReply({ customerText, replyText, responseHours, customerTone })
 * -> { total, grade, breakdown: [{ key, label, score, max, note }] }
 */
export function scoreReply({ customerText, replyText, responseHours, customerTone = "neutral" }) {
  const cust = String(customerText || "").toLowerCase();
  const replyRaw = stripQuoted(replyText);
  const reply = replyRaw.toLowerCase();
  const words = replyRaw.split(/\s+/).filter(Boolean).length;

  // 1. Speed — 30 pts.
  const speed = speedScore(responseHours);

  // 2. Completeness — 25 pts. Did the reply engage with what was asked?
  const questions = (cust.match(/\?/g) || []).length;
  let completeness = 0;
  let cNote;
  if (!words) {
    completeness = 0;
    cNote = "Nothing written";
  } else if (words < 15) {
    completeness = 6;
    cNote = `Very short (${words} words)`;
  } else {
    // Overlap of the customer's distinctive words with our answer — a crude but
    // effective "did we actually address their subject" check.
    const custWords = new Set(cust.match(/[a-z]{5,}/g) || []);
    const replyWords = new Set(reply.match(/[a-z]{5,}/g) || []);
    const overlap = [...custWords].filter((w) => replyWords.has(w)).length;
    const ratio = custWords.size ? overlap / custWords.size : 0;
    completeness = clamp(Math.round(8 + ratio * 34), 8, 25);
    cNote =
      questions > 0
        ? `${questions} question${questions > 1 ? "s" : ""} asked, ${Math.round(ratio * 100)}% topic overlap`
        : `${Math.round(ratio * 100)}% topic overlap`;
  }

  // 3. Ownership / next step — 20 pts.
  const ownHits = countHits(reply, OWNERSHIP);
  const stepHits = countHits(reply, NEXT_STEP);
  const ownership = clamp(ownHits * 7 + stepHits * 5, 0, 20);
  const oNote =
    ownership >= 14 ? "Clear commitment + next step" : ownership > 0 ? "Weak commitment" : "No next step promised";

  // 4. Empathy — 15 pts. Only demanded when the customer was upset.
  const needsEmpathy = customerTone === "angry" || customerTone === "frustrated";
  const apologised = has(reply, APOLOGY);
  let empathy;
  let eNote;
  if (!needsEmpathy) {
    empathy = words ? 12 : 0;
    eNote = "Neutral customer — not required";
  } else if (apologised) {
    empathy = 15;
    eNote = "Acknowledged the customer's frustration";
  } else {
    empathy = 2;
    eNote = "Upset customer, no acknowledgement";
  }

  // 5. Personalisation — 10 pts. Template stamping loses marks.
  const templated = has(reply, TEMPLATE_TELLS);
  const personalisation = !words ? 0 : templated && words < 60 ? 2 : templated ? 5 : 10;
  const pNote = !words
    ? "—"
    : templated
      ? "Generic template opening"
      : "Written for this customer";

  const breakdown = [
    { key: "speed", label: "Response speed", score: speed.score, max: 30, note: speed.note },
    { key: "completeness", label: "Completeness", score: completeness, max: 25, note: cNote },
    { key: "ownership", label: "Ownership & next step", score: ownership, max: 20, note: oNote },
    { key: "empathy", label: "Empathy", score: empathy, max: 15, note: eNote },
    { key: "personalisation", label: "Personalisation", score: personalisation, max: 10, note: pNote },
  ];

  const total = breakdown.reduce((n, b) => n + b.score, 0);
  return { total, grade: gradeFor(total), breakdown };
}

export function gradeFor(total) {
  if (total >= 85) return { label: "Excellent", cls: "bg-emerald-100 text-emerald-700" };
  if (total >= 70) return { label: "Good", cls: "bg-sky-100 text-sky-700" };
  if (total >= 50) return { label: "Needs work", cls: "bg-amber-100 text-amber-700" };
  return { label: "Poor", cls: "bg-rose-100 text-rose-700" };
}
