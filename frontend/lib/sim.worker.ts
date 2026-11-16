// Runs Simulation Lab scenarios off the main thread so the page stays responsive.
import { runLab, type Job } from "./sim";

addEventListener("message", (e: MessageEvent<{ jobs: Job[]; note: string }>) => {
  try {
    (self as any).postMessage({ ok: true, res: runLab(e.data.jobs, e.data.note) });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String(err) });
  }
});
