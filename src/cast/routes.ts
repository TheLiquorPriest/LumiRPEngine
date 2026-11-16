// The Cast page's routes (plan §14, §7): who is in a chat's cast, and one character's whole record,
// each at the chat's newest turn or as it stood at one of its turns; an entry of a character's
// record struck from the page, or its strike taken back; a perception written for a turn that has
// a gap; and the owner's own edits of a character: its casting set or pinned (or the pin taken
// away), its base redrawn, a source bound, said again or taken away, and which of the world's
// people it is. Every route is a page's: it answers only for the user this RPE belongs to. What it
// shows is the record as stored, every entry with the turn that wrote it, who wrote it (an agent's
// definition, the player, or the migration) and whether it is struck, and every write of it on the
// path; beside it the base as it stands with the accepted growth laid over it, each bound source
// read live in Lumiverse and marked current, changed, unseen, gone or unread against the base, a
// principal's whereabouts and intention while it is away, and its game side by reference to the
// world's person it is. Each list is bounded by `cast.queryItems` and read further back with `part`
// and `skip`. This is the player's page, not an agent's view: nothing is cut by what a character
// knows, by its casting or by a budget.
//
// A strike is the player's own change, written by the cast's own writer on the chat's newest turn, the
// turn the next one follows, as the play panels record a tap there, and with what the cast's tools
// do when they strike: a struck perception strikes the knowledge it gave, and struck knowledge takes
// back each secret's holding that no other knowledge of that character still gives, recorded on the
// same turn. Taking a strike back stands the entry again, as the tools' `drop: false` does; a
// perception's stands the knowledge its strike struck with it, and knowledge standing again holds its
// secret again, as `cast_update` holds one. Knowledge struck apart from the perception stays struck, and
// a secret nothing standing gives stays let go: the answer says so. Every write of a page is the
// owner's own change, of no turn and placed after the newest reply, so it lands while a run goes on
// and in a branch with no turn of its own, and the Author is told of it in the next briefing as his
// own edit; what the record keeps outside turns (a base document, a source, which person it is) is
// noted in the story lane by an `edit` entry. Each write tells the chat's pages to read again. The
// words of every refusal are lines of `.prompts/cast-answers.md`, as the chat has them.

import type { JsonObject } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import { gameSide } from "./game";
import { IFACE_DEFAULTS, type Writes, Reply } from "../iface/kit";
import { nearestOf } from "../iface/reading";
import { type Fields, type GuidanceFiles, textOf } from "../iface/texts";
import type { LedgerEvent } from "../shared/ledger";
import { JoinedTurnError, type Store, type UserStore } from "../store";
import { fileName, IMPORTED_KIND, importedText, isFiled } from "./imported";
import type { OnStage, StageRead } from "./facts";
import { CAST_DEFAULTS, type CastCall, type CastClock, castClock, castLines, type CastSettings } from "./kit";
import { memoriesNow, type Tier } from "./memory";
import { castAt } from "./path";
import { perceivedTurn, perceiveAsPlayer } from "./perceive";
import {
  awayItemId,
  baseHistory,
  type BasePart,
  BASE_PARTS,
  baseOf,
  bindingsOf,
  bindSource,
  type Casting,
  castingInForce,
  castingItemId,
  type CastItem,
  CastRecord,
  type CastRow,
  type CastWriter,
  type Character,
  charactersOf,
  chatLine,
  findCharacter,
  pinCasting,
  type RowPart,
  setPerson,
  sourceKey,
  type SourceKind,
  unbindSource,
  writeBase,
  writeCast,
} from "./record";
import { forgetsOf, holdingChanges, personNamed, secretsHeldAgain, secretsLetGo, worldAt } from "./secrets";
import {
  type CastCharacter,
  type CastCounts,
  type CastEdited,
  type CastEntryShown,
  type CastHeld,
  type CastKind,
  type CastList,
  type CastMemberShown,
  type CastPerceptionWritten,
  type CastSourceShown,
  type CastStrike,
  type CastStruck,
  type CastWriteShown,
  castEditedReply,
  castReply,
  castStrikeBody,
  castStrikeReply,
  castingBody,
  characterListName,
  type CharacterList,
  characterReply,
  baseBody,
  personBody,
  type PerceptionRecord,
  perceptionBody,
  perceptionRecordReply,
  perceptionWrittenReply,
  sourceBody,
  type StagePersonShown,
  type StageTurnShown,
} from "./shapes";
import { freshnessOf, type SourceNow, type SourceReader, sourcesNow } from "./sources";
import { CAST_LANE, type Unread } from "./update";

export const CAST_PATH = "/api/v1/chats/:chat/cast";
export const CHARACTER_PATH = "/api/v1/chats/:chat/cast/:character";
export const CHARACTER_STRIKE_PATH = "/api/v1/chats/:chat/cast/:character/strike";
export const CHARACTER_CASTING_PATH = "/api/v1/chats/:chat/cast/:character/casting";
export const CHARACTER_BASE_PATH = "/api/v1/chats/:chat/cast/:character/base";
export const CHARACTER_SOURCES_PATH = "/api/v1/chats/:chat/cast/:character/sources";
export const CHARACTER_PERSON_PATH = "/api/v1/chats/:chat/cast/:character/person";
export const PERCEPTIONS_PATH = "/api/v1/chats/:chat/perceptions";
export const CHARACTER_PERCEPTIONS_PATH = "/api/v1/chats/:chat/cast/:character/perceptions";

