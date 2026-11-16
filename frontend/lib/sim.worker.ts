// Runs simulations off the main thread so the page stays responsive.
import { finishDeferred, runLab, type Job } from "./sim";

addEventListener("message", (e: MessageEvent<{ jobs?: Job[]; note?: string; deferred?: any }>) => {
  try {
    const res = e.data.deferred ? finishDeferred(e.data.deferred) : runLab(e.data.jobs || [], e.data.note || "");
    (self as any).postMessage({ ok: true, res });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String(err) });
  }
});
