// End-to-end admin report for a date window. Aggregates every proven team-wide
// source into one structured model: top-of-funnel leads → quotes → contact →
// email engagement → OTP → bookings → revenue, plus per-rep detail, channel
// performance, source/city splits, and SLA/response distribution.
//
// Sources (all already used elsewhere in the app, so shapes are known-good):
//   fetchTeamQuotations            open quotes (funnel, pipeline, SLA, response)
//   fetchLeaderboard               bookings + rank per rep (period)
//   fetchCrmUsers                  rep roster
//   fetchActivitySummary(today)    calls / WhatsApp / idle per rep (today only)
//   fetchQuoteEmailStatus          latest quote-email status per customer
//   fetchOtpVerifiedIds            OTP-verified customer ids
//   fetchBookingSignals            email opens/clicks per customer
//   fetchWhatsappStatus            WhatsApp seen/last-seen per customer
//   fetchHouseholdLeads(from,to)   leads created in window (top of funnel)
import {
  fetchTeamQuotations,
  fetchTeamBookings,
  fetchReportCounts,
  fetchLeaderboard,
  fetchQuoteEmailStatus,
  fetchOtpVerifiedIds,
  fetchBookingSignals,
  fetchWhatsappStatus,
  dateInRange,
  ymd,
} from "./crm";
import { fetchCrmUsers, fetchHouseholdLeads } from "./leads";
import { fetchActivitySummary } from "./activity";
import { callDurationSecs } from "./leadScore";

const SLA_MINUTES = 15;
// Normalized rep-name key (null for empty/placeholder names).
const repKey = (name) => {
  const n = (name || "").trim().toLowerCase();
  return n && !/^user\s+\d+$/.test(n) && n !== "unassigned" && n !== "unknown" ? n : null;
};
const norm = (raw) => String(raw || "").toLowerCase().replace(/^email\./, "");
const isDelivered = (r) => ["delivered", "opened", "clicked"].includes(r);
const isOpened = (r) => ["opened", "clicked"].includes(r);

// Fake / low-effort follow-up: the rep marked the lead as worked (contacted,
// still open) but there's NO connected call logged — and either the follow-up
// was never even opened, or the note is empty/templated. Mirrors auditFollowup
// in leadScore.js ("a typed status with no call never counts as verified").
const GENERIC_NOTES = new Set(["", "ok", "okay", "done", "called", "calling", "contacted", "rnr", "no answer", "na", "n/a", "-", "follow up", "followup", "fu"]);
function genericNote(note) {
  const t = String(note || "").trim().toLowerCase();
  if (t.length < 8) return true;
  if (GENERIC_NOTES.has(t)) return true;
  const stripped = t.replace(/rnr|no answer|sent msg|\d|[\/.\-:]|\s/gi, "").trim();
  return stripped.length < 6;
}
// --- Lost-reason categorization (no structured field exists, so we parse the
// rep's free-text follow_up_note on lost/invalid quotes). Heuristic buckets. ---
// Order matters — specific outcomes first; RNR is checked LAST because it's
// usually just an attempt state, so a real reason in the same note wins.
const LOSS_RULES = [
  ["price", /price|cost|expens|costly|budget|\bhigh\b|charg|\brate\b|jyada|jada|mehang|kharch/i],
  ["competitor", /competitor|porter|agarwal|leo ?packers|vrl|other (company|vendor)|cheaper|sasta|kam (me|rate)/i],
  ["local_self", /\blocal\b|self ?stor|own (godown|place|home)|relative|\bghar\b|khud|home stor/i],
  ["distance", /\bfar\b|distance|too far|out of (area|service)|no service|not serv|location issue|\bdur\b/i],
  ["postponed", /later|postpon|next month|future|on hold|not now|baad|abhi nahi|reschedul|plan (chang|cancel)|shift(ed)? (plan|date)|drop(ped)? (the )?plan|will call|call after|after \d/i],
  ["not_interested", /not (interest|require|need|look|plan|want)|no (need|requirement|interest)|not looking|cancel|declin|dropped|already (shifted|done|stored|booked)|change(d)? (his |her )?mind/i],
  ["junk", /wrong number|wrong no\b|duplicate|\btest\b|\bspam\b|invalid number|number (not|wrong)|by mistake|fake|not a (lead|customer)/i],
  ["no_response", /\brnr\b|no (response|answer)|not (responding|reachable|picking|lifting)|switch(ed)? off|\bbusy\b|call ?back|unreach|not pick/i],
];
export function categorizeLoss(statusKey, note) {
  const t = String(note || "").toLowerCase();
  for (const [cat, re] of LOSS_RULES) {
    if (re.test(t)) return cat === "junk" ? "invalid" : cat; // genuine junk -> invalid bucket
  }
  // Nothing matched: invalid status with no telling note = junk; else unclear.
  return statusKey === "invalid" ? "invalid" : "other";
}
export const LOSS_LABELS = {
  price: "Price too high", competitor: "Chose competitor", no_response: "No response / RNR",
  postponed: "Postponed / later", local_self: "Local / self-storage", distance: "Distance / serviceability",
  not_interested: "Not interested", invalid: "Invalid / junk lead", other: "Other / unclear",
};
export const LOSS_ACTION = {
  price: "Pricing-objection coaching — offer the discount template earlier and lead with value (insurance, security, pickup).",
  competitor: "Build a competitor battlecard — emphasize warehouse trust kit, insurance and transparent pricing.",
  no_response: "Follow-up discipline — faster first response and a multi-touch WhatsApp cadence before giving up.",
  postponed: "Nurture future-dated leads — capture a follow-up date and a scheduled reminder sequence.",
  local_self: "Sell security & convenience vs self-storage — insurance, climate, pickup, retrieval.",
  distance: "Check serviceability up front and route to the nearest warehouse.",
  not_interested: "Qualify intent earlier; review lead sourcing feeding weak leads.",
  invalid: "Lead-quality issue — audit the source feeding junk/duplicate leads.",
  other: "Notes too vague — enforce a structured lost-reason at close so this is measurable.",
};

