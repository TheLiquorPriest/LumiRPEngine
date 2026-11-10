// Agent kits as an extension's build writes them (DESIGN §23), for the tests that follow one, and
// following's side of the disk as the entry's: symlinks resolved, owners as the files say.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { KitFiles } from "../../src/cli/follow";
import type { KitReport } from "../../src/shared/agents";

/** An installed extension's dist/ under a Lumiverse data dir at `root/name`. */
export const distOf = (root: string, name: string): string => join(root, name, "data/extensions/lumi_rp_engine/repo/dist");

/**
 * A kit of build `build` in `dir`, offering the tools named (each answers "<name> answered by build
 * <build>"), with `pad` more bytes of comment to make it the size of a real one; and its report. The
 * directories it makes and the file are writable by their owner only, whatever the umask.
 */
export function writeKit(dir: string, build: string, tools: string[], pad = 0): KitReport {
  const names = JSON.stringify(tools);
  const text = `export const kit = { api: 1, build: ${JSON.stringify(build)}, versions: { cli: "0.0.1", engine: "9.9.9", worldFormat: "lre-world-v1", agentApi: 1 },
  tools: () => ${names}.map((name) => ({ name, description: "from build ${build}", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } })),
  has: (name) => ${names}.includes(name),
  call: async (name) => ({ text: name + " answered by build ${build}" }) };\n${pad > 0 ? `// ${"x".repeat(pad)}\n` : ""}`;
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const path = join(dir, "agent-kit.js");
  writeFileSync(path, text, { mode: 0o644 });
  return { path, sha256: createHash("sha256").update(text).digest("hex"), api: 1, core: join(dir, "lumirpengine.js") };
}

export const disk: KitFiles = {
  realpath: (path) => realpath(path),
  async stat(path) {
    const entry = await lstat(path);
    return { uid: entry.uid, mode: entry.mode };
  },
  async read(path) {
    const entry = await stat(path);
    return { uid: entry.uid, mode: entry.mode, bytes: await readFile(path) };
  },
  uid: process.getuid?.() ?? null,
};
