"use client";
import { useEffect, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useApi } from "@/lib/api";
import { resolveDeferred } from "@/lib/browserSim";
import { Bar, ChartTip, Driver, GRID, Notes, Panel, Stat, State, Tabs, Tag, Tyre, dt, num, pct, signed, teamColour } from "@/components/ui";
import { PositionDist } from "@/components/Options";

const hm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
const tagOf = (s: string) => (s.split(" · ")[0] || "").trim();

function Countdown({ start }: { start: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 30000); return () => clearInterval(t); }, []);
  const s = Math.max(0, start - now), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (s <= 0) return <span>Race time</span>;
  return <span className="num">{d > 0 && <>{d}<span className="text-[18px] text-faint">d </span></>}{h}<span className="text-[18px] text-faint">h </span>{m}<span className="text-[18px] text-faint">m</span></span>;
}

export default function NextRace() {
  const { data: d, loading, error } = useApi<any>("/api/next");
  const [tab, setTab] = useState("prediction");
  const [driver, setDriver] = useState<string>("");
  const [grid, setGrid] = useState<number | undefined>();
  const [sc, setSc] = useState(false); const [scLap, setScLap] = useState(20); const [scType, setScType] = useState("SC");
  const [rain, setRain] = useState(false); const [rainIn, setRainIn] = useState(20); const [rainInt, setRainInt] = useState(0.5); const [rainDur, setRainDur] = useState(20);
  const [temp, setTemp] = useState(0); const [incidents, setIncidents] = useState(true);
  const [res, setRes] = useState<any | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (d?.available && !driver) setDriver(d.prediction.drivers[0].driver_id); }, [d, driver]);
  if (!d) return <State loading={loading || !error} error={error} />;
  if (!d.available) return <State empty={d.reason} />;
  const race = d.race, c = d.circuit, p = d.prediction, fc = d.forecast, hz = d.base_rates;
  const run = () => {
    setBusy(true); setErr(null);
    const q = { driver_id: driver, grid_position: grid, random_incidents: incidents, track_temp_delta: temp || undefined,
      ...(sc ? { safety_car: { lap: scLap, type: scType } } : {}), ...(rain ? { rain_in_min: rainIn, rain_intensity: rainInt, rain_duration_min: rainDur } : {}) };
    api<any>("/api/next/simulate", { ...q, defer: true }).then((x) => resolveDeferred<any>(x, () => api("/api/next/simulate", q)))
      .then(setRes).catch((e) => setErr(String(e.message))).finally(() => setBusy(false));
  };
  const top = p.top5.map((x: any) => ({ code: `${x.code}  ${(x.p_win * 100).toFixed(1)}%`, p: x.p_win * 100, colour: teamColour(x.colour), err: x.ci ? [Math.max(0, x.p_win - x.ci.lo) * 100, Math.max(0, x.ci.hi - x.p_win) * 100] : [0, 0] }));
  const fsum = fc?.rows?.length ? { maxProb: Math.max(...fc.rows.map((r: any) => r.precip_prob ?? 0)), mm: fc.rows.reduce((a: number, r: any) => a + (r.precip_mm_15 || 0), 0), temp: fc.rows[Math.floor(fc.rows.length / 2)]?.temp } : null;
  return (
    <div className="space-y-5">
      <section className="glass overflow-hidden rounded-3xl">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[.18em] text-faint">Next race · {race.year} round {race.round}</div>
            <h1 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-tight">{race.gp_name}</h1>
            <div className="mt-1 text-[13px] text-dim">{c.full_name} · {c.place_name} · {c.laps} laps · {num(c.course_length, 3)} km · {String(c.circuit_type).toLowerCase()} circuit</div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="rounded-full border border-line bg-white/[0.05] px-3 py-1.5 text-dim">Lights out <b className="text-ink">{dt(d.start)}</b></span>
              <span className="rounded-full border border-line bg-white/[0.05] px-3 py-1.5 text-dim">{d.grid_known ? <>Grid: <b className="text-ink">set</b> — post-qualifying model</> : <>Qualifying <b className="text-ink">{c.qualifying_date ?? "—"}</b> — predictions update once the grid is known</>}</span>
              {c.sprint_race_date && <span className="rounded-full border border-line bg-white/[0.05] px-3 py-1.5 text-dim">Sprint weekend</span>}
            </div>
          </div>
          <div className="lg:text-right">
            <div className="text-[10.5px] font-medium uppercase tracking-[.14em] text-faint">Starts in</div>
            <div className="mt-1 text-[38px] font-semibold leading-none tracking-tight"><Countdown start={d.start} /></div>
            <div className="mt-3 text-[12px] text-dim">Model favourite: <b className="text-ink">{p.top5[0].name}</b> at {pct(p.top5[0].p_win)} · {p.top5[1].code} {pct(p.top5[1].p_win)} · {p.top5[2].code} {pct(p.top5[2].p_win)}</div>
          </div>
        </div>
      </section>

      <Tabs tabs={[["prediction", "Prediction"], ["strategy", "Strategy lab"], ["weather", "Weather & circuit"]]} value={tab} onChange={setTab} />

      {tab === "prediction" && (<div className="page-in space-y-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Panel title="Most likely winners" tags={["MODEL"]} note={<>Whiskers: 95% interval of how often drivers given a probability in this band actually won in season-by-season backtests. {p.method["win/podium"]}.</>}>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={top} layout="vertical" margin={{ top: 4, right: 30, bottom: 0, left: 0 }} barCategoryGap={8}>
                <CartesianGrid stroke={GRID} horizontal={false} /><XAxis type="number" domain={[0, (m: number) => Math.min(100, Math.ceil((m + 5) / 10) * 10)]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="code" width={92} tickLine={false} axisLine={false} tick={{ fill: "#f2f3f5", fontSize: 12, fontWeight: 600 }} />
                <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTip fmt={(v: number) => `${v.toFixed(1)}%`} />} />
                <RBar dataKey="p" name="Win probability" radius={[0, 4, 4, 0]} isAnimationActive={false}>{top.map((x: any, i: number) => <Cell key={i} fill={x.colour} />)}<ErrorBar dataKey="err" width={5} stroke="#f2f3f5" strokeWidth={1.2} direction="x" /></RBar>
              </BarChart></ResponsiveContainer>
          </Panel>
          <Panel title="Constructors" tags={["MODEL"]} pad={false}>
            <table className="grid-t"><thead><tr><th>Constructor</th><th style={{ width: 200 }}>Win (either car)</th><th className="r">At least one podium</th><th className="r">Expected points</th></tr></thead>
              <tbody>{p.constructors.slice(0, 6).map((x: any) => <tr key={x.constructor}><td><span className="mr-2 inline-block h-3 w-[3px] rounded-full align-middle" style={{ background: teamColour(x.colour) }} />{x.constructor}</td>
                <td><Bar value={x.p_win} colour={teamColour(x.colour)} label={pct(x.p_win)} /></td><td className="r num">{pct(x.p_podium_any)}</td><td className="r num">{num(x.exp_points)}</td></tr>)}</tbody></table>
          </Panel>
        </div>
        <Panel title="Every driver" tags={["MODEL"]} pad={false} note={<>Model: {p.variant === "pre_race" ? "post-qualifying (uses the grid)" : "pre-qualifying (no grid yet)"}, trained through {p.train_through}. Expected points come from 5,000 sampled finishing orders. {p.notes.join(" ")} Full detail and the factors behind each number are on the Race Predictor page.</>}>
          <div className="overflow-auto"><table className="grid-t"><thead><tr><th>Driver</th><th>Team</th><th className="r">Grid</th><th style={{ width: 180 }}>Win</th><th className="r">Podium</th><th className="r">Top 5</th><th className="r">Predicted finish</th><th className="r">Expected points</th><th className="r">Points now</th></tr></thead>
            <tbody>{p.drivers.map((x: any) => <tr key={x.driver_id}><td><Driver code={x.code} colour={x.colour} name={x.name} /><span className="ml-2.5 text-dim">{x.name}</span></td><td className="text-dim">{x.constructor}</td><td className="r num">{x.grid ?? "—"}</td>
              <td><Bar value={x.p_win} colour={teamColour(x.colour)} label={pct(x.p_win)} /></td><td className="r num">{pct(x.p_podium)}</td><td className="r num">{pct(x.p_top5)}</td><td className="r num font-semibold">P{x.pred_pos}</td><td className="r num">{num(x.exp_points)}</td><td className="r num text-dim">{num(x.points_before, 0)}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>)}

      {tab === "strategy" && (<div className="page-in space-y-5">
        <Panel title="Pre-race strategy lab" tags={["HISTORICAL", "ASSUMPTION"]} note="No car has turned a race lap yet, so every input is an estimate from earlier races or something you set here. Use it to compare plans under stated conditions, not as a forecast of the result. Each result lists exactly what it assumed.">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2.5 rounded-2xl border border-line bg-white/[0.03] p-4 text-xs">
              <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-faint">Driver</div>
              <select className="w-full" value={driver} onChange={(e) => setDriver(e.target.value)} aria-label="Driver">{p.drivers.map((x: any) => <option key={x.driver_id} value={x.driver_id}>{x.code} · {x.name}</option>)}</select>
              <label className="flex items-center justify-between gap-2 text-dim">Start from grid slot<input type="number" className="w-20" min={1} max={22} placeholder="auto" value={grid ?? ""} onChange={(e) => setGrid(e.target.value ? Number(e.target.value) : undefined)} /></label>
              <label className="flex items-center justify-between gap-2 text-dim">Track temperature Δ°C<input type="number" className="w-20" min={-15} max={20} value={temp} onChange={(e) => setTemp(Number(e.target.value))} /></label>
            </div>
            <div className="space-y-2.5 rounded-2xl border border-line bg-white/[0.03] p-4 text-xs">
              <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-faint"><input type="checkbox" checked={sc} onChange={(e) => setSc(e.target.checked)} />Safety Car</label>
              <div className={`flex flex-wrap items-center gap-2 text-dim ${sc ? "" : "opacity-40"}`}>on lap<input type="number" className="w-16" min={1} max={c.laps} value={scLap} disabled={!sc} onChange={(e) => setScLap(Number(e.target.value))} />
                <select value={scType} disabled={!sc} onChange={(e) => setScType(e.target.value)}><option value="SC">Safety Car</option><option value="VSC">Virtual SC</option></select></div>
              <label className="flex items-center gap-2 text-dim"><input type="checkbox" checked={incidents} disabled={sc} onChange={(e) => setIncidents(e.target.checked)} />Random incidents at historical rates</label>
              <div className="text-[11px] text-faint">Here: SC {(hz.sc_per_lap * 100).toFixed(1)}% per lap, VSC {(hz.vsc_per_lap * 100).toFixed(1)}% per lap.</div>
            </div>
            <div className="space-y-2.5 rounded-2xl border border-line bg-white/[0.03] p-4 text-xs">
              <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-faint"><input type="checkbox" checked={rain} onChange={(e) => setRain(e.target.checked)} />Rain during the race</label>
              <div className={`grid grid-cols-3 gap-2 text-faint ${rain ? "" : "opacity-40"}`}>
                <label className="flex flex-col gap-1">Starts (min)<input type="number" min={0} value={rainIn} disabled={!rain} onChange={(e) => setRainIn(Number(e.target.value))} /></label>
                <label className="flex flex-col gap-1">Intensity 0–1<input type="number" min={0} max={1} step={0.05} value={rainInt} disabled={!rain} onChange={(e) => setRainInt(Number(e.target.value))} /></label>
                <label className="flex flex-col gap-1">For (min)<input type="number" min={1} value={rainDur} disabled={!rain} onChange={(e) => setRainDur(Number(e.target.value))} /></label>
              </div>
              <div className="text-[11px] text-faint">Unticked: the forecast decides{fsum ? ` (currently ${fsum.maxProb}% max probability)` : ""}.</div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3"><button className="btn primary" onClick={run} disabled={busy || !driver} aria-busy={busy}>{busy ? "Simulating…" : "Compare strategies"}</button>
            <span className="text-[11.5px] text-dim">Tests each starting tyre with one and two stops across 1,000 simulated races.</span></div>
          {err && <div className="mt-3"><State error={err} /></div>}
        </Panel>

        {busy && !res && <Panel title="Simulating"><State loading /></Panel>}
        {res && (<>
          <Panel title={`Plans for ${res.focus.code} from P${res.focus.grid}`} tags={["MODEL"]} pad={false} note={<>{res.n_sims} simulated races per plan{res.engine === "browser" ? ", run in your browser," : ""} with identical random futures; rivals run their own best plan (all starting on {String(res.field_start_compound).toLowerCase()}s). “Model Δ” is the tyre-and-pit arithmetic alone; “Sim Δ” adds traffic, incidents and weather. Expected finish averages over every simulation, including retirements.</>}>
            <div className="overflow-auto"><table className="grid-t"><thead><tr><th>Plan</th><th>Start</th><th>Stops</th><th className="r">Expected finish</th><th className="r">Range</th><th className="r">Win</th><th className="r">Podium</th><th className="r">Model Δ</th><th className="r">Sim Δ</th><th className="r">Laps in traffic</th></tr></thead>
              <tbody>{res.options.map((o: any) => <tr key={o.label} className={o.label === res.best ? "!bg-good/10" : ""}>
                <td className="font-semibold">{o.stops}-stop{o.label === res.best && <span className="ml-2 rounded-full bg-good px-2 py-[1px] text-[9px] font-bold text-black">BEST</span>}</td><td><Tyre compound={o.start} /></td>
                <td>{o.plan.map((x: any, i: number) => <span key={i} className="mr-2 inline-flex items-center gap-1"><span className="num">L{x.lap}</span><Tyre compound={x.compound} /></span>)}</td>
                <td className="r num font-semibold">P{num(o.exp_pos)}</td><td className="r num text-dim">P{o.pos_p10}–P{o.pos_p90}</td><td className="r num">{pct(o.p_win)}</td><td className="r num">{pct(o.p_podium)}</td>
                <td className="r num text-dim">{signed(o.model_delta)} s</td><td className="r num">{o.time_vs_best === null ? "—" : `${signed(o.time_vs_best)} s`}</td><td className="r num text-dim">{num(o.blocked_laps)}</td></tr>)}</tbody></table></div>
          </Panel>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Panel title="Where each plan finishes" tags={["MODEL"]} note="Share of simulated races ending in each position, for the four best plans."><PositionDist options={[...res.options].sort((a: any, b: any) => a.exp_pos - b.exp_pos).slice(0, 4)} /></Panel>
            <Panel title={`Simulated order with ${res.focus.code} on the best plan`} tags={["MODEL"]} pad={false}>
              <div className="max-h-[300px] overflow-auto"><table className="grid-t"><thead><tr><th>Driver</th><th className="r">Grid</th><th className="r">Expected finish</th><th className="r">Win</th><th className="r">Podium</th></tr></thead>
                <tbody>{res.field.map((x: any) => <tr key={x.code}><td><Driver code={x.code} colour={x.team_colour} /></td><td className="r num text-dim">P{x.grid}</td><td className="r num">P{num(x.exp_pos)}</td><td className="r num">{pct(x.p_win)}</td><td className="r num">{pct(x.p_podium)}</td></tr>)}</tbody></table></div>
            </Panel>
          </div>
          <div className="glass rounded-2xl px-5 py-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-faint">What this run assumed</div>
            <ul className="space-y-1.5 text-[11.5px] text-dim">{res.notes.map((n: string, i: number) => <li key={i} className="flex gap-2"><span className="shrink-0"><Tag kind={tagOf(n)} /></span><span>{n.split(" · ").slice(1).join(" · ")}</span></li>)}</ul>
            <div className="mt-2 text-[11.5px] text-dim">{res.caveat}</div>
          </div>
        </>)}
      </div>)}

      {tab === "weather" && (<div className="page-in space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Rain probability" tag="FORECAST" value={fsum ? `${fsum.maxProb}%` : "—"} sub={fc?.available ? `Max over the race window · ${num(fsum?.mm, 1)} mm` : "Forecast unavailable"} />
          <Stat label="Air temperature" tag="FORECAST" value={fsum?.temp !== undefined && fsum?.temp !== null ? `${num(fsum.temp)}°C` : "—"} sub="Around mid-race" />
          <Stat label="Races with a Safety Car" tag="HISTORICAL" value={hz.share_races_with_sc !== undefined ? pct(hz.share_races_with_sc, 0) : "—"} sub={`All stored races · VSC ${hz.share_races_with_vsc !== undefined ? pct(hz.share_races_with_vsc, 0) : "—"}`} />
          <Stat label="Pit stop cost here" tag="HISTORICAL" value={`${d.tyre_prior.pit_loss} s`} sub={d.tyre_prior.source} />
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Forecast for the race window" tags={["FORECAST"]} pad={false} note={fc?.available ? fc.caveat : fc?.reason}>
            <State empty={!fc?.available ? fc?.reason || "No forecast." : null}>
              <div className="max-h-[320px] overflow-auto"><table className="grid-t"><thead><tr><th>UTC</th><th className="r">Rain (mm / 15 min)</th><th className="r">Probability</th><th className="r">Temp</th><th className="r">Wind</th><th className="r">Gusts</th></tr></thead>
                <tbody>{(fc?.rows || []).filter((_: any, i: number) => i % 2 === 0).map((x: any) => <tr key={x.t}><td className="num">{hm(x.t)}</td><td className="r num" style={x.precip_mm_15 > 0 ? { color: "#3d8bf2" } : undefined}>{num(x.precip_mm_15, 2)}</td><td className="r num">{x.precip_prob ?? "—"}%</td><td className="r num">{num(x.temp)}°</td><td className="r num">{num(x.wind)} m/s</td><td className="r num">{num(x.gusts)}</td></tr>)}</tbody></table></div>
            </State>
          </Panel>
          <Panel title="How this race was won before" tags={["OBSERVED"]} pad={false} note="Winning strategy reads as compound initial and stint length in laps. Lap-level history exists from 2023.">
            <State empty={!d.history.recent_strategies.length ? "No earlier race at this circuit with lap-level data." : null}>
              <table className="grid-t"><thead><tr><th>Year</th><th>Winner</th><th>Winning strategy</th><th className="r">Field avg stops</th><th className="r">SC</th><th className="r">VSC</th><th className="r">Track °C</th></tr></thead>
                <tbody>{d.history.recent_strategies.map((x: any) => <tr key={x.year}><td className="num">{x.year}</td><td className="font-semibold">{x.winner ?? "—"}</td><td className="num text-dim">{x.strategy ?? "—"}</td><td className="r num">{num(x.avg_stops)}</td><td className="r num">{x.sc}</td><td className="r num">{x.vsc}</td><td className="r num">{num(x.track_temp)}</td></tr>)}</tbody></table>
            </State>
            <div className="border-t border-line"><table className="grid-t"><thead><tr><th>Year</th><th>Winner</th><th>Constructor</th><th className="r">From grid</th><th className="r">Stops</th><th className="r">Retirements</th></tr></thead>
              <tbody>{d.history.races.map((x: any) => <tr key={x.year}><td className="num">{x.year}</td><td>{x.winner}</td><td className="text-dim">{x.constructor}</td><td className="r num">{x.winner_grid ?? "—"}</td><td className="r num">{x.winner_stops ?? "—"}</td><td className="r num">{x.dnfs}</td></tr>)}</tbody></table></div>
          </Panel>
        </div>
        <Panel title="Tyre behaviour expected here" tags={["HISTORICAL"]} pad={false} note={`Fitted from ${d.tyre_prior.source}. This is what the strategy lab uses until race laps exist.`}>
          <table className="grid-t"><thead><tr><th>Compound</th><th className="r">Wear per lap</th><th className="r">Pace vs medium</th></tr></thead>
            <tbody>{["SOFT", "MEDIUM", "HARD"].map((k) => <tr key={k}><td><Tyre compound={k} /><span className="ml-2">{k[0] + k.slice(1).toLowerCase()}</span></td><td className="r num">{signed(d.tyre_prior.compounds[k].deg, 3)} s</td><td className="r num">{signed(d.tyre_prior.compounds[k].offset, 2)} s</td></tr>)}</tbody></table>
        </Panel>
      </div>)}
    </div>
  );
}
