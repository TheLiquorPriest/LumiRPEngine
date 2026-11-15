// RPE's web app, built from the sources as they stand (PlanScenarios-2 item 1): the rig serves what a
// build of today's `src/ui` makes, never a `dist/ui` left from an older build, so a page the rig shows
// is the page the tree holds. The build is the one `scripts/build.ts` makes of the web shell (Bun
// bundles `src/ui/index.html` with the script it loads); it is made once for the process, in a folder
// under the system's temporary one, and the folder goes when the process ends.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");

let built: Promise<string> | null = null;

/** The folder of the built web app (`index.html` and its script), made on the first call. */
export function builtUi(): Promise<string> {
  built ??= (async () => {
    const out = mkdtempSync(join(tmpdir(), "rpe-rig-ui-"));
    process.on("exit", () => rmSync(out, { recursive: true, force: true }));
    const result = await Bun.build({ entrypoints: [join(ROOT, "src/ui/index.html")], outdir: out, target: "browser", define: { "process.env.LRE_BUILD_ID": JSON.stringify("rig") }, throw: false });
    if (!result.success) {
      rmSync(out, { recursive: true, force: true });
      throw new Error(`the web app did not build for the rig:\n${result.logs.map((log) => `  ${String(log)}`).join("\n")}`);
    }
    if (!result.outputs.some((output) => output.path === join(out, "index.html"))) throw new Error("the web app came out without an index.html");
    return out;
  })();
  built.catch(() => {
    built = null;
  });
  return built;
}
