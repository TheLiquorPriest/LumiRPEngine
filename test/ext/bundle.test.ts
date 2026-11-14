// The extension's backend, bundled as Lumiverse loads it, passes the install scan (`scripts/install-scan.ts`,
// stricter than Lumiverse's own): no global fetch, no `node:` imports, no reads of the process's
// environment. A bundle that reached for any of them would be refused at install.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { installScan } from "../../scripts/install-scan";

test("the backend bundle passes the install scan", async () => {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../../src/ext/backend.ts")], target: "bun", format: "esm" });
  expect(built.success).toBe(true);
  expect(built.outputs).toHaveLength(1);
  const js = await built.outputs[0]!.text();
  // The bundle is the extension, not an empty file that passes by saying nothing.
  expect(js).toContain("registerInterceptor");
  expect(installScan(js)).toEqual([]);
});
