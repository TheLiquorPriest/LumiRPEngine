// A synthetic large world for the memory measurements (`engine-state.ts`): the shipped Port Alder
// starter scaled up with generated filler to about 800 entities and 650 lore entries. Every added
// name, place and lore text is generated here from neutral syllables and words; nothing comes from
// any player's world.

import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { bookTextHash } from "../../src/shared/lore";
import { STARTER_WORLDS } from "../../src/packs/index";

const FIRST = ["Ar", "Bel", "Cor", "Dun", "El", "Fen", "Gal", "Hal", "Is", "Jor", "Kel", "Lin", "Mor", "Nel", "Or", "Pel", "Quin", "Ros", "Sel", "Tor", "Ul", "Ven", "Wil", "Yar", "Zel"];
const END = ["a", "an", "en", "in", "on", "o", "is", "ys", "eth", "ar"];
const LAST = ["Ash", "Brook", "Cald", "Dorn", "Elm", "Fair", "Glen", "Hart", "Ivy", "Kirk", "Lark", "Mill", "North", "Oak", "Pike", "Reed", "Stone", "Thorn", "Vale", "West"];
const TAIL = ["ford", "by", "wick", "ton", "more", "dale", "well", "worth", "field", "son"];
const WORDS = ["harbor", "morning", "ledger", "window", "corner", "lantern", "bench", "market", "ferry", "garden", "workshop", "letter", "kettle", "bridge", "orchard", "railway", "counter", "schedule", "festival", "weather", "shelf", "notebook", "staircase", "parcel", "radio", "bicycle", "awning", "porch", "fence", "tide"];
const VERBS = ["keeps", "mends", "watches", "sorts", "carries", "paints", "counts", "opens", "closes", "visits"];
const TRAITS = ["patient", "curious", "brisk", "careful", "cheerful", "quiet", "stubborn", "generous", "wry", "restless"];
const TAGS = ["home", "workplace", "cafe", "park", "grocery", "civic"];
const SCENES = ["downtime", "work", "conversation", "exploration"];

