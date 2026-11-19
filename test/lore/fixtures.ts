// An invented coast for the lore's tests: a world on the shipped packs with lore of its own, books of
// invented entries standing in for a user's Lumiverse books, the tags of invented turns, and RPE's
// database with the lore's tables. Every name and text here is made up.

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import { defaultTiers } from "../../src/shared/tiers";
import { DEFAULT_CURRENCY, type LoreEntryDef, WORLD_FORMAT, type WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { giveWorldNumbers } from "../../src/lore/ids";
import { type ActivatedEntry, EntryNumbers, LORE_MIGRATIONS, type LoreBook, type LoreBookEntry, type LoreBooks, type LoreMapAsk, type LoreTurns, type LoreWorlds, type LoreWrites } from "../../src/lore/index";
import { STORE_MIGRATIONS } from "../../src/store";

export const USER = "user-coast";
export const OTHER_USER = "user-inland";
export const CHAT = "chat-reed";
export const POV = "nell";

/** Messages Lumiverse scans, as a lore map is given them: each text its own message, marked by its text. */
export function scanned(texts: readonly string[]): Pick<LoreMapAsk, "messages" | "texts"> {
  return { messages: texts.map((text, i) => ({ id: `message-${i}`, mark: text })), texts: async (ids) => new Map(ids.map((id) => [id, texts[Number(id.slice("message-".length))] ?? ""])) };
}

let shared: Registry | null = null;
/** The shipped packs' registry, built once per test file. */
export function registry(): Registry {
  shared ??= createRegistry(ALL_PACKS);
  return shared;
}

const entry = (id: string, title: string, keys: string[], content: string, more: Partial<LoreEntryDef> = {}): LoreEntryDef => ({ id, title, keys, content, links: [], ...more });

const COAST_KEYS = ["tithe_law", "cove_route", "drowned_crown", "ferry_draft", "gull_copy", "keeper_log"] as const;

/** The id each of the coast's own entries goes by once it has been seen: numbered in this order. */
export const W = Object.fromEntries(COAST_KEYS.map((key, i) => [key, `w-${i + 1}`])) as Record<(typeof COAST_KEYS)[number], string>;

/** The Reed Coast's own lore: public, known only to those who know what it links, secret, awaiting review, an earlier build's copy of a book entry, and one titled by words its keys never say. */
export const COAST_LORE: Record<string, LoreEntryDef> = {
  tithe_law: entry("tithe_law", "The harbor tithe", ["tithe", "harbor dues"], "Every boat pays a tenth of its catch at the harbor steps.", { aliases: ["the tenth"], topics: ["Harbor law"] }),
  cove_route: entry("cove_route", "The cove route", ["cove route"], "Sefa runs brandy through the cove at the new moon.", { visibility: "known_by", links: ["sefa", "smugglers_cove"] }),
  drowned_crown: entry("drowned_crown", "The drowned crown", ["crown"], "Orrin hid the old queen's crown under the lighthouse stair.", { secret: true, gate: "self.place == 'lighthouse'", holders: ["orrin"] }),
  ferry_draft: entry("ferry_draft", "The ferry", ["ferry"], "A flat ferry crosses the estuary at slack water.", { source: { kind: "ai", status: "pending" } }),
  gull_copy: entry("gull_copy", "Gulls (copied)", ["gull"], "An old copy of the gull entry.", { source: { kind: "book", bookId: "book-atlas", entryId: "entry-gull", hash: "copied-long-ago" } }),
  keeper_log: entry("keeper_log", "The lighthouse keeper's log", ["logbook"], "Forty winters of weather, written in a cramped hand."),
};

/** The Reed Coast: a fishmarket, net lofts, a lighthouse and a cove known only to those who know of it; four people and a carved gull. */
export function coastWorld(): WorldDoc {
  const tables = defaultTables();
  const person = (id: string, name: string, place: string): WorldDoc["entities"][string] => ({ id, kind: "character", name, tier: "supporting", fields: { place }, relations: [] });
  return {
    format: WORLD_FORMAT,
    id: "world-reed-coast",
    name: "The Reed Coast",
    engineVersion: "0.0.0",
    packs: Object.fromEntries(ALL_PACKS.map((p) => [p.id, { version: p.version, config: {} }])),
    pins: { generators: {}, tables: Object.fromEntries(Object.values(tables).map((t) => [t.id, t.revision])) },
    kinds: { character: { id: "character", label: "Character", extends: "person", fields: {} } },
    relations: {},
    entities: {
      [POV]: person(POV, "Nell Harrow", "fishmarket"),
      orrin: person("orrin", "Orrin Pell", "fishmarket"),
      sefa: person("sefa", "Sefa Moor", "smugglers_cove"),
      tobin: person("tobin", "Tobin Reed", "net_lofts"),
      carved_gull: { id: "carved_gull", kind: "item", name: "Carved gull", tier: "background", fields: { place: "fishmarket" }, relations: [] },
    },
    places: {
      reed_coast: { id: "reed_coast", name: "The Reed Coast", fields: {} },
      fishmarket: { id: "fishmarket", name: "The Fishmarket", parent: "reed_coast", fields: {} },
      net_lofts: { id: "net_lofts", name: "The Net Lofts", parent: "reed_coast", fields: {} },
      lighthouse: { id: "lighthouse", name: "The Lighthouse", parent: "reed_coast", fields: {} },
      smugglers_cove: { id: "smugglers_cove", name: "Smugglers' Cove", parent: "reed_coast", visibility: "known_by", fields: {} },
    },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: { system: "gregorian", epoch: "2031-05-01T00:00", timeZone: "Europe/London", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }], holidays: [] },
    schedules: {},
    tracks: {},
    tables,
    realism: { preset: "story", levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 2, sheets: 1 }, tierCaps: { principal: {}, supporting: {}, background: {} } },
    time: {
      sceneTicks: { conversation: 2, action: 1, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "ignore", arrival: "stop", overdue: "ignore", needs: "ignore", weather: "ignore" },
      speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } },
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    lore: COAST_LORE,
    loreIndex: { terms: { "the old law": ["tithe_law"] }, topics: { harbor_law: { label: "Harbor law", entries: ["tithe_law"] } } },
    loreBooks: ["book-songs"],
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: POV,
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "fishmarket", at: "2031-05-01T08:00" },
  };
}

