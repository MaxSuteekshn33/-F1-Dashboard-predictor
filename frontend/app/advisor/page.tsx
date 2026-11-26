"use client";
import { api, useApi, useRace } from "@/lib/api";
import { useResolved } from "@/lib/browserSim";
import { Confidence, Notes, Panel, State, Tag, pct, signed } from "@/components/ui";

const TYPE: Record<string, string> = { WEATHER: "#3d8bf2", "SAFETY CAR": "#e0a100", "PIT WINDOW": "#2fbf71", "TRACK POSITION": "#2fbf71", UNDERCUT: "#c084fc", "DEFEND UNDERCUT": "#c084fc", STRATEGY: "#f2f3f5", "TYRE LIFE": "#ff5a52", DATA: "#a3a8b3" };
const ORDER: Record<string, number> = { "SAFETY CAR": 0, WEATHER: 1, "PIT WINDOW": 2, "TRACK POSITION": 2, UNDERCUT: 3, "DEFEND UNDERCUT": 3, STRATEGY: 4, "TYRE LIFE": 5, DATA: 6 };
const tagOf = (s: string) => (s.split(" · ")[0] || "").trim();

function Pending({ label }: { label: string }) {
  return (
    <div className="glass rounded-2xl px-5 py-4" role="status" aria-label={label}>
      <div className="mb-3 text-[13px] text-dim">{label}</div>
      <div className="space-y-2.5"><div className="skeleton h-4 w-2/5" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-3/4" /></div>
    </div>
  );
}

export default function Advisor() {
  const r = useRace();
  // Three independent requests, lightest first, so each card appears as soon as its own analysis is done.
  const base = r.sessionKey && r.driver ? `/api/advisor?${r.q}&driver=${r.driver}` : null;
  const ex = useApi<any>(base && `${base}&parts=explain`, r.tick);
  const wx = useApi<any>(base && `${base}&parts=weather`, r.tick);
  // Strategy cards: a stored answer comes back whole; otherwise the server sends the facts and this browser runs the simulations.
  const stRaw = useApi<any>(base && `${base}&parts=strategy&defer=1`, r.tick);
  const stDone = useResolved<any>(stRaw.data, () => api(`${base}&parts=strategy`));
  const st = { ...stRaw, data: stDone.data, error: stRaw.error || stDone.error, loading: stRaw.loading || stDone.simulating };
  const any = ex.data || wx.data || st.data;
  const note = any?.note;
  const recs = [...(wx.data?.recommendations || []), ...(st.data?.recommendations || [])].sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  const settled = (x: any) => x.data || x.error;
  const allDone = settled(wx) && settled(st);
  const busy = ex.loading || wx.loading || st.loading;
  const explain = ex.data?.win_explanation;
  const max = explain ? Math.max(...explain.factors.map((x: any) => Math.abs(x.shap)), 0.01) : 1;
  const omitted = [...(wx.data?.omitted || []), ...(st.data?.omitted || [])];
  if (!any && !ex.error && !wx.error && !st.error) return <State loading />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Race engineer brief — {any?.focus_code ?? "—"}</h1>
        {any && <span className="text-[13px] text-dim">lap {any.lap} of {any.total_laps}</span>}
        {busy && any && <span className="inline-flex items-center gap-1.5 text-[13px] text-faint"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b79cf0]" />updating</span>}
      </div>
      {note && <State empty={note} />}
      <div className={`grid gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] ${ex.stale || wx.stale || st.stale ? "is-stale" : ""}`} aria-busy={ex.stale || wx.stale || st.stale}>
        <div className="space-y-3">
          {recs.map((x: any, i: number) => (
            <article key={`${x.type}-${i}`} className="glass page-in overflow-hidden rounded-2xl">
              <header className="flex flex-wrap items-center gap-3 px-5 pb-1 pt-4">
                <span className="rounded-full border px-2 py-[2px] text-[11px] font-bold" style={{ borderColor: TYPE[x.type] || "#6b717d", color: TYPE[x.type] || "#a3a8b3" }}>{x.type}</span>
                <h2 className="text-sm font-semibold">{x.title}</h2><span className="ml-auto"><Confidence c={x.confidence} /></span>
              </header>
              <div className="grid gap-4 px-5 pb-5 pt-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div><div className="text-[12px] text-faint">Situation detected</div><p className="mt-0.5 prose-body">{x.situation}</p></div>
                  <div><div className="text-[12px] text-faint">Supporting data</div>
                    <ul className="mt-1 space-y-1 text-[13px] text-dim">{x.supporting.map((s: string, k: number) => <li key={k} className="flex gap-2"><span className="shrink-0"><Tag kind={tagOf(s)} /></span><span>{s.split(" · ").slice(1).join(" · ")}</span></li>)}</ul></div>
                </div>
                <div className="space-y-2">
                  <div className="rounded-xl border border-good/40 bg-good/10 px-3 py-2"><div className="text-[12px] text-good">Recommended decision</div><div className="mt-0.5 text-sm font-semibold">{x.decision}</div></div>
                  <div className="grid grid-cols-2 gap-2 text-[13px]">
                    <div className="rounded-xl border border-line bg-panel2 px-2.5 py-1.5"><div className="text-[12px] text-faint">Expected advantage</div><div className="mt-0.5 text-dim">{x.advantage}</div></div>
                    <div className="rounded-xl border border-line bg-panel2 px-2.5 py-1.5"><div className="text-[12px] text-faint">Risk</div><div className="mt-0.5 text-dim">{x.risk}</div></div>
                  </div>
                </div>
              </div>
            </article>
          ))}
          {!note && !wx.data && !wx.error && <Pending label="Checking the weather and tyre-class timing…" />}
          {!note && !st.data && !st.error && <Pending label="Running strategy simulations (the slowest part)…" />}
          {wx.error && <State error={`Weather analysis: ${wx.error}`} />}
          {st.error && <State error={`Strategy analysis: ${st.error}`} />}
          {allDone && !note && recs.length === 0 && !wx.error && !st.error && <State empty="No actionable situation detected at this lap for this driver." />}
        </div>
        <div className="space-y-5">
          <Panel title={`Why this win probability — ${any?.focus_code ?? ""}`} tags={["MODEL"]} note={explain?.note}>
            {explain ? (<>
              <div className="num mb-3 text-2xl font-semibold">{pct(explain.p_win_ml)}<span className="ml-2 text-[13px] font-normal text-faint">in-race model</span></div>
              <div className="space-y-2">{explain.factors.map((f: any, i: number) => (
                <div key={i} className="text-[13px]"><div className="flex justify-between text-dim"><span>{f.label}{f.value !== null && <span className="num text-faint"> = {f.value}</span>}</span><span className="num">{signed(f.shap, 2)}</span></div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-white/[0.08]"><div className="absolute top-0 h-1.5 rounded-full" style={{ left: f.shap >= 0 ? "50%" : `${50 - (Math.abs(f.shap) / max) * 50}%`, width: `${(Math.abs(f.shap) / max) * 50}%`, background: f.shap >= 0 ? "#3987e5" : "#d95926" }} /></div></div>))}</div>
              <div className="mt-3 text-[12px] text-faint">Blue pushes the probability up, orange down.</div>
            </>) : <State loading={!ex.data && !ex.error} error={ex.error} empty={ex.data ? "Shown while a race is in progress and the in-race model is trained." : null} />}
          </Panel>
          <Notes title="Guardrails" items={[any?.guardrails, ...omitted, "This assistant is rule-based over the platform's own calculations; it does not use a language model and cannot answer free-text questions."]} />
        </div>
      </div>
    </div>
  );
}
