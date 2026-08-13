"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Paperclip,
  Reply,
  ReplyAll,
  Send,
  MailOpen,
  Mail as MailIcon,
  ExternalLink,
  AlertTriangle,
  Download,
  X,
} from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import { MAILBOXES, FOLDERS, findMailbox } from "@/lib/mailboxes";
import {
  fetchMessages,
  fetchMessage,
  setRead,
  sendReply,
  attachmentUrl,
  addressOf,
  nameOf,
  recipientLine,
  shortDate,
  fullDate,
  formatSize,
  initialsFor,
} from "@/lib/mail";

const PAGE_SIZE = 25;

export default function MailboxPage({ params }) {
  const { box } = use(params);
  return (
    <AdminOnly>
      {/* Suspense: MailboxPageInner reads ?msg= via useSearchParams */}
      <Suspense fallback={<div className="px-5 py-10 text-sm text-slate-400">Loading…</div>}>
        {/* key => switching mailbox remounts with clean filters/selection */}
        <MailboxPageInner key={box} boxKey={box} />
      </Suspense>
    </AdminOnly>
  );
}

function MailboxPageInner({ boxKey }) {
  const box = findMailbox(boxKey);

  const [folder, setFolder] = useState("inbox");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");

  // The loaded page is stamped with the filter combination it belongs to, so
  // "still loading" is DERIVED during render (result.key !== listKey) instead of
  // being cleared synchronously inside the effect. `nonce` lets Refresh force a
  // reload even when the filters haven't changed.
  const [nonce, setNonce] = useState(0);
  const listKey = `${boxKey}|${folder}|${query}|${unreadOnly ? 1 : 0}|${nonce}`;

  const [result, setResult] = useState({ key: null, messages: [], nextSkip: null, error: "" });
  const fresh = result.key === listKey;
  const list = fresh ? result.messages : null; // null = loading
  const listError = fresh ? result.error : "";
  const nextSkip = fresh ? result.nextSkip : null;

  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { message, attachments }
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (!box) return;
    const ctrl = new AbortController();
    fetchMessages(box.key, {
      folder,
      q: query,
      unread: unreadOnly,
      top: PAGE_SIZE,
      signal: ctrl.signal,
    })
      .then((data) =>
        setResult({ key: listKey, messages: data.messages, nextSkip: data.nextSkip, error: "" })
      )
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setResult({ key: listKey, messages: [], nextSkip: null, error: e?.message || "Could not load messages" });
      });
    return () => ctrl.abort();
  }, [box, folder, query, unreadOnly, listKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  async function loadMore() {
    if (nextSkip == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchMessages(box.key, {
        folder,
        q: query,
        unread: unreadOnly,
        top: PAGE_SIZE,
        skip: nextSkip,
      });
      setResult((prev) =>
        prev.key !== listKey // filters changed mid-flight — drop this page
          ? prev
          : { ...prev, messages: [...prev.messages, ...data.messages], nextSkip: data.nextSkip }
      );
    } catch (e) {
      setResult((prev) => (prev.key === listKey ? { ...prev, error: e?.message || "Could not load more" } : prev));
    } finally {
      setLoadingMore(false);
    }
  }

  // Deep link from the triage board: /mail/sales?msg=<id> opens that message
  // straight away, even when it isn't on the first page of the list.
  const deepLinkId = useSearchParams().get("msg");

  // Patch one row in the currently-loaded page (read/unread toggles).
  const patchRow = useCallback((id, patch) => {
    setResult((prev) => ({
      ...prev,
      messages: prev.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }, []);

  // Open a message: pull the full body, and mark it read once (optimistically in
  // the list so the row updates immediately).
  const openMessage = useCallback(
    async (row) => {
      setSelectedId(row.id);
      setDetail(null);
      setDetailError("");
      try {
        const data = await fetchMessage(box.key, row.id);
        setDetail(data);
        if (!row.isRead) {
          patchRow(row.id, { isRead: true });
          setRead(box.key, row.id, true).catch(() => {});
        }
      } catch (e) {
        setDetailError(e?.message || "Could not open this message");
      }
    },
    [box, patchRow]
  );

  useEffect(() => {
    if (deepLinkId) openMessage({ id: deepLinkId, isRead: true });
  }, [deepLinkId, openMessage]);

  async function markUnread() {
    if (!detail?.message) return;
    const id = detail.message.id;
    patchRow(id, { isRead: false });
    setDetail((d) => ({ ...d, message: { ...d.message, isRead: false } }));
    try {
      await setRead(box.key, id, false);
    } catch {
      /* non-critical — the list refreshes on the next load */
    }
  }

  if (!box) {
    return (
      <div className="px-5 py-16 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-lg font-bold text-slate-800">Unknown mailbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick one of: {MAILBOXES.map((m) => m.label).join(", ")}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* header */}
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
              <Inbox className="h-5 w-5 text-indigo-500" />
              {box.label}
            </h1>
            <p className="truncate text-xs text-slate-400">{box.address}</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(queryInput.trim());
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search this mailbox…"
                className="w-56 rounded-lg border border-slate-200 py-1.5 pl-8 pr-7 text-sm outline-none focus:border-indigo-400"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQueryInput("");
                    setQuery("");
                  }}
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </form>

            <button
              onClick={() => setUnreadOnly((v) => !v)}
              disabled={Boolean(query)}
              title={query ? "Not available while searching" : "Show unread only"}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                unreadOnly
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Unread
            </button>

            <button
              onClick={reload}
              title="Refresh"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* folder tabs */}
        <div className="mt-3 flex gap-1">
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFolder(f.key);
                setSelectedId(null);
                setDetail(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                folder === f.key
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* split pane */}
      <div className="flex min-h-0 flex-1">
        <MessageList
          list={list}
          error={listError}
          selectedId={selectedId}
          onOpen={openMessage}
          nextSkip={nextSkip}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          searching={Boolean(query)}
        />

        <div className="hidden min-w-0 flex-1 overflow-y-auto bg-white md:block">
          {!selectedId ? (
            <EmptyPane />
          ) : detailError ? (
            <PaneError message={detailError} />
          ) : !detail ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <MessageDetail
              key={detail.message.id} /* remount per message => composer resets */
              box={box}
              detail={detail}
              onMarkUnread={markUnread}
              onSent={reload}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageList({ list, error, selectedId, onOpen, nextSkip, loadingMore, onLoadMore, searching }) {
  return (
    <div className="w-full shrink-0 overflow-y-auto border-r border-slate-200 bg-white md:w-96">
      {error && (
        <div className="m-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {list === null ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">
          {searching ? "No messages match that search." : "Nothing here."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((m) => {
            const active = m.id === selectedId;
            return (
              <li key={m.id}>
                <button
                  onClick={() => onOpen(m)}
                  aria-label={`${m.isRead ? "" : "Unread. "}${nameOf(m.from) || "Unknown sender"}: ${
                    m.subject || "(no subject)"
                  }`}
                  className={`flex w-full gap-3 px-4 py-3 text-left transition-colors ${
                    active ? "bg-indigo-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      m.isRead ? "bg-transparent" : "bg-indigo-500"
                    }`}
                    title={m.isRead ? "Read" : "Unread"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`truncate text-sm ${
                          m.isRead ? "text-slate-600" : "font-bold text-slate-900"
                        }`}
                      >
                        {nameOf(m.from) || "(unknown sender)"}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                        {shortDate(m.receivedDateTime)}
                      </span>
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-sm ${
                        m.isRead ? "text-slate-500" : "font-semibold text-slate-800"
                      }`}
                    >
                      {m.subject || "(no subject)"}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {m.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                      <span className="truncate text-xs text-slate-400">{m.bodyPreview}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {nextSkip != null && (
        <div className="p-3">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-300">
      <MailOpen className="h-12 w-12" />
      <p className="mt-3 text-sm">Select a message to read it.</p>
    </div>
  );
}

function PaneError({ message }) {
  return (
    <div className="px-6 py-12 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-rose-300" />
      <p className="mt-2 text-sm text-rose-600">{message}</p>
    </div>
  );
}

function MessageDetail({ box, detail, onMarkUnread, onSent }) {
  const { message, attachments } = detail;
  // null | { replyAll: bool }. Reset per message via the key= on this component.
  const [composing, setComposing] = useState(null);

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-bold text-slate-900">{message.subject || "(no subject)"}</h2>

        <div className="mt-3 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
            {initialsFor(nameOf(message.from) || addressOf(message.from))}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-slate-800">
              {nameOf(message.from) || "(unknown sender)"}{" "}
              <span className="font-normal text-slate-400">&lt;{addressOf(message.from)}&gt;</span>
            </p>
            <p className="truncate text-xs text-slate-500">
              to {recipientLine(message.toRecipients) || box.label}
              {message.ccRecipients?.length > 0 && ` · cc ${recipientLine(message.ccRecipients)}`}
            </p>
            <p className="text-xs text-slate-400">{fullDate(message.receivedDateTime)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setComposing({ replyAll: false })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Reply className="h-4 w-4" /> Reply
          </button>
          <button
            onClick={() => setComposing({ replyAll: true })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ReplyAll className="h-4 w-4" /> Reply all
          </button>
          <button
            onClick={onMarkUnread}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <MailIcon className="h-4 w-4" /> Mark unread
          </button>
          {message.webLink && (
            <a
              href={message.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" /> Outlook
            </a>
          )}
        </div>

        {attachments?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <a
                key={a.id}
                href={attachmentUrl(box.key, message.id, a.id)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" />
                <span className="max-w-[14rem] truncate font-medium">{a.name}</span>
                <span className="text-slate-400">{formatSize(a.size)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <MessageBody html={message.body?.content || ""} />

      {composing && (
        <Composer
          box={box}
          message={message}
          replyAll={composing.replyAll}
          onCancel={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            onSent?.();
          }}
        />
      )}
    </div>
  );
}

// Email HTML is untrusted, so it renders inside a sandboxed iframe: no scripts,
// no form submission, no access to our page. `allow-same-origin` (without
// allow-scripts) is what lets us read scrollHeight to size the frame — it grants
// no script execution on its own.
function MessageBody({ html }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(320);

  const srcDoc = useMemo(
    () => `<!doctype html><html><head><base target="_blank">
<style>
  body{margin:0;padding:20px;font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;word-break:break-word;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:3px solid #e4e7eb;color:#697586;}
  a{color:#4f46e5;}
</style></head><body>${html}</body></html>`,
    [html]
  );

  function resize() {
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.body) setHeight(Math.min(Math.max(doc.body.scrollHeight + 32, 240), 4000));
    } catch {
      /* opaque document — keep the default height */
    }
  }

  return (
    <iframe
      ref={ref}
      title="Message body"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      onLoad={resize}
      style={{ height }}
      className="w-full flex-1 border-0"
    />
  );
}

function Composer({ box, message, replyAll, onCancel, onSent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const to = replyAll
    ? [message.from, ...(message.toRecipients || []), ...(message.ccRecipients || [])]
        .map(nameOf)
        .filter(Boolean)
        .join(", ")
    : nameOf(message.from);

  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      // Plain typing -> HTML paragraphs. The composer is deliberately plain-text
      // so a rep can't paste markup that breaks the outgoing mail.
      const html = body
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      await sendReply(box.key, message.id, { html, replyAll });
      setOk(true);
      setTimeout(onSent, 900);
    } catch (e2) {
      setError(e2?.message || "Could not send the reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-slate-200 bg-slate-50 px-6 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-white px-2 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
          From {box.address}
        </span>
        <span className="truncate">to {to}</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        placeholder="Type your reply…"
        className="w-full resize-y rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400"
      />

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {ok && <p className="mt-2 text-sm text-emerald-600">Reply sent.</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={sending || ok || !text.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? "Sending…" : replyAll ? "Send to all" : "Send reply"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
