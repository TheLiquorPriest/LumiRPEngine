// RPE's web app, built from the sources as they stand (PlanScenarios-2 item 1): the rig serves what a
// build of today's `src/ui` makes, never a `dist/ui` left from an older build, so a page the rig shows
// is the page the tree holds. The build is the one `scripts/build.ts` makes of the web shell (Bun
// bundles `src/ui/index.html` with the script it loads); it is made once while it is wanted, in a folder
// under the system's temporary one, and whoever asked for it gives it back with `releaseUi` when it is done
// (a process's exit handler is not run by every runner, so the folder never waits on one).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");

let built: Promise<string> | null = null;

/** The folder of the built web app (`index.html` and its script), made on the first call after it was last released. */
export function builtUi(): Promise<string> {
  built ??= (async () => {
    const out = mkdtempSync(join(tmpdir(), "rpe-rig-ui-"));
    const result = await Bun.build({ entrypoints: [join(ROOT, "src/ui/index.html")], outdir: out, target: "browser", define: { "process.env.LRE_BUILD_ID": JSON.stringify("rig") }, throw: false });
    if (!result.success || !result.outputs.some((output) => output.path === join(out, "index.html"))) {
      rmSync(out, { recursive: true, force: true });
      throw new Error(result.success ? "the web app came out without an index.html" : `the web app did not build for the rig:\n${result.logs.map((log) => `  ${String(log)}`).join("\n")}`);
    }
    return out;
  })();
  built.catch(() => {
    built = null;
  });
  return built;
}

/** Gives the built web app's folder back: removed, and made again by the next `builtUi`. A build that never finished leaves nothing to remove. */
export async function releaseUi(): Promise<void> {
  const held = built;
  built = null;
  if (held === null) return;
  const out = await held.catch(() => null);
  if (out !== null) rmSync(out, { recursive: true, force: true });
}
