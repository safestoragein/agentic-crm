// Admin insights aggregator. Builds a per-rep performance model + team totals
// from existing, proven endpoints — no backend changes required:
//   - fetchTeamQuotations()  -> every open quote (pipeline, SLA, response time)
//   - fetchLeaderboard()     -> bookings per rep
//   - fetchCrmUsers()        -> the rep roster (so even zero-activity reps show)
//   - fetchActivitySummary() -> today's calls / WhatsApp / idle per rep
//
// Quotation-derived metrics respect the selected date window (createdAt in
// [from,to]); bookings + activity are point-in-time (see notes on the page).
import { fetchTeamQuotations, fetchLeaderboard, dateInRange, minutesAgo, ymd } from "./crm";
import { fetchCrmUsers } from "./leads";
import { fetchActivitySummary } from "./activity";

const SLA_MINUTES = 15;

function blankRep(id, name) {
  return {
    repId: id,
    name,
    open: 0, // open quotes created in window
    pipeline: 0, // ₹ value of those quotes
    contacted: 0,
    notContacted: 0,
    overdue: 0,
    slaBreaches: 0, // uncontacted & >15 min old
    responseSum: 0, // for avg first-response (minutes)
    responseN: 0,
    won: 0, // quotes marked won/booked within the window
    lost: 0,
    stages: {}, // pipeline_stage -> count
    bookings: 0, // from leaderboard (period bookings)
    rank: null,
    calls: 0, // today (activity summary)
    whatsapps: 0,
    views: 0,
    idleMin: 0,
  };
}

export async function fetchAdminInsights({ from, to, signal } = {}) {
  const [quotes, board, users, activity] = await Promise.all([
    fetchTeamQuotations({ signal }).catch(() => []),
    fetchLeaderboard({ signal }).catch(() => []),
    fetchCrmUsers({ signal }).catch(() => []),
    fetchActivitySummary({ date: ymd(), signal }).catch(() => []),
  ]);

  // Seed every known rep so zero-pipeline reps still appear.
  const map = new Map();
  for (const u of users) map.set(String(u.id), blankRep(String(u.id), u.name));

  const ensure = (id, name) => {
    const key = String(id ?? "");
    if (!map.has(key)) map.set(key, blankRep(key, name || `User ${key}`));
    return map.get(key);
  };

  // --- quotation-derived metrics (respect the date window) ---
  const windowed = [];
  for (const q of quotes) {
    if (!dateInRange(q.createdAt, from, to)) continue;
    windowed.push(q);
    const r = ensure(q.repId || "unassigned", q.rep);
    r.open += 1;
    r.pipeline += q.value || 0;
    if (q.contacted) r.contacted += 1;
    else r.notContacted += 1;
    if (q.bucket === "overdue" && !q.done) r.overdue += 1;
    if (q.won) r.won += 1;
    if (q.lost) r.lost += 1;
    const mins = minutesAgo(q.createdAt);
    if (!q.contacted && !q.done && mins != null && mins > SLA_MINUTES) r.slaBreaches += 1;
    if (q.responseMins != null) {
      r.responseSum += q.responseMins;
      r.responseN += 1;
    }
    const stage = q.stage || "Unstaged";
    r.stages[stage] = (r.stages[stage] || 0) + 1;
  }

  // --- bookings + rank (leaderboard) ---
  for (const b of board) {
    const r = ensure(b.userId, b.name);
    r.bookings = b.bookings || 0;
    r.rank = b.rank ?? null;
  }

  // --- today's activity (calls / WhatsApp / idle) ---
  for (const a of activity) {
    const id = String(a.user_id ?? a.userId ?? "");
    if (!id) continue;
    const r = ensure(id, `${a.user_fname || ""} ${a.user_lname || ""}`.trim());
    r.calls = Number(a.calls || 0);
    r.whatsapps = Number(a.whatsapps || a.whatsapp || 0);
    r.views = Number(a.views || a.customers || 0);
    r.idleMin = Number(a.idle_min || 0);
  }

  // Derived per-rep fields.
  const reps = [...map.values()].map((r) => {
    const avgResponse = r.responseN ? Math.round(r.responseSum / r.responseN) : null;
    const slaBase = r.contacted + r.slaBreaches; // contacted vs should-have-been
    const slaPct = slaBase ? Math.round((r.contacted / slaBase) * 100) : null;
    const convBase = r.open + r.bookings;
    const conversion = convBase ? Math.round((r.bookings / convBase) * 100) : 0;
    return { ...r, avgResponse, slaPct, conversion };
  });

  // Hide reps with no footprint at all (no quotes, no bookings, no activity).
  const active = reps.filter(
    (r) => r.open || r.bookings || r.calls || r.whatsapps || r.views
  );

  const totals = active.reduce(
    (t, r) => {
      t.open += r.open;
      t.pipeline += r.pipeline;
      t.bookings += r.bookings;
      t.slaBreaches += r.slaBreaches;
      t.notContacted += r.notContacted;
      t.calls += r.calls;
      t.whatsapps += r.whatsapps;
      t.responseSum += r.responseSum;
      t.responseN += r.responseN;
      return t;
    },
    { reps: active.length, open: 0, pipeline: 0, bookings: 0, slaBreaches: 0, notContacted: 0, calls: 0, whatsapps: 0, responseSum: 0, responseN: 0 }
  );
  totals.avgResponse = totals.responseN ? Math.round(totals.responseSum / totals.responseN) : null;
  const convBase = totals.open + totals.bookings;
  totals.conversion = convBase ? Math.round((totals.bookings / convBase) * 100) : 0;

  // Default sort: highest pipeline first.
  active.sort((a, b) => b.pipeline - a.pipeline);
  return { reps: active, totals, quotes: windowed };
}
