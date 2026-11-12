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
// bundle reads the environment). Its runtime is built from the package's own entry and shipped as
// dist/lumiah.js, with the same id, so the runtime and the backend it links to are one build. The
// runtime is built before the backend, as LumiAH's own build does it: its sha256 and size go into
// dist/runtime.json and into the backend (`process.env.LAH_RUNTIME_SHA256`, `LAH_RUNTIME_SIZE`),
// which offers a runtime on another build this file as its update, so a runtime started for
// LumiRPEngine updates itself from LumiRPEngine's own dist/lumiah.js. Nothing of the runtime's side
// (its model layer, its store, its disk and network) reaches the backend: the backend bundle is
// held to Lumiverse's install scan (`install-scan.ts`), and a bundle the host would refuse to load
// fails the build here, with what it found and where.
//
// A bundle holds the same code wherever it is built: each bundle's inputs are listed (Bun's
// metafile), and the build fails, naming the file, when one lies outside this repository (Bun takes
// a package it doesn't find inside the repository from any `node_modules` above it, such as that of
// a Lumiverse checkout the repository sits in). What every bundle leaves out on purpose (`LEFT_OUT`)
// and the flags the runtime's bundle needs to hold working code (`RUNTIME_FLAGS`) are LumiAH's own,
// read from its `scripts/bundle-flags.ts`, where each says why: this build makes the runtime as
// LumiAH's makes it, and they are written in one place.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { kitOf } from "../src/cli/kit-api";
import { toolsFingerprint } from "../src/shared/agents";
import { LEFT_OUT, RUNTIME_FLAGS } from "../node_modules/lumi-ah/scripts/bundle-flags";
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

/** The metafiles, which no bundle keeps: removed however the build ends, a failure, a thrown error and a signal included. */
const scratch = mkdtempSync(join(tmpdir(), "lre-build-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(1));

function fail(words: string): never {
  console.error(`build: ${words}`);
  process.exit(1);
}

/** Bundles `entry` to `out` with `flags`, with each of `define` replaced into it, and fails if it took a file from outside the repository. */
function bundle(entry: string, out: string, target: "bun" | "node" | "browser", define: Record<string, string> = {}, flags: readonly string[] = []): void {
  const defines = Object.entries(define).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]);
  const left = LEFT_OUT.flatMap((name) => ["--external", name]);
  const meta = join(scratch, `${basename(out)}.json`);
  const run = Bun.spawnSync([process.execPath, "build", entry, "--outfile", out, "--target", target, ...flags, ...left, `--metafile=${meta}`, ...defines], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) fail(`${entry} failed`);
  const inputs: unknown = JSON.parse(readFileSync(meta, "utf8")).inputs;
  if (typeof inputs !== "object" || inputs === null) fail(`Bun's metafile for ${out} lists no inputs`);
  // Each input is named by its path from the repository's root.
  const outside = Object.keys(inputs).filter((path) => {
    const from = relative(ROOT, resolve(ROOT, path));
    return from.startsWith("..") || isAbsolute(from);
  });
  if (outside.length > 0) fail(`${out} took ${outside.map((path) => resolve(ROOT, path)).join(", ")} from outside the repository: install it here, or have LumiAH leave it out on purpose in its LEFT_OUT (its scripts/bundle-flags.ts) if nothing needs it.`);
}

const stamp = { "process.env.LRE_BUILD_ID": id };
/** LumiAH's own stamp, in every bundle that carries its code. */
const harness = { "process.env.LAH_BUILD_ID": id };

// LumiAH's runtime, which plays every chat the harness answers, beside Lumiverse: the package's own
// entry, built first so it carries this build's id and the backend can name it, and with LumiAH's
// `RUNTIME_FLAGS` (without them the end of every agent's session threw on a runtime that had called
// no Anthropic model). It must start under the Bun that built it. The harness answers no chat without
// it, so a `lumi-ah` that ships no runtime entry fails the build.
const RUNTIME_ENTRY = "node_modules/lumi-ah/src/runtime/main.ts";
if (!existsSync(join(ROOT, RUNTIME_ENTRY))) fail(`the installed lumi-ah has no ${RUNTIME_ENTRY.slice("node_modules/lumi-ah/".length)}, and the harness answers no chat without its runtime`);
bundle(RUNTIME_ENTRY, "dist/lumiah.js", "bun", harness, RUNTIME_FLAGS);
if (Bun.spawnSync([process.execPath, "dist/lumiah.js", "--version"], { cwd: ROOT, stdout: "ignore", stderr: "inherit" }).exitCode !== 0) fail("dist/lumiah.js --version failed");
// The runtime the backend offers a runtime on another build as its update, by its hash and size, as LumiAH's own build writes them.
const lumiah = readFileSync(join(ROOT, "dist/lumiah.js"));
const shipped = { build: id, file: "lumiah.js", sha256: createHash("sha256").update(lumiah).digest("hex"), size: lumiah.length };
writeFileSync(join(ROOT, "dist/runtime.json"), `${JSON.stringify(shipped, null, 2)}\n`);

bundle("src/cli/agent-kit.ts", "dist/agent-kit.js", "node", stamp);
const kitSha256 = createHash("sha256").update(readFileSync(join(ROOT, "dist/agent-kit.js"))).digest("hex");
// The bundle just built, not the sources: its lists are what a server answers tools/list with.
const built = kitOf(await import(join(ROOT, "dist/agent-kit.js")));
if (typeof built === "string") fail(`dist/agent-kit.js can't be loaded: ${built}`);
// As Lumiverse's client keeps a listed tool (an absent description is "", an absent schema {}).
const listFingerprint = (readOnly: boolean): string => toolsFingerprint(built.tools(readOnly).map((t) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || {} })));
bundle("src/backend.ts", "dist/backend.js", "bun", {
  ...stamp,
  ...harness,
  "process.env.LAH_RUNTIME_SHA256": shipped.sha256,
  "process.env.LAH_RUNTIME_SIZE": String(shipped.size),
  "process.env.LRE_KIT_SHA256": kitSha256,
  "process.env.LRE_TOOLS_FULL": listFingerprint(false),
  "process.env.LRE_TOOLS_READ_ONLY": listFingerprint(true),
});
const refused = installScan(readFileSync(join(ROOT, "dist/backend.js"), "utf8"));
if (refused.length > 0) fail(`Lumiverse's install scan would refuse dist/backend.js:\n${refused.map((hit) => `  ${hit.what}, near: ${hit.near}`).join("\n")}`);
bundle("src/frontend.ts", "dist/frontend.js", "browser", { ...stamp, ...harness });
bundle("src/worker/background-lane.ts", "dist/worker/background-lane.js", "bun", stamp);
bundle("src/cli/main.ts", "dist/lumirpengine.js", "node", stamp);

// The command line runs under Bun 1.4+ or Node 22+: it must start under the Bun building it, and
// under Node too where there is one (a machine with only Bun, as Lumiverse's own can be, has none).
const runtimes = [process.execPath, Bun.which("node")].filter((runtime): runtime is string => runtime !== null);
const versions = runtimes.map((runtime) => {
  const run = Bun.spawnSync([runtime, "dist/lumirpengine.js", "--version"], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  if (run.exitCode !== 0) fail(`dist/lumirpengine.js --version failed under ${runtime}`);
  return run.stdout.toString().trim();
});
console.log(`${versions[0]}\nagent kit sha256 ${kitSha256}\nruntime ${shipped.sha256} (${shipped.size} bytes)`);
