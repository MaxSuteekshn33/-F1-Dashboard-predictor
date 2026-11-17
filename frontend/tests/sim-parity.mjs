// The browser engine (lib/sim.ts) must reproduce the Python engine's results within Monte Carlo error.
// Fixture: backend/tests/make_sim_fixture.py (20,000 runs per case on both sides).
// Run: node --experimental-strip-types tests/sim-parity.mjs
import { readFileSync } from "node:fs";
import { runPackage, finishDeferred, strategyRecs, advisorPackages, advisorMiddle, advisorFinish, pyFixed } from "../lib/sim.ts";

const fx = JSON.parse(readFileSync(new URL("./sim-fixture.json", import.meta.url)));
// Allowed differences: several standard errors of the difference between two independent 20,000-run estimates.
// (Two Python runs with different seeds differ by up to 0.14 finishing positions; at 80,000 runs each the two
// engines agree within 0.04 with no pattern.)
const TOL = { p_win: 0.02, p_podium: 0.025, p_top5: 0.025, p_dnf: 0.012, exp_pos: 0.2, mean_stops: 0.04, exp_points: 0.3, blocked_laps: 0.5,
  exp_time: 1.5, time_sd: 1.5, exp_gap_to_winner: 1.5 };
let failures = 0, checks = 0;
for (const c of fx.cases) {
  const t0 = performance.now();
  const r = runPackage(c.package);
  const ms = performance.now() - t0;
  const worst = {};
  r.drivers.forEach((d, i) => {
    const py = c.python.drivers[i];
    for (const [k, tol] of Object.entries(TOL)) {
      if (py[k] === null || d[k] === null) { if (py[k] !== d[k] && !(py.p_dnf > 0.999 || d.p_dnf > 0.999)) { failures++; console.log(`  ✗ ${c.name} · ${d.code} · ${k}: python ${py[k]} vs browser ${d[k]}`); } continue; }
      const diff = Math.abs(d[k] - py[k]); checks++;
      worst[k] = Math.max(worst[k] ?? 0, diff);
      if (diff > tol) { failures++; console.log(`  ✗ ${c.name} · ${d.code} · ${k}: python ${py[k].toFixed(4)} vs browser ${d[k].toFixed(4)} (allowed ±${tol})`); }
    }
  });
  const hist = Math.max(...r.focus.pos_hist.map((x, i) => Math.abs(x - c.python.focus.pos_hist[i])));
  if (hist > 0.02) { failures++; console.log(`  ✗ ${c.name} · focus position histogram differs by ${hist.toFixed(4)}`); }
  console.log(`${c.name}: ${fx.n} runs in ${ms.toFixed(0)} ms · largest differences — win ${worst.p_win.toFixed(4)}, finish ${worst.exp_pos.toFixed(3)}, time ${(worst.exp_time ?? 0).toFixed(2)} s, stops ${worst.mean_stops.toFixed(3)}, traffic ${worst.blocked_laps.toFixed(2)} laps`);
}
// Whole-page answers (strategy, Safety Car, next race): the browser finishes a deferred response; the result must
// have the same shape as Python's and the same numbers within Monte Carlo error.
const NUM_TOL = [[/p_win$|p_podium$|p_win_se$/, 0.025], [/pos_hist/, 0.025], [/exp_pos$|pit_minus_stay_positions$/, 0.25], [/pos_p10$|pos_p90$/, 1], [/risk_pos_sd$/, 0.15],
  [/blocked_laps$|traffic_laps$/, 0.5], [/exp_time$|time_vs_best$|time_vs_first$|exp_time_delta$/, 2.0], [/paired_se$/, 0.3]];
