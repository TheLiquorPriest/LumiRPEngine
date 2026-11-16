// What the Storage page lists of each kind RPE keeps (plan §5.5, §14): its count, its size, the oldest of it,
// and how long it is kept, with the key of the setting that decides it where one does, and when the user last
// pruned. The kinds are the notes, the versions of notes, the suggestions, the turn folders kept whole and
// those pruned, the sessions' own files, the user's own files, the shipped level, the database, the
// migration's backups, the copies of the database made before migrations, and the archives `rpe backup` made.
// It measures; it decides nothing.

import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { LayerLevel } from "rp-harness/contract";
import { listBackups } from "../app/backups-route";
import type { TreeChats } from "./chats";
import { walk } from "./files";
import { CHATS_FOLDER, SESSIONS_FOLDER, SHIPPED_FOLDER, TURNS_FOLDER } from "./layout";
import { KEPT_IN_OLD_TURNS } from "./retention";
import { treeSettingsOf } from "./settings";
import { type ChatLocation, kindOf } from "./view";

/** How long a kind is kept: for good, until the chat is deleted or he prunes it, or by a setting, which names its key and gives what it is now (null: none, all kept). */
export type KeptFor = { by: "never" } | { by: "chat" } | { by: "setting"; setting: string; value: number | null };

export interface StorageKind {
  kind: string;
  /** How many: files, rows, folders or backups, by what the kind is. */
  count: number;
  bytes: number;
  /** When the oldest of it was made, epoch milliseconds; null where there is none. */
  oldest: number | null;
  kept: KeptFor;
}

export interface StorageKinds {
  kinds: StorageKind[];
  /** When the user last pruned anything the page offers; null when never. */
  lastPrune: number | null;
}

export interface KindsDeps {
  files: string;
  chats: TreeChats;
  db: Database;
  /** The data folder's backups. */
  backups: string;
  /** How many copies of the database taken before migrations are kept (`database.copiesKept`). */
  copiesKept: number;
}

interface Tally {
  count: number;
  bytes: number;
  oldest: number | null;
}

const empty = (): Tally => ({ count: 0, bytes: 0, oldest: null });

function add(t: Tally, bytes: number, at: number | null, count = 1): void {
  t.count += count;
  t.bytes += bytes;
  if (at !== null && (t.oldest === null || at < t.oldest)) t.oldest = at;
}

/** The kinds of the files of one level's tree below `rest`, measured. */
interface Totals {
  notes: Tally;
  sessions: Tally;
  yours: Tally;
  shipped: Tally;
  /** Each turn folder: its bytes, whether it holds more than an old one keeps, and when its oldest file was made. */
  turns: Map<string, { bytes: number; whole: boolean; oldest: number }>;
}

async function tally(loc: ChatLocation, level: LayerLevel, totals: Totals, key: string): Promise<void> {
  const base = level === "global" ? loc.files : join(loc.files, ...(level === "shipped" ? [SHIPPED_FOLDER] : [CHATS_FOLDER, loc.character ?? "", ...(level === "chat" ? [loc.chat ?? ""] : [])]));
  for await (const e of walk(loc, level, [], base, Number.POSITIVE_INFINITY)) {
    if (e.folder) continue;
    const info = await stat(e.disk).catch(() => null);
    if (info === null) continue;
    if (level === "shipped") {
      add(totals.shipped, info.size, info.mtimeMs);
    } else if (kindOf(level, e.rest) === "notes") {
      add(totals.notes, info.size, info.mtimeMs);
    } else if (level === "chat" && e.rest[0] === SESSIONS_FOLDER) {
      if (e.rest[2] === TURNS_FOLDER && e.rest[3] !== undefined) {
        const turn = `${key}/${e.rest[1]}/${e.rest[3]}`;
        const held = totals.turns.get(turn) ?? { bytes: 0, whole: false, oldest: info.mtimeMs };
        held.bytes += info.size;
        held.oldest = Math.min(held.oldest, info.mtimeMs);
        if (e.rest[4] !== undefined && !KEPT_IN_OLD_TURNS.includes(e.rest[4])) held.whole = true;
        totals.turns.set(turn, held);
      } else add(totals.sessions, info.size, info.mtimeMs);
    } else if (kindOf(level, e.rest) === "yours") add(totals.yours, info.size, info.mtimeMs);
  }
}

