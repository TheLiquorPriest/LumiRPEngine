// The record of a proof run, in one home (PlanGates-4 item 1; the lead's ruling). The runner's
// `run.json` (PlanScenarios-1, `scripts/proof/route/evidence.ts`) holds what a run stood on: RPE's
// commit and whether its tree was changed, RPH's commit and the pin, Lumiverse's version, the browser,
// every agent's connection, model, reply form, effort and streaming, the settings as given, who started
// it and when. This file reads it and writes beside it, in the gate's part of the bundle, only what it
// lacks: the hash of the shipped tree the server runs (and of the build's, to hold it against), the
// hash of each layer of the user's own the run stood on, plain generation's reasoning setting as
// Lumiverse holds it, and whether the run is a trial or gives a verdict. It never copies a build or a
// setting: `repeated` is the check.
//
// What counts (plan §17.1 l.1757, "under the shipped guidance"; PlanGates §3 "What counts"): a verdict
// comes only from a run on a clean build whose agents ran under the shipped tree. A changed tree, RPH
// other than the commit RPE pins, a shipped tree other than the build's, or a layer of the user's own
// holding guidance makes the run a trial: printed as one, with why, and never judged.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { readBundle, type RunRecord } from "../route/evidence";

/** One file of a tree: its path below the tree's root and the SHA-256 of its bytes. */
export interface TreeFile {
  path: string;
  sha256: string;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** A tree's hash: the SHA-256 of its files' paths and hashes in path order, so the same files give the same hash however they were read. */
export function treeHash(files: readonly TreeFile[]): string {
  return sha256([...files].sort(byPath).map((f) => `${f.path}\0${f.sha256}\n`).join(""));
}

/** The paths at which two trees differ: a file in one and not the other, or with other bytes. */
export function treeChanges(a: readonly TreeFile[], b: readonly TreeFile[]): string[] {
  const left = new Map(a.map((f) => [f.path, f.sha256]));
  const right = new Map(b.map((f) => [f.path, f.sha256]));
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths].filter((p) => left.get(p) !== right.get(p)).sort();
}

/**
 * The build's shipped tree, as RPE lays its shipped level out: RPH's shipped folder, then RPE's over
 * it (`src/tree/defaults.ts:18`, "RPH's, then RPE's over it"). Paths are below each folder.
 */
export function shippedOf(rph: readonly TreeFile[], rpe: readonly TreeFile[]): TreeFile[] {
  const out = new Map(rph.map((f) => [f.path, f]));
  for (const f of rpe) out.set(f.path, f);
  return [...out.values()].sort(byPath);
}

