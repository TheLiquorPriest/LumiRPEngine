// A long chat of the previous build, as large as a long-played one, and the first reading of it after RPE starts, measured. Everything
// is invented.
//
// `bundle <folder>` makes the chat as the previous build left it, in a folder `bigchat-load.ts` loads into a Lumiverse instance: a
// starter world padded to `--bytes` a revision, `--revisions` revisions of it; `--replies` replies (the greeting one of them), `--swipes`
// swipes on them in all; the last `--records` replies played by the previous build's own ledger core and simulation, the chat moved
// onto each revision in turn, and each record carrying what the previous build recorded on a played reply (its prompt trace, its
// harness turn's record and departures, the parts its final review saw) sized so that the records on the messages and the chat's
// journal come to `--ledger-bytes` in all.
//
// `bundle <folder> --heavy` makes the heavy chat (c-heavychat-0001) beside it, as heavy as a long-played chat of a busy town: the
// starter's shop copied to `--businesses` more businesses, each with its owner, premises (`--rooms` rooms), accounts, bills, vehicles
// and a property, the player character owning a share of each so its page shows its money; the starter's townsfolk copied to
// `--people` characters in all, each with a home, an account, a bill, a job and what they carry; the starter's tracks copied to
// `--tracks`. Its played replies pass story time as the engine passes it: every `--skip-every`th a time skip of `--skip-hours` hours,
// a turn's tick otherwise; `--stages` of them move a track on; each also holds what the minds pack recorded (minds, memories, who was
// there, facts learned). Each record names its harness transcript, segment, summary and kept segments as blobs in the user's storage
// (under the bundle's `storage/`), which the migration lays beside the record it keeps: 15 KB of them for most, growing to
// `--record-bytes` for the newest 40.
//
// `make <root>` loads a bundle into the migration's fixture and runs `rpe migrate` (this checkout's, or `--rpe <rpe.js>`) into
// `<root>/rpe-data`; for the heavy chat it then writes its base (`base`). `base <RPE data folder> <chat>` writes the heavy chat's base
// on its first turn, through the cast's and the story's own writers, with RPE stopped: `--base-cast` cast writes for
// `--base-characters` characters and `--base-story` story writes. `read <root>` starts `rpe serve` on that data folder, has
// `--pages` pages read the chat at once as a page does when it opens it, asks RPE's status every 50 ms meanwhile, and prints one line
// of JSON: the processor seconds and the peak memory of the server until every read was answered, the longest a status took, and
// each read's time. Run it twice for the start and a restart.
// Usage: bun scripts/perf/long-chat.ts bundle <folder> [--replies 576] [--swipes 916] [--records 181] [--revisions 155] [--bytes 1400000] [--ledger-bytes 26800000]
//        bun scripts/perf/long-chat.ts bundle <folder> --heavy [--bytes 1700000] [--people 95] [--businesses 45] [--rooms 4] [--tracks 16] [--skip-every 3] [--skip-hours 2] [--stages 5] [--record-bytes 8300000]
//        bun scripts/perf/long-chat.ts make <root> <bundle folder> [--rpe <rpe.js>]
//        bun scripts/perf/long-chat.ts base <RPE data folder> <chat> [--base-cast 4661] [--base-story 1553] [--base-characters 36]
//        bun scripts/perf/long-chat.ts read <root> [--pages 3] [--rpe <rpe.js>]

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ChatSnapshots, encodeLedger } from "../../src/migrate/today/ledger-io";
import { addCharacter, type CastWrite, writeCast } from "../../src/cast";
import { openStore, storedWorlds } from "../../src/store";
import { type StoryWrite, writeStory } from "../../src/story";
import { STORE_AREAS } from "../../src/turn/store-areas";
import { emptyJournal, LedgerCore, type LedgerEnv, type TurnModel } from "../../src/engine/ledger/journal";
import { LedgerFold } from "../../src/engine/ledger/fold";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { resolveFix } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { planTurn, postTurn, TIMELAPSE_ACTION } from "../../src/engine/turn";
import type { InterpretOutput } from "../../src/engine/steps";
import { installHistoryLines } from "../../src/iface/history-lines";
import { shippedTexts } from "../../src/iface/texts";
import { ALL_PACKS } from "../../src/packs/index";
import { STARTER_WORLDS } from "../../src/packs/starters";
import { hashJson } from "../../src/shared/hash";
import type { ChatRun, LedgerEvent, Rec } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { WorldState } from "../../src/engine/state";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { commandSocketPath } from "../../src/app/data-folder";
import { buildFixture, STRAY, USER } from "../../test/migrate/fixture";
import { loadBundle } from "./bigchat-load";

const REPO = resolve(import.meta.dir, "../..");

const [command, rootArg, bundleArg] = process.argv.slice(2);
const { values } = parseArgs({
  args: process.argv.slice(command === "make" || command === "base" ? 5 : 4),
  options: {
    replies: { type: "string" },
    swipes: { type: "string" },
    records: { type: "string" },
    revisions: { type: "string" },
    bytes: { type: "string" },
    "ledger-bytes": { type: "string" },
    pages: { type: "string" },
    heavy: { type: "boolean" },
    people: { type: "string" },
    businesses: { type: "string" },
    rooms: { type: "string" },
    tracks: { type: "string" },
    "skip-every": { type: "string" },
    "skip-hours": { type: "string" },
    stages: { type: "string" },
    "record-bytes": { type: "string" },
    "base-cast": { type: "string" },
    "base-story": { type: "string" },
    "base-characters": { type: "string" },
    rpe: { type: "string" },
  },
});
const HEAVY = values.heavy === true;
/** RPE's entry `make`, `read` and `trial` run: this checkout's, or a built rpe.js. */
const MAIN = values.rpe === undefined ? join(REPO, "src/app/main.ts") : resolve(values.rpe);
const CHAT_ID = HEAVY ? "c-heavychat-0001" : "c-bigchat-0001";
const WORLD_ID = HEAVY ? "w_4ea7c4a700000001" : "w_b16c4a7000000001";
const CHARACTER_ID = HEAVY ? "ch-heavychat-0001" : "ch-bigchat-0001";
/** What the chat's message ids start with: the two chats stand in one Lumiverse, whose message ids are its own across chats. */
const MESSAGE = HEAVY ? "heavy" : "big";
const num = (v: string | undefined, d: number): number => (v === undefined ? d : Number(v));