/** Who a change from the page is by, and where it came from: the player, as the store's sources name them and the play panels record their taps. */
const PLAYER = "player";

export interface CastRoutesDeps {
  /** RPE's store: its database holds the cast. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** The guidance files in force for the chat: the page's words are lines of `.prompts/cast-answers.md`. */
  files(user: string, chat: string): GuidanceFiles;
  /** The cast's settings for the chat, over `CAST_DEFAULTS`: what memories' tiers and fading are worked out by. */
  settings(user: string, chat: string): Promise<Partial<CastSettings>>;
  /** Who was on stage in each of some turns and how that was read: the turn lane's one reading of a stage (R-56). */
  onStage: OnStage;
  /** A character's sources as Lumiverse holds them now: marks each source on the page, and refuses to bind one Lumiverse does not hold. */
  sources: SourceReader;
  /** Tells everyone following the chat that its record changed, after each write of a page, so that the pages read it again. */
  changed(chat: string): void;
  /** Milliseconds since 1970, for the time of a strike's rows; `Date.now` when absent. */
  now?: () => number;
}

/** Why a page's request is not done: its status, and the line of the cast's answers that says so. */
class Refused extends Error {
  constructor(
    readonly status: number,
    readonly line: string,
    readonly fields: Fields = {},
  ) {
    super(line);
  }
}

/** Runs a page's request; a refusal is answered in the cast's words as the chat has them, none when the user deleted the line. */
async function inWords<T>(deps: CastRoutesDeps, user: string, chat: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    const lines = await castLines(deps.files(user, chat));
    throw new RouteError(error.status, lines.line(error.line, error.fields) ?? "");
  }
}

/** What a page reads: the chats whose characters the chat knows, the rows on the path read, story time there, and which turns a migration's import wrote. */
interface Reading {
  store: Store;
  user: string;
  s: UserStore;
  chats: string[];
  record: CastRecord;
  clock: CastClock | null;
  imported(turn: string): boolean;
}

/** The cast at `turn` of the chat (null: its newest), for a chat the user's store holds. */
function readingAt(store: Store, user: string, chat: string, turn: string | null): Reading {
  const s = store.user(user);
  const known = new Map<string, boolean>();
  return {
    store,
    user,
    s,
    chats: chatLine(s, chat),
    record: CastRecord.read(store, user, castAt(s, chat, turn)),
    clock: castClock(store, user, chat, turn),
    imported(t) {
      let was = known.get(t);
      if (was === undefined) known.set(t, (was = s.turn(t)?.imported === true));
      return was;
    },
  };
}

/** The user's store, holding the chat the path names. */
function chatHeld(store: Store, user: string, chat: string): UserStore {
  const s = store.user(user);
  if (s.chat(chat) === null) throw new Refused(404, "no_chat", { id: chat });
  return s;
}

/**
 * The turn the query names, one of the chat's (none named: the chat's newest), of a chat the user's store holds. A turn that was
 * joined to another (a continue's held turn) is answered as a fact naming the turn it joined, for the server to answer in its one place.
 */
function asked(store: Store, user: string, chat: string, turn: string | undefined): string | null {
  const s = chatHeld(store, user, chat);
  if (turn === undefined) return null;
  const row = s.turn(turn);
  if (row?.chat !== chat) throw new Refused(404, "no_turn", { id: turn });
  if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
  return turn;
}

/** A strike as read from the page: the entry, whether it is struck or its strike taken back, and why, where the player said. */
interface StrikeAsked {
  id: string;
  struck: boolean;
  why: string | null;
}

/** Knowledge a perception's strike taken back leaves struck, struck apart from it: its id and words, the perception, and the secret it gave that nothing standing gives. */
interface LeftStruck {
  id: string;
  from: string;
  text?: string;
  secret?: string;
}

/**
 * What a strike recorded: the entry written to, whether anything was, the knowledge struck (or stood again) with it, the secrets let go
 * (or held again), the knowledge left struck, and what could not be done.
 */
interface StrikeDone {
  item: string;
  changed: boolean;
  also: string[];
  letGo: string[];
  held: string[];
  left: LeftStruck[];
  unread: Unread[];
}

/** A strike as the page sends it, in the form the cast takes it in: the entry without the space around it, and why only where there is some. */
function strikeOf(body: CastStrike): StrikeAsked {
  return { id: body.id.trim(), struck: body.struck, why: typeof body.why === "string" && body.why.trim() !== "" ? body.why.trim() : null };
}

/**
 * Of the knowledge a perception gave that is struck, what the perception's strike struck with it, written after it by the same write
 * (that write's turn, writer and moment, as `perceive`'s strike and this page write them), and what was struck apart from it.
 */
