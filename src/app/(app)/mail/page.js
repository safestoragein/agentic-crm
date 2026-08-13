"use client";

// /mail has no view of its own — send it to the first mailbox in the nav.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MAILBOXES } from "@/lib/mailboxes";

export default function MailIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/mail/${MAILBOXES[0].key}`);
  }, [router]);
  return <div className="px-5 py-10 text-sm text-slate-400">Opening mailbox…</div>;
}
