// An invented world on the shipped packs, and small helpers to play turns into a store. Every name
// here is made up for these tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { defaultTiers } from "../../src/shared/tiers";
import { DEFAULT_CURRENCY, WORLD_FORMAT, type WorldDoc } from "../../src/shared/world";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { contentId } from "../../src/engine/ledger/path";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { openStore, type Store, type StoreOptions, type UserStore } from "../../src/store/store";
import type { ChangeInput, ShownMessage, TurnRow } from "../../src/store/types";
import type { TreeView } from "../../src/store/view";
import { readPart, type Part } from "../../src/store/words";
import { STORY_STORE_AREA } from "../../src/story";

/** The world state's layout as shipped: the words of every line of the tree. */
export const SHIPPED_LAYOUT: string = readFileSync(join(import.meta.dir, "..", "..", "guidance", ".prompts", "world-state.md"), "utf8");
export const SHIPPED_PART: Part = readPart(SHIPPED_LAYOUT, "world-state.md");

/** A query worded by the shipped part, as an agent reads it (`world_query`); empty when nothing is called `at`. */
export function say(view: TreeView, at: string, depth: number | "full"): string {
  return view.print(at, depth, SHIPPED_PART) ?? "";
}

export const POV = "wren";
export const USER = "user-a";

let shared: Registry | null = null;
/** The shipped packs' registry, built once per test file. */
export function registry(): Registry {
  shared ??= createRegistry(ALL_PACKS);
  return shared;
}

/** Thornbury in the Hollow Vale: an inn with a common room and a cellar, a market square, a road out, a courier and the people around her. */
export function inventedWorld(): WorldDoc {
  const tables = defaultTables();
  const person = (id: string, name: string, tier: string, fields: JsonObject, relations: WorldDoc["entities"][string]["relations"] = []): WorldDoc["entities"][string] => ({ id, kind: "character", name, tier, fields, relations });
  const thing = (id: string, kind: string, name: string, fields: JsonObject, relations: WorldDoc["entities"][string]["relations"] = []): WorldDoc["entities"][string] => ({ id, kind, name, tier: "background", fields, relations });
  return {
    format: WORLD_FORMAT,
    id: "world-thornbury",
    name: "The Hollow Vale",
    engineVersion: "0.0.0",
    packs: Object.fromEntries(ALL_PACKS.map((p) => [p.id, { version: p.version, config: {} }])),
    pins: { generators: {}, tables: Object.fromEntries(Object.values(tables).map((t) => [t.id, t.revision])) },
    kinds: { character: { id: "character", label: "Character", extends: "person", fields: {} } },
    relations: {},
    entities: {
      [POV]: person(POV, "Wren", "principal", { place: "common_room", home: "lamp_ladle", description: "A courier with mud on her boots." }),
      bram: person("bram", "Bram", "principal", { place: "common_room", description: "Keeps the inn." }, [{ type: "member_of", to: "lamplighters", fields: { role: "warden" } }]),
      odile: person("odile", "Odile", "supporting", { place: "cellar" }, [{ type: "member_of", to: "lamplighters" }]),
      tam: person("tam", "Tam", "background", { place: "market_square" }),
      satchel: thing("satchel", "container", "Satchel", {}, [{ type: "in", to: POV }]),
      purse: thing("purse", "container", "Coin purse", {}, [{ type: "in", to: POV }]),
      acct_wren: thing("acct_wren", "account", "Wren's coin", { owners: [{ party: POV, role: "owner" }], product: "cash", opening: 1200 }, [{ type: "in", to: "purse" }]),
      knife: thing("knife", "item", "Knife", {}, [{ type: "in", to: "satchel" }]),
      cloak: thing("cloak", "item", "Grey cloak", {}, [
        { type: "in", to: POV },
        { type: "worn_by", to: POV },
      ]),
      cask: thing("cask", "item", "Cask of cider", { place: "cellar" }),
      bell: thing("bell", "item", "Market bell", { place: "market_square" }),
      lamplighters: thing("lamplighters", "faction", "The Lamplighters", { description: "Keepers of the town's lamps." }),
      region_vale: thing("region_vale", "region", "The vale's weather", { climate: "temperate", weather: "rain" }),
    },
    places: {
      vale: { id: "vale", name: "Hollow Vale", timeZone: "Europe/London", fields: { region: "region_vale", law: "the Vale charter", description: "A wet green valley." } },
      thornbury: { id: "thornbury", name: "Thornbury", parent: "vale", fields: { law: "the watch's rules", curfew: "midnight", tags: ["town"] } },
      lamp_ladle: { id: "lamp_ladle", name: "The Lamp and Ladle", parent: "thornbury", fields: { owner: "bram", description: "A crooked inn." } },
      common_room: { id: "common_room", name: "The Common Room", parent: "lamp_ladle", fields: { description: "Smoky and loud." } },
      cellar: { id: "cellar", name: "The Cellar", parent: "lamp_ladle", fields: {} },
      market_square: { id: "market_square", name: "Market Square", parent: "thornbury", fields: {} },
      far_road: { id: "far_road", name: "The Far Road", parent: "vale", fields: {} },
    },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: { system: "gregorian", epoch: "2031-03-01T00:00", timeZone: "Europe/London", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }], holidays: [] },
    schedules: {},
    tracks: {
      errand: { id: "errand", kind: "quest", label: "The sealed letter", owner: POV, start: "asked", visibility: "public", stages: { asked: { label: "Asked", next: [{ to: "done", when: "false" }] }, done: { label: "Delivered", next: [] } } },
    },
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
    lore: {},
    loreIndex: { terms: {}, topics: {} },
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: POV,
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "common_room", at: "2031-03-01T08:00" },
  };
}

