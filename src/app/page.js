"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import { getSession } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? "/dashboard" : "/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-slate-400">
        <Boxes className="h-6 w-6 animate-pulse text-brand-600" />
        <span className="text-sm font-medium">Loading SafeStorage CRM…</span>
      </div>
    </div>
  );
}
