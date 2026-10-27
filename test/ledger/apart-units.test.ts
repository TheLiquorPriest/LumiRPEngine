// A unit kept apart from the payment it comes with (`APART_GROUP`, DESIGN §4.3, §25.10): the overdraft
// transfer a payment the story made draws from a linked account. It stands only with its payment: a
// rebased view that drops the payment drops it too, even where it would fit alone, while one that
// keeps the payment may drop it alone. A unit tied to one before it in its record (`tiedTo`: a price
// corrected by Edit amount, a payment moved by Pay another way) drops wherever that one dropped.
// Both folds and the replay of a unit list agree.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { APART_GROUP, type LedgerEvent, type Rec } from "../../src/shared/ledger";
import { applyValidUnits, EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import type { ChainMessage, FoldInput, FoldOutput } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../src/engine/ledger/path";
import { referenceFold } from "../../src/engine/ledger/reference";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveFix } from "../../src/engine/edits";
import { initialState } from "../../src/engine/world-state";
import { groupsLandWhole } from "../support/ops";
import { openMoney, POV, testPack, testWorlds } from "../support/test-pack";

const registry = createRegistry([testPack]);
const worlds = testWorlds();
const revision = [...worlds.keys()][0] ?? "";
const world = worlds.get(revision);
const SHOP = `${EXTERNAL_ACCOUNT_PREFIX}shop`;
const PAYMENT = "pay:lamp";

const user = (id: string, text: string): ChainMessage => ({ id, isUser: true, swipeId: 0, swipes: [text], ledger: null });
const reply = (id: string, ...swipes: string[]): ChainMessage => ({ id, isUser: false, swipeId: 0, swipes, ledger: null });

/** Attaches an on-path record (planned at the message's current parent path) to message `index`. */
function record(chain: ChainMessage[], index: number, events: LedgerEvent[]): Rec {
  const m = chain[index];
  if (!m) throw new Error(`no message ${index}`);
  const parent = computePaths(chain, [])[index]?.parentPath ?? "";
  const r: Rec = { v: 1, defHash: revision, seq: 0, swipeHash: contentId(m.swipes[m.swipeId] ?? ""), path: parent, seed: "s", pre: events.length, events, post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
  m.ledger = { v: 1, swipes: { ...(m.ledger?.swipes ?? {}), [String(m.swipeId)]: r }, markers: m.ledger?.markers ?? [] };
  return r;
}

/** Both folds of `chain`, which must agree (L1). */
function both(chain: ChainMessage[]): FoldOutput {
  const input: FoldInput = { chain, worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], resolveFix: (doc, state, entry) => resolveFix(registry, doc, state, entry, "run") };
  const reference = referenceFold(input, registry);
  const optimized = new LedgerFold(registry).fold(input);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(optimized.keepReport).toEqual(reference.keepReport);
  expect(optimized.violations).toEqual([]);
  return reference;
}

const deposit = (cents: number): LedgerEvent => ({ type: "post", lines: [{ account: POV, amount: cents }, { account: `${EXTERNAL_ACCOUNT_PREFIX}job`, amount: -cents }], memo: "Pay" });

/** A lamp bought from Sam's account: its posting and the lamp, one unit. */
const payment = (cents: number): LedgerEvent[] => [
  { type: "post", lines: [{ account: POV, amount: -cents }, { account: SHOP, amount: cents }], memo: "Bought lamp", group: PAYMENT },
  { type: "test.buy", data: { item: "lamp", price: 0 }, group: PAYMENT },
];

/** What the payment brought, kept apart from it: Dev's account covering part of it. */
const link = (cents: number): LedgerEvent[] => [
  { type: "post", lines: [{ account: "dev", amount: -cents }, { account: POV, amount: cents }], memo: "Overdraft transfer", group: `${APART_GROUP}${PAYMENT}` },
  { type: "set", entity: POV, field: "detail", value: "covered by Dev", group: `${APART_GROUP}${PAYMENT}` },
];

/**
 * Sam paid in on the first swipe of a reply (`first`), less on its second (`second`), each with Dev's
 * money opened; the next reply, planned on the first, bought the lamp for 60 with 30 from Dev's
 * account, kept apart just before the purchase, as a payment's events are recorded.
 */
function shop(first: LedgerEvent[], second: LedgerEvent[]): { chain: ChainMessage[]; a1: ChainMessage } {
  const chain = [reply("a0", "Morning."), user("u1", "work"), reply("a1", "Paid.", "Paid less."), user("u2", "buy lamp"), reply("a2", "Bought.")];
  const a1 = chain[2];
  if (!a1) throw new Error("no reply");
  a1.swipeId = 1;
  record(chain, 2, [openMoney("dev"), ...second]);
  a1.swipeId = 0;
  record(chain, 2, [openMoney("dev"), ...first]);
  record(chain, 4, [...link(30), ...payment(60)]);
  return { chain, a1 };
}

