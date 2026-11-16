// The Cast page's routes (plan §14, §7): who is in a chat's cast, and one character's whole record,
// each at the chat's newest turn or as it stood at one of its turns; and an entry of a character's
// record struck from the page, or its strike taken back. Every route is a page's: it answers only for
// the user this RPE belongs to. What it shows is the record as stored, every entry with the turn that
// wrote it, who wrote it (an agent's definition, the player, or the migration) and whether it is
// struck, and every write of it on the path. This is the player's page, not an agent's view: nothing
// is cut by what a character knows, by its casting or by a budget.
//
// A strike is the player's own change, written by the cast's own writer on the chat's newest turn, the
// turn the next one follows, as the play panels record a tap there, and with what the cast's tools
// do when they strike: a struck perception strikes the knowledge it gave, and struck knowledge takes
// back each secret's holding that no other knowledge of that character still gives, recorded on the
// same turn. Taking a strike back stands the entry again, as the tools' `drop: false` does; a
// perception's stands the knowledge its strike struck with it, and knowledge standing again holds its
// secret again, as `cast_update` holds one. Knowledge struck apart from the perception stays struck, and
// a secret nothing standing gives stays let go: the answer says so. Nothing is struck or restored while
// a turn of the chat runs, since that turn reads the turn a strike is written on, nor in a branch whose
// newest turn is the chat's it was branched from, since a strike written there would change that chat
// too. The words of every refusal are lines of `.prompts/cast-answers.md`, as the chat has it.

import type { JsonObject } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import type { Writes } from "../iface/kit";
import { type Fields, type GuidanceFiles } from "../iface/texts";
import type { LedgerEvent } from "../shared/ledger";
import { JoinedTurnError, type Store, type UserStore } from "../store";
import { fileName, IMPORTED_KIND, importedText, isFiled } from "./imported";
import { CAST_DEFAULTS, type CastClock, castClock, castLines, type CastSettings } from "./kit";
import { memoriesNow, type Tier } from "./memory";
import { castAt } from "./path";
import { perceivedTurn } from "./perceive";
import {
  baseHistory,
  type BasePart,
  bindingsOf,
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
  type RowPart,
  type SourceKind,
  writeCast,
} from "./record";
import { forgetsOf, holdingChanges, secretsHeldAgain, secretsLetGo, worldAt } from "./secrets";
import { type CastCharacter, type CastCounts, type CastEntryShown, type CastHeld, type CastKind, type CastList, type CastMemberShown, type CastStrike, type CastStruck, type CastWriteShown, castReply, castStrikeBody, castStrikeReply, characterReply } from "./shapes";
import { CAST_LANE, type Unread } from "./update";

export const CAST_PATH = "/api/v1/chats/:chat/cast";
export const CHARACTER_PATH = "/api/v1/chats/:chat/cast/:character";
export const CHARACTER_STRIKE_PATH = "/api/v1/chats/:chat/cast/:character/strike";

/** Who a change from the page is by, and where it came from: the player, as the store's sources name them and the play panels record their taps. */
const PLAYER = "player";