/** The world at its start, whatever the chat: for tests that need no turns. */
export function startingWorlds(world: WorldDoc = coastWorld()): LoreWorlds {
  const reg = registry();
  const at = { registry: reg, world, state: initialState(world, hashJson(world), reg) };
  return { registry: reg, at: (user, chat) => (user === USER && chat === CHAT ? at : null) };
}

const row = (book: string, id: string, comment: string, keys: string[], content: string, more: Partial<LoreBookEntry> = {}): LoreBookEntry => ({ id, book, comment, keys, content, secondaryKeys: [], disabled: false, constant: false, vectorized: false, extensions: {}, revision: 1, ...more });

/** The engine's own mark on an entry it wrote into a book, as today's build left them. */
const ENGINE_WROTE: JsonObject = { lumi_rp_engine: { slot: "scene" } };

export const ATLAS: LoreBook = { id: "book-atlas", name: "Reed Coast Atlas" };
export const SONGS: LoreBook = { id: "book-songs", name: "Tavern Songs" };
export const CARD: LoreBook = { id: "book-card", name: "Nell's Card Book" };
export const INLAND: LoreBook = { id: "book-inland", name: "Inland Notes" };

/** The user's entries: in the atlas, one of every kind the lore reads or leaves out; a song; and in the card's book a twin of the lamp room. */
export function coastEntries(): LoreBookEntry[] {
  return [
    row(ATLAS.id, "entry-lamp", "The lamp room", ["lamp", "lantern"], "Green glass and whale oil, kept burning by the night watch.", { secondaryKeys: ["beacon"] }),
    row(ATLAS.id, "entry-gull", "", ["gull"], "Gulls nest on the harbor wall every spring and fight over the fish scraps."),
    row(ATLAS.id, "entry-tide", "The tide bell", ["tide bell"], "The bell rings at high water.\n{{// Secret (known to Orrin): Orrin cracked the bell with a hammer.}}"),
    row(ATLAS.id, "entry-slot", "Scene slot", ["lamp"], "The engine's own words about the lamp.", { extensions: ENGINE_WROTE }),
    row(ATLAS.id, "entry-off", "An old rumor", ["lamp"], "A rumor that the lamp keeper drinks.", { disabled: true }),
    row(SONGS.id, "entry-shanty", "The Lamplighter's Shanty", ["shanty"], "A song about the lamp room at the end of the world."),
    row(CARD.id, "entry-lamp-twin", "Lamp room (card)", ["lamp"], "Green glass and whale oil,   kept burning\nby the night watch."),
  ];
}

