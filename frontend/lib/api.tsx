"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// API base: call the backend directly when its address is known at build time (NEXT_PUBLIC_API_URL, or derived
// from NEXT_PUBLIC_WS_URL), so slow model requests are not cut off by the hosting proxy; otherwise use /api rewrites.
const WS = process.env.NEXT_PUBLIC_WS_URL || "";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || (WS ? WS.replace(/^ws/, "http").replace(/\/ws\/live\/?$/, "") : "");

// Display conventions applied to every response, so no page has to remember them:
// - driver names arrive as "Max VERSTAPPEN" (the timing feed's convention) and are shown as "Max Verstappen";
// - tyre compound names inside sentences ("on SOFT tyres") are shown in lower case.
// A value that is exactly a compound ("SOFT") is left alone: pages use it as a key for colours and choices.
const NAME_KEYS = new Set(["name", "full_name", "driver_name"]);
const titleWord = (w: string) => w.split(/([-'’])/).map((part) => (/^\p{Lu}{2,}$/u.test(part) ? part[0] + part.slice(1).toLowerCase() : part)).join("");
// only "First SURNAME" shapes: a space, some lower case, and a capitalised word — never a bare code such as "VER"
export const properName = (v: string) => (v.includes(" ") && /\p{Ll}/u.test(v) && /\p{Lu}{3,}/u.test(v) && /^[\p{L}\s.'’-]+$/u.test(v) ? v.split(" ").map(titleWord).join(" ") : v);
const SOURCE_WORD = /\b(OBSERVED|HISTORICAL|MODEL|ASSUMPTIONS?|FORECAST)\b/g;
const COMPOUND_WORD = /\b(SOFT|MEDIUM|HARD|INTERMEDIATE|WET)(S?)\b/g;
export function tidy<T>(v: T, key?: string): T {
  if (typeof v === "string") {
    if (key && NAME_KEYS.has(key)) return properName(v) as unknown as T;
    if (!v.includes(" ")) return v;
    // source words inside sentences ("an ASSUMPTION") read as ordinary words; a leading "OBSERVED · " prefix is
    // kept as it is, because pages turn that prefix into a tag
    return v.replace(COMPOUND_WORD, (m) => m.toLowerCase())
      .replace(SOURCE_WORD, (m, _w, at: number, all: string) => (at === 0 ? (all.startsWith(m + " · ") ? m : m[0] + m.slice(1).toLowerCase()) : m.toLowerCase())) as unknown as T;
  }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = tidy(v[i], key); return v; }
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; for (const k in o) o[k] = tidy(o[k], k); }
  return v;
}

export async function api<T = any>(path: string, body?: unknown, attempt = 0): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API_BASE + path, body === undefined ? { cache: "no-store" } :
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    // dropped connection (e.g. the API host waking up or restarting): retry twice before giving up
    if (attempt < 2) { await new Promise((ok) => setTimeout(ok, 2500 * (attempt + 1))); return api<T>(path, body, attempt + 1); }
    throw new Error("The API did not respond. It may be waking up — try again in a moment.");
  }
  if ((r.status === 502 || r.status === 503 || r.status === 504) && attempt < 2 && body === undefined) {
    await new Promise((ok) => setTimeout(ok, 2500 * (attempt + 1)));
    return api<T>(path, body, attempt + 1);
  }
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return tidy(await r.json());
}

// ---- global activity signal: lets the shell show that something is being calculated
let inFlight = 0;
const listeners = new Set<(n: number) => void>();
const bump = (d: number) => { inFlight = Math.max(0, inFlight + d); listeners.forEach((f) => f(inFlight)); };
export function useActivity(): boolean {
  const [n, setN] = useState(0);
  useEffect(() => { listeners.add(setN); setN(inFlight); return () => { listeners.delete(setN); }; }, []);
  return n > 0;
}

/** GET with loading/error state. Pass null to skip. Keeps the previous data visible while refetching.
 *  Latest wins: only one request per hook is ever in flight. If the wanted path changes (or a refresh is
 *  asked for) while one is running, the newest request starts when it finishes and anything in between is
 *  skipped — so dragging the lap control or a burst of updates never queues work on the API. */
export function useApi<T = any>(path: string | null, tick: number = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);          // showing data for a previous request while a new one runs
  const busy = useRef(false);
  const want = useRef<string | null>(null);
  const shown = useRef<string | null>(null);
  const alive = useRef(true);
  const [n, setN] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    want.current = path;
    if (!path) { setLoading(false); setStale(false); return; }
    setStale(shown.current !== null && shown.current !== path);
    if (busy.current) return;                          // the running request will pick the newest path up when it ends
    const run = (target: string) => {
      busy.current = true; setLoading(true); bump(1);
      api<T>(target).then((d) => { if (alive.current && want.current === target) { setData(d); setError(null); shown.current = target; setStale(false); } })
        .catch((e) => { if (alive.current && want.current === target) setError(String(e.message || e)); })
        .finally(() => {
          busy.current = false; bump(-1);
          if (!alive.current) return;
          const next = want.current;
          if (next && next !== target) run(next); else setLoading(false);
        });
    };
    run(path);
  }, [path, tick, n]);
  return { data, error, loading, stale, reload: useCallback(() => setN((x) => x + 1), []) };
}

