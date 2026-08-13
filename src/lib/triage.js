// Priority triage for the shared mailboxes — pure, deterministic, no API key.
//
// Runs on BOTH sides: the server uses it to classify threads before they're sent
// to the client, and the client re-uses the labels/styles for display. Keeping it
// rule-based means the board still works when the AI gateway is unconfigured or
// rate-limited; the AI pass (see /api/mail/triage?ai=1) only ever *refines* what
// these rules already produced.
//
// The rules encode what the team asked for:
//   · anything waiting on us > 3 days  -> the Overdue bucket at the top
//   · any new lead / enquiry           -> always P1
//   · angry or escalating tone         -> P1
//   · negative tone or waiting > 24h   -> P2
//   · everything else                  -> P3

export const OVERDUE_HOURS = 72; // "more than 3 days"
export const WAITING_P2_HOURS = 24;

// ---------------------------------------------------------------------------
// Lexicons. Tuned for Indian self-storage support mail (English + Hinglish).
// ---------------------------------------------------------------------------

// Escalation comes in two strengths, because the naive single list produced a
// lot of noise on real mail: "manager" matched every vendor signature block and
// "media" matched ordinary business chatter.
//
// HARD — unambiguous. A single hit means escalation, no context needed.
const ESCALATION_HARD = [
  "legal notice", "lawyer", "advocate", "consumer court", "consumer forum",
  "police", "fir", "sue", "suing", "arbitration", "litigation",
  "fraud", "cheated", "cheating", "scam", "looting", "thief",
  "harassment", "harassing", "mental torture", "mental agony",
];

// INTENT — carries the threat by itself. "escalate" is never neutral; "manager"
// is. This tier is what keeps the Escalations tile meaningful.
const ESCALATION_INTENT = [
  "escalate", "escalating", "escalation", "legal action", "take this further",
  "bad review", "poor review", "negative review", "1 star", "one star",
  "social media", "consumer complaint", "file a complaint", "raise a complaint",
  "unacceptable", "unprofessional", "last warning", "final warning",
];

// WEAK — only counts when the message is ALSO negative. On its own "manager" is
// a job title in a signature block; next to "worst service" it's a threat.
const ESCALATION_WEAK = [
  "manager", "supervisor", "higher authority", "ceo", "founder", "management",
  "twitter", "facebook post", "google review", "media",
  "compensation", "damages claim", "reimburse",
];

// Anger / strong dissatisfaction.
const ANGRY = [
  "worst", "pathetic", "horrible", "terrible", "disgusting", "ridiculous", "absurd",
  "fed up", "frustrated", "frustrating", "disappointed", "disappointing", "unhappy",
  "very bad", "poor service", "no response", "not responding", "no reply", "nobody",
  "again and again", "repeatedly", "how many times", "still waiting", "since",
  "urgent", "urgently", "immediately", "asap", "at once", "right now",
  "damaged", "damage", "broken", "lost", "missing", "stolen", "theft", "wet", "fungus",
  "refund", "money back", "cancel", "cancellation",
  "bakwas", "bekar", "galat", "pareshan", "😡", "😠", "🤬",
];

// Softer negative — friction, not fury.
const FRUSTRATED = [
  "delay", "delayed", "late", "pending", "waiting", "not yet", "haven't received",
  "havent received", "not received", "issue", "problem", "concern", "mistake",
  "wrong", "incorrect", "overcharge", "extra charge", "expensive", "high price",
  "follow up", "followup", "reminder", "kindly do the needful", "please look into",
];

const POSITIVE = [
  "thank", "thanks", "appreciate", "great", "excellent", "happy", "satisfied",
  "good service", "well done", "helpful", "perfect", "🙏", "👍", "😊",
];

// New business signals.
const ENQUIRY = [
  "quote", "quotation", "enquiry", "inquiry", "enquire", "interested",
  "need storage", "want to store", "looking for storage", "storage space",
  "how much", "what is the cost", "what are the charges", "price list", "rates",
  "requirement", "would like to know", "please share the details", "send me details",
];

// Automated senders — never triage these as customer sentiment.
const NOISE_SENDERS = [
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon", "postmaster",
  "notification", "notifications", "alerts", "bounce", "automated", "system",
  "justdial", "indiamart", "sulekha", "newsletter", "info@google",
];