describe("a unit kept apart from its payment", () => {
  test("on its own path both land", () => {
    const { chain } = shop([deposit(100)], [deposit(20)]);
    const out = both(chain);
    expect(out.messages[4]?.fold).toBe("on_path");
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([70, 20]);
    expect(out.state.packs.test?.owned).toEqual({ lamp: true });
  });

  test("a rebased view that drops the payment drops it too, though it would fit alone", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    a1.swipeId = 1;
    const out = both(chain);
    expect(out.messages[4]?.fold).toBe("view");
    // Sam's 20 can't pay 60, so the lamp drops; Dev's 50 could spare 30, but that transfer was for the lamp.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([20, 50]);
    expect(out.state.entities[POV]?.fields.detail).toBeUndefined();
    expect(out.state.packs.test?.owned ?? {}).toEqual({});
    expect(out.keepReport.filter((k) => k.messageId === "a2").map((k) => [k.ref, k.status])).toEqual([0, 1, 2, 3].map((index) => [{ in: "events", index }, "dropped"]));
  });

  test("a rebased view that keeps the payment may drop it alone", () => {
    const spent: LedgerEvent = { type: "post", lines: [{ account: "dev", amount: -40 }, { account: SHOP, amount: 40 }], memo: "Dev spent" };
    const { chain, a1 } = shop([deposit(100)], [deposit(100), spent]);
    a1.swipeId = 1;
    const out = both(chain);
    expect(out.messages[4]?.fold).toBe("view");
    // Dev's 10 can't spare 30: the transfer drops alone, and Sam's 100 pays the whole 60.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([40, 10]);
    expect(out.state.packs.test?.owned).toEqual({ lamp: true });
    expect(out.keepReport.filter((k) => k.messageId === "a2").map((k) => k.ref)).toEqual([0, 1].map((index) => ({ in: "events", index })));
  });

  test("replaying a unit list keeps it only with its payment", () => {
    if (!world) throw new Error("no world");
    const start = (cents: number) => {
      const state = initialState(world, revision, registry);
      applyValidUnits(registry, [openMoney("dev"), deposit(cents)], state, (s) => registry.context(world, s));
      return state;
    };
    const events = [...link(30), ...payment(60)];
    const poor = start(20);
    expect(applyValidUnits(registry, events, poor, (s) => registry.context(world, s))).toEqual([]);
    expect([poor.accounts[POV], poor.accounts.dev]).toEqual([20, 50]);
    const rich = start(100);
    expect(applyValidUnits(registry, events, rich, (s) => registry.context(world, s))).toEqual(events);
    expect([rich.accounts[POV], rich.accounts.dev]).toEqual([70, 20]);
  });

  test("with the transfer converted, a view that drops the payment keeps the transfer, and L41 holds", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    a1.swipeId = 1;
    const rec = chain[4]?.ledger?.swipes["0"];
    if (!rec) throw new Error("no record");
    const parent = computePaths(chain, [])[4]?.parentPath ?? "";
    rec.keep = { [parent]: { convert: [{ in: "events", index: 0 }] } };
    const out = both(chain);
    // Converted, the transfer folds as stored, with no Keep line since it fits; the lamp drops alone.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([50, 20]);
    expect(out.state.packs.test?.owned ?? {}).toEqual({});
    expect(out.keepReport.filter((k) => k.messageId === "a2").map((k) => [k.ref, k.status])).toEqual([2, 3].map((index) => [{ in: "events", index }, "dropped"]));
    expect(groupsLandWhole(chain, out).broken).toBeNull();
  });

  test("with the payment converted, a view that can't cover it keeps both, and L41 holds", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    a1.swipeId = 1;
    const rec = chain[4]?.ledger?.swipes["0"];
    if (!rec) throw new Error("no record");
    const parent = computePaths(chain, [])[4]?.parentPath ?? "";
    rec.keep = { [parent]: { convert: [{ in: "events", index: 2 }] } };
    const out = both(chain);
    // The player's override: the lamp stands though Sam's account goes short, and the transfer fits on its own.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([-10, 20]);
    expect(out.state.packs.test?.owned).toEqual({ lamp: true });
    expect(groupsLandWhole(chain, out).broken).toBeNull();
  });

  test("a view that folds as its own path did lands both, from one fold that folded the path first", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(100)]);
    const fold = new LedgerFold(registry);
    const input: FoldInput = { chain, worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], resolveFix: (doc, state, entry) => resolveFix(registry, doc, state, entry, "run") };
    expect(hashJson(fold.fold(input).state)).toBe(hashJson(both(chain).state));
    a1.swipeId = 1;
    const view = fold.fold(input);
    expect(view.messages[4]?.fold).toBe("view");
    expect(hashJson(view.state)).toBe(hashJson(both(chain).state));
    expect([view.state.accounts[POV], view.state.accounts.dev]).toEqual([70, 20]);
  });
});

