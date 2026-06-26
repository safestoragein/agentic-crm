"use client";

// After-call activity capture (mobile). Tapping a `tel:` link hands the phone to
// the dialer; the web page has no "call ended" event, so we detect the agent
// RETURNING to the browser (page becomes visible / focused again) and then open
// the existing Log-activity (FollowUpModal) for whoever was just called.
//
// Mounted once in the app layout, so it works from every screen automatically.
//
// Who was called: read from the tapped tel: link. Most list rows carry the
// customer id in an adjacent `/customer/<id>` link, so we derive it from the DOM
// with no per-screen wiring. Screens without such a link (e.g. the customer
// detail page) pass it explicitly via data-cid / data-cname on the tel: anchor.

import { useEffect, useRef, useState } from "react";
import FollowUpModal from "@/components/FollowUpModal";

const KEY = "postcall_pending";
const MIN_AGE = 3000; // ignore returns within 3s (misdial / instant refocus)
const MAX_AGE = 30 * 60 * 1000; // forget a pending call after 30 min

export default function PostCallActivity() {
  const [target, setTarget] = useState(null);
  const openedFor = useRef(null);

  // Record context when a call (tel:) link is tapped.
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[href^="tel:"]');
      if (!a) return;

      let id = a.getAttribute("data-cid") || "";
      let name = a.getAttribute("data-cname") || "";
      const contact =
        a.getAttribute("data-ccontact") || (a.getAttribute("href") || "").replace(/^tel:/, "");

      // Fallback: derive the customer from a /customer/<id> link in the same row.
      if (!id) {
        const scope = a.closest("tr, li") || a.parentElement;
        const link = scope?.querySelector?.('a[href*="/customer/"]');
        const m = link?.getAttribute("href")?.match(/\/customer\/([^/?#]+)/);
        if (m) id = decodeURIComponent(m[1]);
        if (!name && link) name = (link.textContent || "").trim();
      }

      if (!id) return; // can't log without a customer id — skip (page stays put)
      const rec = { id, name: name || contact, contact, ts: Date.now() };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(rec));
      } catch {
        /* sessionStorage unavailable — feature simply no-ops */
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // When the agent returns to the browser after the call, open the log modal.
  useEffect(() => {
    const maybeOpen = () => {
      if (document.visibilityState === "hidden") return;
      let rec = null;
      try {
        rec = JSON.parse(sessionStorage.getItem(KEY) || "null");
      } catch {
        /* ignore */
      }
      if (!rec) return;
      const age = Date.now() - (rec.ts || 0);
      if (age < MIN_AGE || age > MAX_AGE) return;
      const sig = `${rec.id}-${rec.ts}`;
      if (openedFor.current === sig) return; // already opened for this call
      openedFor.current = sig;
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      // Real time spoken ≈ time the agent was away in the dialer (tap → return).
      const talkTimeSec = Math.round(age / 1000);
      setTarget({ id: rec.id, name: rec.name, contact: rec.contact, talkTimeSec });
    };
    document.addEventListener("visibilitychange", maybeOpen);
    window.addEventListener("focus", maybeOpen);
    window.addEventListener("pageshow", maybeOpen);
    return () => {
      document.removeEventListener("visibilitychange", maybeOpen);
      window.removeEventListener("focus", maybeOpen);
      window.removeEventListener("pageshow", maybeOpen);
    };
  }, []);

  if (!target) return null;
  return (
    <FollowUpModal
      quote={{ id: target.id, name: target.name, contact: target.contact }}
      talkTimeSec={target.talkTimeSec}
      onClose={() => setTarget(null)}
      onSaved={() => setTarget(null)}
    />
  );
}
