import { z } from "zod";
import { MODELS, aiReady, generateStructured } from "@/lib/ai";

export const maxDuration = 60;

// Batch: summarize many note trails at once (id -> summary). Each summary is a
// tight digest of a messy RNR/follow-up note trail.
const SCHEMA = z.object({
  summaries: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      summary: z.string(), // what's happened, ≤20 words
      lastContact: z.string(), // most recent contact/date if present, else ""
      nextStep: z.string(), // recommended next action, ≤12 words
    })
  ),
});

const SYSTEM = `You summarize messy CRM follow-up note trails for SafeStorage reps. A note is a run-on log like "26 Feb Ayesha: RNR sent msg 27 Feb Ayesha: RNR ...". For each note return:
- summary: ≤20 words — what has actually happened (attempts, outcomes, objections).
- lastContact: the most recent date/contact mentioned, else "".
- nextStep: ≤12 words — the recommended next action.
Return one entry per input id.`;

export async function POST(req) {
  if (!aiReady()) {
    return Response.json({ error: "AI not configured — add AI_GATEWAY_API_KEY to .env.local." }, { status: 400 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // Accept either { notes: [{id, note}] } or a single { id, note }.
  let notes = [];
  if (Array.isArray(body?.notes)) notes = body.notes.slice(0, 40);
  else if (body?.note != null) notes = [{ id: body.id ?? "1", note: body.note }];
  notes = notes.filter((n) => n.note && String(n.note).trim());
  if (!notes.length) return Response.json({ summaries: [] });

  try {
    const output = await generateStructured({
      model: MODELS.fast,
      system: SYSTEM,
      prompt: `Summarize these ${notes.length} note trails:\n\n${JSON.stringify(notes)}`,
      schema: SCHEMA,
    });
    return Response.json(output);
  } catch (e) {
    return Response.json({ error: e?.message || "Summarization failed." }, { status: 500 });
  }
}