const CHOICE = /recommended$|\/best$|\/better$|\/window\//;      // which near-tied option wins may differ; checked separately
function same(a, b, path, name) {
  if (CHOICE.test(path)) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (typeof a === "number" && typeof b === "number") {
      const tol = (NUM_TOL.find(([re]) => re.test(path)) || [0, 1e-9])[1]; checks++;
      if (Math.abs(a - b) > tol) { failures++; console.log(`  ✗ ${name} · ${path}: python ${a} vs browser ${b} (allowed ±${tol})`); }
    } else if (a !== b) { failures++; console.log(`  ✗ ${name} · ${path}: python ${JSON.stringify(a)} vs browser ${JSON.stringify(b)}`); }
    return;
  }
  const ka = Object.keys(a).filter((k) => !CHOICE.test(path + "/" + k)), kb = Object.keys(b).filter((k) => k !== "engine" && !CHOICE.test(path + "/" + k));
  for (const k of new Set([...ka, ...kb])) {
    if (!(k in a) || !(k in b)) { failures++; console.log(`  ✗ ${name} · ${path}/${k}: present on one side only`); continue; }
    same(a[k], b[k], `${path}/${k}`, name);
  }
}
for (const c of fx.deferred) {
  const t0 = performance.now();
  const js = JSON.parse(JSON.stringify(finishDeferred(c.data)));
  const before = failures;
  // the field table is sorted by expected finish, so compare it by driver rather than by row
  const py = structuredClone(c.python);
  for (const o of [py, js]) if (o.field) o.field = Object.fromEntries(o.field.map((d) => [d.code, d]));
  same(py, js, "", c.name);
  // the chosen option must be Python's choice, or one Python scores as a near-tie with it
  const pick = (o) => o.best ?? (o.strategies || []).find((x) => x.recommended)?.label ?? null;
  const rows = c.python.options || c.python.strategies || [];
  const pos = (label) => rows.find((x) => x.label === label)?.exp_pos;
  const a = pick(c.python), b = pick(js);
  if (a !== b && !(Math.abs(pos(a) - pos(b)) <= 0.25)) { failures++; console.log(`  ✗ ${c.name}: python picks ${a}, browser picks ${b}`); }
  for (const k of Object.keys(c.python.verdicts || {})) {
    const v = c.python.verdicts[k], w = js.verdicts[k];
    if (v.better !== w.better && Math.abs(v.pit_minus_stay_positions) > 0.25) { failures++; console.log(`  ✗ ${c.name}: verdict ${k} python ${v.better}, browser ${w.better}`); }
  }
  console.log(`${c.name}: ${failures === before ? "matches" : "DIFFERS"} · pick python ${a ?? "—"} / browser ${b ?? "—"} · ${(performance.now() - t0).toFixed(0)} ms`);
}
// Recommendation cards: from the same facts and numbers, the browser must write exactly the text Python wrote.
let cards = 0;
for (const c of fx.recs) {
  const js = JSON.stringify(strategyRecs(c.info, c.sv, c.pair, c.sc)), py = JSON.stringify(c.python);
  cards += c.python.length; checks++;
  if (js !== py) {
    failures++;
    const a = c.python, b = JSON.parse(js);
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { console.log(`  ✗ ${c.name} card ${i}\n    python : ${JSON.stringify(a[i])}\n    browser: ${JSON.stringify(b[i])}`); break; }
  }
}
console.log(`recommendation cards: ${fx.recs.length} situations, ${cards} cards — text ${failures ? "DIFFERS" : "identical to Python"}`);
for (const [x, d, want] of [[3.25, 1, "3.2"], [3.35, 1, "3.4"], [0.125, 2, "0.12"], [-0.125, 2, "-0.12"], [2.5, 0, "2"], [1.15, 1, "1.1"], [-0.001, 2, "-0.00"], [1.005, 2, "1.00"]]) {
  checks++; if (pyFixed(x, d) !== want) { failures++; console.log(`  ✗ pyFixed(${x}, ${d}) = ${pyFixed(x, d)}, Python prints ${want}`); }
}
// The two-round flow end to end (plans, then "pit now" against the favoured plan), at the page's own run count.
for (const c of fx.advisor) {
  const mid = advisorMiddle(c.data, advisorPackages(c.data).map(runPackage));
  const out = advisorFinish(c.data, mid, mid.next.map((j) => runPackage(j.package)));
  const types = [...new Set(out.recommendations.map((r) => r.type))].sort(); checks++;
  const norm = (t) => t.map((x) => (x === "TRACK POSITION" ? "PIT WINDOW" : x)).join(",");     // which of the two is chosen can turn on a near-tie
  if (!out.recommendations.length || norm(types) !== norm(c.python_types) || out.deferred) { failures++; console.log(`  ✗ ${c.name}: browser cards ${types} vs python ${c.python_types}`); }
  console.log(`recommendations end to end, ${c.name}: ${types.join(", ")}`);
}
console.log(failures ? `\n${failures} differences beyond tolerance (${checks} checks)` : `\nAll ${checks} checks within tolerance.`);
process.exit(failures ? 1 : 0);
