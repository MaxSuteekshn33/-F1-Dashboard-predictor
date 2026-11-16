"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useActivity, useRace } from "@/lib/api";

const NAV: [string, string, string][] = [
  ["/live", "Live Race", "Upcoming"], ["/next", "Next Race", "Upcoming"], ["/play", "Predictions & Leagues", "Upcoming"],
  ["/", "Command Centre", "Race"], ["/telemetry", "Timing & Telemetry", "Race"], ["/predictor", "Race Predictor", "Race"],
  ["/strategy", "Pit & Tyre Strategy", "Decide"], ["/weather", "Weather Intelligence", "Decide"], ["/lab", "Simulation Lab", "Decide"], ["/advisor", "Recommendations", "Decide"],
  ["/history", "Race History", "Explore"], ["/analytics", "Drivers & Teams", "Explore"], ["/data", "Data & Models", "Explore"],
];
const MODE: Record<string, [string, string]> = { LIVE: ["#2fbf71", "Live"], DELAYED: ["#e0a100", "Delayed"], HISTORICAL: ["#9aa1ae", "Historical"], REHEARSAL: ["#c9a7ff", "Rehearsal · simulated"] };
const STATUS: Record<string, [string, string]> = {
  GREEN: ["Green flag", "#2fbf71"], SC: ["Safety Car", "#e0a100"], SC_ENDING: ["SC in this lap", "#e0a100"], VSC: ["Virtual SC", "#e0a100"],
  RED: ["Red flag", "#ff5a52"], FINISHED: ["Chequered", "#f2f3f5"], UNKNOWN: ["No data", "#7c8290"],
};

