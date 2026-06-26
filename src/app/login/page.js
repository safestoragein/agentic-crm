"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Users,
  TrendingUp,
  Trophy,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { login, persistSession, getSession } from "@/lib/auth";
import { logEvent } from "@/lib/activity";

const FEATURES = [
  { icon: Users, label: "Leads & quotation pipeline" },
  { icon: TrendingUp, label: "Bookings & conversions" },
  { icon: Trophy, label: "Team performance & rankings" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getSession()) router.replace("/dashboard");
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const session = await login(email, password);
      persistSession(session, { remember });
      logEvent("login", session.user_email || email);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err?.code === "INVALID_CREDENTIALS"
          ? err.message
          : "We couldn't reach the server. Check your connection and try again."
      );
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-zinc-100 p-0 sm:p-6 lg:p-8">
      <div className="grid min-h-screen w-full max-w-6xl overflow-hidden bg-white sm:min-h-0 sm:rounded-3xl sm:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.45)] sm:ring-1 sm:ring-black/5 lg:grid-cols-2">
        {/* ---------------- Brand panel (charcoal) ---------------- */}
        <section className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white lg:flex">
          {/* desaturated warehouse photo as ambient backdrop */}
          <Image
            src="/warehouse.jpg"
            alt=""
            fill
            priority
            sizes="50vw"
            className="object-cover opacity-20 grayscale"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/80 via-zinc-950/85 to-zinc-950" />
          {/* fine grid texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />

          {/* logo */}
          <div className="relative text-center">
            <div className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-3">
              <Image
                src="https://safestorage.in/assets/new_design_css/img/logo.png"
                alt="SafeStorage"
                width={190}
                height={71}
                priority
                className="h-14 w-auto"
              />
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
              Agentic CRM · Sales Console
            </p>
          </div>

          {/* headline */}
          <div className="relative">
            <h1 className="text-[2.6rem] font-semibold leading-[1.1] tracking-tight">
              Your sales pipeline,
              <br />
              <span className="text-zinc-400">all in one place.</span>
            </h1>
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-zinc-400">
              Manage leads, quotations and bookings for the SafeStorage sales team
              — from a single, focused workspace.
            </p>
          </div>

          {/* feature list */}
          <ul className="relative divide-y divide-white/10 border-t border-white/10">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3.5 py-4">
                <Icon className="h-5 w-5 text-zinc-300" strokeWidth={1.75} />
                <span className="text-[15px] font-medium text-zinc-200">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------- Form panel ---------------- */}
        <section className="flex flex-col justify-center px-7 py-14 sm:px-14">
          <div className="mx-auto w-full max-w-sm">
            {/* mobile logo */}
            <div className="mb-10 flex justify-center lg:hidden">
              <div className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-5 py-3">
                <Image
                  src="https://safestorage.in/assets/new_design_css/img/logo.png"
                  alt="SafeStorage"
                  width={190}
                  height={71}
                  className="h-14 w-auto"
                />
              </div>
            </div>

            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Sign in
            </span>
            <h2 className="mt-3 text-[2rem] font-semibold tracking-tight text-zinc-900">
              Welcome back
            </h2>
            <p className="mt-2 text-[15px] text-zinc-500">
              Enter your credentials to access the CRM.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-7 flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <Field
                id="email"
                label="Email"
                icon={Mail}
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@safestorage.in"
                autoComplete="username"
                disabled={loading}
              />

              <Field
                id="password"
                label="Password"
                icon={Lock}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="text-zinc-400 transition-colors hover:text-zinc-700"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-zinc-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-800"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-sm font-medium text-zinc-900 underline-offset-4 transition-colors hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-10 text-center text-xs text-zinc-400">
              SafeStorage staff only · Contact your admin for access
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ id, label, icon: Icon, value, onChange, trailing, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <div className="group relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900" />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full rounded-lg border border-zinc-200 bg-white py-3 pl-11 pr-11 text-[15px] text-zinc-900 placeholder:text-zinc-400 transition-all focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5 disabled:opacity-60"
          {...props}
        />
        {trailing && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">{trailing}</div>
        )}
      </div>
    </div>
  );
}