// Role mailboxes at OTHER companies. A person storing their household goods mails
// from a personal address; "sales@", "marketing@" and friends are almost always
// someone pitching us, and those were landing in P1 as fake "new enquiries".
const ROLE_LOCALPARTS = [
  "sales", "marketing", "partnership", "partnerships", "bd", "biz", "business",
  "hr", "careers", "recruitment", "hello", "contact", "team", "outreach", "growth",
  "campaign", "promo", "offers", "webmaster", "admin",
];

// Calendar traffic and read receipts are not customer questions.
const NOISE_SUBJECT_PREFIXES = [
  "accepted:", "declined:", "tentative:", "canceled:", "cancelled:",
  "invitation:", "updated invitation:", "read:", "delivered:", "undeliverable:",
  "out of office", "automatic reply", "do not reply", "donotreply",
  "auto-reply", "auto reply", "this is a system generated",
];

const INTERNAL_DOMAIN = "safestorage.in";

function norm(s) {
  return String(s || "").toLowerCase();
}

// Word-boundary match for plain words, substring for phrases/emoji.
function hits(text, terms) {
  const found = [];
  for (const t of terms) {
    if (!t) continue;
    if (/^[a-z]+$/i.test(t)) {
      const re = new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, "i");
      if (re.test(text)) found.push(t);
    } else if (text.includes(t)) {
      found.push(t);
    }
  }
  return found;
}

export function isInternal(address) {
  return norm(address).endsWith(`@${INTERNAL_DOMAIN}`);
}

// Fully automated senders — safe to drop from the board entirely.
export function isNoiseSender(address) {
  const a = norm(address);
  return NOISE_SENDERS.some((n) => a.includes(n));
}

// A role mailbox at another company (sales@, marketing@, hr@…). Usually someone
// pitching us, but SafeStorage does have B2B customers who mail from one — so
// these stay on the board and merely lose the automatic "new enquiry -> P1"
// promotion. Hiding them outright would risk burying a real corporate client.
export function isRoleSender(address) {
  const local = norm(address).split("@")[0].replace(/[._-]?\d+$/, "");
  return ROLE_LOCALPARTS.includes(local);
}

// Calendar responses, read receipts, auto-replies — real mail, but not a
// customer waiting on an answer.
export function isNoiseSubject(subject) {
  const s = norm(subject).trim();
  return NOISE_SUBJECT_PREFIXES.some((p) => s.startsWith(p));
}

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

export const TONES = {
  angry: { label: "Angry", cls: "bg-rose-100 text-rose-700", rank: 4 },
  frustrated: { label: "Frustrated", cls: "bg-amber-100 text-amber-700", rank: 3 },
  neutral: { label: "Neutral", cls: "bg-slate-100 text-slate-600", rank: 2 },
  positive: { label: "Positive", cls: "bg-emerald-100 text-emerald-700", rank: 1 },
};