function Pill({ colour, children, title }: { colour: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium" style={{ color: colour }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour, boxShadow: `0 0 8px ${colour}` }} />{children}</span>;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const r = useRace();
  const cmd = r.cmd;
  const maxLap = cmd?.max_lap || 0;
  const lap = r.lap ?? maxLap;
  const [playing, setPlaying] = useState(false);
  const lapRef = useRef(lap);
  lapRef.current = lap;
  const working = useActivity();
  const loadingRef = useRef(false);
  loadingRef.current = r.cmdLoading;
  // The slider moves instantly; the lap is committed once you stop for a moment, so passing over laps costs nothing.
  const [drag, setDrag] = useState<number | null>(null);
  const dragTimer = useRef<any>(null);
  const commit = (v: number) => { clearTimeout(dragTimer.current); setDrag(null); r.setLap(v >= maxLap ? null : v); };
  const onSlide = (v: number) => { setPlaying(false); setDrag(v); clearTimeout(dragTimer.current); dragTimer.current = setTimeout(() => commit(v), 350); };
  useEffect(() => () => clearTimeout(dragTimer.current), []);
  const shownLap = drag ?? lap;
  useEffect(() => {   // race replay: advance one lap every 2.5 s
    if (!playing) return;
    const t = setInterval(() => {
      if (lapRef.current >= maxLap) { setPlaying(false); return; }
      if (loadingRef.current) return;                 // wait for the current lap to arrive before stepping on
      r.setLap(lapRef.current + 1);
    }, 2500);
    return () => clearInterval(t);
  }, [playing, maxLap]); // eslint-disable-line
  // What the lap control does when you move to another section: jump to the latest lap (the live lap during a
  // race), go back to lap 1, or keep the lap you were on. Remembered per browser.
  const [onNav, setOnNav] = useState<"latest" | "first" | "keep">("latest");
  useEffect(() => { try { const v = localStorage.getItem("apex.onNav"); if (v === "latest" || v === "first" || v === "keep") setOnNav(v); } catch {} }, []);
  const chooseNav = (v: "latest" | "first" | "keep") => { setOnNav(v); try { localStorage.setItem("apex.onNav", v); } catch {} };
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    setPlaying(false);
    if (onNav === "latest") r.setLap(null);
    if (onNav === "first") r.setLap(1);
  }, [path]); // eslint-disable-line
  const mode = MODE[cmd?.mode?.mode || "HISTORICAL"];
  const st = STATUS[cmd?.track_status || "UNKNOWN"] || STATUS.UNKNOWN;
  const replaying = r.lap !== null && r.lap < maxLap;
  const groups = ["Upcoming", "Race", "Decide", "Explore"];
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="btn primary skip-link">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 p-3 lg:block">
        <div className="glass-strong flex h-full flex-col rounded-3xl">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-center gap-2.5"><span className="h-5 w-1.5 -skew-x-12 rounded-sm bg-f1 shadow-[0_0_14px_rgba(225,6,0,.8)]" /><span className="text-[16px] font-bold tracking-[.2em]">APEX</span></div>
            <div className="mt-1 text-[10px] uppercase tracking-[.22em] text-faint">F1 Intelligence</div>
          </div>
          <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
            {groups.map((g) => (
              <div key={g}>
                <div className="px-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[.18em] text-faint">{g}</div>
                {NAV.filter((n) => n[2] === g).map(([href, label]) => {
                  const on = path === href;
                  return (
                    <Link key={href} href={href} aria-current={on ? "page" : undefined}
                      className={`group relative flex items-center rounded-xl px-3 py-2 text-[13px] transition-all duration-150 ${on ? "bg-white/[0.10] font-medium text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" : "text-dim hover:bg-white/[0.05] hover:text-ink"}`}>
                      <span className={`mr-2.5 h-1.5 w-1.5 rounded-full transition-all ${on ? "bg-f1 shadow-[0_0_8px_rgba(225,6,0,.9)]" : "bg-white/15 group-hover:bg-white/40"}`} />{label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="border-t border-line px-5 py-3.5 text-[10.5px] leading-relaxed text-faint">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: r.wsState === "open" ? "#2fbf71" : "#7c8290" }} />Feed {r.wsState === "open" ? "connected" : r.wsState}</span>
            <div className="mt-0.5">OpenF1 · F1DB · Jolpica · Open-Meteo</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] overflow-hidden transition-opacity duration-300 ${working ? "opacity-100" : "opacity-0"}`}><div className="activity-bar h-full w-1/3 bg-gradient-to-r from-transparent via-[#ff3b30] to-transparent" /></div>
        <header className="sticky top-0 z-20 px-3 pt-3 lg:pl-0 lg:pr-4">
          <div className="glass-strong rounded-2xl">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5">
              <select className="lg:hidden" value={path} onChange={(e) => (location.href = e.target.value)} aria-label="Section">
                {NAV.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
              </select>
              {path === "/next" || path === "/play" ? (
                <div className="flex flex-1 flex-wrap items-center gap-3 py-1 text-[12.5px] text-dim">
                  <span className="font-medium text-ink">{path === "/play" ? "Prediction game" : "Upcoming race"}</span>
                  <span>{path === "/play" ? "Make picks, score points, compare with friends. The race and lap controls return on the other sections." : "Predictions and a pre-race strategy lab. The race and lap controls return on the other sections."}</span>
                </div>
              ) : (<>
              <label className="flex min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-[.12em] text-faint"><span className="hidden sm:inline">Race</span>
                <select value={r.sessionKey ?? ""} onChange={(e) => r.setSessionKey(Number(e.target.value))} aria-label="Race" className="max-w-[210px] font-medium normal-case tracking-normal">
                  {r.sessions.map((s) => <option key={s.session_key} value={s.session_key}>{s.year} · {s.location}</option>)}
                </select></label>
              <div className="flex min-w-0 flex-1 basis-full items-center gap-2 rounded-full border border-line bg-white/[0.04] py-1 pl-3.5 pr-1 sm:basis-[340px] xl:max-w-[520px]">
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[.12em] text-faint">Lap</span>
                <input type="range" min={1} max={Math.max(1, maxLap)} value={shownLap} onChange={(e) => onSlide(Number(e.target.value))}
                  onPointerUp={() => { if (drag !== null) commit(drag); }} className="min-w-0 flex-1" aria-label="As-of lap" aria-valuetext={`Lap ${shownLap} of ${cmd?.total_laps ?? maxLap}`} />
                <span className="num w-[52px] shrink-0 text-right text-[13px] font-semibold">{shownLap}<span className="text-faint">/{cmd?.total_laps ?? "—"}</span></span>
                <button className="btn shrink-0 !min-h-[30px] !px-3 !py-1" aria-pressed={playing} onClick={() => { if (!playing && lap >= maxLap) r.setLap(1); setPlaying(!playing); }} title="Replay the race lap by lap">{playing ? "Pause" : "▶ Replay"}</button>
                {replaying && <button className="btn quiet shrink-0 !min-h-[30px] !px-3 !py-1" onClick={() => { setPlaying(false); setDrag(null); r.setLap(null); }} title="Jump to the newest lap">Latest</button>}
              </div>
              <label className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.12em] text-faint" title="Driver used by the strategy, weather and recommendation pages">Driver
                <select value={r.driver ?? ""} onChange={(e) => r.setDriver(Number(e.target.value))} aria-label="Focus driver" className="font-medium normal-case tracking-normal">
                  {(cmd?.rows || []).map((d: any) => <option key={d.driver_number} value={d.driver_number}>{d.code} · P{d.position}{d.team ? ` · ${d.team}` : ""}</option>)}
                </select></label>
              <label className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.12em] text-faint" title="Which lap to show when you open another section">
                <span className="hidden 2xl:inline">On page change</span><span className="2xl:hidden">Then</span>
                <select value={onNav} onChange={(e) => chooseNav(e.target.value as any)} aria-label="Lap to show when changing section" className="normal-case tracking-normal">
                  <option value="latest">Latest lap</option><option value="first">Lap 1</option><option value="keep">Keep my lap</option>
                </select>
              </label>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {replaying && <Pill colour="#b79cf0" title={`Every module shows only what was known at the end of lap ${lap}.`}>Replay · lap {lap}</Pill>}
                <Pill colour={mode[0]} title={cmd?.mode?.reason}>{mode[1]}</Pill>
                <Pill colour={st[1]}>{st[0]}</Pill>
              </div>
              </>)}
            </div>
            {r.alert && <div className="flex items-center gap-3 rounded-b-2xl border-t border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">{r.alert}<button className="btn ml-auto !py-1" onClick={r.clearAlert}>Dismiss</button></div>}
          </div>
        </header>
        <main id="main" key={path} className="page-in mx-auto max-w-[1560px] px-3 pb-10 pt-5 lg:pl-0 lg:pr-4">{children}</main>
      </div>
    </div>
  );
}
