// Monte Carlo race simulator — the browser's copy of backend/app/sim.py `run_package`.
//
// The server prepares a "package" (every input as plain numbers: pace, tyre model, plans, wetness timeline,
// incident rates) and this file plays the remaining laps N times, exactly as the Python engine does: same
// lap-time model, same pit and weather rules, same traffic and Safety Car handling, same number of runs.
// The only difference is the random-number generator, so results agree with the server's within Monte Carlo
// error. `frontend/tests/sim-parity.mjs` checks that against results produced by the Python engine.
//
// Keep the two in step: a change to the race model in sim.py must be made here too, and the fixture
// regenerated (backend/tests/make_sim_fixture.py).

export type Package = {
  n: number; seed: number; cur: number; total: number; R: number; D: number; K: number;
  nums: number[]; codes: string[]; colours: (string | null)[];
  base: number[]; sigma: number[]; base_sd: number[];
  off: number[]; deg: number[]; life: number[]; warm: number[]; pit_loss: number;
  comp0: number[]; age0: number[]; cum0: number[]; plan_lap: number[][]; plan_comp: number[][];
  manual_until: number[]; hold_until: number[];
  wpath: number[]; rain_uncertainty_laps: number;
  forced: { start: number; duration: number; code: number } | null; random_incidents: boolean;
  sc_per_lap: number; vsc_per_lap: number; hazard: number; retire_lap: number[]; thresh: number;
  pit_closed: number[]; best_slick: number; focus: number | null;
  constants: { cliff: number; cliff_max: number; pit_factor_sc: number; pit_factor_vsc: number; slick_to_inter: number; inter_to_slick: number; inter_to_wet: number };
  inputs: Record<string, unknown>; error?: string;
};

export type DriverResult = {
  driver_number: number; code: string; team_colour: string | null; p_win: number; p_podium: number; p_top5: number; exp_pos: number;
  pos_p10: number; pos_p90: number; p_dnf: number; mean_stops: number; exp_points: number; exp_time: number | null; time_sd: number | null;
  blocked_laps: number; exp_gap_to_winner: number | null;
};
export type Focus = DriverResult & { pos_hist: number[]; p_win_se: number; p_podium_se: number; risk: number; sims_time: Float64Array; sims_alive: Uint8Array };
export type SimResult = { n_sims: number; from_lap: number; total_laps: number; drivers: DriverResult[]; wetness_path: number[]; inputs: Record<string, unknown>; focus?: Focus; error?: string };

