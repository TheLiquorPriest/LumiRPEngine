// The Cast page's routes: who is in a chat's cast with what each holds, and one character's whole
// record, at the chat's newest turn or as it stood at a turn; what a migration carried told apart
// from what was played on RPE; an entry struck from the page as the player's own change on the
// newest turn, with what the cast's tools strike along with it, and the strike taken back with what
// went with it; refusals in the cast's own words, a branch with no turn of its own among them; a turn
// that begins while a strike waits for its write; and one user's chat is not another's to read or
// strike. Every name and every word here is made up.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "rp-harness/contract";
import { type CastCharacter, type CastEdited, type CastList, type CastPerceptionWritten, castRoutes, type CastRoutesDeps, type CastStruck, type PerceptionRecord } from "../../src/cast/index";
import { addCharacter, type CastWrite, pinCasting } from "../../src/cast/record";
import type { BookReader } from "../../src/cast/secrets";
import { knowersOf } from "../../src/packs/minds/core/knowledge";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import type { ShownMessage, TurnRow } from "../../src/store";
import { hashOf } from "../store/fixtures";
import { type Bench, CHAT, dataOf, openBench, openTable, type Table, USER } from "./rig";
import { callRoute } from "../app/call";

const BRANCH = "chat-b";

const OTHER = "user-b";
const LINES = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "cast-answers.md"), "utf8"), "cast-answers.md");
const words = (line: string, fields: JsonObject = {}): string => LINES.line(line, fields) ?? "";

const CORE = "# Bram\nKeeps the Lamp and Ladle.\n\nOwes the reeve two seasons of rent.";
const PLANS = "Sell the cellar wine before the tax.";

/** Each chat the cast told its pages to read again, in order. */
const told: string[] = [];

/** A character as the page gives it, each bounded list as the entries it holds. */
type Flat = { [K in keyof CastCharacter]: CastCharacter[K] extends { items: infer I } ? I : CastCharacter[K] };
function flat(c: CastCharacter): Flat {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === "object" && v !== null && "items" in v ? v.items : v])) as Flat;
}

interface Page {
  t: Table;
  list(query?: Record<string, string>, user?: string, chat?: string): Promise<CastList>;
  one(character: string, query?: Record<string, string>, user?: string, chat?: string): Promise<Flat>;
  strike(character: string, body: unknown, user?: string, chat?: string): Promise<CastStruck>;
  record(query?: Record<string, string>, user?: string, chat?: string): Promise<PerceptionRecord>;
  perceive(character: string, body: unknown, user?: string, chat?: string): Promise<CastPerceptionWritten>;
  /** The owner's edits of a character, by the route that makes each. */
  edit(what: "casting" | "base" | "sources" | "person", character: string, body: unknown, user?: string, chat?: string): Promise<CastEdited>;
}

/** The player's own changes to the engine's state (the holdings a strike lets go or holds again): of no turn, with their source. */
function ownChanges(t: Table): { op: string; source: string | null }[] {
  return t.db.query<{ op: string; source: string | null }, [string]>("SELECT op, source FROM change WHERE chat = ? AND by = 'player' AND op NOT LIKE 'cast.%' ORDER BY ord").all(CHAT);
}

/** The Cast page over a table: the routes as the application mounts them, called through each route's own reader and handler. */
function pageOn(t: Table, onStage: CastRoutesDeps["onStage"] = async () => new Map()): Page {
  const deps: CastRoutesDeps = { store: t.store, writes: t.writes, files: () => shippedTexts(), settings: async () => ({}), onStage, sources: t.shelf.reader, changed: (chat) => told.push(chat), now: () => 7 };
  const [listRoute, oneRoute, strikeRoute, recordRoute, perceiveRoute, castingRoute, baseRoute, sourcesRoute, personRoute] = castRoutes(deps);
  return {
    t,
    list: async (query = {}, user = USER, chat = CHAT) => await callRoute(listRoute, { params: { chat }, query, user }),
    one: async (character, query = {}, user = USER, chat = CHAT) => flat(await callRoute(oneRoute, { params: { chat, character }, query, user })),
    strike: async (character, body, user = USER, chat = CHAT) => await callRoute(strikeRoute, { params: { chat, character }, body, user }),
    record: async (query = {}, user = USER, chat = CHAT) => await callRoute(recordRoute, { params: { chat }, query, user }),
    perceive: async (character, body, user = USER, chat = CHAT) => await callRoute(perceiveRoute, { params: { chat, character }, body, user }),
    edit: async (what, character, body, user = USER, chat = CHAT) => {
      const route = { casting: castingRoute, base: baseRoute, sources: sourcesRoute, person: personRoute }[what];
      return await callRoute(route, { params: { chat, character }, body, user });
    },
  };
}

