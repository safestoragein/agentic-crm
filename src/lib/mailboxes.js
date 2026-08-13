// Shared mailbox config — imported by BOTH the client (sidebar nav, mail pages)
// and the server (API routes). Contains no secrets, only the shared-mailbox
// addresses the Entra app is allowed to read.
//
// The `key` is what appears in the URL (/mail/sales) and is the ONLY value the
// client ever sends. Route handlers resolve key -> address through findMailbox()
// so a caller can never point Graph at an arbitrary mailbox by editing the URL.

const DOMAIN = process.env.NEXT_PUBLIC_MAIL_DOMAIN || "safestorage.in";

export const MAILBOXES = [
  { key: "complaints", label: "Complaints", local: "complaints", tone: "rose" },
  { key: "sales", label: "Sales", local: "sales", tone: "indigo" },
  { key: "info", label: "Info", local: "info", tone: "sky" },
  { key: "service", label: "Service", local: "service", tone: "emerald" },
].map((m) => ({ ...m, address: `${m.local}@${DOMAIN}` }));

export function findMailbox(key) {
  return MAILBOXES.find((m) => m.key === key) || null;
}

// Graph well-known folder names, exposed as tabs in the UI.
export const FOLDERS = [
  { key: "inbox", label: "Inbox", graph: "inbox" },
  { key: "sent", label: "Sent", graph: "sentitems" },
  { key: "archive", label: "Archive", graph: "archive" },
  { key: "junk", label: "Junk", graph: "junkemail" },
];

export function findFolder(key) {
  return FOLDERS.find((f) => f.key === key) || FOLDERS[0];
}
