// SLA timers for the team board. Computes live, now-relative timers for each
// quote against the same thresholds the escalation engine uses:
//   - first response : 15 min from creation until first contact
//   - time in stage  : 5 days of no movement (3 if Negotiation)
//   - RNR age        : 1 day stuck in RNR (the auto-reassignment threshold)
//   - overdue f/up   : follow-up date passed (already breached)
//
// Each timer reports remaining-to-breach so the board can sort by urgency and
// flag "breaching soon". Pure functions of (quote, now) so a 1s clock tick
// re-renders countdowns without refetching.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Closed/dead quotes carry no live SLA — never flag them as breached.
const FINAL = new Set(["booked", "won", "converted", "lost", "invalid", "closed", "discard", "discarded"]);

function ms(dt) {
  if (!dt || String(dt).startsWith("0000")) return null;
  const t = new Date(String(dt).replace(" ", "T")).getTime();
  return isNaN(t) ? null : t;
}

// Per-timer "breaching soon" window — flagged when remaining is positive but
// within this slice of the limit.
function soonWindow(limit) {
  return Math.min(limit * 0.25, 4 * HOUR);
}

function mk(type, label, startedAt, limit, now, opts = {}) {
  const start = ms(startedAt);
  if (start == null) return null;
  const elapsed = now - start;
  const remaining = limit - elapsed;
  let status = "ok";
  if (remaining <= 0) status = "breached";
  else if (remaining <= soonWindow(limit)) status = "soon";
  return { type, label, limit, elapsed, remaining, status, ...opts };
}

// Returns { timers: [...], worst, status, breached } for a quote, or null when
// the quote is done/closed (no live SLA).
export function slaFor(q, now = Date.now()) {
  if (!q || FINAL.has(q.statusKey) || q.done) return null;
  const timers = [];

  // First response — only while still uncontacted (a met/missed first response
  // is historical, surfaced separately via responseMins).
  if (!q.contacted) {
    const t = mk("first_response", "First response", q.createdAt, 15 * MIN, now);
    if (t) timers.push(t);
  }

  // RNR age — stuck in RNR past the 1-day reassignment threshold.
  if (q.statusKey === "rnr" && q.rnrSince) {
    const t = mk("rnr_age", "RNR age", q.rnrSince, 1 * DAY, now);
    if (t) timers.push(t);
  }

  // Time in stage — no movement in 5 days (3 if Negotiation).
  if (q.stage) {
    const negotiating = /negoti/i.test(q.stage);
    const t = mk("time_in_stage", "Time in stage", q.lastContactAt || q.createdAt, (negotiating ? 3 : 5) * DAY, now, {
      stage: q.stage,
    });
    if (t) timers.push(t);
  }

  // Overdue follow-up — already past due (breached the day it was due).
  if (q.bucket === "overdue" && q.followDate) {
    const due = new Date(q.followDate + "T23:59:59").getTime();
    timers.push({
      type: "overdue_followup",
      label: "Overdue follow-up",
      limit: 0,
      elapsed: now - due,
      remaining: due - now,
      status: "breached",
    });
  }

  if (timers.length === 0) return null;

  // Worst = breached-by-most, else soonest to breach.
  const worst = [...timers].sort((a, b) => a.remaining - b.remaining)[0];
  const status = timers.some((t) => t.status === "breached")
    ? "breached"
    : timers.some((t) => t.status === "soon")
    ? "soon"
    : "ok";
  return { timers, worst, status, breached: status === "breached" };
}

// "2h 14m", "3d 4h", "12m", or "0m". Always non-negative magnitude.
export function fmtDur(msVal) {
  const v = Math.abs(msVal);
  if (v < MIN) return "0m";
  if (v < HOUR) return `${Math.floor(v / MIN)}m`;
  if (v < DAY) {
    const h = Math.floor(v / HOUR);
    const m = Math.floor((v % HOUR) / MIN);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(v / DAY);
  const h = Math.floor((v % DAY) / HOUR);
  return h ? `${d}d ${h}h` : `${d}d`;
}
