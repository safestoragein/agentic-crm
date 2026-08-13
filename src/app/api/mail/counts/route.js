// Unread counts for every mailbox — powers the sidebar badges.
// One Graph call per mailbox, run in parallel. A mailbox that errors reports
// null rather than failing the whole response, so one bad mailbox can't blank
// the nav.
import { MAILBOXES } from "@/lib/mailboxes";
import { graph, graphConfigured, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;
  if (!graphConfigured()) return Response.json({ counts: {}, configured: false });

  try {
    const entries = await Promise.all(
      MAILBOXES.map(async (box) => {
        try {
          const folder = await graph(
            `/users/${encodeURIComponent(box.address)}/mailFolders/inbox?$select=unreadItemCount,totalItemCount`
          );
          return [box.key, { unread: folder?.unreadItemCount ?? 0, total: folder?.totalItemCount ?? 0 }];
        } catch {
          return [box.key, null];
        }
      })
    );
    return Response.json({ configured: true, counts: Object.fromEntries(entries) });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
