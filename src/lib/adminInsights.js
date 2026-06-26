// Coaching engine: turns the raw per-rep metrics (from lib/admin.js) into
// (1) team benchmarks, (2) performance bands (who's good / who needs help),
// (3) ranked, quantified opportunities to lift conversion, and (4) a projected
// team conversion if the gaps are closed.
//
// The headline uplift is built on the most defensible lever — the contact-rate
// gap: an uncontacted quote has ~zero chance of converting, so closing the gap
// to the team's best contacters yields estimable extra bookings.

const SLA_MINUTES = 15;

function percentile(arr, p) {
  const a = arr.filter((n) => typeof n === "number" && !isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[idx];
}
const pct = (n) => Math.round(n * 100);

export function buildCoaching(reps) {
  const active = (reps || []).filter((r) => r.open > 0 || r.bookings > 0);

  // Per-rep contact rate (contacted / open quotes in window).
  const enriched = active.map((r) => ({
    ...r,
    contactRate: r.open ? r.contacted / r.open : null,
  }));

  // Team aggregates.
  const totalOpen = enriched.reduce((s, r) => s + r.open, 0);
  const totalContacted = enriched.reduce((s, r) => s + r.contacted, 0);
  const totalBookings = enriched.reduce((s, r) => s + r.bookings, 0);
  const totalPipeline = enriched.reduce((s, r) => s + r.pipeline, 0);
  // Bookings (real orders) are a SEPARATE set from open quotes, so the lead
  // base is open quotes + bookings. Conversion = booked ÷ that base.
  const leadBase = totalOpen + totalBookings;
  const teamConversion = leadBase ? (totalBookings / leadBase) * 100 : 0;
  const teamContactRate = totalOpen ? totalContacted / totalOpen : 0;
  const bookingPerContacted = totalContacted ? totalBookings / totalContacted : 0;

  // Benchmarks — the "good" bar is the top quartile of the team.
  const benchContact = percentile(enriched.map((r) => r.contactRate).filter((n) => n != null), 0.75) ?? teamContactRate;
  const benchConv = percentile(enriched.map((r) => r.conversion).filter((n) => n > 0), 0.75) ?? teamConversion;
  const benchResponse = percentile(enriched.map((r) => r.avgResponse).filter((n) => n != null), 0.25); // lower=better
  const medianConv = percentile(enriched.map((r) => r.conversion), 0.5) ?? 0;

  // --- per-rep diagnosis: pick the single biggest lever + an action ---
  const diagnosed = enriched.map((r) => {
    const uncontacted = Math.max(0, r.open - r.contacted);
    // extra contacts if this rep matched the team's best contacters
    const targetContacted = Math.round(benchContact * r.open);
    const contactGap = Math.max(0, targetContacted - r.contacted);
    const estExtraBookings = +(contactGap * bookingPerContacted).toFixed(1);

    let lever = null;
    if (r.open >= 3 && r.contactRate != null && r.contactRate < benchContact * 0.85 && contactGap >= 1) {
      lever = {
        key: "contact",
        title: "Low contact rate",
        detail: `Contacting ${pct(r.contactRate)}% of quotes vs team-best ${pct(benchContact)}%. ${uncontacted} sitting untouched.`,
        action: `Work the ${uncontacted} uncontacted quotes today.`,
        impact: estExtraBookings,
      };
    } else if (r.avgResponse != null && r.avgResponse > SLA_MINUTES && benchResponse != null && r.avgResponse > benchResponse * 1.5) {
      lever = {
        key: "speed",
        title: "Slow first response",
        detail: `Avg first response ${r.avgResponse}m vs team-best ${benchResponse}m (SLA ${SLA_MINUTES}m).`,
        action: `Respond within ${SLA_MINUTES} min — speed-to-lead drives qualification.`,
        impact: estExtraBookings || 0.5,
      };
    } else if (r.conversion < medianConv && r.bookings >= 0 && r.open >= 3) {
      lever = {
        key: "convert",
        title: "Below-median conversion",
        detail: `Converting ${r.conversion}% vs team median ${Math.round(medianConv)}% / best ${Math.round(benchConv)}%.`,
        action: "Tighten follow-up cadence; revisit pricing objections on open quotes.",
        impact: estExtraBookings,
      };
    }
    return { ...r, uncontacted, contactGap, estExtraBookings, lever };
  });

  // --- bands ---
  const ranked = [...diagnosed].sort(
    (a, b) => b.conversion - a.conversion || b.bookings - a.bookings || b.pipeline - a.pipeline
  );
  const topPerformers = ranked.filter((r) => r.bookings > 0 && r.conversion >= benchConv).slice(0, 3);
  const topIds = new Set(topPerformers.map((r) => r.repId));
  const needsAttention = diagnosed
    .filter((r) => r.lever && !topIds.has(r.repId))
    .sort((a, b) => (b.estExtraBookings || 0) - (a.estExtraBookings || 0));

  // --- team opportunities (ranked, quantified) ---
  const opportunities = [];

  // 1) Contact-rate gap → extra bookings → conversion uplift.
  const extraContacts = diagnosed.reduce((s, r) => s + r.contactGap, 0);
  const extraBookingsContact = extraContacts * bookingPerContacted;
  if (extraBookingsContact >= 0.5) {
    const upliftPts = leadBase ? (extraBookingsContact / leadBase) * 100 : 0;
    opportunities.push({
      key: "contact",
      title: "Close the contact-rate gap",
      detail: `${extraContacts} quotes are going uncontacted that top reps would have worked. At the team's ${(bookingPerContacted * 100).toFixed(0)}% booking-per-contact rate that's ~${Math.round(extraBookingsContact)} more bookings.`,
      bookings: Math.round(extraBookingsContact),
      uplift: +upliftPts.toFixed(1),
      who: needsAttention.filter((r) => r.lever?.key === "contact").slice(0, 4).map((r) => r.name),
    });
  }

  // 2) Speed-to-lead: reps over SLA.
  const slowReps = diagnosed.filter((r) => r.avgResponse != null && r.avgResponse > SLA_MINUTES);
  if (slowReps.length) {
    const avgSlow = Math.round(slowReps.reduce((s, r) => s + r.avgResponse, 0) / slowReps.length);
    // Conservative: faster response recovers ~12% relative conversion on their open leads.
    const slowOpen = slowReps.reduce((s, r) => s + r.open, 0);
    const estBookings = slowOpen * (bookingPerContacted || 0.1) * 0.12;
    opportunities.push({
      key: "speed",
      title: "Hit the 15-minute first-response SLA",
      detail: `${slowReps.length} rep${slowReps.length > 1 ? "s" : ""} average ${avgSlow}m to first contact. Getting them under ${SLA_MINUTES}m typically recovers ~${Math.max(1, Math.round(estBookings))} bookings.`,
      bookings: Math.max(1, Math.round(estBookings)),
      uplift: leadBase ? +((estBookings / leadBase) * 100).toFixed(1) : 0,
      who: slowReps.sort((a, b) => b.avgResponse - a.avgResponse).slice(0, 4).map((r) => r.name),
    });
  }

  // 3) SLA breaches sitting now (immediate, recoverable today).
  const breachReps = diagnosed.filter((r) => r.slaBreaches > 0).sort((a, b) => b.slaBreaches - a.slaBreaches);
  const totalBreaches = breachReps.reduce((s, r) => s + r.slaBreaches, 0);
  if (totalBreaches > 0) {
    opportunities.push({
      key: "breach",
      title: "Clear live SLA breaches now",
      detail: `${totalBreaches} quote${totalBreaches > 1 ? "s are" : " is"} already past the 15-min SLA, uncontacted. These are the hottest, most recoverable leads.`,
      bookings: Math.round(totalBreaches * (bookingPerContacted || 0.1)),
      uplift: leadBase ? +(((totalBreaches * (bookingPerContacted || 0.1)) / leadBase) * 100).toFixed(1) : 0,
      who: breachReps.slice(0, 4).map((r) => `${r.name} (${r.slaBreaches})`),
    });
  }

  opportunities.sort((a, b) => b.bookings - a.bookings);

  const totalUpliftPts = opportunities.reduce((s, o) => s + (o.uplift || 0), 0);
  const projectedConversion = +(teamConversion + totalUpliftPts).toFixed(1);

  return {
    team: {
      conversion: +teamConversion.toFixed(1),
      projectedConversion,
      upliftPts: +totalUpliftPts.toFixed(1),
      contactRate: pct(teamContactRate),
      bookingPerContacted: pct(bookingPerContacted),
      totalOpen,
      totalContacted,
      totalBookings,
      totalPipeline,
      benchConv: Math.round(benchConv),
      benchContact: pct(benchContact),
      benchResponse,
    },
    topPerformers,
    needsAttention,
    opportunities,
  };
}