const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Seeded generator (xoshiro128**), one independent stream per simulated race. */
function rng(seed: number, stream: number) {
  let h = (seed ^ 0x9e3779b9) >>> 0, g = (stream + 0x85ebca6b) >>> 0;
  const mix = () => {                       // splitmix32 to fill the state
    h = (h + 0x9e3779b9 + g) >>> 0; g = (g + 0x6d2b79f5) >>> 0;
    let z = h; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0;
  };
  let a = mix(), b = mix(), c = mix(), d = mix();
  const next = () => {
    const r = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)), 9) >>> 0;
    const t = b << 9; c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = (d << 11) | (d >>> 21);
    return r;
  };
  let spare = NaN;
  const uniform = () => (next() + 0.5) / 4294967296;             // in (0, 1)
  const normal = () => {
    if (!Number.isNaN(spare)) { const s = spare; spare = NaN; return s; }
    const u = uniform(), v = uniform(), m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

/** numpy.percentile (linear interpolation) on an ascending array. */
function percentileSorted(s: ArrayLike<number>, q: number): number {
  const n = s.length; if (!n) return NaN;
  const x = (q / 100) * (n - 1), lo = Math.floor(x), hi = Math.min(n - 1, lo + 1);
  return s[lo] + (s[hi] - s[lo]) * (x - lo);
}
/** Percentile of finishing positions from their histogram (count[p-1] = runs that finished p-th). */
function percentileHist(count: ArrayLike<number>, n: number, q: number): number {
  const x = (q / 100) * (n - 1), lo = Math.floor(x), hi = Math.min(n - 1, lo + 1);
  const at = (k: number) => { let acc = 0; for (let p = 0; p < count.length; p++) { acc += count[p]; if (k < acc) return p + 1; } return count.length; };
  const a = at(lo), b = at(hi);
  return a + (b - a) * (x - lo);
}

export function runPackage(pk: Package): SimResult {
  if (pk.error) return { error: pk.error, drivers: [], n_sims: 0, from_lap: 0, total_laps: 0, wetness_path: [], inputs: {} };
  const { n, D, K, R, cur, total } = pk;
  const C = pk.constants;
  const s2i = C.slick_to_inter + 0.03, i2w = C.inter_to_wet + 0.04, i2s = C.inter_to_slick - 0.03;
  const closed = new Set(pk.pit_closed);
  // accumulators
  const posCount = Array.from({ length: D }, () => new Float64Array(D));
  const sumPos = new Float64Array(D), sumPosSq = new Float64Array(D), sumPts = new Float64Array(D), dnf = new Float64Array(D), sumStops = new Float64Array(D);
  const nAlive = new Float64Array(D), sumT = new Float64Array(D), sumT2 = new Float64Array(D), sumGap = new Float64Array(D), sumBlocked = new Float64Array(D);
  const fi = pk.focus;
  const fTime = new Float64Array(fi === null ? 0 : n), fAlive = new Uint8Array(fi === null ? 0 : n);
  // per-race state, reused
  const base = new Float64Array(D), cum = new Float64Array(D), prev = new Float64Array(D), lt = new Float64Array(D), age = new Float64Array(D);
  const comp = new Int32Array(D), newComp = new Int32Array(D), ptr = new Int32Array(D), stops = new Int32Array(D), blocked = new Int32Array(D);
  const alive = new Uint8Array(D), pit = new Uint8Array(D), planLap = new Int32Array(D * K), neut = new Int8Array(R);
  const order = new Array<number>(D), flat = pk.plan_lap.flat();
  const uSc = new Float64Array(R), uVsc = new Float64Array(R), dSc = new Int32Array(R), dVsc = new Int32Array(R);

  for (let s = 0; s < n; s++) {
    const g = rng(pk.seed, s);
    for (let i = 0; i < D; i++) {
      base[i] = pk.base[i] + g.normal() * pk.base_sd[i];
      cum[i] = pk.cum0[i]; comp[i] = pk.comp0[i]; age[i] = pk.age0[i]; alive[i] = 1; ptr[i] = 0; stops[i] = 0; blocked[i] = 0;
    }
    planLap.set(flat);
    // rain-timing uncertainty: the whole wetness timeline shifts by a few laps, earlier or later
    const u = pk.rain_uncertainty_laps, uj = g.uniform();
    const jitter = u ? Math.floor(uj * (2 * u + 1)) - u : 0;
    // neutralisations: forced by the scenario, otherwise drawn from historical base rates. The draws are always
    // made, so two scenarios with the same field see the same random futures (common random numbers).
    for (let l = 0; l < R; l++) { uSc[l] = g.uniform(); dSc[l] = 3 + Math.floor(g.uniform() * 3); uVsc[l] = g.uniform(); dVsc[l] = 1 + Math.floor(g.uniform() * 2); }
    neut.fill(0);
    if (pk.forced) { for (let l = pk.forced.start; l < Math.min(R, pk.forced.start + pk.forced.duration); l++) neut[l] = pk.forced.code; }
    else if (pk.random_incidents) {
      for (let l = 0; l < R; l++) {
        if (uSc[l] < pk.sc_per_lap) for (let e = l; e < Math.min(R, l + dSc[l]); e++) neut[e] = 2;
        if (uVsc[l] < pk.vsc_per_lap) for (let e = l; e < Math.min(R, l + dVsc[l]); e++) if (neut[e] < 1) neut[e] = 1;
      }
    }

    for (let li = 0; li < R; li++) {
      const lap = cur + li + 1, nt = neut[li];
      const wl = pk.wpath[Math.max(0, Math.min(R - 1, li - jitter))];
      const factor = nt === 2 ? C.pit_factor_sc : nt === 1 ? C.pit_factor_vsc : 1;
      const pitOpen = !closed.has(lap);
      for (let i = 0; i < D; i++) {
        const z = g.normal(), uFlag = g.uniform(), uMag = g.uniform(), zPit = g.normal(), uHaz = g.uniform();
        const c = comp[i], a = age[i], b = base[i];
        let t: number;
        if (nt === 2) t = b * 1.38;
        else if (nt === 1) t = b * 1.28;
        else {
          const over = Math.max(a - pk.life[c], 0);
          const wet = c <= 2 ? 0.55 * Math.pow(wl, 1.5) : c === 3 ? 0.07 + 0.45 * (wl - 0.3) * (wl - 0.3) : 0.10 + 0.08 * (1 - wl);
          t = b + pk.off[c] + pk.deg[c] * a + Math.min(C.cliff * over * over, C.cliff_max) + wet * b + z * pk.sigma[i] * (1 + 1.5 * wl);
        }
        // pit decisions (taken at the end of this lap)
        const p = Math.min(ptr[i], K - 1), cpl = planLap[i * K + p], cpc = pk.plan_comp[i][p], hasPlan = ptr[i] < K;
        const auto = ptr[i] >= pk.manual_until[i] && lap > pk.hold_until[i];
        const planned = hasPlan && cpl === lap && !(c >= 3 && cpc <= 2 && wl >= i2s && auto);
        let nc = planned ? cpc : c;
        // weather reaction: switch tyre class one lap after the crossover is passed
        const toInter = auto && c <= 2 && wl > s2i;
        const toWet = auto && c === 3 && wl > i2w;
        const toSlick = auto && c >= 3 && wl < i2s && R - li > 3;
        if (toInter) nc = wl > i2w ? 4 : 3;
        if (toWet) nc = 4;
        if (toSlick) nc = hasPlan && cpc <= 2 ? cpc : pk.best_slick;
        // neutralisation reaction: bring a planned stop forward when it is within reach
        const early = auto && hasPlan && nt >= 1 && cpl > lap && cpl - lap <= 14 && a > 5 && R - li > 4;
        const weather = toInter || toWet || toSlick;
        if (early && !weather) nc = cpc;
        const pits = (planned || weather || early) && alive[i] === 1 && pitOpen;
        if (pits) t += pk.pit_loss * factor + Math.abs(zPit * 0.5) + (uFlag < 0.04 ? 2 + 7 * uMag : 0) + pk.warm[nc];
        if (planned || early) ptr[i]++;
        // a slick stop planned for a lap that turned out too wet is postponed, not dropped
        if (hasPlan && cpl === lap && !planned) planLap[i * K + p] = lap + 1;
        // weather-forced stops consume the next planned stop if it was imminent
        if (weather && hasPlan && !planned && !early && cpl - lap <= 6) ptr[i]++;
        if (pits) stops[i]++;
        prev[i] = cum[i]; cum[i] += t; lt[i] = t; pit[i] = pits ? 1 : 0; newComp[i] = nc;
        // retirements
        if (alive[i] === 1 && (uHaz < pk.hazard || pk.retire_lap[i] === lap)) { alive[i] = 0; cum[i] = 1e6 - lap * 1e3; }
      }
      // on-track order: a car is held up behind the car it followed unless it is clearly faster / someone pitted
      for (let i = 0; i < D; i++) order[i] = i;
      order.sort((x, y) => prev[x] - prev[y]);
      if (nt === 0) {
        for (let k = 1; k < D; k++) {
          const i = order[k], j = order[k - 1];
          if (cum[i] < cum[j] + 0.3 && cum[i] < 5e5 && cum[j] < 5e5 && !pit[i] && !pit[j] && lt[j] - lt[i] < pk.thresh && prev[i] - prev[j] < 3.0) {
            cum[i] = cum[j] + 0.3; blocked[i]++;
          }
        }
      } else if (nt === 2) {
        // safety car: the field closes up behind the leader
        order.sort((x, y) => cum[x] - cum[y]);
        const lead = cum[order[0]];
        for (let k = 0; k < D; k++) {
          const i = order[k], cs = cum[i];
          if (cs < 5e5) { const target = lead + k * 0.9; cum[i] = Math.min(cs, Math.max(target, cs - (cs - target) * 0.75)); }
        }
      }
      for (let i = 0; i < D; i++) { if (pit[i]) { age[i] = 0; comp[i] = newComp[i]; } else age[i] += 1; }
    }
    // finishing order of this simulated race
    for (let i = 0; i < D; i++) order[i] = i;
    order.sort((x, y) => cum[x] - cum[y]);
    const lead = cum[order[0]];
    for (let k = 0; k < D; k++) {
      const i = order[k], pos = k + 1;
      posCount[i][k]++; sumPos[i] += pos; sumPosSq[i] += pos * pos; sumPts[i] += k < 10 ? PTS[k] : 0; sumStops[i] += stops[i]; sumBlocked[i] += blocked[i];
      if (alive[i]) { nAlive[i]++; sumT[i] += cum[i]; sumT2[i] += cum[i] * cum[i]; sumGap[i] += cum[i] - lead; } else dnf[i]++;
    }
    if (fi !== null) { fTime[s] = cum[fi]; fAlive[s] = alive[fi]; }
  }

  const drivers: DriverResult[] = [];
  for (let i = 0; i < D; i++) {
    const na = nAlive[i], mean = na ? sumT[i] / na : null;
    let top3 = 0, top5 = 0;
    for (let k = 0; k < Math.min(5, D); k++) { top5 += posCount[i][k]; if (k < 3) top3 += posCount[i][k]; }
    drivers.push({
      driver_number: pk.nums[i], code: pk.codes[i], team_colour: pk.colours[i],
      p_win: posCount[i][0] / n, p_podium: top3 / n, p_top5: top5 / n, exp_pos: sumPos[i] / n,
      pos_p10: Math.trunc(percentileHist(posCount[i], n, 10)), pos_p90: Math.trunc(percentileHist(posCount[i], n, 90)),
      p_dnf: dnf[i] / n, mean_stops: sumStops[i] / n, exp_points: sumPts[i] / n,
      exp_time: mean, time_sd: na && mean !== null ? Math.sqrt(Math.max(0, sumT2[i] / na - mean * mean)) : null,
      blocked_laps: sumBlocked[i] / n, exp_gap_to_winner: na ? sumGap[i] / na : null,
    });
  }
  const out: SimResult = { n_sims: n, from_lap: cur, total_laps: total, drivers, wetness_path: pk.wpath.map((x) => Math.round(x * 1000) / 1000), inputs: pk.inputs };
  if (fi !== null) {
    const d = drivers[fi], se = (x: number) => Math.sqrt(Math.max(x * (1 - x), 1e-9) / n);
    const m = sumPos[fi] / n;
    out.focus = { ...d, pos_hist: Array.from(posCount[fi], (c) => c / n), p_win_se: se(d.p_win), p_podium_se: se(d.p_podium),
      risk: Math.sqrt(Math.max(0, sumPosSq[fi] / n - m * m)), sims_time: fTime, sims_alive: fAlive };
  }
  return out;
}

// ---------------------------------------------------------------- Simulation Lab result cards (service.py lab_result / lab_finish)
export type Job = { name: string; error?: string; package?: Package; meta?: { driver: string; driver_number: number; lap: number; total_laps: number; plan: { lap: number; compound: string }[]; gap_s: number; assumptions: string[] } };

const round = (x: number, d: number) => { const k = Math.pow(10, d); return Math.round(x * k) / k; };

export function labResult(job: Job, r: SimResult): any {
  if (!r.focus || !job.meta) return { name: job.name, error: r.error || "simulation failed" };
  const mt = job.meta, f = r.focus;
  const t: number[] = [];
  for (let i = 0; i < f.sims_time.length; i++) if (f.sims_alive[i]) t.push(f.sims_time[i]);
  t.sort((a, b) => a - b);
  const mean = t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
  return {
    name: job.name, driver: mt.driver, driver_number: mt.driver_number, lap: mt.lap, total_laps: mt.total_laps, plan: mt.plan,
    exp_pos: round(f.exp_pos, 2), p_win: round(f.p_win, 4), p_podium: round(f.p_podium, 4), p_win_se: round(f.p_win_se, 4), risk_pos_sd: round(f.risk, 2),
    pos_p10: f.pos_p10, pos_p90: f.pos_p90, p_dnf: round(f.p_dnf, 3),
    exp_race_time_remaining: mean === null ? null : round(mean - mt.gap_s, 1),
    time_p10: t.length ? round(percentileSorted(t, 10) - mt.gap_s, 1) : null, time_p90: t.length ? round(percentileSorted(t, 90) - mt.gap_s, 1) : null,
    pos_hist: f.pos_hist.map((x) => round(x, 4)), blocked_laps: round(f.blocked_laps, 1),
    field: r.drivers.map((d) => ({ code: d.code, p_win: round(d.p_win, 3), exp_pos: round(d.exp_pos, 1), team_colour: d.team_colour })).sort((a, b) => a.exp_pos - b.exp_pos).slice(0, 8),
    assumptions: mt.assumptions, inputs: r.inputs, n_sims: r.n_sims, _t: f.sims_time, _ok: f.sims_alive,
  };
}

export function labFinish(results: any[], note: string): { results: any[]; note: string; engine: string } {
  const good = results.filter((r) => !r.error);
  if (good.length) {
    const ref = good[0];
    for (const r of good) {
      let sum = 0, cnt = 0;
      if (r._t.length === ref._t.length && r.lap === ref.lap) for (let i = 0; i < r._t.length; i++) if (r._ok[i] && ref._ok[i]) { sum += r._t[i] - ref._t[i]; cnt++; }
      r.time_vs_first = cnt ? round(sum / cnt, 2) : null;
    }
    let best = good[0];
    for (const r of good) if (r.exp_pos < best.exp_pos || (r.exp_pos === best.exp_pos && r.p_win > best.p_win)) best = r;
    for (const r of good) { r.best = r === best; r.best_alternative = r === best ? null : best.name; }
  }
  for (const r of results) { delete r._t; delete r._ok; }
  return { results, note, engine: "browser" };
}

/** `results[i]` may hold job i's finished simulation (run elsewhere, e.g. in parallel workers); missing ones are run here. */
export function runLab(jobs: Job[], note: string, results?: (SimResult | undefined)[]) {
  return labFinish(jobs.map((j, i) => (j.error || !j.package ? { name: j.name, error: j.error || "simulation failed" } : labResult(j, results?.[i] ?? runPackage(j.package)))), note);
}

// ---------------------------------------------------------------- deferred comparisons (strategy, Safety Car, next race)
// The server answers these pages with everything except the simulations, plus one package per option under
// `deferred`. The functions below are ports of weather.compare_finish, service.strategy_finish,
// service.safety_car_finish and nextrace.next_finish.
type CmpJob = { label: string; plan: { lap: number; compound: string }[]; package: Package };

export function compareTable(jobs: CmpJob[], keepField = false, results?: SimResult[]): any[] {
  const runs = jobs.map((j, i) => ({ j, r: results?.[i] ?? runPackage(j.package) })).filter((x) => x.r.focus);
  const out: any[] = runs.map(({ j, r }) => {
    const f = r.focus!;
    return { label: j.label, plan: j.plan, exp_pos: round(f.exp_pos, 2), p_win: round(f.p_win, 4), p_podium: round(f.p_podium, 4), p_win_se: round(f.p_win_se, 4),
      risk_pos_sd: round(f.risk, 2), pos_p10: f.pos_p10, pos_p90: f.pos_p90, blocked_laps: round(f.blocked_laps, 1), pos_hist: f.pos_hist.map((x) => round(x, 4)),
      exp_time: f.exp_time, _t: f.sims_time, _a: f.sims_alive, n_sims: r.n_sims, wetness_path: r.wetness_path, inputs: r.inputs, _field: r.drivers };
  });
  if (out.length) {
    const n = out[0]._t.length;
    // compare only the simulated races in which the car finished under every option
    const ok = new Uint8Array(n).fill(1);
    for (const o of out) for (let i = 0; i < n; i++) if (!o._a[i]) ok[i] = 0;
    let cnt = 0; for (let i = 0; i < n; i++) cnt += ok[i];
    const means: (number | null)[] = out.map((o) => { if (!cnt) return null; let s = 0; for (let i = 0; i < n; i++) if (ok[i]) s += o._t[i]; return s / cnt; });
    const real = means.filter((x): x is number => x !== null);
    const best = real.length ? Math.min(...real) : null, ref = means[0];
    out.forEach((o, k) => {
      const mu = means[k];
      o.time_vs_best = mu !== null && best !== null ? round(mu - best, 2) : null;
      o.time_vs_first = mu !== null && ref !== null ? round(mu - ref, 2) : null;
      if (cnt) {
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) if (ok[i]) { const d = o._t[i] - out[0]._t[i]; s += d; s2 += d * d; }
        o.paired_se = round(Math.sqrt(Math.max(0, s2 / cnt - (s / cnt) * (s / cnt))) / Math.sqrt(Math.max(1, cnt)), 2);
      } else o.paired_se = null;
    });
    for (const o of out) { delete o._t; delete o._a; }
  }
  if (!keepField) for (const o of out) delete o._field;
  return out;
}

