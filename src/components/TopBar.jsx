"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { getSession, clearSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { logEvent, saveLogoutTime } from "@/lib/activity";
import AlertCenter from "@/components/AlertCenter";

// Page title shown in the top bar (moved out of each page for a cleaner look).
// Only the static list pages are here; dynamic/detail pages keep their own header.
const TITLES = {
  "/dashboard": "Dashboard",
  "/leads": "Leads",
  "/quotations": "Quotations",
  "/follow-ups": "Follow-ups",
  "/blank-followups": "Blank / Overdue Follow-ups",
  "/customers": "Manage Customers",
  "/booking-report": "Booking Report",
  "/leaderboard": "Leaderboard",
  "/logs": "Productivity",
  "/sla": "SLA Board",
  "/rnr": "RNR Analytics",
  "/whatsapp": "WhatsApp Engaged",
  "/ai-analytics": "AI Analytics",
  "/admin": "Team Report",
  "/admin/agents": "Agent-wise Stats",
};

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  const title = TITLES[pathname] || "";
  const fname = session?.user_fname || "User";
  const initials = fname.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex items-center gap-4 px-5 py-3">
        <Image src="https://safestorage.in/assets/new_design_css/img/logo.png" alt="SafeStorage" width={190} height={71} className="h-7 w-auto lg:hidden" />

        {title && <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">{title}</h1>}

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-sm font-medium text-emerald-600 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Available
          </span>

          {/* Smart Alert Engine — customer engagement alerts (reps only; admins
              don't work individual leads, so no bell/toasts for them) */}
          {!isAdmin(session) && <AlertCenter />}

          <div className="group relative">
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
              {initials}
            </button>
            <div className="invisible absolute right-0 top-11 w-48 rounded-xl border border-slate-200 bg-white p-1.5 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
              <div className="px-3 py-2 text-xs text-slate-500">
                Signed in as
                <div className="truncate font-medium text-slate-800">{session?.user_email}</div>
              </div>
              <button
                onClick={() => {
                  logEvent("logout", session?.user_email || "");
                  saveLogoutTime();
                  clearSession();
                  router.replace("/login");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
