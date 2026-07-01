"use client";

// Reusable quick follow-up editor — status + date + note. Used across screens
// (Customers, Quotations, RNR, Leads, Customer detail). Two entities:
//   entity="customer" -> agentic_crm/update_customer_follow_up (ss_customer.customer_id)
//   entity="lead"     -> agentic_crm/update_lead_follow_up     (ss_leads.id)
// Both append the note (timestamped) server-side and leave pipeline_stage /
// contact_method untouched. onSaved receives a { follow_up, follow_up_date,
// follow_up_note } patch so the caller can update its row in place.

import { useState } from "react";
import { X, Loader2, CalendarClock, CalendarDays, PhoneCall, ChevronDown } from "lucide-react";
import { FOLLOWUP_STATUSES } from "@/lib/crm";
import { updateCustomerFollowUp } from "@/lib/customers";
import { updateLeadFollowUp } from "@/lib/crm";

function prettyWords(s) {
  if (!s) return "—";
  return String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function normSlug(v) {
  return String(v || "").toLowerCase().trim().replace(/\s+/g, "-");
}
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function QuickFollowUpModal({
  entity = "customer",
  id,
  name,
  subtitle,
  follow_up = "",
  follow_up_date = "",
  follow_up_note = "",
  onClose,
  onSaved,
}) {
  const initialDate = String(follow_up_date || "").startsWith("0000") ? "" : String(follow_up_date || "").slice(0, 10);
  const [followUp, setFollowUp] = useState(normSlug(follow_up) || "");
  const [date, setDate] = useState(initialDate);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = (followUp || date || note.trim()) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const payload = { followUp, followUpDate: date, followUpNote: note.trim() };
      const ok =
        entity === "lead"
          ? await updateLeadFollowUp({ leadId: id, ...payload })
          : await updateCustomerFollowUp({ customerId: id, ...payload });
      if (!ok) {
        setError("Couldn't save. Please try again.");
        return;
      }
      const patch = { follow_up: followUp, follow_up_date: date };
      if (note.trim()) {
        const stamped = `${nowStamp()} - ${note.trim()}`;
        patch.follow_up_note = follow_up_note ? `${follow_up_note}\n${stamped}` : stamped;
      }
      onSaved?.(patch);
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6">
      <div className="my-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <CalendarClock className="h-4 w-4 text-amber-600" /> Add follow-up
            </h2>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {name || "Unknown"}
              {subtitle ? ` · ${subtitle}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-800">Follow-up</label>
            <div className="relative">
              <PhoneCall className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
              >
                <option value="">Select status…</option>
                {FOLLOWUP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {prettyWords(s)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-800">Follow-up date</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-800">Follow-up note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Enter your note here…"
              className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:border-indigo-400 focus:outline-none"
            />
            {follow_up_note && (
              <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line break-words rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-[11px] leading-relaxed text-slate-600">
                <div className="mb-1 font-bold text-amber-700">Previous notes</div>
                {follow_up_note}
              </div>
            )}
          </div>

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3.5">
          <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save follow-up
          </button>
        </div>
      </div>
    </div>
  );
}