const byFinishThenTime = (a: any, b: any, timeKey: string) => round(a.exp_pos, 1) - round(b.exp_pos, 1) || (a[timeKey] || 0) - (b[timeKey] || 0);

/** Complete a response that came back with `deferred` packages. Returns the same shape the server would have sent. */
export function finishDeferred(data: any, results?: SimResult[]): any {
  const d = data.deferred;
  const out = { ...data, engine: "browser" };
  delete out.deferred;
  if (d.kind === "strategy") {
    const table = compareTable(d.jobs, false, results);
    const tm: Record<string, any> = Object.fromEntries(table.map((t) => [t.label, t]));
    out.strategies = d.opts.map((o: any) => {
      const t = tm[o.label] || {};
      return { label: o.label, name: o.name, plan: o.plan, stints: o.stints, rule_ok: o.rule_ok, recommended_pit_lap: o.plan.length ? o.plan[0].lap : null,
        pit_time_lost: round(o.pit_time_lost, 1), deg_time: round(o.deg_time, 1), deterministic_delta: o.delta_vs_best ?? null, optimal_deterministic: o.optimal ?? false,
        exp_time_delta: t.time_vs_best ?? null, exp_pos: t.exp_pos ?? null, p_win: t.p_win ?? null, p_podium: t.p_podium ?? null, traffic_laps: t.blocked_laps ?? null,
        pos_p10: t.pos_p10 ?? null, pos_p90: t.pos_p90 ?? null, pos_hist: t.pos_hist ?? null };
    });
    const legal = out.strategies.filter((s: any) => s.rule_ok && s.exp_pos !== null);
    if (legal.length) {
      const best = legal.reduce((a: any, b: any) => (byFinishThenTime(b, a, "exp_time_delta") < 0 ? b : a));
      best.recommended = true;
      if (d.windows && best.label in d.windows) out.window = d.windows[best.label];
    }
    out.n_sims = table.length ? table[0].n_sims : null;
  } else if (d.kind === "safetycar") {
    const table = compareTable(d.jobs, false, results);
    out.options = table;
    out.verdicts = {};
    if (table.length === 6) for (const [k, i] of [["sc", 0], ["vsc", 2], ["green", 4]] as [string, number][]) {
      const a = table[i], b = table[i + 1];
      out.verdicts[k] = { pit_minus_stay_positions: round(a.exp_pos - b.exp_pos, 2), better: a.exp_pos < b.exp_pos ? "PIT" : "STAY OUT", pit: a.label, stay: b.label };
    }
  } else if (d.kind === "next") {
    const table = compareTable(d.jobs, true, results);
    const bestModel = Math.min(...d.options.map((o: any) => o.model_time));
    const by: Record<string, any> = Object.fromEntries(d.options.map((o: any) => [o.label, o]));
    for (const t of table) { const o = by[t.label]; t.start = o.start; t.stops = o.stops; t.model_delta = round(o.model_time - bestModel, 2); }
    const best = table.length ? table.reduce((a, b) => (byFinishThenTime(b, a, "time_vs_best") < 0 ? b : a)) : null;
    out.field = (best?._field || []).map((x: DriverResult) => ({ code: x.code, team_colour: x.team_colour, p_win: round(x.p_win, 4), p_podium: round(x.p_podium, 4),
      exp_pos: round(x.exp_pos, 2), grid: d.grid_of[String(x.driver_number)] ?? null })).sort((a: any, b: any) => a.exp_pos - b.exp_pos);
    for (const t of table) delete t._field;
    out.options = table; out.best = best ? best.label : null;
    out.wetness_path = best ? best.wetness_path : null; out.n_sims = best ? best.n_sims : d.n_sims;
  } else throw new Error(`unknown deferred kind ${d.kind}`);
  return out;
}
