"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

type Setup = { secret: string; qr: string };

export default function MfaSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const json = await res.json();
      if (res.ok) setSetup(json.data);
      else if (res.status === 401) router.replace("/login");
      else setError(json.message ?? "Could not start setup");
    })();
  }, [router]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    setBusy(false);
    if (res.ok) setRecovery(json.data.recoveryCodes);
    else setError(json.message ?? "Invalid code");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 shadow-card">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-6 text-forest-950" />
          <h1 className="text-2xl font-bold tracking-tight">Secure your account</h1>
        </div>

        {recovery ? (
          <div className="mt-4">
            <p className="text-sm text-gray-600">
              Two-step verification is on. Save these one-time recovery codes somewhere safe — each works once if you lose your
              authenticator. <strong>They will not be shown again.</strong>
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-4 font-mono text-sm">
              {recovery.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <button onClick={() => { router.push("/dashboard"); router.refresh(); }}
              className="mt-6 h-11 w-full rounded-xl bg-lime text-sm font-semibold text-forest-950 hover:bg-lime-hover">
              I&apos;ve saved them — continue
            </button>
          </div>
        ) : (
          <form onSubmit={confirm} className="mt-4">
            <p className="text-sm text-gray-600">
              Because this workspace handles health information, two-step verification is required. Scan the QR code with an
              authenticator app (Microsoft Authenticator, Google Authenticator, Authy, 1Password), then enter the 6-digit code.
            </p>
            {setup ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setup.qr} alt="Authenticator QR code" width={220} height={220} className="rounded-xl border border-gray-100" />
                <p className="text-xs text-gray-500">Can&apos;t scan? Enter this key manually:</p>
                <code className="rounded bg-gray-50 px-2 py-1 font-mono text-xs tracking-wider">{setup.secret}</code>
              </div>
            ) : !error && <p className="mt-6 text-sm text-gray-400">Preparing…</p>}

            <label htmlFor="code" className="mb-1 mt-6 block text-xs font-semibold text-gray-600">6-digit code</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required
              placeholder="123456"
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-center font-mono text-lg tracking-widest outline-none focus:bg-white focus:ring-2 focus:ring-lime" />

            {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{error}</p>}

            <button type="submit" disabled={busy || !setup}
              className="mt-6 h-11 w-full rounded-xl bg-lime text-sm font-semibold text-forest-950 hover:bg-lime-hover disabled:opacity-50">
              {busy ? "Verifying…" : "Turn on two-step verification"}
            </button>
            <button type="button" onClick={signOut} className="mt-3 w-full text-xs text-gray-500 underline">Sign out</button>
          </form>
        )}
      </div>
    </div>
  );
}