/** Invented prose, the same for the same seed: words drawn from a small list, so it neither repeats nor packs away to nothing. */
function proseOf(seed: number): (chars: number) => string {
  const WORDS = "the harbour lantern rain market alley cafe barista phone bus stop morning evening laughs quietly window street corner bakery shutter ferry horn lake bells wind coat umbrella neighbour garage engine radio song tea kettle letter key door stairs light shadow cat dog bicycle bench park fountain pigeons clock tower train platform ticket wallet coins receipt promise memory stranger friend sister brother mother father work shift manager notes plan route map evening news weather cold warm quiet loud slow fast careful tired hopeful".split(" ");
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  return (chars) => {
    let out = "";
    while (out.length < chars) {
      const n = 6 + Math.floor(next() * 12);
      const words: string[] = [];
      for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(next() * WORDS.length)] ?? "the");
      const sentence = words.join(" ");
      out += `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. `;
    }
    return out.slice(0, chars);
  };
}

/** A starter world padded to about `bytes` of JSON: four fifths more people, the rest lore. */
function paddedWorld(bytes: number): WorldDoc {
  const doc = STARTER_WORLDS.modern_slice_of_life?.(WORLD_ID, "Long town");
  if (doc === undefined) throw new Error("no starter world modern_slice_of_life");
  const people = Object.values(doc.entities).filter((e) => e.kind === "person");
  const prose = proseOf(7);
  let i = 0;
  while (JSON.stringify(doc).length < bytes * 0.8 && people.length > 0) {
    const from = people[i % people.length];
    if (from === undefined) break;
    const id = `pad_person_${i}`;
    doc.entities[id] = { ...structuredClone(from), id, name: `${from.name} ${i}` };
    i++;
  }
  let k = 0;
  while (JSON.stringify(doc).length < bytes) {
    doc.lore[`pad-lore-${k}`] = { id: `pad-lore-${k}`, title: `Note ${k}`, content: prose(1200), keys: [], links: [] } as never;
    k++;
  }
  return doc;
}

