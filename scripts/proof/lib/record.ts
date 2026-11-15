// The record of a proof run, in one home (PlanGates-4 item 1, PlanGates-42 item 1; the lead's ruling).
// The runner's `run.json` (`scripts/proof/route/evidence.ts`) holds what a run stood on: RPE's commit and
// whether its tree was changed, RPH's commit and the pin, Lumiverse's version, the browser, every agent's
// connection, model, reply form, effort and streaming, the settings as given, who started it and when,
// and the run's standing (PlanScenarios-8 item 4): verdict or trial, with why, worked out once from the
// shipped tree the server ran against the build's and from every layer of the user's own, each by hash.
// This file reads that standing (`standingLines`, `countApart`, by the runner's own `standingOfRun`),
// never works it out a second time, and writes beside `run.json`, in the gate's part of the bundle, only
// what `run.json` still lacks: plain generation's reasoning setting as Lumiverse holds it; the layers
// of the floor's own chat whose hash `run.json` does not carry (the chat is made after the runner took
// the run's facts); and, where `run.json` gives no account of the guidance at all, the hash of the
// shipped tree the floor's chat was served against the build's. `repeated` holds the addition to that.
//
// The runner works the standing out with the helpers below (`shippedOf`, `treeHash`, `treeChanges`,
// `guidanceOf`). The build's shipped tree is laid by RPE's own rule, `shippedPlaces` (`src/tree/shipped.ts`),
// the function `layShipped` copies by, called here on the two folders' file lists, never a second copy.
// Where this file lays the build's tree itself (what `run.json` lacks), RPH's shipped files are read
// from the installed `rp-harness` folder, a real copy of the pinned commit (READINGS R-196), with no
// git; RPE's at the commit `run.json` names, from RPE's own repository.
//
// The floor's own reasons for a trial (PlanGates-4-fix1 item 4), found before its first pair:
// `floorTrials`, from the floor chat's view of the tree as RPE serves it, and from who RPE says leads
// the turn (PlanGates-4-fix2 item 2: the floor is "where the Author writes").

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { shippedPlaces } from "../../../src/tree/shipped";
import type { SettingsReply } from "../../../src/shared/api";
import { isRecord } from "../../../src/shared/json";
import { readBundle, standingOfRun, type RunRecord } from "../route/evidence";

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
 * The build's shipped tree, as RPE lays its shipped level out: RPH's shipped folder, then RPE's over it,
 * RPE's `chat-defaults/` at the level's root, each file where RPE's own `shippedPlaces` puts it. Paths
 * are below each folder.
 */
export function shippedOf(rph: readonly TreeFile[], rpe: readonly TreeFile[]): TreeFile[] {
  const from = { rph: new Map(rph.map((f) => [f.path, f.sha256])), rpe: new Map(rpe.map((f) => [f.path, f.sha256])) };
  return shippedPlaces(
    rph.map((f) => f.path),
    rpe.map((f) => f.path),
  ).map((place) => ({ path: place.path, sha256: from[place.from].get(place.source) as string }));
}

/** Every file below a folder on disk, read without git: RPH's installed shipped folder (R-196). Refused for a folder that is not there. */
export function folderTree(folder: string): TreeFile[] {
  if (!existsSync(folder)) throw new Error(`there is no folder at ${folder}`);
  const root = realpathSync(folder);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const at = join(d.parentPath, d.name);
      return { path: relative(root, at).split(sep).join("/"), sha256: sha256(readFileSync(at)) };
    })
    .sort(byPath);
}

/** Where the floor reads RPH's shipped files from: the installed `rp-harness` package's `guidance/`, below RPE's repository. */
export function installedRph(repo: string): string {
  return join(repo, "node_modules", "rp-harness", "guidance");
}

