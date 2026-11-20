"use client";
// Account: sign in (or recover a forgotten password), and once signed in, the profile, email, password,
// sign-out and account deletion. Links in account emails land here.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { accountUrl, authMessage, endRecovery, inRecovery, linkError, supabase } from "@/lib/supabase";
import { Auth, Note, PasswordField, type Msg } from "@/components/Auth";
import { Panel, State } from "@/components/ui";

function NewPassword({ email, onDone }: { email?: string; onDone: () => void }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMsg({ ok: false, text: "The two passwords don't match." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase!.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setMsg({ ok: false, text: authMessage(error) }); else { endRecovery(); onDone(); }
  };
  return (
    <div className="mx-auto max-w-md">
      <Panel title="Choose a new password">
        <p className="mb-4 text-[12.5px] leading-relaxed text-dim">The reset link worked{email ? <> for <b className="text-ink">{email}</b></> : null}. Choose a new password to finish — you'll stay signed in.</p>
        <form onSubmit={save} className="space-y-3 text-xs">
          <PasswordField label="New password" hint="at least 8 characters" value={pw} onChange={setPw} minLength={8} autoComplete="new-password" />
          <PasswordField label="Repeat new password" value={pw2} onChange={setPw2} minLength={8} autoComplete="new-password" />
          <button className="btn primary w-full" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save new password"}</button>
          <Note msg={msg} />
        </form>
      </Panel>
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return <Panel title={title} note={note}><div className="space-y-3 text-xs">{children}</div></Panel>;
}

function Profile({ session }: { session: Session }) {
  const uid = session.user.id;
  const [name, setName] = useState(""); const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    supabase!.from("profiles").select("display_name").eq("id", uid).maybeSingle().then(({ data }) => { setName(data?.display_name || ""); setSaved(data?.display_name || ""); });
  }, [uid]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase!.from("profiles").update({ display_name: name.trim() }).eq("id", uid);
    setBusy(false);
    if (error) setMsg({ ok: false, text: /check constraint/.test(error.message) ? "The name needs to be 2 to 30 characters." : error.message });
    else { setSaved(name.trim()); setMsg({ ok: true, text: "Saved. Your leagues see the new name." }); }
  };
  return (
    <Section title="Profile">
      <form onSubmit={save} className="space-y-3">
        <label className="flex flex-col gap-1.5 text-dim">Display name (shown to your leagues)
          <input type="text" required minLength={2} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></label>
        <button className="btn primary" disabled={busy || name.trim() === saved || name.trim().length < 2} aria-busy={busy}>{busy ? "Saving…" : "Save name"}</button>
        <Note msg={msg} />
      </form>
    </Section>
  );
}

function EmailChange({ session }: { session: Session }) {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const pending = session.user.new_email;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase!.auth.updateUser({ email: email.trim() }, { emailRedirectTo: accountUrl() });
    setBusy(false);
    if (error) setMsg({ ok: false, text: authMessage(error) });
    else { setMsg({ ok: true, text: `Almost done: open the confirmation link sent to ${email.trim()} (your current address may get one too). Until then you keep signing in with ${session.user.email}.` }); setEmail(""); }
  };
  return (
    <Section title="Email address">
      <div className="text-dim">Signed in as <b className="text-ink">{session.user.email}</b>{pending && <> · change to <b className="text-ink">{pending}</b> waiting for confirmation</>}</div>
      <form onSubmit={save} className="space-y-3">
        <label className="flex flex-col gap-1.5 text-dim">New email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <button className="btn" disabled={busy || !email.trim()} aria-busy={busy}>{busy ? "Sending…" : "Change email"}</button>
        <Note msg={msg} />
      </form>
    </Section>
  );
}

function PasswordChange({ session }: { session: Session }) {
  const [cur, setCur] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMsg({ ok: false, text: "The two new passwords don't match." }); return; }
    setBusy(true); setMsg(null);
    // check the current password first: it proves the change is wanted, and it counts as a recent sign-in
    const check = await supabase!.auth.signInWithPassword({ email: session.user.email!, password: cur });
    if (check.error) { setBusy(false); setMsg({ ok: false, text: /don't match an account/.test(authMessage(check.error)) ? "Your current password is incorrect." : authMessage(check.error) }); return; }
    const { error } = await supabase!.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setMsg({ ok: false, text: authMessage(error) });
    else { setCur(""); setPw(""); setPw2(""); setMsg({ ok: true, text: "Password changed. Use the new one next time you sign in." }); }
  };
  return (
    <Section title="Password">
      <form onSubmit={save} className="space-y-3">
        <PasswordField label="Current password" value={cur} onChange={setCur} autoComplete="current-password" />
        <PasswordField label="New password" hint="at least 8 characters" value={pw} onChange={setPw} minLength={8} autoComplete="new-password" />
        <PasswordField label="Repeat new password" value={pw2} onChange={setPw2} minLength={8} autoComplete="new-password" />
        <button className="btn" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Change password"}</button>
        <Note msg={msg} />
      </form>
    </Section>
  );
}

function SignOutAndDelete() {
  const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const del = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase!.rpc("delete_my_account");
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: /could not find the function|PGRST202|does not exist/i.test(error.message + error.code)
        ? "Deleting accounts isn't switched on for this site yet (the site owner needs to run supabase/account.sql once)." : error.message });
      return;
    }
    await supabase!.auth.signOut();
  };
  return (
    <Section title="Sign out and delete">
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => supabase!.auth.signOut()}>Sign out</button>
        <button className="btn" onClick={() => supabase!.auth.signOut({ scope: "global" })} title="Signs you out on every phone and computer">Sign out everywhere</button>
      </div>
      <div className="border-t border-line pt-3">
        <p className="mb-2 leading-relaxed text-dim">Deleting your account removes your picks and league memberships, and cannot be undone. A league you created passes to its longest-standing member; it is deleted only if you're its only member.</p>
        <label className="flex flex-col gap-1.5 text-dim">To delete your account, type DELETE<input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
        <button className="btn mt-2 border-bad/50 text-[#ffb3ae] hover:bg-bad/15" disabled={busy || confirm !== "DELETE"} onClick={del} aria-busy={busy}>{busy ? "Deleting…" : "Delete my account"}</button>
      </div>
      <Note msg={msg} />
    </Section>
  );
}

export default function Account() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [done, setDone] = useState<Msg>(null);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setRecovery(inRecovery()); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) return <State empty="Accounts are not switched on for this deployment yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the front end's environment and redeploy." />;
  if (!ready) return <State loading />;
  if (session && recovery) return <NewPassword email={session.user.email} onDone={() => { setRecovery(false); setDone({ ok: true, text: "New password saved. You're signed in." }); }} />;
  if (!session) return (
    <Auth title="Your account" intro="Sign in to make predictions and play in leagues with friends. Forgotten your password? Use the link under the password box."
      start={linkError ? "forgot" : "in"} banner={linkError ? { ok: false, text: linkError } : null} />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
        <Link href="/play" className="btn ml-auto">Go to predictions</Link>
      </div>
      <Note msg={done} />
      <div className="grid gap-5 md:grid-cols-2">
        <Profile session={session} />
        <EmailChange session={session} />
        <PasswordChange session={session} />
        <SignOutAndDelete />
      </div>
    </div>
  );
}