/** Syllables the heavy world's names are made of, so that no name is anyone's. */
const SYLLABLES = ["ka", "vo", "ril", "mae", "tor", "senn", "ul", "bre", "quo", "ix", "dra", "lune", "fe", "osk", "yar", "tiv", "nem", "oro", "zel", "pa"];
/** The `i`th made-up word of `parts` syllables, capitalised. */
function madeWord(i: number, parts: number): string {
  let word = "";
  for (let p = 0, n = i; p < parts; p++, n = Math.floor(n / SYLLABLES.length)) word += SYLLABLES[(n + p * 7) % SYLLABLES.length];
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
const TRADES = ["Bakery", "Hardware", "Marine Supply", "Books", "Diner", "Laundry", "Florist", "Print Shop", "Pharmacy", "Garage", "Tailor", "Hostel", "Bike Shop", "Grocer", "Brewery", "Cafe", "Fishmonger", "Clinic", "Studio", "Joinery"];
/** The starter's townsfolk each further person is copied from. */
const TOWNSFOLK = ["danny_okafor", "priya_nair", "jess_kowalczyk", "maddie_kowalczyk", "dale_whitcomb", "helen_kowalczyk", "nora_whitfield", "sam_reyes"];
/** What each new person carries, copied from the player character's things: the first four on them, the last in their wallet. */
const CARRIED = ["pov_phone", "pov_keys", "pov_watch", "pov_pocketknife", "pov_id"];
/** How many businesses the player character holds directly (each of the rest is held by one of them), and how many have a grid (the marina's). */
const HOLDERS = 5;
const GRIDS = 19;

/**
 * The heavy world, the starter grown to a long-played town's size (each number the default of an option): `businesses` more businesses
 * like its shop, each with its owner, premises (and rooms), operating account, its owner's account, lease and owner's draw, two
 * vehicles, every fifth a loan, the first fifteen a property; the player character holding the first `HOLDERS` (60%) and through them
 * the rest (51% each), keeping six things in each one's first vehicle; the first `GRIDS` premises with a grid like the marina's; then
 * people like its townsfolk to `people` characters, each with a home, an account, a bill, a job at one of the businesses and every
 * third a household; everyone carrying five things and a wallet; the first ten owners a brokerage holding, the rest of the owners a
 * property let out; its tracks copied to `tracks`; lore to about `bytes` of JSON.
 */
function heavyWorld(bytes: number, o: { people: number; businesses: number; rooms: number; tracks: number }): WorldDoc {
  const doc = STARTER_WORLDS.modern_slice_of_life?.(WORLD_ID, "Long harbour");
  if (doc === undefined) throw new Error("no starter world modern_slice_of_life");
  const base = structuredClone(doc);
  const from = (id: string): EntityDef => {
    const e = base.entities[id];
    if (e === undefined) throw new Error(`the starter has no ${id}`);
    return structuredClone(e);
  };
  const put = (template: string, id: string, name: string | null, fields: JsonObject, relations: EntityDef["relations"] = []): void => {
    const e = from(template);
    doc.entities[id] = { ...e, id, name: name ?? e.name, fields: { ...e.fields, ...fields }, relations };
  };
  const place = (template: string, id: string, name: string, parent: string): void => {
    const p = base.places[template];
    if (p === undefined) throw new Error(`the starter has no place ${template}`);
    doc.places[id] = { ...structuredClone(p), id, name, parent };
  };
  const carried = (who: string, tag: string): void => {
    const wallet = `wallet_${tag}`;
    put("pov_wallet", wallet, null, { owner: who }, [{ type: "in", to: who }, { type: "worn_by", to: who, fields: { slot: "pocket" } }]);
    for (const [i, thing] of CARRIED.entries()) put(thing, `${thing.slice(4)}_${tag}`, null, { owner: who }, i === CARRIED.length - 1 ? [{ type: "in", to: wallet }] : [{ type: "in", to: who }]);
  };
  const person = (template: string, id: string, n: number, fields: JsonObject): void => {
    const e = from(template);
    doc.entities[id] = { ...e, id, name: `${madeWord(n, 2)} ${madeWord(n * 13 + 5, 3)}`, fields: { ...e.fields, ...fields }, relations: e.relations.filter((r) => TOWNSFOLK.includes(r.to)) };
  };
  const businesses: { id: string; place: string }[] = [];
  for (let b = 0; b < o.businesses; b++) {
    const tag = `b${b}`;
    const biz = `biz_${tag}`;
    const owner = `owner_${tag}`;
    const premises = `place_${biz}`;
    const home = `home_${owner}`;
    const operating = `acct_${biz}`;
    const checking = `acct_${owner}`;
    person("marcus_delgado", owner, b, { place: premises, home, employer: premises });
    const name = `${madeWord(b * 13 + 5, 3)} ${TRADES[b % TRADES.length] ?? "Shop"}`;
    // The player character holds the first `HOLDERS` businesses, and through them controls the rest: each later one is held 51% by one of them.
    const holder = b < HOLDERS ? "pov" : `biz_b${b % HOLDERS}`;
    put("alder_automotive_co", biz, name, { place: premises, places: [premises], owners: [{ party: holder, role: "owner", share: b < HOLDERS ? 60 : 51 }, { party: owner, role: "owner", share: b < HOLDERS ? 40 : 49 }], operating_account: operating });
    const fields = doc.entities[biz]?.fields;
    if (fields !== undefined) {
      delete fields.daily_sales;
      delete fields.sales_spread_pct;
    }
    put("acct_marcus_shop", operating, `${name} operating account`, { owners: [{ party: biz, role: "owner" }, { party: owner, role: "authorized_user" }], opening: 400_000 + b * 37_000 });
    put("acct_marcus_checking", checking, `${madeWord(b, 2)}'s checking`, { owners: [{ party: owner, role: "owner" }] });
    put("flow_shop_lease", `flow_lease_${tag}`, `${name} lease`, { from: operating, days: [1 + (b % 27)], amount_cents: 150_000 + b * 4_000 });
    put("flow_owners_draw", `flow_draw_${tag}`, `${name} owner's draw`, { from: operating, to: checking, days: [1 + ((b * 5) % 27)] });
    if (b % 5 === 0) put("acct_alder_lift_loan", `acct_loan_${tag}`, `${name} equipment loan`, { owners: [{ party: biz, role: "owner" }], autopay_from: operating });
    if (b < 15) put("prop_harbor_114", `prop_${tag}`, `${name} premises`, { place: premises, owners: [{ party: biz, role: "owner", share: 100 }], rent_to: operating });
    else put("prop_harbor_114", `prop_${tag}`, `${madeWord(b, 2)}'s rental`, { place: home, owners: [{ party: owner, role: "owner", share: 100 }], rent_to: checking });
    for (const v of [0, 1]) put("shop_tow_truck", `truck_${v}_${tag}`, `${name} ${v === 0 ? "truck" : "van"}`, { place: premises, home: premises, owner: v === 0 ? biz : owner });
    for (let t = 0; t < 6; t++) put("pov_flashlight", `stock_${t}_${tag}`, null, { owner: "pov" }, [{ type: "in", to: `truck_0_${tag}` }]);
    if (b < GRIDS) {
      const grid = base.grids.marina_grid;
      if (grid !== undefined) doc.grids[`grid_${tag}`] = { ...structuredClone(grid), id: `grid_${tag}` };
    }
    if (b < 10) {
      put("acct_pov_brokerage", `acct_broker_${tag}`, `${madeWord(b, 2)}'s brokerage`, { owners: [{ party: owner, role: "owner" }] });
      put("hold_pov_index", `hold_${tag}`, null, { account: `acct_broker_${tag}` });
    }
    carried(owner, tag);
    place("alder_automotive", premises, name, "port_alder");
    const premisesPlace = doc.places[premises];
    if (premisesPlace !== undefined && doc.grids[`grid_${tag}`] !== undefined) premisesPlace.grid = `grid_${tag}`;
    for (let r = 0; r < o.rooms; r++) place("alder_automotive", `${premises}_room_${r}`, `${name}, room ${r + 1}`, premises);
    place("harbor_street_114", home, `${madeWord(b, 2)}'s house`, "port_alder");
    place("harbor_street_114", `${home}_room`, `${madeWord(b, 2)}'s kitchen`, home);
    businesses.push({ id: biz, place: premises });
  }
  const characters = (): number => Object.values(doc.entities).filter((e) => e.kind === "character").length;
  for (let p = 0; characters() < o.people; p++) {
    const tag = `p${p}`;
    const id = `person_${tag}`;
    const home = `home_${id}`;
    const work = businesses[p % Math.max(1, businesses.length)];
    const household = p % 3 === 0 ? `household_${tag}` : null;
    person(TOWNSFOLK[p % TOWNSFOLK.length] ?? "danny_okafor", id, 1000 + p, { place: home, home, ...(work === undefined ? {} : { employer: work.place }), ...(household === null ? {} : { household }) });
    if (household !== null) put("household_kowalczyk", household, `The ${madeWord(1000 + p, 2)} household`, {});
    put("acct_danny_checking", `acct_${id}`, `${madeWord(1000 + p, 2)}'s checking`, { owners: [{ party: id, role: "owner" }] });
    put("bill_danny_phone", `bill_${id}`, null, { from: `acct_${id}`, days: [1 + (p % 27)] });
    if (work !== undefined) put("job_danny_mechanic", `job_${id}`, null, { worker: id, employer: work.id, workplace: work.place });
    carried(id, tag);
    place("harbor_street_114", home, `${madeWord(1000 + p, 2)}'s flat`, "port_alder");
  }
  const tracks = Object.values(base.tracks);
  for (let t = 0; Object.keys(doc.tracks).length < o.tracks && tracks.length > 0; t++) {
    const track = tracks[t % tracks.length];
    if (track === undefined) break;
    const id = `${track.id}_h${t}`;
    doc.tracks[id] = { ...structuredClone(track), id, label: `${track.label}, a second time (${t + 1})` };
  }
  const prose = proseOf(11);
  let size = JSON.stringify(doc).length;
  for (let k = 0; size < bytes; k++) {
    const note = { id: `pad-lore-${k}`, title: `Note ${k}`, content: prose(1200), keys: [], links: [] };
    doc.lore[note.id] = note as never;
    size += JSON.stringify(note).length + note.id.length + 4;
  }
  return doc;
}

/** Picks from a list by a number, round and round. */
const pick = <T>(list: readonly T[], n: number): T => list[((n % list.length) + list.length) % list.length] as T;

/**
 * What the minds pack records in a played turn, as the previous build's agents recorded it (each a minds event its own handler
 * applies): the round, who was present, five minds and four memories (each memory a note, a plan and what was told), a fact two
 * people learn together (one unit, as a knowledge step records it) and one more fact and learning apart, two plans carried out, and
 * every other turn a summary that folds two old notes away.
 */
function mindsEvents(world: WorldDoc, state: WorldState, n: number, prose: (chars: number) => string): LedgerEvent[] {
  const people = Object.values(world.entities).filter((e) => e.kind === "character" && e.id !== world.pov && state.entities[e.id] !== undefined).map((e) => e.id);
  if (people.length < 4) return [];
  const at = state.clock;
  const where = (id: string): string | null => {
    const p = state.entities[id]?.fields.place;
    return typeof p === "string" ? p : null;
  };
  const slice = (state.packs.minds ?? {}) as { chars?: Record<string, { plans?: { id: string; status: string }[]; notes?: { id: string }[] }> };
  const ev = (type: string, data: JsonObject, group?: string): LedgerEvent => ({ type, data, ...(group === undefined ? {} : { group }) }) as unknown as LedgerEvent;
  const out: LedgerEvent[] = [ev("minds.round", { at, on: true }), ev("minds.presence", { at, msg: null, place: where(pick(people, n)), who: [0, 1, 2].map((i) => pick(people, n + i)), saw: [prose(120)] })];
  for (let i = 0; i < 5; i++) {
    const who = pick(people, n * 5 + i);
    out.push(ev("minds.mind", { entity: who, at, place: where(who), level: pick(["live", "near", "far"], i), moment: "turn", reason: prose(90), monologue: prose(1700), depiction: prose(300), intent: prose(120), reactions: [prose(100), prose(100)], mood: pick(["calm", "uneasy", "busy", "pleased"], n + i), interrupt: null, withheld: false }));
  }
  for (let i = 0; i < 4; i++) {
    const who = pick(people, n * 4 + i + 2);
    const other = pick(people, n * 4 + i + 3);
    out.push(
      ev("minds.memory", {
        entity: who,
        at,
        notes: [{ id: `note-${n}-${i}`, text: prose(320), salience: 1 + (i % 5), at }],
        commitments: i === 0 ? [{ id: `promise-${n}`, kind: "promise", with: [other], text: prose(140), due: null, status: "open", made: at, closed: null }] : [],
        resolved: [],
        plans: [{ id: `plan-${n}-${i}`, what: prose(110), kind: pick(["errand", "meet", "visit", "work"], i), when: { from: at + 60, to: at + 180 }, where: where(who), with: [], priority: 3, status: "open", made: at, source: "memory", closed: null, reason: null }],
        told: [{ to: [other], what: prose(160) }],
        summary: prose(360),
      }),
    );
  }
  const fact = (k: number): JsonObject => ({ id: `claim:h${n}x${k}`, kind: "claim", claim: prose(260), about: [pick(people, n + k), pick(people, n + k + 7)], truth: "true", matters: prose(130) });
  const learn = (k: number, who: string[]): JsonObject => ({ fact: `claim:h${n}x${k}`, who, how: "witnessed", by: null, evidence: [], msg: null, at, belief: "true", confidence: 0.8, witness: { what: prose(150), place: where(who[0] ?? "") } });
  out.push(ev("minds.fact", { fact: fact(0) }, `knowing:${n}`), ev("minds.learn", learn(0, [pick(people, n), pick(people, n + 1)]), `knowing:${n}`));
  out.push(ev("minds.fact", { fact: fact(1) }), ev("minds.learn", learn(1, [world.pov])));
  let closed = 0;
  for (const [who, c] of Object.entries(slice.chars ?? {})) {
    for (const p of c.plans ?? []) {
      if (closed >= 2 || p.status !== "open") continue;
      out.push(ev("minds.plan", { entity: who, plan: p.id, status: "done", at, reason: null }));
      closed++;
    }
    if (closed >= 2) break;
  }
  if (n % 2 === 0) {
    const who = Object.entries(slice.chars ?? {}).find(([, c]) => (c.notes?.length ?? 0) >= 3);
    if (who !== undefined) out.push(ev("minds.consolidated", { entity: who[0], at, notes: (who[1].notes ?? []).slice(0, 2).map((x) => x.id), summary: prose(420) }));
  }
  return out;
}

/** What the previous build recorded on a played reply besides its turn, about `bytes` of it: its prompt trace, its harness turn's record, its departures, the parts its final review saw; the record naming `blobs` (its transcript, segment, summary, kept segments) where it has them. */
function heavyParts(n: number, bytes: number, blobs: Record<string, string | string[]> = {}): Partial<Rec> {
  const prose = proseOf(1000 + n);
  const steps = Array.from({ length: Math.max(1, Math.round((bytes * 0.35) / 1600)) }, (_, i) => ({ agent: ["scene", "cast", "narrator", "review"][i % 4] ?? "scene", tool: ["read", "note", "write", "check"][i % 4] ?? "read", said: prose(1500) }));
  return {
    diag: JSON.stringify({ v: 1, prompt: prose(Math.round(bytes * 0.5)) }),
    harness: { turns: [`hturn-${n}`], record: { v: 1, generationId: `hg-${n}`, kind: "reply", at: Date.UTC(2026, 9, 1) + n * 600_000, usage: { input: 41000 + n, output: 900 + n, cached: 30000 }, steps, ...blobs }, departures: [prose(300), prose(300)] },
    finalParts: { narrator: prose(Math.round(bytes * 0.07)), scene: prose(Math.round(bytes * 0.07)) },
  };
}

/** How many of the played replies' records are large: the newest, as a long run's transcripts grow; the rest name `SMALL_TEXTS` bytes. */
const LARGE_RECORDS = 40;
const SMALL_TEXTS = 15_000;

/** The harness texts a played reply's record names, `bytes` of words in all, written under `out/storage` as the harness keeps its blobs (`harness/blobs/<2>/<sha256>`): each part's hash. */
async function recordTexts(out: string, n: number, bytes: number): Promise<Record<string, string | string[]>> {
  const prose = proseOf(500_000 + n);
  const put = async (share: number): Promise<string> => {
    const text = prose(Math.round(bytes * share));
    const hash = new Bun.CryptoHasher("sha256").update(text).digest("hex");
    await mkdir(join(out, "storage", "harness", "blobs", hash.slice(0, 2)), { recursive: true });
    await writeFile(join(out, "storage", "harness", "blobs", hash.slice(0, 2), hash), text);
    return hash;
  };
  return { transcript: await put(0.45), segment: await put(0.35), summary: await put(0.06), kept: [await put(0.07), await put(0.07)] };
}

async function bundle(out: string): Promise<void> {
  await installHistoryLines(shippedTexts());
  const replies = num(values.replies, 576);
  const swipes = num(values.swipes, 916);
  const records = num(values.records, 181);
  const revisions = num(values.revisions, 155);
  const bytes = num(values.bytes, HEAVY ? 1_700_000 : 1_400_000);
  const ledgerBytes = num(values["ledger-bytes"], HEAVY ? 0 : 26_800_000);
  const recordBytes = num(values["record-bytes"], 8_300_000);
  const textBytes = (k: number): number => (k < records - LARGE_RECORDS ? SMALL_TEXTS : Math.round(3_000_000 + ((k - (records - LARGE_RECORDS)) * (recordBytes - 3_000_000)) / Math.max(1, LARGE_RECORDS - 1)));
  const registry = createRegistry(ALL_PACKS);

  // The world: the padded starter (or the heavy town), then a revision for each edit.
  const t0 = performance.now();
  const base = HEAVY ? heavyWorld(bytes, { people: num(values.people, 95), businesses: num(values.businesses, 45), rooms: num(values.rooms, 4), tracks: num(values.tracks, 16) }) : paddedWorld(bytes);
  const kinds = new Map<string, number>();
  for (const e of Object.values(base.entities)) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  process.stderr.write(`the world's entities by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}\n`);
  process.stderr.write(`the world: ${Object.keys(base.entities).length} entities, ${Object.keys(base.places).length} places, ${Object.keys(base.tracks).length} tracks, ${JSON.stringify(base).length} bytes, in ${Math.round(performance.now() - t0)} ms\n`);
  const docs = new Map<string, WorldDoc>();
  const edits: { revision: string; edit: Record<string, unknown> | null }[] = [];
  for (let r = 0; r < revisions; r++) {
    const edit = r === 0 ? null : { id: "pad-edit", title: "Edit", content: `Edit ${r} of the town's notes.`, keys: [], links: [] };
    const doc = edit === null ? base : ({ ...base, lore: { ...base.lore, "pad-edit": edit } } as WorldDoc);
    const revision = hashJson(doc);
    docs.set(revision, doc);
    edits.push({ revision, edit });
  }
  const revs = edits.map((e) => e.revision);
  const at = (n: number): number => Date.UTC(2026, 6, 1) + n * 120_000;

  // What each played reply passes of story time: every `--skip-every`th a time skip of `--skip-hours` hours the engine runs (every
  // process over the span), a turn's tick otherwise; `--stages` of them move a track on. In the heavy chat each also holds what the
  // minds pack recorded (`mindsEvents`).
  const skipEvery = num(values["skip-every"], 3);
  const skipHours = num(values["skip-hours"], 2);
  const stages = HEAVY ? num(values.stages, 5) : 0;
  const stageAt = new Set(Array.from({ length: stages }, (_, i) => Math.floor(((i + 1) * records) / (stages + 1))));
  const intentOf = (played: number): InterpretOutput | null => (HEAVY && skipEvery > 0 && played % skipEvery === skipEvery - 1 ? { action: TIMELAPSE_ACTION, params: { target: { type: "duration", minutes: skipHours * 60 } }, probabilities: {} } : null);
  const minds = proseOf(77);
  let playing = -1;
  const staged = new Set<string>();

  // The chat: the replies before the engine played, then the ones it played, the chat moved onto each revision in turn.
  const run: ChatRun = { v: 1, worldId: WORLD_ID, revision: revs[0] as string, runSeed: HEAVY ? "heavychat-seed" : "bigchat-seed", startedAt: at(2 * (replies - records)) };
  const elapsed = new Map<string, number>();
  const model: TurnModel = {
    plan: ({ state, ctx, seed, kind, userTexts }) => {
      const plan = planTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, kind, userTexts, intent: intentOf(playing) });
      elapsed.set(seed, plan.elapsedMinutes);
      const events = HEAVY ? [...plan.events, ...mindsEvents(ctx.world, state, playing, minds)] : plan.events;
      if (!stageAt.has(playing)) return events;
      // A track the story moves on: the first not moved yet, from where it stands to its stage's first way on.
      for (const track of Object.values(ctx.world.tracks)) {
        const from = state.tracks[track.id]?.stage ?? track.start;
        const to = track.stages[from]?.next[0]?.to;
        if (to === undefined || staged.has(track.id)) continue;
        staged.add(track.id);
        return [...events, { type: "stage", track: track.id, to, from }];
      }
      return events;
    },
    read: ({ state, ctx, seed }) => postTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, appliedMinutes: elapsed.get(seed.replace(/:read$/, "")) ?? 0, extracted: [] }),
  };
  let seeds = 0;
  const env: LedgerEnv = { types: registry, worlds: (r) => docs.get(r), run, model, startMarkers: () => [], newSeed: () => `seed-${++seeds}`, resolveFix: (doc, state, entry) => resolveFix(registry, doc, state, entry, run.runSeed), snapshots: new ChatSnapshots() };
  const core = new LedgerCore(emptyJournal(CHAT_ID), env, new LedgerFold(registry));
  const TEXTS = ["I walk to the cafe and look for a seat by the window.", "I order a coffee and ask the barista about the ferry.", "I wait twenty minutes, watching the rain.", "I head to the garage to see whether the bike is fixed.", "I go home and call my sister.", "I look around the market for the stall with the old maps.", "I check my phone for the bus times.", "I knock on the neighbour's door."];
  const prose = proseOf(42);
  const observed: ChainMessage[] = [{ id: `${MESSAGE}-m0`, isUser: false, swipeId: 0, swipes: [prose(1800)], ledger: null }];
  const sent = new Map<string, number>([[`${MESSAGE}-m0`, at(0)]]);
  core.sync(observed);
  const played = replies - records;
  const extra = Math.max(0, swipes - replies);
  const plays = replies - 1;
  let gen = 0;
  let moved = 0;
  let recorded = 0;
  const t1 = performance.now();
  for (let t = 1; t < replies; t++) {
    const user: ChainMessage = { id: `${MESSAGE}-u${t}`, isUser: true, swipeId: 0, swipes: [TEXTS[t % TEXTS.length] ?? ""], ledger: null };
    const reply: ChainMessage = { id: `${MESSAGE}-a${t}`, isUser: false, swipeId: 0, swipes: [], ledger: null };
    sent.set(user.id, at(2 * t - 1));
    sent.set(reply.id, at(2 * t));
    // Its swipes: the extra ones spread over the replies.
    const count = 1 + Math.floor((t * extra) / plays) - Math.floor(((t - 1) * extra) / plays);
    if (t < played) {
      reply.swipes = Array.from({ length: count }, () => prose(2400));
      reply.swipeId = count - 1;
      observed.push(user, reply);
      core.sync(observed);
      continue;
    }
    // A reply the previous build played: the chat moved onto the revision this point of it was on.
    const target = records <= 1 ? 0 : Math.floor((recorded * (revisions - 1)) / (records - 1));
    while (moved < Math.min(target, revisions - 1)) {
      moved++;
      core.write({ kind: "marker", id: `move-${moved}`, target: "head", body: { kind: "migrate", to: revs[moved] as string } }, observed);
    }
    reply.swipes = [""];
    observed.push(user, reply);
    core.sync(observed);
    const generationId = `g${++gen}`;
    playing = recorded;
    const began = performance.now();
    core.started({ generationId, kind: "normal", targetMessageId: reply.id, targetSwipeId: 0 }, observed);
    core.plan(generationId, observed, false);
    reply.swipes[0] = prose(2400);
    core.saved(generationId);
    core.ended({ generationId, messageId: reply.id, content: reply.swipes[0] as string }, observed);
    if (HEAVY && (recorded % 20 === 0 || intentOf(recorded) !== null)) process.stderr.write(`played ${recorded}${intentOf(recorded) === null ? "" : " (a skip)"}: ${core.journal.messages[reply.id]?.ledger?.swipes["0"]?.events.length ?? 0} events, ${Math.round(performance.now() - began)} ms\n`);
    recorded++;
    // Swipes made with the engine switched off, which hold no record: the played one stays shown.
    for (let s = 1; s < count; s++) reply.swipes.push(prose(2400));
    if (count > 1) core.sync(observed);
  }
  process.stderr.write(`played ${gen} replies of ${replies}, ${moved + 1} revisions, in ${Math.round(performance.now() - t1)} ms\n`);

  // What the previous build recorded on a played reply besides its turn, sized so that the messages' records and the journal (which holds each again) come to `ledgerBytes`.
  const ledgerOf = (m: ChainMessage) => core.journal.messages[m.id]?.ledger;
  const size = (): number => observed.reduce((n, m) => n + (ledgerOf(m) ? JSON.stringify(encodeLedger({}, ledgerOf(m) as never)).length : 0), 0) + JSON.stringify(core.journal).length;
  const bare = size();
  const each = Math.max(0, Math.round((ledgerBytes - bare) / (2 * Math.max(1, recorded))));
  let n = 0;
  for (const m of observed) {
    const ledger = ledgerOf(m);
    if (!ledger) continue;
    for (const rec of Object.values(ledger.swipes)) {
      Object.assign(rec, heavyParts(n, each, HEAVY ? await recordTexts(out, n, textBytes(n)) : {}));
      n++;
    }
  }
  const total = size();
  process.stderr.write(`records ${bare} bytes bare, ${each} bytes more on each of ${n}, ${total} bytes in all${HEAVY ? `; the texts they name under ${join(out, "storage")}` : ""}\n`);

  const name = "Long town narrator (invented)";
  const rows = observed.map((m, i) => {
    const ledger = ledgerOf(m);
    const when = Math.floor((sent.get(m.id) ?? at(i)) / 1000);
    return {
      id: m.id,
      index_in_chat: i,
      is_user: m.isUser ? 1 : 0,
      name: m.isUser ? "Player" : name,
      content: m.swipes[m.swipeId] ?? "",
      send_date: when,
      swipe_id: m.swipeId,
      swipes: JSON.stringify(m.swipes),
      swipe_dates: JSON.stringify(m.swipes.map((_, s) => when + s * 60)),
      extra: JSON.stringify(i === 0 ? { greeting: true, greeting_character_id: CHARACTER_ID, greeting_index: 0 } : ledger === undefined ? {} : { spindle_metadata: encodeLedger({}, ledger) }),
    };
  });
  const chat = {
    character: { id: CHARACTER_ID, name, first_mes: observed[0]?.swipes[0] ?? "" },
    chat: { id: CHAT_ID, name: HEAVY ? "Long harbour (invented, heavy)" : "Long town (invented, long)", metadata: JSON.stringify({ activeGreetingIndex: 0, lumi_rp_engine: { ...run, prefs: { engine: "harness" } } }) },
    messages: rows,
    files: { [`runs/${CHAT_ID}/journal.json`]: JSON.stringify({ ...core.journal, run: { worldId: run.worldId, runSeed: run.runSeed } }) },
  };
  const world = {
    id: WORLD_ID,
    base,
    edits,
    index: { id: WORLD_ID, name: HEAVY ? "Long harbour" : "Long town", head: revs.at(-1), revisions: revs },
    history: { v: 1, notes: revs.map((revision, r) => ({ revision, at: new Date(at(r * 3)).toISOString(), source: r === 0 ? "create" : "build" })) },
  };
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "chat.json.gz"), Bun.gzipSync(new TextEncoder().encode(JSON.stringify(chat))));
  await writeFile(join(out, "world.json.gz"), Bun.gzipSync(new TextEncoder().encode(JSON.stringify(world))));
  await writeFile(
    join(out, "about.json"),
    JSON.stringify({ chat: CHAT_ID, world: WORLD_ID, heavy: HEAVY, replies, swipes: observed.reduce((s, m) => s + (m.isUser ? 0 : m.swipes.length), 0), records: n, revisions, played: moved + 1, revisionBytes: JSON.stringify(base).length, ledgerBytes: total, perRecordExtra: each, messages: observed.length, messagePrefix: MESSAGE }, null, 2),
  );
}