function struckWith(perception: CastItem, gave: readonly CastItem[]): { with: CastItem[]; apart: CastItem[] } {
  const strikeRow = (item: CastItem): CastRow | undefined => item.rows.findLast((row) => row.value.drop === true);
  const its = strikeRow(perception);
  const out: { with: CastItem[]; apart: CastItem[] } = { with: [], apart: [] };
  for (const k of gave.filter((g) => g.dropped)) {
    const row = strikeRow(k);
    const same = its !== undefined && row !== undefined && row.s > its.s && row.turn === its.turn && row.by === its.by && row.agent === its.agent && row.when === its.when;
    (same ? out.with : out.apart).push(k);
  }
  return out;
}

/**
 * Writes a strike, or takes one back, as the player's own change (the store's own changes: of no turn, placed after the newest reply),
 * inside one queued write that reads the record it changes. It lands while a turn of the chat runs, and in a branch with no turn of its
 * own, as every edit of his does; the next briefing tells the Author of it.
 */
function struck(deps: CastRoutesDeps, user: string, chat: string, said: string, ask: StrikeAsked, confidence: number): Promise<StrikeDone> {
  return deps.writes.run((db) => {
    const r = readingAt(deps.store, user, chat, null);
    const character = findCharacter(db, user, r.chats, said);
    if (character === null) throw new Refused(404, "no_character", { who: said });
    const item = r.record.items.get(ask.id);
    // A casting is set, never struck: striking it would change nothing that is read.
    if (item === undefined || item.character !== character.id || item.part === "casting") throw new Refused(404, "page_no_entry", { who: character.name, id: ask.id });
    if (item.dropped === ask.struck) return { item: item.id, changed: false, also: [], letGo: [], held: [], left: [], unread: [] };
    // His own change, of no turn: placed after the newest reply, so it lands whatever runs, and in a branch with no turn of its own.
    const writer: CastWriter = { user, turn: null, chat, by: PLAYER, agent: null, job: null, at: r.clock?.now ?? null, now: (deps.now ?? Date.now)(), source: PLAYER };
    const value: JsonObject = ask.struck ? { drop: true, ...(ask.why !== null ? { why: ask.why } : {}) } : { drop: false };
    // As `perceive` strikes a perception: the knowledge it gave goes with it. Taken back, what went with it stands again with it,
    // and knowledge struck apart from it stays struck.
    const gave = item.part === "perception" ? r.record.of(character.id, "knowledge", true).filter((k) => k.fields.from === item.id) : [];
    const back = ask.struck ? null : struckWith(item, gave);
    const also = back === null ? gave.filter((k) => !k.dropped) : back.with;
    writeCast(
      deps.store,
      writer,
      [item, ...also].map((i) => ({ character: character.id, part: i.part, item: i.id, value })),
    );
    const unread: Unread[] = [];
    const knowledge = item.part === "knowledge" ? [item] : also;
    const ctx = knowledge.length > 0 ? worldAt(deps.store, user, null, null, chat) : null;
    const record = (events: readonly LedgerEvent[]): void => {
      if (events.length > 0) r.s.record(r.s.writeTarget({ chat }), holdingChanges(events, CAST_LANE, PLAYER, null).map((c) => ({ ...c, source: PLAYER })));
    };
    if (back === null) {
      // As `cast_update` and `perceive` strike knowledge: each secret it gave is let go, unless other knowledge of theirs still gives it.
      const forgets = forgetsOf(ctx, 1, item.part, character, secretsLetGo(r.record, character.id, knowledge), unread);
      record(forgets.flatMap((f) => f.events));
      return { item: item.id, changed: true, also: also.map((k) => k.id), letGo: forgets.flatMap((f) => (f.events.length > 0 ? [f.fact] : [])), held: [], left: [], unread };
    }
    // As `cast_update` holds knowledge of a secret: each secret the knowledge standing again gives is held again, once.
    const secretOf = (k: CastItem): string | null => (typeof k.fields.secret === "string" ? k.fields.secret : null);
    const asked = new Set<string>();
    const holds = knowledge.flatMap((k) => {
      const fact = secretOf(k);
      if (fact === null || asked.has(fact)) return [];
      asked.add(fact);
      return secretsHeldAgain(ctx, { n: 1, op: item.part, field: "secret" }, character, k.fields.told_by, r.s.turn(k.opened), [fact], confidence, unread);
    });
    record(holds.flatMap((h) => h.events));
    // What stays struck is said, with the secret it gave where no knowledge standing now gives that.
    const given = new Set([...r.record.of(character.id, "knowledge"), ...knowledge].flatMap((k) => secretOf(k) ?? []));
    const left = back.apart.map((k): LeftStruck => {
      const secret = secretOf(k);
      return { id: k.id, from: item.id, ...(typeof k.fields.text === "string" ? { text: k.fields.text } : {}), ...(secret !== null && !given.has(secret) ? { secret } : {}) };
    });
    return { item: item.id, changed: true, also: also.map((k) => k.id), letGo: [], held: holds.flatMap((h) => (h.events.length > 0 ? [h.fact] : [])), left, unread };
  }, "striking an entry of the cast from a page");
}

/** Each kind of entry by the part it is kept as; a mind entry of the carried files' kind is a file. */
function kindOf(item: CastItem): CastKind | null {
  switch (item.part) {
    case "casting":
    case "away":
    case "edit":
      return null;
    case "mind":
      return item.fields.kind === IMPORTED_KIND ? "files" : "mind";
    case "memory":
      return "memories";
    case "relationship":
      return "relationships";
    case "perception":
      return "perceptions";
    default:
      return item.part;
  }
}

