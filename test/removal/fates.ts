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
//   <path>  piece    <package>    <home>   <what moves>   (beside a removed or moved file's line)
//   <path>  cut      <package>             <what goes>    (beside a kept file's line)
// A test file may have a line too: a test that goes with what it tests is "removed".

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
  under: "what the kept items import, reached from them and never through a removed file",
} as const;
export type KeptItem = keyof typeof KEPT;

/** The folders of today's build whose every file has a fate, and the three files at the top of `src/`. */
export const OLD_FOLDERS = ["backend", "frontend", "shared", "engine", "packs", "cli", "worker"] as const;
export const OLD_FILES = ["src/backend.ts", "src/frontend.ts", "src/spindle-augment.ts"] as const;

/** The standalone application's own folders under `src/`, the homes made for what moves out of today's build among them. */
export const NEW_ZONES = ["app", "adapter", "store", "iface", "cast", "story", "lore", "turn", "ui", "ext", "migrate", "tree", "build", "play", "worlds", "secrecy"] as const;

/** A package of the rebuild, as the planners named them (`PlanSwap-8`, `PlanChatUI-B3`, `PlanTurnKinds-21`). */
const PACKAGE = /^Plan[A-Z][A-Za-z]*-[A-Z]?\d+$/;

export type Fate =
  | { path: string; fate: "kept"; item: KeptItem; note: string; line: number }
  | { path: string; fate: "removed"; by: string; row: Row; note: string; line: number }
  | { path: string; fate: "moved"; by: string; home: string; note: string; line: number };

/** What kept code needs from a removed file, and where it goes. */
export interface Piece {
  path: string;
  by: string;
  home: string;
  what: string;
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

export function readFates(text: string = readFileSync(LIST, "utf8")): Fates {
  const files = new Map<string, Fate>();
  const pieces: Piece[] = [];
  const cuts: Cut[] = [];
  const problems: string[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    const [path = "", fate = "", a = "", b = "", note = "", ...extra] = raw.split("\t");
    const at = `fates.tsv:${line} (${path})`;
    if (extra.length > 0) problems.push(`${at}: more than five fields`);
    if (!/^(src|test)\//.test(path)) {
      problems.push(`${at}: a path from the repository's root, under src/ or test/`);
      continue;
    }
    if (path.startsWith("test/") && fate !== "removed") problems.push(`${at}: a test's only fate here is "removed", with what it tests`);
    if (fate === "piece" || fate === "cut") {
      if (!PACKAGE.test(a)) problems.push(`${at}: the package that ${fate === "piece" ? "moves" : "cuts"} it is not named`);
      if (fate === "piece") {
        if (b === "") problems.push(`${at}: the piece has no home`);
        if (note === "") problems.push(`${at}: the piece does not say what moves`);
        pieces.push({ path, by: a, home: b, what: note, line });
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
      if (!PACKAGE.test(a)) problems.push(`${at}: the package that moves it is not named`);
      if (!b.startsWith("src/")) problems.push(`${at}: a moved file's home is a path under src/`);
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

/** Files the list keeps (or keeps for now, until a package moves them) that are not on disk. A removed file may be gone: then the list says which went. */
export function missing(fates: Fates, root: string = ROOT): string[] {
  const out: string[] = [];
  for (const fate of fates.files.values()) {
    if (fate.fate === "removed" || existsSync(join(root, fate.path))) continue;
    if (fate.fate === "moved" && existsSync(join(root, fate.home))) continue;
    out.push(fate.fate === "moved" ? `${fate.path}: neither here nor at ${fate.home}` : `${fate.path}: kept, and not on disk`);
  }
  return out;
}

/**
 * Where what leaves today's build goes, by the folder it leaves: the homes of the pieces and of the
 * moved files. Until the old files go, they may import their own moved code (PlanSwap-5: "A move
 * leaves one copy"). A home ending in `/` is a folder.
 */
export function homes(fates: Fates): { from: string; home: string }[] {
  const out: { from: string; home: string }[] = [];
  for (const piece of fates.pieces) if (piece.home.startsWith("src/")) out.push({ from: piece.path, home: piece.home });
  for (const fate of fates.files.values()) if (fate.fate === "moved") out.push({ from: fate.path, home: fate.home });
  return out;
}

/** Whether `path` lies at `home`, a file or a folder ending in `/`. */
export function atHome(path: string, home: string): boolean {
  return home.endsWith("/") ? path.startsWith(home) : path === home;
}
