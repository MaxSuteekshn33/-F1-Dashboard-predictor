"use client";
// Signing in, creating an account and recovering a forgotten password. Used by the prediction game and the
// account page.
import { useState } from "react";
import { accountUrl, authMessage, supabase } from "@/lib/supabase";
import { Panel, Tabs } from "@/components/ui";

export type Msg = { ok: boolean; text: string; action?: { label: string; run: () => void } } | null;

export function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div role={msg.ok ? "status" : "alert"} className={`rounded-xl border px-3 py-2 prose-body ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/30 bg-bad/10 text-[#ffb3ae]"}`}>
      {msg.text}
      {msg.action && <button type="button" className="ml-1.5 font-semibold underline underline-offset-2" onClick={msg.action.run}>{msg.action.label}</button>}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({ label, value, onChange, autoComplete, minLength = 1, hint }:
  { label: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1.5 text-dim">
      <span>{label}{hint && <span className="text-faint">, {hint}</span>}</span>
      <span className="relative flex">
        <input type={show ? "text" : "password"} required minLength={minLength} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          className="w-full pr-16" />
        <button type="button" className="absolute inset-y-0 right-1.5 my-auto h-7 rounded-lg px-2 text-[12.5px] text-dim hover:bg-white/10 hover:text-ink"
          onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
      </span>
    </label>
  );
}

export function Auth({ title = "Join the prediction game", intro, start = "in", banner }: { title?: string; intro?: React.ReactNode; start?: "in" | "up" | "forgot"; banner?: Msg }) {
  const [mode, setMode] = useState<"in" | "up" | "forgot">(start);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(banner ?? null);
  const go = (m: "in" | "up" | "forgot") => { setMode(m); setMsg(null); setPw(""); setPw2(""); };

  const resend = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: accountUrl() } });
    setBusy(false);
    setMsg(error ? { ok: false, text: authMessage(error) } : { ok: true, text: `A new confirmation link is on its way to ${email.trim()}. Open it, then sign in.` });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!supabase) return;
    const addr = email.trim();
    if (mode === "up" && pw !== pw2) { setMsg({ ok: false, text: "The two passwords don't match." }); return; }
    setBusy(true); setMsg(null);
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: accountUrl() });
      setBusy(false);
      // the same answer whether or not the address has an account, so the form cannot be used to find out who has one
      setMsg(error ? { ok: false, text: authMessage(error) } : { ok: true, text: `If there's an account for ${addr}, a link to choose a new password is on its way. It works once and expires after about an hour — check your spam folder if it doesn't arrive.` });
      return;
    }
    const res = mode === "in" ? await supabase.auth.signInWithPassword({ email: addr, password: pw })
      : await supabase.auth.signUp({ email: addr, password: pw, options: { data: { display_name: name.trim() }, emailRedirectTo: accountUrl() } });
    setBusy(false);
    if (res.error) {
      const text = authMessage(res.error);
      if (/not been confirmed|hasn't been confirmed/.test(text)) setMsg({ ok: false, text, action: { label: "Send the confirmation email again", run: resend } });
      else if (/don't match an account|already exists/.test(text)) setMsg({ ok: false, text, action: { label: "Reset password", run: () => go("forgot") } });
      else setMsg({ ok: false, text });
    } else if (mode === "up" && !res.data.session) {
      setMsg({ ok: true, text: `Account created. We've sent a confirmation link to ${addr} — open it, then sign in.` });
    }
    // otherwise the visitor is now signed in and the page around this form takes over
  };

  return (
    <div className="mx-auto max-w-md">
      <Panel title={mode === "forgot" ? "Reset your password" : title}>
        {mode === "forgot" ? (
          <p className="mb-4 prose-body text-dim">Enter the email address you signed up with. We'll send a link that lets you choose a new password.</p>
        ) : (
          <>
            <p className="mb-4 prose-body text-dim">{intro ?? "Make your picks before each race, score points when the result is in, and compare with friends in a private league. Points only — no money is involved."}</p>
            <div className="mb-4"><Tabs tabs={[["in", "Sign in"], ["up", "Create account"]]} value={mode} onChange={(v) => go(v as "in" | "up")} /></div>
          </>
        )}
        <form onSubmit={submit} className="space-y-3 text-[13px]">
          {mode === "up" && <label className="flex flex-col gap-1.5 text-dim">Display name (shown to your leagues)<input type="text" required minLength={2} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></label>}
          <label className="flex flex-col gap-1.5 text-dim">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          {mode !== "forgot" && <PasswordField label="Password" hint={mode === "up" ? "at least 8 characters" : undefined} value={pw} onChange={setPw} minLength={mode === "up" ? 8 : 1}
            autoComplete={mode === "in" ? "current-password" : "new-password"} />}
          {mode === "up" && <PasswordField label="Repeat password" value={pw2} onChange={setPw2} minLength={8} autoComplete="new-password" />}
          {mode === "in" && <div className="-mt-1 text-right"><button type="button" className="text-[13px] text-dim underline-offset-2 hover:text-ink hover:underline" onClick={() => go("forgot")}>Forgot password?</button></div>}
          <button className="btn primary w-full" disabled={busy} aria-busy={busy}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Email me a reset link"}
          </button>
          {mode === "forgot" && <button type="button" className="btn w-full" onClick={() => go("in")}>Back to sign in</button>}
          <Note msg={msg} />
        </form>
      </Panel>
    </div>
  );
}
