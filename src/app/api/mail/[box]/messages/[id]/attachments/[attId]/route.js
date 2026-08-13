// Stream one attachment through the server. The browser never gets a Graph
// token — it just hits this URL and receives the bytes.
import { findMailbox } from "@/lib/mailboxes";
import { graph, graphRaw, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";

export const dynamic = "force-dynamic";

// Keep the filename safe for a Content-Disposition header (no quotes/newlines).
function safeName(name) {
  return String(name || "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 180);
}

export async function GET(request, { params }) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;

  const { box: boxKey, id, attId } = await params;
  const box = findMailbox(boxKey);
  if (!box) return Response.json({ error: "Unknown mailbox" }, { status: 404 });

  const user = `/users/${encodeURIComponent(box.address)}`;
  const msgId = encodeURIComponent(decodeURIComponent(id));
  const aId = encodeURIComponent(decodeURIComponent(attId));

  try {
    const meta = await graph(
      `${user}/messages/${msgId}/attachments/${aId}?$select=name,contentType,size`
    );
    const res = await graphRaw(`${user}/messages/${msgId}/attachments/${aId}/$value`);

    return new Response(res.body, {
      headers: {
        "Content-Type": meta?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName(meta?.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
