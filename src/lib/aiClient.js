// Client-side helpers that call the AI route handlers. Each throws on error with
// a readable message (e.g. "AI not configured" when the gateway key is missing).
async function post(path, body, signal) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// [{id,name,source,storageType,city,message,followUp,followUpNote,verified,ageHours}]
export const scoreLeads = (leads, signal) => post("/api/ai/score-leads", { leads }, signal);

// [{id,name,rep,followUp,followUpNote,callDurationSec,verified}]
export const checkQuality = (items, signal) => post("/api/ai/quality-check", { items }, signal);

// [{id, note}]
export const summarizeNotes = (notes, signal) => post("/api/ai/summarize-note", { notes }, signal);