/** A folder of a repository at a commit, every file below it, read with git (the commits are the ones `run.json` names). */
export function gitTree(repo: string, commit: string, folder: string): TreeFile[] {
  const run = (args: string[], stdin?: Uint8Array): Uint8Array => {
    const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} in ${repo}: ${new TextDecoder().decode(done.stderr).trim()}`);
    return done.stdout;
  };
  const listed = new TextDecoder().decode(run(["ls-tree", "-r", "-z", "--full-tree", commit, "--", folder]));
  const entries = listed
    .split("\0")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const match = /^\d+ (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
      return match && match[1] === "blob" ? [{ sha: match[2] as string, path: (match[3] as string).slice(folder.length + 1) }] : [];
    });
  if (entries.length === 0) return [];
  // One `cat-file --batch` reads every blob: "<sha> blob <size>\n<bytes>\n" each, in the order asked.
  const out = run(["cat-file", "--batch"], new TextEncoder().encode(entries.map((e) => `${e.sha}\n`).join("")));
  const files: TreeFile[] = [];
  let at = 0;
  for (const entry of entries) {
    const end = out.indexOf(10, at);
    const head = new TextDecoder().decode(out.subarray(at, end));
    const size = Number(head.split(" ")[2]);
    if (!Number.isInteger(size)) throw new Error(`git cat-file gave "${head}" for ${entry.path}`);
    files.push({ path: entry.path, sha256: sha256(out.subarray(end + 1, end + 1 + size)) });
    at = end + 1 + size + 1;
  }
  return files.sort(byPath);
}

/** The levels of the user's own (plan §5.1): above the shipped level, each able to replace a shipped file. */
export type OwnLevel = "global" | "character" | "chat";

/** The settings files (plan §5.4 "Config"): they hold settings and no guidance, so a layer holding only these leaves the agents under the shipped guidance. */
export const SETTINGS_FILES: readonly string[] = ["RPE-global.yml", "RPE.yml"];

/** A layer of the user's own the run stood on: its files the user can write, by path in the chat's view. */
export interface Layer {
  level: OwnLevel;
  files: TreeFile[];
}

/** The files of a layer that are guidance rather than settings. */
export function guidanceOf(layer: Layer): string[] {
  return layer.files.map((f) => f.path).filter((path) => !SETTINGS_FILES.includes(path.split("/").pop() ?? path));
}

/**
 * Plain generation's reasoning as Lumiverse holds it for a chat generation on the plain connection under
 * the floor's preset. Lumiverse takes the connection's own binding when it has one, else the user's
 * global setting (`src/services/generation/reasoning.ts:211-221`, `src/services/prompt-assembly.service.ts:7673-7693`);
 * reasoning is asked of the provider only when `apiReasoning` is on, at `reasoningEffort` ("auto" when
 * unset: the provider's own, `reasoning.ts:255-268`), and switched off outright when it is false
 * (`reasoning.ts:278-280`). A custom request body applies too: the reasoning setting's own, else the
 * preset's older one (`prompt-assembly.service.ts:7808-7815`), and may carry reasoning fields of its own.
 */
export interface PlainReasoning {
  connection: string;
  preset: string;
  source: "connection" | "global" | "none";
  apiReasoning: boolean | null;
  effort: string | null;
  /** The custom body that applies, where one does, and the reasoning fields it sets. */
  customBody: { from: "reasoning" | "preset"; reasoningKeys: string[] } | null;
}

/** The request fields by which a custom body would set reasoning itself (`prompt-assembly.service.ts:7954-7973`, and the other providers' blocks there). */
const REASONING_KEYS = ["reasoning_effort", "thinking", "reasoning", "thinkingConfig", "output_config", "enable_thinking"];

/** What Lumiverse holds, read as its own code reads it: the connection's binding, else the global setting; the custom body that applies. */
export function plainReasoning(input: { connection: string; preset: string; binding: unknown; global: unknown; presetCustomBody: unknown }): PlainReasoning {
  const bound = isRecord(input.binding) ? input.binding : null;
  const global = isRecord(input.global) ? input.global : null;
  const settings = bound ?? global;
  const source = bound !== null ? "connection" : global !== null ? "global" : "none";
  const own = settings !== null && Object.hasOwn(settings, "customBody");
  const body = own ? settings?.customBody : input.presetCustomBody;
  return {
    connection: input.connection,
    preset: input.preset,
    source,
    apiReasoning: typeof settings?.apiReasoning === "boolean" ? settings.apiReasoning : null,
    effort: typeof settings?.reasoningEffort === "string" && settings.reasoningEffort !== "" ? settings.reasoningEffort : settings?.apiReasoning === true ? "auto" : null,
    customBody: customBodyOf(body, own ? "reasoning" : "preset"),
  };
}

/** A custom body as Lumiverse applies it: only when switched on, its `rawJson` parsing to an object (`applyCustomBodyParameters`, `prompt-assembly.service.ts:7705-7718`). */
function customBodyOf(body: unknown, from: "reasoning" | "preset"): PlainReasoning["customBody"] {
  if (!isRecord(body) || body.enabled !== true || typeof body.rawJson !== "string" || body.rawJson === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.rawJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return { from, reasoningKeys: Object.keys(parsed).filter((k) => REASONING_KEYS.includes(k)) };
}

/** What a gate's form saw while it played, which `run.json` cannot hold: kept in its `internal/` as `observed.json`. */
export interface Observed {
  /** The shipped level as RPE served it to the run's chat, by path below the level. */
  shipped: TreeFile[];
  layers: Layer[];
  plain: PlainReasoning | null;
}

/** The record's addition, `<bundle>/<gate>/internal/record.json`: only what `run.json` lacks. */
export interface Addition {
  gate: string;
  shipped: { served: string; build: string; changed: string[] };
  layers: { level: OwnLevel; hash: string; files: string[]; guidance: string[] }[];
  plain: PlainReasoning | null;
  standing: "verdict" | "trial";
  /** Why the run is a trial; empty for a verdict. */
  why: string[];
}

/** How many changed paths a trial's reason names before it counts the rest. */
const NAMED = 8;

const named = (paths: readonly string[]): string => (paths.length <= NAMED ? paths.join(", ") : `${paths.slice(0, NAMED).join(", ")} and ${paths.length - NAMED} more`);

/** The addition, from `run.json`, what the gate saw, and the build's shipped tree. */
export function additionOf(gate: string, run: RunRecord, observed: Observed, build: readonly TreeFile[]): Addition {
  const why: string[] = [];
  if (run.rpe.dirty) why.push(`RPE's tree held changes beyond its commit ${run.rpe.commit} (run.json: rpe.dirty)`);
  if (!run.rph.pinned) why.push(`RPH as installed (${run.rph.commit}) is not the commit RPE pins (${run.rph.pin ?? "none"})`);
  const changed = treeChanges(observed.shipped, build);
  if (changed.length > 0) why.push(`the shipped tree the server runs is not the build's: ${named(changed)}`);
  const layers = observed.layers.map((layer) => ({ level: layer.level, hash: treeHash(layer.files), files: layer.files.map((f) => f.path).sort(), guidance: guidanceOf(layer) }));
  for (const layer of layers) if (layer.guidance.length > 0) why.push(`the ${layer.level} layer holds guidance of its own, so the agents did not run under the shipped guidance: ${named(layer.guidance)}`);
  return { gate, shipped: { served: treeHash(observed.shipped), build: treeHash(build), changed }, layers, plain: observed.plain, standing: why.length === 0 ? "verdict" : "trial", why };
}

