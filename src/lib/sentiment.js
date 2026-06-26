// Local, rule-based sentiment + intent for short CRM messages (WhatsApp replies,
// lead enquiries). No API key, no model — a tuned keyword lexicon for an Indian
// self-storage CRM (handles common English + Hinglish + emoji). Deterministic.

const POSITIVE = [
  "thank", "thanks", "thank you", "great", "good", "interested", "yes", "sure",
  "ok", "okay", "confirm", "confirmed", "book", "booking", "proceed", "go ahead",
  "perfect", "awesome", "nice", "happy", "deal", "fine", "done", "please proceed",
  "want to store", "ready", "definitely", "sounds good", "appreciate", "helpful",
  "haan", "theek", "accha", "👍", "🙏", "❤️", "😊", "🙂", "👌",
];

const NEGATIVE = [
  "not interested", "no need", "don't want", "dont want", "no thanks", "no thank you",
  "expensive", "costly", "too much", "too high", "very high", "cancel", "stop",
  "busy", "later", "problem", "issue", "bad", "worst", "refund", "complaint",
  "never", "unsubscribe", "wrong number", "don't call", "dont call", "not now",
  "already done", "already booked elsewhere", "leave me", "nahi", "mat", "👎", "😡", "😠", "🙄",
];

// Intent buckets — first match wins, checked in priority order.
const INTENTS = [
  { key: "ready_to_book", label: "Ready to book", tone: "good", terms: ["book", "booking", "confirm", "proceed", "go ahead", "want to store", "ready", "interested", "yes please", "lock", "reserve"] },
  { key: "price_concern", label: "Price concern", tone: "warn", terms: ["price", "cost", "expensive", "costly", "discount", "cheaper", "rate", "charges", "too much", "budget", "offer", "less"] },
  { key: "not_interested", label: "Not interested", tone: "bad", terms: ["not interested", "no need", "cancel", "stop", "already", "don't want", "dont want", "remove", "no thanks"] },
  { key: "wrong_number", label: "Wrong number", tone: "bad", terms: ["wrong number", "who is this", "who are you", "don't know", "dont know", "galat"] },
  { key: "needs_info", label: "Wants details", tone: "info", terms: ["how", "what", "when", "where", "details", "info", "information", "size", "pickup", "?"] },
  { key: "callback", label: "Call later", tone: "info", terms: ["busy", "later", "call back", "callback", "evening", "tomorrow", "after"] },
];

function countHits(text, terms) {
  let n = 0;
  for (const t of terms) {
    if (!t) continue;
    if (/^[a-z']+$/i.test(t)) {
      // word-ish term → word-boundary match
      const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
      if (re.test(text)) n++;
    } else if (text.includes(t)) {
      n++; // phrase / emoji / mixed → substring
    }
  }
  return n;
}

// Returns { label: 'positive'|'neutral'|'negative', score, intent: {key,label,tone}|null }
export function analyzeSentiment(raw) {
  const text = String(raw || "").toLowerCase().trim();
  if (!text) return { label: "neutral", score: 0, intent: null };

  const pos = countHits(text, POSITIVE);
  const neg = countHits(text, NEGATIVE);
  const score = pos - neg;
  const label = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";

  let intent = null;
  for (const it of INTENTS) {
    if (countHits(text, it.terms) > 0) {
      intent = { key: it.key, label: it.label, tone: it.tone };
      break;
    }
  }
  return { label, score, intent };
}

// Display styling for a sentiment label.
export const SENTIMENT_STYLE = {
  positive: { label: "Positive", cls: "bg-emerald-50 text-emerald-700", emoji: "🙂" },
  neutral: { label: "Neutral", cls: "bg-slate-100 text-slate-500", emoji: "😐" },
  negative: { label: "Negative", cls: "bg-rose-50 text-rose-700", emoji: "🙁" },
};

export const INTENT_STYLE = {
  good: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  bad: "bg-rose-100 text-rose-700",
  info: "bg-sky-100 text-sky-700",
};