export function isFakeFollowup(q) {
  if (!q.contacted || q.won || q.lost) return false; // only open, claimed-as-contacted
  if (callDurationSecs(q.callDuration) > 0) return false; // a real call connected → genuine
  return !q.verified || genericNote(q.noteFull); // no call + (never opened OR empty/templated note)
}

function blankRep(id, name) {
  return {
    repId: id, name,
    leads: 0, quotes: 0, pipeline: 0,
    contacted: 0, notContacted: 0, overdue: 0, fakeFollowups: 0,
    todayBlank: 0, yesterdayBlank: 0, pending: 0, // blank/pending follow-ups (date-fixed)
    responseSum: 0, responseN: 0, slaBreaches: 0,
    emailSent: 0, delivered: 0, opened: 0, clicked: 0, otp: 0, waSeen: 0,
    whSent: 0, whViewed: 0, // warehouse images/video kit sent & viewed
    waSentWin: 0, waReadWin: 0, // window-accurate WhatsApp (from crm_report_counts)
    won: 0, lost: 0, revenue: 0,
    bookingsCount: 0, openQuotesCount: 0, // authoritative counts (travel through name-merge)
    bookings: 0, rank: null,
    calls: 0, whatsapps: 0, views: 0, idleMin: 0,
    stages: {},
    lostReasons: {}, // category -> count (from lost/invalid quotes)
  };
}

// The same rep can be attributed under >1 user-id across sources (e.g. after an
// RNR reassignment the quote's manager id differs from the booking/leaderboard
// id), which would split them into two rows. Merge records that share a real
// name into one, summing counters. Generic placeholders ("User 123",
// "Unassigned") are kept separate.
const NUMERIC_FIELDS = [
  "leads", "quotes", "pipeline", "contacted", "notContacted", "overdue",
  "responseSum", "responseN", "slaBreaches", "emailSent", "delivered", "opened", "clicked",
  "otp", "waSeen", "whSent", "whViewed", "won", "lost", "revenue", "bookingsCount", "openQuotesCount",
  "calls", "whatsapps", "views", "idleMin", "fakeFollowups", "waSentWin", "waReadWin",
  "todayBlank", "yesterdayBlank", "pending",
];
function consolidateByName(reps) {
  const byName = new Map();
  const out = [];
  for (const r of reps) {
    const nm = (r.name || "").trim().toLowerCase();
    const generic = !nm || /^user\s+\d+$/.test(nm) || nm === "unassigned" || nm === "unknown";
    if (generic || !byName.has(nm)) {
      if (!generic) byName.set(nm, r);
      out.push(r);
      continue;
    }
    const t = byName.get(nm);
    for (const k of NUMERIC_FIELDS) t[k] = (t[k] || 0) + (r[k] || 0);
    for (const [s, c] of Object.entries(r.stages || {})) t.stages[s] = (t.stages[s] || 0) + c;
    for (const [s, c] of Object.entries(r.lostReasons || {})) t.lostReasons[s] = (t.lostReasons[s] || 0) + c;
    if (r.rank != null && (t.rank == null || r.rank < t.rank)) t.rank = r.rank;
  }
  return out;
}

