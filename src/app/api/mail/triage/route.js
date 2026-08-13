// Priority triage board across every shared mailbox.
//
// Cost note: the obvious implementation (one Graph call per conversation to find
// our reply) is ~150 calls per page load. Instead we pull each mailbox's Inbox
// and Sent Items ONCE for the window and join them in memory on conversationId —
// 2 calls per mailbox, 8 total, regardless of how many threads there are.
//
// Query: ?days=7&mailbox=sales (repeatable; default all)
import { MAILBOXES, findMailbox } from "@/lib/mailboxes";
import { graph, graphConfigured, graphErrorResponse } from "@/lib/graph";
import { requireMailAdmin } from "@/lib/mailAuth";
import {
  classifyThread,
  triageSort,
  isInternal,
  isNoiseSender,
  isNoiseSubject,
  isRoleSender,
} from "@/lib/triage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SELECT = "id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,bodyPreview";
const PER_FOLDER = 150; // messages pulled per folder per mailbox
const MAX_THREADS = 200; // cap on what we return to the client

const addr = (m) => (m?.from?.emailAddress?.address || "").toLowerCase();
const name = (m) => m?.from?.emailAddress?.name || addr(m) || "Unknown";

async function pullFolder(mailbox, folder, sinceIso, dateField) {
  const qs = [
    `$select=${SELECT}`,
    `$top=${PER_FOLDER}`,
    `$filter=${dateField} ge ${sinceIso}`,
    `$orderby=${dateField} desc`,
  ].join("&");
  const data = await graph(
    `/users/${encodeURIComponent(mailbox.address)}/mailFolders/${folder}/messages?${qs}`
  );
  return data?.value || [];
}

// Build one triage row per conversation for a single mailbox.
function buildThreads(mailbox, inbox, sent, now) {
  // Our replies, grouped by conversation.
  const repliesByConv = new Map();
  for (const m of sent) {
    const t = new Date(m.sentDateTime || m.receivedDateTime).getTime();
    if (Number.isNaN(t)) continue;
    let cur = repliesByConv.get(m.conversationId);
    if (!cur) {
      cur = { at: 0, id: null, all: [] };
      repliesByConv.set(m.conversationId, cur);
    }
    cur.all.push(t); // every reply time, for first-response-time maths
    if (t > cur.at) {
      cur.at = t; // latest reply, for "are we the ones holding this up?"
      cur.id = m.id;
    }
  }

  // Genuine customer messages only: drop our own copies and automated senders.
  const byConv = new Map();
  for (const m of inbox) {
    const a = addr(m);
    if (!a || isInternal(a) || isNoiseSender(a)) continue;
    if (isNoiseSubject(m.subject)) continue; // calendar replies, read receipts, OOO
    const t = new Date(m.receivedDateTime).getTime();
    if (Number.isNaN(t)) continue;

    const conv = byConv.get(m.conversationId) || {
      conversationId: m.conversationId,
      messages: [],
    };
    conv.messages.push({ ...m, at: t });
    byConv.set(m.conversationId, conv);
  }

  const threads = [];
  for (const conv of byConv.values()) {
    conv.messages.sort((x, y) => y.at - x.at);
    const latest = conv.messages[0];
    const earliest = conv.messages[conv.messages.length - 1];
    const reply = repliesByConv.get(conv.conversationId) || null;

    // A brand-new enquiry: one message, nothing sent back, not a "Re:", and not
    // from a role mailbox (those are cold pitches far more often than customers).
    const isNewEnquiry =
      !reply &&
      conv.messages.length === 1 &&
      !/^\s*(re|fwd|fw)\s*:/i.test(latest.subject || "") &&
      !isRoleSender(addr(latest)) &&
      (mailbox.key === "sales" || mailbox.key === "info");

    // First-response time: earliest reply that came AFTER the first customer mail.
    const after = (reply?.all || []).filter((t) => t > earliest.at).sort((a, b) => a - b);
    const firstResponseHours = after.length ? (after[0] - earliest.at) / 3_600_000 : null;

    const verdict = classifyThread(
      {
        lastCustomerAt: latest.receivedDateTime,
        lastReplyAt: reply ? new Date(reply.at).toISOString() : null,
        customerMsgCount: conv.messages.length,
        replied: Boolean(reply),
        isNewEnquiry,
        text: `${latest.subject || ""} ${latest.bodyPreview || ""}`,
      },
      now
    );

    threads.push({
      id: latest.id,
      conversationId: conv.conversationId,
      mailbox: mailbox.key,
      mailboxLabel: mailbox.label,
      subject: latest.subject || "(no subject)",
      from: name(latest),
      fromAddress: addr(latest),
      preview: latest.bodyPreview || "",
      receivedDateTime: latest.receivedDateTime,
      lastReplyAt: reply ? new Date(reply.at).toISOString() : null,
      customerMsgCount: conv.messages.length,
      replied: Boolean(reply),
      isNewEnquiry,
      firstResponseHours,
      isRead: latest.isRead,
      hasAttachments: latest.hasAttachments,
      ...verdict,
    });
  }
  return threads;
}

function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function GET(request) {
  const auth = await requireMailAdmin(request);
  if (!auth.ok) return auth.response;
  if (!graphConfigured()) {
    return Response.json({ error: "Microsoft Graph is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 30);
  const wanted = url.searchParams.getAll("mailbox").map(findMailbox).filter(Boolean);
  const boxes = wanted.length ? wanted : MAILBOXES;

  const now = Date.now();
  const sinceIso = new Date(now - days * 86_400_000).toISOString();

  try {
    const perBox = await Promise.all(
      boxes.map(async (box) => {
        try {
          const [inbox, sent] = await Promise.all([
            pullFolder(box, "inbox", sinceIso, "receivedDateTime"),
            pullFolder(box, "sentitems", sinceIso, "sentDateTime"),
          ]);
          return { box, threads: buildThreads(box, inbox, sent, now), error: null };
        } catch (e) {
          // One unreachable mailbox shouldn't blank the whole board.
          return { box, threads: [], error: e?.message || "unavailable" };
        }
      })
    );

    const threads = perBox.flatMap((r) => r.threads).sort(triageSort);
    const awaiting = threads.filter((t) => t.awaitingHours != null);

    const stats = {
      days,
      threads: threads.length,
      overdue: threads.filter((t) => t.overdue).length,
      p1: threads.filter((t) => t.priority === "P1").length,
      p2: threads.filter((t) => t.priority === "P2").length,
      p3: threads.filter((t) => t.priority === "P3").length,
      unanswered: awaiting.length,
      newEnquiries: threads.filter((t) => t.isNewEnquiry).length,
      escalations: threads.filter((t) => t.escalation).length,
      angry: threads.filter((t) => t.tone === "angry").length,
      medianFirstResponseHours: median(threads.map((t) => t.firstResponseHours)),
      byMailbox: Object.fromEntries(
        perBox.map((r) => [
          r.box.key,
          {
            label: r.box.label,
            total: r.threads.length,
            overdue: r.threads.filter((t) => t.overdue).length,
            p1: r.threads.filter((t) => t.priority === "P1").length,
            unanswered: r.threads.filter((t) => t.awaitingHours != null).length,
            medianFirstResponseHours: median(r.threads.map((t) => t.firstResponseHours)),
            error: r.error,
          },
        ])
      ),
    };

    return Response.json({ stats, threads: threads.slice(0, MAX_THREADS) });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