export interface TestStore {
  store: Store;
  s: UserStore;
  world: WorldDoc;
  revision: string;
  worlds: Map<string, WorldDoc>;
}

/**
 * Moves the clock of the world a stored snapshot at `node` holds by `minutes`, as stored: the snapshot names a new part for its
 * world's own values. What a cold start then builds on shows whether it began at that snapshot.
 */
export function moveStoredClock(db: Store["db"], node: string, minutes: number): void {
  const row = db.query<{ user: string; state: string }, [string]>("SELECT user, state FROM snapshot WHERE node = ?").get(node);
  if (!row) throw new Error(`no snapshot at ${node}`);
  const doc = JSON.parse(row.state) as { parts: Record<string, string> };
  const body = db.query<{ body: string }, [string, string]>("SELECT body FROM snapshot_part WHERE user = ? AND hash = ?").get(row.user, doc.parts.w ?? "")?.body;
  if (body === undefined) throw new Error(`no world part for the snapshot at ${node}`);
  const world = JSON.parse(body) as { clock: number };
  world.clock += minutes;
  const hash = `moved.${node}.${minutes}`;
  db.run("INSERT OR IGNORE INTO snapshot_part (user, hash, body, refs) VALUES (?, ?, ?, 0)", [row.user, hash, JSON.stringify(world)]);
  db.run("UPDATE snapshot SET state = ? WHERE node = ?", [JSON.stringify({ ...doc, parts: { ...doc.parts, w: hash } }), node]);
}

/** A store in memory over the invented world (and any further revisions), with one user, and the story's area (the Author's horizon) unless others are given. */
export function testStore(options: Partial<Omit<StoreOptions, "db" | "worlds">> & { db?: StoreOptions["db"]; world?: WorldDoc; more?: WorldDoc[] } = {}): TestStore {
  const { world: given, more, db, registry: reg, ...rest } = options;
  const world = given ?? inventedWorld();
  const worlds = new Map<string, WorldDoc>([[hashJson(world), world]]);
  for (const w of more ?? []) worlds.set(hashJson(w), w);
  const store = openStore({ areas: [STORY_STORE_AREA], ...rest, db: db ?? ":memory:", registry: reg ?? registry(), worlds: (r) => worlds.get(r) });
  return { store, s: store.user(USER), world, revision: hashJson(world), worlds };
}

// ---------------------------------------------------------------- events, as today's engine writes them

export const tick = (minutes: number): LedgerEvent => ({ type: "clock", minutes, cause: "tick" });
export const goTo = (entity: string, place: string): LedgerEvent => ({ type: "set", entity, field: "place", value: place });
export const pay = (account: string, cents: number, memo: string): LedgerEvent => ({ type: "post", lines: [{ account, amount: -cents }, { account: `${EXTERNAL_ACCOUNT_PREFIX}market`, amount: cents }], memo });
export const make = (id: string, name: string, holder: string): LedgerEvent => ({ type: "spawn", entity: { id, kind: "item", name, tier: "background", fields: {}, relations: [{ type: "in", to: holder }] } });
/** A thing handed from one holder to another: one unit, as today's item moves are. */
export function hand(item: string, from: string, to: string): LedgerEvent[] {
  const group = `hand:${item}:${from}:${to}`;
  return [
    { type: "unlink", rel: "in", from: item, to: from, group },
    { type: "link", rel: "in", from: item, to, group },
  ];
}

/** Engine-lane changes for events, by the GM. */
export function engine(...events: LedgerEvent[]): ChangeInput[] {
  return events.map((e) => ({ lane: "engine", op: e.type, value: e as unknown as JsonObject, by: "gm", source: "gm" }));
}

export const hashOf = (text: string): string => contentId(text).hash;

/** One played reply: a turn begun after the head (or as a swipe of `target`), its changes recorded, tied to `message`. */
export function play(s: UserStore, chat: string, message: string, text: string, date: number, changes: ChangeInput[], options: { target?: string; on?: string | null; kind?: string } = {}): TurnRow {
  const t = s.beginTurn({ chat, kind: options.kind ?? (options.target ? "swipe" : "normal"), target: options.target ?? null, ...(options.on !== undefined ? { on: options.on } : {}) });
  if (changes.length > 0) s.addChanges(t.id, changes);
  return s.tieTurn(t.id, { message, hash: hashOf(text), date });
}

/** A chat as the chat application shows it: user messages, and replies by the text and date of the swipe showing. */
export function shown(...messages: ([string, string] | [string, string, number])[]): ShownMessage[] {
  return messages.map(([id, text, date]) => (date === undefined ? { id, user: true, hash: hashOf(text), hidden: false } : { id, user: false, hash: hashOf(text), date, hidden: false }));
}

/** Who holds what, as the engine says: every thing whose chain of holders reaches `who`, sorted. */
export function carried(state: { entities: Record<string, { relations: { type: string; to: string }[] }> }, who: string): string[] {
  const out: string[] = [];
  for (const id of Object.keys(state.entities)) {
    let at: string | undefined = id;
    for (let guard = 0; at && guard < 16; guard++) {
      at = state.entities[at]?.relations.find((r) => r.type === "in")?.to;
      if (at === who) {
        out.push(id);
        break;
      }
    }
  }
  return out.sort();
}
