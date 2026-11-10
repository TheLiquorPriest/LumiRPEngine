// Hand-built chains through both folds: each case pins one fold rule (DESIGN §4.3) and checks that
// the optimized fold matches the reference fold on it (L1).

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { EventRef, LedgerEvent, Marker, PostEntry, Rec } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { resolveEdit, resolveFix } from "../../src/engine/edits";
import { applyEffects } from "../../src/engine/effects";
import { enginePack } from "../../src/engine/engine-pack";
import type { ChainMessage, FoldInput, FoldOutput, FoldSnapshot, SnapshotStore } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { computePaths, contentId, storedRecordHash } from "../../src/engine/ledger/path";
import { referenceFold, type FoldTypes } from "../../src/engine/ledger/reference";
import { playerLines } from "../../src/engine/player-events";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import { POV, testPack, testWorld, testWorlds } from "../support/test-pack";

const registry = createRegistry([testPack]);
const worlds = testWorlds();
const revision = [...worlds.keys()][0] ?? "";
/** GM edits and ✎ fixes worked out again from their requests, as a chat's run does. */
const fixes: FoldInput["resolveFix"] = (world, state, entry) => resolveFix(registry, world, state, entry, "run");

const user = (id: string, text: string): ChainMessage => ({ id, isUser: true, swipeId: 0, swipes: [text], ledger: null });
const reply = (id: string, ...swipes: string[]): ChainMessage => ({ id, isUser: false, swipeId: 0, swipes, ledger: null });

function rec(text: string, path: string, events: LedgerEvent[], extra: Partial<Rec> = {}): Rec {
  return { v: 1, defHash: revision, seq: 0, swipeHash: contentId(text), path, seed: "s", pre: events.length, events, post: [], markersApplied: 0, status: "ok", undone: [], intents: {}, ...extra };
}

/** Attaches an on-path record (planned at the message's current parent path) to message `index`. */
function record(chain: ChainMessage[], index: number, events: LedgerEvent[], extra: Partial<Rec> = {}): Rec {
  const m = chain[index];
  if (!m) throw new Error(`no message ${index}`);
  const parent = computePaths(chain, [])[index]?.parentPath ?? "";
  const r = rec(m.swipes[m.swipeId] ?? "", parent, events, extra);
  m.ledger = { v: 1, swipes: { ...(m.ledger?.swipes ?? {}), [String(m.swipeId)]: r }, markers: m.ledger?.markers ?? [] };
  return r;
}

function both(input: Partial<FoldInput> & { chain: ChainMessage[] }, types: Registry = registry): FoldOutput {
  const full: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], resolveFix: (world, state, entry) => resolveFix(types, world, state, entry, "run"), ...input };
  const reference = referenceFold(full, types);
  const optimized = new LedgerFold(types).fold(full);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(optimized.keepReport).toEqual(reference.keepReport);
  expect(optimized.violations).toEqual(reference.violations);
  expect(optimized.resolved).toEqual(reference.resolved);
  return reference;
}

const cashOf = (out: FoldOutput): unknown => out.state.entities[POV]?.fields.cash;
const buy = (item: string, price: number): LedgerEvent => ({ type: "test.buy", data: { item, price } });
const use = (item: string): LedgerEvent => ({ type: "test.use", data: { item } });

function shop(): ChainMessage[] {
  const chain = [reply("a0", "Morning."), user("u1", "buy lamp"), reply("a1", "Bought."), user("u2", "use lamp"), reply("a2", "Lit.")];
  record(chain, 2, [buy("lamp", 30)]);
  record(chain, 4, [use("lamp")]);
  return chain;
}

/**
 * The test world with levels: the level follows XP (300 for Level 2, 900 for 3), max HP is 10 and 5
 * a level, and Sam starts at Level 3 with HP 25 of 25, stored.
 */