/** The lamp's price corrected after it applied, as Edit amount records it: 20 back to Sam, tied to the purchase. */
const correction: LedgerEvent[] = [
  { type: "post", lines: [{ account: SHOP, amount: -20 }, { account: POV, amount: 20 }], memo: "Bought lamp: price corrected", group: "fix:lamp", tiedTo: [PAYMENT] },
  { type: "set", entity: POV, field: "mood", value: "pleased", group: "fix:lamp", tiedTo: [PAYMENT] },
];

/** `events` added to the lamp's record as a confirm entry made where it stood. */
function corrected(chain: ChainMessage[], events: LedgerEvent[]): Rec {
  const rec = chain[4]?.ledger?.swipes["0"];
  if (!rec) throw new Error("no record");
  rec.post.push({ seq: 1, at: rec.path, kind: "confirm", events });
  return rec;
}

describe("a unit tied to one before it", () => {
  test("a rebased view that drops the purchase drops its correction too, though it would fit alone", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    corrected(chain, correction);
    a1.swipeId = 1;
    const out = both(chain);
    expect(out.messages[4]?.fold).toBe("view");
    // Nothing bought, so nothing comes back.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([20, 50]);
    expect(out.state.entities[POV]?.fields.mood).toBe("fine");
    expect(out.keepReport.filter((k) => k.messageId === "a2" && "in" in k.ref && k.ref.in === "post").map((k) => [k.ref, k.status])).toEqual([0, 1].map((index) => [{ in: "post", seq: 1, index }, "dropped"]));
  });

  test("a rebased view that keeps the purchase keeps its correction", () => {
    const spent: LedgerEvent = { type: "post", lines: [{ account: "dev", amount: -40 }, { account: SHOP, amount: 40 }], memo: "Dev spent" };
    const { chain, a1 } = shop([deposit(100)], [deposit(100), spent]);
    corrected(chain, correction);
    a1.swipeId = 1;
    const out = both(chain);
    // Dev's transfer drops alone; the lamp stands at 60, and 20 of it comes back.
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([60, 10]);
    expect(out.state.entities[POV]?.fields.mood).toBe("pleased");
  });

  test("Keep converting the correction keeps it where the purchase dropped, and L41 holds", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    const rec = corrected(chain, correction);
    a1.swipeId = 1;
    const parent = computePaths(chain, [])[4]?.parentPath ?? "";
    rec.keep = { [parent]: { convert: [{ in: "post", seq: 1, index: 0 }] } };
    const out = both(chain);
    expect([out.state.accounts[POV], out.state.accounts.dev]).toEqual([40, 50]);
    expect(out.keepReport.some((k) => "in" in k.ref && k.ref.in === "post")).toBe(false);
    expect(groupsLandWhole(chain, out).broken).toBeNull();
  });

  test("L41 holds where the correction dropped with its purchase, and catches one that stood without it", () => {
    const { chain, a1 } = shop([deposit(100)], [deposit(20)]);
    corrected(chain, correction);
    a1.swipeId = 1;
    const out = both(chain);
    expect(groupsLandWhole(chain, out).broken).toBeNull();
    const stood = { ...out, keepReport: out.keepReport.filter((k) => !("in" in k.ref && k.ref.in === "post")) };
    expect(groupsLandWhole(chain, stood).broken).toContain("a2");
  });

  test("replaying a unit list skips a unit tied to one it skipped", () => {
    if (!world) throw new Error("no world");
    const start = (cents: number) => {
      const state = initialState(world, revision, registry);
      applyValidUnits(registry, [openMoney("dev"), deposit(cents)], state, (s) => registry.context(world, s));
      return state;
    };
    const events = [...payment(60), ...correction];
    const poor = start(20);
    expect(applyValidUnits(registry, events, poor, (s) => registry.context(world, s))).toEqual([]);
    expect(poor.accounts[POV]).toBe(20);
    const rich = start(100);
    expect(applyValidUnits(registry, events, rich, (s) => registry.context(world, s))).toEqual(events);
    expect(rich.accounts[POV]).toBe(60);
  });
});