/** The build's shipped tree for a run: RPE's `guidance/` at `commit` in its repository laid over RPH's installed shipped folder. */
export function buildTree(input: { repo: string; commit: string; rph: string }): TreeFile[] {
  return shippedOf(folderTree(input.rph), gitTree(input.repo, input.commit, "guidance"));
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

/** A shipped file switched off by an `off:` list, and the levels whose list switches it off (RPE's files route: `TreeFileEntry.off`, `offIn`). */
export interface OffFile {
  path: string;
  offIn: string[];
}

/**
 * Who leads the floor's turns, as RPE's own settings say (PlanGates-4-fix2 item 2): `expected` is the
 * shipped default of the `lead` setting as RPE serves it, written nowhere in the script; `inForce` is
 * the value RPE holds for the floor's chat and `from` the level whose file decides it (null: the
 * default holds); `levels` is what each level's own settings file sets `lead` to, read from the file.
 */
export interface Leads {
  expected: string | null;
  inForce: string | null;
  from: string | null;
  levels: { level: string; file: string; lead: string | null; problem: string | null }[];
}

/** What a settings file's text sets `lead` to: the name, null where it sets none, and why a file that does not parse is passed over. */
export function leadInFile(text: string): { lead: string | null; problem: string | null } {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    return { lead: null, problem: `its text does not parse: ${error instanceof Error ? error.message : String(error)}` };
  }
  const lead = isRecord(parsed) ? parsed.lead : undefined;
  return { lead: typeof lead === "string" && lead.trim() !== "" ? lead.trim() : null, problem: null };
}

/** The leads from RPE's settings reply and each level's own settings file as read (`text` null where it was not). */
export function leadsOf(settings: Pick<SettingsReply, "settings">, read: readonly { level: string; file: string; text: string | null; problem: string | null }[]): Leads {
  const view = settings.settings.find((s) => s.key === "lead");
  const name = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  return {
    expected: name(view?.default),
    inForce: name(view?.value),
    from: view?.from ?? null,
    levels: read.map((r) => {
      const own = r.text === null ? { lead: null, problem: r.problem } : leadInFile(r.text);
      return { level: r.level, file: r.file, lead: own.lead, problem: own.problem ?? r.problem };
    }),
  };
}

