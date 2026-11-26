"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api, useApi, useRace } from "@/lib/api";
import { ChartTip, GRID, Notes, Panel, SERIES, State, Tag, ago, dt, num, pct, Tabs } from "@/components/ui";

const NAMES: Record<string, string> = { pre_race: "Pre-race (after qualifying)", pre_quali: "Pre-race (before qualifying)", in_race: "In-race (lap by lap)" };
const pretty = (k: string) => k.replace(/_/g, " ");

export default function Data() {
  const r = useRace();
  const [tab, setTab] = useState("models");
  const src = useApi<any>("/api/health/sources", r.tick);
  const mod = useApi<any>("/api/models", r.tick);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string[] | null>(null);
  const retrain = () => { setBusy(true); api("/api/admin/retrain", {}).then((x) => { setMsg(x.actions); src.reload(); mod.reload(); }).catch((e) => setMsg([String(e.message)])).finally(() => setBusy(false)); };
  const active = (mod.data?.models || []).filter((m: any) => m.active);
  return (
    <div className="space-y-5">
      <Tabs tabs={[["models", "Model performance"], ["sources", "Data sources"]] as [string, string][]} value={tab} onChange={setTab} />
      {tab === "sources" && (<div className="page-in space-y-5">
      <Panel title="Data sources" tags={["OBSERVED"]} pad={false} right={src.data && <span>database: {src.data.database}, cache: {src.data.cache_backend}</span>}>
        <State loading={src.loading} error={src.error}>
          <div className="overflow-auto"><table className="grid-t"><thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Freshness</th><th className="r">Requests</th><th className="r">Failures</th><th>Stored</th><th>Historical coverage</th><th>Access limitations</th></tr></thead>
            <tbody>{(src.data?.sources || []).map((s: any) => (
              <tr key={s.source}><td className="font-semibold"><a className="hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></td>
                <td><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.status === "ok" ? "#2fbf71" : s.status === "error" ? "#ff5a52" : "#6b717d" }} />{s.status === "ok" ? "Connected" : s.status === "error" ? "Error" : "Not used yet"}</span></td>
                <td className="num">{dt(s.last_success)}</td><td className="num">{ago(s.last_success)}</td><td className="r num">{s.requests}</td><td className="r num" style={s.failures ? { color: "#ff5a52" } : undefined}>{s.failures}</td>
                <td className="num text-dim">{s.stored ? `${s.stored.races} races, ${s.stored.first}–${s.stored.last}` : "—"}</td><td className="max-w-[280px] whitespace-normal text-[12.5px] text-dim">{s.coverage}</td><td className="max-w-[340px] whitespace-normal text-[12.5px] text-dim">{s.limits}{s.last_error && <div className="mt-0.5 text-bad">Last error {ago(s.last_error_at)}: {s.last_error}</div>}</td></tr>))}</tbody></table></div>
        </State>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Notes title="Missing data" items={src.data?.missing} />
        <Panel title="Error log" pad={false}><State empty={src.data && !src.data.errors.length ? "No provider errors recorded." : null}>
          <div className="max-h-[180px] overflow-auto"><table className="grid-t"><thead><tr><th>When</th><th>Source</th><th>Error</th></tr></thead><tbody>{(src.data?.errors || []).map((e: any, i: number) => <tr key={i}><td className="num">{dt(e.ts)}</td><td>{e.source}</td><td className="whitespace-normal text-[12.5px] text-dim">{e.error}<div className="text-faint">{e.url}</div></td></tr>)}</tbody></table></div></State></Panel>
      </div>
      </div>)}
      {tab === "models" && (<div className="page-in space-y-5">
      <Panel title="Model performance — walk-forward backtests" tags={["MODEL"]} right={<><button className="btn" onClick={retrain} disabled={busy} aria-busy={busy}>{busy ? "Refreshing data & retraining… (several minutes)" : "Refresh data & retrain if new races"}</button></>} note={<>{mod.data?.validation} {mod.data?.retraining}</>}>
        {msg && <div className="mb-3 rounded-xl border border-line bg-panel2 px-3 py-2 text-[13px] text-dim">{msg.map((m, i) => <div key={i}>• {m}</div>)}</div>}
        <State loading={mod.loading} error={mod.error} empty={mod.data && !active.length ? "No trained models registered yet. Run `python -m app.prerace train` and `python -m app.inrace train`." : null}>
          <div className="space-y-5">{active.map((m: any) => <Model key={m.name} m={m} />)}</div>
        </State>
      </Panel>

      <Panel title="Model versions" pad={false}>
        <table className="grid-t"><thead><tr><th>Model</th><th>Version</th><th>Trained</th><th>Data through</th><th className="r">Training rows</th><th className="r">Winner log loss</th><th>Status</th></tr></thead>
          <tbody>{(mod.data?.models || []).map((m: any) => { const w = m.metrics?.winner || {}; const ll = (w.ensemble_final || w.model || {}).log_loss; return <tr key={m.name + m.version}><td>{NAMES[m.name] || m.name}</td><td className="num">{m.version}</td><td className="num">{dt(m.created)}</td><td>{m.train_through}</td><td className="r num">{m.n_rows?.toLocaleString()}</td><td className="r num">{ll ?? "—"}</td><td>{m.active ? <span className="text-good">active</span> : <span className="text-faint">superseded</span>}</td></tr>; })}</tbody></table>
      </Panel>
      </div>)}
      <Notes title="How to read provenance labels" items={["OBSERVED — recorded by a provider (timing, tyres, track weather, results).", "HISTORICAL — estimated from earlier races (e.g. pit loss from last year's race here).",
        "MODEL — output of a fitted or trained model (probabilities, tyre wear rates, simulations).", "ASSUMPTION — a scenario input or modelling constant that is not measured (e.g. wetness curves, Safety Car pit-loss factor).",
        "FORECAST — numerical weather model for the circuit area; never treated as a track measurement."]} />
    </div>
  );
}

