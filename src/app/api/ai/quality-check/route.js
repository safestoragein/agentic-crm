import { z } from "zod";
import { MODELS, aiReady, generateStructured } from "@/lib/ai";

export const maxDuration = 60;

const SCHEMA = z.object({
  flags: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      rep: z.string(),
      risk: z.enum(["high", "medium", "low"]),
      issue: z.string(), // why it looks fake/low-effort, ≤18 words
    })
  ),
  summary: z.string(), // overall verdict, ≤30 words
});

const SYSTEM = `You are a sales-ops QA auditor for SafeStorage. Detect FAKE or low-effort follow-ups — where a rep marked progress without genuinely contacting the customer.
A follow-up is SUSPICIOUS when:
- a contact status (contacted, converted-to-quote, follow-up-needed) is set, but there is NO connected call (callDurationSec is 0 or absent) AND the note is empty, generic, or copy-pasted.
- the note contradicts the status (e.g. status "contacted" but note says only "RNR"/"no answer").
- the same note text is reused verbatim across many leads (template-stamping).
- a status implies a conversation but no evidence (no call duration, no message) supports it.
Do NOT flag legitimate work: a real call duration > 0, a specific personal note, or an honest RNR with a logged message is fine — leave it unflagged.
risk = your confidence it's fake (high/medium/low). issue ≤18 words, specific. summary ≤30 words: overall verdict + count. Only include genuinely suspicious leads in flags.`;

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
  const items = Array.isArray(body?.items) ? body.items.slice(0, 60) : [];
  if (!items.length) return Response.json({ flags: [], summary: "Nothing to check." });

  try {
    const output = await generateStructured({
      model: MODELS.smart,
      system: SYSTEM,
      prompt: `Audit these ${items.length} follow-ups for fake/low-effort activity:\n\n${JSON.stringify(items)}`,
      schema: SCHEMA,
    });
    return Response.json(output);
  } catch (e) {
    return Response.json({ error: e?.message || "Quality check failed." }, { status: 500 });
  }
}
