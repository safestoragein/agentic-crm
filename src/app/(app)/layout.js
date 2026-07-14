"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import PostCallActivity from "@/components/PostCallActivity";
import StandingsBanner from "@/components/StandingsBanner";
import { getSession, clearSession, isSessionStale } from "@/lib/auth";
import { logEvent } from "@/lib/activity";

export default function AppLayout({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Force a fresh login each morning: no session, or one started before today's
    // 08:00, sends the rep back to /login. Checked on mount and every minute so an
    // app left open overnight logs out when 8 AM passes.
    const check = () => {
      const s = getSession();
      if (!s || isSessionStale(s)) {
        clearSession();
        router.replace("/login");
        return false;
      }
      return true;
    };
    if (!check()) return;
    setReady(true);
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [router]);

  // Proactively recover from stale-chunk errors after a deploy. A dynamic import
  // for a re-hashed chunk that no longer exists rejects here (sometimes without
  // reaching the route error boundary), so reload once to fetch the fresh build.
  useEffect(() => {
    const looksLikeChunkError = (msg) =>
      /ChunkLoadError|Loading chunk [\w-]+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
        String(msg || "")
      );
    const reloadOnce = () => {
      const KEY = "crm_chunk_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    };
    const onError = (e) => {
      if (looksLikeChunkError(e?.message) || looksLikeChunkError(e?.error?.message)) reloadOnce();
    };
    const onRejection = (e) => {
      if (looksLikeChunkError(e?.reason?.message) || looksLikeChunkError(e?.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

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
        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
      <PostCallActivity />
      <StandingsBanner />
    </div>
  );
}
