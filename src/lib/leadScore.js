// Local (no-API-key) lead priority scoring + fake/low-effort follow-up audit.
// Pure rules over the data we already have — deterministic, free, explainable.

// ---- helpers ----------------------------------------------------------------
export function callDurationSecs(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map((n) => parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function timeDiffSecs(a, b) {
  if (!a || !b || String(a).startsWith("0000") || String(b).startsWith("0000")) return 0;
  const x = new Date(String(a).replace(" ", "T")).getTime();
  const y = new Date(String(b).replace(" ", "T")).getTime();
  if (isNaN(x) || isNaN(y) || y <= x) return 0;
  return Math.round((y - x) / 1000);
}

// Best estimate of a connected-call duration for a customer/quote row.
export function contactSecs(c, quotes = []) {
  let secs = callDurationSecs(c?.quote_call_duration) || callDurationSecs(c?.call_duration);
  if (!secs) secs = timeDiffSecs(c?.follow_up_start_time, c?.follow_up_end_time);
  if (!secs) {
    for (const q of quotes) {
      secs = callDurationSecs(q?.quote_call_duration) || callDurationSecs(q?.call_duration);
      if (secs) break;
    }
  }
  return secs;
}

function hoursSince(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const t = new Date(String(dt).replace(" ", "T")).getTime();
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 3600000);
}

function rnrCount(note) {
  return note ? (String(note).match(/rnr/gi) || []).length : 0;
}

const GENERIC_NOTES = ["", "ok", "okay", "done", "called", "calling", "contacted", "rnr", "no answer", "na", "n/a", "-", "follow up", "followup", "fu"];
function isGenericNote(note) {
  const t = String(note || "").trim().toLowerCase();
  if (t.length < 8) return true;
  if (GENERIC_NOTES.includes(t)) return true;
  // mostly just "rnr"/"no answer" repeated
  const stripped = t.replace(/rnr|no answer|sent msg|\d|[\/.\-:]|\s/gi, "").trim();
  return stripped.length < 6;
}

// ---- 1) priority score ------------------------------------------------------
// Returns { tier:'hot'|'warm'|'cold', score:0-100, reasons:[{text,delta}] }
export function scoreCustomer(c, quotes = []) {
  if (!c) return { tier: "cold", score: 0, reasons: [] };
  let score = 40;
  const reasons = [];
  const add = (delta, text) => {
    score += delta;
    reasons.push({ text, delta });
  };

  const status = String(c.follow_up || "").toLowerCase();
  const stage = String(c.pipeline_stage || "").toLowerCase();
  const openQuote = quotes.some((q) => String(q.follow_up || "").toLowerCase() !== "booked" && String(c.is_customer) !== "1");

  // intent from status
  if (status === "converted-to-quote") add(25, "Converted to quote — high intent");
  else if (status === "follow-up-needed" || status === "contacted") add(10, "Actively in follow-up");
  else if (status === "rnr-lead" || status === "rnr") add(-15, "RNR — not reachable");
  else if (status === "invalid-lead" || status === "lost-lead" || status === "lost" || status === "invalid") add(-45, "Marked lost/invalid");

  if (stage.includes("quot")) add(10, "Has a quotation in pipeline");
  if (quotes.length > 0) add(8, `${quotes.length} quote${quotes.length > 1 ? "s" : ""} on file`);
  if (openQuote) add(8, "Open quote not yet booked");

  // value
  const value = quotes.reduce((s, q) => s + (Number(q.total_storage_charges_with_gst) || 0) + (Number(q.total_pickup_charges_with_gst) || 0), 0);
  if (value >= 15000) add(12, "High quote value");
  else if (value >= 5000) add(6, "Moderate quote value");

  // recency
  const ageH = hoursSince(c.customer_created_at || c.created_at || c.date);
  if (ageH != null) {
    if (ageH <= 24) add(20, "Fresh lead (<24h)");
    else if (ageH <= 72) add(10, "Recent (<3 days)");
    else if (ageH > 24 * 14) add(-12, "Stale (>2 weeks)");
  }

  // verified
  if (String(c.verified).toLowerCase() === "yes" || c.follow_up_start_time) add(8, "Phone verified / contacted");

  // RNR fatigue
  const rnr = rnrCount(c.follow_up_note);
  if (rnr >= 3) add(-12, `Dialled ${rnr}+ times, no connect`);
  else if (rnr === 2) add(-6, "Dialled twice, no connect");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = score >= 65 ? "hot" : score >= 35 ? "warm" : "cold";
  // strongest signals first
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { tier, score, reasons: reasons.slice(0, 5) };
}

// ---- 2) fake / low-effort follow-up audit -----------------------------------
// Returns { flagged:bool, severity:'high'|'medium'|null, issues:[{severity,text}] }
export function auditFollowup(c, quotes = []) {
  if (!c) return { flagged: false, severity: null, issues: [] };
  const issues = [];
  const status = String(c.follow_up || "").toLowerCase();
  const note = String(c.follow_up_note || "");
  const secs = contactSecs(c, quotes);
  const hasNote = note.trim().length > 0;
  const generic = isGenericNote(note);
  const contactStatus = ["contacted", "converted-to-quote", "follow-up-needed"].includes(status);

  // 1) claims contact but no call + no real note
  if (contactStatus && secs === 0 && generic) {
    issues.push({
      severity: "high",
      text: `Marked “${prettyStatus(status)}” but no connected call is logged and the note is ${hasNote ? "generic/templated" : "empty"}. No evidence the customer was actually spoken to.`,
    });
  }
  // 2) contacted status but note only logs RNR/no-answer
  else if (status === "contacted" && /rnr|no answer/i.test(note) && !/spoke|talked|interested|quote|price|book|will|asked/i.test(note)) {
    issues.push({
      severity: "high",
      text: "Status says “Contacted”, but the note only records RNR / no-answer — that is not a contact.",
    });
  }

  // 3) follow-up opened but no duration (call never connected/logged)
  if (c.follow_up_start_time && secs === 0 && contactStatus) {
    issues.push({
      severity: "medium",
      text: "Follow-up was opened but no call duration was recorded — the call may not have connected.",
    });
  }

  // 4) status changed with no note at all
  if (status && status !== "new" && !hasNote) {
    issues.push({
      severity: "medium",
      text: `Status set to “${prettyStatus(status)}” with no note explaining what happened.`,
    });
  }

  // 5) copy-paste / templated note across one trail (same chunk repeated)
  const chunks = note.split(/\d{1,2}[\/\-]\d{1,2}|\d{1,2}\s+\w{3,}/).map((s) => s.trim()).filter((s) => s.length > 6);
  if (chunks.length >= 3) {
    const uniq = new Set(chunks.map((s) => s.toLowerCase()));
    if (uniq.size === 1) {
      issues.push({ severity: "medium", text: "Every follow-up note is identical — looks copy-pasted rather than a real update each time." });
    }
  }

  // de-dup by text, pick worst severity
  const seen = new Set();
  const deduped = issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
  const flagged = deduped.length > 0;
  const severity = flagged ? (deduped.some((i) => i.severity === "high") ? "high" : "medium") : null;
  return { flagged, severity, issues: deduped };
}

function prettyStatus(s) {
  return String(s || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export const TIER_STYLE = {
  hot: { label: "Hot", cls: "bg-rose-100 text-rose-700 ring-rose-200", bar: "bg-rose-500" },
  warm: { label: "Warm", cls: "bg-amber-100 text-amber-700 ring-amber-200", bar: "bg-amber-500" },
  cold: { label: "Cold", cls: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-400" },
};
