// Hand-built chains through both folds: each case pins one fold rule (DESIGN §4.3) and checks that
// the optimized fold matches the reference fold on it (L1).

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { EventRef, LedgerEvent, Marker, PostEntry, Rec } from "../../src/shared/ledger";
import type { ChainMessage, FoldInput, FoldOutput } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { computePaths, contentId, storedRecordHash } from "../../src/engine/ledger/path";
import { referenceFold } from "../../src/engine/ledger/reference";
import { createRegistry } from "../../src/engine/registry-impl";
import { POV, testPack, testWorlds } from "../support/test-pack";

const registry = createRegistry([testPack]);
const worlds = testWorlds();
const revision = [...worlds.keys()][0] ?? "";

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

function both(input: Partial<FoldInput> & { chain: ChainMessage[] }): FoldOutput {
  const full: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], ...input };
  const reference = referenceFold(full, registry);
  const optimized = new LedgerFold(registry).fold(full);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(optimized.keepReport).toEqual(reference.keepReport);
  expect(optimized.violations).toEqual(reference.violations);
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
});
