// Runs one simulation package off the main thread. The page starts several of these so the options of a
// comparison are simulated in parallel.
import { runPackage, type Package } from "./sim";

addEventListener("message", (e: MessageEvent<{ id: number; package: Package }>) => {
  try {
    (self as any).postMessage({ id: e.data.id, ok: true, res: runPackage(e.data.package) });
  } catch (err) {
    (self as any).postMessage({ id: e.data.id, ok: false, error: String(err) });
  }
});
