"use client";
import React from "react";

// Chart palette: categorical slots validated for the dark surface (dataviz reference palette, fixed order).
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
export const GRID = "rgba(255,255,255,0.07)";
export const COMPOUND: Record<string, { c: string; l: string }> = {
  SOFT: { c: "#ff4b3e", l: "S" }, MEDIUM: { c: "#f2c230", l: "M" }, HARD: { c: "#e9eaec", l: "H" },
  INTERMEDIATE: { c: "#3dbb61", l: "I" }, WET: { c: "#3d8bf2", l: "W" },
};
export const teamColour = (c?: string | null) => (c ? `#${c.replace("#", "")}` : "#6b717d");

export function fmtLap(s?: number | null): string {
  if (s === null || s === undefined || !isFinite(s)) return "—";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(3).padStart(6, "0")}` : r.toFixed(3);
}
export const fmtDur = (s?: number | null) => {
  if (s === null || s === undefined) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
};
export const pct = (p?: number | null, d = 1) => (p === null || p === undefined ? "—" : `${(p * 100).toFixed(p >= 0.995 || p < 0.0005 ? 0 : d)}%`);
export const num = (v?: number | null, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(d));
export const signed = (v?: number | null, d = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);
export const ago = (ts?: number | null) => {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
export const dt = (ts?: number | null) => (ts ? new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");

const TAGS: Record<string, string> = {
  OBSERVED: "#7fb6f5", HISTORICAL: "#d9b95a", MODEL: "#b79cf0", ASSUMPTION: "#f09a94", FORECAST: "#6fd3b8", UNAVAILABLE: "#7c8290",
};
const TAG_HELP: Record<string, string> = { OBSERVED: "Recorded data from a provider", HISTORICAL: "Estimate from past races", MODEL: "Model prediction",
  ASSUMPTION: "Scenario or modelling assumption", FORECAST: "Weather-model forecast, not a track measurement" };
/** Provenance label: where a number comes from. Quiet by design — a coloured dot and a small word. */
export function Tag({ kind, children }: { kind: string; children?: React.ReactNode }) {
  const c = TAGS[kind] || TAGS.UNAVAILABLE;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[.12em]" style={{ color: c }} title={TAG_HELP[kind] || ""}>
    <span className="h-2 w-[3px] -skew-x-12" style={{ background: c }} />{children || kind}</span>;
}

export function Panel({ title, tags, right, children, className = "", note, pad = true }:
  { title?: React.ReactNode; tags?: string[]; right?: React.ReactNode; children: React.ReactNode; className?: string; note?: React.ReactNode; pad?: boolean }) {
  return (
    <section className={`glass overflow-hidden ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-3 pt-4">
          <h2 className="text-[14px] font-bold tracking-[-.005em] text-ink">{title}</h2>
          {tags?.map((t) => <Tag key={t} kind={t} />)}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-dim">{right}</div>
        </header>
      )}
      <div className={pad ? `px-5 pb-5 ${title || right ? "" : "pt-5"}` : ""}>{children}</div>
      {note && (
        <details className="more border-t border-line px-5 py-2.5">
          <summary>How to read this</summary>
          <div className="pb-1 pt-2 text-[11.5px] leading-relaxed text-dim">{note}</div>
        </details>
      )}
    </section>
  );
}

export function Stat({ label, value, sub, tag, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tag?: string; accent?: string }) {
  return (
    <div className="glass px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 text-[10.5px] font-bold uppercase tracking-[.12em] text-faint"><span className="truncate">{label}</span>
        {tag && <span className="h-2.5 w-[3px] shrink-0 -skew-x-12" style={{ background: TAGS[tag] || TAGS.UNAVAILABLE }} title={`${tag} — ${TAG_HELP[tag] || ""}`} />}</div>
      <div className="mt-2 font-display text-[29px] font-semibold leading-none tracking-[.01em] [font-variant-numeric:tabular-nums]" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-[11px] text-dim" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
    </div>
  );
}

