// Send a reply from the shared mailbox.
//
// Uses createReply -> PATCH body -> send rather than the one-shot /reply action,
// because /reply only takes a plain `comment` string. The three-step flow lets
// us set real HTML and keeps Outlook's own quoted-original block, so the thread
// reads correctly in the customer's client and lands in the mailbox's Sent Items.
//
// Body: { html: string, replyAll?: boolean }
import { findMailbox } from "@/lib/mailboxes";
import { graph, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The reply body is authored by an admin in our own composer, but it still ends
// up inside an HTML email — strip anything executable before it goes out.
function sanitize(html) {
  return String(html)
    .replace(/<\s*\/?\s*(script|iframe|object|embed|link|meta)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export async function POST(request, { params }) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;

  const { box: boxKey, id } = await params;
  const box = findMailbox(boxKey);
  if (!box) return Response.json({ error: "Unknown mailbox" }, { status: 404 });

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const html = sanitize(payload?.html || "").trim();
  if (!html) return Response.json({ error: "Reply body is empty" }, { status: 400 });

  const user = `/users/${encodeURIComponent(box.address)}`;
  const msgId = encodeURIComponent(decodeURIComponent(id));

  try {
    const action = payload?.replyAll ? "createReplyAll" : "createReply";
    const draft = await graph(`${user}/messages/${msgId}/${action}`, { method: "POST", body: {} });
    if (!draft?.id) throw new Error("Outlook did not return a reply draft");

    const draftId = encodeURIComponent(draft.id);
    // Outlook's draft body already contains the quoted original; prepend ours.
    const merged = `${html}<br>${draft?.body?.content || ""}`;
    await graph(`${user}/messages/${draftId}`, {
      method: "PATCH",
      body: { body: { contentType: "HTML", content: merged } },
    });

    await graph(`${user}/messages/${draftId}/send`, { method: "POST", body: {} });

    return Response.json({ ok: true, sentBy: auth.email, from: box.address });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
