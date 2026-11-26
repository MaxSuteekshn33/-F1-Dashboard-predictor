"use client";
// Client side of "the browser runs the simulations": run prepared packages in Web Workers (several at once),
// and complete server responses that arrived with `deferred` packages instead of simulated results.
import { useEffect, useState } from "react";
import { tidy } from "./api";
import { advisorFinish, advisorMiddle, advisorPackages, finishDeferred, runLab, type Job, type Package, type SimResult } from "./sim";

/** Run every package, up to four at a time, each in its own worker. Results come back in the order given. */
export function runPackages(packages: Package[], timeoutMs = 90000): Promise<SimResult[]> {
  return new Promise<SimResult[]>((resolve, reject) => {
    if (!packages.length) { resolve([]); return; }
    const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    const size = Math.max(1, Math.min(packages.length, 4, cores - 1 || 1));
    const out = new Array<SimResult>(packages.length);
    const workers: Worker[] = [];
    let next = 0, done = 0, settled = false;
    const finish = (err?: Error) => { if (settled) return; settled = true; clearTimeout(stop); workers.forEach((w) => w.terminate()); err ? reject(err) : resolve(out); };
    const stop = setTimeout(() => finish(new Error("timed out")), timeoutMs);
    const feed = (w: Worker) => { if (next < packages.length) { const id = next++; w.postMessage({ id, package: packages[id] }); } };
    try {
      for (let k = 0; k < size; k++) {
        const w = new Worker(new URL("./sim.worker.ts", import.meta.url));
        w.onmessage = (e) => {
          if (!e.data.ok) { finish(new Error(e.data.error)); return; }
          out[e.data.id] = e.data.res;
          if (++done === packages.length) finish(); else feed(w);
        };
        w.onerror = (e) => finish(new Error(e.message || "worker failed"));
        workers.push(w); feed(w);
      }
    } catch (e: any) { finish(e instanceof Error ? e : new Error(String(e))); }
  });
}

/** Simulation Lab: run the prepared scenarios here and build the result cards. */
export async function runLabInBrowser(jobs: Job[], note: string) {
  const idx = jobs.map((j, i) => (j.package && !j.error ? i : -1)).filter((i) => i >= 0);
  const res = await runPackages(idx.map((i) => jobs[i].package!));
  const results: (SimResult | undefined)[] = [];
  idx.forEach((i, k) => { results[i] = res[k]; });
  return runLab(jobs, note, results);
}

/** Complete a response: run its deferred simulations here, or ask the server for the whole answer if that fails. */
export async function resolveDeferred<T = any>(data: any, fromServer: () => Promise<T>): Promise<T> {
  if (!data?.deferred) return data;
  try {
    if (data.deferred.kind === "advisor") {        // two rounds: the plans first, then "pit now" against the plan they favour
      const mid = advisorMiddle(data, await runPackages(advisorPackages(data)));
      return tidy(advisorFinish(data, mid, await runPackages(mid.next.map((j: any) => j.package)))) as T;
    }
    return tidy(finishDeferred(data, await runPackages(data.deferred.jobs.map((j: any) => j.package)))) as T;
  }
  catch { return { ...(await fromServer()), engine: "server" } as T; }
}

/** Hook form: `data` may carry deferred packages; returns the completed data (null while simulating). */
export function useResolved<T = any>(data: any, fromServer: () => Promise<T>): { data: T | null; simulating: boolean; error: string | null } {
  const [state, setState] = useState<{ src: any; data: T | null; error: string | null }>({ src: null, data: null, error: null });
  useEffect(() => {
    if (!data) { setState({ src: null, data: null, error: null }); return; }
    if (!data.deferred) { setState({ src: data, data, error: null }); return; }
    let live = true;
    resolveDeferred<T>(data, fromServer).then((d) => live && setState({ src: data, data: d, error: null }))
      .catch((e) => live && setState({ src: data, data: null, error: String(e?.message ?? e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const current = state.src === data;
  return { data: current ? state.data : null, simulating: !!data?.deferred && !(current && (state.data || state.error)), error: current ? state.error : null };
}
