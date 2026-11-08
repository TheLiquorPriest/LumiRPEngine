// The SSE contract test (loopback-sse.test.ts) runs the loopback relay's answers through a vendored copy of
// Lumiverse's SSE reader under test/cli/core-staging/, taken at origin/staging 8e0f3945. This test fails when
// core's reader has moved since, so the contract is re-run against the reader core actually ships.
// LRE_CORE_DIR names the Lumiverse checkout (default: the nearest enclosing one); LRE_CORE_REF the ref to compare
// (default origin/staging). With no checkout or no such ref it skips and says why.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const VENDORED_AT = "8e0f3945";
const STAGING = join(import.meta.dir, "core-staging");
const REF = process.env.LRE_CORE_REF || "origin/staging";

// Blob ids of the files vendored in part, as of 8e0f3945.
const PARTIAL: Record<string, string> = {
  "src/llm/stream-utils.ts": "ef79e32229dcd709cd5be84bf19ec08334ea6b31",
  "src/utils/provider-errors.ts": "b289475396bf5842760fc27d4a684175245f685a",
  "src/llm/providers/openai-compatible.ts": "cd75fd1e2cbaa5b4fdd72a8d4b29a92d75bfd3c1",
  "src/llm/generation-stop.ts": "91f3196ee9e7b35012e02b4b5fb8f5e446d59b39",
};

function findCore(): string | null {
  const fromEnv = process.env.LRE_CORE_DIR;
  if (fromEnv) return existsSync(join(fromEnv, ".git")) && existsSync(join(fromEnv, "src/llm")) ? resolve(fromEnv) : null;
  let dir = resolve(import.meta.dir, "..", "..");
  for (;;) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "src/llm"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function git(core: string, ...args: string[]): { ok: boolean; out: Uint8Array } {
  const r = Bun.spawnSync(["git", "-C", core, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout };
}

const core = findCore();
const refOk = core !== null && git(core, "rev-parse", "--verify", "--quiet", `${REF}^{commit}`).ok;
const skipReason = core === null
  ? "no Lumiverse core checkout found (set LRE_CORE_DIR)"
  : !refOk ? `ref ${REF} not found in ${core} (set LRE_CORE_REF or fetch)` : "";
if (skipReason) console.warn(`core-sse-drift skipped: ${skipReason}`);

const drift = (path: string) =>
  `core's SSE reader changed since ${VENDORED_AT} (${path} at ${REF}); re-vendor test/cli/core-staging and re-run loopback-sse`;

describe(`core SSE reader at ${REF} matches the copy vendored at ${VENDORED_AT}`, () => {
  test.skipIf(!!skipReason)("src/llm/provider-sse.ts is byte for byte the vendored copy minus its header", () => {
    const shown = git(core!, "show", `${REF}:src/llm/provider-sse.ts`);
    expect(shown.ok, drift("src/llm/provider-sse.ts")).toBe(true);
    const vendored = readFileSync(join(STAGING, "llm/provider-sse.ts"));
    let at = 0;
    for (let n = 0; n < 2; n++) at = vendored.indexOf(0x0a, at) + 1;
    const same = Buffer.compare(Buffer.from(shown.out), vendored.subarray(at)) === 0;
    if (!same) throw new Error(drift("src/llm/provider-sse.ts"));
  });

  for (const [path, blob] of Object.entries(PARTIAL)) {
    test.skipIf(!!skipReason)(`${path} is unchanged`, () => {
      const id = git(core!, "rev-parse", `${REF}:${path}`);
      const now = new TextDecoder().decode(id.out).trim();
      if (!id.ok || now !== blob) throw new Error(drift(path));
    });
  }
});
