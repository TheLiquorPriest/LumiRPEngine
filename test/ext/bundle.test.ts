// The extension's backend, bundled as Lumiverse loads it, passes the install scan (`scripts/install-scan.ts`,
// stricter than Lumiverse's own): no global fetch, no `node:` imports, no reads of the process's
// environment. A bundle that reached for any of them would be refused at install.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { installScan } from "../../scripts/install-scan";

test("the backend bundle passes the install scan", async () => {
  // Bundled as the build bundles it (scripts/build.ts), its build id and its app file's stated hash stamped in, and nothing more: any other read of the environment still fails the scan.
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../../src/ext/backend.ts")], target: "bun", format: "esm", define: { "process.env.LRE_BUILD_ID": JSON.stringify("test"), "process.env.RPE_STATED_HASH": JSON.stringify("0".repeat(64)) } });
  expect(built.success).toBe(true);
  expect(built.outputs).toHaveLength(1);
  const js = await built.outputs[0]!.text();
  // The bundle is the extension, not an empty file that passes by saying nothing.
  expect(js).toContain("registerInterceptor");
  expect(installScan(js)).toEqual([]);
});

// The version of Spindle's types Lumiverse staging pins (its `package.json` and `frontend/package.json`); move it with the host.
const HOST_SPINDLE_TYPES = "0.6.80";

test("the extension is typed against the host's version of Spindle's types", async () => {
  const root = join(import.meta.dir, "../..");
  const pinned = (await Bun.file(join(root, "package.json")).json()).devDependencies["lumiverse-spindle-types"];
  const installed = (await Bun.file(join(root, "node_modules/lumiverse-spindle-types/package.json")).json()).version;
  expect(pinned).toBe(HOST_SPINDLE_TYPES);
  expect(installed).toBe(HOST_SPINDLE_TYPES);
});