type Race = {
  sessions: any[]; sessionKey: number | null; setSessionKey: (k: number) => void;
  lap: number | null; setLap: (l: number | null) => void; driver: number | null; setDriver: (d: number | null) => void;
  cmd: any | null; cmdError: string | null; cmdLoading: boolean; status: any | null; tick: number; alert: string | null; clearAlert: () => void;
  q: string; wsState: "connecting" | "open" | "closed";
};
const Ctx = createContext<Race>(null as any);
export const useRace = () => useContext(Ctx);

export function RaceProvider({ children }: { children: React.ReactNode }) {
  const [sessionKey, setKey] = useState<number | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const [driver, setDriver] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [wsState, setWs] = useState<"connecting" | "open" | "closed">("connecting");
  const [slow, setSlow] = useState(0);
  useEffect(() => { const t = setInterval(() => setSlow((x) => x + 1), 300000); return () => clearInterval(t); }, []);
  const { data: status } = useApi<any>("/api/status", slow);
  const { data: sessions } = useApi<any[]>("/api/sessions", 0);
  useEffect(() => { if (status && sessionKey === null) setKey(status.default_session); }, [status, sessionKey]);
  const setSessionKey = useCallback((k: number) => { setKey(k); setLap(null); setDriver(null); }, []);
  const q = useMemo(() => {
    const p = new URLSearchParams();
    if (sessionKey) p.set("session_key", String(sessionKey));
    if (lap) p.set("lap", String(lap));
    return p.toString();
  }, [sessionKey, lap]);
  const { data: cmd, error: cmdError, loading: cmdLoading } = useApi<any>(sessionKey ? `/api/command?${q}` : null, tick);
  useEffect(() => {
    if (cmd && driver === null && cmd.rows?.length) setDriver(cmd.rows[0].driver_number);
  }, [cmd, driver]);
  // WebSocket: the backend pushes an update whenever new timing data is stored
  useEffect(() => {
    let ws: WebSocket | null = null, timer: any, stop = false;
    const url = process.env.NEXT_PUBLIC_WS_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8000/ws/live`;
    const open = () => {
      if (stop) return;
      try { ws = new WebSocket(url); } catch { setWs("closed"); return; }
      ws.onopen = () => setWs("open");
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "update") setTick((t) => t + 1);
          if (m.type === "weather_alert") { setAlert(m.message); setTick((t) => t + 1); }
        } catch {}
      };
      ws.onclose = () => { setWs("closed"); timer = setTimeout(open, 10000); };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, []);
  // Fallback refresh: only while a session is actually running (live, delayed or a rehearsal) and the push
  // socket is not connected. A finished race never changes, so it is never refetched on a timer.
  const running = ["LIVE", "DELAYED", "REHEARSAL"].includes(cmd?.mode?.mode);
  useEffect(() => {
    if (!running || wsState === "open") return;
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, [running, wsState]);
  const value: Race = { sessions: sessions || [], sessionKey, setSessionKey, lap, setLap, driver, setDriver, cmd, cmdError, cmdLoading, status, tick,
    alert, clearAlert: () => setAlert(null), q, wsState };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