// Returns { tone, escalation: bool, enquiry: bool, signals: string[] }
export function analyzeTone(raw) {
  const text = norm(raw).trim();
  if (!text) return { tone: "neutral", escalation: false, enquiry: false, signals: [] };

  const hard = hits(text, ESCALATION_HARD);
  const intent = hits(text, ESCALATION_INTENT);
  const weak = hits(text, ESCALATION_WEAK);
  const ang = hits(text, ANGRY);
  const fru = hits(text, FRUSTRATED);
  const pos = hits(text, POSITIVE);
  const enq = hits(text, ENQUIRY);

  // Weak terms only escalate inside an already-negative message.
  const negativeContext = ang.length > 0 || fru.length >= 2;
  const esc = [...hard, ...intent, ...(negativeContext ? weak : [])];

  // ALL CAPS shouting (only meaningful in a long-enough message).
  const letters = text.replace(/[^a-z]/gi, "");
  const caps = String(raw || "").replace(/[^A-Z]/g, "");
  const shouting = letters.length > 30 && caps.length / Math.max(letters.length, 1) > 0.5;

  const negWeight = esc.length * 3 + ang.length * 2 + fru.length + (shouting ? 2 : 0);
  const posWeight = pos.length;

  let tone = "neutral";
  if (esc.length > 0 || negWeight >= 4) tone = "angry";
  else if (negWeight >= 2) tone = "frustrated";
  else if (negWeight >= 1) tone = posWeight > negWeight ? "positive" : "frustrated";
  else if (posWeight > 0) tone = "positive";

  return {
    tone,
    escalation: esc.length > 0,
    enquiry: enq.length > 0,
    signals: [...new Set([...esc, ...ang.slice(0, 3), ...(shouting ? ["ALL CAPS"] : [])])].slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const PRIORITIES = {
  P1: { label: "P1", name: "Act now", cls: "bg-rose-600 text-white", soft: "bg-rose-50 text-rose-700 ring-rose-200" },
  P2: { label: "P2", name: "Today", cls: "bg-amber-500 text-white", soft: "bg-amber-50 text-amber-700 ring-amber-200" },
  P3: { label: "P3", name: "When free", cls: "bg-slate-400 text-white", soft: "bg-slate-50 text-slate-600 ring-slate-200" },
};

/**
 * Classify one thread.
 *
 * thread: {
 *   lastCustomerAt, lastReplyAt, customerMsgCount, replied,
 *   isNewEnquiry, text (subject + preview of the latest customer message)
 * }
 * `now` is injected so the server and client agree and tests stay deterministic.
 */
export function classifyThread(thread, now = Date.now()) {
  const tone = analyzeTone(thread.text);

  const lastCustomer = thread.lastCustomerAt ? new Date(thread.lastCustomerAt).getTime() : null;
  const lastReply = thread.lastReplyAt ? new Date(thread.lastReplyAt).getTime() : null;

  // Hours the customer has been waiting on US. Null when we already answered
  // after their last message (ball is in their court).
  const awaiting =
    lastCustomer && (!lastReply || lastReply < lastCustomer)
      ? Math.max(0, (now - lastCustomer) / 3_600_000)
      : null;

  const reasons = [];
  let priority = "P3";

  const bump = (p, why) => {
    reasons.push(why);
    if (p === "P1" || (p === "P2" && priority !== "P1")) priority = p;
  };

  // Rule 2 (explicit ask): a new lead / enquiry is ALWAYS P1.
  if (thread.isNewEnquiry) bump("P1", "New enquiry");
  else if (tone.enquiry && !thread.replied) bump("P1", "Enquiry, no reply yet");

  if (tone.escalation) bump("P1", "Escalation language");
  if (tone.tone === "angry") bump("P1", "Angry tone");

  if (awaiting != null && awaiting >= OVERDUE_HOURS) bump("P1", `Unanswered ${Math.floor(awaiting / 24)}d`);
  else if (awaiting != null && awaiting >= WAITING_P2_HOURS) bump("P2", `Waiting ${Math.floor(awaiting)}h`);

  if (tone.tone === "frustrated") bump("P2", "Negative tone");
  if (thread.customerMsgCount >= 3 && awaiting != null) bump("P2", `Chased ${thread.customerMsgCount}×`);

  if (!reasons.length) reasons.push(tone.tone === "positive" ? "Positive / FYI" : "Routine");

  return {
    priority,
    tone: tone.tone,
    escalation: tone.escalation,
    signals: tone.signals,
    reasons: [...new Set(reasons)].slice(0, 4),
    awaitingHours: awaiting,
    // Rule 3 (explicit ask): >3 days waiting on us gets its own bucket at the top.
    overdue: awaiting != null && awaiting >= OVERDUE_HOURS,
  };
}

// Sort key: overdue first, then P1>P2>P3, then longest-waiting, then angriest.
export function triageSort(a, b) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const p = (x) => (x.priority === "P1" ? 0 : x.priority === "P2" ? 1 : 2);
  if (p(a) !== p(b)) return p(a) - p(b);
  const w = (x) => x.awaitingHours ?? -1;
  if (w(a) !== w(b)) return w(b) - w(a);
  return (TONES[b.tone]?.rank || 0) - (TONES[a.tone]?.rank || 0);
}

export function humanAge(hours) {
  if (hours == null) return "—";
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const d = Math.floor(hours / 24);
  return `${d}d`;
}