/** A turn a migration's import wrote: the player's line shown, the turn begun as imported, `list` written by the migration, its reply tied. */
async function importedTurn(t: Table, list: readonly CastWrite[]): Promise<TurnRow> {
  t.shown.push({ id: `old-${t.shown.length}`, user: true, hash: hashOf("an old line"), hidden: false });
  await t.writes.run(() => t.s.sync(CHAT, t.shown));
  const turn = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new", imported: true }));
  await t.write(turn, list, "migration");
  return t.tie(turn);
}

interface Story {
  page: Page;
  bram: string;
  wren: string;
  odile: string;
  /** The migration's turn; then two turns played on RPE. */
  carried: TurnRow;
  first: TurnRow;
  second: TurnRow;
  ids: { perception: string; seal: string; rent: string; feeling: string; memory: string; growth: string };
}

/**
 * Bram came over from the earlier build: cast supporting, with two old mind files. On RPE, the Author
 * casts Wren and writes what she perceived and knows; her own agent writes her mind, a memory and how
 * she feels about Bram. Next turn the Author strikes one thing she knew, marks Bram's core file filed
 * and records her growth. Odile was added and never cast.
 */
async function played(): Promise<Story> {
  const page = pageOn(await openTable());
  const { t } = page;
  const made = await t.writes.run((db) => ({ bram: addCharacter(db, USER, CHAT, "Bram", 1).id, wren: addCharacter(db, USER, CHAT, "Wren", 1).id, odile: addCharacter(db, USER, CHAT, "Odile", 1).id }));
  const { bram, wren, odile } = made;
  const carried = await importedTurn(t, [
    { character: bram, part: "casting", item: `casting:${bram}`, value: { as: "supporting", why: "He keeps the inn." } },
    { character: bram, part: "mind", item: `imported:${bram}:core.md`, value: { kind: "imported", file: "core.md", text: CORE, entity: "e-bram", filed: false } },
    { character: bram, part: "mind", item: `imported:${bram}:plans.md`, value: { kind: "imported", file: "plans.md", text: PLANS, entity: "e-bram", filed: false } },
  ]);

  const first = await t.begin();
  const [cast, perception] = await t.write(first, [
    { character: wren, part: "casting", item: `casting:${wren}`, value: { as: "principal", line: "A courier with a sealed letter." } },
    { character: wren, part: "perception", item: null, value: { of: first.id, reach: "whole", content: "Bram slides the letter across the bar." } },
  ]);
  expect(cast?.item).toBe(`casting:${wren}`);
  const perceptionId = perception?.item ?? "";
  const [seal, rent] = await t.write(first, [
    { character: wren, part: "knowledge", item: null, value: { text: "The reeve's seal is chipped.", from: perceptionId } },
    { character: wren, part: "knowledge", item: null, value: { text: "Bram owes rent.", how: "Overheard in the market." } },
  ]);
  const [feeling, memory] = await t.write(
    first,
    [
      { character: wren, part: "mind", item: null, value: { kind: "feeling", text: "Uneasy about the letter.", about: ["the letter"] } },
      { character: wren, part: "memory", item: null, value: { text: "Bram's hand shook as he passed me the letter.", gist: "Bram's shaking hand.", top: true, from: [perceptionId] } },
      { character: wren, part: "relationship", item: `rel:${wren}:bram`, value: { with: "Bram", text: "He is hiding something.", trust: -10 } },
    ],
    "wren",
  );
  await t.tie(first);

  const second = await t.begin();
  const [growth] = await t.write(second, [
    { character: wren, part: "growth", item: null, value: { text: "Trusts her own eyes over a seal.", cause: "The chipped seal." } },
    { character: wren, part: "knowledge", item: rent?.item ?? "", value: { drop: true, why: "She misheard." } },
    { character: bram, part: "mind", item: `imported:${bram}:core.md`, value: { filed: true } },
  ]);
  await t.tie(second);
  return {
    page,
    bram,
    wren,
    odile,
    carried,
    first,
    second,
    ids: { perception: perceptionId, seal: seal?.item ?? "", rent: rent?.item ?? "", feeling: feeling?.item ?? "", memory: memory?.item ?? "", growth: growth?.item ?? "" },
  };
}

const none = { held: 0, struck: 0 };

