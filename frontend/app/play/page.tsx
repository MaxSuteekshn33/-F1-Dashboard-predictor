"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, score, type Pick } from "@/lib/supabase";
import { api } from "@/lib/api";
import { Notes, Panel, State, Tabs, dt, teamColour } from "@/components/ui";

const EMPTY: Pick = { winner: "", p2: "", p3: "", fastest_lap: null, safety_car: null, winner_stops: null };
const RULES = ["Winner in the right place: 10 points", "Second place exact: 6 · third place exact: 4", "A podium driver in the wrong slot: 2", "Fastest lap: 3", "Safety Car deployed, yes or no: 3", "Number of pit stops the winner makes: 3"];

function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const s = Math.max(0, (to - now) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span className="num">{d > 0 ? `${d}d ` : ""}{h}h {m}m</span>;
}

function Auth() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!supabase) return;
    setBusy(true); setMsg(null);
    const res = mode === "in" ? await supabase.auth.signInWithPassword({ email, password: pw })
      : await supabase.auth.signUp({ email, password: pw, options: { data: { display_name: name.trim() } } });
    setBusy(false);
    if (res.error) setMsg({ ok: false, text: res.error.message });
    else if (mode === "up" && !res.data.session) setMsg({ ok: true, text: "Account created. Check your email for a confirmation link, then sign in." });
  };
  return (
    <div className="mx-auto max-w-md">
      <Panel title="Join the prediction game">
        <p className="mb-4 text-[12.5px] leading-relaxed text-dim">Make your picks before each race, score points when the result is in, and compare with friends in a private league. Points only — no money is involved.</p>
        <div className="mb-4"><Tabs tabs={[["in", "Sign in"], ["up", "Create account"]]} value={mode} onChange={(v) => { setMode(v); setMsg(null); }} /></div>
        <form onSubmit={submit} className="space-y-3 text-xs">
          {mode === "up" && <label className="flex flex-col gap-1.5 text-dim">Display name (shown to your leagues)<input type="text" required minLength={2} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></label>}
          <label className="flex flex-col gap-1.5 text-dim">Email<input type="text" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label className="flex flex-col gap-1.5 text-dim">Password{mode === "up" && " (at least 8 characters)"}<input type="password" required minLength={mode === "up" ? 8 : 1} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"}
            className="rounded-[10px] border border-line bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-white/35" /></label>
          <button className="btn primary w-full" disabled={busy} aria-busy={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</button>
          {msg && <div role="status" className={`rounded-xl border px-3 py-2 ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/30 bg-bad/10 text-[#ffb3ae]"}`}>{msg.text}</div>}
        </form>
      </Panel>
    </div>
  );
}

function DriverSelect({ drivers, value, onChange, exclude = [], label, disabled, optional }: any) {
  return (
    <label className="flex flex-col gap-1.5 text-dim">{label}
      <select value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} required={!optional}>
        <option value="">{optional ? "No pick" : "Choose a driver"}</option>
        {drivers.filter((d: any) => !exclude.includes(d.id) || d.id === value).map((d: any) => <option key={d.id} value={d.id}>{d.code} · {d.name} ({d.team})</option>)}
      </select>
    </label>
  );
}

