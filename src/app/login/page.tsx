"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function done(setup: boolean) {
    router.push(setup ? "/mfa-setup" : next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const step2 = challenge !== null;
    if (!step2 && (!email || !password)) { setBusy(false); return; }
    const res = await fetch(step2 ? "/api/auth/mfa/verify" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(step2 ? { challenge, code } : { email, password }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.message ?? "Login failed");
      if (step2 && res.status === 401 && /expired/i.test(json.message ?? "")) { setChallenge(null); setCode(""); }
      return;
    }
    if (json.data?.mfaRequired) { setChallenge(json.data.challenge); setPassword(""); return; }
    done(!!json.data?.mfaSetupRequired);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* left: brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-forest-950 p-12 text-white lg:flex">
        <div className="absolute -bottom-32 -left-32 size-96 rounded-full bg-lime/20 blur-3xl" />
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-lime text-base font-black text-forest-950">V</span>
          <span className="text-xl font-bold tracking-tight">VFV CRM</span>
        </div>
        <div className="relative">
          <h1 className="max-w-[14ch] text-5xl font-semibold leading-[1.1] tracking-tight">
            Every lead, one pipeline, zero slips.
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-white/70">
            WhatsApp inbox, drag-and-drop pipeline, follow-up queues and honest analytics — built for Veda For Vaidyas.
          </p>
          <span className="mt-8 inline-flex items-center gap-2 rounded-full bg-forest-800 px-5 py-2.5 text-sm font-medium text-lime/90">
            <Sparkles className="size-4" /> BizBee AI coming soon
          </span>
        </div>
        <p className="relative text-xs text-white/40">Veda For Vaidyas · Free Plan</p>
      </div>

      {/* right: form */}
      <div className="flex items-center justify-center bg-page p-6">
        <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-8 shadow-card">
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-sm text-gray-500">Sign in to your VFV CRM workspace.</p>

          {challenge !== null ? (
            <div className="mt-6 space-y-2">
              <label htmlFor="code" className="mb-1 block text-xs font-semibold text-gray-600">Authenticator code or recovery code</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" required autoFocus
                placeholder="123456"
                className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-center font-mono text-lg tracking-widest outline-none focus:bg-white focus:ring-2 focus:ring-lime" />
              <button type="button" onClick={() => { setChallenge(null); setCode(""); setError(""); }} className="text-xs text-gray-500 underline">
                Back to sign in
              </button>
            </div>
          ) : (
          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold text-gray-600">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus
                placeholder="you@vfv.example"
                className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-lime" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-gray-600">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
                placeholder="••••••••"
                className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-lime" />
            </div>
          </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{error}</p>
          )}

          <button type="submit" disabled={busy}
            className="mt-6 h-11 w-full rounded-xl bg-lime text-sm font-semibold text-forest-950 transition-colors hover:bg-lime-hover disabled:opacity-50">
            {busy ? "Signing in…" : challenge !== null ? "Verify" : "Sign in"}
          </button>

          <div className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500">
            <p className="font-semibold text-gray-600">Demo accounts</p>
            <p>saileshv3756@gmail.com · admin</p>
            <p>gvvnaveen@gmail.com, sreyav84@gmail.com · staff</p>
            <p>Password for all: <code className="rounded bg-white px-1.5 py-0.5 font-mono">veda123</code></p>
          </div>
        </form>
      </div>
    </div>
  );
}
