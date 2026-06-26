"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCog,
  FileText,
  CalendarClock,
  CalendarX,
  Trophy,
  Sparkles,
  Timer,
  PhoneOff,
  MessageCircle,
  ScrollText,
  ShieldCheck,
  BarChart3,
  LogOut,
} from "lucide-react";
import { getSession, clearSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { logEvent } from "@/lib/activity";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/blank-followups", label: "Blank Follow-ups", icon: CalendarX },
  { href: "/customers", label: "Manage Customers", icon: UserCog },
  { href: "/sla", label: "SLA Board", icon: Timer },
  { href: "/booking-report", label: "Booking Report", icon: BarChart3 },
  { href: "/rnr", label: "RNR Analytics", icon: PhoneOff },
  { href: "/whatsapp", label: "WhatsApp Engaged", icon: MessageCircle },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/ai-analytics", label: "AI Analytics", icon: Sparkles },
  { href: "/logs", label: "Productivity", icon: ScrollText },
];

// Admin-only nav (gated by isAdmin) — replaces the rep nav for admins.
const ADMIN_NAV = [
  { href: "/admin", label: "Team Report", icon: ShieldCheck },
  { href: "/admin/agents", label: "Agent-wise Stats", icon: Users },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);

  useEffect(() => setSession(getSession()), []);

  const fname = session?.user_fname || "User";
  const initials = fname.slice(0, 2).toUpperCase();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      {/* brand */}
      <div className="flex items-center justify-center px-5 py-6">
        <Image
          src="https://safestorage.in/assets/new_design_css/img/logo.png"
          alt="SafeStorage"
          width={190}
          height={71}
          priority
          className="h-12 w-auto"
        />
      </div>
      <div className="mx-5 mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Agentic CRM · Sales
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {(isAdmin(session) ? ADMIN_NAV : NAV).map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-4.5 w-4.5 ${active ? "text-indigo-600" : "text-slate-400"}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* user */}
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{fname}</p>
            <p className="truncate text-xs text-slate-400">{session?.user_email}</p>
          </div>
          <button
            onClick={() => {
              logEvent("logout", session?.user_email || "");
              clearSession();
              router.replace("/login");
            }}
            title="Sign out"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
