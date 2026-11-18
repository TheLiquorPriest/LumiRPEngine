// The lore's route: the lore Lumiverse activated for a turn, each entry by the id the lore map gives it
// beside Lumiverse's own, in the tag's order, with how it activated where the tag says. Played over the
// store's turns and the turn lane's own table of tags. Every name here is made up.

import { afterEach, expect, test } from "bun:test";
import type { RawLayout } from "rp-harness/contract";
import { type App, type Area, RouteTable } from "../../src/app";
import { activatedLore, type ActivatedEntry, EntryNumbers, Lore } from "../../src/lore/index";
import type { TurnLoreRow } from "../../src/shared/api";
import { loreArea } from "../../src/lore/area";
import { loreRoutes, type LoreRoutesDeps, TURN_LORE_PATH } from "../../src/lore/routes";
import { JoinedTurnError } from "../../src/store";
import { PROMPT_MIGRATIONS } from "../../src/turn/tables";
import { type TurnPrompts, turnPrompts } from "../../src/turn/prompt";
import { callRoute } from "../app/call";
import { CHAT, openTable, type Table, USER } from "../story/rig";
import { ATLAS, CARD, coastEntries, Shelf, SONGS, startingWorlds } from "./fixtures";

const OTHER_USER = "user-b";
const OTHER_CHAT = "chat-b";
const LAYOUT: RawLayout = { messages: [], complete: true, blocks: [], blocksFrom: null, preset: null };

interface Bed {
  t: Table;
  numbers: EntryNumbers;
  prompts: TurnPrompts;
  /** The turn's tag is kept, as its request's arrival keeps it. */
  keep(turn: string, chat: string, lore: ActivatedEntry[], user?: string): Promise<void>;
  /** The route as the page asks it. */
  ask(turn: string, chat?: string, user?: string): Promise<TurnLoreRow[]>;
  deps: LoreRoutesDeps;
}

const beds: Table[] = [];
afterEach(() => {
  for (const t of beds.splice(0)) t.db.close();
});

async function openBed(): Promise<Bed> {
  const t = await openTable();
  beds.push(t);
  // The turn lane's table of what each turn's request carried, beside the store's and the lore's.
  await t.writes.run((d) => {
    for (const m of PROMPT_MIGRATIONS) d.run(m.sql);
  });
  const prompts = turnPrompts(t.db, t.writes, () => 1_000);
  const numbers = new EntryNumbers(t.db, t.writes);
  const deps = { store: t.store, turns: prompts.lore, numbers };
  const [route] = loreRoutes(deps);
  return {
    t,
    numbers,
    prompts,
    deps,
    keep: (turn, chat, lore, user = USER) => t.writes.run((d) => prompts.keep(d, { user, turn, chat, layout: LAYOUT, lore, cut: null, summarized: [], speaker: null, persona: null, at: 1_000 })),
    ask: async (turn, chat = CHAT, user = USER) => (await callRoute(route, { params: { chat, turn }, user })).entries,
  };
}

const tagged = (id: string, book: string | null, title: string, how: string | null): ActivatedEntry => ({ id, book, title, how });

test("a turn's activated lore names each entry's lore id and Lumiverse id, in the tag's order, with how it activated or null", async () => {
  const b = await openBed();
  const turn = await b.t.play();
  // The lore map numbered two of these entries earlier, in an order of its own: the ids are its numbers, not the tag's places.
  await b.numbers.of(USER, ["entry-tide", "entry-shanty"]);
  await b.keep(turn.id, CHAT, [
    tagged("entry-lamp", ATLAS.id, "The lamp room", "keyword"),
    tagged("entry-shanty", SONGS.id, "The Lamplighter's Shanty", "vector"),
    tagged("entry-tide", ATLAS.id, "The tide bell", "constant"),
    tagged("entry-gull", ATLAS.id, "  Gulls\n   of the  wall ", "sticky"),
    tagged("entry-lamp-twin", null, "", null),
    tagged("entry-slot", CARD.id, "Scene slot", "hybrid"),
  ]);
  expect(await b.ask(turn.id)).toEqual([
    { id: "e-3", entry: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "keyword", receipt: null },
    { id: "e-2", entry: "entry-shanty", book: SONGS.id, title: "The Lamplighter's Shanty", how: "vector", receipt: null },
    { id: "e-1", entry: "entry-tide", book: ATLAS.id, title: "The tide bell", how: "constant", receipt: null },
    { id: "e-4", entry: "entry-gull", book: ATLAS.id, title: "Gulls of the wall", how: "sticky", receipt: null },
    { id: "e-5", entry: "entry-lamp-twin", book: "", title: "", how: null, receipt: null },
    { id: "e-6", entry: "entry-slot", book: CARD.id, title: "Scene slot", how: null, receipt: null },
  ]);
  // The same ids as the lore map gives the same entries: asked of the lore itself over the same numbers and tag.
  const shelf = new Shelf(new Map([[USER, { books: [ATLAS, SONGS, CARD], entries: coastEntries(), attached: new Map() }]]));
  const lore = new Lore({ books: shelf, worlds: startingWorlds(), turns: b.prompts.lore, numbers: b.numbers });
  const mapped = await lore.activated({ user: USER, chat: CHAT, turn: turn.id });
  const asked = await b.ask(turn.id);
  expect(mapped.map((m) => [m.id, m.how ?? null])).toEqual(asked.map((e) => [e.id, e.how]));
  // The map titles the entry the tag left untitled from its book; the route says what the tag says.
  expect(mapped.filter((m) => m.id !== "e-5").map((m) => m.title)).toEqual(asked.filter((e) => e.id !== "e-5").map((e) => e.title));
  expect(mapped.find((m) => m.id === "e-5")?.title).toBe("Lamp room (card)");
});