/** The names of `run.json`'s fields the addition repeats: by key at its top, or by holding one of its builds or the settings it gave. Empty when it repeats none. */
export function repeated(run: RunRecord, addition: Addition): string[] {
  const out = new Set<string>();
  const runKeys = Object.keys(run);
  for (const key of Object.keys(addition)) if (runKeys.includes(key)) out.add(key);
  const builds: [string, string][] = [
    ["rpe.commit", run.rpe.commit],
    ["rph.commit", run.rph.commit],
    ["lumiverse.version", run.lumiverse.version],
    ["browser.version", run.browser.version],
  ];
  if (run.rph.pin !== null) builds.push(["rph.pin", run.rph.pin]);
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (isRecord(value)) Object.values(value).forEach(walk);
  };
  // `why` names commits on purpose, to say why a run is a trial; it is words, not a record of them.
  walk({ ...addition, why: [] });
  for (const [name, value] of builds) if (value.length >= 7 && texts.some((t) => t === value || t.includes(value))) out.add(name);
  if (texts.some((t) => t.includes('"settings"'))) out.add("settings");
  return [...out].sort();
}

/** Where a gate's addition and what it saw are kept in a bundle. */
export function recordPath(bundle: string, gate: string): string {
  return join(bundle, gate, "internal", "record.json");
}

export function observedPath(bundle: string, gate: string, play = 1): string {
  return join(bundle, gate, "internal", `play-${String(play).padStart(2, "0")}`, "observed.json");
}

/** The build's shipped tree, read for the commits a run names. */
export type BuildReader = (run: RunRecord) => TreeFile[];

/** From the repositories on disk: RPE's `guidance/` at the run's RPE commit, over RPH's at its RPH commit. */
export function buildFromRepos(repos: { rpe: string; rph: string }): BuildReader {
  return (run) => shippedOf(gitTree(repos.rph, run.rph.commit, "guidance"), gitTree(repos.rpe, run.rpe.commit, "guidance"));
}

/** A bundle's run, read by the runner's own reader: a bundle without a whole `run.json` is refused there. */
export function readRun(bundle: string): RunRecord {
  return readBundle(bundle).run;
}

/** Writes the gate's addition beside `run.json`, from what its form saw, and returns it. A gate that saw nothing has no addition. */
export function writeRecord(bundle: string, gate: string, build: BuildReader): Addition {
  const run = readRun(bundle);
  const file = observedPath(bundle, gate);
  if (!existsSync(file)) throw new Error(`${gate} kept nothing of what it saw (${file} is missing), so nothing ties its figures to a shipped tree`);
  const observed = JSON.parse(readFileSync(file, "utf8")) as Observed;
  const addition = additionOf(gate, run, observed, build(run));
  const twice = repeated(run, addition);
  if (twice.length > 0) throw new Error(`the record's addition would repeat run.json's ${twice.join(", ")}`);
  mkdirSync(join(bundle, gate, "internal"), { recursive: true });
  writeFileSync(recordPath(bundle, gate), `${JSON.stringify(addition, null, 2)}\n`);
  return addition;
}

/** A gate's addition as written, or null before it is. */
export function readRecord(bundle: string, gate: string): Addition | null {
  const file = recordPath(bundle, gate);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Addition) : null;
}

/** The first lines any printed result of a run starts with: what it stood on, by `run.json` and the addition, and whether it gives a verdict. */
export function standingLines(run: RunRecord, addition: Addition | null): string[] {
  const head = `Run ${run.run} (${run.mode === "rig" ? "the rig" : "the test bed"}), started ${run.started} by ${run.by}: RPE ${run.rpe.commit}${run.rpe.dirty ? " with changes" : ""}, RPH ${run.rph.commit}${run.rph.pinned ? " (the pin)" : ` (the pin is ${run.rph.pin ?? "none"})`}, Lumiverse ${run.lumiverse.version}.`;
  if (addition === null) return [head, "TRIAL: no verdict. The record's addition is missing, so the shipped tree the run stood on is unknown."];
  if (addition.standing === "trial") return [head, `TRIAL: no verdict. ${addition.why.join("; ")}.`];
  return [head, `Shipped tree ${addition.shipped.served.slice(0, 12)}, the build's own; no layer of the user's holds guidance. This run gives a verdict.`];
}

/** Runs counted apart: those that give a verdict and the trials, each by name (plan §17.1 l.1757; AuProof-12). */
export function countApart(runs: readonly { run: string; addition: Addition | null }[]): { verdicts: string[]; trials: { run: string; why: string }[] } {
  const verdicts: string[] = [];
  const trials: { run: string; why: string }[] = [];
  for (const r of runs) {
    if (r.addition?.standing === "verdict") verdicts.push(r.run);
    else trials.push({ run: r.run, why: r.addition === null ? "no addition was written" : r.addition.why.join("; ") });
  }
  return { verdicts, trials };
}
