// The browser engine (lib/sim.ts) must reproduce the Python engine's results within Monte Carlo error.
// Fixture: backend/tests/make_sim_fixture.py (20,000 runs per case on both sides).
// Run: node --experimental-strip-types tests/sim-parity.mjs
import { readFileSync } from "node:fs";
import { runPackage } from "../lib/sim.ts";

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
console.log(failures ? `\n${failures} differences beyond tolerance (${checks} checks)` : `\nAll ${checks} checks within tolerance.`);
process.exit(failures ? 1 : 0);