test("a turn RPE holds no tag for, or one of another chat, answers no entries", async () => {
  const b = await openBed();
  const first = await b.t.play();
  const second = await b.t.play();
  await b.t.writes.run(() => b.t.s.createChat({ id: OTHER_CHAT }));
  const elsewhere = await b.t.writes.run(() => b.t.s.beginTurn({ chat: OTHER_CHAT, kind: "new" }));
  await b.keep(first.id, CHAT, [tagged("entry-lamp", ATLAS.id, "The lamp room", "keyword")]);
  await b.keep(elsewhere.id, OTHER_CHAT, [tagged("entry-gull", ATLAS.id, "Gulls", "keyword")]);
  // Each turn answers its own tag and no other turn's.
  expect((await b.ask(first.id)).map((e) => e.entry)).toEqual(["entry-lamp"]);
  expect((await b.ask(elsewhere.id, OTHER_CHAT)).map((e) => e.entry)).toEqual(["entry-gull"]);
  // A turn of the chat that kept no tag; a turn the chat does not hold; one of another chat, asked for under this one.
  expect(await b.ask(second.id)).toEqual([]);
  expect(await b.ask("turn-nowhere")).toEqual([]);
  expect(await b.ask(elsewhere.id, CHAT)).toEqual([]);
  expect(await b.ask(first.id, OTHER_CHAT)).toEqual([]);
  // A chat RPE has none of, and a user who has none of this one: nothing of another user's is read.
  expect(await b.ask(first.id, "chat-nowhere")).toEqual([]);
  expect(await b.ask(first.id, CHAT, OTHER_USER)).toEqual([]);
  // A tag that lists nothing.
  await b.keep(second.id, CHAT, []);
  expect(await b.ask(second.id)).toEqual([]);
});

test("the exported reader and the route give the same entries for a turn", async () => {
  const b = await openBed();
  const turn = await b.t.play();
  await b.keep(turn.id, CHAT, [tagged("entry-lamp", ATLAS.id, "The lamp room", "keyword"), tagged("entry-tide", null, "The tide bell", "sticky"), tagged("entry-gull", ATLAS.id, "Gulls", "nonsense")]);
  const read = await activatedLore(b.deps, USER, CHAT, turn.id);
  expect(read).toHaveLength(3);
  expect(await b.ask(turn.id)).toEqual(read.map((entry) => ({ ...entry, receipt: null })));
  expect(await activatedLore(b.deps, USER, OTHER_CHAT, turn.id)).toEqual([]);
});

test("a turn joined to another is answered as a fact naming the turn it joined", async () => {
  const b = await openBed();
  const first = await b.t.play();
  const held = await b.t.writes.run(() => {
    const turn = b.t.s.beginTurn({ chat: CHAT, kind: "continue", on: first.node });
    b.t.s.joinTurn(turn.id, first.id);
    return turn;
  });
  await b.keep(held.id, CHAT, [tagged("entry-lamp", ATLAS.id, "The lamp room", "keyword")]);
  const [route] = loreRoutes(b.deps);
  let thrown: unknown = null;
  try {
    await callRoute(route, { params: { chat: CHAT, turn: held.id }, user: USER });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(JoinedTurnError);
  expect((thrown as JoinedTurnError).joined).toBe(first.id);
});

test("the lore area adds the route once the turn lane's parts are handed to it, and none without them", async () => {
  const b = await openBed();
  const turn = await b.t.play();
  await b.keep(turn.id, CHAT, [tagged("entry-lamp", ATLAS.id, "The lamp room", "keyword")]);
  const mounted = (area: Area): { table: RouteTable; run(): Promise<void> } => {
    const table = new RouteTable();
    const at = { routes: table, db: b.t.db, writes: b.t.writes } as unknown as App;
    return { table, run: async () => void (await area.mounted?.(at)) };
  };
  const without = mounted(loreArea());
  await without.run();
  expect(without.table.list()).toEqual([]);
  const withParts = mounted(loreArea(() => ({ store: b.t.store, turns: b.prompts.lore })));
  await withParts.run();
  expect(withParts.table.list().map((r) => [r.area, r.method, r.path, r.declared.group])).toEqual([["lore", "GET", TURN_LORE_PATH, "lore"]]);
  expect(withParts.table.list()[0]?.declared.joined).toBe(true);
});
