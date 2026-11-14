// Phase 0 row 0.5's measurements for the store, run by hand:
//
//   bun test/store/measure.ts
//
// 1. 1,000 turns folded from a snapshot, cold (nothing held in memory), on the path they were made
//    on, and the same 1,000 turns all standing rebased (every change checked again).
// 2. A query at each level of the tree over a world of 5,000 things.
// 3. Whether SQLite in this Bun deletes from a contentless full-text index.
//
// Everything is invented here and kept in memory or in a temporary folder removed at the end.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { applyEvent } from "../../src/engine/events";
import { initialState } from "../../src/engine/world-state";
import { openStore, type Store, type UserStore } from "../../src/store/store";
import { engine, goTo, hand, hashOf, inventedWorld, pay, POV, registry, tick, USER } from "./fixtures";

const RUNS = 9;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
}

interface Timing {
  label: string;
  median: number;
  min: number;
  runs: number;
}

/** `run` timed `runs` times after two warm-up runs. */
function time(label: string, run: () => void, runs = RUNS): Timing {
  const xs: number[] = [];
  for (let i = 0; i < runs + 2; i++) {
    const t0 = performance.now();
    run();
    if (i >= 2) xs.push(performance.now() - t0);
  }
  return { label, median: median(xs), min: Math.min(...xs), runs };
}

/** `run` timed on a store opened afresh each time over the same database: nothing held in memory, as after a restart. */
function timeCold(label: string, open: () => Store, run: (s: UserStore) => void, runs = RUNS): Timing {
  const xs: number[] = [];
  for (let i = 0; i < runs + 2; i++) {
    const store = open();
    const t0 = performance.now();
    run(store.user(USER));
    if (i >= 2) xs.push(performance.now() - t0);
    store.close();
  }
  return { label, median: median(xs), min: Math.min(...xs), runs };
}

const ms = (n: number): string => `${n.toFixed(2)} ms`;
const show = (r: Timing): string => `  ${r.label}: median ${ms(r.median)}, best ${ms(r.min)} over ${r.runs} run${r.runs === 1 ? "" : "s"}`;

// ------------------------------------------------------------ 1. folding 1,000 turns

/**
 * 1,001 turns of five changes each (time passes, Wren moves, she pays, her knife goes in or out of
 * her satchel as one unit). The first ends on a snapshot and the rest keep none, so a cold fold of the
 * last folds 1,000 turns from it. Then a different first reply is shown, and all 1,000 stand rebased.
 * Beside them: 25 turns from the snapshot (the default interval), and today's reducers alone over
 * the same changes in memory, which no fold over them can go below.
 */
function foldMeasure(file: string, world: WorldDoc, label: string, places: readonly string[], runs: { own: number; rebased: number }): void {
  const revision = hashJson(world);
  const worlds = (r: string) => (r === revision ? world : undefined);
  const reg = registry();
  const open = (every: number): Store => openStore({ db: file, registry: reg, worlds, snapshotEvery: every, fingerprint: "measure" });
  const eventsOf = (i: number): LedgerEvent[] => [tick(3), goTo(POV, places[i % places.length] ?? ""), pay("acct_wren", 10, `Turn ${i}`), ...(i % 2 === 0 ? hand("knife", "satchel", POV) : hand("knife", POV, "satchel"))];
  const turn = (s: UserStore, i: number, text: string, on?: string | null) => {
    const t = s.beginTurn({ chat: "c", kind: "normal", ...(on !== undefined ? { on } : {}) });
    s.addChanges(t.id, engine(...eventsOf(i)));
    return s.tieTurn(t.id, { message: `m${i}`, hash: hashOf(text), date: i });
  };
  const first = open(1);
  first.user(USER).createChat({ id: "c", revision });
  turn(first.user(USER), 0, "Reply 0.");
  first.close();
  const rest = open(1_000_000);
  let last = "";
  let at25 = "";
  for (let i = 1; i <= 1000; i++) {
    last = turn(rest.user(USER), i, `Reply ${i}.`).id;
    if (i === 25) at25 = last;
  }
  const stored = rest.db.query<{ changes: number; applied: number; snapshots: number }, []>("SELECT (SELECT count(*) FROM change) AS changes, (SELECT count(*) FROM change WHERE applied = 1) AS applied, (SELECT count(*) FROM snapshot) AS snapshots").get();
  rest.close();
  const own = timeCold("1,000 turns from a snapshot, on the path they were made on", () => open(1_000_000), (s) => s.stateAt(last), runs.own);
  const short = timeCold("25 turns from a snapshot (the default interval)", () => open(1_000_000), (s) => s.stateAt(at25), RUNS);
  const events = Array.from({ length: 1001 }, (_, i) => eventsOf(i)).flat();
  const alone = time(`today's reducers alone over the same ${events.length} changes, in memory, no store`, () => {
    const state = initialState(world, revision, reg);
    const ctx = reg.context(world, state);
    for (const e of events) applyEvent(reg, e, state, ctx);
  }, runs.own);
  // A different first reply is shown: the 1,000 turns after it stand rebased, every change checked.
  const flip = open(1_000_000);
  const other = turn(flip.user(USER), 0, "Another first reply.", null);
  const shown = [{ id: "m0", user: false, hash: other.hash ?? "", date: other.date }, ...Array.from({ length: 1000 }, (_, k) => ({ id: `m${k + 1}`, user: false, hash: hashOf(`Reply ${k + 1}.`), date: k + 1 }))];
  const report = flip.user(USER).sync("c", shown);
  flip.close();
  const rebased = timeCold("the same 1,000 turns standing rebased (no snapshot on that path: from the start)", () => open(1_000_000), (s) => s.headState("c"), runs.rebased);
  console.log(`\n${label}: ${stored?.changes} changes stored (${stored?.applied} applied), ${stored?.snapshots} snapshot; ${report.rebased?.turns.length ?? 0} turns rebased in the last case`);
  for (const r of [own, short, alone, rebased]) console.log(show(r));
}

