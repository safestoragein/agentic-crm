// One full message: GET the HTML body + attachment metadata, PATCH read state.
import { findMailbox } from "@/lib/mailboxes";
import { graph, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";

export const dynamic = "force-dynamic";

const SELECT = [
  "id",
  "conversationId",
  "subject",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "replyTo",
  "receivedDateTime",
  "isRead",
  "hasAttachments",
  "importance",
  "webLink",
  "body",
].join(",");

async function resolve(request, params) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return { error: auth.response };
  const { box: boxKey, id } = await params;
  const box = findMailbox(boxKey);
  if (!box) return { error: Response.json({ error: "Unknown mailbox" }, { status: 404 }) };
  return { box, id: decodeURIComponent(id) };
}

export async function GET(request, { params }) {
  const r = await resolve(request, params);
  if (r.error) return r.error;

  const user = `/users/${encodeURIComponent(r.box.address)}`;
  try {
    const message = await graph(`${user}/messages/${encodeURIComponent(r.id)}?$select=${SELECT}`, {
      // Ask Outlook for HTML even when the message is stored as plain text, so
      // the reading pane renders one consistent way.
      headers: { Prefer: 'outlook.body-content-type="html"' },
    });

    let attachments = [];
    if (message?.hasAttachments) {
      const att = await graph(
        `${user}/messages/${encodeURIComponent(r.id)}/attachments?$select=id,name,contentType,size,isInline`
      );
      // Inline images are already embedded in the body via cid: — don't list them
      // as downloadable files.
      attachments = (att?.value || []).filter((a) => !a.isInline);
    }

    return Response.json({ message, attachments });
  } catch (e) {
    return graphErrorResponse(e);
  }
}

// Body: { isRead: boolean }
export async function PATCH(request, { params }) {
  const r = await resolve(request, params);
  if (r.error) return r.error;

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof payload?.isRead !== "boolean") {
    return Response.json({ error: "isRead (boolean) is required" }, { status: 400 });
  }

  try {
    await graph(`/users/${encodeURIComponent(r.box.address)}/messages/${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      body: { isRead: payload.isRead },
    });
    return Response.json({ ok: true, isRead: payload.isRead });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