export async function fetchAdminReport({ from, to, signal } = {}) {
  const [quotes, bookingsRaw, counts, board, users, activity, emailStatus, otpIds, signals, waStatus, leadsRaw] = await Promise.all([
    fetchTeamQuotations({ signal }).catch(() => []),
    fetchTeamBookings({ signal }).catch(() => []),
    fetchReportCounts({ from, to, signal }).catch(() => null),
    fetchLeaderboard({ signal }).catch(() => []),
    fetchCrmUsers({ signal }).catch(() => []),
    fetchActivitySummary({ date: ymd(), signal }).catch(() => []),
    fetchQuoteEmailStatus({ signal }).catch(() => ({})),
    fetchOtpVerifiedIds({ signal }).catch(() => new Set()),
    fetchBookingSignals({ signal }).catch(() => ({})),
    fetchWhatsappStatus({ signal }).catch(() => ({})),
    fetchHouseholdLeads({ from, to, limit: 5000, signal }).catch(() => []),
  ]);

  // IMPORTANT: crm_team_quotations_data does NOT return relationship_manager_id —
  // only the rep's name. So the rep NAME is the reliable join key across every
  // source (quotes give name; counts give rm_id which we resolve to a name via
  // the roster). Key all rep records by normalized name; fall back to id only
  // when no name is known.
  const map = new Map();
  const idToName = new Map(); // relationship_manager_id -> display name
  for (const u of users) if (u.name) idToName.set(String(u.id), u.name);

  const ensure = (name, id) => {
    const nm = (name || "").trim();
    const key = repKey(nm) || (id != null && id !== "" ? `id:${id}` : "unassigned");
    if (!map.has(key)) map.set(key, blankRep(key, nm || (id != null && id !== "" ? `User ${id}` : "Unassigned")));
    const rec = map.get(key);
    if (nm && (!rec.name || /^user\s/i.test(rec.name) || rec.name === "Unassigned")) rec.name = nm;
    return rec;
  };
  for (const u of users) ensure(u.name, u.id); // seed the roster

  // ---- windowed quotes: the funnel backbone ----
  const windowed = quotes.filter((q) => dateInRange(q.createdAt, from, to));

  const channels = { emailSent: 0, delivered: 0, opened: 0, clicked: 0, otp: 0, waSeen: 0 };
  const sourceMap = new Map(); // source -> {quotes, bookings, pipeline}
  const cityMap = new Map();
  const stageMap = new Map();
  const respBuckets = { b0: 0, b15: 0, b30: 0, b60: 0 }; // <15, 15-30, 30-60, 60+
  let respSum = 0, respN = 0, slaBreaches = 0, pipeline = 0, revenue = 0;

  // Collect the actual customers behind the flagged metrics (sla / blank / pending)
  // so the agents page can expand them for "question the team" detail.
  const flaggedMap = new Map(); // quote id -> { repKey, name, city, status, note, ..., flags }
  const flagQuote = (q, rk, key) => {
    let f = flaggedMap.get(q.id);
    if (!f) {
      f = { id: q.id, repKey: rk, name: q.name, uid: q.uid, contact: q.contact, city: q.city, status: q.status, note: q.noteFull, createdAt: q.createdAt, followDate: q.followDate, value: q.value, sla: false, blankToday: false, blankYest: false, pending: false, lost: false, lostReason: null };
      flaggedMap.set(q.id, f);
    }
    f[key] = true;
  };

  for (const q of windowed) {
    const id = String(q.id);
    q._repKey = repKey(q.rep) || "unassigned"; // for drawer drill-down by rep name
    const r = ensure(q.rep); // team quotations only carry the rep NAME
    r.quotes += 1;
    r.pipeline += q.value || 0;
    pipeline += q.value || 0;
    if (q.contacted) r.contacted += 1; else r.notContacted += 1;
    if (q.bucket === "overdue" && !q.done) r.overdue += 1;
    if (isFakeFollowup(q)) r.fakeFollowups += 1;
    if (q.won) { r.won += 1; r.revenue += q.value || 0; revenue += q.value || 0; }
    if (q.lost) {
      r.lost += 1;
      const cat = categorizeLoss(q.statusKey, q.noteFull);
      r.lostReasons[cat] = (r.lostReasons[cat] || 0) + 1;
      flagQuote(q, q._repKey, "lost");
      flaggedMap.get(q.id).lostReason = cat;
    }

    // response time
    if (q.responseMins != null) {
      r.responseSum += q.responseMins; r.responseN += 1;
      respSum += q.responseMins; respN += 1;
      if (q.responseMins <= 15) respBuckets.b0++;
      else if (q.responseMins <= 30) respBuckets.b15++;
      else if (q.responseMins <= 60) respBuckets.b30++;
      else respBuckets.b60++;
    }
    const mins = q.createdAt ? Math.round((Date.now() - Date.parse(String(q.createdAt).replace(" ", "T"))) / 60000) : null;
    if (!q.contacted && !q.done && mins != null && mins > SLA_MINUTES) { r.slaBreaches += 1; slaBreaches += 1; flagQuote(q, q._repKey, "sla"); }

    // engagement signals
    const raw = norm(emailStatus[id]?.raw);
    if (emailStatus[id]) { r.emailSent += 1; channels.emailSent += 1; }
    if (isDelivered(raw)) { r.delivered += 1; channels.delivered += 1; }
    const eng = isOpened(raw) || (signals[id]?.opens || 0) >= 1;
    if (eng) { r.opened += 1; channels.opened += 1; }
    if (raw === "clicked" || (signals[id]?.clicked)) { r.clicked += 1; channels.clicked += 1; }
    if (otpIds.has?.(id) || otpIds.has?.(String(id))) { r.otp += 1; channels.otp += 1; }
    if (waStatus[id]?.seen) { r.waSeen += 1; channels.waSeen += 1; }

    // warehouse kit (images/video) — sent + viewed, from booking signals
    const sig = signals[id];
    if (sig?.warehouseStatus) r.whSent += 1;
    const wraw = sig?.warehouseStatus ? String(sig.warehouseStatus).toLowerCase().replace(/^email\./, "") : "";
    if (["opened", "clicked"].includes(wraw) || sig?.warehouseViewed) r.whViewed += 1;

    // source / city / stage
    const src = q.source || "Unknown";
    const s = sourceMap.get(src) || { name: src, quotes: 0, bookings: 0, pipeline: 0 };
    s.quotes++; s.pipeline += q.value || 0; if (q.won) s.bookings++; sourceMap.set(src, s);
    const city = q.city || "—";
    const c = cityMap.get(city) || { name: city, quotes: 0, bookings: 0, pipeline: 0 };
    c.quotes++; c.pipeline += q.value || 0; if (q.won) c.bookings++; cityMap.set(city, c);
    const st = q.stage || "Unstaged";
    stageMap.set(st, (stageMap.get(st) || 0) + 1);
    r.stages[st] = (r.stages[st] || 0) + 1;
  }

  // ---- blank & pending follow-ups (over ALL open quotes, date-fixed — not the
  // selected window). Blank = no note AND no follow-up date (nothing logged).
  // Pending = follow-up date is YESTERDAY and the call wasn't made (not
  // verified), excluding lost/invalid. ----
  const todayStr = ymd();
  const yestStr = ymd(new Date(Date.now() - 86400000));
  const LOST_INVALID = new Set(["lost", "invalid"]);
  for (const q of quotes) {
    const r = ensure(q.rep);
    const rk = repKey(q.rep) || "unassigned";
    const created = String(q.createdAt || "").slice(0, 10);
    const blank = !(q.noteFull && q.noteFull.trim()) && !q.followDate;
    if (blank && created === todayStr) { r.todayBlank += 1; flagQuote(q, rk, "blankToday"); }
    if (blank && created === yestStr) { r.yesterdayBlank += 1; flagQuote(q, rk, "blankYest"); }
    // q.followDate is already a "YYYY-MM-DD" string (parseDateOnly), not a Date.
    if (q.followDate === yestStr && !q.verified && !LOST_INVALID.has(q.statusKey)) { r.pending += 1; flagQuote(q, rk, "pending"); }
  }

  // ---- leads (top of funnel) ----
  const leadSourceMap = new Map();
  for (const l of leadsRaw) {
    const rid = l.relationship_manager_id ?? l.user_id;
    const name = `${l.user_fname || ""} ${l.user_lname || ""}`.trim() || idToName.get(String(rid)) || "";
    const r = ensure(name, rid);
    r.leads += 1;
    const ls = l.source || l.updated_from || "Direct";
    leadSourceMap.set(ls, (leadSourceMap.get(ls) || 0) + 1);
  }
  const totalLeads = leadsRaw.length;

  // ---- bookings & quote counts ----
  // Preferred source: crm_report_counts (mirrors report/booking_report exactly:
  // bookings by order_created_at in range, pickup, not cancelled; quotes =
  // distinct not-yet-converted customers). Falls back to show_bookings_data
  // (windowed) if the endpoint isn't deployed yet.
  let totalBooked;

  if (counts) {
    // bookings_by_rep carries names → also seed idToName so quotes/whatsapp
    // (which only have rm_id) can resolve to the same rep.
    for (const r of counts.bookings_by_rep || []) {
      const id = String(r.rm_id ?? "");
      const name = `${r.user_fname || ""} ${r.user_lname || ""}`.trim();
      if (name && id) idToName.set(id, name);
      ensure(name || idToName.get(id) || "", r.rm_id).bookingsCount = Number(r.cnt) || 0;
    }
    for (const r of counts.quotes_by_rep || []) {
      const id = String(r.rm_id ?? "");
      ensure(idToName.get(id) || "", r.rm_id).openQuotesCount = Number(r.cnt) || 0;
    }
    for (const r of counts.whatsapp_by_rep || []) {
      const id = String(r.rm_id ?? "");
      const rep = ensure(idToName.get(id) || "", r.rm_id);
      rep.waSentWin = Number(r.wa_sent) || 0;
      rep.waReadWin = Number(r.wa_read) || 0;
    }
    totalBooked = Number(counts.bookings_total) || 0;
  } else {
    // Fallback: real bookings windowed by order_created_at from show_bookings_data
    // (note: that endpoint is scoped to the current month's schedule date).
    const wonRows = bookingsRaw.filter((b) => dateInRange(b.date, from, to));
    for (const b of wonRows) {
      ensure(b.rep, b.repId).bookingsCount += 1;
      const s = sourceMap.get(b.source) || { name: b.source, quotes: 0, bookings: 0, pipeline: 0 };
      s.bookings += 1; sourceMap.set(b.source, s);
      const city = b.city || "—";
      const c = cityMap.get(city) || { name: city, quotes: 0, bookings: 0, pipeline: 0 };
      c.bookings += 1; cityMap.set(city, c);
    }
    totalBooked = wonRows.length;
  }

  // Leaderboard is a period ranking — use it ONLY for the rank badge.
  for (const b of board) { const r = ensure(b.name, b.userId); r.rank = b.rank ?? null; }

  // ---- today's activity ----
  for (const a of activity) {
    const id = String(a.user_id ?? a.userId ?? "");
    if (!id) continue;
    const name = `${a.user_fname || ""} ${a.user_lname || ""}`.trim() || idToName.get(id) || "";
    const r = ensure(name, id);
    r.calls = Number(a.calls || 0); r.whatsapps = Number(a.whatsapps || 0);
    r.views = Number(a.views || 0); r.idleMin = Number(a.idle_min || 0);
  }

  // ---- per-rep derived + filter to active ----
  // `quotesDetail` = quotes we have engagement/SLA detail for (open team
  // quotations). `quotes`/`bookings` shown are the authoritative counts when the
  // report-counts endpoint is available (so they match report/booking_report).
  const perRep = consolidateByName([...map.values()])
    .map((r) => {
      const bookings = r.bookingsCount || 0;
      // "Quotes" = the rep's open quotations from crm_team_quotations_data
      // (is_customer=0) — the SAME source/definition as the rep's own dashboard,
      // so the admin number matches what each agent sees. Bookings stay a
      // separate column (not folded into Quotes). Conversion = booked ÷ (quotes+booked).
      const quotes = r.quotes;
      const openQuotes = quotes;
      // WhatsApp: prefer the window-accurate counts (from crm_report_counts);
      // fall back to today's activity feed (sent) + engagement signal (seen).
      const waWindowed = !!(counts && counts.whatsapp_by_rep);
      const waSent = waWindowed ? r.waSentWin : r.whatsapps;
      const waSeen = waWindowed ? r.waReadWin : r.waSeen;
      return {
        ...r,
        quotesDetail: r.quotes, // open quotes we have engagement/SLA detail for
        openQuotes,
        quotes,
        bookings,
        waWindowed,
        waSent,
        waSeen,
        contactPct: r.quotes ? Math.round((r.contacted / r.quotes) * 100) : null,
        avgResponse: r.responseN ? Math.round(r.responseSum / r.responseN) : null,
        conversion: quotes ? Math.round((bookings / quotes) * 100) : 0,
      };
    })
    .filter((r) => r.quotes || r.quotesDetail || r.leads || r.bookings || r.calls || r.whatsapps || r.pending || r.todayBlank || r.yesterdayBlank)
    .sort((a, b) => b.pipeline - a.pipeline);

  // Window-based rank: who performed best IN THIS WINDOW (by bookings, then
  // conversion, then quotes) — NOT the all-time leaderboard. So a "Today" filter
  // ranks today's top booker #1.
  [...perRep]
    .sort((a, b) => b.bookings - a.bookings || b.conversion - a.conversion || b.quotes - a.quotes)
    .forEach((r, i) => { r.bookingRank = r.bookings > 0 ? i + 1 : null; });

  // "Quotes" = open quotations (team-quotations, is_customer=0) — matches the
  // sum of what each rep sees on their dashboard. Bookings counted separately.
  const totalQuotes = windowed.length;
  const totalContacted = windowed.filter((q) => q.contacted).length;
  const totalNotContacted = windowed.filter((q) => !q.contacted).length;
  // totalBooked is the real windowed bookings count (computed above).
  const engaged = channels.opened;
  const avgResponse = respN ? Math.round(respSum / respN) : null;

  // ---- lost-reason analysis (team aggregate + per-agent improvement points) ----
  const lossTeam = {};
  let lossTotal = 0;
  for (const r of perRep) for (const [c, n] of Object.entries(r.lostReasons || {})) { lossTeam[c] = (lossTeam[c] || 0) + n; lossTotal += n; }
  const teamShare = (c) => (lossTotal ? (lossTeam[c] || 0) / lossTotal : 0);
  const lossInsights = [];
  for (const r of perRep) {
    const lr = r.lostReasons || {};
    const repTotal = Object.values(lr).reduce((a, b) => a + b, 0);
    if (repTotal < 3) continue;
    const [cat, cnt] = Object.entries(lr).sort((a, b) => b[1] - a[1])[0];
    const share = cnt / repTotal;
    const ts = teamShare(cat);
    // Flag when one reason dominates this rep AND is above the team norm.
    if (share >= 0.4 && cnt >= 2 && (ts === 0 || share >= ts * 1.25)) {
      lossInsights.push({ rep: r.name, category: cat, count: cnt, repTotal, share: Math.round(share * 100), teamShare: Math.round(ts * 100), lostRate: r.quotes ? Math.round((r.lost / (r.quotes)) * 100) : 0 });
    }
  }
  lossInsights.sort((a, b) => b.count - a.count);
  const loss = { team: lossTeam, total: lossTotal, insights: lossInsights };

  // ---- funnel ----
  const base = totalLeads || totalQuotes || 1;
  const funnel = [
    { key: "leads", label: "Leads", count: totalLeads, of: base },
    { key: "quotes", label: "Quotes created", count: totalQuotes, of: base },
    { key: "contacted", label: "Contacted", count: totalContacted, of: totalQuotes || 1 },
    { key: "emailed", label: "Quote emailed", count: channels.emailSent, of: totalQuotes || 1 },
    { key: "engaged", label: "Engaged (opened)", count: engaged, of: totalQuotes || 1 },
    { key: "otp", label: "OTP verified", count: channels.otp, of: totalQuotes || 1 },
    { key: "booked", label: "Booked", count: totalBooked, of: totalQuotes || 1 },
  ];

  return {
    totals: {
      leads: totalLeads, quotes: totalQuotes, contacted: totalContacted,
      notContacted: totalNotContacted, booked: totalBooked,
      pipeline, revenue, avgResponse, slaBreaches,
      conversion: totalQuotes ? Math.round((totalBooked / totalQuotes) * 100) : 0,
      reps: perRep.length,
      calls: perRep.reduce((s, r) => s + r.calls, 0),
      whatsapps: perRep.reduce((s, r) => s + r.whatsapps, 0),
    },
    funnel,
    perRep,
    channels,
    sources: [...sourceMap.values()].sort((a, b) => b.quotes - a.quotes),
    leadSources: [...leadSourceMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    cities: [...cityMap.values()].sort((a, b) => b.pipeline - a.pipeline).slice(0, 12),
    stages: [...stageMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    sla: { within: respBuckets.b0, buckets: respBuckets, breaches: slaBreaches, avgResponse },
    quotes: windowed,
    flagged: [...flaggedMap.values()],
    loss,
  };
}
