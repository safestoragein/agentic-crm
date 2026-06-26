import { z } from "zod";
import { MODELS, aiReady, generateStructured } from "@/lib/ai";

export const maxDuration = 60;

const SCHEMA = z.object({
  scores: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      tier: z.enum(["hot", "warm", "cold"]),
      score: z.number().min(0).max(100),
      reason: z.string(), // why this tier, ≤16 words
      nextAction: z.string(), // single best next step, ≤12 words
      noteSummary: z.string(), // one-line summary of the follow-up trail, "" if none
    })
  ),
});

const SYSTEM = `You are a sales lead-scoring assistant for SafeStorage, an Indian self-storage company (household / business / document storage, picked up and delivered).
Score each lead's likelihood to convert into a BOOKING:
- hot (70-100): high intent — clear storage need, recent, engaged, asked about price/slot, or already part-qualified.
- warm (35-69): some interest, needs nurturing or a follow-up.
- cold (0-34): low intent — stale, vague, wrong-fit, repeatedly unresponsive (RNR), or generic.
Use: source, storage type, city, the customer's message, follow-up status, the follow-up note trail, age (hours since created), and whether the phone is OTP-verified.
Be decisive. Keep text tight:
- reason: ≤16 words, concrete (cite the signal).
- nextAction: ≤12 words, the single best next step for the rep.
- noteSummary: ≤14 words summarizing the follow-up history; "" if no note.
Return exactly one entry per input lead id.`;

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
  const leads = Array.isArray(body?.leads) ? body.leads.slice(0, 40) : [];
  if (!leads.length) return Response.json({ scores: [] });

  try {
    const output = await generateStructured({
      model: MODELS.fast,
      system: SYSTEM,
      prompt: `Score these ${leads.length} leads:\n\n${JSON.stringify(leads)}`,
      schema: SCHEMA,
    });
    return Response.json(output);
  } catch (e) {
    return Response.json({ error: e?.message || "Lead scoring failed." }, { status: 500 });
  }
}
