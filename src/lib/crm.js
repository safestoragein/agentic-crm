// Aggregates the report_analysis endpoints into a per-user dashboard model.
// Everything here is real data scoped to the logged-in CRM user.
//
// KPI counts are computed CLIENT-SIDE from dated detail lists so the dashboard
// can be filtered by any date range (the count endpoints are month-only).

import { apiGet, apiPostForm, toList } from "./api";

const DONE_STATES = new Set(["booked", "lost", "invalid", "converted", "won"]);

// Normalizes a follow_up status to a canonical slug so that the stored label form
// ("Follow Up Needed", "Price Match", "RNR") and the slug form ("follow-up-needed",
// "price-match", "rnr") compare equal. Use this on BOTH sides of every status match.
export function normStatus(v) {
  return String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

// All selectable follow_up statuses (the full set the team uses), so the status
// filter always offers every option, not just the ones present in the data.
export const FOLLOWUP_STATUSES = [
  "contacted",
  "rnr",
  "called",
  "no-answer",
  "call-later",
  "sent-message",
  "follow-up-needed",
  "qualified",
  "lost",
  "invalid",
  "closed",
];

export function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateOnly(value) {
  if (!value || String(value).startsWith("0000")) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// True when a value is a real stored datetime (not null/empty/zero/time-only).
function hasDateTime(value) {
  if (!value) return false;
  const s = String(value).trim();
  if (!s || s.startsWith("0000")) return false;
  return parseDateOnly(s) != null; // requires a YYYY-MM-DD prefix
}

function daysBetween(fromYmd, toYmd) {
  const a = new Date(fromYmd + "T00:00:00");
  const b = new Date(toYmd + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// Is the date part of `value` within [from, to] inclusive?
export function dateInRange(value, from, to) {
  const d = parseDateOnly(value);
  if (!d) return false;
  return d >= from && d <= to;
}

// Build a {from, to, label} window for a preset key.
export function rangeForPreset(preset) {
  const now = new Date();
  const today = ymd(now);
  switch (preset) {
    case "today":
      return { from: today, to: today, label: "Today" };
    case "yesterday": {
      const y = ymd(new Date(now.getTime() - 86400000));
      return { from: y, to: y, label: "Yesterday" };
    }
    case "3d": {
      const from = ymd(new Date(now.getTime() - 2 * 86400000));
      return { from, to: today, label: "Last 3 days" };
    }
    case "7d": {
      const from = ymd(new Date(now.getTime() - 6 * 86400000));
      return { from, to: today, label: "Last 7 days" };
    }
    case "all":
      // Whole history — clears the date window so every quotation shows.
      return { from: "2000-01-01", to: "2999-12-31", label: "All dates" };
    case "month":
    default:
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: "This month" };
  }
}

export function minutesAgo(datetime) {
  if (!datetime) return null;
  const t = new Date(String(datetime).replace(" ", "T"));
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
}

export function timeAgoLabel(datetime) {
  const m = minutesAgo(datetime);
  if (m == null) return "";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Core fetch — fast endpoints. Returns raw dated lists + live (now-relative)
// derivations (follow-up buckets, call-next). KPI counts are computed later.
// ---------------------------------------------------------------------------
// Follow-ups due today — replicates the legacy `report/follow_up_customers`
// page: distinct customers (grouped per customer) who are still leads
// (is_customer='0'), whose follow_up_date is today and whose status isn't
// 'closed'. No is_available / created-date restriction. The
// crm_team_quotations_data_follow_ups endpoint already groups per customer and
// filters is_customer='0', so we only narrow to today + not-closed.
export async function fetchFollowupsDueToday(userId, { signal } = {}) {
  const today = ymd();
  const res = await apiPostForm(
    "crm_team_quotations_data_follow_ups",
    { relationship_manager_id: userId },
    { signal }
  );
  return toList(res).filter((r) => {
    const d = String(r.follow_up_date || "").slice(0, 10);
    const status = normStatus(r.follow_up);
    return d === today && status !== "closed";
  });
}

// Sidebar nav badge counts for the logged-in rep, from the moderate data bundle
// (quotes + bookings + follow-ups) so it's fast. Returns a map keyed by href.
//   /quotations       new quotations created today
//   /follow-ups       follow-ups due today
//   /blank-followups  blank (created today/yesterday, no follow-up) + overdue
//   /booking-report   bookings won today
//   /logs             follow-ups actually logged today (productivity)
export async function fetchNavCounts(userId, { signal } = {}) {
  const today = ymd();
  const yesterday = ymd(new Date(Date.now() - 86400000));
  const dOnly = (d) => String(d || "").slice(0, 10);
  const [quotesRaw, bookingsRaw, fuRows] = await Promise.all([
    apiPostForm("crm_team_quotations_data", { relationship_manager_id: userId }, { signal }).catch(() => null),
    apiGet("show_bookings_data", { signal }).catch(() => null),
    fetchFollowupsDueToday(userId, { signal }).catch(() => []),
  ]);
  const quotes = toList(quotesRaw);
  const bookings = toList(bookingsRaw).filter((b) => String(b.relationship_manager_id) === String(userId));

  // Blank / Overdue nav badge = blank (fresh, un-contacted) + overdue (past due,
  // not invalid/lost) — matches the two tabs on that page.
  const DEAD = new Set(["invalid", "lost"]);
  const blank = quotes.filter((q) => {
    const d = dOnly(q.created_at);
    if (d !== today && d !== yesterday) return false;
    const s = normStatus(q.follow_up);
    return !q.follow_up || !s || s === "none";
  }).length;
  const overdue = quotes.filter((q) => {
    const fd = dOnly(q.follow_up_date);
    return fd && fd < today && !DEAD.has(normStatus(q.follow_up));
  }).length;

  return {
    "/quotations": quotes.filter((q) => dOnly(q.created_at) === today).length,
    "/follow-ups": (fuRows || []).length,
    "/blank-followups": blank + overdue,
    "/booking-report": bookings.filter((b) => dOnly(b.order_created_at) === today).length,
    "/logs": quotes.filter((q) => dOnly(q.follow_up_start_time) === today).length,
  };
}

// Today's new leads for the rep. Separate call — the leads payload is heavy
// (~6.6MB), so it must never block the other nav badges.
export async function fetchLeadsTodayCount(userId, { signal } = {}) {
  const today = ymd();
  const raw = await apiGet("get_crm_leads_data", { signal });
  return toList(raw).filter(
    (l) => String(l.relationship_manager_id) === String(userId) && String(l.date || "").slice(0, 10) === today
  ).length;
}

export async function fetchCore(userId, { signal } = {}) {
  const [ranking, quotes, bookings, fuRows] = await Promise.all([
    apiGet("show_user_booking_ranking", { signal }).catch(() => null),
    apiPostForm("crm_team_quotations_data", { relationship_manager_id: userId }, { signal }).catch(() => null),
    apiGet("show_bookings_data", { signal }).catch(() => null),
    // Follow-ups due today, matching the legacy household_quotation_followup page.
    fetchFollowupsDueToday(userId, { signal }).catch(() => []),
  ]);

  const today = ymd();
  const quoteList = toList(quotes);
  const bookingList = toList(bookings).filter(
    (b) => String(b.relationship_manager_id) === String(userId)
  );

  // ---- Ranking ----
  const board = ranking?.data || [];
  const myRankRow = board.find((r) => String(r.user_id) === String(userId));
  const rank = {
    position: myRankRow ? myRankRow.rank : null,
    total: board.length,
    top: board[0] || null,
    myBookings: myRankRow ? myRankRow.bookings : 0,
  };

  // ---- Follow-ups due today (household_quotation_followup logic) ----
  // One entry per available quotation due today, so dueToday.length matches the
  // legacy page's count exactly.
  const dueToday = (fuRows || []).map((q) => ({
    id: q.customer_id,
    name: q.customer_name || "Unknown",
    contact: q.customer_contact1,
    email: q.customer_email,
    city: q.customer_local_city,
    stage: q.pipeline_stage,
    status: q.follow_up,
    note: latestNote(q.follow_up_note),
    followDate: parseDateOnly(q.follow_up_date),
    bucket: "today",
    // follow_up_start_time stamped today = the rep already called today, so it
    // drops out of the call queue.
    doneToday: parseDateOnly(q.follow_up_start_time) === today,
  }));

  // Today's call list: has a phone, not yet called today, deduped by customer so
  // a person with two open quotes isn't queued twice.
  const seenInQueue = new Set();
  const callQueue = dueToday.filter((x) => {
    if (!x.contact || x.doneToday || seenInQueue.has(x.id)) return false;
    seenInQueue.add(x.id);
    return true;
  });

  // ---- Productivity + contact quality + speed-to-lead ----
  // doneToday   = follow-ups LOGGED today (rep stamped follow_up_start_time)
  // verifiedToday = of those, the ones backed by a CONNECTED call (duration > 0)
  //   — the anti-fake signal: a typed status with no call never counts as verified.
  // responseSamples = first-response speed per quote (creation → first touch),
  //   so the dashboard can show avg response + % answered fast, by date range.
  let doneTodayCount = 0;
  let verifiedTodayCount = 0;
  const responseSamples = [];
  for (const q of quoteList) {
    if (parseDateOnly(q.follow_up_start_time) === today) {
      doneTodayCount++;
      if (callDurationSecs(q) > 0) verifiedTodayCount++;
    }
    if (q.follow_up_start_time && q.created_at) {
      const c = new Date(String(q.created_at).replace(" ", "T"));
      const s = new Date(String(q.follow_up_start_time).replace(" ", "T"));
      const mins = Math.round((s - c) / 60000);
      if (!isNaN(mins) && mins >= 0) responseSamples.push({ date: q.created_at, mins });
    }
  }

  // ---- Pipeline by stage (active quotations only) ----
  const stageCounts = {};
  for (const q of quoteList) {
    if (DONE_STATES.has(normStatus(q.follow_up))) continue;
    const stage = q.pipeline_stage && q.pipeline_stage.trim() ? q.pipeline_stage.trim() : "Unstaged";
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }
  const pipeline = Object.entries(stageCounts)
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // ---- Raw dated lists for client-side KPI counting ----
  const quoteDates = quoteList.map((q) => q.created_at);
  const bookingDates = bookingList.map((b) => b.order_created_at);

  return {
    rank,
    followUps: { dueToday },
    callQueue,
    doneTodayCount,
    verifiedTodayCount,
    responseSamples,
    pipeline,
    quoteDates,
    bookingDates,
  };
}

// Connected-call length in seconds from a quotation row. Handles a plain seconds
// number ("83"), or "HH:MM:SS" / "MM:SS" strings. 0 = no connected call logged
// (the signal that a "contacted" status may be a fake follow-up).
export function callDurationSecs(q) {
  const raw = q?.quote_call_duration || q?.call_duration || "";
  if (raw == null || raw === "") return 0;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map((n) => parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// ---------------------------------------------------------------------------
// Leads fetch — heavy team-wide payload (~6.6MB). Loaded separately so it never
// blocks the rest of the dashboard. Returns dated list + live uncontacted leads.
// ---------------------------------------------------------------------------
export async function fetchLeads(userId, { signal } = {}) {
  const leadsRaw = await apiGet("get_crm_leads_data", { signal });
  const mine = toList(leadsRaw).filter(
    (l) => String(l.relationship_manager_id) === String(userId)
  );
  const today = ymd();

  const uncontacted = mine.filter((l) => !l.follow_up && !l.pipeline_stage);

  // True lead→quote conversion: ss_leads rows flagged is_converted_to_quot = 1.
  // (Needs the backend to expose the column; until then we fall back — see flag.)
  const hasConvertedFlag =
    mine.length > 0 && Object.prototype.hasOwnProperty.call(mine[0], "is_converted_to_quot");
  const convertedDates = mine
    .filter((l) => String(l.is_converted_to_quot) === "1")
    .map((l) => l.date);

  // ---- Leads-to-call queue: overdue lead follow-ups → due today → new ----
  const overdueLeads = [];
  const dueLeads = [];
  for (const l of mine) {
    if (DONE_STATES.has(normStatus(l.follow_up))) continue;
    if (!l.customer_mobile_no) continue;
    const fd = parseDateOnly(l.follow_up_date);
    if (!fd) continue;
    if (leadDoneToday(l, today)) continue; // already actioned today
    const base = {
      id: l.id,
      name: l.customer_name || "Unknown",
      contact: l.customer_mobile_no,
      source: prettySource(l.source),
      storage: prettyStorage(l.storage_type),
      assignedAt: l.date,
    };
    const delta = daysBetween(fd, today);
    if (delta > 0) overdueLeads.push({ ...base, overdueDays: delta });
    else if (delta === 0) dueLeads.push(base);
  }
  overdueLeads.sort((a, b) => b.overdueDays - a.overdueDays);

  const newOnes = uncontacted
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((l) => ({
      id: l.id,
      name: l.customer_name || "Unknown",
      contact: l.customer_mobile_no,
      source: prettySource(l.source),
      storage: prettyStorage(l.storage_type),
      assignedAt: l.date,
    }));

  const leadsToCall = [
    ...overdueLeads.map((x) => ({ ...x, kind: "overdue", badge: `${x.overdueDays}d overdue`, tone: "bad" })),
    ...dueLeads.map((x) => ({ ...x, kind: "today", badge: "due today", tone: "warn" })),
    ...newOnes.map((x) => ({ ...x, kind: "new", badge: "new", tone: "info" })),
  ].slice(0, 6);

  return {
    leadDates: mine.map((l) => l.date),
    convertedDates,
    hasConvertedFlag,
    newLeadsCount: uncontacted.length,
    callableCount: overdueLeads.length + dueLeads.length + uncontacted.length,
    leadsToCall,
  };
}

// Leads have no follow_up_start_time, so "actioned today" is detected from a
// today-stamped activity_history entry or follow-up note.
function leadDoneToday(lead, today) {
  if (lead.activity_history && String(lead.activity_history).includes(today)) return true;
  const parts = noteLines(lead.follow_up_note);
  const last = parts[parts.length - 1] || "";
  return last.startsWith(today);
}

// ---------------------------------------------------------------------------
// Full quotations list for the logged-in user, normalised for the table view.
// ---------------------------------------------------------------------------
export async function fetchQuotations(userId, { signal } = {}) {
  const raw = await apiPostForm(
    "crm_team_quotations_data",
    { relationship_manager_id: userId },
    { signal }
  );
  const today = ymd();
  return toList(raw).map((q) => mapQuotationRow(q, today));
}

// Follow-up cohort for the /follow-ups page — same source the dashboard's
// "Follow-ups due today" uses (crm_team_quotations_data_follow_ups: per
// customer, is_customer='0', keyed on follow_up_date), so the page's "Due
// today" count and customer list match the home page exactly.
export async function fetchFollowupCohort(userId, { signal } = {}) {
  const raw = await apiPostForm(
    "crm_team_quotations_data_follow_ups",
    { relationship_manager_id: userId },
    { signal }
  );
  const today = ymd();
  return toList(raw).map((q) => mapQuotationRow(q, today));
}

// Log / update a quotation follow-up — posts to the SAME endpoint the mobile
// app uses (report_analysis/update_quotation_followups_data) with the same
// fields, so app and website write identically. The backend appends the note
// with a timestamp and maintains the RNR clock; it does not require the call
// start/end time (those are stamped separately by the app on call-disconnect).
export async function updateQuotationFollowup(
  {
    customerId,
    pipelineStage,
    contactMethod,
    followUp, // the outcome
    quoteCallDuration,
    followUpDate,
    followUpNote,
    activityHistory,
    followUpStartTime,
    followUpEndTime,
  },
  { signal } = {}
) {
  const fields = {
    customer_id: customerId,
    pipeline_stage: pipelineStage,
    contact_method: contactMethod,
    follow_up: followUp,
  };
  if (quoteCallDuration) fields.quote_call_duration = quoteCallDuration;
  if (followUpDate) fields.follow_up_date = followUpDate;
  if (followUpNote) fields.follow_up_note = followUpNote;
  if (activityHistory) fields.activity_history = activityHistory;
  if (followUpStartTime) fields.follow_up_start_time = followUpStartTime;
  if (followUpEndTime) fields.follow_up_end_time = followUpEndTime;
  const res = await apiPostForm("update_quotation_followups_data", fields, { signal });
  return res?.status === "success" || res?.status === true;
}

// Lightweight lead follow-up save — updates only follow_up, follow_up_date and
// (appends) follow_up_note on ss_leads. Backed by agentic_crm/update_lead_follow_up,
// which won't clobber pipeline_stage / contact_method. Returns true on success.
export async function updateLeadFollowUp(
  { leadId, followUp, followUpDate, followUpNote },
  { signal } = {}
) {
  const fields = { id: leadId };
  if (followUp != null) fields.follow_up = followUp;
  if (followUpDate != null) fields.follow_up_date = followUpDate;
  if (followUpNote != null) fields.follow_up_note = followUpNote;
  const res = await apiPostForm("update_lead_follow_up", fields, { signal, module: "agentic_crm" });
  return res?.status === "success" || res?.status === true;
}

// Team-wide quotations (every rep) — for the SLA board and coaching analytics.
// Omitting relationship_manager_id returns all open quotes (is_customer = 0).
export async function fetchTeamQuotations({ signal } = {}) {
  const raw = await apiPostForm("crm_team_quotations_data", {}, { signal });
  const today = ymd();
  return toList(raw).map((q) => mapQuotationRow(q, today));
}

// Accurate booking_report-matching counts (bookings by order_created_at;
// quotes = distinct not-yet-converted customers) for the admin team report.
// Returns { bookings_total, quotes_total, bookings_by_rep[], quotes_by_rep[] }
// or null if the backend endpoint isn't deployed yet (caller falls back).
export async function fetchReportCounts({ from, to, city, signal } = {}) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (city) p.set("city", city);
  const qs = p.toString();
  try {
    const res = await apiGet(`crm_report_counts${qs ? `?${qs}` : ""}`, { signal, module: "agentic_crm" });
    return res?.data || null;
  } catch {
    return null; // endpoint not deployed → caller uses fallback sources
  }
}

// Team bookings (actual orders) — the real "booked" set. Unlike team
// quotations (open only), this is the converted customers, each stamped with
// order_created_at so bookings can be windowed by date and attributed per rep.
// No order amount is exposed by the endpoint, so there's no booking revenue.
export async function fetchTeamBookings({ signal } = {}) {
  const raw = await apiGet("show_bookings_data", { signal });
  return toList(raw).map((b) => ({
    customerId: String(b.customer_id),
    orderId: b.order_id,
    date: b.order_created_at,
    repId:
      b.relationship_manager_id != null && b.relationship_manager_id !== ""
        ? String(b.relationship_manager_id)
        : null,
    rep: `${b.crm_user_fname || ""} ${b.crm_user_lname || ""}`.trim() || "Unassigned",
    name: b.customer_name || "Unknown",
    city: b.customer_local_city || "",
    source: b.gclid_field ? "Google Ad" : "Organic",
  }));
}

// Latest quotation-email status per customer (from the Resend webhook tracking).
// Backend returns one row per customer = their most-recently-sent quote's status,
// so a customer with a single quote shows that quote, others show the latest.
// Returns a map keyed by customer_id: { raw, sentAt, lastEventAt, quotationId }.
export async function fetchQuoteEmailStatus({ signal } = {}) {
  const res = await apiGet("quote_email_status", { signal, module: "agentic_crm" });
  const map = {};
  for (const r of toList(res)) {
    map[String(r.customer_id)] = {
      raw: String(r.last_status || "sent"),
      sentAt: r.sent_at || null,
      lastEventAt: r.last_event_at || null,
      quotationId: r.quotation_id || null,
    };
  }
  return map;
}

// Set of customer_ids whose mobile OTP is verified (ss_new_otp_auth.verified=1,
// matched on phone). Used to flag OTP-verified rows on the quotations list.
export async function fetchOtpVerifiedIds({ signal } = {}) {
  const res = await apiGet("quote_otp_status", { signal, module: "agentic_crm" });
  return new Set(toList(res).map((x) => String(x)));
}

// Booking report metrics — mirrors the legacy report/booking_report page,
// served as JSON by agentic_crm/booking_report_data (reuses the same report_model
// queries, so the numbers match). Dates are sent in "MMM D, YYYY" form because
// that page splits the range on "-".
function reportDate(ymdStr) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = String(ymdStr).split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
}

// The customer list behind a booking-report card — fetched from the live
// endpoints and filtered to the card's date range + city, so the data shows
// in-app instead of opening the old back-office page.
export async function fetchReportList(type, { from, to, city, signal } = {}) {
  const dOnly = (d) => String(d || "").split(" ")[0].split("T")[0];
  const inRange = (d) => {
    const s = dOnly(d);
    return s && s >= from && s <= to;
  };
  const cityOk = (c) => !city || String(c || "").toLowerCase() === String(city).toLowerCase();
  const row = (r, { idKey = "customer_id", phoneKey = "customer_contact1" } = {}) => ({
    id: r[idKey],
    uid: r.customer_unique_id || "",
    name: r.customer_name || "Unknown",
    phone: r[phoneKey] || r.customer_mobile_no || r.customer_contact1 || "",
    email: r.customer_email || "",
    city: r.customer_local_city || "",
    status: r.follow_up || "",
    note: r.follow_up_note || "",
    followDate: r.follow_up_date || "",
    createdAt: r.created_at || r.date || r.order_created_at || "",
    rep: `${r.user_fname || r.crm_user_fname || ""} ${r.user_lname || r.crm_user_lname || ""}`.trim(),
    repId: r.relationship_manager_id != null && r.relationship_manager_id !== "" ? String(r.relationship_manager_id) : "",
  });

  if (type === "view_leads") {
    const res = await apiGet("get_crm_leads_data", { signal });
    return toList(res)
      .filter((l) => inRange(l.date || l.lead_date || l.created_date) && cityOk(l.customer_local_city))
      .map((l) => row(l, { idKey: "id", phoneKey: "customer_mobile_no" }));
  }
  if (type === "quotation_customers") {
    const res = await apiPostForm("crm_team_quotations_data", {}, { signal });
    return toList(res)
      .filter((q) => inRange(q.created_at || q.customer_date) && cityOk(q.customer_local_city))
      .map((q) => row(q));
  }
  if (type === "follow_up_customers") {
    const res = await apiPostForm("crm_team_quotations_data_follow_ups", {}, { signal });
    return toList(res)
      .filter(
        (q) =>
          inRange(q.follow_up_date) &&
          normStatus(q.follow_up) !== "closed" &&
          cityOk(q.customer_local_city)
      )
      .map((q) => row(q));
  }
  if (type === "lead_follow_up_customers") {
    const res = await apiGet("crm_team_leads_data_follow_ups", { signal });
    return toList(res)
      .filter((l) => inRange(l.follow_up_date) && cityOk(l.customer_local_city))
      .map((l) => row(l, { idKey: "id", phoneKey: "customer_mobile_no" }));
  }
  if (type === "booked_customers" || type === "booked_customers_cancel") {
    const res = await apiGet("show_bookings_data", { signal });
    const cancel = type === "booked_customers_cancel";
    return toList(res)
      .filter(
        (b) =>
          inRange(b.order_created_at) &&
          cityOk(b.customer_local_city) &&
          (cancel ? String(b.order_status || "").toLowerCase() === "cancelled" : true)
      )
      .map((b) => row(b));
  }
  return [];
}

// Exact list behind a booking-report card — calls booking_report_list, which
// runs the SAME query as the card's metric, so the list count matches the card.
// Quotation types are mapped to full quote objects so the rich card can render.
export async function fetchReportListExact(type, { from, to, city, signal } = {}) {
  const fields = { type, search_date: `${reportDate(from)} - ${reportDate(to)}` };
  if (city) fields.city = city;
  const res = await apiPostForm("booking_report_list", fields, { signal, module: "agentic_crm" });
  const rows = toList(res);
  if (type === "quotation_customers" || type === "follow_up_customers") {
    const today = ymd();
    return { quote: true, rows: rows.map((q) => mapQuotationRow(q, today)) };
  }
  return {
    quote: false,
    rows: rows.map((r) => ({
      id: r.customer_id ?? r.id,
      uid: r.customer_unique_id || "",
      name: r.customer_name || "Unknown",
      phone: r.customer_contact1 || r.customer_mobile_no || "",
      email: r.customer_email || "",
      city: r.customer_local_city || "",
      status: r.order_status || r.follow_up || "",
      followDate: r.follow_up_date || "",
      rep: `${r.user_fname || ""} ${r.user_lname || ""}`.trim(),
      repId: r.relationship_manager_id != null && r.relationship_manager_id !== "" ? String(r.relationship_manager_id) : "",
      // Booking-specific (booked_customers): order + charges + coupons.
      orderId: r.order_id || "",
      storageCharges: r.total_storage_charges_with_gst ?? r.total_storage_charges ?? "",
      transportCharges: r.total_pickup_charges_with_gst ?? r.total_pickup_charges ?? "",
      storageCoupon: couponPct(r.storage_coupen),
      transportCoupon: couponPct(r.transport_coupon),
    })),
  };
}

// Coupon codes are stored like "name-x-20"; the trailing number is the percent.
function couponPct(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const parts = s.split("-");
  const pct = parts[parts.length - 1];
  return /^\d+$/.test(pct) ? `${pct}%` : s;
}

// Fire-and-forget: run the warehouse auto-share sweep (sends to customers created
// ~3 min ago, exactly once). Triggered on the booking-report page load instead of
// a server cron — failures are swallowed so it never blocks the page.
export function triggerAutoShareWarehouse() {
  apiGet("auto_share_warehouse", { module: "agentic_crm" }).catch(() => {});
}

export async function fetchBookingReport({ from, to, city, compareFrom, compareTo, signal } = {}) {
  const fields = {};
  if (from && to) fields.search_date = `${reportDate(from)} - ${reportDate(to)}`;
  if (city) fields.city = city;
  if (compareFrom && compareTo) fields.compare_date = `${reportDate(compareFrom)} - ${reportDate(compareTo)}`;
  const res = await apiPostForm("booking_report_data", fields, { signal, module: "agentic_crm" });
  return res?.data || {};
}

// Smart Alert feed — recent engagement events turned into ready-to-show alerts.
// kind: opened | revisit | clicked | wh_viewed | wh_clicked
export async function fetchRecentEngagement({ signal } = {}) {
  const res = await apiGet("recent_engagement", { signal, module: "agentic_crm" });
  const mapped = toList(res).map((r) => {
    const ev = String(r.event_type || "").toLowerCase();
    const isClick = ev.includes("clicked");
    const wh = r.email_type === "warehouse";
    const seq = Number(r.open_seq) || 0;
    let kind, message, tone;
    if (wh && isClick) { kind = "wh_clicked"; message = "clicked in the warehouse mail"; tone = "violet"; }
    else if (wh)       { kind = "wh_viewed";  message = "viewed the warehouse photos/video"; tone = "violet"; }
    else if (isClick)  { kind = "clicked";    message = "clicked the booking link"; tone = "emerald"; }
    else if (seq >= 2) { kind = "revisit";    message = `revisited the quote (${seq}×)`; tone = "amber"; }
    else               { kind = "opened";     message = "opened the quote"; tone = "indigo"; }
    return {
      id: Number(r.id),
      // Stable identity for a given customer + signal type. The backend emits a
      // fresh row per click/open, so the same customer "clicked the booking link"
      // can appear many times in a row — we collapse those into one alert.
      key: `${r.customer_id}:${kind}`,
      customerId: r.customer_id,
      name: r.customer_name || "A customer",
      uid: r.customer_unique_id || "",
      city: r.customer_local_city || "",
      kind,
      message,
      tone,
      at: r.created_at || null,
    };
  });

  // Collapse to one alert per customer+kind, keeping the most recent (highest id
  // = latest event, which also carries the highest revisit count). Newest first.
  const byKey = new Map();
  for (const a of mapped) {
    const prev = byKey.get(a.key);
    if (!prev || a.id > prev.id) byKey.set(a.key, a);
  }
  return [...byKey.values()].sort((x, y) => y.id - x.id);
}

// WhatsApp (RNR follow-up) read status per customer: customer_id -> { status, seen, lastSeen }.
export async function fetchWhatsappStatus({ signal } = {}) {
  const res = await apiGet("whatsapp_status", { signal, module: "agentic_crm" });
  const map = {};
  for (const r of toList(res)) {
    map[String(r.customer_id)] = {
      status: r.status || "sent", // read | delivered | sent
      seen: Number(r.seen) === 1,
      lastSeen: r.last_seen || null,
    };
  }
  return map;
}

// Share warehouse images & videos with a customer over WhatsApp + Email.
// Backend sends the Interakt template and a trust-kit style Resend email.
export async function shareWarehouseKit(customerId, { signal } = {}) {
  return apiPostForm("share_warehouse_kit", { customer_id: customerId }, { signal, module: "agentic_crm" });
}

// Email engagement per customer (opens count + clicked) for the booking score.
// Returns a map: customer_id -> { opens, clicked }.
export async function fetchBookingSignals({ signal } = {}) {
  const res = await apiGet("quote_booking_signals", { signal, module: "agentic_crm" });
  const map = {};
  for (const r of toList(res)) {
    map[String(r.customer_id)] = {
      opens: Number(r.opens) || 0,
      clicked: Number(r.clicked) === 1,
      warehouseViewed: Number(r.warehouse_viewed) === 1,
      warehouseStatus: r.warehouse_status || null, // sent/delivered/opened/clicked of the warehouse mail
      warehouseAt: r.warehouse_event_at || null,
      returning: Number(r.returning) === 1,
    };
  }
  return map;
}

// Booking-probability score (0–100) from engagement signals. Weights sum to 100.
// WhatsApp-read is not tracked yet → always off (toggle `on` once available).
// Returns { score, parts }. `email` is the latest email-status object so the
// score stays consistent with the Email badge (both define "viewed"/"clicked").
export function bookingScore(q, { otp = false, signals, email, wa } = {}) {
  // Email lifecycle from the status badge (last_status) AND the event counts.
  const raw = String(email?.raw || "").toLowerCase().replace(/^email\./, "");
  const opens = signals?.opens || 0;
  const opened = opens >= 1 || ["opened", "clicked"].includes(raw);
  const clicked = Boolean(signals?.clicked) || raw === "clicked";

  // Call connected = a real call duration was logged (not just any follow-up).
  const dur = String(q?.callDuration || "").trim();
  const callConnected = dur !== "" && !/^[0:]+$/.test(dur);

  const parts = [
    { key: "otp",       label: "OTP verified",          points: 20, on: Boolean(otp) },
    { key: "viewed",    label: "Quote viewed",          points: 20, on: opened },
    { key: "multi",     label: "Viewed multiple times", points: 15, on: opens >= 2 },
    { key: "payment",   label: "Payment link opened",   points: 20, on: clicked },
    { key: "clicked",   label: "Clicked link in email", points: 15, on: clicked }, // extra weight: a click = strong intent
    { key: "warehouse", label: "Warehouse email viewed",points: 10, on: Boolean(signals?.warehouseViewed) },
    { key: "call",      label: "Call connected",        points: 10, on: callConnected },
    { key: "whatsapp",  label: "WhatsApp message seen", points: 5,  on: Boolean(wa?.seen) },
    { key: "returning", label: "Returning customer",    points: 5,  on: Boolean(signals?.returning) },
  ];
  const score = Math.min(100, parts.reduce((s, p) => s + (p.on ? p.points : 0), 0));
  return { score, parts };
}

// Customer quote lifecycle (funnel of milestones) for the drawer stepper.
// Each milestone is reached based on engagement data; `furthest` is the latest
// one reached (the "current" step). Returns { steps, furthest, doneCount, total }.
export function customerLifecycle(q, { otp = false, signals, email } = {}) {
  const raw = String(email?.raw || "").toLowerCase().replace(/^email\./, "");
  const delivered = ["delivered", "opened", "clicked"].includes(raw);
  const opens = signals?.opens || 0;
  const opened = opens >= 1 || ["opened", "clicked"].includes(raw);
  const clicked = Boolean(signals?.clicked) || raw === "clicked";
  const dur = String(q?.callDuration || "");
  const callConnected = Boolean(q?.verified) || (dur !== "" && !/^[0:]+$/.test(dur));
  const engaged = callConnected || clicked || opens >= 2 || /negoti/i.test(q?.stage || "");

  // What the customer did inside the email (shown under the "Viewed" node).
  const viewedNote = clicked ? "Clicked link in mail" : opens >= 2 ? `Opened ${opens}×` : null;

  const steps = [
    { key: "created",   label: "Quote Created", tone: "slate",   at: q?.createdAt || null,   done: true },
    { key: "sent",      label: "Quote Sent",    tone: "sky",     at: email?.sentAt || null,  done: Boolean(email) },
    { key: "delivered", label: "Delivered",     tone: "cyan",    at: null,                            done: delivered },
    { key: "viewed",    label: "Viewed",        tone: "indigo",  at: opened ? email?.lastEventAt || null : null, note: viewedNote, done: opened },
    { key: "otp",       label: "OTP Verified",  tone: "violet",  at: null,                   done: Boolean(otp) },
    { key: "engaged",   label: "Engaged",       tone: "amber",   at: null,                   done: engaged },
    { key: "booked",    label: "Booked",        tone: "emerald", at: null,                   done: Boolean(q?.won) },
  ];

  let furthest = 0; // index of the latest reached milestone (created is always reached)
  steps.forEach((s, i) => { if (s.done) furthest = i; });
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, furthest, doneCount, total: steps.length };
}

// The status to DISPLAY for a quote email. ss_email_sent.last_status can lag
// behind reality — a click is recorded in the engagement-events feed (→ booking
// signals) before last_status flips to "clicked". So we merge the two: a click
// (or an open) elevates the shown status, but never downgrades it and never
// overrides a hard-fail state (bounced / spam / delayed). Returns a raw status
// string for emailStatusInfo(), or null when no email was sent.
export function mergedEmailStatus(email, signals) {
  const raw = String(email?.raw || "").toLowerCase().replace(/^email\./, "");
  const opens = signals?.opens || 0;
  const clicked = Boolean(signals?.clicked);
  const hadEmail = Boolean(email) || opens >= 1 || clicked;
  if (!hadEmail) return null;
  // Terminal failure states are not "below" opened/clicked — leave them as-is.
  if (["bounced", "complained", "delivery_delayed"].includes(raw)) return raw;
  const ladder = { sent: 1, delivered: 2, opened: 3, clicked: 4 };
  const names = { 1: "sent", 2: "delivered", 3: "opened", 4: "clicked" };
  let lvl = ladder[raw] || 1;
  if (opens >= 1 && lvl < 3) lvl = 3;
  if (clicked && lvl < 4) lvl = 4;
  return names[lvl];
}

// Normalise a raw ss_email_sent.last_status into a UI label + tone + viewed flag.
// last_status is "sent" at send time, then the webhook sets "email.<event>".
export function emailStatusInfo(raw) {
  const s = String(raw || "").toLowerCase().replace(/^email\./, "");
  switch (s) {
    case "opened":          return { label: "Viewed",    tone: "emerald", viewed: true };
    case "clicked":         return { label: "Clicked",   tone: "emerald", viewed: true };
    case "delivered":       return { label: "Delivered", tone: "sky",     viewed: false };
    case "bounced":         return { label: "Bounced",   tone: "rose",    viewed: false };
    case "complained":      return { label: "Spam",      tone: "rose",    viewed: false };
    case "delivery_delayed":return { label: "Delayed",   tone: "amber",   viewed: false };
    case "sent":            return { label: "Sent",      tone: "slate",   viewed: false };
    default:                return null; // no email sent / unknown
  }
}

// Quotation follow-ups — one row per available quotation (matches the legacy
// household_quotation_followup). Returns all dated follow-ups for the rep.
export async function fetchQuotationFollowups({ userId, from, to, city, followUp, limit, signal } = {}) {
  const p = new URLSearchParams();
  if (userId != null && userId !== "") p.set("user_id", userId);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (city) p.set("city", city);
  if (followUp) p.set("follow_up", followUp);
  if (limit != null) p.set("limit", limit);
  const qs = p.toString();
  const res = await apiGet(`get_quotation_followups${qs ? `?${qs}` : ""}`, { signal, module: "agentic_crm" });
  return toList(res);
}

// Bookings leaderboard: the ranking (show_user_booking_ranking) joined to CRM
// user names (get_crm_users). Returns [{ rank, userId, name, bookings, isTop }].
export async function fetchLeaderboard({ signal } = {}) {
  const rankRaw = await apiGet("show_user_booking_ranking", { signal }).catch(() => null);
  const board = rankRaw?.data || (Array.isArray(rankRaw) ? rankRaw : []);

  // Resolve names for exactly the ranked user_ids (any role — covers former reps).
  const ids = board.map((r) => String(r.user_id)).filter(Boolean);
  const usersRaw = ids.length
    ? await apiGet(`get_crm_users?ids=${encodeURIComponent(ids.join(","))}`, { signal, module: "agentic_crm" }).catch(() => null)
    : null;
  const nameMap = {};
  for (const u of toList(usersRaw)) {
    const name = `${u.user_fname || ""} ${u.user_lname || ""}`.trim();
    if (name) nameMap[String(u.user_id)] = name;
  }
  return board
    .map((r) => ({
      rank: Number(r.rank),
      userId: String(r.user_id),
      name: nameMap[String(r.user_id)] || `User ${r.user_id}`,
      bookings: Number(r.bookings) || 0,
      isTop: Boolean(r.is_top),
    }))
    .sort((a, b) => a.rank - b.rank);
}

function mapQuotationRow(q, today) {
  {
    const fd = parseDateOnly(q.follow_up_date);
    let bucket = "none";
    let overdueDays = 0;
    let inDays = 0;
    if (fd) {
      const delta = daysBetween(fd, today);
      if (delta > 0) {
        bucket = "overdue";
        overdueDays = delta;
      } else if (delta === 0) {
        bucket = "today";
      } else {
        bucket = "upcoming";
        inDays = -delta;
      }
    }

    const statusKey = normStatus(q.follow_up);
    const verified = parseDateOnly(q.follow_up_start_time) != null;

    // First-response SLA: minutes from customer creation → follow-up start time.
    let responseMins = null;
    if (q.follow_up_start_time && q.created_at) {
      const c = new Date(String(q.created_at).replace(" ", "T"));
      const s = new Date(String(q.follow_up_start_time).replace(" ", "T"));
      const diff = Math.round((s - c) / 60000);
      if (!isNaN(diff) && diff >= 0) responseMins = diff;
    }
    const contacted = Boolean(q.follow_up) || verified;
    const won = ["booked", "won", "converted"].includes(statusKey);
    const lost = ["lost", "invalid"].includes(statusKey);

    return {
      id: q.customer_id,
      uid: q.customer_unique_id || "",
      name: q.customer_name || "Unknown",
      email: q.customer_email || "",
      contact: q.customer_contact1 || "",
      contactMethod: q.contact_method || "",
      city: q.customer_local_city || "",
      pickupAddress: q.pickup_address || "",
      pincode: q.pincode || "",
      stage: (q.pipeline_stage || "").trim(),
      status: q.follow_up || "",
      statusKey,
      note: noteTail(q.follow_up_note),     // most-recent chunk for the table
      noteFull: q.follow_up_note || "",     // full history for the drawer / tooltip
      followDate: fd,
      bucket,
      overdueDays,
      inDays,
      lastContactAt: q.follow_up_start_time || null,
      lastContactAgo: q.follow_up_start_time ? timeAgoLabel(q.follow_up_start_time) : "",
      // Call timing recorded by the mobile app on call-disconnect. The follow-up
      // update UI is gated on BOTH being present (i.e. the customer was called).
      followUpStartTime: hasDateTime(q.follow_up_start_time) ? q.follow_up_start_time : null,
      followUpEndTime: hasDateTime(q.follow_up_end_time) ? q.follow_up_end_time : null,
      hasCallTimes: hasDateTime(q.follow_up_start_time) && hasDateTime(q.follow_up_end_time),
      callDuration: q.quote_call_duration || q.call_duration || "",
      verified,
      contacted,
      responseMins,
      source: q.gclid_field ? "Google Ad" : prettySource(q.updated_from),
      createdAt: q.created_at,
      // When the lead/customer was created (DATE(customer_created_at)). The date
      // window keys off this to match the backend leads view.
      customerDate: parseDateOnly(q.customer_date),
      rep: `${q.user_fname || ""} ${q.user_lname || ""}`.trim() || "Unassigned",
      repId:
        q.relationship_manager_id != null && q.relationship_manager_id !== ""
          ? String(q.relationship_manager_id)
          : null,
      // RNR clock + quote value + home type — power the SLA board, the dormant
      // high-value escalation, and (later) win-rate routing.
      rnrSince: q.rnr_since && !String(q.rnr_since).startsWith("0000") ? q.rnr_since : null,
      hometype: (q.hometype || "").trim(),
      value: numOr0(q.total_storage_charges_with_gst) + numOr0(q.total_pickup_charges_with_gst),
      done: DONE_STATES.has(statusKey),
      won,
      lost,
    };
  }
}

function numOr0(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Count how many datetimes fall in [from, to].
export function countInRange(dates, from, to) {
  if (!dates) return 0;
  let n = 0;
  for (const d of dates) if (dateInRange(d, from, to)) n++;
  return n;
}

function noteLines(note) {
  return String(note || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function latestNote(note) {
  const parts = noteLines(note);
  const last = parts[parts.length - 1] || "";
  return last.length > 90 ? last.slice(0, 90) + "…" : last;
}

// The most recent text of a (possibly long, inline-appended) note — newest
// entries are at the end, so we keep the tail rather than the head.
function noteTail(note, max = 200) {
  if (!note) return "";
  const s = String(note).replace(/\s+/g, " ").trim();
  return s.length > max ? "…" + s.slice(s.length - max) : s;
}

function prettySource(s) {
  if (!s) return "Direct";
  const map = {
    quotation_lead: "Quotation",
    google: "Google Ad",
    google_ad: "Google Ad",
    website: "Website",
    facebook: "Facebook",
    organic: "Organic",
  };
  return map[s] || s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyStorage(s) {
  if (!s) return "Storage";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