/** Segmented tab bar: splits a long page into a few calm views (keyboard: arrow keys). */
export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  const move = (d: number) => { const i = tabs.findIndex((t) => t[0] === value); onChange(tabs[(i + d + tabs.length) % tabs.length][0]); };
  return (
    <div role="tablist" className="inline-flex max-w-full gap-5 overflow-x-auto border-b border-white/10"
      onKeyDown={(e) => { if (e.key === "ArrowRight") move(1); if (e.key === "ArrowLeft") move(-1); }}>
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} tabIndex={value === k ? 0 : -1} onClick={() => onChange(k)}
          className={`-mb-px whitespace-nowrap border-b-[3px] px-0.5 pb-2 pt-1 text-[13px] font-bold transition-colors duration-200 ${value === k ? "border-f1 text-ink" : "border-transparent text-faint hover:border-white/30 hover:text-ink"}`}>{label}</button>
      ))}
    </div>
  );
}

export function Tyre({ compound, age }: { compound?: string | null; age?: number | null }) {
  if (!compound) return <span className="text-faint">—</span>;
  const c = COMPOUND[compound] || { c: "#6b717d", l: "?" };
  return (
    <span className="inline-flex items-center gap-1.5" title={compound}>
      <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] text-[9px] font-bold" style={{ borderColor: c.c, color: c.c, background: `${c.c}14` }}>{c.l}</span>
      {age !== undefined && age !== null && <span className="num text-dim">{age}</span>}
    </span>
  );
}

export function Driver({ code, colour, name }: { code?: string | null; colour?: string | null; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2" title={name}>
      <span className="inline-block h-4 w-[4px] -skew-x-12" style={{ background: teamColour(colour) }} />
      <span className="font-bold tracking-[.04em]">{code || "—"}</span>
    </span>
  );
}

export function Bar({ value, max = 1, colour = SERIES[0], label }: { value: number; max?: number; colour?: string; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 bg-white/[0.08]"><div className="h-1.5" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: colour }} /></div>
      {label && <span className="num w-12 text-right text-[11px]">{label}</span>}
    </div>
  );
}

export function State({ loading, error, empty, children }: { loading?: boolean; error?: string | null; empty?: string | null; children?: React.ReactNode }) {
  if (error) return <div className="border-l-[3px] border-bad bg-bad/10 px-4 py-3 text-xs text-[#ffb3ae]"><b>Unavailable.</b> {error}</div>;
  if (empty) return <div className="border-l-[3px] border-white/25 bg-white/[0.04] px-4 py-3 text-xs text-dim">{empty}</div>;
  if (loading && !children) return (
    <div className="space-y-2.5 py-3" aria-label="Loading" role="status">
      <div className="skeleton h-4 w-1/3" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-4 w-2/3" />
    </div>);
  return <>{children}</>;
}

export function Notes({ items, title = "Limitations" }: { items?: (string | null | undefined)[]; title?: string }) {
  const list = (items || []).filter(Boolean) as string[];
  if (!list.length) return null;
  return (
    <details className="more glass px-5 py-3">
      <summary>{title} <span className="num text-faint">({list.length})</span></summary>
      <ul className="space-y-1 pb-1 pt-2.5 text-[11.5px] leading-relaxed text-dim">{list.map((x, i) => <li key={i} className="flex gap-2"><span className="text-faint">–</span><span>{x}</span></li>)}</ul>
    </details>
  );
}

export function ChartTip({ active, payload, label, fmt, title }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong px-3 py-2 text-[11px]">
      <div className="mb-0.5 text-faint">{title ? title(label) : label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-dim">{p.name}</span><span className="num ml-auto pl-3 text-ink">{fmt ? fmt(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Confidence({ c }: { c?: { score: number; level: string } | null }) {
  if (!c) return null;
  const col = c.level === "HIGH" ? "#2fbf71" : c.level === "MEDIUM" ? "#e0a100" : "#a3a8b3";
  return <span className="inline-flex items-center gap-1.5 text-[11px]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
    <span style={{ color: col }} className="font-semibold">{c.level}</span><span className="num text-faint">{(c.score * 100).toFixed(0)}%</span></span>;
}
