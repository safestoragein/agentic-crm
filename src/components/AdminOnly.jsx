"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/adminAuth";

// Wraps a page so its content only renders for admin accounts (role_id 18 or an
// env override — see lib/adminAuth). Non-admins get a lock screen and the inner
// component never mounts, so no backend fetches fire for them.
export default function AdminOnly({ children }) {
  const [session, setSession] = useState(undefined);
  useEffect(() => setSession(getSession()), []);

  if (session === undefined) {
    return <div className="px-5 py-10 text-sm text-slate-400">Loading…</div>;
  }
  if (!isAdmin(session)) {
    return (
      <div className="px-5 py-16 text-center">
        <Lock className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-lg font-bold text-slate-800">Admins only</h1>
        <p className="mt-1 text-sm text-slate-500">This page is restricted to admin accounts.</p>
      </div>
    );
  }
  return children;
}