// ------------------------------------------------------------ 2. the tree over 5,000 things

/** Five regions of five towns of ten places of three rooms; 1,000 people with two things each, 250 chests of four, a thing in every room; 20 groups. */
export function bigWorld(): WorldDoc {
  const world = inventedWorld();
  world.places = {};
  world.entities = Object.fromEntries(Object.entries(world.entities).filter(([id]) => id === "acct_wren" || id === "region_vale"));
  world.entities.acct_wren = { ...(world.entities.acct_wren as WorldDoc["entities"][string]), relations: [] };
  const rooms: string[] = [];
  for (let r = 0; r < 5; r++) {
    const region = `region_${r}`;
    world.places[region] = { id: region, name: `Region ${r}`, timeZone: "Europe/London", fields: { region: "region_vale", law: `charter ${r}`, description: "Hills." } };
    for (let t = 0; t < 5; t++) {
      const town = `town_${r}_${t}`;
      world.places[town] = { id: town, name: `Town ${r}.${t}`, parent: region, fields: { law: `bylaws ${r}.${t}`, curfew: "midnight" } };
      for (let p = 0; p < 10; p++) {
        const place = `place_${r}_${t}_${p}`;
        world.places[place] = { id: place, name: `Place ${r}.${t}.${p}`, parent: town, fields: { owner: `owner_${p}` } };
        for (let k = 0; k < 3; k++) {
          const room = `room_${r}_${t}_${p}_${k}`;
          world.places[room] = { id: room, name: `Room ${r}.${t}.${p}.${k}`, parent: place, fields: {} };
          rooms.push(room);
        }
      }
    }
  }
  const add = (id: string, kind: string, name: string, tier: string, fields: Record<string, string>, relations: WorldDoc["entities"][string]["relations"] = []): void => {
    world.entities[id] = { id, kind, name, tier, fields, relations };
  };
  for (let g = 0; g < 20; g++) add(`group_${g}`, "faction", `Group ${g}`, "background", {});
  for (let i = 0; i < 1000; i++) {
    const room = rooms[i % rooms.length] ?? "";
    const id = i === 0 ? POV : `person_${i}`;
    add(id, "character", i === 0 ? "Wren" : `Person ${i}`, i % 50 === 0 ? "principal" : i % 10 === 0 ? "supporting" : "background", { place: room }, [{ type: "member_of", to: `group_${i % 20}` }]);
    add(`kit_a_${i}`, "item", `Pack of ${i}`, "background", {}, [{ type: "in", to: id }]);
    add(`kit_b_${i}`, "item", `Cloak of ${i}`, "background", {}, [
      { type: "in", to: id },
      { type: "worn_by", to: id },
    ]);
  }
  for (let c = 0; c < 250; c++) {
    add(`chest_${c}`, "container", `Chest ${c}`, "background", { place: rooms[(c * 3) % rooms.length] ?? "" });
    for (let k = 0; k < 4; k++) add(`chest_${c}_${k}`, "item", `Thing ${c}.${k}`, "background", {}, [{ type: "in", to: `chest_${c}` }]);
  }
  rooms.forEach((room, i) => add(`floor_${i}`, "item", `Something on the floor ${i}`, "background", { place: room }));
  // What the fold measurement moves: Wren's knife, in and out of her satchel.
  add("satchel", "container", "Satchel", "background", {}, [{ type: "in", to: POV }]);
  add("knife", "item", "Knife", "background", {}, [{ type: "in", to: "satchel" }]);
  world.start = { place: rooms[0] ?? "", at: world.start.at };
  return world;
}

