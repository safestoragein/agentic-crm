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
  BarChartBig,
  Phone,
  LogOut,
  X,
} from "lucide-react";
import { getSession, clearSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";
import { logEvent, saveLogoutTime } from "@/lib/activity";
import { fetchNavCounts, fetchLeadsTodayCount } from "@/lib/crm";
import { useEffect, useState } from "react";

// Nav items whose red count badge is intentionally hidden. Leads / Quotations
// "today" counts aren't actionable at a glance, so the badge is just noise —
// the follow-up badges (pending work) are the ones worth surfacing.
const HIDE_BADGE = new Set(["/leads", "/quotations"]);

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/blank-followups", label: "Blank / Overdue Follow-ups", icon: CalendarX },
  { href: "/customers", label: "Manage Customers", icon: UserCog },
  { href: "/booking-report", label: "Booking Report", icon: BarChart3 },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/call-analysis", label: "Call Analysis", icon: Phone },
  { href: "/calls-by-hour", label: "Calls by Hour", icon: BarChartBig },
  { href: "/logs", label: "Productivity", icon: ScrollText },
];

// Admin-only nav (gated by isAdmin) — replaces the rep nav for admins.
// SLA / RNR / WhatsApp / AI analytics are admin-only and live here, not in NAV.
const ADMIN_NAV = [
  { href: "/admin", label: "Team Report", icon: ShieldCheck },
  { href: "/admin/agents", label: "Agent-wise Stats", icon: Users },
  { href: "/sla", label: "SLA Board", icon: Timer },
  { href: "/rnr", label: "RNR Analytics", icon: PhoneOff },
  { href: "/whatsapp", label: "WhatsApp Engaged", icon: MessageCircle },
  { href: "/call-analysis", label: "Call Analysis", icon: Phone },
  { href: "/calls-by-hour", label: "Calls by Hour", icon: BarChartBig },
  { href: "/ai-analytics", label: "AI Analytics", icon: Sparkles },
];

export default function Sidebar({ collapsed = false, mobileOpen = false, onClose }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);
  // Live "today" counts shown as nav badges, keyed by href. Per logged-in rep.
  const [badges, setBadges] = useState({});

  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (!s || isAdmin(s)) return; // admins use the team nav (no per-rep counts)
    const ctrl = new AbortController();
    // Fast bundle → quotations / follow-ups / blank / booking-report / logs.
    fetchNavCounts(s.user_id, { signal: ctrl.signal })
      .then((counts) => setBadges((b) => ({ ...b, ...counts })))
      .catch(() => {});
    // Leads is a heavy separate fetch, so its badge fills in independently.
    fetchLeadsTodayCount(s.user_id, { signal: ctrl.signal })
      .then((n) => setBadges((b) => ({ ...b, "/leads": n })))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const fname = session?.user_fname || "User";
  const initials = fname.slice(0, 2).toUpperCase();

  const content = (
    <>
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
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-4.5 w-4.5 ${active ? "text-indigo-600" : "text-slate-400"}`} />
              {label}
              {!HIDE_BADGE.has(href) && badges[href] > 0 && (
                <span
                  title={`${badges[href]} due today`}
                  className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm ring-2 ring-rose-100"
                >
                  {badges[href]}
                </span>
              )}
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
              saveLogoutTime();
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
    </>
  );

  return (
    <>
      {/* Desktop rail (collapsible via the TopBar toggle) */}
      {!collapsed && (
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          {content}
        </aside>
      )}

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col border-r border-slate-200 bg-white shadow-2xl">
            <button
              onClick={onClose}
              title="Close menu"
              className="absolute right-2 top-2 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
