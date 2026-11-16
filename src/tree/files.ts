// RPE's file port (plan §5, §5.1; `FilesPort` in `rp-harness/contract`): reads and finds over a chat's
// view of the tree, and writes held to where each writer may write. Every note an agent writes in a
// turn is recorded against that turn as a version of the note (`note_version`), with what the file
// held before and after, so a swipe, a delete or a branch can put the notes back (`notes.ts`). A scope
// that names only the user sees the shipped and global levels alone, and writes nowhere. A find that
// stopped before it had looked everywhere says why: its limit, a file too large, a line cut, its time.

import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { FileHit, FileOp, FileQuery, FileRead, FilesPort, FindStopped, Found, LayerLevel, Places, Range, Refused, Scope, Unapplied, UserScope, Writer, Written } from "rp-harness/contract";
import { oneFileAtATime, writeWhole } from "../app/disk";
import type { TreeChats, TreeWrites } from "./chats";
import { areaOf, MOUNTS } from "./layout";
import { treeSettingsOf } from "./settings";
import { type ChatLocation, entriesOf, fileKey, kindOf, type Located, locate, type Lookup, placesOf, refusalFor, safeId, treeLayers, viewPath, writableFor } from "./view";

/** The levels every chat shares, which a scope that names only the user sees. */
const SHARED: readonly LayerLevel[] = ["shipped", "global"];

/** Whether a scope names a chat: one that names only the user has no chat in view. */
function namesChat(scope: Scope | UserScope): scope is Scope {
  return "chat" in scope;
}

export interface TreeFilesDeps {
  /** The tree's folder: the global level. */
  files: string;
  /** The one user this RPE serves; a scope of anyone else's is refused. */
  user: string;
  chats: TreeChats;
  /** The folder name of the scope's turn (`turnFolderName`); null for a turn RPE does not know. */
  turnFolder(scope: Scope): Promise<string | null>;
  writes: TreeWrites;
  now(): number;
}

/** RPE's file port, and where a chat's turn folder is on disk for the parts of RPE that write it. */
export interface TreeFiles extends FilesPort {
  /** The folder of the scope's turn on disk; null when the chat is not placed or the scope names no turn RPE knows. */
  turnDisk(scope: Scope): Promise<string | null>;
  /** The scope's session folder on disk; null when the chat is not placed. */
  sessionDisk(scope: Scope): Promise<string | null>;
  /**
   * RPE's own change of a file it writes as the harness (a turn's `turn.json`): `change` is given what the file holds now (null: none)
   * and gives what it is to hold, read and written in the file's one turn of its queue, so two changes never lose each other.
   */
  update(scope: Scope, path: string, change: (old: string | null) => string): Promise<Written | Refused>;
}