async function make(root: string, bundleFolder: string): Promise<void> {
  const fixture = await buildFixture("operator");
  await rm(join(fixture.userFolder, STRAY));
  await loadBundle(bundleFolder, fixture.sources.lumiverse, USER);
  const data = join(root, "rpe-data");
  await mkdir(root, { recursive: true });
  const t0 = performance.now();
  const migrated = Bun.spawnSync([process.execPath, MAIN, "migrate", "--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data], {
    env: { ...process.env, ...fixture.named, HOME: join(root, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  await writeFile(join(root, "migrate.txt"), `${migrated.stdout.toString()}${migrated.stderr.toString()}`);
  const about = JSON.parse(readFileSync(join(bundleFolder, "about.json"), "utf8")) as { chat: string; heavy?: boolean; messagePrefix?: string; replies: number };
  await writeFile(join(root, "long.json"), JSON.stringify({ fixture: fixture.root, lumiverse: fixture.sources.lumiverse, data, chat: about.chat, messagePrefix: about.messagePrefix ?? "big", replies: about.replies }));
  process.stderr.write(`migrate exited ${migrated.exitCode} in ${Math.round(performance.now() - t0)} ms; its words are in ${join(root, "migrate.txt")}\n`);
  if (about.heavy === true && migrated.exitCode === 0) await writeBase(data, about.chat);
}

/**
 * The heavy chat's base, as a long-played chat holds one: on the chat's first turn, `--base-cast` writes of the cast (memories,
 * perceptions and what they know, of the first `--base-characters` of the world's people, each made a character of the cast) and
 * `--base-story` of the story record (beats, scenes and futures), each through the cast's or the story's own writer, as the
 * migration writes what it carries. Written after the import, these are the path's newest changes, so every later turn of the path
 * that holds changes folds as one checked again. RPE is stopped while it writes. `data` is RPE's data folder.
 */
async function writeBase(data: string, chat: string): Promise<void> {
  await installHistoryLines(shippedTexts());
  const t0 = performance.now();
  const db = new Database(join(data, "rpe.db"));
  db.run("PRAGMA busy_timeout = 10000");
  const store = openStore({ db, registry: createRegistry(ALL_PACKS), worlds: storedWorlds(db), areas: STORE_AREAS, log: () => undefined, handlerFailed: () => undefined });
  const user = db.query<{ user: string }, [string]>("SELECT user FROM chat WHERE id = ?").get(chat)?.user;
  if (user === undefined) throw new Error(`no chat ${chat} in ${data}`);
  const s = store.user(user);
  const first = s.path(chat).find((e) => e.turn !== null)?.turn ?? null;
  if (first === null) throw new Error(`the chat ${chat} has no turn`);
  const state = s.stateAt(first).state.world;
  const world = store.env.worlds(state.revision);
  if (world === undefined) throw new Error(`the revision ${state.revision} is not kept`);
  const now = Date.now();
  const cast = Object.values(world.entities)
    .filter((e) => e.kind === "character" && e.id !== world.pov)
    .slice(0, num(values["base-characters"], 36))
    .map((e) => addCharacter(db, user, chat, e.name, now, e.id));
  const prose = proseOf(9);
  const names = Object.values(world.entities).filter((e) => e.kind === "character").map((e) => e.name);
  const parts = ["memory", "perception", "knowledge"] as const;
  const castWrites = Array.from({ length: num(values["base-cast"], 4661) }, (_, i): CastWrite => {
    const part = pick(parts, Math.floor(i / Math.max(1, cast.length)));
    const value: JsonObject = part === "memory" ? { text: prose(560), salience: 1 + (i % 5), moment: prose(70) } : part === "perception" ? { of: first, moment: prose(60), reach: "part", content: prose(380), missed: prose(110), knows: [prose(90)] } : { text: prose(520) };
    return { character: pick(cast, i).id, part, item: null, value };
  });
  const storyWrites = Array.from({ length: num(values["base-story"], 1553) }, (_, i): StoryWrite => {
    const who = [pick(names, i), pick(names, i + 3)];
    if (i % 10 === 9) return { part: "scene", item: null, value: { title: prose(40), place: null, time: prose(24), who, purpose: prose(160), tension: prose(150), wants: prose(130), ends: prose(140) } };
    if (i % 10 === 8) return { part: "future", item: null, value: { text: prose(380), tier: "near", due: null, who, place: null, notes: prose(160), state: "open", close: null, drop: false } };
    return { part: "beat", item: null, value: { text: prose(420), who, place: null, kind: "event", surface: prose(150), quotes: [], time: null, message: null, last: null } };
  });
  const writer = { user, turn: first, by: "migration", agent: null, job: null, at: state.clock, now, source: "import" as const };
  for (let i = 0; i < castWrites.length; i += 500) writeCast(store, writer, castWrites.slice(i, i + 500));
  for (let i = 0; i < storyWrites.length; i += 500) writeStory(store, { user, chat, turn: first, by: "migration", agent: null, job: null, source: "import" }, storyWrites.slice(i, i + 500));
  db.close();
  process.stderr.write(`the base: ${cast.length} characters of the cast, ${castWrites.length} cast writes and ${storyWrites.length} story writes on the chat's first turn, in ${Math.round(performance.now() - t0)} ms\n`);
}

/** The server's processor seconds and resident memory now. */
function usageOf(pid: number): { cpu: number; rss: number } | null {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cpu = (Number(fields[11]) + Number(fields[12])) / 100;
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
      return { cpu, rss };
    } catch {
      return null;
    }
  }
  const out = Bun.spawnSync(["ps", "-o", "rss=,cputime=", "-p", String(pid)]).stdout.toString().trim();
  if (out === "") return null;
  const [rss, time] = out.split(/\s+/);
  const cpu = (time ?? "0").split(":").map(Number).reduce((n, p) => n * 60 + p, 0);
  return { cpu, rss: Number(rss) * 1024 };
}

/** RPE started on the data folder `make` wrote, from this checkout, and the calls a page makes, on its command socket as the owner. */
async function startServer(root: string): Promise<{ call: (path: string) => Promise<{ ms: number; status: number; bytes: number; text: string }>; pid: number; logs: () => string; chat: string; startedMs: number; stop: () => Promise<string> }> {
  const facts = JSON.parse(readFileSync(join(root, "long.json"), "utf8")) as { data: string; lumiverse: string; chat: string };
  const port = 7990 + Math.floor(Math.random() * 500);
  const config = join(facts.data, "config.json");
  const was = existsSync(config) ? (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>) : {};
  await writeFile(config, JSON.stringify({ ...was, port, lumiverse: { ...((was.lumiverse as object | undefined) ?? {}), url: null, user: USER, database: join(facts.lumiverse, "lumiverse.db") } }, null, 2));
  // TRIAL_BUN_FLAGS: flags for Bun itself, a profiler's (`--cpu-prof-md --cpu-prof-dir=…`).
  const flags = (process.env.TRIAL_BUN_FLAGS ?? "").split(" ").filter((f) => f !== "");
  const server = Bun.spawn([process.execPath, ...flags, MAIN, "serve", "--data", facts.data], { env: { ...process.env, HOME: join(root, "home") }, stdout: "pipe", stderr: "pipe" });
  const logs: string[] = [];
  void (async () => {
    for await (const chunk of server.stderr) logs.push(new TextDecoder().decode(chunk));
  })();
  const socket = commandSocketPath(facts.data);
  const call = async (path: string): Promise<{ ms: number; status: number; bytes: number; text: string }> => {
    const t = performance.now();
    const res = await fetch(`http://rpe.local${path}`, { unix: socket } as RequestInit);
    const text = await res.text();
    return { ms: Math.round(performance.now() - t), status: res.status, bytes: text.length, text };
  };
  const start = performance.now();
  for (;;) {
    if (existsSync(socket)) {
      try {
        if ((await call("/api/v1/status")).status === 200) break;
      } catch {
        // Not listening yet.
      }
    }
    if (performance.now() - start > 120_000) throw new Error(`RPE did not start: ${logs.join("")}`);
    await Bun.sleep(100);
  }
  return {
    call,
    pid: server.pid,
    logs: () => logs.join(""),
    chat: facts.chat,
    startedMs: Math.round(performance.now() - start),
    stop: async () => {
      server.kill("SIGTERM");
      await server.exited;
      await writeFile(join(root, `serve-${Date.now()}.log`), logs.join(""));
      return logs.join("");
    },
  };
}

/** What `work` cost the server: its time, the server's processor seconds, the longest a status call took meanwhile (how long the thread was held), its peak memory and its memory after. */
async function measured<T>(pid: number, call: (path: string) => Promise<{ ms: number }>, work: () => Promise<T>): Promise<{ ms: number; cpu: number | null; heldMs: number; peakMb: number; afterMb: number | null; result: T }> {
  const at0 = usageOf(pid);
  let peak = at0?.rss ?? 0;
  let stopped = false;
  const sampler = (async () => {
    while (!stopped) {
      const u = usageOf(pid);
      if (u !== null) peak = Math.max(peak, u.rss);
      await Bun.sleep(100);
    }
  })();
  let held = 0;
  const status = (async () => {
    while (!stopped) {
      held = Math.max(held, (await call("/api/v1/status")).ms);
      await Bun.sleep(50);
    }
  })();
  const t = performance.now();
  const result = await work();
  const ms = Math.round(performance.now() - t);
  const at1 = usageOf(pid);
  stopped = true;
  await Promise.all([sampler, status]);
  const mb = (n: number): number => Math.round(n / 1048576);
  return { ms, cpu: at0 && at1 ? Math.round((at1.cpu - at0.cpu) * 100) / 100 : null, heldMs: held, peakMb: mb(Math.max(peak, at1?.rss ?? 0)), afterMb: at1 ? mb(at1.rss) : null, result };
}

async function read(root: string): Promise<void> {
  const pages = num(values.pages, 3);
  const s = await startServer(root);
  const c = encodeURIComponent(s.chat);
  // What a page reads of a chat as it opens it: the newest turn, the list of turns, the world, the maps, the state, the story, the quests.
  const reads = [`/api/v1/chats/${c}/newest`, `/api/v1/chats/${c}/turns`, `/api/v1/chats/${c}/world`, `/api/v1/chats/${c}/maps`, `/api/v1/chats/${c}/state`, `/api/v1/chats/${c}/story`, `/api/v1/chats/${c}/quests`, `/api/v1/chats/${c}/carried`];
  const m = await measured(s.pid, s.call, () => Promise.all(Array.from({ length: pages }, () => Promise.all(reads.map((p) => s.call(p))))));
  await s.stop();
  const { result, ...cost } = m;
  console.log(JSON.stringify({ startedMs: s.startedMs, ...cost, reads: result[0]?.map((r, i) => ({ path: reads[i]?.replace(`/api/v1/chats/${c}`, ""), ms: r.ms, status: r.status, kb: Math.round(r.bytes / 1024) })) }));
}

/**
 * The trial, at a start and again after a restart: the start's pass over the chat (until the log says it is done, or 10 s with no pass
 * in the log), then what one page asks as it opens the chat (as a real tab does: the state twice, the newest turn, the jobs, the window,
 * the settings), the state alone warm and three times at once, and the line under every reply of the chat in one request. For each:
 * its time, the processor seconds, the longest a status call waited meanwhile (how long the thread was held), and peak memory.
 */
async function trial(root: string): Promise<void> {
  const round = async (label: string): Promise<void> => {
    const s = await startServer(root);
    const c = encodeURIComponent(s.chat);
    const say = (what: string, m: { ms: number; cpu: number | null; heldMs: number; peakMb: number; afterMb: number | null }, more: Record<string, unknown> = {}): void => {
      console.log(JSON.stringify({ round: label, what, ms: m.ms, cpu: m.cpu, heldMs: m.heldMs, peakMb: m.peakMb, afterMb: m.afterMb, ...more }));
    };
    console.log(JSON.stringify({ round: label, what: "listening", ms: s.startedMs }));
    const pass = await measured(s.pid, s.call, async () => {
      const began = performance.now();
      for (;;) {
        const log = s.logs();
        if (log.includes(`"chat":"${s.chat}"`) && /made ready|could not be made ready/.test(log)) return "done";
        if (!/makes ready|made ready/.test(log) && performance.now() - began > 10_000) return "none";
        await Bun.sleep(100);
      }
    });
    say("the start's pass", pass, { pass: pass.result });
    const newest = (JSON.parse((await s.call(`/api/v1/chats/${c}/turns?limit=1`)).text) as { turns: { id: string }[] }).turns[0]?.id ?? "";
    const page = [`/state`, `/state`, `/turns?limit=1`, `/turns?limit=1`, `/turns?limit=1`, `/turns?limit=1`, `/jobs`, `/jobs`, `/jobs`, `/window`, `/window`, `/turns/${newest}`, `/turns/${newest}`, `/turns/${newest}`].map((p) => `/api/v1/chats/${c}${p}`);
    const opened = await measured(s.pid, s.call, () => Promise.all([...page.map((p) => s.call(p)), s.call("/api/v1/settings"), s.call("/api/v1/status/extension"), s.call("/api/v1/status/extension"), s.call("/api/v1/status/extension")]));
    say("one page opens the chat", opened, { slowest: Math.max(...opened.result.map((r) => r.ms)), failed: opened.result.filter((r) => r.status >= 400).map((r) => r.status) });
    say("the state, warm", await measured(s.pid, s.call, () => s.call(`/api/v1/chats/${c}/state`)));
    say("the state, three at once", await measured(s.pid, s.call, () => Promise.all([1, 2, 3].map(() => s.call(`/api/v1/chats/${c}/state`)))));
    const facts = JSON.parse(readFileSync(join(root, "long.json"), "utf8")) as { messagePrefix?: string; replies?: number };
    const prefix = facts.messagePrefix ?? "big";
    const ids = Array.from({ length: facts.replies ?? 576 }, (_, i) => (i === 0 ? `${prefix}-m0` : `${prefix}-a${i}`));
    const lines = await measured(s.pid, s.call, () => s.call(`/api/v1/chats/${c}/replies?ids=${ids.join(",")}`));
    say("every reply's line in one request", lines, { status: lines.result.status, answered: lines.result.status === 200 ? (JSON.parse(lines.result.text) as { replies: unknown[] }).replies.length : lines.result.text.slice(0, 200) });
    const said = await s.stop();
    for (const line of said.split("\n").filter((l) => /made ready|held the thread long|could not be made ready/.test(l))) console.log(`  log: ${line.slice(0, 300)}`);
  };
  await round("start");
  await round("restart");
}

if (rootArg === undefined) throw new Error("Usage: bun scripts/perf/long-chat.ts bundle|make|base|read|trial <folder>");
if (command === "bundle") await bundle(resolve(rootArg));
else if (command === "make" && bundleArg !== undefined) await make(resolve(rootArg), resolve(bundleArg));
else if (command === "base" && bundleArg !== undefined) await writeBase(resolve(rootArg), bundleArg);
else if (command === "read") await read(resolve(rootArg));
else if (command === "trial") await trial(resolve(rootArg));
else throw new Error(`No such command: ${command}`);