describe("the cast of a chat", () => {
  test("lists every character the chat knows, with its casting, where its record came from and what it holds by kind", async () => {
    const { page, bram, wren, odile } = await played();
    expect(await page.list()).toEqual({
      chat: CHAT,
      turn: null,
      characters: [
        {
          id: bram,
          name: "Bram",
          chat: CHAT,
          person: null,
          casting: { as: "supporting", pinned: false, line: null },
          // The migration carried his casting and files; marking a file filed was played on RPE.
          from: { carried: true, played: true },
          counts: { growth: none, mind: none, memories: none, relationships: none, knowledge: none, history: none, perceptions: none, files: { held: 2, struck: 0, filed: 1 } },
        },
        {
          id: wren,
          name: "Wren",
          chat: CHAT,
          person: null,
          casting: { as: "principal", pinned: false, line: "A courier with a sealed letter." },
          from: { carried: false, played: true },
          counts: { growth: { held: 1, struck: 0 }, mind: { held: 1, struck: 0 }, memories: { held: 1, struck: 0 }, relationships: { held: 1, struck: 0 }, knowledge: { held: 1, struck: 1 }, history: none, perceptions: { held: 1, struck: 0 }, files: { ...none, filed: 0 } },
        },
        { id: odile, name: "Odile", chat: CHAT, person: null, casting: null, from: { carried: false, played: false }, counts: { growth: none, mind: none, memories: none, relationships: none, knowledge: none, history: none, perceptions: none, files: { ...none, filed: 0 } } },
      ],
    });
  });

  test("at a turn, holds what the record held then; a pin of the player's stands over the Author's casting", async () => {
    const { page, bram, wren, carried, first } = await played();
    await page.t.writes.run((db) => pinCasting(db, USER, bram, "principal"));
    const then = await page.list({ turn: first.id });
    expect(then.turn).toBe(first.id);
    const at = new Map(then.characters.map((c) => [c.id, c]));
    expect(at.get(wren)?.counts.knowledge).toEqual({ held: 2, struck: 0 });
    expect(at.get(wren)?.counts.growth).toEqual(none);
    expect(at.get(bram)?.counts.files).toEqual({ held: 2, struck: 0, filed: 0 });
    expect(at.get(bram)?.casting).toEqual({ as: "principal", pinned: true, line: null });
    // Before Wren was cast, she is in the cast with no casting.
    const before = await page.list({ turn: carried.id });
    expect(before.characters.find((c) => c.id === wren)?.casting).toBeNull();
  });

  test("is not another user's to read, and refuses a chat or a turn it does not have in the cast's words", async () => {
    const { page, first } = await played();
    await expect(page.list({}, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    await expect(page.list({ turn: first.id }, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    await expect(page.list({}, USER, "chat-nowhere")).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: "chat-nowhere" }) });
    await expect(page.list({ turn: "turn-nowhere" })).rejects.toMatchObject({ status: 404, message: words("no_turn", { id: "turn-nowhere" }) });
    expect(words("no_chat", { id: CHAT })).toContain(CHAT);
  });
});