/** A deterministic generator, so every run builds the same world. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

/** A neutral generated sentence run: `n` sentences of filler about `subject`. */
function filler(r: () => number, subject: string, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${subject} ${pick(r, VERBS)} the ${pick(r, WORDS)} by the ${pick(r, WORDS)} near the ${pick(r, WORDS)}.`);
  return out.join(" ");
}

export interface LargeWorldSize {
  places: number;
  people: number;
  agents: number;
  items: number;
  containers: number;
  vehicles: number;
  lore: number;
}

/** About 800 entities and 650 lore entries over Port Alder's 114 and 26. */
export const LARGE: LargeWorldSize = { places: 80, people: 250, agents: 24, items: 380, containers: 40, vehicles: 16, lore: 624 };

/** How many of the generated lore entries a World Info book of the player's holds (`book`): imported lore the engine reads live. */
export const BOOK_LORE = 320;

/**
 * Port Alder with generated places, people, things and lore added. With `book`, the first
 * `BOOK_LORE` generated entries are indexed from that World Info book (its entries, in order, hold
 * their text) and the world reads the book live, as lore imported from World Info does.
 */
export function largeWorld(id: string, name: string, book?: { bookId: string; entryIds: readonly string[] }, size: LargeWorldSize = LARGE): WorldDoc {
  const base = STARTER_WORLDS.modern_slice_of_life;
  if (!base) throw new Error("no Port Alder starter");
  const w = base(id, name);
  const r = rng(7);
  const placeIds: string[] = [];
  for (let i = 0; i < size.places; i++) {
    const pid = `gen_place_${i}`;
    placeIds.push(pid);
    const label = `${pick(r, LAST)}${pick(r, TAIL)} ${i % 3 === 0 ? "Row" : i % 3 === 1 ? "Yard" : "Court"} ${i + 1}`;
    w.places[pid] = { id: pid, name: label, fields: { description: filler(r, label, 2), tags: [pick(r, TAGS)] }, parent: "port_alder", timeZone: "America/New_York", sceneType: pick(r, SCENES) } as WorldDoc["places"][string];
    w.routes[`gen_route_${i}`] = { id: `gen_route_${i}`, from: pid, to: i === 0 ? "bluebird_coffee" : (placeIds[Math.floor(r() * i)] as string), modes: { walk: { minutes: 2 + Math.floor(r() * 8), distanceKm: 0.2 } }, bidirectional: true } as WorldDoc["routes"][string];
  }
  const people: string[] = [];
  // Written as plain JSON, as a world file holds them; the world's lint checks them on commit.
  const entities = w.entities as unknown as Record<string, JsonObject>;
  for (let i = 0; i < size.people; i++) {
    const pid = `gen_person_${i}`;
    people.push(pid);
    const full = `${FIRST[i % FIRST.length]}${END[Math.floor(i / FIRST.length) % END.length]} ${LAST[i % LAST.length]}${TAIL[Math.floor(i / LAST.length) % TAIL.length]}`;
    const home = pick(r, placeIds);
    const agent = i < size.agents;
    entities[pid] = {
      id: pid,
      kind: "character",
      name: full,
      tier: agent ? "supporting" : "background",
      ...(agent ? { agent: true } : {}),
      fields: { description: filler(r, full, 3), role: `Keeps the ${pick(r, WORDS)}`, age: 20 + Math.floor(r() * 50), traits: [pick(r, TRAITS), pick(r, TRAITS)], place: home, home, activity: "idle", wealth: "modest", mechanics: 8 + Math.floor(r() * 8), driving: 8 + Math.floor(r() * 8), charm: 8 + Math.floor(r() * 8), fitness: 8 + Math.floor(r() * 8), region: "mi" },
      relations: [],
    };
    if (agent) {
      const work = pick(r, placeIds);
      w.schedules[`${pid}_place_1`] = { id: `${pid}_place_1`, owner: pid, target: "place", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "08:00", end: "12:00", value: work }, { start: "12:00", end: "13:00", value: "bluebird_coffee" }, { start: "13:00", end: "17:00", value: work }], pack: "castlife" } as WorldDoc["schedules"][string];
      w.schedules[`${pid}_activity_1`] = { id: `${pid}_activity_1`, owner: pid, target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "08:00", end: "12:00", value: "working" }, { start: "12:00", end: "13:00", value: "lunch" }, { start: "13:00", end: "17:00", value: "working" }], pack: "castlife" } as WorldDoc["schedules"][string];
    }
  }
  // Each person regards a few others.
  for (let i = 0; i < people.length; i++) {
    const relations = entities[people[i] as string]?.relations as JsonObject[];
    for (let k = 1; k <= 3; k++) relations.push({ type: "regard", to: people[(i + k * 7) % people.length] as string, fields: { warmth: Math.floor(r() * 60), trust: Math.floor(r() * 60), respect: Math.floor(r() * 60), t: 0 } });
  }
  for (let i = 0; i < size.vehicles; i++) {
    const vid = `gen_vehicle_${i}`;
    const owner = pick(r, people);
    const home = entities[owner]?.fields as JsonObject;
    entities[vid] = { id: vid, kind: "vehicle", name: `${pick(r, LAST)} sedan ${i + 1}`, tier: "background", fields: { description: filler(r, "The sedan", 2), place: home.home as string, owner, class: "pickup_midsize", status: "ok", fuel_pct: 50, odometer_mi: 40000 + i * 1000, home: home.home as string, condition: 70, year: 2018 }, relations: [] };
  }
  const containers: string[] = [];
  for (let i = 0; i < size.containers; i++) {
    const cid = `gen_box_${i}`;
    containers.push(cid);
    const owner = pick(r, people);
    entities[cid] = { id: cid, kind: "container", name: `${pick(r, WORDS)} box ${i + 1}`, tier: "background", fields: { description: filler(r, "The box", 1), owner, weight_g: 2000, catalog: "toolbox_20in", capacity_l: 20, max_load_kg: 15 }, relations: [{ type: "in", to: owner }] };
  }
  for (let i = 0; i < size.items; i++) {
    const iid = `gen_item_${i}`;
    const label = `${pick(r, WORDS)} ${i + 1}`;
    const where = i % 3;
    if (where === 0) entities[iid] = { id: iid, kind: "item", name: label, tier: "background", fields: { description: filler(r, `The ${label}`, 1), weight_g: 100 + Math.floor(r() * 900), place: pick(r, placeIds) }, relations: [] };
    else if (where === 1) entities[iid] = { id: iid, kind: "item", name: label, tier: "background", fields: { description: filler(r, `The ${label}`, 1), owner: pick(r, people), weight_g: 50, volume_l: 0.05, category: "carried" }, relations: [{ type: "in", to: pick(r, containers) }] };
    else {
      const owner = pick(r, people);
      entities[iid] = { id: iid, kind: "item", name: label, tier: "background", fields: { description: filler(r, `The ${label}`, 1), owner, weight_g: 90, volume_l: 0.08, category: "carried", catalog: "keys_set", slot: "pocket" }, relations: [{ type: "in", to: owner }, { type: "worn_by", to: owner, fields: { slot: "pocket" } }] };
    }
  }
  for (let i = 0; i < size.lore; i++) {
    const about = i % 2 === 0 ? pick(r, people) : pick(r, placeIds);
    const title = i % 2 === 0 ? `${String(entities[about]?.name)}'s ${pick(r, WORDS)}` : `${w.places[about]?.name ?? about} ${pick(r, WORDS)}`;
    const content = filler(r, title, 8 + Math.floor(r() * 8));
    const entryId = book?.entryIds[i];
    const source = book && entryId ? { source: { kind: "book", bookId: book.bookId, entryId, hash: bookTextHash(content) } } : {};
    w.lore[`gen_lore_${i}`] = { id: `gen_lore_${i}`, title, content, keys: [title, `${pick(r, WORDS)} ${i}`], links: [about], ...source } as WorldDoc["lore"][string];
  }
  if (book) w.loreBooks = [book.bookId];
  return w;
}

/** The generated lore a World Info book holds for `largeWorld`'s `book`: title, text and keys of each, in order. */
export function bookLore(): { title: string; content: string; keys: string[] }[] {
  const lore = Object.values(largeWorld("w_lore", "lore").lore).filter((e) => e.id.startsWith("gen_lore_"));
  return lore.slice(0, BOOK_LORE).map((e) => ({ title: e.title, content: e.content, keys: [...e.keys] }));
}