function levelled(): WorldDoc {
  const world = testWorld();
  const person = world.kinds.person;
  const sam = world.entities[POV];
  if (!person || !sam) throw new Error("no person");
  person.fields.xp = { type: "number", default: 0 };
  person.fields.level = { type: "number", default: 1 };
  person.fields.max_hp = { type: "number", derived: "10 + self.level * 5" };
  person.fields.hp = { type: "number", label: "HP", pool: { max: "max_hp" } };
  sam.fields = { ...sam.fields, xp: 1000, level: 3, hp: 25 };
  world.ruleset = { progression: { character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300, 900] } } };
  return world;
}

/** Sam's level and HP in a fold. */
const levelAndHp = (out: FoldOutput): unknown[] => [out.state.entities[POV]?.fields.level, out.state.entities[POV]?.fields.hp];

describe("reference fold", () => {
  test("a chain without records folds to the initial state", () => {
    const out = both({ chain: [reply("a0", "Hi."), user("u1", "hello"), reply("a1", "Hey.")] });
    expect(out.messages.map((m) => m.fold)).toEqual(["plain", "user", "plain"]);
    expect(cashOf(out)).toBe(100);
  });

  test("on-path records apply in order", () => {
    const out = both({ chain: shop() });
    expect(out.messages.map((m) => m.fold)).toEqual(["plain", "user", "on_path", "user", "on_path"]);
    expect(cashOf(out)).toBe(70);
    expect(out.violations).toEqual([]);
  });

  test("an on-path event that no longer validates is a violation (L7 detects it)", () => {
    const chain = [reply("a0", "Morning."), user("u1", "use"), reply("a1", "Lit.")];
    record(chain, 2, [use("lamp")]);
    expect(both({ chain }).violations.length).toBe(1);
  });

  test("an earlier switch makes later records rebased views that drop what no longer holds", () => {
    const chain = shop();
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("Walked past.");
    a1.swipeId = 1;
    const out = both({ chain });
    expect(out.messages.map((m) => m.fold)).toEqual(["plain", "user", "plain", "user", "view"]);
    expect(out.notes.map((n) => n.kind)).toEqual(["dropped"]);
    expect(out.keepReport).toEqual([{ messageId: "a2", parentPath: out.messages[4]?.parentPath ?? "", ref: { in: "events", index: 0 }, status: "dropped", text: "no lamp to use" }]);
  });

  test("a Keep conversion applies the dropped event on that parent path only", () => {
    const chain = shop();
    const a1 = chain[2];
    const a2 = chain[4]?.ledger?.swipes["0"];
    if (!a1 || !a2) throw new Error("no records");
    a1.swipes.push("Walked past.");
    a1.swipeId = 1;
    const parent = both({ chain }).messages[4]?.parentPath ?? "";
    const ref: EventRef = { in: "events", index: 0 };
    a2.keep = { [parent]: { convert: [ref] } };
    const out = both({ chain });
    expect(out.keepReport.map((k) => k.status)).toEqual(["converted"]);
    expect(out.state.packs.test?.uses).toBe(1);
  });

  test("a GM edit that keeps its request folds on a rebased view as that request worked out again there, not as stored: what is already so is passed over and the rest lands", () => {
    const chain = [reply("a0", "Morning."), user("u1", "talk"), reply("a1", "Sam gets to know Dev."), user("u2", "wait"), reply("a2", "Time passes.")];
    record(chain, 2, [{ type: "link", rel: "knows", from: POV, to: "dev" }]);
    const a2 = record(chain, 4, []);
    // Made on a2 while Sam knew Dev: no longer, and Sam is tense; stored as it resolved there.
    const ops: EditOp[] = [
      { op: "unlink", rel: "knows", from: POV, to: "dev" },
      { op: "set", entity: POV, field: "mood", value: "tense" },
    ];
    const world = worlds.get(revision);
    if (!world) throw new Error("no world");
    const made = resolveEdit(registry, world, both({ chain }).state, ops, { gm: true, runSeed: "run" });
    if ("rejection" in made) throw new Error(made.rejection.reason);
    a2.post = [{ seq: 1, at: a2.path, kind: "fix", gm: true, events: made.events, edit: { ops } }];
    expect(both({ chain }).state.entities[POV]?.fields.mood).toBe("tense");
    // On a swipe of a1 where Sam never met Dev, the stored unlink no longer applies; the edit still does.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("Sam stays home.");
    a1.swipeId = 1;
    const out = both({ chain });
    expect(out.messages[4]?.fold).toBe("view");
    expect(out.state.entities[POV]?.fields.mood).toBe("tense");
    expect(out.state.entities[POV]?.relations).toEqual([]);
    expect(out.notes.filter((n) => n.kind === "dropped")).toEqual([]);
    // What the view worked it out to is what its chip and Journal line say: the mood alone.
    expect(out.resolved.map((r) => ({ messageId: r.messageId, seq: r.seq, events: r.events.length }))).toEqual([{ messageId: "a2", seq: 1, events: 1 }]);
  });

  test("a GM edit already so where it was made holds no events of its own: on its own path it folds as nothing, and on a rebased view it is worked out again, so what it asked for stands", () => {
    const chain = [reply("a0", "Morning."), user("u1", "talk"), reply("a1", "Sam gets to know Dev."), user("u2", "wait"), reply("a2", "Time passes.")];
    record(chain, 2, [{ type: "link", rel: "knows", from: POV, to: "dev" }]);
    const a2 = record(chain, 4, []);
    a2.post = [{ seq: 1, at: a2.path, kind: "fix", gm: true, events: [], edit: { ops: [{ op: "link", rel: "knows", from: POV, to: "dev" }] } }];
    const knows = (out: FoldOutput): boolean => out.state.entities[POV]?.relations.some((r) => r.type === "knows" && r.to === "dev") === true;
    const onPath = both({ chain });
    expect(knows(onPath)).toBe(true);
    expect(onPath.resolved).toEqual([]);
    // On a swipe of a1 where Sam never met Dev, the edit makes it so.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("Sam stays home.");
    a1.swipeId = 1;
    const view = both({ chain });
    expect(view.messages[4]?.fold).toBe("view");
    expect(knows(view)).toBe(true);
    expect(view.resolved.map((r) => ({ messageId: r.messageId, seq: r.seq, events: r.events.length }))).toEqual([{ messageId: "a2", seq: 1, events: 1 }]);
  });

  test("one that can't be made on a rebased view is dropped there with a note and a Keep line by its first ref, which a Keep conversion folds as stored: as nothing", () => {
    const chain = [reply("a0", "Morning."), user("u1", "talk"), reply("a1", "Kit turns up, and Sam meets her."), user("u2", "wait"), reply("a2", "Time passes.")];
    const world = worlds.get(revision);
    if (!world) throw new Error("no world");
    const met = resolveEdit(registry, world, both({ chain: chain.slice(0, 2) }).state, [{ op: "spawn", kind: "person", name: "Kit", id: "kit", place: "home" }, { op: "link", rel: "knows", from: POV, to: "kit" }], { gm: true, runSeed: "run" });
    if ("rejection" in met) throw new Error(met.rejection.reason);
    record(chain, 2, met.events);
    const a2 = record(chain, 4, []);
    a2.post = [{ seq: 1, at: a2.path, kind: "fix", gm: true, events: [], edit: { ops: [{ op: "link", rel: "knows", from: POV, to: "kit" }] } }];
    expect(both({ chain }).notes.filter((n) => n.kind === "dropped")).toEqual([]);
    // On a swipe of a1 where Kit never turns up, there is no one to know.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("Nobody comes.");
    a1.swipeId = 1;
    const view = both({ chain });
    const ref: EventRef = { in: "post", seq: 1, index: 0 };
    expect(view.notes.filter((n) => n.kind === "dropped").map((n) => [n.messageId, n.ref])).toEqual([["a2", ref]]);
    expect(view.keepReport.filter((k) => k.status === "dropped").map((k) => [k.messageId, k.ref])).toEqual([["a2", ref]]);
    expect(view.resolved).toEqual([]);
    const parent = view.messages[4]?.parentPath;
    if (!parent) throw new Error("no parent path");
    a2.keep = { [parent]: { convert: [ref] } };
    const converted = both({ chain });
    expect(converted.notes.filter((n) => n.kind === "dropped")).toEqual([]);
    expect(converted.keepReport.filter((k) => k.status === "dropped")).toEqual([]);
    expect(converted.state.entities.kit).toBeUndefined();
  });

  test("records after an unresolved pause fold nothing", () => {
    const out = both({ chain: shop(), pauses: [{ messageId: "u2", content: contentId("use lamp!") }] });
    expect(out.messages.map((m) => m.fold)).toEqual(["plain", "user", "on_path", "user", "paused"]);
    expect(out.state.packs.test?.uses).toBeUndefined();
    expect(cashOf(out)).toBe(70);
  });

  test("a tombstoned record folds as a plain message", () => {
    const chain = shop();
    const a2 = chain[4]?.ledger?.swipes["0"];
    if (!a2) throw new Error("no record");
    const out = both({ chain, tombstones: [{ messageId: "a2", swipeHash: a2.swipeHash, recHash: storedRecordHash(a2) }] });
    expect(out.messages[4]?.fold).toBe("tombstoned");
    expect(out.state.packs.test?.uses).toBeUndefined();
  });

  test("undone events are skipped", () => {
    const chain = [reply("a0", "Morning."), user("u1", "earn"), reply("a1", "Paid.")];
    record(chain, 2, [{ type: "add", entity: POV, field: "cash", delta: 5 }, { type: "add", entity: POV, field: "cash", delta: 7 }], { undone: [{ in: "events", index: 1 }] });
    expect(cashOf(both({ chain }))).toBe(105);
  });

  test("markers and post entries are live where made, or with their record; elsewhere inert", () => {
    const chain = shop();
    const a2 = chain[4];
    const r = a2?.ledger?.swipes["0"];
    if (!a2?.ledger || !r) throw new Error("no record");
    const markers: Marker[] = [
      { kind: "resolve", domain: "gear", scope: { all: true }, to: 3, seq: 1, at: null, start: true },
      { kind: "resolve", domain: "money", scope: { all: true }, to: 3, seq: 2, at: r.path },
      { kind: "resolve", domain: "vehicles", scope: { all: true }, to: 3, seq: 3, at: "elsewhere" },
    ];
    a2.ledger.markers = markers;
    const post: PostEntry[] = [
      { seq: 4, at: r.path, kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value: "calm" }] },
      { seq: 5, at: "elsewhere", kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value: "tense" }] },
    ];
    r.post = post;
    const out = both({ chain });
    expect(out.state.realism.levels.gear).toBe(3);
    expect(out.state.realism.levels.money).toBe(3);
    expect(out.state.realism.levels.vehicles).toBe(1);
    expect(out.state.entities[POV]?.fields.mood).toBe("calm");
    expect(out.notes.filter((n) => n.kind === "inert").length).toBe(2);
  });

  test("markers fold by seq around the events: up to markersApplied before them, later ones after (L10)", () => {
    const lenient = [...worlds.keys()][1] ?? "";
    const chainWith = (markersApplied: number): ChainMessage[] => {
      const chain = [reply("a0", "Morning."), user("u1", "buy rope"), reply("a1", "Bought.")];
      const r = record(chain, 2, [buy("rope", 150)], { markersApplied });
      const a1 = chain[2];
      if (!a1?.ledger) throw new Error("no ledger");
      a1.ledger.markers = [{ kind: "migrate", to: lenient, seq: 1, at: r.path }];
      return chain;
    };
    // Planned after the Upgrade: the lenient world priced the purchase.
    const planned = both({ chain: chainWith(1) });
    expect(planned.violations).toEqual([]);
    expect(cashOf(planned)).toBe(-50);
    // The same marker made after the swipe was planned folds after its events, which fail on-path.
    expect(both({ chain: chainWith(0) }).violations.length).toBe(1);
  });

  test("an assistant record's accepted identity is outside every hash", () => {
    const chain = shop();
    const plain = both({ chain });
    const a1 = chain[2]?.ledger?.swipes["0"];
    if (!a1) throw new Error("no record");
    a1.accepted = contentId("Bought, edited.");
    chain[2]?.swipes.splice(0, 1, "Bought, edited.");
    const accepted = both({ chain });
    expect(accepted.messages).toEqual(plain.messages);
    expect(hashJson(accepted.state)).toBe(hashJson(plain.state));
  });

  test("a bare record (no turn) carries entries but folds as plain", () => {
    const chain = [reply("a0", "Morning."), user("u1", "look"), reply("a1", "A room.")];
    const parent = computePaths(chain, [])[2]?.parentPath ?? "";
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.ledger = { v: 1, swipes: { "0": rec("A room.", "", [], { post: [{ seq: 1, at: parent, kind: "confirm", events: [{ type: "add", entity: POV, field: "cash", delta: 3 }] }] }) }, markers: [] };
    const out = both({ chain });
    expect(out.messages[2]?.fold).toBe("plain");
    expect(cashOf(out)).toBe(103);
  });

  test("re-convergence: a view from the state its record had on its own path skips re-validation, an accepted edit of it included", () => {
    let validations = 0;
    const counted: FoldTypes = {
      relations: registry.relations,
      context: registry.context,
      get: (type) => {
        const def = registry.get(type);
        return def && { ...def, validate: (e, ctx) => (validations++, def.validate(e, ctx)) };
      },
    };
    const tick: LedgerEvent = { type: "clock", minutes: 2, cause: "tick" };
    const chain = [reply("a0", "Morning."), user("u1", "walk"), reply("a1", "Walked.", "Strolled."), user("u2", "look"), reply("a2", "Saw.")];
    // Both swipes of a1 leave the same state, so a2 is a view from its own path's state on either.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    record(chain, 2, [tick]);
    a1.swipeId = 1;
    record(chain, 2, [tick]);
    a1.swipeId = 0;
    const a2 = record(chain, 4, [tick]);
    // Every step keeps its state, so a re-fold runs only from the first message that changed.
    const folder = new LedgerFold(counted, { snapshotEvery: 1 });
    const fold = (): FoldOutput => folder.fold({ worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain, resolveFix: fixes });
    fold();
    a1.swipeId = 1;
    validations = 0;
    expect(fold().messages[4]?.fold).toBe("view");
    // a1's new swipe is validated on its path; a2 converges.
    expect(validations).toBe(1);
    // An assistant edit of the view changes nothing a fold reads.
    a2.accepted = contentId("Saw, edited.");
    validations = 0;
    const edited = fold();
    expect(validations).toBe(0);
    expect(hashJson(edited.state)).toBe(hashJson(referenceFold({ worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain, resolveFix: fixes }, registry).state));
  });

  test("a fold started from a stored snapshot remembers the steps it rebuilt: the same chain folds again from its cache (L42)", () => {
    let gets = 0;
    const stored = new Map<string, FoldSnapshot>();
    const snapshots: SnapshotStore = {
      get: (key) => (gets++, stored.get(key)),
      put: (snapshot) => void stored.set(snapshot.key, snapshot),
    };
    const chain: ChainMessage[] = [reply("a0", "Morning.")];
    for (let t = 1; t <= 8; t++) {
      chain.push(user(`u${t}`, "walk"), reply(`a${t}`, `Walked ${t}.`));
      record(chain, chain.length - 1, [{ type: "clock", minutes: 2, cause: "tick" }]);
    }
    const input: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain, snapshots, resolveFix: fixes };
    new LedgerFold(registry, { snapshotEvery: 3 }).fold(input);
    // After a restart the first fold starts from the last stored snapshot, two messages before the end.
    const restarted = new LedgerFold(registry, { snapshotEvery: 3 });
    const first = restarted.fold(input);
    gets = 0;
    const again = restarted.fold(input);
    expect(gets).toBe(0);
    expect(again).toEqual(first);
    expect(hashJson(again.state)).toBe(hashJson(referenceFold(input, registry).state));
  });

  test("a snapshot saved before steps kept their clocks is passed over, so every reply still shows the time its turn ended", () => {
    const stored = new Map<string, FoldSnapshot>();
    const snapshots: SnapshotStore = { get: (key) => stored.get(key), put: (snapshot) => void stored.set(snapshot.key, snapshot) };
    const chain: ChainMessage[] = [reply("a0", "Morning.")];
    for (let t = 1; t <= 8; t++) {
      chain.push(user(`u${t}`, "walk"), reply(`a${t}`, `Walked ${t}.`));
      record(chain, chain.length - 1, [{ type: "clock", minutes: 2, cause: "tick" }]);
    }
    const input: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain, snapshots, resolveFix: fixes };
    const full = new LedgerFold(registry, { snapshotEvery: 3 }).fold(input);
    // As an earlier build stored them: everything but the clocks.
    for (const [key, s] of stored) stored.set(key, { key: s.key, state: s.state, notes: s.notes, keep: s.keep, violations: s.violations });
    const restarted = new LedgerFold(registry, { snapshotEvery: 3 }).fold(input);
    expect(restarted.messages.map((m) => m.clock)).toEqual(full.messages.map((m) => m.clock));
    expect(restarted.messages.every((m) => m.clock !== null)).toBe(true);
  });

  test("past the states the cache keeps, every fold of several chats still equals the reference fold, and no output or snapshot a caller changes reaches a later fold", () => {
    const stored = new Map<string, FoldSnapshot>();
    const snapshots: SnapshotStore = { get: (key) => stored.get(key), put: (snapshot) => void stored.set(snapshot.key, snapshot) };
    const folder = new LedgerFold(registry, { snapshotEvery: 4 });
    const chats: ChainMessage[][] = [0, 1, 2].map((c) => [reply(`c${c}a0`, "Morning.")]);
    const tick: LedgerEvent = { type: "clock", minutes: 3, cause: "tick" };
    for (let t = 1; t <= 30; t++) {
      for (const [c, chain] of chats.entries()) {
        chain.push(user(`c${c}u${t}`, `walk ${t}`), reply(`c${c}a${t}`, `Walked ${t}.`));
        record(chain, chain.length - 1, [tick]);
        // The head, the message before it, and a prefix from an earlier turn, each against the reference fold.
        for (const end of [chain.length, chain.length - 1, Math.max(1, chain.length - 9)]) {
          const input: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain: chain.slice(0, end), snapshots, resolveFix: fixes };
          const out = folder.fold(input);
          expect(hashJson(out.state)).toBe(hashJson(referenceFold(input, registry).state));
          // The caller owns what it was given: changing it changes neither the cache nor a stored snapshot.
          out.state.clock += 1000;
        }
      }
    }
    for (const s of stored.values()) expect(s.state.clock).toBeLessThan(1000);
  });

  test("a GM's stage move kept on a later reply drops whole, with what it paid, on a rebased view where the story already took the track there (DESIGN §10)", () => {
    const types = createRegistry([enginePack, testPack]);
    const pay = (delta: number) => [{ type: "add", args: { entity: POV, field: "cash", delta } }];
    const world: WorldDoc = { ...testWorld(), tracks: { errand: { id: "errand", kind: "quest", label: "The errand", start: "asked", visibility: "public", stages: { asked: { label: "Asked", next: [{ to: "done", when: "false" }], rewards: pay(100) }, done: { label: "Done", next: [], rewards: pay(250) } } } } };
    const rev = hashJson(world);
    const own = { worlds: (r: string) => (r === rev ? world : undefined), revision: rev };
    // The GM's move as an edit writes it: one unit, the stage it left recorded with it.
    const edit = resolveEdit(types, world, initialState(world, "r", types), [{ op: "stage", track: "errand", to: "done" }], { gm: true, runSeed: "r" });
    if ("rejection" in edit) throw new Error(edit.rejection.reason);
    const chain = [reply("a0", "Morning."), user("u1", "wait"), reply("a1", "Nothing yet."), user("u2", "wait"), reply("a2", "Still nothing.")];
    record(chain, 2, [], { defHash: rev });
    const later = record(chain, 4, [], { defHash: rev });
    later.post = [{ seq: 1, at: later.path, kind: "fix", gm: true, events: edit.events }];
    expect(cashOf(both({ chain, ...own }, types))).toBe(450);
    // The reply before, on a swipe where the story itself takes the errand to its end and pays for it.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("The errand is done.");
    a1.swipeId = 1;
    record(chain, 2, [{ type: "add", entity: POV, field: "cash", delta: 100 }, { type: "stage", track: "errand", to: "done" }, { type: "add", entity: POV, field: "cash", delta: 250 }], { defHash: rev });
    const out = both({ chain, ...own }, types);
    expect(out.messages[4]?.fold).toBe("view");
    expect(cashOf(out)).toBe(450);
    expect(out.keepReport.map((k) => k.status)).toEqual(edit.events.map(() => "dropped"));
  });

  test("a level-down held through a reply that dealt damage caps HP at the lower max without healing it, and says so (DESIGN §11)", () => {
    const types = createRegistry([enginePack, testPack]);
    const world = levelled();
    const rev = hashJson(world);
    const own = { worlds: (r: string) => (r === rev ? world : undefined), revision: rev };
    // The GM takes Sam back to 200 XP while the reply streams: Level 1, whose max HP is 15.
    const edit = resolveEdit(types, world, initialState(world, rev, types), [{ op: "set", entity: POV, field: "xp", value: 200 }], { gm: true, runSeed: "r" });
    if ("rejection" in edit) throw new Error(edit.rejection.reason);
    const chain = [reply("a0", "Morning."), user("u1", "spar"), reply("a1", "A hard blow.")];
    // The reply deals 13 damage (HP 12), and the held edit lands after it.
    const turn = record(chain, 2, [{ type: "add", entity: POV, field: "hp", delta: -13 }], { defHash: rev });
    turn.post = [{ seq: 1, at: turn.path, kind: "fix", gm: true, events: edit.events }];
    const out = both({ chain, ...own }, types);
    expect(levelAndHp(out)).toEqual([1, 12]);
    expect(out.violations).toEqual([]);
    // The edit's line holds at HP 12 as at 15.
    expect(playerLines(types, world, out.state, POV, edit.events)).toContain("Your HP is now at most 15");
  });

  test("a level-down rebased onto a swipe that dealt damage keeps the lower HP, while one an earlier build recorded folds as it did (DESIGN §11)", () => {
    const types = createRegistry([enginePack, testPack]);
    const world = levelled();
    const rev = hashJson(world);
    const own = { worlds: (r: string) => (r === rev ? world : undefined), revision: rev };
    // The turn's own level-down, recorded where HP is still 25: Level 1, and HP capped at its max of 15.
    const w = new Working(types, world, initialState(world, rev, types));
    const down = applyEffects(types, w, [{ type: "add", args: { entity: POV, field: "xp", delta: -800 } }], { bindings: { self: POV }, rng: createRng("down") }).applied;
    const chain = [reply("a0", "Morning."), user("u1", "rest"), reply("a1", "A quiet hour."), user("u2", "train"), reply("a2", "Out of practice.")];
    record(chain, 2, [], { defHash: rev });
    const later = record(chain, 4, down, { defHash: rev });
    expect(levelAndHp(both({ chain, ...own }, types))).toEqual([1, 15]);
    // A swipe of the reply before, where Sam takes 13 damage: the level-down is a rebased view on HP 12.
    const a1 = chain[2];
    if (!a1) throw new Error("no a1");
    a1.swipes.push("A hard blow.");
    a1.swipeId = 1;
    record(chain, 2, [{ type: "add", entity: POV, field: "hp", delta: -13 }], { defHash: rev });
    const out = both({ chain, ...own }, types);
    expect(out.messages[4]?.fold).toBe("view");
    expect(levelAndHp(out)).toEqual([1, 12]);
    expect(out.keepReport).toEqual([]);
    // As an earlier build recorded it, its HP an assignment: that record folds as it always did.
    later.events = down.map((e): LedgerEvent => {
      if (e.type !== "set") return e;
      const { atMost: _cap, ...assigned } = e;
      return assigned;
    });
    expect(levelAndHp(both({ chain, ...own }, types))).toEqual([1, 15]);
  });
});