function Model({ m }: { m: any }) {
  const x = m.metrics || {};
  const win = x.winner || {};
  const rows = Object.entries(win) as [string, any][];
  const bands = (x.calibration_bands || []).filter((b: any) => b.n > 0 && b.predicted !== null);
  const pretrace = m.name !== "in_race";
  return (
    <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-3"><h3 className="text-sm font-semibold">{NAMES[m.name] || m.name}</h3><span className="num text-[12.5px] text-faint">v{m.version}, data through {m.train_through}, {m.n_rows?.toLocaleString()} rows, tested on {x.evaluated_seasons || (x.test_seasons || []).join(", ")}{x.n_races ? ` (${x.n_races} races)` : ""}</span></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <div className="space-y-3">
          <table className="grid-t"><thead><tr><th>Winner prediction</th><th className="r">Accuracy</th><th className="r">Log loss</th><th className="r">Brier</th><th className="r">Calibration error</th></tr></thead>
            <tbody>{rows.map(([k, v]) => <tr key={k} className={k === "ensemble_final" || k === "model" ? "!bg-white/[0.07] font-semibold" : ""}><td className="capitalize">{pretty(k)}{k.startsWith("baseline") && <span className="ml-2 text-[12px] font-normal text-faint">baseline</span>}</td><td className="r num">{pct(v.accuracy)}</td><td className="r num">{v.log_loss}</td><td className="r num">{v.brier}</td><td className="r num">{v.ece}</td></tr>)}</tbody></table>
          {pretrace && x.podium && <table className="grid-t"><thead><tr><th>Podium prediction</th><th className="r">Top-3 hit rate</th><th className="r">Log loss</th><th className="r">Brier</th><th className="r">Calibration error</th></tr></thead>
            <tbody>{(Object.entries(x.podium) as [string, any][]).map(([k, v]) => <tr key={k} className={k === "ensemble_final" ? "!bg-white/[0.07] font-semibold" : ""}><td className="capitalize">{pretty(k)}</td><td className="r num">{pct(v.top3_hit_rate)}</td><td className="r num">{v.log_loss ?? "—"}</td><td className="r num">{v.brier ?? "—"}</td><td className="r num">{v.ece ?? "—"}</td></tr>)}</tbody></table>}
          {pretrace && x.finishing_position && <div className="num text-[13px] text-dim">Finishing position: mean absolute error <b className="text-ink">{x.finishing_position.mae_model}</b> places (grid-order baseline {x.finishing_position.mae_baseline_grid}); rank correlation {x.finishing_position.spearman}. Fastest lap: accuracy {pct(x.fastest_lap?.accuracy)}, log loss {x.fastest_lap?.log_loss}. Top-5: log loss {x.top5?.log_loss}, Brier {x.top5?.brier}.</div>}
          {!pretrace && x.podium && <div className="num text-[13px] text-dim">Podium: log loss <b className="text-ink">{x.podium.log_loss}</b>, Brier {x.podium.brier}, calibration error {x.podium.ece}. Accuracy counts race-laps, so one race contributes many correlated rows.</div>}
          {x.by_phase && <table className="grid-t"><thead><tr><th>Race phase</th><th className="r">Winner accuracy</th><th className="r">Baseline</th><th className="r">Log loss</th><th className="r">Position error (places)</th><th className="r">Baseline: hold position</th></tr></thead>
            <tbody>{x.by_phase.map((p: any) => <tr key={p.phase}><td>{p.phase} of distance</td><td className="r num">{pct(p.winner_accuracy)}</td><td className="r num text-dim">{pct(p.baseline_leader_accuracy)}</td><td className="r num">{p.log_loss}</td><td className="r num">{p.position_mae}</td><td className="r num text-dim">{p.position_mae_baseline_current}</td></tr>)}</tbody></table>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {x.by_season && <div><div className="mb-1 text-[12px] text-faint">Winner accuracy by season</div>
            <ResponsiveContainer width="100%" height={200}><LineChart data={x.by_season} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="season" tickLine={false} axisLine={{ stroke: GRID }} /><YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} width={52} />
              <Tooltip content={<ChartTip fmt={(v: number) => pct(v)} />} /><Legend iconType="plainline" /><Line dataKey="winner_accuracy" name="Model" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /><Line dataKey="baseline_grid_accuracy" name="Pole-sitter baseline" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}
          {bands.length > 0 && <div><div className="mb-1 text-[12px] text-faint">Calibration — predicted vs observed win rate</div>
            <ResponsiveContainer width="100%" height={200}><ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} /><XAxis type="number" dataKey="predicted" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={{ stroke: GRID }} name="Predicted" />
              <YAxis type="number" dataKey="observed" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} width={52} name="Observed" /><ZAxis range={[60, 60]} /><ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#3a3f48" strokeDasharray="4 4" />
              <Tooltip content={({ active, payload }: any) => active && payload?.length ? <div className="num glass-strong rounded-xl px-3 py-2 text-[12.5px]">predicted {pct(payload[0].payload.predicted)} → observed {pct(payload[0].payload.observed)}<div className="text-faint">95% band {pct(payload[0].payload.ci_lo, 0)}–{pct(payload[0].payload.ci_hi, 0)}, n={payload[0].payload.n}</div></div> : null} />
              <Scatter data={bands} fill={SERIES[0]} stroke="#0b0c10" strokeWidth={2} isAnimationActive={false} /></ScatterChart></ResponsiveContainer></div>}
        </div>
      </div>
      {x.isotonic_calibration_applied && <div className="mt-2 text-[12.5px] text-faint">Isotonic calibration kept only where it lowered out-of-sample log loss: {Object.entries(x.isotonic_calibration_applied).map(([k, v]) => `${k} ${v ? "yes" : "no"}`).join(", ")}. Pit-stop strategy prediction error is not reported: there is no ground-truth “optimal” strategy to score against.</div>}
    </div>
  );
}