function treeMeasure(): void {
  const world = bigWorld();
  const entities = Object.keys(world.entities).length;
  const revision = hashJson(world);
  const reg = registry();
  const store = openStore({ db: ":memory:", registry: reg, worlds: (r) => (r === revision ? world : undefined) });
  const s = store.user(USER);
  s.createChat({ id: "c", revision });
  const t = s.beginTurn({ chat: "c", kind: "normal" });
  s.addChanges(t.id, engine(tick(30), goTo("person_7", "room_0_0_0_1")));
  s.tieTurn(t.id, { message: "m1", hash: hashOf("A reply."), date: 1 });
  const folded = s.headState("c");
  const tb = performance.now();
  const view = store.viewOf(folded.state);
  const build = performance.now() - tb;
  const queries: [string, number | "full"][] = [
    ["world", 1],
    ["region_2", 1],
    ["town_2_3", 2],
    ["place_2_3_4", "full"],
    ["room_0_0_0_1", "full"],
    [POV, "full"],
    ["groups", 1],
    ["group_3", 0],
    ["world", 3],
  ];
  console.log(`\nThe tree over ${entities} entities and ${Object.keys(world.places).length} places: built in ${ms(build)} (once per state, kept with it)`);
  for (const [at, depth] of queries) {
    let out = "";
    const r = time(`query(${at}, ${depth})`, () => {
      out = view.query(at, depth);
    });
    console.log(`  ${r.label}: median ${ms(r.median)}, best ${ms(r.min)}; ${out.split("\n").length} lines`);
  }
  const whole = time("query(world, full)", () => view.query("world", "full"));
  console.log(`  ${whole.label}, the whole world printed: median ${ms(whole.median)}`);
  store.close();
}

// ------------------------------------------------------------ 3. deleting from a contentless index

function ftsMeasure(file: string): void {
  const db = new Database(file, { create: true });
  const version = db.query<{ v: string }, []>("SELECT sqlite_version() AS v").get()?.v;
  console.log(`\nSQLite ${version} in Bun ${Bun.version} on ${process.platform} ${process.arch}`);
  const tryRun = (label: string, f: () => unknown): void => {
    try {
      const out = f();
      console.log(`  ${label}: yes${out === undefined ? "" : ` (${JSON.stringify(out)})`}`);
    } catch (e) {
      console.log(`  ${label}: no (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  const find = (table: string, word: string) => db.query<{ rowid: number }, [string]>(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`).all(word).map((r) => r.rowid);
  db.run("CREATE VIRTUAL TABLE plain USING fts5(body, content='')");
  db.run("INSERT INTO plain (rowid, body) VALUES (1, 'the lantern by the cask'), (2, 'a knife in the satchel')");
  tryRun("a plain contentless table: DELETE by rowid", () => db.run("DELETE FROM plain WHERE rowid = 1"));
  tryRun("a plain contentless table: the 'delete' command, given the original text", () => {
    db.run("INSERT INTO plain (plain, rowid, body) VALUES ('delete', 1, 'the lantern by the cask')");
    return { lanternFoundAt: find("plain", "lantern") };
  });
  tryRun("a contentless table with contentless_delete=1 is made", () => db.run("CREATE VIRTUAL TABLE deletable USING fts5(body, content='', contentless_delete=1)"));
  tryRun("contentless_delete=1: DELETE by rowid, and the row is gone from search", () => {
    db.run("INSERT INTO deletable (rowid, body) VALUES (1, 'the lantern by the cask'), (2, 'a knife in the satchel')");
    db.run("DELETE FROM deletable WHERE rowid = 1");
    return { lanternFoundAt: find("deletable", "lantern"), knifeFoundAt: find("deletable", "knife") };
  });
  tryRun("contentless_delete=1: a revision written over its row (INSERT OR REPLACE)", () => {
    db.run("INSERT OR REPLACE INTO deletable (rowid, body) VALUES (2, 'a knife on the table')");
    return { satchelFoundAt: find("deletable", "satchel"), tableFoundAt: find("deletable", "table") };
  });
  db.close();
}

if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), "rpe-store-measure-"));
  try {
    foldMeasure(join(dir, "fold-small.db"), inventedWorld(), "Small world (14 entities)", ["cellar", "market_square", "far_road", "common_room"], { own: RUNS, rebased: RUNS });
    // Fewer runs: today's handlers take far longer per change in a big world (see the report).
    foldMeasure(join(dir, "fold-big.db"), bigWorld(), "World of 5,000 things", ["room_0_0_0_0", "room_0_0_0_1", "room_0_0_1_0", "room_0_1_0_0"], { own: 3, rebased: 1 });
    treeMeasure();
    ftsMeasure(join(dir, "fts.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
