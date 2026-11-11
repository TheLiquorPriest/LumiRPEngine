// `bun run build`: every bundle in dist/, stamped with one build id (DESIGN §23): the source
// commit's short SHA, marked when the sources have uncommitted changes (their code isn't the
// commit's, and the ledger's snapshots and the MCP servers' follow check key on the id), or the
// time when there is no git to ask. The agent kit is built first: its sha256 goes into the backend,
// which tells outside clients where the kit is and what it hashes to, and so do the fingerprints of
// its two tool lists (read-only and full), by which the backend knows whether Lumiverse's own MCP
// client holds this build's tools for a profile (Reconnect in Lumiverse).
//
// LumiAH is built into the extension (docs/HARNESS.md): its backend's code reaches dist/backend.js
// and its pages' dist/frontend.js through what the sources import from `lumi-ah`, stamped with this
// build's id as LumiAH's own build stamps them (`process.env.LAH_BUILD_ID`, replaced here so no
// bundle reads the environment), and its runtime is built from the package's own entry and shipped
// as dist/lumiah.js, with the same id, so the runtime and the backend it links to are one build.
// The backend bundle is then held to Lumiverse's install scan (`install-scan.ts`): a bundle the
// host would refuse to load fails the build here, with what it found and where.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { kitOf } from "../src/cli/kit-api";
import { toolsFingerprint } from "../src/shared/agents";
import { installScan } from "./install-scan";

const ROOT = resolve(import.meta.dir, "..");
const seconds = Math.floor(Date.now() / 1000);

function git(args: readonly string[]): string | null {
  const run = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
  return run.exitCode === 0 ? run.stdout.toString().trim() : null;
}

const sha = git(["rev-parse", "--short=8", "HEAD"]);
const dirty = sha !== null && (git(["status", "--porcelain", "--", "src", "docs", "schemas", "package.json", "bun.lock"]) ?? "") !== "";
const id = sha === null ? String(seconds) : dirty ? `${sha}-dirty.${seconds}` : sha;

function bundle(entry: string, out: string, target: "bun" | "node" | "browser", define: Record<string, string> = {}): void {
  const defines = Object.entries(define).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]);
  const run = Bun.spawnSync([process.execPath, "build", entry, "--outfile", out, "--target", target, ...defines], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) {
    console.error(`build: ${entry} failed`);
    process.exit(1);
  }
}

const stamp = { "process.env.LRE_BUILD_ID": id };
/** LumiAH's own stamp, in every bundle that carries its code. */
const harness = { "process.env.LAH_BUILD_ID": id };
bundle("src/cli/agent-kit.ts", "dist/agent-kit.js", "node", stamp);
const kitSha256 = createHash("sha256").update(readFileSync(join(ROOT, "dist/agent-kit.js"))).digest("hex");
// The bundle just built, not the sources: its lists are what a server answers tools/list with.
const built = kitOf(await import(join(ROOT, "dist/agent-kit.js")));
if (typeof built === "string") {
  console.error(`build: dist/agent-kit.js can't be loaded: ${built}`);
  process.exit(1);
}
// As Lumiverse's client keeps a listed tool (an absent description is "", an absent schema {}).
const listFingerprint = (readOnly: boolean): string => toolsFingerprint(built.tools(readOnly).map((t) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || {} })));
bundle("src/backend.ts", "dist/backend.js", "bun", { ...stamp, ...harness, "process.env.LRE_KIT_SHA256": kitSha256, "process.env.LRE_TOOLS_FULL": listFingerprint(false), "process.env.LRE_TOOLS_READ_ONLY": listFingerprint(true) });
const refused = installScan(readFileSync(join(ROOT, "dist/backend.js"), "utf8"));
if (refused.length > 0) {
  console.error(`build: Lumiverse's install scan would refuse dist/backend.js:\n${refused.map((hit) => `  ${hit.what}, near: ${hit.near}`).join("\n")}`);
  process.exit(1);
}
bundle("src/frontend.ts", "dist/frontend.js", "browser", { ...stamp, ...harness });
bundle("src/worker/background-lane.ts", "dist/worker/background-lane.js", "bun", stamp);
bundle("src/cli/main.ts", "dist/lumirpengine.js", "node", stamp);

// LumiAH's runtime, for the chats a user plays in a runtime beside Lumiverse: the package's own
// entry, built here so it carries this build's id. It must start under the Bun that built it. A
// `lumi-ah` that ships no runtime entry has none to build, and the build says so.
const RUNTIME_ENTRY = "node_modules/lumi-ah/src/runtime/main.ts";
if (existsSync(join(ROOT, RUNTIME_ENTRY))) {
  bundle(RUNTIME_ENTRY, "dist/lumiah.js", "bun", harness);
  if (Bun.spawnSync([process.execPath, "dist/lumiah.js", "--version"], { cwd: ROOT, stdout: "ignore", stderr: "inherit" }).exitCode !== 0) {
    console.error("build: dist/lumiah.js --version failed");
    process.exit(1);
  }
} else console.log(`build: the installed lumi-ah has no ${RUNTIME_ENTRY.slice("node_modules/lumi-ah/".length)}, so dist/lumiah.js isn't built`);

// The command line runs under Bun 1.4+ or Node 22+: it must start under the Bun building it, and
// under Node too where there is one (a machine with only Bun, as Lumiverse's own can be, has none).
const runtimes = [process.execPath, Bun.which("node")].filter((runtime): runtime is string => runtime !== null);
const versions = runtimes.map((runtime) => {
  const run = Bun.spawnSync([runtime, "dist/lumirpengine.js", "--version"], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  if (run.exitCode !== 0) {
    console.error(`build: dist/lumirpengine.js --version failed under ${runtime}`);
    process.exit(1);
  }
  return run.stdout.toString().trim();
});
console.log(`${versions[0]}\nagent kit sha256 ${kitSha256}`);
