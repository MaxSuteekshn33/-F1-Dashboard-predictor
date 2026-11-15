"use client";
import { useMemo, useState } from "react";
import { useApi, useRace } from "@/lib/api";
import { Driver, Notes, Panel, Stat, State, Tag, Tyre, fmtDur, fmtLap, num, pct, dt } from "@/components/ui";

const compass = (d?: number | null) => (d === null || d === undefined ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8]);

function exportCsv(c: any, rows: any[]) {
  const cols = ["position", "code", "name", "team", "laps_done", "last_lap", "best_lap", "gap", "interval_s", "compound", "tyre_age", "stint", "pit_stops", "gained", "pred_pos"];
  const esc = (v: any) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `timing-${c.session.year}-${c.session.location}-lap${c.lap}.csv`.replace(/\s+/g, "-");
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CommandCentre() {
  const r = useRace();
  const c = r.cmd;
  const [team, setTeam] = useState("");
  const [text, setText] = useState("");
  const [cont, setCont] = useState(false);
  const [full, setFull] = useState(false);
  const { data: wx } = useApi<any>(r.sessionKey ? `/api/weather/summary?${r.q}` : null, r.tick);
  const teams = useMemo(() => Array.from(new Set((c?.rows || []).map((x: any) => x.team).filter(Boolean))).sort() as string[], [c]);
  const contenders: string[] = r.status?.contenders || [];
  const rows = (c?.rows || []).filter((x: any) => (!team || x.team === team) && (!cont || contenders.includes(x.code)) &&
    (!text || `${x.code} ${x.name}`.toLowerCase().includes(text.toLowerCase())));
  if (!c) return <State loading={r.cmdLoading || !r.cmdError} error={r.cmdError} />;
  const w = c.weather;
  const fs = wx?.forecast?.summary;
  const bestLap = Math.min(...c.rows.map((x: any) => x.best_lap ?? 1e9));
  const progress = c.total_laps ? Math.min(1, c.lap / c.total_laps) : 0;
  const leader = c.rows[0];
  const filtered = team || text || cont;
  return (
    <div className="space-y-5">
      {/* hero: what race, how far in, who leads */}
      <section className="glass overflow-hidden rounded-3xl">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[.18em] text-faint">{c.session.year} · Round {c.f1db?.round ?? "—"} · {c.session.session_name}</div>
            <h1 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-tight">{c.title}</h1>
            <div className="mt-1 text-[13px] text-dim">{c.circuit} · {c.session.location}, {c.session.country_name}</div>
            {leader && <div className="mt-4 inline-flex items-center gap-3 rounded-full border border-line bg-white/[0.05] py-1.5 pl-3 pr-4 text-[12.5px]">
              <span className="text-faint">{c.track_status === "FINISHED" ? "Winner" : "Leader"}</span><Driver code={leader.code} colour={leader.team_colour} name={leader.name} />
              <span className="text-dim">{leader.team}</span><Tyre compound={leader.compound} age={leader.tyre_age} /></div>}
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <div className="num text-[34px] font-semibold leading-none tracking-tight">{c.lap}<span className="text-[18px] text-faint"> / {c.total_laps ?? "—"}</span></div>
              <div className="text-right text-[11.5px] text-dim">{c.total_laps ? `${c.total_laps - c.lap} laps to go` : "distance unknown"}{c.est_remaining_s ? <> · ~{fmtDur(c.est_remaining_s)}</> : null}</div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Race distance completed">
              <div className="h-full rounded-full bg-gradient-to-r from-[#ff3b30] to-[#e10600] shadow-[0_0_12px_rgba(225,6,0,.7)] transition-[width] duration-500" style={{ width: `${progress * 100}%` }} /></div>
            <div className="num mt-4 grid grid-cols-3 gap-4 text-[12px]">
              <div><div className="text-[10px] font-medium uppercase tracking-[.1em] text-faint">Fastest lap</div><div className="mt-1 text-[15px] font-semibold text-[#c9a7ff]">{fmtLap(c.fastest_lap?.time)}</div><div className="text-dim">{c.fastest_lap ? `${c.fastest_lap.code} · lap ${c.fastest_lap.lap}` : "—"}</div></div>
              <div><div className="text-[10px] font-medium uppercase tracking-[.1em] text-faint">Neutralisations</div><div className="mt-1 text-[15px] font-semibold">{c.neutralisations.SC + c.neutralisations.VSC + c.neutralisations.RED}</div><div className="text-dim">{c.neutralisations.SC} SC · {c.neutralisations.VSC} VSC · {c.neutralisations.RED} red</div></div>
              <div><div className="text-[10px] font-medium uppercase tracking-[.1em] text-faint">Timing as of</div><div className="mt-1 text-[15px] font-semibold">{dt(c.as_of).slice(11, 16)} <span className="text-[11px] font-normal text-faint">UTC</span></div><div className="text-dim">{dt(c.as_of).slice(0, 10)} · {c.source}</div></div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Track / air" tag="OBSERVED" value={w ? <>{num(w.track_temperature)}°<span className="text-faint"> / </span>{num(w.air_temperature)}°</> : "—"} sub={w ? `Humidity ${num(w.humidity, 0)}%` : "No track weather"} />
        <Stat label="Rain at the track" tag="OBSERVED" value={w ? (w.rainfall ? "Raining" : "Dry") : "—"} accent={w?.rainfall ? "#3d8bf2" : undefined} sub={w ? `Sensor wet ${Math.round((w.rain_share_15min ?? 0) * 100)}% of last 15 min` : ""} />
        <Stat label="Rain probability" tag="FORECAST" value={fs?.max_prob !== null && fs?.max_prob !== undefined ? `${fs.max_prob}%` : "—"}
          sub={wx?.forecast?.available === false ? "Forecast unavailable" : wx ? `Open-Meteo, session window${wx.forecast?.kind === "analysis" ? " (hindsight)" : ""}` : "Loading…"} />
        <Stat label="Wind" tag="OBSERVED" value={w ? <>{num(w.wind_speed)}<span className="text-[13px] text-faint"> m/s</span></> : "—"} sub={w ? `From ${compass(w.wind_direction)} (${num(w.wind_direction, 0)}°)` : ""} />
      </div>

      <Panel title="Timing tower" tags={["OBSERVED"]} pad={false}
        right={<>
          <input type="text" placeholder="Find driver" value={text} onChange={(e) => setText(e.target.value)} className="w-28" aria-label="Filter by driver" />
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team"><option value="">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</select>
          <button className={`btn ${cont ? "!border-white/40 !bg-white/[0.14]" : ""}`} aria-pressed={cont} onClick={() => setCont(!cont)}>Title contenders</button>
          <button className={`btn ${full ? "!border-white/40 !bg-white/[0.14]" : ""}`} aria-pressed={full} onClick={() => setFull(!full)}>{full ? "All columns" : "Essentials"}</button>
          <button className="btn" onClick={() => exportCsv(c, rows)} title="Download the rows shown as CSV">Export</button>
        </>}
        note={<>{c.prediction_note} Gaps are measured at each car's last timing-line crossing. Positions gained are relative to the first position record of the session (grid). Click a row to make that driver the focus for the strategy, weather and recommendation pages. {r.wsState === "open" ? "New laps are pushed live over the WebSocket." : "WebSocket not connected — refreshing every 60 s."}</>}>
        <div className="max-h-[680px] overflow-auto">
          <table className="grid-t">
            <thead><tr>
              <th>Pos</th><th>Driver</th>{full && <th>Team</th>}{full && <th className="r">Lap</th>}<th className="r">Gap</th><th className="r">Interval</th><th className="r">Last lap</th>{full && <th className="r">Best</th>}
              <th>Tyre · age</th>{full && <th className="r">Stint</th>}<th className="r">Pits</th><th className="r">+/−</th><th className="r">Predicted finish</th>
            </tr></thead>
            <tbody>
              {rows.map((x: any) => (
                <tr key={x.driver_number} className={x.driver_number === r.driver ? "!bg-white/[0.07]" : ""} onClick={() => r.setDriver(x.driver_number)} style={{ cursor: "pointer", opacity: x.status === "OUT" ? 0.45 : 1 }}>
                  <td className="num w-12 font-semibold">{x.position}</td>
                  <td><Driver code={x.code} colour={x.team_colour} name={x.name} /><span className="ml-2.5 hidden text-dim md:inline">{x.name}</span></td>
                  {full && <td className="text-dim">{x.team}</td>}
                  {full && <td className="r num">{x.laps_done}</td>}
                  <td className="r num">{x.gap === "LEADER" ? <span className="text-faint">Leader</span> : x.gap ?? "—"}</td>
                  <td className="r num text-dim">{x.interval_s !== null && x.interval_s !== undefined && x.position > 1 ? `+${x.interval_s.toFixed(3)}` : "—"}</td>
                  <td className="r num" style={!full && x.best_lap === bestLap && x.last_lap === x.best_lap ? { color: "#c9a7ff" } : undefined}>{fmtLap(x.last_lap)}</td>
                  {full && <td className="r num" style={x.best_lap === bestLap ? { color: "#c9a7ff" } : undefined}>{fmtLap(x.best_lap)}</td>}
                  <td><Tyre compound={x.compound} age={x.tyre_age} /></td>
                  {full && <td className="r num">{x.stint ?? "—"}</td>}
                  <td className="r num">{x.pit_stops}</td>
                  <td className="r num" style={{ color: x.gained > 0 ? "#2fbf71" : x.gained < 0 ? "#ff5a52" : "#8a909d" }}>{x.gained === null ? "—" : x.gained > 0 ? `▲ ${x.gained}` : x.gained < 0 ? `▼ ${-x.gained}` : "–"}</td>
                  <td className="r num">{x.pred_pos ? <>{x.p_win !== null && x.p_win > 0.005 ? <span className="mr-2.5 text-faint">{pct(x.p_win, 0)} win</span> : null}<span className="font-semibold">P{x.pred_pos}</span></> : <span className="text-faint">—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={13} className="!py-8 text-center text-dim">{filtered ? "No drivers match these filters." : "No timing rows for this session."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Notes items={c.limitations} />
    </div>
  );
}
