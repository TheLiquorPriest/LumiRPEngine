// The fate of every file of today's build (STANDALONE-PLAN §15.4, PlanSwap-4): removed, by which
// package and under which row of §15.4's table; kept where it is, under §15.4's Kept line; or moved,
// to which home and by which package. A removed file that holds something kept code needs names that
// piece, where it goes and who moves it, and so does a file moved in parts to several homes; a kept
// file that loses a part names the part and who cuts it.
// Each file is settled by its path, never by its name: `src/engine/steps.ts` is kept while
// `src/backend/steps.ts` goes. The list is `fates.tsv` beside this file, and once the removal is done
// it is the report of which went (READINGS R-50).
//
// Lines of `fates.tsv`, tab-separated, `#` starting a comment:
//   <path>  kept     <Kept item>  <note>
//   <path>  removed  <package>    <row>    <note>
//   <path>  moved    <package>    <home>   <note>
//   <path>  piece    <package>    <home>   <what moves>  [<names>  <for>]   (beside a removed or moved file's line)
//   <path>  cut      <package>             <what goes>                    (beside a kept file's line)
// A test has a line too: "removed" when what it tests goes, else "kept", or "moved" to a home under
// test/ (a test of a kept system is never removed with a folder that goes).
// A package is one the planners named (`PlanSwap-8`, `PlanChatUI-B3`), or "no package yet" for a
// piece or a moved test whose mover the planners have not settled: the report names each for them.
// A piece that names its names (comma-separated) and the files they are for (paths, a folder ending in
// `/`) is an allowance: until the piece moves, those files may take those names from the file it leaves,
// and nothing else of it. Allowances, like the fence's list, only shrink (fence.ts).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
const LIST = join(import.meta.dir, "fates.tsv");

/** §15.4's table, one key for each row, in the plan's words. */
export const ROWS = {
  agents: "The agents engine: orchestrator, main agent, provider, roles, its sessions and compaction, final review",
  classic: "The classic pipeline: steps, turn model, minds steps, knowledge steps, skip, claims, sections, preset lint",
  halves: "Their halves of the runtime and the dispatcher",
  settings: "Settings pages only they used: steps, speed, roles, context, main agent; six of the turn timeouts",
  ui: "Their UI: the old live view, the workspace browser, the play-context view, swipe-ask, restart",
  texts: "Their prompt texts",
  gate: "The guard, the half of the World Info gate that held lore back from the harness, engine-managed book entries, the link except the UI pipe, the chat copy and its mirror, LumiAH as a dependency",
} as const;
export type Row = keyof typeof ROWS;

/** §15.4's Kept line, one key for each item, and what those items stand on. */
export const KEPT = {
  packs: "all 14 packs and their panels",
  builder: "the world store and the builder",
  "map-editor": "the map editor",
  hud: "the HUD and panels",
  things: "GM mode's things browser, kept on its own (§14 l.1539)",
  engine: "the pure engine",
  cli: "the CLI",
  worker: "the worker",
  starters: "the three starter worlds",
  secrecy: "the secrecy half of the World Info gate (§9.6)",
  under: "what the kept items import, reached from them and never through a removed file",
} as const;
export type KeptItem = keyof typeof KEPT;

/** The folders of today's build whose every file has a fate, and the three files at the top of `src/`. */
export const OLD_FOLDERS = ["backend", "frontend", "shared", "engine", "packs", "cli", "worker"] as const;
export const OLD_FILES = ["src/backend.ts", "src/frontend.ts", "src/spindle-augment.ts"] as const;

/** The standalone application's own folders under `src/`, the homes made for what moves out of today's build among them. */
export const NEW_ZONES = ["app", "adapter", "store", "iface", "cast", "story", "lore", "turn", "ui", "ext", "migrate", "tree", "build", "play", "worlds", "secrecy"] as const;

/** A package of the rebuild, as the planners named them (`PlanSwap-8`, `PlanChatUI-B3`, `PlanTurnKinds-21`). */
export const PACKAGE = /^Plan[A-Z][A-Za-z]*-[A-Z]?\d+$/;
/** What a piece's or a moved test's mover reads until the planners settle it. */
export const NO_PACKAGE = "no package yet";

export type Fate =
  | { path: string; fate: "kept"; item: KeptItem; note: string; line: number }
  | { path: string; fate: "removed"; by: string; row: Row; note: string; line: number }
  | { path: string; fate: "moved"; by: string; home: string; note: string; line: number };

/** What kept code needs from a removed file, and where it goes; with `names` and `for`, an allowance. */
export interface Piece {
  path: string;
  by: string;
  home: string;
  what: string;
  names: string[];
  for: string[];
  line: number;
}

/** A part of a kept file that a package removes. */
export interface Cut {
  path: string;
  by: string;
  what: string;
  line: number;
}

export interface Fates {
  files: Map<string, Fate>;
  pieces: Piece[];
  cuts: Cut[];
  /** Lines that say no fate a reader could act on, each with its line number. */
  problems: string[];
}

/** A comma-separated field, each item trimmed, empty items dropped. */
export const items = (field: string): string[] => field.split(",").map((item) => item.trim()).filter((item) => item !== "");