/** The floor's own trial where the turn's lead is not the Author: the lead RPE holds for the chat is not the shipped default of its `lead` setting, or either is not known. */
export function leadTrials(leads: Leads): string[] {
  if (leads.expected === null) return ["RPE's settings give no `lead` setting with a default, so who leads the turn is not known"];
  if (leads.inForce === null) return ["RPE's settings give no value in force for `lead`, so who leads the turn is not known"];
  if (leads.inForce === leads.expected) return [];
  return [`the turn's lead is ${leads.inForce}, not the Author (the shipped default of the lead setting is ${leads.expected}; ${leads.from === null ? "no file sets it" : `the ${leads.from} level's file sets it`})`];
}

/**
 * What the floor's form saw of its own chat before its first pair, which `run.json` cannot hold (the
 * chat is made after the runner took the run's facts): kept in its `internal/` as `observed.json`. The
 * shipped level as RPE serves it to the chat, by path below the level; each layer of the user's own in
 * the chat's view; each shipped file switched off at any level; plain generation's reasoning; who leads.
 */
export interface Observed {
  plain: PlainReasoning | null;
  shipped: TreeFile[];
  layers: Layer[];
  off: OffFile[];
  leads: Leads;
}

/** The record's addition, `<bundle>/<gate>/internal/record.json`: only what `run.json` lacks. */
export interface Addition {
  gate: string;
  plain: PlainReasoning | null;
  /** The layers of the gate's chat whose hash `run.json`'s standing does not carry, each with the guidance in it. */
  layers: { level: OwnLevel; hash: string; guidance: string[] }[];
  /** Only where `run.json` gives no account of the guidance: the shipped tree the gate's chat was served against the build's, laid by `shippedOf`. */
  shipped: { served: string; build: string; changed: string[] } | null;
}

/** The build's shipped tree, read for a run where `run.json` lacks it. */
export type BuildReader = (run: RunRecord) => TreeFile[];

/** The build of a run from RPE's repository at the run's commit, laid over RPH's installed shipped folder (no git: R-196). */
export function buildFrom(repo: string, rph: string): BuildReader {
  return (run) => buildTree({ repo, commit: run.rpe.commit, rph });
}

/** The addition from `run.json` and what the gate saw: the build is read only where `run.json` gives no account of the guidance. */
export function additionOf(gate: string, run: RunRecord, observed: Observed, build: BuildReader | null): Addition {
  const from = run.standing?.from ?? null;
  const carried = new Set((from?.layers ?? []).map((l) => l.hash));
  const layers = observed.layers.map((layer) => ({ level: layer.level, hash: treeHash(layer.files), guidance: guidanceOf(layer) })).filter((l) => !carried.has(l.hash));
  let shipped: Addition["shipped"] = null;
  if (from === null) {
    if (build === null) throw new Error("run.json gives no account of the guidance the run stood on, and the record was given no build to hold the served tree against");
    const tree = build(run);
    shipped = { served: treeHash(observed.shipped), build: treeHash(tree), changed: treeChanges(observed.shipped, tree) };
  }
  return { gate, plain: observed.plain, layers, shipped };
}

/**
 * The floor's own reasons for a trial, found before its first pair (PlanGates-4-fix1 item 4): guidance
 * in a layer of the user's own; a shipped file switched off at any level by an `off:` list; a lead that
 * is not the Author (PlanGates-4-fix2 item 2); a shipped tree served to the floor's chat that is not
 * the build's (held to the build's hash in `run.json`, or, where `run.json` lacks it, to the build
 * `build` lays). Empty when there is none.
 */
export function floorTrials(run: RunRecord, observed: Pick<Observed, "shipped" | "layers" | "off" | "leads">, build: BuildReader | null): string[] {
  const out: string[] = [];
  const guidance = observed.layers.flatMap(guidanceOf);
  if (guidance.length > 0) out.push(`a layer of the user's own holds guidance: ${guidance.join(", ")}`);
  if (observed.off.length > 0) out.push(`shipped guidance is switched off by an off: list: ${observed.off.map((f) => `${f.path} (off in ${f.offIn.length > 0 ? f.offIn.join(", ") : "a level the route does not name"})`).join(", ")}`);
  out.push(...leadTrials(observed.leads));
  const served = treeHash(observed.shipped);
  const from = run.standing?.from ?? null;
  if (from !== null) {
    if (served !== from.build) out.push(`the shipped tree RPE serves the floor's chat (${served.slice(0, 12)}) is not the build's (${from.build.slice(0, 12)}, run.json)`);
    return out;
  }
  if (build === null) {
    out.push("run.json gives no account of the build's shipped tree, so the tree RPE serves the floor's chat cannot be held to it");
    return out;
  }
  let tree: TreeFile[];
  try {
    tree = build(run);
  } catch (error) {
    out.push(`the build's shipped tree could not be read, so the tree RPE serves the floor's chat cannot be held to it: ${error instanceof Error ? error.message : String(error)}`);
    return out;
  }
  const changed = treeChanges(observed.shipped, tree);
  if (changed.length > 0) out.push(`the shipped tree RPE serves the floor's chat is not the build's: ${changed.length} ${changed.length === 1 ? "path differs" : "paths differ"} (${changed.join(", ")})`);
  return out;
}

/**
 * The names of what in `run.json` the addition repeats: a key at its top, or one of its builds, the
 * settings it gave, or the hashes its standing was worked out from. Empty when it repeats none.
 */
export function repeated(run: RunRecord, addition: Addition): string[] {
  const out = new Set<string>();
  const runKeys = Object.keys(run);
  for (const key of Object.keys(addition)) if (runKeys.includes(key)) out.add(key);
  const held: [string, string][] = [
    ["rpe.commit", run.rpe.commit],
    ["rph.commit", run.rph.commit],
    ["lumiverse.version", run.lumiverse.version],
    ["browser.version", run.browser.version],
  ];
  if (run.rph.pin !== null) held.push(["rph.pin", run.rph.pin]);
  const from = run.standing?.from;
  if (from) {
    held.push(["standing.from.served", from.served], ["standing.from.build", from.build]);
    for (const layer of from.layers) held.push([`standing.from.layers (${layer.level})`, layer.hash]);
  }
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (isRecord(value)) Object.values(value).forEach(walk);
  };
  walk(addition);
  for (const [name, value] of held) if (value.length >= 7 && texts.some((t) => t.includes(value))) out.add(name);
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

/** A bundle's run, read by the runner's own reader: a bundle without a whole `run.json` is refused there. */
export function readRun(bundle: string): RunRecord {
  return readBundle(bundle).run;
}

/** Writes the gate's addition beside `run.json`, from what its form saw, and returns it; refused when it would repeat anything `run.json` holds. */
export function writeRecord(bundle: string, gate: string, build: BuildReader | null): Addition {
  const run = readRun(bundle);
  const file = observedPath(bundle, gate);
  if (!existsSync(file)) throw new Error(`${gate} kept nothing of what it saw (${file} is missing), so plain generation's reasoning setting is unknown`);
  const addition = additionOf(gate, run, JSON.parse(readFileSync(file, "utf8")) as Observed, build);
  const twice = repeated(run, addition);
  if (twice.length > 0) throw new Error(`the record's addition would repeat run.json's ${twice.join(", ")}`);
  mkdirSync(join(bundle, gate, "internal"), { recursive: true });
  writeFileSync(recordPath(bundle, gate), `${JSON.stringify(addition, null, 2)}\n`);
  return addition;
}

/** The addition's lines for a printed result: what it adds to `run.json`'s account of the run. */
export function additionLines(addition: Addition): string[] {
  const out: string[] = [];
  for (const layer of addition.layers) out.push(`The floor's chat stood on a ${layer.level} layer of the user's own run.json does not carry (${layer.hash.slice(0, 12)})${layer.guidance.length > 0 ? `, holding guidance: ${layer.guidance.join(", ")}` : ", holding settings only"}.`);
  if (addition.shipped !== null) out.push(addition.shipped.changed.length === 0 ? `The shipped tree the floor's chat was served (${addition.shipped.served.slice(0, 12)}) is the build's, laid from RPE's repository and RPH's installed folder; run.json gives no account of it, so the run's standing stays the runner's.` : `The shipped tree the floor's chat was served is not the build's: ${addition.shipped.changed.join(", ")}.`);
  return out;
}

/**
 * The first lines any printed result of a run starts with: what it stood on, and the runner's standing,
 * worked out again from what `run.json` says the run stood on by the runner's own reader
 * (`standingOfRun`), never taken on the record's word.
 */
export function standingLines(run: RunRecord): string[] {
  const head = `Run ${run.run} (${run.mode === "rig" ? "the rig" : "the test bed"}), started ${run.started} by ${run.by}: RPE ${run.rpe.commit}${run.rpe.dirty ? " with changes" : ""}, RPH ${run.rph.commit}${run.rph.pinned ? " (the pin)" : ` (the pin is ${run.rph.pin ?? "none"})`}, Lumiverse ${run.lumiverse.version}.`;
  const standing = standingOfRun(run);
  if (standing.is === "trial") return [head, `TRIAL: no verdict. ${standing.why.join("; ")}.`];
  const served = run.standing?.from?.served ?? "";
  return [head, `The shipped tree the server ran (${served.slice(0, 12)}) is the build's own and no layer of the user's holds guidance: this run gives a verdict.`];
}

/**
 * Runs counted apart: a run gives a verdict only where the runner's standing in `run.json` says so and
 * the gate's own record of it (`own`: the trial or stop it names, or that its record could not be read)
 * names none; every other run is a trial, with the reasons of both (plan §17.1 l.1757; AuProof-12;
 * PlanGates-4-fix2 item 4).
 */
export function countApart(runs: readonly { run: RunRecord; own: readonly string[] }[]): { verdicts: string[]; trials: { run: string; why: string }[] } {
  const verdicts: string[] = [];
  const trials: { run: string; why: string }[] = [];
  for (const { run, own } of runs) {
    const standing = standingOfRun(run);
    const why = [...(standing.is === "trial" ? standing.why : []), ...own];
    if (why.length === 0) verdicts.push(run.run);
    else trials.push({ run: run.run, why: why.join("; ") });
  }
  return { verdicts, trials };
}
