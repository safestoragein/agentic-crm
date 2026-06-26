"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, LogOut } from "lucide-react";
import { getSession, clearSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { logEvent } from "@/lib/activity";
import AlertCenter from "@/components/AlertCenter";

export default function TopBar() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    setSession(getSession());
  }, []);

  // Jump to the Quotations list with the typed term applied. Quotations search
  // spans the rep's whole history (all dates), so a phone number finds the
  // customer no matter when they quoted.
  const runSearch = () => {
    const term = q.trim();
    if (!term) return;
    router.push(`/quotations?q=${encodeURIComponent(term)}`);
  };

  const fname = session?.user_fname || "User";
  const initials = fname.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex items-center gap-4 px-5 py-3">
        <Image src="https://safestorage.in/assets/new_design_css/img/logo.png" alt="SafeStorage" width={190} height={71} className="h-7 w-auto lg:hidden" />

        <div className="relative hidden flex-1 sm:block sm:max-w-lg">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder="Search customer by name, phone, quote # — press Enter"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
          />
        </div>

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