export function readFates(text: string = readFileSync(LIST, "utf8")): Fates {
  const files = new Map<string, Fate>();
  const pieces: Piece[] = [];
  const cuts: Cut[] = [];
  const problems: string[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    const [path = "", fate = "", a = "", b = "", note = "", names = "", forList = "", ...extra] = raw.split("\t");
    const at = `fates.tsv:${line} (${path})`;
    if (extra.length > 0 || (fate !== "piece" && (names !== "" || forList !== ""))) problems.push(`${at}: more fields than a ${fate === "piece" ? "piece" : "fate"} has`);
    if (!/^(src|test)\//.test(path)) {
      problems.push(`${at}: a path from the repository's root, under src/ or test/`);
      continue;
    }
    const test = path.startsWith("test/");
    if (fate === "piece" || fate === "cut") {
      if (!PACKAGE.test(a) && !(fate === "piece" && a === NO_PACKAGE)) problems.push(`${at}: the package that ${fate === "piece" ? "moves" : "cuts"} it is not named`);
      if (fate === "piece") {
        if (b === "") problems.push(`${at}: the piece has no home`);
        if (note === "") problems.push(`${at}: the piece does not say what moves`);
        if ((names === "") !== (forList === "")) problems.push(`${at}: an allowance names both its names and the files they are for`);
        pieces.push({ path, by: a, home: b, what: note, names: items(names), for: items(forList), line });
      } else {
        if (b !== "") problems.push(`${at}: a cut has no home`);
        if (note === "") problems.push(`${at}: the cut does not say what goes`);
        cuts.push({ path, by: a, what: note, line });
      }
      continue;
    }
    if (files.has(path)) {
      problems.push(`${at}: a second fate (the first is at line ${files.get(path)?.line})`);
      continue;
    }
    if (fate === "kept") {
      if (!(a in KEPT)) problems.push(`${at}: "${a}" is not an item of §15.4's Kept line`);
      if (b !== "") problems.push(`${at}: a kept file has no fourth field`);
      files.set(path, { path, fate, item: a as KeptItem, note, line });
    } else if (fate === "removed") {
      if (!PACKAGE.test(a)) problems.push(`${at}: the package that removes it is not named`);
      if (!(b in ROWS)) problems.push(`${at}: "${b}" is not a row of §15.4's table`);
      files.set(path, { path, fate, by: a, row: b as Row, note, line });
    } else if (fate === "moved") {
      if (!PACKAGE.test(a) && !(test && a === NO_PACKAGE)) problems.push(`${at}: the package that moves it is not named`);
      if (!b.startsWith(test ? "test/" : "src/")) problems.push(`${at}: a moved ${test ? "test's home is a path under test/" : "file's home is a path under src/"}`);
      files.set(path, { path, fate, by: a, home: b, note, line });
    } else problems.push(`${at}: "${fate}" is not a fate (kept, removed, moved, piece, cut)`);
  }
  for (const piece of pieces) {
    const fate = files.get(piece.path)?.fate;
    if (fate !== "removed" && fate !== "moved") problems.push(`fates.tsv:${piece.line} (${piece.path}): a piece belongs beside a removed or moved file`);
  }
  for (const cut of cuts) {
    if (files.get(cut.path)?.fate !== "kept") problems.push(`fates.tsv:${cut.line} (${cut.path}): a cut belongs beside a kept file`);
  }
  return { files, pieces, cuts, problems };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Every file of today's build under `root`, by its path from there, with any `planted` path of today's folders among them. */
export function oldFiles(root: string = ROOT, planted: Iterable<string> = []): string[] {
  const found = new Set(OLD_FOLDERS.flatMap((folder) => walk(join(root, "src", folder))).map((file) => relative(root, file).split("\\").join("/")));
  for (const file of OLD_FILES) if (existsSync(join(root, file))) found.add(file);
  for (const path of planted) if (OLD_FOLDERS.some((folder) => path.startsWith(`src/${folder}/`)) || (OLD_FILES as readonly string[]).includes(path)) found.add(path);
  return [...found].sort();
}

/** The files of today's build that have no fate. */
export function unsettled(files: readonly string[], fates: Fates): string[] {
  return files.filter((file) => !fates.files.has(file));
}

/**
 * Files the list keeps, or keeps until a package moves them, that are not on disk. A removed file may
 * be gone: then the list says which went. A moved file that is gone is found only at a home that names
 * the file it moved to: a folder could hold anything, so its line must say which file.
 */
export function missing(fates: Fates, root: string = ROOT): string[] {
  const out: string[] = [];
  for (const fate of fates.files.values()) {
    if (fate.fate === "removed" || existsSync(join(root, fate.path))) continue;
    if (fate.fate === "moved" && !fate.home.endsWith("/") && existsSync(join(root, fate.home))) continue;
    if (fate.fate === "kept") out.push(`${fate.path}: kept, and not on disk`);
    else out.push(fate.home.endsWith("/") ? `${fate.path}: gone, and its home ${fate.home} is a folder; name the file it moved to` : `${fate.path}: neither here nor at ${fate.home}`);
  }
  return out;
}

/**
 * Where what leaves today's build goes, by the folder it leaves: the homes of the pieces and of the
 * moved files, each with the package that makes it. Until the old files go, they may import their own
 * moved code (PlanSwap-5: "A move leaves one copy"). A home ending in `/` is a folder.
 */
export function homes(fates: Fates): { from: string; home: string; by: string }[] {
  const out: { from: string; home: string; by: string }[] = [];
  for (const piece of fates.pieces) if (piece.home.startsWith("src/")) out.push({ from: piece.path, home: piece.home, by: piece.by });
  for (const fate of fates.files.values()) if (fate.fate === "moved" && fate.home.startsWith("src/")) out.push({ from: fate.path, home: fate.home, by: fate.by });
  return out;
}

/** Whether `path` lies at `home`, a file or a folder ending in `/`. */
export function atHome(path: string, home: string): boolean {
  return home.endsWith("/") ? path.startsWith(home) : path === home;
}

/** The names `from` may take from `to` by the allowances of `to`'s pieces. */
export function allowed(fates: Fates, from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const piece of fates.pieces) if (piece.path === to && piece.for.some((home) => atHome(from, home))) for (const name of piece.names) out.add(name);
  return out;
}
