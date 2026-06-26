"use client";

// Follow-up / Log-Activity modal for the website — mirrors the mobile app's
// FollowUpModal (same fields + the same update_quotation_followups_data endpoint
// via updateQuotationFollowup). Shown only for customers that were already
// called (have follow_up_start_time AND follow_up_end_time); the caller gates it.

import { useState } from "react";
import { X, Phone, Mail, MessageCircle, Users, Calendar, Loader2, CheckCircle2, PhoneMissed, XCircle, BadgeCheck, Clock } from "lucide-react";
import { updateQuotationFollowup } from "@/lib/crm";

const CONTACT_METHODS = [
  { label: "Phone", icon: Phone },
  { label: "Email", icon: Mail },
  { label: "WhatsApp", icon: MessageCircle },
  { label: "Meeting", icon: Users },
];

const PIPELINE_STAGES = ["New Lead", "Contacted", "Qualified", "Negotiation", "Closed", "PNQ", "Invalid"];

const OUTCOMES = [
  { label: "Contacted", icon: CheckCircle2 },
  { label: "RNR", icon: PhoneMissed },
  { label: "Invalid", icon: XCircle },
  { label: "Qualified", icon: BadgeCheck },
  { label: "Lost", icon: X },
  { label: "Follow Up Needed", icon: Clock },
  { label: "Price Match", icon: null },
  { label: "Shifting", icon: null },
  { label: "Booked With Others", icon: null },
  { label: "Pricing Issues", icon: null },
  { label: "Competitor Comparison", icon: null },
];

// Friendly display of the real measured talk time, e.g. "3m 24s".
function fmtTalkTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// Machine-readable M:SS for the endpoint. The CRM's callDurationSecs() parses
// "M:SS" back to real seconds, so the call correctly counts as connected (lead
// scoring, "verified today", genuine-follow-up checks).
function secToClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const QUICK_ACTIONS = [
  "Schedule call back", "Send proposal", "Share doc", "Taking to manager",
  "Create agreement", "Schedule meeting", "Send comparison",
  "Competitor comparison", "Credit check", "Pricing call", "Create quote",
];

// Pull the most recent note line out of an appended history blob.
function latestNote(note) {
  if (!note) return "";
  const parts = String(note).split("\n").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  const dash = last.indexOf(" - ");
  return dash > 0 && dash < 25 ? last.slice(dash + 3) : last;
}

export default function FollowUpModal({ quote, onClose, onSaved, talkTimeSec = null }) {
  const [contactMethod, setContactMethod] = useState(quote.contactMethod || null);
  const [stage, setStage] = useState(quote.stage || null);
  const [outcome, setOutcome] = useState(quote.status || null);
  const [followUpDate, setFollowUpDate] = useState(quote.followDate || "");
  const [notes, setNotes] = useState(latestNote(quote.noteFull));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Real time spoken with the customer, measured by the after-call flow. Null
  // when the modal is opened manually (not right after a call).
  const hasTalkTime = talkTimeSec != null && Number(talkTimeSec) > 0;

  const canSave = contactMethod && stage && outcome;

  function addQuickAction(a) {
    setNotes((n) => (n.trim() ? `${n}\n• ${a}` : `• ${a}`));
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const activity = `${new Date().toISOString()} - Contact: ${contactMethod}, Stage: ${stage}, Outcome: ${outcome}`;
      const ok = await updateQuotationFollowup({
        customerId: quote.id,
        pipelineStage: stage,
        contactMethod,
        followUp: outcome,
        // The actual time spoken with the customer (auto-measured from the call),
        // sent straight to the endpoint. Empty for manual (non-call) logs.
        quoteCallDuration: hasTalkTime ? secToClock(talkTimeSec) : "",
        followUpDate: followUpDate || "",
        followUpNote: notes.trim(),
        activityHistory: activity,
        // Deliberately NOT sending follow_up_start_time/end_time — those were
        // stamped by the app from the real call and must be preserved.
      });
      if (ok) {
        onSaved?.();
        onClose?.();
      } else {
        setError("Couldn't save. Please try again.");
      }
    } catch (e) {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6">
      <div className="my-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                <Clock className="h-3 w-3" /> CALLED
              </span>
              <h2 className="text-base font-bold text-slate-900">Log activity for {quote.name}</h2>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Quotation ID: {quote.id}</div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* contact method */}
          <Section title="How did you contact?" required>
            <div className="grid grid-cols-4 gap-2">
              {CONTACT_METHODS.map((m) => {
                const Icon = m.icon;
                const on = contactMethod === m.label;
                return (
                  <button key={m.label} onClick={() => setContactMethod(m.label)}
                    className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-semibold transition-colors ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <Icon className="h-5 w-5" /> {m.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* pipeline stage */}
          <Section title="Pipeline stage" required>
            <div className="flex flex-wrap gap-2">
              {PIPELINE_STAGES.map((s) => {
                const on = stage === s;
                return (
                  <button key={s} onClick={() => setStage(s)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* outcome */}
          <Section title="What was the outcome?" required>
            <div className="grid grid-cols-3 gap-2">
              {OUTCOMES.map((o) => {
                const Icon = o.icon;
                const on = outcome === o.label;
                return (
                  <button key={o.label} onClick={() => setOutcome(o.label)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center text-[11px] font-semibold transition-colors ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {Icon && <Icon className="h-4 w-4" />} {o.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* real measured talk time (shown only after an actual call) */}
          {hasTalkTime && (
            <Section title="Time spoken">
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
                <Clock className="h-4 w-4" /> {fmtTalkTime(talkTimeSec)}
              </div>
            </Section>
          )}

          {/* next follow-up date */}
          <Section title="Next follow-up date">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="date" value={followUpDate || ""} onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
            </div>
          </Section>

          {/* notes */}
          <Section title="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Enter your notes here…"
              className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:border-indigo-400 focus:outline-none" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((a) => (
                <button key={a} onClick={() => addQuickAction(a)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100">
                  {a}
                </button>
              ))}
            </div>
            {quote.noteFull && (
              <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-[11px] leading-relaxed text-slate-600">
                <div className="mb-1 font-bold text-amber-700">Previous notes</div>
                <div className="whitespace-pre-line">{quote.noteFull}</div>
              </div>
            )}
          </Section>

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3.5">
          <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={save} disabled={!canSave || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save activity
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, required, children }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-800">
        {title}
        {required && <span className="text-rose-500"> *</span>}
      </div>
      {children}
    </div>
  );
}
