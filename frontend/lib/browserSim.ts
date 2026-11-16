"use client";
// Client side of "the browser runs the simulations": hand prepared packages to the worker, and complete
// server responses that arrived with `deferred` packages instead of simulated results.
import { useEffect, useState } from "react";

export function inWorker<T = any>(message: object, timeoutMs = 90000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL("./sim.worker.ts", import.meta.url)); } catch (e) { reject(e); return; }
    const stop = setTimeout(() => { w.terminate(); reject(new Error("timed out")); }, timeoutMs);
    w.onmessage = (e) => { clearTimeout(stop); w.terminate(); e.data.ok ? resolve(e.data.res) : reject(new Error(e.data.error)); };
    w.onerror = (e) => { clearTimeout(stop); w.terminate(); reject(new Error(e.message || "worker failed")); };
    w.postMessage(message);
  });
}

/** Complete a response: run its deferred simulations here, or ask the server for the whole answer if that fails. */
export async function resolveDeferred<T = any>(data: any, fromServer: () => Promise<T>): Promise<T> {
  if (!data?.deferred) return data;
  try { return await inWorker<T>({ deferred: data }); }
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