function emptyCounts(): CastCounts {
  const held = (): CastHeld => ({ held: 0, struck: 0 });
  return { growth: held(), mind: held(), memories: held(), relationships: held(), knowledge: held(), history: held(), perceptions: held(), files: { ...held(), filed: 0 } };
}

/** Each character on the reading as the cast lists it, in the order given. */
function membersOf(r: Reading, characters: readonly Character[]): CastMemberShown[] {
  const counts = new Map<string, CastCounts>();
  const from = new Map<string, { carried: boolean; played: boolean }>();
  for (const item of r.record.items.values()) {
    const seen = from.get(item.character) ?? { carried: false, played: false };
    for (const row of item.rows) {
      if (r.imported(row.turn)) seen.carried = true;
      else seen.played = true;
    }
    from.set(item.character, seen);
    const kind = kindOf(item);
    if (kind === null) continue;
    const mine = counts.get(item.character) ?? emptyCounts();
    counts.set(item.character, mine);
    if (item.dropped) mine[kind].struck++;
    else mine[kind].held++;
    if (kind === "files" && !item.dropped && isFiled(item)) mine.files.filed++;
  }
  return characters.map((c) => {
    const casting = castingInForce(r.record, c);
    return {
      id: c.id,
      name: c.name,
      chat: c.chat,
      person: c.person,
      casting: casting === null ? null : { as: casting.as, pinned: casting.pinned, line: casting.line },
      from: from.get(c.id) ?? { carried: false, played: false },
      counts: counts.get(c.id) ?? emptyCounts(),
    };
  });
}

function writeShown(r: Reading, row: CastRow): CastWriteShown {
  return { turn: row.turn === "" ? null : row.turn, message: r.record.at.replyOf(row.turn), imported: r.imported(row.turn), by: row.by, wrote: row.value };
}

function entryShown(r: Reading, item: CastItem): CastEntryShown {
  return {
    id: item.id,
    part: item.part as CastEntryShown["part"],
    fields: item.fields,
    date: item.at !== null && r.clock !== null ? r.clock.text(item.at) : null,
    turn: item.opened === "" ? null : item.opened,
    message: r.record.at.replyOf(item.opened),
    imported: r.imported(item.opened),
    by: item.rows[0]?.by ?? null,
    struck: item.dropped,
    writes: item.rows.map((row) => writeShown(r, row)),
  };
}

/** What a page asks of the lists: the one it reads further back (none: every list), how many of its newest to pass over, and how many a list gives. */
interface ListAsk {
  part: CharacterList | null;
  skip: number;
  size: number;
}

/** The newest `size` of a list after passing over its newest `skip`, each shown as `show` has it, with what was left out on either side. */
function bounded<T, S>(all: readonly T[], size: number, skip: number, show: (item: T) => S): { items: S[]; total: number; before: number; after: number } {
  const end = Math.max(0, all.length - skip);
  const start = Math.max(0, end - size);
  return { items: all.slice(start, end).map(show), total: all.length, before: start, after: all.length - end };
}

/** Each source bound to a character as Lumiverse holds it now, against the base; one Lumiverse cannot be asked about is unread. */
async function sourcesShown(deps: CastRoutesDeps, r: Reading, character: Character): Promise<CastSourceShown[]> {
  const { db } = r.store;
  const scope = { user: r.user, chat: r.record.at.chat };
  const bindings = bindingsOf(db, r.user, character.id);
  const asked = new Map<string, SourceNow | null | "unread">();
  await Promise.all(
    bindings.map(async (b) => {
      try {
        asked.set(sourceKey(b.kind, b.ref), await deps.sources(scope, { kind: b.kind, ref: b.ref }));
      } catch {
        asked.set(sourceKey(b.kind, b.ref), "unread");
      }
    }),
  );
  const states = await sourcesNow(
    async (_scope, src) => {
      const found = asked.get(sourceKey(src.kind, src.ref));
      return found === undefined || found === "unread" ? null : found;
    },
    scope,
    bindings,
    baseOf(db, r.user, character.id, scope.chat).values(),
  );
  return states.map((s): CastSourceShown => ({ kind: s.kind, ref: s.ref, defines: s.defines, created: s.created, title: s.title, state: asked.get(sourceKey(s.kind, s.ref)) === "unread" ? "unread" : freshnessOf(s) }));
}

