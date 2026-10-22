"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";
import { inputClass, primaryButton } from "./ui";

// Shows the sign-up / log-in page until someone is signed in, then shows the app.
export function AuthGate(props: { children: (user: { email: string; signOut: () => void }) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still checking

  useEffect(() => {
    if (!supabaseConfigured) return;
    const db = getSupabase();
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="rounded-md border-l-4 border-amber-600 bg-amber-50 p-3 text-amber-900">
          Accounts are not set up yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the app settings, then reload.
        </p>
      </main>
    );
  }
  if (session === undefined) return <p className="p-6 text-zinc-600">Loading...</p>;
  if (session === null) return <Landing />;
  return <>{props.children({ email: session.user.email ?? "your account", signOut: () => void getSupabase().auth.signOut() })}</>;
}

const POINTS = [
  { title: "Know what is in your kitchen", text: "Log every delivery with its expiry date and cost. See what to use first and what has already expired." },
  { title: "See where food is wasted", text: "Write down what you throw away and why. The rupee total by reason shows where to change something." },
  { title: "Plan tomorrow from your own sales", text: "Get a prep list, a buy list and waste-risk alerts, plus a chart of which dishes use up which ingredients." },
];

function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 md:flex-row md:items-start">
      <section className="flex-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">For restaurants with 30 to 60 seats</p>
        <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight text-balance">Throw away less food. Keep more of your margin.</h1>
        <p className="mt-3 max-w-prose text-lg text-zinc-700">
          Kitchen Planner helps an owner or kitchen manager track daily stock and expiry, log waste, and decide what to prepare and buy tomorrow. No analyst and no special equipment needed.
        </p>
        <ul className="mt-6 flex flex-col gap-4">
          {POINTS.map((p) => (
            <li key={p.title}>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="text-zinc-700">{p.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-prose text-sm text-zinc-600">
          Forecasts are estimates based on your recent sales. They do not know about events, weather or offers, so use them as a starting point.
        </p>
      </section>
      <AuthForm />
    </main>
  );
}

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email or password isn't right. Check both and try again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "There is already an account with that email. Choose Log in instead.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for our message, then log in.";
  if (m.includes("password") && m.includes("character")) return "Choose a longer password, at least 8 characters.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries. Wait a minute and try again.";
  if (m.includes("fetch") || m.includes("network")) return "Could not reach the server. Check your internet connection and try again.";
  return message;
}

function AuthForm() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    setInfo("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Write a valid email address, like name@example.com.");
    if (mode === "signup" && password.length < 8) return setError("Choose a password with at least 8 characters.");
    if (!password) return setError("Write your password.");
    setBusy(true);
    try {
      const db = getSupabase();
      if (mode === "signup") {
        const { data, error: err } = await db.auth.signUp({ email: email.trim(), password });
        if (err) setError(friendly(err.message));
        else if (!data.session) setInfo("Almost done. We sent a confirmation link to your email. Open it, then come back and log in.");
      } else {
        const { error: err } = await db.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(friendly(err.message));
      }
    } catch (e) {
      setError(friendly(e instanceof Error ? e.message : "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full rounded-lg border border-zinc-300 bg-white p-5 md:w-96">
      <div role="tablist" aria-label="Account" className="mb-4 flex gap-1 border-b border-zinc-300">
        {([["signup", "Create account"], ["login", "Log in"]] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={mode === id}
            onClick={() => { setMode(id); setError(""); setInfo(""); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${mode === id ? "border-brand text-brand" : "border-transparent text-zinc-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col text-sm font-semibold">Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 font-normal ${inputClass}`} />
        </label>
        <label className="flex flex-col text-sm font-semibold">Password
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 font-normal ${inputClass}`}
          />
          {mode === "signup" && <span className="mt-1 text-xs font-normal text-zinc-600">At least 8 characters.</span>}
        </label>
        <button disabled={busy} className={`${primaryButton} disabled:opacity-60`}>
          {busy ? "Please wait..." : mode === "signup" ? "Create my restaurant account" : "Log in"}
        </button>
        {error && <p role="alert" className="rounded-md border-l-4 border-red-600 bg-red-50 p-2 text-sm text-red-900">{error}</p>}
        {info && <p role="status" className="rounded-md border-l-4 border-emerald-600 bg-emerald-50 p-2 text-sm text-emerald-900">{info}</p>}
      </form>
      <p className="mt-4 text-xs text-zinc-600">Your restaurant&apos;s data is private to your account. Nobody else can see it.</p>
    </section>
  );
}