/** One user's books as the adapter would read them: the books, their entries, and which books each chat has attached. */
export interface ShelfOf {
  books: LoreBook[];
  entries: LoreBookEntry[];
  attached: Map<string, string[]>;
}

/** The coast's user and another user, each with books of their own. */
function coastShelves(): Map<string, ShelfOf> {
  return new Map([
    [USER, { books: [ATLAS, SONGS, CARD], entries: coastEntries(), attached: new Map([[CHAT, [ATLAS.id, CARD.id]]]) }],
    [OTHER_USER, { books: [INLAND], entries: [row(INLAND.id, "entry-inland", "Inland lamp", ["lamp"], "Another user's lamp, which no other user ever reads.")], attached: new Map([[CHAT, [INLAND.id]]]) }],
  ]);
}

/** Users' Lumiverse books, read as the adapter reads them: every call reads one user's rows. */
export class Shelf implements LoreBooks {
  constructor(readonly users: Map<string, ShelfOf> = coastShelves()) {}

  async attached(user: string, chat: string): Promise<string[]> {
    return [...(this.users.get(user)?.attached.get(chat) ?? [])];
  }

  async book(user: string, id: string): Promise<LoreBook | null> {
    return this.users.get(user)?.books.find((b) => b.id === id) ?? null;
  }

  async entries(user: string, book: string): Promise<LoreBookEntry[]> {
    return (this.users.get(user)?.entries ?? []).filter((e) => e.book === book);
  }

  async entry(user: string, id: string): Promise<LoreBookEntry | null> {
    return this.users.get(user)?.entries.find((e) => e.id === id) ?? null;
  }
}

/** The lore each turn's tag carried, as the turn lane keeps it. */
export class Tags implements LoreTurns {
  private readonly byTurn = new Map<string, ActivatedEntry[]>();

  set(user: string, chat: string, turn: string, activated: ActivatedEntry[]): void {
    this.byTurn.set(`${user}\u0000${chat}\u0000${turn}`, activated);
  }

  async activated(user: string, chat: string, turn: string): Promise<readonly ActivatedEntry[] | null> {
    return this.byTurn.get(`${user}\u0000${chat}\u0000${turn}`) ?? null;
  }
}

export interface LoreDb {
  db: Database;
  /** The application's write queue over it. */
  writes: LoreWrites;
  numbers: EntryNumbers;
  close(): Promise<void>;
}

/** RPE's database with the store's tables and the lore's, brought up by the application's own runner, every write through its queue. */
export function loreDb(file: string, backups: string, numberCoast = true): LoreDb {
  const db = openDatabase(file, 2_000);
  const migrations = new Migrations();
  // As on RPE's database, the store's turns are there: an overlay's write reads whether its turn was joined to another.
  migrations.add("store", STORE_MIGRATIONS);
  migrations.add("lore", LORE_MIGRATIONS);
  migrate(db, migrations, { user: USER, version: "lore-test", backups, now: () => 0 });
  // The coast's own entries have been seen, in this order, so each goes by the id `W` gives it.
  if (numberCoast) giveWorldNumbers(db, USER, "world-reed-coast", COAST_KEYS);
  const queue = new WriteQueue(db, 50);
  return {
    db,
    writes: queue,
    numbers: new EntryNumbers(db, queue),
    async close() {
      await queue.close();
      db.close();
    },
  };
}

/** A folder for a test's database and its copies. */
export function dbFile(dir: string): { file: string; backups: string } {
  return { file: join(dir, "rpe.db"), backups: join(dir, "backups") };
}
