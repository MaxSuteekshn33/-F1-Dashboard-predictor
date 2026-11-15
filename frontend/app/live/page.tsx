"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE, api, useApi, useRace } from "@/lib/api";
import { Bar, Confidence, Driver, Notes, Panel, Stat, State, Tag, Tyre, dt, fmtLap, num, pct, teamColour } from "@/components/ui";

const hm = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);

function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 30000); return () => clearInterval(t); }, []);
  const s = Math.max(0, to - now), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span className="num">{d > 0 ? `${d}d ` : ""}{h}h {m}m</span>;
}

export default function LiveRace() {
  const r = useRace();
  const [beat, setBeat] = useState(0);
  useEffect(() => { const t = setInterval(() => setBeat((x) => x + 1), 5000); return () => clearInterval(t); }, []);
  const { data: live, error: liveErr, reload } = useApi<any>("/api/live", beat + r.tick);
  const on = live?.session_key && live?.mode && (live.mode.mode === "LIVE" || live.mode.mode === "REHEARSAL" || live.mode.mode === "DELAYED");
  const rehearsing = live?.mode?.mode === "REHEARSAL";
  // follow the live session at its current lap
  useEffect(() => {
    if (!on) return;
    if (r.sessionKey !== live.session_key) r.setSessionKey(live.session_key);
    else if (r.lap !== null) r.setLap(null);
  }, [on, live?.session_key, r.sessionKey, r.lap]); // eslint-disable-line
  const ready = on && r.sessionKey === live.session_key;
  const q = ready ? `session_key=${live.session_key}` : null;
  const pred = useApi<any>(q && `/api/predict/inrace?${q}`, live?.lap ?? 0);
  const adv = useApi<any>(q && r.driver ? `/api/advisor?${q}&driver=${r.driver}&parts=strategy` : null, live?.lap ?? 0);
  const wxa = useApi<any>(q && r.driver ? `/api/advisor?${q}&driver=${r.driver}&parts=weather` : null, live?.lap ?? 0);

  const [sk, setSk] = useState<number | "">(""); const [speed, setSpeed] = useState(10); const [startLap, setStartLap] = useState(1);
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const call = async (method: "POST" | "DELETE") => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/live/rehearsal`, { method, headers: { "Content-Type": "application/json", ...(code ? { "X-Admin-Code": code } : {}) },
        body: method === "POST" ? JSON.stringify({ session_key: sk || r.sessions[0]?.session_key, speed, start_lap: startLap }) : undefined });
      if (!res.ok) { let m = `${res.status}`; try { m = (await res.json()).detail || m; } catch {} throw new Error(m); }
      reload();
    } catch (e: any) { setMsg(String(e.message || e)); } finally { setBusy(false); }
  };

  if (!live) return <State loading={!liveErr} error={liveErr} />;

  if (!on) {
    const nx = live.next_session;
    return (
      <div className="space-y-5">
        <section className="glass overflow-hidden rounded-3xl px-6 py-6">
          <div className="text-[10.5px] font-medium uppercase tracking-[.18em] text-faint">Live race</div>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">No race is live right now</h1>
          {nx ? <p className="mt-2 text-[13px] text-dim">Next session: <b className="text-ink">{nx.location} · {nx.session_name}</b>, {dt(nx.date_start)} — starts in <b className="text-ink"><Countdown to={nx.date_start} /></b>.</p>
            : <p className="mt-2 text-[13px] text-dim">No upcoming session is listed yet.</p>}
          <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-dim">When a Grand Prix or Sprint is running and timing data is arriving, this page follows it lap by lap: positions and gaps, each driver&apos;s chance of winning, and the current strategy call for your chosen driver. Real-time data during a session needs a paid OpenF1 account on the server{!live.openf1_authenticated ? "; none is configured, so a race would show as Delayed and fill in after the session." : live.openf1_auth?.ok ? " — one is configured and its sign-in works." : live.openf1_auth?.ok === false ? " — one is configured, but its sign-in is failing (see below)." : " — one is configured."}</p>
          {live.openf1_auth?.ok === false && <div role="alert" className="mt-3 max-w-3xl rounded-xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-xs text-[#ffb3ae]"><b>OpenF1 sign-in failed.</b> {live.openf1_auth.error} The server is falling back to free access, so a race would show as Delayed.</div>}
        </section>
        <Panel title="Rehearse with a past race" tags={["ASSUMPTION"]} note="A rehearsal replays a stored race through the same path a live race uses, at the speed you choose. It is a simulation of a race that has already happened: the header reads “Rehearsal · simulated”, never Live. Everyone looking at the site sees the rehearsal while it runs, and it stops by itself at the chequered flag.">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="flex flex-col gap-1.5 text-dim">Race<select value={sk} onChange={(e) => setSk(e.target.value ? Number(e.target.value) : "")}>{r.sessions.map((s) => <option key={s.session_key} value={s.session_key}>{s.year} · {s.location}</option>)}</select></label>
            <label className="flex flex-col gap-1.5 text-dim">Speed<select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[5, 10, 20, 30].map((x) => <option key={x} value={x}>{x}× (a lap every ~{Math.round(90 / x)} s)</option>)}</select></label>
            <label className="flex flex-col gap-1.5 text-dim">Start at lap<input type="number" className="w-20" min={1} max={70} value={startLap} onChange={(e) => setStartLap(Number(e.target.value) || 1)} /></label>
            {live.rehearsal_needs_code && <label className="flex flex-col gap-1.5 text-dim">Admin code<input type="password" className="w-36 rounded-[10px] border border-line bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] text-ink outline-none" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>}
            <button className="btn primary" disabled={busy} onClick={() => call("POST")}>{busy ? "Starting…" : "Start rehearsal"}</button>
          </div>
          {msg && <div role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-xs text-[#ffb3ae]">{msg}</div>}
        </Panel>
      </div>
    );
  }

  const c = ready ? r.cmd : null;
  const me = c?.rows?.find((x: any) => x.driver_number === r.driver);
  const top = pred.data?.available ? pred.data.top5 : [];
  const recs = [...(wxa.data?.recommendations || []), ...(adv.data?.recommendations || [])];
  const mode = live.mode.mode;
  const colour = mode === "LIVE" ? "#2fbf71" : mode === "REHEARSAL" ? "#c9a7ff" : "#e0a100";
  return (
    <div className="space-y-5">
      <section className="glass overflow-hidden rounded-3xl" style={{ borderColor: `${colour}55` }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: colour }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: colour, boxShadow: `0 0 10px ${colour}` }} />{mode === "REHEARSAL" ? "Rehearsal — simulated, not a live race" : mode === "LIVE" ? "Live" : "Delayed"}</div>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{c?.title ?? "…"}</h1>
            <div className="mt-1 max-w-3xl text-[12px] text-dim">{live.mode.reason}</div>
          </div>
          <div className="ml-auto flex items-center gap-5">
            <div className="text-right"><div className="num text-[34px] font-semibold leading-none">{live.lap ?? "—"}<span className="text-[18px] text-faint"> / {live.total_laps ?? "—"}</span></div><div className="mt-1 text-[11px] text-dim">lap{c?.est_remaining_s ? ` · ~${Math.round(c.est_remaining_s / 60)} min left` : ""}</div></div>
            {rehearsing && <div className="flex flex-col items-end gap-1.5">
              {live.rehearsal_needs_code && <input type="password" placeholder="Admin code" className="w-32 rounded-[10px] border border-line bg-white/[0.06] px-2.5 py-1 text-[12px] text-ink outline-none" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Admin code" />}
              <button className="btn" disabled={busy} onClick={() => call("DELETE")}>Stop rehearsal</button></div>}
          </div>
        </div>
        {msg && <div role="alert" className="border-t border-bad/30 bg-bad/10 px-6 py-2 text-xs text-[#ffb3ae]">{msg}</div>}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Track status" tag="OBSERVED" value={({ GREEN: "Green", SC: "Safety Car", SC_ENDING: "SC in this lap", VSC: "Virtual SC", RED: "Red flag", FINISHED: "Chequered" } as any)[c?.track_status] ?? "—"}
          accent={c?.track_status === "GREEN" ? "#2fbf71" : c?.track_status === "RED" ? "#ff5a52" : c?.track_status && c.track_status !== "FINISHED" ? "#e0a100" : undefined} sub={c ? `${c.neutralisations.SC} SC · ${c.neutralisations.VSC} VSC so far` : ""} />
        <Stat label="Rain at the track" tag="OBSERVED" value={c?.weather ? (c.weather.rainfall ? "Raining" : "Dry") : "—"} accent={c?.weather?.rainfall ? "#3d8bf2" : undefined} sub={c?.weather ? `Track ${num(c.weather.track_temperature)}° · air ${num(c.weather.air_temperature)}°` : ""} />
        <Stat label="Leader" tag="OBSERVED" value={c?.rows?.[0]?.code ?? "—"} sub={c?.rows?.[1] ? `${c.rows[1].code} ${c.rows[1].gap ?? ""}` : ""} />
        <Stat label={`Your driver${me ? ` · ${me.code}` : ""}`} tag="OBSERVED" value={me ? `P${me.position}` : "—"} sub={me ? `${me.gap === "LEADER" ? "leading" : me.gap ?? ""} · ${me.compound ? me.compound[0] + me.compound.slice(1).toLowerCase() : "?"} tyres, ${me.tyre_age ?? "?"} laps` : "Pick a focus driver in the header"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Timing" tags={["OBSERVED"]} pad={false} note="Click a row to make that driver your focus. Predicted finish comes from the in-race model.">
          <State loading={!c}>
            {c && <div className="max-h-[560px] overflow-auto"><table className="grid-t"><thead><tr><th>Pos</th><th>Driver</th><th className="r">Gap</th><th className="r">Last lap</th><th>Tyre · age</th><th className="r">Pits</th><th className="r">Predicted</th></tr></thead>
              <tbody>{c.rows.map((x: any) => <tr key={x.driver_number} className={x.driver_number === r.driver ? "!bg-white/[0.07]" : ""} onClick={() => r.setDriver(x.driver_number)} style={{ cursor: "pointer", opacity: x.status === "OUT" ? 0.45 : 1 }}>
                <td className="num w-10 font-semibold">{x.position}</td><td><Driver code={x.code} colour={x.team_colour} name={x.name} /></td><td className="r num">{x.gap === "LEADER" ? <span className="text-faint">Leader</span> : x.gap ?? "—"}</td>
                <td className="r num text-dim">{fmtLap(x.last_lap)}</td><td><Tyre compound={x.compound} age={x.tyre_age} /></td><td className="r num">{x.pit_stops}</td><td className="r num font-semibold">{x.pred_pos ? `P${x.pred_pos}` : <span className="font-normal text-faint">—</span>}</td></tr>)}</tbody></table></div>}
          </State>
        </Panel>

        <div className="space-y-5">
          <Panel title="Who wins from here" tags={["MODEL"]} right={pred.loading ? <span className="text-faint">updating</span> : pred.data?.available ? <span>lap {pred.data.lap}</span> : null}
            note="Average of the in-race model and 1,000 simulated finishes from the current positions, tyres and gaps. Full table on the Race Predictor page.">
            <State loading={!pred.data && !pred.error} error={pred.error} empty={pred.data && !pred.data.available ? pred.data.reason : null}>
              <div className="space-y-2.5">{top.map((d: any) => <div key={d.driver_number} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3 text-xs"><Driver code={d.code} colour={d.team_colour} name={d.name} /><Bar value={d.p_win} colour={teamColour(d.team_colour)} label={pct(d.p_win)} /></div>)}</div>
            </State>
          </Panel>

          <Panel title={`The call for ${me?.code ?? "your driver"}`} tags={["MODEL"]} right={<Link className="btn" href="/advisor">All recommendations</Link>}>
            <State loading={!adv.data && !adv.error && !wxa.data} error={adv.error} empty={(adv.data?.note || (adv.data && wxa.data && recs.length === 0)) ? (adv.data?.note || "No action needed at this lap.") : null}>
              <div className="space-y-3">{recs.slice(0, 3).map((x: any, i: number) => (
                <div key={i} className="rounded-2xl border border-line bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-faint">{x.type}<span className="ml-auto"><Confidence c={x.confidence} /></span></div>
                  <div className="mt-1.5 text-[14px] font-semibold leading-snug">{x.decision}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-dim">{x.title}. {x.advantage}.</div>
                </div>))}</div>
            </State>
          </Panel>

          <Panel title="Race control" tags={["OBSERVED"]} pad={false}>
            <State empty={c && !(c.events || []).length ? "No messages yet." : null}>
              <ul className="max-h-[230px] divide-y divide-white/[0.05] overflow-auto text-[11.5px]">{(c?.events || []).map((e: any, i: number) => <li key={i} className="flex gap-3 px-5 py-2"><span className="num shrink-0 text-faint">{e.lap ? `L${e.lap}` : hm(e.t)}</span><span className="text-dim">{e.message}</span></li>)}</ul>
            </State>
          </Panel>
        </div>
      </div>
      <Notes title="About this page" items={["Timing, tyres, weather and race-control messages are recorded data. Win chances and strategy calls are model output and are recalculated each lap.",
        mode === "REHEARSAL" ? "This is a rehearsal: a stored race replayed at speed. Nothing after the simulated moment is used, so it behaves as the live page would have during that race." : "During a real race the page updates as each new lap arrives.",
        "On a small server the win chances and the strategy call can take 10–20 seconds to catch up after a new lap; during a fast rehearsal they may skip laps."]} />
    </div>
  );
}