export interface CastRoutesDeps {
  /** RPE's store: its database holds the cast. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** Whether a turn of the user's chat runs now: nothing is struck or restored while one does. */
  turning(user: string, chat: string): boolean;
  /** The guidance files in force for the chat: the page's words are lines of `.prompts/cast-answers.md`. */
  files(user: string, chat: string): GuidanceFiles;
  /** The cast's settings for the chat, over `CAST_DEFAULTS`: what memories' tiers and fading are worked out by. */
  settings(user: string, chat: string): Promise<Partial<CastSettings>>;
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
 * Writes a strike, or takes one back, as the player's on the chat's newest turn, inside one queued write that reads the record it
 * changes. It is refused in that write while a turn of the chat runs: a continue takes its marks in a write of its own, and a strike
 * that checked before its own write could land after them and be taken back with the continue. It is refused too where that newest
 * turn is another chat's (a branch with no turn of its own yet), since a strike written there would change that chat as well.
 */
function struck(deps: CastRoutesDeps, user: string, chat: string, said: string, ask: StrikeAsked, confidence: number): Promise<StrikeDone> {
  return deps.writes.run((db) => {
    if (deps.turning(user, chat)) throw new Refused(409, "page_turning");
    const r = readingAt(deps.store, user, chat, null);
    const character = findCharacter(db, user, r.chats, said);
    if (character === null) throw new Refused(404, "no_character", { who: said });
    const item = r.record.items.get(ask.id);
    // A casting is set, never struck: striking it would change nothing that is read.
    if (item === undefined || item.character !== character.id || item.part === "casting") throw new Refused(404, "page_no_entry", { who: character.name, id: ask.id });
    if (item.dropped === ask.struck) return { item: item.id, changed: false, also: [], letGo: [], held: [], left: [], unread: [] };
    // The entry was written on a turn of the chat's path, so the path has a newest turn.
    const turn = r.record.at.turns.at(-1) as string;
    if (r.s.turn(turn)?.chat !== chat) throw new Refused(409, "page_branch_no_turn");
    const writer: CastWriter = { user, turn, by: PLAYER, agent: null, job: null, at: r.clock?.now ?? null, now: (deps.now ?? Date.now)() };
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
    const ctx = knowledge.length > 0 ? worldAt(deps.store, user, turn) : null;
    const record = (events: readonly LedgerEvent[]): void => {
      if (events.length > 0) r.s.addChanges(turn, holdingChanges(events, CAST_LANE, PLAYER, null).map((c) => ({ ...c, source: PLAYER })));
    };
    if (back === null) {
      // As `cast_update` and `perceive` strike knowledge: each secret it gave is let go, unless other knowledge of theirs still gives it.
      const forgets = forgetsOf(ctx, 1, item.part, character.name, secretsLetGo(r.record, character.id, knowledge), unread);
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
      return secretsHeldAgain(ctx, { n: 1, op: item.part, field: "secret" }, character.name, k.fields.told_by, r.s.turn(k.opened), [fact], confidence, unread);
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
      casting: casting === null ? null : { as: casting.as, pinned: casting.pinned, line: casting.line },
      from: from.get(c.id) ?? { carried: false, played: false },
      counts: counts.get(c.id) ?? emptyCounts(),
    };
  });
}

function writeShown(r: Reading, row: CastRow): CastWriteShown {
  return { turn: row.turn, message: r.record.at.replyOf(row.turn), imported: r.imported(row.turn), by: row.by, wrote: row.value };
}

function entryShown(r: Reading, item: CastItem): CastEntryShown {
  return {
    id: item.id,
    part: item.part as CastEntryShown["part"],
    fields: item.fields,
    date: item.at !== null && r.clock !== null ? r.clock.text(item.at) : null,
    turn: item.opened,
    message: r.record.at.replyOf(item.opened),
    imported: r.imported(item.opened),
    by: item.rows[0]?.by ?? null,
    struck: item.dropped,
    writes: item.rows.map((row) => writeShown(r, row)),
  };
}

/** Everything on one character's record at the reading. */
function characterShown(r: Reading, character: Character, settings: CastSettings): Omit<CastCharacter, "chat" | "turn"> {
  const { db } = r.store;
  const all = (part: RowPart): CastItem[] => r.record.of(character.id, part, true);
  const standing = new Map(memoriesNow(r.record, character.id, r.clock?.now ?? null, settings).map((m) => [m.item.id, m]));
  const versions = baseHistory(db, r.user, character.id);
  const newest = new Map(versions.map((v) => [v.part, v.version]));
  const [member] = membersOf(r, [character]);
  return {
    character: member as CastMemberShown,
    sources: bindingsOf(db, r.user, character.id).map((b) => ({ kind: b.kind, ref: b.ref, defines: b.defines, created: b.created })),
    base: versions.map((v) => ({ part: v.part, version: v.version, text: v.text, standing: newest.get(v.part) === v.version, turn: v.turn, by: v.by, created: v.created })),
    castings: (r.record.items.get(castingItemId(character.id))?.rows ?? []).map((row) => writeShown(r, row)),
    growth: all("growth").map((i) => entryShown(r, i)),
    mind: all("mind")
      .filter((i) => i.fields.kind !== IMPORTED_KIND)
      .map((i) => entryShown(r, i)),
    memories: all("memory").map((i) => {
      const now = standing.get(i.id);
      return { ...entryShown(r, i), tier: now?.tier ?? null, strength: now?.strength ?? null, faint: now?.faint ?? false };
    }),
    relationships: all("relationship").map((i) => entryShown(r, i)),
    knowledge: all("knowledge").map((i) => entryShown(r, i)),
    history: all("history").map((i) => entryShown(r, i)),
    perceptions: all("perception").map((i) => {
      const of = perceivedTurn(i);
      return { ...entryShown(r, i), of: { turn: of, message: r.record.at.replyOf(of) } };
    }),
    files: all("mind")
      .filter((i) => i.fields.kind === IMPORTED_KIND)
      .map((i) => ({ ...entryShown(r, i), file: fileName(i), text: importedText(r.store.db, r.user, i), filed: isFiled(i) })),
  };
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
      does: "Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns.",
      query: { turn: turnQuery },
      reply: characterReply,
      joined: true,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, async (): Promise<CastCharacter> => {
          const turn = asked(deps.store, user, params.chat, query.turn);
          const r = readingAt(deps.store, user, params.chat, turn);
          const character = findCharacter(deps.store.db, user, r.chats, params.character);
          if (character === null) throw new Refused(404, "no_character", { who: params.character });
          const settings: CastSettings = { ...CAST_DEFAULTS, ...(await deps.settings(user, params.chat)) };
          return { chat: params.chat, turn, ...characterShown(r, character, settings) };
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
  ] as const;
}