/** A text's SHA-256, lower-case hex: how a write records what a file held. */
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The part of a text a range covers, as whole lines with their breaks, and the lines it covers. A final line break ends the last line and does not start another. */
export function cut(text: string, range: Range | undefined): { text: string; start: number; end: number; lines: number } {
  const starts: number[] = text.length === 0 ? [] : [0];
  for (let i = text.indexOf("\n"); i !== -1 && i + 1 < text.length; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lines = starts.length;
  const start = range?.start ?? 1;
  if (!Number.isInteger(start) || start < 1) throw new RangeError(`A range starts at line 1 or later, not ${start}.`);
  if (range?.end !== undefined && !Number.isInteger(range.end)) throw new RangeError(`A range ends at a whole line, not ${range.end}.`);
  const end = Math.min(range?.end ?? lines, lines);
  if (end < start) return { text: "", start, end: start - 1, lines };
  const from = starts[start - 1] ?? text.length;
  const to = end < lines ? (starts[end] ?? text.length) : text.length;
  return { text: text.slice(from, to), start, end, lines };
}

/** The order of the view's paths: a folder sorts as its name with "/" after it. */
function byPath(a: { name: string; folder: boolean }, b: { name: string; folder: boolean }): number {
  const ka = a.folder && !a.name.endsWith("/") ? `${a.name}/` : a.name;
  const kb = b.folder && !b.name.endsWith("/") ? `${b.name}/` : b.name;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export interface Walked {
  rest: string[];
  folder: boolean;
  disk: string;
}

/** Everything below a folder, `depth` folders deep, in the order of their paths: no links, nothing but files and folders, and at a mounted level's top only what is in the view. */
export async function* walk(loc: ChatLocation, level: LayerLevel, rest: readonly string[], disk: string, depth: number): AsyncGenerator<Walked> {
  const entries = (await entriesOf(loc, level, rest, disk)).sort(byPath);
  for (const e of entries) {
    const below = [...rest, e.name];
    const at = join(disk, e.name);
    yield { rest: below, folder: e.folder, disk: at };
    if (e.folder && depth > 1) yield* walk(loc, level, below, at, depth - 1);
  }
}

async function* filesAt(loc: ChatLocation, at: Located & { disk: string }): AsyncGenerator<Walked> {
  if (at.is === "file") {
    yield { rest: at.rest, folder: false, disk: at.disk };
    return;
  }
  for await (const e of walk(loc, at.level, at.rest, at.disk, Number.POSITIVE_INFINITY)) if (!e.folder) yield e;
}

/** A file's path below the folder a find looked under; a file found itself is its own name. */
function below(at: Located, rest: readonly string[]): string {
  return at.is === "file" ? (rest.at(-1) ?? "") : rest.slice(at.rest.length).join("/");
}

async function fileHit(level: LayerLevel, rest: string[], disk: string): Promise<FileHit> {
  return { path: viewPath(level, rest), type: "file", level, kind: kindOf(level, rest), bytes: (await stat(disk)).size };
}

/** A file's size now; 0 for none. */
async function sizeOfFile(disk: string): Promise<number> {
  return await stat(disk).then(
    (s) => s.size,
    () => 0,
  );
}

function occurrences(text: string, old: string): number {
  let n = 0;
  for (let i = text.indexOf(old); i !== -1; i = text.indexOf(old, i + old.length)) n++;
  return n;
}

/** Applies a change to a file the writer may write, and gives the result with the file's text before it and after it (null: none). */
async function apply(at: Located & { disk: string }, op: FileOp): Promise<{ result: Written | Unapplied; old: string | null; after: string | null }> {
  if (at.is === "folder") return { result: { status: "unapplied", path: at.path, reason: "folder" }, old: null, after: null };
  const old = at.is === "file" ? await readFile(at.disk, "utf8") : null;
  const unapplied = (result: Unapplied) => ({ result, old, after: old });
  let after: string | null;
  switch (op.op) {
    case "write":
      after = op.text;
      break;
    case "append":
      after = (old ?? "") + op.text;
      break;
    case "edit": {
      if (old === null) return unapplied({ status: "unapplied", path: at.path, reason: "missing" });
      const matches = op.old === "" ? 0 : occurrences(old, op.old);
      if (matches === 0) return unapplied({ status: "unapplied", path: at.path, reason: "no-match" });
      if (matches > 1 && op.all !== true) return unapplied({ status: "unapplied", path: at.path, reason: "several", matches });
      after = op.all === true ? old.split(op.old).join(op.new) : old.replace(op.old, () => op.new);
      break;
    }
    case "delete":
      if (old === null) return unapplied({ status: "unapplied", path: at.path, reason: "missing" });
      after = null;
      break;
  }
  if (after === null) await rm(at.disk);
  else {
    await mkdir(dirname(at.disk), { recursive: true });
    if (op.op === "append" && old !== null) await appendFile(at.disk, op.text, "utf8");
    else await writeWhole(at.disk, after);
  }
  const result: Written = {
    status: "written",
    path: at.path,
    kind: at.kind,
    op: op.op,
    bytes: after === null ? 0 : Buffer.byteLength(after, "utf8"),
    hash: after === null ? null : sha256(after),
    before: old === null ? null : sha256(old),
  };
  return { result, old, after };
}

export function treeFiles(deps: TreeFilesDeps): TreeFiles {
  function check(scope: Scope | UserScope): void {
    if (scope.user !== deps.user) throw new Error(`This RPE belongs to the Lumiverse user ${JSON.stringify(deps.user)}, not ${JSON.stringify(scope.user)}.`);
    if (!namesChat(scope)) return;
    safeId("session", scope.session);
    if (scope.turn !== undefined) safeId("turn", scope.turn);
  }

  /** Where a scope's levels are on disk: its chat's, or, with no chat in view, the tree's folder alone. */
  function location(scope: Scope | UserScope): ChatLocation {
    check(scope);
    if (!namesChat(scope)) return { files: deps.files, character: null, chat: null };
    const folders = deps.chats.folders(scope.user, scope.chat);
    return { files: deps.files, character: folders?.character ?? null, chat: folders?.chat ?? null };
  }

  /** Finds a path of the scope's view: with no chat in view, a path at a character's or a chat's level, the root among them, is outside it. */
  async function lookupIn(scope: Scope | UserScope, loc: ChatLocation, path: string): Promise<Lookup> {
    const found = await locate(loc, path);
    if (found.ok && !namesChat(scope) && !SHARED.includes(found.at.level)) return { ok: false, path: found.at.path, reason: "outside" };
    return found;
  }

  /** The scope's places: its session's and its turn's ids name folders, each no longer than the setting `files.idChars` at the chat's levels. */
  async function places(scope: Scope): Promise<Places> {
    const { idChars } = await treeSettingsOf(location(scope));
    for (const [what, id] of [["session", scope.session], ["turn", scope.turn]] as const) {
      if (id !== undefined && id.length > idChars) throw new Error(`A ${what} id names a folder, so it is at most ${idChars} characters (the setting files.idChars), and this one is ${id.length}.`);
    }
    return placesOf(scope, scope.turn === undefined ? null : await deps.turnFolder(scope));
  }

  async function refusal(scope: Scope | UserScope, path: string, reason: Refused["reason"], writer: Writer | undefined): Promise<Refused> {
    // A scope that names only the user writes nowhere.
    if (!namesChat(scope)) return { status: "refused", path, reason, writable: [] };
    const at = await places(scope);
    return { status: "refused", path, reason, writable: writer === undefined ? at.writable : writableFor(at, writer) };
  }

  async function disk(scope: Scope, view: string): Promise<string | null> {
    const lookup = await locate(location(scope), view);
    return lookup.ok ? lookup.at.disk : null;
  }

  async function find(scope: Scope | UserScope, query: FileQuery): Promise<Found | Refused> {
    const loc = location(scope);
    const lookup = await lookupIn(scope, loc, query.path ?? "");
    if (!lookup.ok) return await refusal(scope, lookup.path, lookup.reason, undefined);
    const at = lookup.at;
    // A find that names no limit gives at most the user's setting; one that names a limit gets that many, `Infinity` every hit. The port can't tell an agent's find from RPE's or RPH's own, which list a turn's folder or a chat's sessions whole, and RPH holds a limit an agent names to the user's `tools.perCall` before it asks.
    const settings = await treeSettingsOf(loc);
    const limit = query.limit ?? settings.findLimit;
    const hits: FileHit[] = [];
    if (limit <= 0) return { status: "found", hits };
    // One hit past the limit is looked for, so that a find stopped at its limit knows that more were there and says so.
    const room = limit + 1;
    const found = (all: FileHit[], stopped: FindStopped = {}): Found => {
      const more = all.length > limit;
      const why: FindStopped = { ...stopped, ...(more ? { limit: { max: limit } } : {}) };
      return { status: "found", hits: more ? all.slice(0, limit) : all, ...(Object.keys(why).length > 0 ? { stopped: why } : {}) };
    };
    const root = at.level === "chat" && at.rest.length === 0;
    if (at.is === "none" || at.disk === null) {
      // A chat's folder not made yet still shows where the other levels are mounted.
      if (!root || query.by !== "list") return found(hits);
    }

    if (query.by === "list") {
      if (at.is === "file" && at.disk !== null) return found([await fileHit(at.level, at.rest, at.disk)]);
      if (at.is === "folder" && at.disk !== null) {
        for await (const e of walk(loc, at.level, at.rest, at.disk, query.depth ?? 1)) {
          if (hits.length >= room) break;
          hits.push(e.folder ? { path: viewPath(at.level, e.rest), type: "folder", level: at.level, kind: kindOf(at.level, e.rest) } : await fileHit(at.level, e.rest, e.disk));
        }
      }
      // The root shows where the other levels are mounted.
      if (root) {
        for (const level of ["shipped", "global", "character"] as const) hits.push({ path: MOUNTS[level], type: "folder", level, kind: "yours" });
        hits.sort((a, b) => byPath({ name: a.path, folder: a.type === "folder" }, { name: b.path, folder: b.type === "folder" }));
      }
      return found(hits);
    }
    if (at.disk === null) return found(hits);
    const within = { ...at, disk: at.disk };

    if (query.by === "glob") {
      const glob = new Bun.Glob(query.pattern);
      for await (const f of filesAt(loc, within)) {
        if (hits.length >= room) break;
        if (glob.match(below(at, f.rest))) hits.push(await fileHit(at.level, f.rest, f.disk));
      }
      return found(hits);
    }

    const pattern = new RegExp(query.literal === true ? query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query.pattern, query.ignoreCase === true ? "i" : "");
    const only = query.glob === undefined ? undefined : new Bun.Glob(query.glob);
    const { grepBytes, grepLineChars, grepMs } = settings;
    // A pattern may take time that grows with the cube of the text it is tested on, and the turn's folder holds lines of whole prompts:
    // a grep tests no more of a line than a hit shows, and stops with what it found once it has run `grepMs`, so it never holds RPE's one thread long.
    const stopAt = performance.now() + grepMs;
    /** The files over the grep's size that it passed over, the hits whose line it cut, and whether it ran out of time with more to look at. */
    let large = 0;
    const cutLines = new Set<FileHit>();
    let late = false;
    files: for await (const f of filesAt(loc, within)) {
      if (hits.length >= room) break;
      if (performance.now() >= stopAt) {
        late = true;
        break;
      }
      if (only !== undefined && !only.match(below(at, f.rest))) continue;
      const bytes = (await stat(f.disk)).size;
      if (bytes > grepBytes) {
        large += 1;
        continue;
      }
      const data = await readFile(f.disk);
      if (data.includes(0)) continue;
      const lines = data.toString("utf8").split("\n");
      if (lines.at(-1) === "") lines.pop();
      for (const [i, whole] of lines.entries()) {
        if (hits.length >= room) break files;
        if (performance.now() >= stopAt) {
          late = true;
          break files;
        }
        const line = whole.slice(0, grepLineChars);
        if (!pattern.test(line)) continue;
        const hit: FileHit = { path: viewPath(at.level, f.rest), type: "file", level: at.level, kind: kindOf(at.level, f.rest), bytes, line: i + 1, text: line };
        hits.push(hit);
        if (whole.length > grepLineChars) cutLines.add(hit);
      }
    }
    const cutCount = hits.slice(0, limit).filter((hit) => cutLines.has(hit)).length;
    return found(hits, {
      ...(large > 0 ? { large: { files: large, bytes: grepBytes } } : {}),
      ...(cutCount > 0 ? { cut: { lines: cutCount, chars: grepLineChars } } : {}),
      ...(late ? { time: { ms: grepMs } } : {}),
    });
  }

  return {
    async layers(scope) {
      check(scope);
      // With no chat in view, the two levels every chat shares, under the same mounts.
      return namesChat(scope) ? treeLayers() : treeLayers().filter((layer) => SHARED.includes(layer.level));
    },

    places,

    async read(scope, path, range): Promise<FileRead> {
      const lookup = await lookupIn(scope, location(scope), path);
      if (!lookup.ok) return await refusal(scope, lookup.path, lookup.reason, undefined);
      const at = lookup.at;
      if (at.is === "none" || at.disk === null) return { status: "missing", path: at.path };
      if (at.is === "folder") return { status: "missing", path: at.path, folder: true };
      const [data, info] = await Promise.all([readFile(at.disk), stat(at.disk)]);
      const part = cut(data.toString("utf8"), range);
      return { status: "read", path: at.path, level: at.level, kind: at.kind, text: part.text, start: part.start, end: part.end, lines: part.lines, bytes: data.byteLength, hash: sha256(data), modified: info.mtimeMs };
    },

    find,

    async write(scope, path, op, by) {
      const loc = location(scope);
      const lookup = await lookupIn(scope, loc, path);
      if (!lookup.ok) return await refusal(scope, lookup.path, lookup.reason, by);
      // With no chat in view, what is found is a level every chat shares: no one's to write through the port.
      if (!namesChat(scope)) return await refusal(scope, lookup.at.path, "mounted", by);
      const writable = writableFor(await places(scope), by);
      const reason = lookup.at.disk === null ? "outside" : refusalFor(lookup.at, writable);
      if (reason !== undefined || lookup.at.disk === null) return await refusal(scope, lookup.at.path, reason ?? "outside", by);
      // One queue for each file on disk, however its path is spelt: a disk that folds case or Unicode holds `a.md` and `A.md` as one.
      return oneFileAtATime(await fileKey(deps.files, lookup.at.disk), async () => {
        // Found again in this file's turn, so a write that waited sees what the one before it left.
        const again = await locate(loc, path);
        if (!again.ok) return await refusal(scope, again.path, again.reason, by);
        if (again.at.disk === null) return await refusal(scope, again.at.path, "outside", by);
        const before = await sizeOfFile(again.at.disk);
        const { result, old, after } = await apply({ ...again.at, disk: again.at.disk }, op);
        if (result.status === "written" && again.at.level === "chat") await deps.chats.grew(scope.user, scope.chat, areaOf(again.at.rest), result.bytes - before);
        // A note written in a turn is recorded against it, with what the file held before and after, and stands in the chat's notes
        // folder (`notes.ts`), so a swipe, a delete, a branch or the lead dropping a sub-agent's writes can put the notes back.
        if (result.status === "written" && result.kind === "notes" && by !== "harness" && scope.turn !== undefined) {
          const turn = scope.turn;
          await deps.writes.run((db) => {
            const row = db.run("INSERT INTO note_version (user, chat, turn, agent, path, before, after, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [scope.user, scope.chat, turn, JSON.stringify(by), result.path, old, result.hash, after, deps.now()]);
            db.run("INSERT INTO tree_applied (user, chat, write_id) VALUES (?, ?, ?)", [scope.user, scope.chat, Number(row.lastInsertRowid)]);
          }, "recording an agent's note");
        }
        return result;
      });
    },

    async turnDisk(scope) {
      const at = await places(scope);
      return at.turn === undefined ? null : await disk(scope, at.turn);
    },

    async sessionDisk(scope) {
      return await disk(scope, (await places(scope)).session);
    },

    async update(scope, path, change) {
      const loc = location(scope);
      const lookup = await lookupIn(scope, loc, path);
      if (!lookup.ok) return await refusal(scope, lookup.path, lookup.reason, "harness");
      const reason = lookup.at.disk === null ? "outside" : refusalFor(lookup.at, writableFor(await places(scope), "harness"));
      if (reason !== undefined || lookup.at.disk === null) return await refusal(scope, lookup.at.path, reason ?? "outside", "harness");
      return oneFileAtATime(await fileKey(deps.files, lookup.at.disk), async () => {
        const again = await locate(loc, path);
        if (!again.ok) return await refusal(scope, again.path, again.reason, "harness");
        if (again.at.disk === null) return await refusal(scope, again.at.path, "outside", "harness");
        const old = again.at.is === "file" ? await readFile(again.at.disk, "utf8") : null;
        const before = await sizeOfFile(again.at.disk);
        const { result } = await apply({ ...again.at, disk: again.at.disk }, { op: "write", text: change(old) });
        if (result.status !== "written") throw new Error(`${again.at.path} could not be changed (${result.reason}).`);
        await deps.chats.grew(scope.user, scope.chat, areaOf(again.at.rest), result.bytes - before);
        return result;
      });
    },
  };
}