/** The kinds, as the tree and the database hold them for `user`. */
export async function storageKinds(deps: KindsDeps, user: string): Promise<StorageKinds> {
  const totals: Totals = { notes: empty(), sessions: empty(), yours: empty(), shipped: empty(), turns: new Map() };
  const none: ChatLocation = { files: deps.files, character: null, chat: null };
  await tally(none, "global", totals, "");
  await tally(none, "shipped", totals, "");
  const characters = new Set<string>();
  for (const c of deps.chats.placed(user)) {
    const loc: ChatLocation = { files: deps.files, character: c.character, chat: c.folder };
    if (!characters.has(c.character)) {
      characters.add(c.character);
      await tally(loc, "character", totals, c.character);
    }
    await tally(loc, "chat", totals, `${c.character}/${c.folder}`);
  }
  const whole = empty();
  const pruned = empty();
  for (const t of totals.turns.values()) add(t.whole ? whole : pruned, t.bytes, t.oldest);

  const global = await treeSettingsOf(none);
  const versions = deps.db.query<{ n: number; bytes: number; oldest: number | null }, [string]>("SELECT count(*) AS n, COALESCE(sum(COALESCE(length(before), 0) + COALESCE(length(after), 0) + COALESCE(length(text), 0)), 0) AS bytes, min(at) AS oldest FROM note_version WHERE user = ?").get(user);
  const suggestions = deps.db.query<{ n: number; bytes: number; oldest: number | null }, [string]>("SELECT count(*) AS n, COALESCE(sum(length(text) + length(reason)), 0) AS bytes, min(at) AS oldest FROM suggestion WHERE user = ?").get(user);
  const database = deps.db.filename === "" || deps.db.filename === ":memory:" ? 0 : (await stat(deps.db.filename).then((s) => s.size, () => 0)) + (await stat(`${deps.db.filename}-wal`).then((s) => s.size, () => 0));
  const backups = await listBackups(deps.backups);
  const ofBackups = (kind: "migration" | "copy" | "archive"): Tally => {
    const t = empty();
    for (const b of backups.filter((x) => x.kind === kind)) add(t, b.bytes, b.at);
    return t;
  };
  const lastPrune = deps.db.query<{ at: number }, [string]>("SELECT at FROM tree_prune WHERE user = ?").get(user)?.at ?? null;
  const of = (kind: string, t: Tally, kept: KeptFor): StorageKind => ({ kind, ...t, kept });
  return {
    kinds: [
      of("notes", totals.notes, { by: "never" }),
      of("note versions", { count: versions?.n ?? 0, bytes: versions?.bytes ?? 0, oldest: versions?.oldest ?? null }, { by: "setting", setting: "notes.versionsKept", value: null }),
      of("suggestions", { count: suggestions?.n ?? 0, bytes: suggestions?.bytes ?? 0, oldest: suggestions?.oldest ?? null }, { by: "setting", setting: "suggestions.decidedKept", value: global.suggestionsDecidedKept }),
      of("turn folders kept whole", whole, { by: "setting", setting: "retention.turnFolders", value: global.turnFolders }),
      of("turn folders pruned", pruned, { by: "chat" }),
      of("session files", totals.sessions, { by: "chat" }),
      of("your files", totals.yours, { by: "never" }),
      of("the shipped level", totals.shipped, { by: "never" }),
      of("the database", { count: 1, bytes: database, oldest: null }, { by: "never" }),
      of("the migration's backups", ofBackups("migration"), { by: "never" }),
      of("database copies", ofBackups("copy"), { by: "setting", setting: "database.copiesKept", value: deps.copiesKept }),
      of("archives", ofBackups("archive"), { by: "never" }),
    ],
    lastPrune,
  };
}