export default function Play() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [races, setRaces] = useState<any[]>([]);
  const [mine, setMine] = useState<Record<number, any>>({});
  const [profile, setProfile] = useState<any | null>(null);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [league, setLeague] = useState<string | null>(null);
  const [board, setBoard] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [form, setForm] = useState<Pick>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState(""); const [code, setCode] = useState("");
  const [lmsg, setLmsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const now = Date.now();
  const next = useMemo(() => races.find((r) => new Date(r.starts_at).getTime() > now), [races]); // eslint-disable-line
  const lastLocked = useMemo(() => [...races].reverse().find((r) => new Date(r.starts_at).getTime() <= now), [races]); // eslint-disable-line
  const nameOf = useCallback((race: any, id?: string | null) => { const d = (race?.drivers || []).find((x: any) => x.id === id); return d ? d.code : id || "—"; }, []);

  const load = useCallback(async () => {
    if (!supabase || !uid) return;
    setErr(null);
    const [r, p, pr, lg] = await Promise.all([
      supabase.from("races").select("*").order("starts_at"),
      supabase.from("predictions").select("*").eq("user_id", uid),
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("leagues").select("*").order("created_at"),
    ]);
    const e = r.error || p.error || pr.error || lg.error;
    if (e) { setErr(e.message.includes("does not exist") || e.code === "42P01" || e.code === "PGRST205" ? "The league database has not been set up yet (run supabase/schema.sql and supabase/races.sql in the Supabase SQL Editor)." : e.message); return; }
    setRaces(r.data || []); setProfile(pr.data);
    setMine(Object.fromEntries((p.data || []).map((x: any) => [x.race_id, x])));
    setLeagues(lg.data || []);
    setLeague((cur) => cur && (lg.data || []).some((l: any) => l.id === cur) ? cur : (lg.data || [])[0]?.id || null);
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (next) setForm(mine[next.id] ? { winner: mine[next.id].winner, p2: mine[next.id].p2, p3: mine[next.id].p3, fastest_lap: mine[next.id].fastest_lap, safety_car: mine[next.id].safety_car, winner_stops: mine[next.id].winner_stops } : EMPTY); }, [next?.id, mine]); // eslint-disable-line
  useEffect(() => {
    if (!supabase || !league) { setBoard([]); setPicks([]); return; }
    supabase.rpc("league_leaderboard", { l: league }).then(({ data }) => setBoard(data || []));
    if (lastLocked) supabase.rpc("league_picks", { l: league, race: lastLocked.id }).then(({ data }) => setPicks(data || [])); else setPicks([]);
  }, [league, lastLocked?.id, mine]); // eslint-disable-line

  if (!supabase) return <State empty="Accounts are not switched on for this deployment yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the front end's environment and redeploy." />;
  if (!ready) return <State loading />;
  if (!session) return <Auth />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!next || !uid) return;
    setSaving(true); setNote(null);
    const { error } = await supabase!.from("predictions").upsert({ user_id: uid, race_id: next.id, ...form, updated_at: new Date().toISOString() });
    setSaving(false);
    setNote(error ? { ok: false, text: /row-level security/.test(error.message) ? "Picks are locked — the race has started." : error.message } : { ok: true, text: "Saved. You can change it until lights out." });
    if (!error) load();
  };
  const useModel = async () => {
    setNote(null);
    try { const d = await api<any>("/api/next"); const t = d.prediction.top5; setForm((f) => ({ ...f, winner: t[0].driver_id, p2: t[1].driver_id, p3: t[2].driver_id })); setNote({ ok: true, text: "Filled the podium with the model's three favourites. Not saved yet." }); }
    catch { setNote({ ok: false, text: "The prediction service did not answer. Try again in a moment." }); }
  };
  const create = async () => { setLmsg(null); const { data, error } = await supabase!.rpc("create_league", { league_name: newName }); if (error) setLmsg(error.message); else { setNewName(""); await load(); setLeague(data.id); } };
  const join = async () => { setLmsg(null); const { data, error } = await supabase!.rpc("join_league", { code }); if (error) setLmsg(error.message); else { setCode(""); await load(); setLeague(data.id); } };
  const current = leagues.find((l) => l.id === league);
  const history = races.filter((r) => r.result && mine[r.id]).reverse();
  const total = history.reduce((a, r) => a + (score(mine[r.id], r.result) || 0), 0);
  const drivers = next?.drivers || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Predictions &amp; leagues</h1>
        <span className="text-xs text-dim">Signed in as <b className="text-ink">{profile?.display_name || session.user.email}</b> · {total} points from {history.length} scored {history.length === 1 ? "race" : "races"}</span>
        <button className="btn ml-auto" onClick={() => supabase!.auth.signOut()}>Sign out</button>
      </div>
      {err && <State error={err} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <Panel title={next ? `Your picks — ${next.name}` : "Your picks"} right={next && <span>Locks in <b className="text-ink"><Countdown to={new Date(next.starts_at).getTime()} /></b> · {dt(new Date(next.starts_at).getTime() / 1000)}</span>}
          note={<>Scoring: {RULES.join(" · ")}. Picks can be changed until lights out, then they lock and your league can see them. The Safety Car and pit-stop answers are scored only when that data is available for the race.</>}>
          {!next ? <State empty="No upcoming race in the calendar yet." /> : (
            <form onSubmit={save} className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-3">
                <DriverSelect label="Winner" drivers={drivers} value={form.winner} exclude={[form.p2, form.p3]} onChange={(v: string) => setForm({ ...form, winner: v || "" })} />
                <DriverSelect label="Second" drivers={drivers} value={form.p2} exclude={[form.winner, form.p3]} onChange={(v: string) => setForm({ ...form, p2: v || "" })} />
                <DriverSelect label="Third" drivers={drivers} value={form.p3} exclude={[form.winner, form.p2]} onChange={(v: string) => setForm({ ...form, p3: v || "" })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <DriverSelect label="Fastest lap (optional)" optional drivers={drivers} value={form.fastest_lap} onChange={(v: string | null) => setForm({ ...form, fastest_lap: v })} />
                <label className="flex flex-col gap-1.5 text-dim">Safety Car deployed? (optional)
                  <select value={form.safety_car === null ? "" : form.safety_car ? "y" : "n"} onChange={(e) => setForm({ ...form, safety_car: e.target.value === "" ? null : e.target.value === "y" })}><option value="">No pick</option><option value="y">Yes</option><option value="n">No</option></select></label>
                <label className="flex flex-col gap-1.5 text-dim">Winner&apos;s pit stops (optional)
                  <select value={form.winner_stops ?? ""} onChange={(e) => setForm({ ...form, winner_stops: e.target.value === "" ? null : Number(e.target.value) })}><option value="">No pick</option>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button className="btn primary" disabled={saving || !form.winner || !form.p2 || !form.p3} aria-busy={saving}>{saving ? "Saving…" : mine[next.id] ? "Update my picks" : "Save my picks"}</button>
                <button type="button" className="btn" onClick={useModel} title="Fill the podium with the model's three most likely winners">Use the model&apos;s podium</button>
                <a className="btn" href="/next">Open the Next Race predictions</a>
              </div>
              {note && <div role="status" className={`rounded-xl border px-3 py-2 ${note.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/30 bg-bad/10 text-[#ffb3ae]"}`}>{note.text}</div>}
            </form>
          )}
        </Panel>

        <Panel title="Your leagues" right={current && <span>Invite code <b className="num select-all rounded-md bg-white/[0.08] px-2 py-0.5 text-ink">{current.invite_code}</b></span>}>
          {leagues.length > 0 && <div className="mb-4"><Tabs tabs={leagues.map((l) => [l.id, l.name])} value={league || ""} onChange={setLeague} /></div>}
          {current ? (
            <div className="overflow-auto rounded-xl border border-line"><table className="grid-t"><thead><tr><th>#</th><th>Player</th><th className="r">Points</th><th className="r">Races scored</th><th className="r">Last race</th><th className="r">Next race</th></tr></thead>
              <tbody>{board.map((b, i) => <tr key={b.user_id} className={b.user_id === uid ? "!bg-white/[0.07]" : ""}><td className="num">{i + 1}</td><td className="font-semibold">{b.display_name}{b.user_id === uid && <span className="ml-2 text-[10px] font-normal text-faint">you</span>}</td><td className="r num font-semibold">{b.points}</td><td className="r num text-dim">{b.races_scored}</td><td className="r num text-dim">{b.last_race_points ?? "—"}</td><td className="r">{b.has_next_pick ? <span className="text-good">picked</span> : <span className="text-faint">not yet</span>}</td></tr>)}</tbody></table></div>
          ) : <State empty="You are not in a league yet. Create one and share its invite code, or join a friend's with their code." />}
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div className="flex gap-2"><input type="text" className="min-w-0 flex-1" placeholder="New league name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New league name" /><button className="btn" disabled={newName.trim().length < 2} onClick={create}>Create</button></div>
            <div className="flex gap-2"><input type="text" className="min-w-0 flex-1 uppercase" placeholder="Invite code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Invite code" /><button className="btn" disabled={code.trim().length < 4} onClick={join}>Join</button></div>
          </div>
          {lmsg && <div role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-xs text-[#ffb3ae]">{lmsg}</div>}
        </Panel>
      </div>

      {current && lastLocked && (
        <Panel title={`${current.name} — picks for ${lastLocked.name}`} pad={false} note="Shown once the race has started. Points appear when the result has been published and scored.">
          <State empty={picks.length === 0 ? "No picks to show for this race." : null}>
            <div className="overflow-auto"><table className="grid-t"><thead><tr><th>Player</th><th>Winner</th><th>Second</th><th>Third</th><th>Fastest lap</th><th>Safety Car</th><th className="r">Winner&apos;s stops</th><th className="r">Points</th></tr></thead>
              <tbody>
                {lastLocked.result && <tr className="!bg-good/10"><td className="font-semibold text-good">Result</td><td>{nameOf(lastLocked, lastLocked.result.winner)}</td><td>{nameOf(lastLocked, lastLocked.result.p2)}</td><td>{nameOf(lastLocked, lastLocked.result.p3)}</td><td>{nameOf(lastLocked, lastLocked.result.fastest_lap)}</td><td>{lastLocked.result.safety_car === null ? "—" : lastLocked.result.safety_car ? "Yes" : "No"}</td><td className="r num">{lastLocked.result.winner_stops ?? "—"}</td><td /></tr>}
                {picks.map((p) => <tr key={p.user_id}><td className="font-semibold">{p.display_name}</td>{p.winner ? <><td>{nameOf(lastLocked, p.winner)}</td><td>{nameOf(lastLocked, p.p2)}</td><td>{nameOf(lastLocked, p.p3)}</td><td>{nameOf(lastLocked, p.fastest_lap)}</td><td>{p.safety_car === null ? "—" : p.safety_car ? "Yes" : "No"}</td><td className="r num">{p.winner_stops ?? "—"}</td></> : <td colSpan={6} className="text-faint">No picks made</td>}<td className="r num font-semibold">{p.winner ? p.points ?? "—" : "—"}</td></tr>)}
              </tbody></table></div>
          </State>
        </Panel>
      )}

      <Panel title="Your scored races" pad={false}>
        <State empty={history.length === 0 ? "Nothing scored yet. Your first points arrive after the next race you make picks for." : null}>
          <div className="overflow-auto"><table className="grid-t"><thead><tr><th>Race</th><th>Your podium</th><th>Actual podium</th><th className="r">Points</th></tr></thead>
            <tbody>{history.map((r) => <tr key={r.id}><td>{r.season} {r.name}</td><td className="num">{nameOf(r, mine[r.id].winner)} · {nameOf(r, mine[r.id].p2)} · {nameOf(r, mine[r.id].p3)}</td><td className="num text-dim">{nameOf(r, r.result.winner)} · {nameOf(r, r.result.p2)} · {nameOf(r, r.result.p3)}</td><td className="r num font-semibold">{score(mine[r.id], r.result)}</td></tr>)}</tbody></table></div>
        </State>
      </Panel>
      <Notes title="How scoring works" items={[...RULES, "Results are published by the scheduled data refresh after each race weekend, so points can take a day or two to appear.", "This is a points game for fun. There is no money, and nothing here is betting advice."]} />
    </div>
  );
}