/** Everything on one character's record at the reading. */
async function characterShown(deps: CastRoutesDeps, r: Reading, character: Character, settings: CastSettings, ask: ListAsk): Promise<Omit<CastCharacter, "chat" | "turn">> {
  const { db } = r.store;
  const chat = r.record.at.chat;
  const all = (part: RowPart): CastItem[] => r.record.of(character.id, part, true);
  const list = <S>(name: CharacterList, items: readonly CastItem[], show: (item: CastItem) => S) => bounded(items, ask.size, ask.part === null || ask.part === name ? ask.skip : 0, show);
  const standing = new Map(memoriesNow(r.record, character.id, r.clock?.now ?? null, settings).map((m) => [m.item.id, m]));
  const versions = baseHistory(db, r.user, character.id, chat);
  const newest = new Map(versions.map((v) => [v.part, v.version]));
  const [member] = membersOf(r, [character]);
  const base = [...baseOf(db, r.user, character.id, chat).values()].sort((a, b) => BASE_PARTS.indexOf(a.part) - BASE_PARTS.indexOf(b.part));
  const away = r.record.items.get(awayItemId(character.id));
  return {
    listed: ask.size,
    character: member as CastMemberShown,
    sources: await sourcesShown(deps, r, character),
    base: versions.map((v) => ({ part: v.part, version: v.version, text: v.text, standing: newest.get(v.part) === v.version, turn: v.turn, by: v.by, created: v.created })),
    // The base as it stands, with the growth the Author accepted laid over it, as every view of the base gives it.
    now: {
      parts: base.map((v) => ({ part: v.part, version: v.version, text: v.text })),
      growth: r.record
        .of(character.id, "growth")
        .filter((g) => g.fields.proposed !== true)
        .map((g) => ({ id: g.id, text: typeof g.fields.text === "string" ? g.fields.text : "", cause: typeof g.fields.cause === "string" ? g.fields.cause : null, date: g.at !== null && r.clock !== null ? r.clock.text(g.at) : null })),
    },
    castings: (r.record.items.get(castingItemId(character.id))?.rows ?? []).map((row) => writeShown(r, row)),
    away: away === undefined || away.dropped ? null : entryShown(r, away),
    game: gameSide(r.store, r.user, chat, r.record.at.turn, character),
    growth: list("growth", all("growth"), (i) => entryShown(r, i)),
    mind: list(
      "mind",
      all("mind").filter((i) => i.fields.kind !== IMPORTED_KIND),
      (i) => entryShown(r, i),
    ),
    memories: list("memories", all("memory"), (i) => {
      const now = standing.get(i.id);
      return { ...entryShown(r, i), tier: now?.tier ?? null, strength: now?.strength ?? null, faint: now?.faint ?? false };
    }),
    relationships: list("relationships", all("relationship"), (i) => entryShown(r, i)),
    knowledge: list("knowledge", all("knowledge"), (i) => entryShown(r, i)),
    history: list("history", all("history"), (i) => entryShown(r, i)),
    perceptions: list("perceptions", all("perception"), (i) => {
      const of = perceivedTurn(i);
      return { ...entryShown(r, i), of: { turn: of, message: r.record.at.replyOf(of) } };
    }),
    files: list(
      "files",
      all("mind").filter((i) => i.fields.kind === IMPORTED_KIND),
      (i) => ({ ...entryShown(r, i), file: fileName(i), text: importedText(r.store.db, r.user, i), filed: isFiled(i) }),
    ),
  };
}

/** What the owner's edit of a character works on: the database inside the queued write, the record as it stood, the character, and who writes. */
interface Edit {
  db: Parameters<Parameters<Writes["run"]>[0]>[0];
  r: Reading;
  character: Character;
  writer: CastWriter;
  now: number;
}

/** What an edit did: whether anything changed, and what it could not do or left as it was, in the cast's lines. */
interface Edited {
  changed: boolean;
  notes?: Unread[];
}

/**
 * The owner's own edit of a character, found in the chat's cast and made inside one queued write that reads the record it changes: his own
 * change of no turn, placed after the newest reply, so it lands while a run goes on and in a branch with no turn of its own, and the next
 * briefing tells the Author of it. The pages are told to read again when anything changed. The answer is the character as the cast lists it then.
 */
async function edited(deps: CastRoutesDeps, user: string, chat: string, said: string, tool: string, make: (edit: Edit) => Edited): Promise<CastEdited> {
  chatHeld(deps.store, user, chat);
  const done = await deps.writes.run((db) => {
    const r = readingAt(deps.store, user, chat, null);
    const character = findCharacter(db, user, r.chats, said);
    if (character === null) throw new Refused(404, "no_character", { who: said });
    const now = (deps.now ?? Date.now)();
    const writer: CastWriter = { user, turn: null, chat, by: PLAYER, agent: null, job: null, at: r.clock?.now ?? null, now, source: PLAYER };
    return { id: character.id, ...make({ db, r, character, writer, now }) };
  }, tool);
  if (done.changed) deps.changed(chat);
  const r = readingAt(deps.store, user, chat, null);
  const character = charactersOf(deps.store.db, user, r.chats).find((c) => c.id === done.id) as Character;
  const lines = await castLines(deps.files(user, chat));
  return { changed: done.changed, character: membersOf(r, [character])[0] as CastMemberShown, notes: (done.notes ?? []).flatMap((u) => lines.line(u.line, u.fields) ?? []) };
}

/** The revision of each source bound to a character as Lumiverse holds it now, for the base the owner redraws to say what it was drawn against; one Lumiverse cannot be asked about, or holds none, is left out. */
async function seenNow(deps: CastRoutesDeps, user: string, chat: string, character: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const b of bindingsOf(deps.store.db, user, character)) {
    try {
      const now = await deps.sources({ user, chat }, { kind: b.kind, ref: b.ref });
      if (now !== null) out[sourceKey(b.kind, b.ref)] = now.revision;
    } catch {
      // Lumiverse cannot be asked now: the base is not marked as drawn against it.
    }
  }
  return out;
}

