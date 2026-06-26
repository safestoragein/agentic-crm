"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import PostCallActivity from "@/components/PostCallActivity";
import { getSession } from "@/lib/auth";
import { logEvent } from "@/lib/activity";

export default function AppLayout({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  // Log only MEANINGFUL work actions — calls, WhatsApp, customer opens, emails.
  // No page views / generic clicks (that's noise; this is productivity data).
  useEffect(() => {
    if (!ready) return;
    const onClick = (e) => {
      const el = e.target.closest?.("a");
      if (!el) return;
      const href = el.getAttribute("href") || "";
      let type = null;
      if (href.startsWith("tel:")) type = "call";
      else if (href.includes("wa.me")) type = "whatsapp";
      else if (href.startsWith("mailto:")) type = "email";
      else if (/^\/customer\//.test(href)) type = "view_customer";
      if (!type) return; // ignore everything else
      const label = (el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      logEvent(type, label || href, { href });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [ready]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1">{children}</main>
      </div>
      <PostCallActivity />
    </div>
  );
}
