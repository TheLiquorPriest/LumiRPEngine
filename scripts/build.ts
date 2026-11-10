// `bun run build`: every bundle in dist/, stamped with one build id (DESIGN §23): the source
// commit's short SHA, marked when the sources have uncommitted changes (their code isn't the
// commit's, and the ledger's snapshots and the MCP servers' follow check key on the id), or the
// time when there is no git to ask. The agent kit is built first: its sha256 goes into the backend,
// which tells outside clients where the kit is and what it hashes to, and so do the fingerprints of
// its two tool lists (read-only and full), by which the backend knows whether Lumiverse's own MCP
// client holds this build's tools for a profile (Reconnect in Lumiverse).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { kitOf } from "../src/cli/kit-api";
import { toolsFingerprint } from "../src/shared/agents";

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
bundle("src/backend.ts", "dist/backend.js", "bun", { ...stamp, "process.env.LRE_KIT_SHA256": kitSha256, "process.env.LRE_TOOLS_FULL": listFingerprint(false), "process.env.LRE_TOOLS_READ_ONLY": listFingerprint(true) });
bundle("src/frontend.ts", "dist/frontend.js", "browser", stamp);
bundle("src/worker/background-lane.ts", "dist/worker/background-lane.js", "bun", stamp);
bundle("src/cli/main.ts", "dist/lumirpengine.js", "node", stamp);

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
