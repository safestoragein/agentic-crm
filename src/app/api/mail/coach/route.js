// Reply coach: score how we answered one customer, and show a better version.
//
// Body: { box, conversationId }
//
// Always returns the deterministic score (lib/replyScore) so the number exists
// with or without an AI key. When AI_GATEWAY_API_KEY is set it also returns a
// rewritten reply and a short critique — that's what the "Show improved version"
// button reveals. The rewrite is a DRAFT for a human to read and adapt; nothing
// here sends anything.
import { z } from "zod";
import { findMailbox } from "@/lib/mailboxes";
import { graph, graphConfigured, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";
import { analyzeTone } from "@/lib/triage";
import { scoreReply, stripQuoted } from "@/lib/replyScore";
import { MODELS, aiReady, generateStructured } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA = z.object({
  critique: z.array(z.string()).max(5), // concrete faults, ≤20 words each
  improvedReply: z.string(), // ready-to-send plain text
  aiScore: z.number().min(0).max(100),
  biggestMiss: z.string(), // the single most important fix, ≤25 words
});

const SYSTEM = `You coach customer-support agents at SafeStorage, an Indian self-storage company.
You are given ONE customer email and the reply our team actually sent.

Judge the reply on: does it answer every question asked, does it acknowledge the customer's feelings when they are upset, does it commit to a specific next step with a date/owner, is it written for THIS customer rather than pasted, and is the tone warm but professional.

Then rewrite it properly.
Rules for improvedReply:
- Plain text, no markdown, no placeholders like [name] — use the real name if it appears, otherwise a natural greeting.
- Open by addressing their actual issue, not with "Dear Customer, Greetings from SafeStorage".
- Answer every question the customer asked.
- Commit to one concrete next step with a timeframe.
- Indian business English, warm and direct. 120 words or fewer.
- Never invent facts (prices, dates, policies) that aren't in the thread — if something must be looked up, say we are confirming it and give a timeframe.
critique: up to 5 specific faults, each ≤20 words. If the reply was genuinely good, say so and keep the list short.
aiScore: 0-100 overall quality.
biggestMiss: the single highest-impact fix, ≤25 words.`;

// conversationId values contain +/=; escape single quotes for OData and encode.
function convFilter(cid) {
  return encodeURIComponent(`conversationId eq '${String(cid).replace(/'/g, "''")}'`);
}

export async function POST(request) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;
  if (!graphConfigured()) {
    return Response.json({ error: "Microsoft Graph is not configured" }, { status: 503 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const box = findMailbox(payload?.box);
  if (!box) return Response.json({ error: "Unknown mailbox" }, { status: 404 });
  if (!payload?.conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  try {
    // Whole conversation across folders (inbox + sent), as plain text.
    const data = await graph(
      `/users/${encodeURIComponent(box.address)}/messages?$filter=${convFilter(
        payload.conversationId
      )}&$select=id,subject,from,receivedDateTime,sentDateTime,body&$top=25`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } }
    );

    const msgs = (data?.value || [])
      .map((m) => ({
        id: m.id,
        subject: m.subject || "",
        address: (m.from?.emailAddress?.address || "").toLowerCase(),
        name: m.from?.emailAddress?.name || "",
        at: new Date(m.sentDateTime || m.receivedDateTime).getTime(),
        text: stripQuoted(m.body?.content || ""),
      }))
      .filter((m) => !Number.isNaN(m.at))
      .sort((a, b) => a.at - b.at);

    const ours = (m) => m.address.endsWith("@safestorage.in");
    const customerMsgs = msgs.filter((m) => !ours(m) && m.text);
    if (!customerMsgs.length) {
      return Response.json({ error: "No customer message found in this thread" }, { status: 404 });
    }

    // Score the most recent exchange we ACTUALLY answered — walking backwards to
    // the newest customer mail that has one of our replies after it. Scoring the
    // latest message instead would hand a thread 0/100 for "no reply sent"
    // whenever the customer simply wrote back after a perfectly good answer.
    const replyAfter = (c) => msgs.find((m) => ours(m) && m.at > c.at && m.text) || null;

    let customer = customerMsgs[customerMsgs.length - 1];
    let reply = null;
    for (let i = customerMsgs.length - 1; i >= 0; i--) {
      const r = replyAfter(customerMsgs[i]);
      if (r) {
        customer = customerMsgs[i];
        reply = r;
        break;
      }
    }

    // Separately: is the customer waiting on us right now?
    const newest = customerMsgs[customerMsgs.length - 1];
    const awaitingReply = !replyAfter(newest);

    const responseHours = reply ? (reply.at - customer.at) / 3_600_000 : null;
    const tone = analyzeTone(`${customer.subject} ${customer.text}`);
    const score = scoreReply({
      customerText: `${customer.subject} ${customer.text}`,
      replyText: reply?.text || "",
      responseHours,
      customerTone: tone.tone,
    });

    const base = {
      mailbox: box.key,
      subject: customer.subject,
      customer: { name: customer.name, address: customer.address, text: customer.text.slice(0, 4000), at: new Date(customer.at).toISOString() },
      reply: reply ? { text: reply.text.slice(0, 4000), at: new Date(reply.at).toISOString() } : null,
      responseHours,
      tone: tone.tone,
      // True when the newest customer mail still has no answer — shown as a
      // banner so a good score can't be mistaken for "nothing left to do".
      awaitingReply,
      neverAnswered: !reply,
      score,
      ai: null,
      aiUnavailable: aiReady() ? null : "AI coaching needs AI_GATEWAY_API_KEY — the score above is rule-based.",
    };

    if (!aiReady()) return Response.json(base);

    try {
      const ai = await generateStructured({
        model: MODELS.smart,
        system: SYSTEM,
        schema: SCHEMA,
        prompt: `Customer tone (rule-based): ${tone.tone}${
          reply ? `\nWe replied after ${responseHours.toFixed(1)} hours.` : "\nWE NEVER REPLIED — write the reply that should have been sent."
        }

--- CUSTOMER EMAIL ---
Subject: ${customer.subject}
${customer.text.slice(0, 3000)}

--- OUR REPLY ---
${reply ? reply.text.slice(0, 3000) : "(no reply was ever sent)"}`,
      });
      return Response.json({ ...base, ai });
    } catch (e) {
      // AI down / rate-limited — the rule-based score is still useful.
      return Response.json({ ...base, aiUnavailable: e?.message || "AI coaching failed" });
    }
  } catch (e) {
    return graphErrorResponse(e);
  }
}
