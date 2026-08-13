// Message list for one mailbox folder.
//
// Query: ?folder=inbox|sent|archive|junk & top & skip & unread=1 & q=<search>
//
// Note on search: Graph's $search on messages cannot be combined with $orderby
// or $filter, and doesn't page with $skip — so a search returns one relevance-
// ranked page and pagination is disabled for that request.
import { findMailbox, findFolder } from "@/lib/mailboxes";
import { graph, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";

export const dynamic = "force-dynamic";

const SELECT = [
  "id",
  "conversationId",
  "subject",
  "from",
  "toRecipients",
  "receivedDateTime",
  "isRead",
  "hasAttachments",
  "importance",
  "bodyPreview",
].join(",");

const MAX_TOP = 100;

export async function GET(request, { params }) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;

  const { box: boxKey } = await params;
  const box = findMailbox(boxKey);
  if (!box) return Response.json({ error: "Unknown mailbox" }, { status: 404 });

  const url = new URL(request.url);
  const folder = findFolder(url.searchParams.get("folder"));
  const q = (url.searchParams.get("q") || "").trim();
  const unreadOnly = url.searchParams.get("unread") === "1";
  const top = Math.min(Number(url.searchParams.get("top")) || 25, MAX_TOP);
  const skip = Math.max(Number(url.searchParams.get("skip")) || 0, 0);

  const qs = [`$select=${SELECT}`, `$top=${top}`];
  if (q) {
    // Relevance-ranked, single page. Graph requires the term be quoted.
    qs.push(`$search=${encodeURIComponent(`"${q.replace(/"/g, "")}"`)}`);
  } else {
    qs.push("$orderby=receivedDateTime desc");
    if (skip) qs.push(`$skip=${skip}`);
    if (unreadOnly) qs.push("$filter=isRead eq false");
  }

  try {
    const data = await graph(
      `/users/${encodeURIComponent(box.address)}/mailFolders/${folder.graph}/messages?${qs.join("&")}`
    );
    const messages = data?.value || [];
    return Response.json({
      mailbox: { key: box.key, label: box.label, address: box.address },
      folder: folder.key,
      messages,
      // null => no more pages (search, or a short final page).
      nextSkip: !q && messages.length === top ? skip + top : null,
    });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