describe("one character's record", () => {
  test("is everything on it by kind: each entry with its words, its turn, who wrote it and whether it is struck", async () => {
    const { page, wren, first, second, ids } = await played();
    const got = await page.one("Wren");
    expect(got.character.id).toBe(wren);
    const entry = (id: string, part: string, fields: JsonObject, turn: TurnRow, by: string, struck = false) => expect.objectContaining({ id, part, fields, turn: turn.id, by, struck, imported: false });
    expect(got.knowledge).toEqual([
      entry(ids.seal, "knowledge", { text: "The reeve's seal is chipped.", from: ids.perception }, first, "author"),
      // Struck, and still shown: the player's page cuts nothing, struck entries included.
      entry(ids.rent, "knowledge", { text: "Bram owes rent.", how: "Overheard in the market.", why: "She misheard." }, first, "author", true),
    ]);
    expect(got.mind).toEqual([entry(ids.feeling, "mind", { kind: "feeling", text: "Uneasy about the letter.", about: ["the letter"] }, first, "wren")]);
    expect(got.relationships).toEqual([entry(`rel:${wren}:bram`, "relationship", { with: "Bram", text: "He is hiding something.", trust: -10 }, first, "wren")]);
    expect(got.growth).toEqual([entry(ids.growth, "growth", { text: "Trusts her own eyes over a seal.", cause: "The chipped seal." }, second, "author")]);
    expect(got.memories).toEqual([expect.objectContaining({ id: ids.memory, by: "wren", tier: "top", faint: false, struck: false })]);
    expect(got.perceptions).toEqual([expect.objectContaining({ id: ids.perception, of: { turn: first.id, message: 3 } })]);
    expect(got.castings).toEqual([expect.objectContaining({ turn: first.id, by: "author", wrote: { as: "principal", line: "A courier with a sealed letter." } })]);
    // The struck entry's history: written on one turn, struck on the next, each write with who made it.
    const rent = got.knowledge.find((k) => k.id === ids.rent);
    expect(rent?.writes).toEqual([
      { turn: first.id, message: 3, imported: false, by: "author", wrote: { text: "Bram owes rent.", how: "Overheard in the market." } },
      { turn: second.id, message: 5, imported: false, by: "author", wrote: { drop: true, why: "She misheard." } },
    ]);
  });

  test("gives a migrated character's old mind files word for word, with their filed mark, as carried by the migration", async () => {
    const { page, bram, carried } = await played();
    const got = await page.one(bram);
    expect(got.mind).toEqual([]);
    expect(got.files.map((f) => ({ file: f.file, text: f.text, filed: f.filed, by: f.by, imported: f.imported }))).toEqual([
      { file: "core.md", text: CORE, filed: true, by: "migration", imported: true },
      { file: "plans.md", text: PLANS, filed: false, by: "migration", imported: true },
    ]);
    expect(got.files[0]?.writes.map((w) => ({ by: w.by, imported: w.imported }))).toEqual([
      { by: "migration", imported: true },
      { by: "author", imported: false },
    ]);
    expect(got.castings).toEqual([{ turn: carried.id, message: 1, imported: true, by: "migration", wrote: { as: "supporting", why: "He keeps the inn." } }]);
    // As the record stood before the Author filed it.
    const before = await page.one(bram, { turn: carried.id });
    expect(before.files.map((f) => [f.file, f.filed])).toEqual([
      ["core.md", false],
      ["plans.md", false],
    ]);
  });

  test("as it stood at a turn leaves out what came later, and stands what was struck later", async () => {
    const { page, ids, first } = await played();
    const then = await page.one("Wren", { turn: first.id });
    expect(then.growth).toEqual([]);
    expect(then.knowledge.map((k) => [k.id, k.struck])).toEqual([
      [ids.seal, false],
      [ids.rent, false],
    ]);
  });

  test("refuses a character the cast does not hold, and is not another user's to read", async () => {
    const { page, wren } = await played();
    await expect(page.one("Tam")).rejects.toMatchObject({ status: 404, message: words("no_character", { who: "Tam" }) });
    await expect(page.one(wren, {}, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
  });
});

/** An invented book's entry with a marked secret, `wi:vale-book:e-7:0`: the reeve's forgery. */
const ENTRY = "The cellar runs under the square.\n{{// Secret (known to Bram): The reeve forged the seal.}}\nNobody goes down there.";
const SECRET = "wi:vale-book:e-7:0";

/** The minds slice of the engine's state at the chat's head, as today's code keeps it. */
const minds = (t: Table): never => (t.s.headState(CHAT).state.world.packs.minds ?? {}) as never;

/** Chat B, branched from the chat at its newest reply: the same messages under its own ids, as the chat application shows them. */
async function branchOf(t: Table): Promise<ShownMessage[]> {
  const map = Object.fromEntries(t.shown.map((m) => [m.id, `b-${m.id}`]));
  await t.writes.run(() => t.s.branchChat({ id: BRANCH, from: CHAT, map, at: t.shown.at(-1)?.id ?? null }));
  const shown = t.shown.map((m) => ({ ...m, id: `b-${m.id}` }));
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  return shown;
}

/** A whole exchange in chat B: the player's line, a turn begun after it, its reply tied and shown. */
async function playIn(t: Table, shown: ShownMessage[]): Promise<TurnRow> {
  shown.push({ id: `b-u${shown.length}`, user: true, hash: hashOf("the player's line in the branch"), hidden: false });
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  const turn = await t.writes.run(() => t.s.beginTurn({ chat: BRANCH, kind: "new" }));
  const reply = { id: `b-r${shown.length}`, user: false, hash: hashOf("The branch goes its own way."), date: 9_000, hidden: false };
  const tied = await t.writes.run(() => t.s.tieTurn(turn.id, { message: reply.id, hash: reply.hash, date: reply.date }));
  shown.push(reply);
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  return tied;
}

/** The books the secret tests read: the one entry with the marked secret. */
const BOOKS: BookReader = async (_scope, book, entry) => (book === "vale-book" && entry === "e-7" ? ENTRY : null);

/** Wren cast, and what she perceived on the first turn, which is tied: the perception, the knowledge it gave by id in order, and that turn. */
async function perceived(knows: string[]): Promise<{ b: Bench; perception: string; knowledge: string[]; turn: TurnRow }> {
  const b = await openBench({ books: BOOKS });
  const turn = await b.t.begin();
  expect((await b.call("cast_update", { operations: [{ op: "cast", who: "Wren", as: "principal" }] }, turn.id)).error).toBeUndefined();
  const r = await b.call("perceive", { perceptions: [{ who: "Wren", reach: "whole", content: "She sees the seal is wrong.", ...(knows.length > 0 ? { knows } : {}), secrets: [SECRET] }] }, turn.id);
  expect(r.error).toBeUndefined();
  const [given] = dataOf(r).perceptions as JsonObject[];
  return { b, perception: String(given?.id), knowledge: given?.knowledge as string[], turn: await b.t.tie(turn) };
}

describe("striking from the page", () => {
  test("strikes an entry as the player's own change on the chat's newest turn, and takes the strike back", async () => {
    const { page, wren, first, second, ids } = await played();
    const done = await page.strike("Wren", { id: ids.seal, struck: true, why: "She never saw the seal up close." });
    expect(done).toMatchObject({ changed: true, alsoStruck: [], letGo: [], notes: [] });
    expect(done.entry).toMatchObject({ id: ids.seal, struck: true, turn: first.id, by: "author" });
    expect(done.entry.writes.at(-1)).toEqual({ turn: null, message: null, imported: false, by: "player", wrote: { drop: true, why: "She never saw the seal up close." } });
    // Read at the chat's newest turn it is struck; as the turn before stood, it is not.
    expect((await page.list()).characters.find((c) => c.id === wren)?.counts.knowledge).toEqual({ held: 0, struck: 2 });
    expect((await page.one("Wren", { turn: first.id })).knowledge.map((k) => k.struck)).toEqual([false, false]);
    // Struck already: nothing more is written.
    const again = await page.strike(wren, { id: ids.seal, struck: true });
    expect({ changed: again.changed, writes: again.entry.writes.length }).toEqual({ changed: false, writes: 2 });
    // Taken back: it stands again, by the player's own write.
    const back = await page.strike(wren, { id: ids.seal, struck: false });
    expect({ changed: back.changed, struck: back.entry.struck, last: back.entry.writes.at(-1) }).toEqual({ changed: true, struck: false, last: { turn: null, message: null, imported: false, by: "player", wrote: { drop: false } } });
    // What the Author struck is the player's to take back too.
    expect((await page.strike(wren, { id: ids.rent, struck: false })).entry.struck).toBe(false);
    expect((await page.list()).characters.find((c) => c.id === wren)?.counts.knowledge).toEqual({ held: 2, struck: 0 });
  });

  test("a struck perception strikes the knowledge it gave and lets go the secret it gave, as perceive's own strike does", async () => {
    const books: BookReader = async (_scope, book, entry) => (book === "vale-book" && entry === "e-7" ? ENTRY : null);
    const b = await openBench({ books });
    const turn = await b.t.begin();
    expect((await b.call("cast_update", { operations: [{ op: "cast", who: "Wren", as: "principal" }] }, turn.id)).error).toBeUndefined();
    const r = await b.call("perceive", { perceptions: [{ who: "Wren", reach: "whole", content: "She sees the seal is wrong.", knows: ["The seal is not the reeve's own."], secrets: [SECRET] }] }, turn.id);
    expect(r.error).toBeUndefined();
    const tied = await b.t.tie(turn);
    const [given] = dataOf(r).perceptions as JsonObject[];
    expect(knowersOf(minds(b.t), SECRET)).toEqual(["wren"]);

    const page = pageOn(b.t);
    const done = await page.strike("Wren", { id: given?.id, struck: true, why: "It was another letter." });
    expect(done).toMatchObject({ changed: true, alsoStruck: given?.knowledge as string[], letGo: [SECRET], notes: [] });
    expect(knowersOf(minds(b.t), SECRET)).toEqual([]);
    expect((await page.one("Wren")).knowledge.map((k) => [k.struck, k.writes.at(-1)?.by])).toEqual([
      [true, "player"],
      [true, "player"],
    ]);
    // The holding is taken back by the player's own change, which belongs to no turn.
    expect(ownChanges(b.t)).toEqual([{ op: "minds.forget", source: "player" }]);
  });

  test("refuses in the cast's words for an entry the character has not, and for what it cannot read; writes nothing", async () => {
    const { page, wren, ids } = await played();
    const rows = (): number => page.t.db.query<{ n: number }, []>("SELECT count(*) AS n FROM change WHERE op = 'cast.write'").get()?.n ?? 0;
    const before = rows();
    // Another character's entry, the casting, an id the record does not hold, someone the cast does not hold.
    await expect(page.strike("Bram", { id: ids.seal, struck: true })).rejects.toMatchObject({ status: 404, message: words("page_no_entry", { who: "Bram", id: ids.seal }) });
    await expect(page.strike("Wren", { id: `casting:${wren}`, struck: true })).rejects.toMatchObject({ status: 404, message: words("page_no_entry", { who: "Wren", id: `casting:${wren}` }) });
    await expect(page.strike("Wren", { id: "k-nowhere", struck: true })).rejects.toMatchObject({ status: 404, message: words("page_no_entry", { who: "Wren", id: "k-nowhere" }) });
    await expect(page.strike("Tam", { id: ids.seal, struck: true })).rejects.toMatchObject({ status: 404, message: words("no_character", { who: "Tam" }) });
    await expect(page.strike("Wren", { id: ids.seal })).rejects.toMatchObject({ status: 400 });
    await expect(page.strike("Wren", { struck: true })).rejects.toMatchObject({ status: 400 });
    // One user's chat is not another's to strike.
    await expect(page.strike("Wren", { id: ids.seal, struck: true }, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    expect(rows()).toBe(before);
  });

  test("taking back a perception's strike stands the knowledge its strike struck with it and holds that knowledge's secret again; knowledge struck apart stays struck, and the answer says so", async () => {
    const { b, perception, knowledge } = await perceived(["The seal is not the reeve's own.", "The wax is still soft."]);
    const [seal, wax, secret] = knowledge;
    const page = pageOn(b.t);
    // The player strikes what she knew of the wax on its own, then the whole perception.
    expect(await page.strike("Wren", { id: wax, struck: true })).toMatchObject({ changed: true, letGo: [] });
    expect(await page.strike("Wren", { id: perception, struck: true })).toMatchObject({ alsoStruck: [seal, secret], letGo: [SECRET] });
    expect(knowersOf(minds(b.t), SECRET)).toEqual([]);

    const back = await page.strike("Wren", { id: perception, struck: false });
    expect(back).toMatchObject({ changed: true, alsoStruck: [], letGo: [], alsoStood: [seal, secret], heldAgain: [SECRET] });
    expect(back.notes).toEqual([words("still_struck", { id: wax, from: perception, text: "The wax is still soft." })]);
    expect(knowersOf(minds(b.t), SECRET)).toEqual(["wren"]);
    expect((await page.one("Wren")).knowledge.map((k) => [k.id, k.struck])).toEqual([
      [seal, false],
      [wax, true],
      [secret, false],
    ]);
  });

  test("taking back the strike of knowledge of a secret holds the secret again, as the player's own change on the turn the strike is written on", async () => {
    const { b, knowledge, turn } = await perceived([]);
    const [secret] = knowledge;
    const page = pageOn(b.t);
    expect(await page.strike("Wren", { id: secret, struck: true })).toMatchObject({ changed: true, letGo: [SECRET] });
    expect(knowersOf(minds(b.t), SECRET)).toEqual([]);
    expect(await page.strike("Wren", { id: secret, struck: false })).toMatchObject({ changed: true, alsoStood: [], heldAgain: [SECRET], notes: [] });
    expect(knowersOf(minds(b.t), SECRET)).toEqual(["wren"]);
    expect(ownChanges(b.t)).toEqual([
      { op: "minds.forget", source: "player" },
      { op: "minds.learn", source: "player" },
    ]);
  });

  test("in a branch with no turn of its own, a strike lands as his own change of that branch alone; the chat it was branched from keeps its record", async () => {
    const { page, ids } = await played();
    await branchOf(page.t);
    const standing = [
      [ids.seal, false],
      [ids.rent, true],
    ];
    const done = await page.strike("Wren", { id: ids.seal, struck: true }, USER, BRANCH);
    expect(done.entry.writes.at(-1)).toMatchObject({ by: "player", wrote: { drop: true } });
    expect((await page.one("Wren", {}, USER, BRANCH)).knowledge.map((k) => k.struck)).toEqual([true, true]);
    expect((await page.one("Wren")).knowledge.map((k) => [k.id, k.struck])).toEqual(standing);
  });

  test("a strike made while a turn of the chat is open is applied after the newest reply: it is his own change, not written under the open turn", async () => {
    const { page, ids } = await played();
    const open = await page.t.begin();
    const own = page.t.s.changes(open.id).length;
    await page.strike("Wren", { id: ids.seal, struck: true });
    expect(page.t.s.changes(open.id)).toHaveLength(own);
    expect((await page.one("Wren")).knowledge.map((k) => [k.id, k.struck])).toEqual([
      [ids.seal, true],
      [ids.rent, true],
    ]);
  });
});

describe("the perception record and the player's own perception", () => {
  test("lists who on stage has a perception of a turn and who has none, says how the stage was read; a perception he writes closes the gap as his own change, and `knows: []` strikes what it gave", async () => {
    const t = await openTable();
    const first = await t.begin();
    const { wren, bram } = await t.writes.run((db) => ({ wren: addCharacter(db, USER, CHAT, "Wren", 1).id, bram: addCharacter(db, USER, CHAT, "Bram", 1).id }));
    await t.write(first, [
      { character: wren, part: "casting", item: `casting:${wren}`, value: { as: "principal" } },
      { character: bram, part: "casting", item: `casting:${bram}`, value: { as: "supporting" } },
      { character: wren, part: "perception", item: null, value: { of: first.id, reach: "whole", content: "She sees the seal." } },
    ]);
    await t.tie(first);
    const page = pageOn(t, async (_scope, turns) => new Map(turns.map((turn) => [turn, { who: ["Wren", "Bram", "Tam"], how: "owner" as const }])));
    const before = await page.record({ turn: first.id });
    expect(before.turns).toHaveLength(1);
    expect(before.turns[0]).toMatchObject({ turn: first.id, message: 1, read: "owner" });
    expect(before.turns[0]?.people.map((p) => [p.name, p.casting, p.perceptions.length])).toEqual([
      ["Wren", "principal", 1],
      ["Bram", "supporting", 0],
      ["Tam", null, 0],
    ]);

    // His own change: of no turn, so the turn is not written under and a run in progress is no matter.
    const changes = t.s.changes(first.id).length;
    const written = await page.perceive("Bram", { turn: first.id, reach: "part", content: "The seal glints behind the bar.", knows: ["The seal is chipped."] });
    expect(written.id).not.toBeNull();
    expect(written.knowledge).toHaveLength(1);
    expect(written.entry?.writes[0]).toMatchObject({ turn: null, by: "player" });
    expect(written.entry?.of).toEqual({ turn: first.id, message: 1 });
    expect(t.s.changes(first.id)).toHaveLength(changes);
    expect((await page.record({ turn: first.id })).turns[0]?.people.map((p) => p.perceptions.length)).toEqual([1, 1, 0]);

    // He corrects it: he now knows nothing from it, so what it gave is struck.
    const corrected = await page.perceive("Bram", { id: written.id ?? "", knows: [] });
    expect(corrected.struck).toEqual(written.knowledge);
    expect((await page.one("Bram")).knowledge.map((k) => k.struck)).toEqual([true]);

    // An id that is none of his is answered with the nearest ids he has.
    await expect(page.perceive("Bram", { id: "p-nowhere", content: "x" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("the owner's own edits of a character", () => {
  test("he pins Wren as principal, redraws her soul, binds an entry as her voice and names Odile the world's Tam: each lands as his own change, the Author is told, the page hears it, and a second page reads it", async () => {
    const { page, wren, odile } = await played();
    const { t } = page;
    t.shelf.put("entry", "e-112", "Wren's way of speaking", "r1");
    const told0 = told.length;
    const parts = (): string[] =>
      t.db
        .query<{ value: string }, [string]>("SELECT value FROM change WHERE chat = ? AND by = 'player' AND op = 'cast.write' ORDER BY ord")
        .all(CHAT)
        .map((c) => String(JSON.parse(c.value).part));

    // Pinned as supporting, then as principal; a pin stands over the Author's casting, and is told in his own change.
    const pinned = await page.edit("casting", wren, { as: "supporting", pin: true });
    expect(pinned).toMatchObject({ changed: true, character: { casting: { as: "supporting", pinned: true } } });
    expect((await page.edit("casting", wren, { as: "supporting", pin: true })).changed).toBe(false);
    expect((await page.edit("casting", wren, { as: "principal", pin: true, line: "Still the courier." })).character.casting).toEqual({ as: "principal", pinned: true, line: "Still the courier." });
    expect((await page.edit("casting", wren, { as: null, pin: false })).character.casting).toMatchObject({ pinned: false });
    await expect(page.edit("casting", wren, { as: null, pin: true })).rejects.toMatchObject({ status: 400 });

    // Her soul is redrawn outside any turn, drawn against the entry as it stands now; saying it again changes nothing.
    expect((await page.edit("sources", wren, { kind: "entry", ref: "e-112", defines: "voice" })).changed).toBe(true);
    expect((await page.edit("sources", wren, { kind: "entry", ref: "e-112" })).changed).toBe(false);
    await expect(page.edit("sources", wren, { kind: "entry", ref: "e-nowhere" })).rejects.toMatchObject({ status: 404 });
    expect((await page.edit("base", wren, { soul: "Wants to be believed." })).changed).toBe(true);
    expect((await page.edit("base", wren, { soul: "Wants to be believed." })).changed).toBe(false);
    const shown = await page.one("Wren");
    expect(shown.base.map((v) => [v.part, v.version, v.text, v.by])).toEqual([["soul", 1, "Wants to be believed.", "player"]]);
    expect(shown.now.parts).toEqual([{ part: "soul", version: 1, text: "Wants to be believed." }]);
    expect(shown.now.growth.map((g) => g.text)).toEqual(["Trusts her own eyes over a seal."]);
    expect(shown.sources).toEqual([expect.objectContaining({ kind: "entry", ref: "e-112", defines: "voice", title: "Wren's way of speaking", state: "current" })]);
    // The entry changes in Lumiverse after she was drawn: marked changed; gone: marked gone.
    t.shelf.put("entry", "e-112", "Wren's way of speaking", "r2");
    expect((await page.one("Wren")).sources[0]?.state).toBe("changed");
    t.shelf.remove("entry", "e-112");
    expect((await page.one("Wren")).sources[0]?.state).toBe("gone");
    expect((await page.edit("sources", wren, { kind: "entry", ref: "e-112", drop: true })).changed).toBe(true);
    expect((await page.one("Wren")).sources).toEqual([]);

    // Which person: by name, the nearest named for one the world lacks.
    expect((await page.edit("person", odile, { person: "Tam" })).character.person).toBe("tam");
    await expect(page.edit("person", odile, { person: "Tamm Nowhere" })).rejects.toMatchObject({ status: 404 });
    expect((await page.edit("person", odile, { person: null })).character.person).toBeNull();

    // Each is his own change in the story lane, which the briefing tells the Author of; the pages were told each time.
    expect(parts()).toEqual(["casting", "casting", "casting", "edit", "edit", "edit", "edit", "edit"]);
    expect(told.length - told0).toBe(8);
  });

  test("a character's page bounds each list and reads further back with part and skip: 600 memories", async () => {
    const page = pageOn(await openTable());
    const { t } = page;
    const bram = (await t.writes.run((db) => addCharacter(db, USER, CHAT, "Bram", 1))).id;
    await t.play([{ character: bram, part: "casting", item: `casting:${bram}`, value: { as: "principal" } }]);
    const turn = await t.begin();
    await t.write(
      turn,
      Array.from({ length: 600 }, (_, i): CastWrite => ({ character: bram, part: "memory", item: null, value: { text: `Memory number ${i}.`, gist: `m${i}` } })),
      "bram",
    );
    await t.tie(turn);
    const first = await callRoute(castRoutes({ store: t.store, writes: t.writes, files: () => shippedTexts(), settings: async () => ({ queryItems: 50 }), onStage: async () => new Map(), sources: t.shelf.reader, changed: () => {} })[1], { params: { chat: CHAT, character: "Bram" }, query: {}, user: USER });
    expect(first.listed).toBe(50);
    expect(first.memories).toMatchObject({ total: 600, before: 550, after: 0 });
    expect(first.memories.items.map((m) => m.fields.gist).at(-1)).toBe("m599");
    const back = await callRoute(castRoutes({ store: t.store, writes: t.writes, files: () => shippedTexts(), settings: async () => ({ queryItems: 50 }), onStage: async () => new Map(), sources: t.shelf.reader, changed: () => {} })[1], { params: { chat: CHAT, character: "Bram" }, query: { part: "memories", skip: "550" }, user: USER });
    expect(back.memories).toMatchObject({ total: 600, before: 0, after: 550 });
    expect(back.memories.items.map((m) => m.fields.gist)[0]).toBe("m0");
  });
});
