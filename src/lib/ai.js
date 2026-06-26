// Server-only AI helpers (Vercel AI Gateway). Auth via AI_GATEWAY_API_KEY in
// .env.local (or Vercel OIDC in prod). Models are gateway "provider/model"
// strings — Haiku for cheap batch work, Sonnet for the reasoning-heavy audit.
import { generateText, Output } from "ai";

export const MODELS = {
  fast: "anthropic/claude-haiku-4.5", // lead scoring, note summaries (batch, cheap)
  smart: "anthropic/claude-sonnet-4.6", // fake-follow-up audit (reasoning)
};

export function aiReady() {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

// generateText + Output.object → schema-validated object (AI SDK v6 pattern).
export async function generateStructured({ model, system, prompt, schema }) {
  const { output } = await generateText({
    model,
    system,
    prompt,
    output: Output.object({ schema }),
  });
  return output;
}
