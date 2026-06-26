// Escalation engine for the Quotations tab.
//
// Evaluates each quotation against the triggers we can DETECT from the data the
// API gives us, and returns the matched triggers + the highest escalation level:
//   L1 — Agent owns it (no escalation)
//   L2 — Team Lead (most triggers)
//   L3 — Manager (high-value-at-risk, or an L2 left unresolved too long)
//
// The "auto-action" on each trigger is a RECOMMENDATION shown in the UI.
// Actually performing it (reassign, send forced WhatsApp, block snooze, notify
// TL/Manager) needs backend endpoints + a worker — see notes per trigger.

const FINAL = new Set(["booked", "won", "converted", "lost", "invalid"]);

function minutesSince(dt) {
  if (!dt) return Infinity;
  const t = new Date(String(dt).replace(" ", "T"));
  if (isNaN(t)) return Infinity;
  return (Date.now() - t.getTime()) / 60000;
}
function daysSince(dt) {
  return minutesSince(dt) / 1440;
}
function ageLabel(dt) {
  const m = minutesSince(dt);
  if (!isFinite(m)) return "a while";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}
function rnrCount(note) {
  if (!note) return 0;
  return (String(note).match(/rnr/gi) || []).length;
}
export function fmtMins(m) {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

const LEVEL_RANK = { L1: 1, L2: 2, L3: 3 };

// Returns { triggers: [...], level: 'L2'|'L3'|null, top: trigger|null }
export function evaluateEscalation(q) {
  const triggers = [];
  if (FINAL.has(q.statusKey)) return { triggers, level: null, top: null };

  // 1) First-response breach — uncontacted quote sitting > 15 min.
  //    Auto-action (backend): reassign to an available agent.
  if (!q.contacted && minutesSince(q.createdAt) > 15) {
    triggers.push({
      key: "first_response",
      label: "No first response",
      level: "L2",
      tone: "bad",
      reason: `Not contacted — ${ageLabel(q.createdAt)} since created`,
      action: "Reassign to an available agent",
    });
  }

  // 1b) Slow first response — took > 15 min from creation to first contact.
  //     Auto-action: coach on speed-to-lead; reassign if it's a pattern.
  if (q.responseMins != null && q.responseMins > 15) {
    triggers.push({
      key: "slow_response",
      label: "Slow first response",
      level: "L2",
      tone: "bad",
      reason: `Took ${fmtMins(q.responseMins)} to first contact (SLA 15 min)`,
      action: "Coach on speed-to-lead",
    });
  }

  // 2) Overdue follow-up — due date passed, no verified call today.
  //    Auto-action: reminder → reassign if +24h.
  if (q.bucket === "overdue" && !q.doneToday) {
    triggers.push({
      key: "overdue",
      label: "Overdue follow-up",
      level: "L2",
      tone: "bad",
      reason: `${q.overdueDays}d overdue, no verified call today`,
      action: q.overdueDays >= 1 ? "Reminder → reassign if +24h" : "Reminder",
    });
  }

  // 3) RNR loop — 3+ RNRs logged, still no connect.
  //    Auto-action: force WhatsApp + try alternate number.
  if (q.statusKey === "rnr" && rnrCount(q.note) >= 3) {
    triggers.push({
      key: "rnr_loop",
      label: "RNR loop",
      level: "L2",
      tone: "warn",
      reason: `${rnrCount(q.note)} RNRs, zero connects`,
      action: "Force WhatsApp + alternate number",
    });
  }

  // 4) Stuck in stage — no movement in 5 days (3 if Negotiation).
  //    Auto-action: coaching flag.
  const stale = daysSince(q.lastContactAt || q.createdAt);
  const negotiating = /negoti/i.test(q.stage);
  if (q.stage && ((negotiating && stale >= 3) || (!negotiating && stale >= 5))) {
    triggers.push({
      key: "stuck",
      label: "Stuck in stage",
      level: "L2",
      tone: "warn",
      reason: `${Math.floor(stale)}d no movement in "${q.stage}"`,
      action: "Coaching flag",
    });
  }

  // 5) High-value at risk — ≥ ₹75k AND overdue/unverified → straight to L3.
  //    NEEDS quote value (not returned by crm_team_quotations_data yet).
  if (q.value && q.value >= 75000 && (q.bucket === "overdue" || !q.verified)) {
    triggers.push({
      key: "high_value",
      label: "High-value at risk",
      level: "L3",
      tone: "bad",
      reason: `₹${q.value.toLocaleString("en-IN")} overdue/unverified`,
      action: "Jump to top of TL/Manager queue",
    });
  }

  // Highest level among triggers …
  let level = null;
  for (const t of triggers) {
    if (!level || LEVEL_RANK[t.level] > LEVEL_RANK[level]) level = t.level;
  }
  // … promoted to L3 if an overdue item has been left unresolved too long.
  if (triggers.some((t) => t.key === "overdue") && q.overdueDays >= 2) level = "L3";

  // pick the most severe trigger as the headline
  const top =
    triggers.slice().sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0] || null;

  return { triggers, level, top };
}