export function castRoutes(deps: CastRoutesDeps) {
  const turnQuery = shape.optional(shape.turnId(), "A turn's id: the cast as it stood at that turn; left out, at the chat's newest.");
  return [
    route({
      method: "GET",
      path: CAST_PATH,
      access: "page",
      group: "cast",
      does: "Every character a chat knows, with what each holds on the path read: at the chat's newest turn, or as it stood at one of its turns.",
      query: { turn: turnQuery },
      reply: castReply,
      joined: true,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, (): CastList => {
          const turn = asked(deps.store, user, params.chat, query.turn);
          const r = readingAt(deps.store, user, params.chat, turn);
          return { chat: params.chat, turn, characters: membersOf(r, charactersOf(deps.store.db, user, r.chats)) };
        }),
    }),
    route({
      method: "GET",
      path: CHARACTER_PATH,
      access: "page",
      group: "cast",
      does: "Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns. The base as it stands with the accepted growth laid over it, each bound source read live and marked against the base, a principal's whereabouts and intention while it is away, and its game side; each list bounded by cast.queryItems, read further back with `part` and `skip`.",
      query: {
        turn: turnQuery,
        part: shape.optional(characterListName, "Read this list further back: with no part named, every list."),
        skip: shape.optional(shape.whole({ least: 0 }), "How many of a list's newest entries to pass over; 0 when left out."),
      },
      reply: characterReply,
      joined: true,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, async (): Promise<CastCharacter> => {
          const turn = asked(deps.store, user, params.chat, query.turn);
          const r = readingAt(deps.store, user, params.chat, turn);
          const character = findCharacter(deps.store.db, user, r.chats, params.character);
          if (character === null) throw new Refused(404, "no_character", { who: params.character });
          const settings: CastSettings = { ...CAST_DEFAULTS, ...(await deps.settings(user, params.chat)) };
          return { chat: params.chat, turn, ...(await characterShown(deps, r, character, settings, { part: query.part ?? null, skip: query.skip ?? 0, size: settings.queryItems })) };
        }),
    }),
    route({
      method: "POST",
      path: CHARACTER_STRIKE_PATH,
      access: "page",
      group: "cast",
      does: "Strikes an entry of a character's record, or takes its strike back, as the player's own change on the chat's newest turn; says what it did, in the cast's words.",
      body: castStrikeBody,
      reply: castStrikeReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async (): Promise<CastStruck> => {
          chatHeld(deps.store, user, params.chat);
          const ask = strikeOf(body);
          // How sure a secret held again is, as `cast_update` holds one.
          const { secretConfidence } = { ...CAST_DEFAULTS, ...(await deps.settings(user, params.chat)) };
          const done = await struck(deps, user, params.chat, params.character, ask, secretConfidence);
          if (done.changed) deps.changed(params.chat);
          const r = readingAt(deps.store, user, params.chat, null);
          const lines = await castLines(deps.files(user, params.chat));
          return {
            changed: done.changed,
            entry: entryShown(r, r.record.items.get(done.item) as CastItem),
            alsoStruck: ask.struck ? done.also : [],
            letGo: done.letGo,
            alsoStood: ask.struck ? [] : done.also,
            heldAgain: done.held,
            notes: [...done.left.flatMap((l) => lines.line("page_still_struck", { ...l }) ?? []), ...done.unread.flatMap((u) => lines.line(u.line, u.fields) ?? [])],
          };
        }),
    }),
    route({
      method: "GET",
      path: PERCEPTIONS_PATH,
      access: "page",
      group: "cast",
      does: "The perception record of a turn, or of the stretch of turns ending at it: who was on stage, how the stage was read (the open scene, where the owner's character stands, or not recorded), and for each the perceptions of that turn they have, or none.",
      query: { turn: turnQuery, count: shape.optional(shape.whole({ least: 1 }), "How many turns of the path, ending at the turn read; left out, that turn alone.") },
      reply: perceptionRecordReply,
      joined: true,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, async (): Promise<PerceptionRecord> => {
          const turn = asked(deps.store, user, params.chat, query.turn);
          // The perceptions are read at the chat's head, his own later ones among them: a gap he filled is closed.
          const r = readingAt(deps.store, user, params.chat, null);
          const stretch = castAt(r.s, params.chat, turn).turns.slice(-(query.count ?? 1));
          const stage = stretch.length === 0 ? new Map<string, StageRead>() : await deps.onStage({ user, chat: params.chat }, stretch);
          const perceived = new Map<string, string[]>();
          for (const item of r.record.items.values()) if (item.part === "perception" && !item.dropped) perceived.set(`${perceivedTurn(item)}\n${item.character}`, [...(perceived.get(`${perceivedTurn(item)}\n${item.character}`) ?? []), item.id]);
          const turns = stretch.map((t): StageTurnShown => {
            const read = stage.get(t);
            const people = (read?.who ?? []).map((name): StagePersonShown => {
              const character = findCharacter(deps.store.db, user, r.chats, name);
              return { name, character: character?.id ?? null, casting: character === null ? null : (castingInForce(r.record, character)?.as ?? null), perceptions: character === null ? [] : (perceived.get(`${t}\n${character.id}`) ?? []) };
            });
            return { turn: t, message: r.record.at.replyOf(t), read: read?.how ?? "none", people };
          });
          return { chat: params.chat, turns };
        }),
    }),
    route({
      method: "POST",
      path: CHARACTER_PERCEPTIONS_PATH,
      access: "page",
      group: "cast",
      does: "Writes a perception for a character, corrects one or strikes one, as the player's own change placed after the newest reply: it lands while a run goes on and in a branch with no turn of its own, and the Author is told of it at the next turn. `knows` as an empty list says the character now knows nothing from it.",
      body: perceptionBody,
      reply: perceptionWrittenReply,
      joined: true,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async (): Promise<CastPerceptionWritten> => {
          chatHeld(deps.store, user, params.chat);
          // The turn it is of: one the store has, not joined to another, and on the chat's path.
          const of = body.turn === undefined ? null : asked(deps.store, user, params.chat, body.turn);
          const before = readingAt(deps.store, user, params.chat, null);
          const character = findCharacter(deps.store.db, user, before.chats, params.character);
          if (character === null) throw new Refused(404, "no_character", { who: params.character });
          const message = of === null ? undefined : before.record.at.replyOf(of);
          if (of !== null && message === null) throw new Refused(404, "no_turn", { id: of });
          const { turn: _turn, ...said } = body;
          const lines = await castLines(deps.files(user, params.chat));
          const settings: CastSettings = { ...CAST_DEFAULTS, ...(await deps.settings(user, params.chat)) };
          const call: CastCall = {
            scope: { user, chat: params.chat, session: "" },
            agent: { id: PLAYER, definition: PLAYER },
            callId: crypto.randomUUID(),
            signal: new AbortController().signal,
            tool: "writing a perception from the Cast page",
            deps: { store: deps.store, writes: deps.writes, files: deps.files(user, params.chat), sources: async () => null, ...(deps.now !== undefined ? { now: deps.now } : {}) },
            settings,
            lines,
            reply: () => new Reply(lines),
          };
          const answer = await perceiveAsPlayer({ perceptions: [{ who: character.id, ...said, ...(message !== undefined && message !== null ? { message } : {}) }] }, call);
          const words = answer.parts.flatMap((p, i) => (answer.kinds[i] === "line" && p.type === "text" ? [p.text] : []));
          if (answer.failed) throw new RouteError(422, [...words, ...answer.reports].join(" "));
          const data = answer.parts.flatMap((p, i) => (answer.kinds[i] === "data" && p.type === "text" ? [JSON.parse(p.text) as { perceptions?: { id: string | null; knowledge?: string[]; struck?: string[]; lets_go?: string[] }[] }] : []))[0];
          const done = data?.perceptions?.[0];
          if (done?.id != null) deps.changed(params.chat);
          const now = readingAt(deps.store, user, params.chat, null);
          const item = done?.id == null ? undefined : now.record.items.get(done.id);
          return {
            id: done?.id ?? null,
            entry: item === undefined ? null : { ...entryShown(now, item), of: { turn: perceivedTurn(item), message: now.record.at.replyOf(perceivedTurn(item)) } },
            knowledge: done?.knowledge ?? [],
            struck: done?.struck ?? [],
            letGo: done?.lets_go ?? [],
            notes: [...words, ...answer.reports],
          };
        }),
    }),
    route({
      method: "POST",
      path: CHARACTER_CASTING_PATH,
      access: "page",
      group: "cast",
      does: "Sets how large a part a character plays, as the owner's own change: pinned, it stands over the Author's castings; not pinned, it is his casting alone and the Author may change it; or takes the pin away. Told to the Author in the next briefing.",
      body: castingBody,
      reply: castEditedReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, () =>
          edited(deps, user, params.chat, params.character, "setting a casting from the Cast page", (e): Edited => {
            const id = e.character.id;
            const was = castingInForce(e.r.record, e.character);
            const pin = (casting: Casting | null): void => pinCasting(e.db, user, id, casting, { chat: params.chat, now: e.now });
            if (body.as === null) {
              if (body.pin) throw new Refused(400, "page_pin_needs_casting", { who: e.character.name });
              // Taking away a pin there is none of changes nothing.
              if (e.character.pinned === null) return { changed: false };
              pin(null);
              writeCast(deps.store, e.writer, [{ character: id, part: "casting", item: castingItemId(id), value: { pinned: false } }]);
              return { changed: true };
            }
            if (was !== null && was.as === body.as && was.pinned === body.pin && (body.line === undefined || was.line === body.line)) return { changed: false };
            // A pin is his alone: set without one, any he made stands no more.
            if (body.pin) pin(body.as);
            else if (e.character.pinned !== null) pin(null);
            writeCast(deps.store, e.writer, [{ character: id, part: "casting", item: castingItemId(id), value: { as: body.as, pinned: body.pin, ...(body.line !== undefined ? { line: body.line } : {}) } }]);
            return { changed: true };
          }),
        ),
    }),
    route({
      method: "POST",
      path: CHARACTER_BASE_PATH,
      access: "page",
      group: "cast",
      does: "Redraws documents of a character's base as the owner's own change: each document given that differs from the one in force is written as the next version of its part, drawn against the sources as they stand in Lumiverse now. Told to the Author in the next briefing.",
      body: baseBody,
      reply: castEditedReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async () => {
          chatHeld(deps.store, user, params.chat);
          const found = findCharacter(deps.store.db, user, chatLine(deps.store.user(user), params.chat), params.character);
          if (found === null) throw new Refused(404, "no_character", { who: params.character });
          const seen = await seenNow(deps, user, params.chat, found.id);
          return edited(deps, user, params.chat, params.character, "redrawing a base from the Cast page", (e): Edited => {
            const standing = baseOf(e.db, user, e.character.id, params.chat);
            const given = BASE_PARTS.filter((p) => body[p] !== undefined);
            if (given.length === 0) return { changed: false, notes: [{ line: "page_nothing_to_edit", fields: { who: e.character.name } }] };
            const texts: Partial<Record<BasePart, string>> = {};
            for (const p of given) if (standing.get(p)?.text !== body[p]) texts[p] = body[p] as string;
            if (Object.keys(texts).length === 0) return { changed: false };
            const written = writeBase(e.db, { user, chat: params.chat, turn: null, by: PLAYER, agent: null, now: e.now }, e.character.id, texts, seen);
            writeCast(deps.store, e.writer, [{ character: e.character.id, part: "edit", item: null, value: { what: "base", versions: Object.fromEntries(written.map((v) => [v.part, v.version])) } }]);
            return { changed: true };
          });
        }),
    }),
    route({
      method: "POST",
      path: CHARACTER_SOURCES_PATH,
      access: "page",
      group: "cast",
      does: "Binds a source to a character (a card, a persona, a lore entry or a memory entity Lumiverse holds), says again which side of it a bound source defines, or takes the binding away, as the owner's own change. Told to the Author in the next briefing.",
      body: sourceBody,
      reply: castEditedReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async () => {
          chatHeld(deps.store, user, params.chat);
          const ref = body.ref.trim();
          // A source to bind is one Lumiverse holds now.
          if (body.drop !== true) {
            const now = await deps.sources({ user, chat: params.chat }, { kind: body.kind, ref }).catch((error: unknown) => {
              throw new RouteError(502, error instanceof Error ? error.message : String(error));
            });
            if (now === null) throw new Refused(404, "no_source", { n: 1, op: "bind", kind: body.kind, id: ref });
          }
          return edited(deps, user, params.chat, params.character, "binding a source from the Cast page", (e): Edited => {
            const bound = bindingsOf(e.db, user, e.character.id).find((b) => b.kind === body.kind && b.ref === ref);
            if (body.drop === true) {
              if (bound === undefined) return { changed: false };
              unbindSource(e.db, user, e.character.id, body.kind, ref);
              writeCast(deps.store, e.writer, [{ character: e.character.id, part: "edit", item: null, value: { what: "source", kind: body.kind, ref, removed: true } }]);
              return { changed: true };
            }
            // Said again without a side, a bound source keeps the one it defines.
            const defines = body.defines === undefined ? (bound?.defines ?? null) : body.defines;
            if (bound !== undefined && bound.defines === defines) return { changed: false };
            bindSource(e.db, user, e.character.id, { kind: body.kind, ref, defines }, e.now);
            writeCast(deps.store, e.writer, [{ character: e.character.id, part: "edit", item: null, value: { what: "source", kind: body.kind, ref, defines } }]);
            return { changed: true };
          });
        }),
    }),
    route({
      method: "POST",
      path: CHARACTER_PERSON_PATH,
      access: "page",
      group: "cast",
      does: "Says which of the world's people a character is, by the person's id or name (null takes the reference away), as the owner's own change; the character's game side and its holdings are found by it. Told to the Author in the next briefing.",
      body: personBody,
      reply: castEditedReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, () =>
          edited(deps, user, params.chat, params.character, "naming a character's person from the Cast page", (e): Edited => {
            let person: string | null = null;
            if (body.person !== null) {
              const ctx = worldAt(deps.store, user, null, null, params.chat);
              const found = ctx === null ? null : personNamed(ctx, body.person);
              if (found !== null && "many" in found) throw new Refused(409, "many_named", { n: 1, op: "cast", who: body.person, count: found.many.length, ids: found.many });
              if (found === null || "none" in found) {
                const names = ctx === null ? [] : Object.values(ctx.state.entities).map((en) => en.name);
                throw new Refused(404, "no_person", { n: 1, op: "cast", field: "person", said: body.person, near: textOf(nearestOf(body.person, names, IFACE_DEFAULTS).slice(0, IFACE_DEFAULTS.nearMatches)) });
              }
              person = found.id;
            }
            if (e.character.person === person) return { changed: false };
            setPerson(e.db, user, e.character.id, person);
            writeCast(deps.store, e.writer, [{ character: e.character.id, part: "edit", item: null, value: { what: "person", person } }]);
            return { changed: true };
          }),
        ),
    }),
  ] as const;
}
