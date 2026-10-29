// What each person knows (DESIGN §24.11): facts and holdings folded into the minds slice from their
// events, the same in both folds and on every replay, along the swipe the chat is on, taken back by
// an Undo of the GM's edit, and never told on a player line. A chat with no knowledge event has no
// knowledge part, as before.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { JsonObject } from "../../../src/shared/json";
import type { EventRef, LedgerEvent, PostEntry, Rec } from "../../../src/shared/ledger";
import { claimFactId, factId, MINDS_EVENTS, parseFactId, witnessRef, type FactId, type FactTruth, type Holding, type KeptFrom, type KnowledgeFact, type LearnEventData } from "../../../src/shared/minds";
import type { ChainMessage, FoldInput, FoldOutput } from "../../../src/engine/ledger/chain";
import { resolveFix } from "../../../src/engine/edits";
import { LedgerFold } from "../../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../../src/engine/ledger/path";
import { referenceFold } from "../../../src/engine/ledger/reference";
import { enginePack } from "../../../src/engine/engine-pack";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import type { WorldState } from "../../../src/engine/state";
import mindsPack from "../../../src/packs/minds/core/index";
import { mindEdit } from "../../../src/packs/minds/core/edit";
import { factsOf, holdingsOf, isSuspicion, knowersOf } from "../../../src/packs/minds/core/knowledge";
import { readSlice } from "../../../src/packs/minds/core/state";
import { POV, testPack, testWorlds } from "../../support/test-pack";

const registry = createRegistry([enginePack, testPack, mindsPack]);
const worlds = testWorlds();
const [revision = "", richer = ""] = [...worlds.keys()];
const world = worlds.get(revision);
if (!world) throw new Error("no test world");

type Swipe = { text: string; fixes: readonly LedgerEvent[][]; undone?: readonly EventRef[] };

/** Hello, then a reply on swipe `on`, each swipe's record holding its own GM edits as `fix` entries, in order. */
function chain(swipes: readonly Swipe[], on = 0, rev = revision): ChainMessage[] {
  const messages: ChainMessage[] = [
    { id: "a0", isUser: false, swipeId: 0, swipes: ["Morning."], ledger: null },
    { id: "u1", isUser: true, swipeId: 0, swipes: ["hello"], ledger: null },
    { id: "a1", isUser: false, swipeId: on, swipes: swipes.map((s) => s.text), ledger: null },
  ];
  const path = computePaths(messages, [])[2]?.parentPath ?? "";
  const records: Record<string, Rec> = {};
  for (const [i, s] of swipes.entries()) {
    const post: PostEntry[] = s.fixes.map((events, n) => ({ seq: n + 1, at: path, kind: "fix", events }));
    records[String(i)] = { v: 1, defHash: rev, seq: 0, swipeHash: contentId(s.text), path, seed: "s", pre: 0, events: [], post, markersApplied: 0, status: "ok", undone: [...(s.undone ?? [])], intents: {} };
  }
  const a1 = messages[2];
  if (a1) a1.ledger = { v: 1, swipes: records, markers: [] };
  return messages;
}

/** The chain through the reference fold and the optimized one, which must agree on everything. */
function both(messages: ChainMessage[], rev = revision): FoldOutput {
  const input: FoldInput = { worlds: (r) => worlds.get(r), revision: rev, pauses: [], tombstones: [], chain: messages, resolveFix: (w, state, entry) => resolveFix(registry, w, state, entry, "run") };
  const reference = referenceFold(input, registry);
  const optimized = new LedgerFold(registry).fold(input);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.violations).toEqual([]);
  expect(reference.violations).toEqual([]);
  return reference;
}

const cash: KnowledgeFact = { id: factId({ kind: "field", entity: "dev", field: "cash" }), kind: "field", claim: "Dev is down to his last fifty dollars", about: ["dev"], truth: "true" };
const debt: KnowledgeFact = { id: claimFactId("Dev owes Sam money", "a1"), kind: "claim", claim: "Dev owes Sam money", about: ["dev", POV], truth: "open", source: { msg: "a1", at: 0 } };

const fact = (f: KnowledgeFact): LedgerEvent => ({ type: MINDS_EVENTS.fact, data: { fact: f as unknown as JsonObject } });
/** People learning a fact, told by Dev unless given otherwise. */
const learn = (who: string[], f: FactId, h: Partial<LearnEventData> = {}): LedgerEvent => ({
  type: MINDS_EVENTS.learn,
  data: { who, fact: f, how: "told", by: "dev", evidence: [], belief: "true", confidence: 0.9, msg: "a1", at: 0, ...h } as unknown as JsonObject,
});
const keep = (who: string, f: FactId, keptFrom: KeptFrom): LedgerEvent => ({ type: MINDS_EVENTS.keep, data: { who, fact: f, keptFrom } });
const settle = (f: FactId, truth: FactTruth): LedgerEvent => ({ type: MINDS_EVENTS.settle, data: { fact: f, truth } });
const forget = (who: string[], f: FactId): LedgerEvent => ({ type: MINDS_EVENTS.forget, data: { who, fact: f } });

/** Sam's hold on Dev's cash, as Dev told it. */
const told: Holding = { how: "told", by: "dev", evidence: [], since: { msg: "a1", at: 0 }, belief: "true", confidence: 0.9 };

/** The GM's `mind_knowledge` control as its `fix` entry's events, made on the state the fixes so far fold to. */
function gmEdit(state: WorldState, entity: string, f: FactId, holding: Holding | null): LedgerEvent[] {
  if (!world) throw new Error("no test world");
  const out = mindEdit(registry.context(world, state), { op: "mind_knowledge", entity, fact: f, holding });
  if (!Array.isArray(out)) throw new Error(`refused: ${out.reason}`);
  return out;
}

describe("what each person knows", () => {
  test("facts and holdings fold the same in both folds and on a replay, and read back as recorded", () => {
    const fixes = [
      [fact(cash), fact(debt)],
      [learn([POV], cash.id)],
      [learn(["dev"], debt.id, { how: "inferred", by: null, belief: "uncertain", confidence: 0.4, evidence: [cash.id] })],
      [keep(POV, cash.id, ["dev"])],
      [settle(debt.id, "false")],
    ];
    const state = both(chain([{ text: "Hi.", fixes }])).state;
    const slice = readSlice(state);
    expect(Object.keys(factsOf(slice)).sort()).toEqual([cash.id, debt.id].sort());
    expect(factsOf(slice)[debt.id]?.truth).toBe("false");
    expect(holdingsOf(slice, POV)).toEqual({ [cash.id]: { ...told, keptFrom: ["dev"] } });
    expect(knowersOf(slice, cash.id)).toEqual([POV]);
    expect(knowersOf(slice, debt.id)).toEqual(["dev"]);
    // Held less surely than the threshold, Dev's is a suspicion; Sam's, told outright, isn't.
    const devs = holdingsOf(slice, "dev")[debt.id];
    const sams = holdingsOf(slice, POV)[cash.id];
    expect(devs && isSuspicion(devs, 0.7)).toBe(true);
    expect(sams && isSuspicion(sams, 0.7)).toBe(false);
    expect(hashJson(both(chain([{ text: "Hi.", fixes }])).state)).toBe(hashJson(state));
  });

  test("a fold reads only the events: worlds that start differently hold the same knowledge", () => {
    const fixes = [[fact(cash), fact(debt)], [learn([POV], cash.id)], [learn(["dev"], debt.id, { how: "witnessed", by: null })]];
    const plain = both(chain([{ text: "Hi.", fixes }])).state;
    const rich = both(chain([{ text: "Hi.", fixes }], 0, richer), richer).state;
    expect(rich.entities[POV]?.fields.cash).not.toEqual(plain.entities[POV]?.fields.cash);
    expect(hashJson(readSlice(rich).knowledge ?? null)).toBe(hashJson(readSlice(plain).knowledge ?? null));
  });

  test("keeping from no one clears it, and someone who forgets everything holds nothing", () => {
    const fixes = [[fact(cash)], [learn([POV], cash.id, { keptFrom: "everyone" })], [keep(POV, cash.id, [])]];
    const kept = both(chain([{ text: "Hi.", fixes }])).state;
    expect(holdingsOf(readSlice(kept), POV)).toEqual({ [cash.id]: told });
    const gone = both(chain([{ text: "Hi.", fixes: [...fixes, [forget([POV], cash.id)]] }])).state;
    expect(readSlice(gone).knowledge?.holdings).toEqual({});
    // The fact stays the chat's to hold again.
    expect(Object.keys(factsOf(readSlice(gone)))).toEqual([cash.id]);
  });

  test("a chat with no knowledge event has no knowledge part", () => {
    expect(readSlice(both(chain([{ text: "Hi.", fixes: [] }])).state).knowledge).toBeUndefined();
    const ctx = registry.context(world, both(chain([{ text: "Hi.", fixes: [] }])).state);
    const intent = mindEdit(ctx, { op: "mind_intent", entity: "dev", text: "Pay Sam back" });
    if (!Array.isArray(intent)) throw new Error(`refused: ${intent.reason}`);
    const state = both(chain([{ text: "Hi.", fixes: [intent] }])).state;
    expect(state.packs.minds).toBeDefined();
    expect(readSlice(state).knowledge).toBeUndefined();
  });

  test("the GM sets, changes and takes away a holding, and Undo brings back the one before", () => {
    const fixes: LedgerEvent[][] = [[fact(cash)]];
    const fold = (undone: EventRef[] = []): WorldState => both(chain([{ text: "Hi.", fixes, undone }])).state;
    const sure: Holding = { ...told, confidence: 1 };
    fixes.push(gmEdit(fold(), POV, cash.id, sure));
    const first = fold();
    expect(holdingsOf(readSlice(first), POV)[cash.id]).toEqual(sure);
    const doubt: Holding = { ...sure, how: "guessed", by: null, belief: "uncertain", confidence: 0.3 };
    fixes.push(gmEdit(fold(), POV, cash.id, doubt));
    expect(holdingsOf(readSlice(fold()), POV)[cash.id]).toEqual(doubt);
    fixes.push(gmEdit(fold(), POV, cash.id, null));
    expect(knowersOf(readSlice(fold()), cash.id)).toEqual([]);

    const undo = (...seqs: number[]): EventRef[] => seqs.map((seq) => ({ in: "post", seq, index: 0 }));
    expect(holdingsOf(readSlice(fold(undo(4))), POV)[cash.id]).toEqual(doubt);
    const undone = fold(undo(4, 3));
    expect(holdingsOf(readSlice(undone), POV)[cash.id]).toEqual(sure);
    expect(hashJson(undone.packs.minds)).toBe(hashJson(first.packs.minds));
  });

  test("the GM's edit holds only facts the chat has, names people in the world, and changes something", () => {
    const state = both(chain([{ text: "Hi.", fixes: [[fact(cash)], [learn([POV], cash.id)]] }])).state;
    const ctx = registry.context(world, state);
    const code = (entity: string, f: FactId, holding: Holding | null): string => {
      const out = mindEdit(ctx, { op: "mind_knowledge", entity, fact: f, holding });
      return Array.isArray(out) ? "ok" : out.code;
    };
    const devs: Holding = { ...told, by: POV };
    expect(code("dev", cash.id, devs)).toBe("ok");
    expect(code("dev", "field:dev:mood", devs)).toBe("missing_fact");
    expect(code("nobody", cash.id, devs)).not.toBe("ok");
    expect(code("dev", cash.id, { ...devs, confidence: 2 })).toBe("bad_value");
    expect(code("dev", cash.id, { ...devs, by: null })).toBe("bad_value");
    expect(code("dev", cash.id, { ...devs, by: "dev" })).toBe("bad_value");
    expect(code("dev", cash.id, { ...devs, evidence: ["field:dev:mood"] })).toBe("missing_fact");
    expect(code("dev", cash.id, { ...devs, evidence: [cash.id] })).toBe("missing_fact");
    expect(code("dev", cash.id, { ...devs, keptFrom: ["nobody"] })).toBe("missing_entity");
    // Nothing to take away, or what they already hold, is no change.
    expect(code("dev", cash.id, null)).toBe("no_change");
    expect(code(POV, cash.id, told)).toBe("no_change");
    // The player character has no mind, but holds what they know like anyone.
    expect(code(POV, cash.id, { ...told, confidence: 0.5 })).toBe("ok");
  });

  test("holdings follow the swipe the chat is on", () => {
    const swipes: Swipe[] = [
      { text: "Hi.", fixes: [[fact(cash)], [learn([POV], cash.id)]] },
      { text: "Hey there.", fixes: [[fact(cash)]] },
    ];
    const first = both(chain(swipes, 0)).state;
    expect(knowersOf(readSlice(first), cash.id)).toEqual([POV]);
    expect(knowersOf(readSlice(both(chain(swipes, 1)).state), cash.id)).toEqual([]);
    expect(hashJson(both(chain(swipes, 0)).state)).toBe(hashJson(first));
  });

  test("no player line tells a fact or who holds it", () => {
    const events = [fact(cash), learn([POV], cash.id), keep(POV, cash.id, "everyone"), settle(cash.id, "false"), forget([POV], cash.id)];
    const after = both(chain([{ text: "Hi.", fixes: [events.slice(0, 4)] }])).state;
    expect(playerLines(registry, world, after, world.pov, events, 20)).toEqual([]);
  });

  test("a fact's id reads back whole, and the same claim from the same message is one fact", () => {
    const odd = factId({ kind: "lore", lore: "rent:50%" });
    expect(parseFactId(odd)).toEqual({ kind: "lore", lore: "rent:50%" });
    expect(parseFactId(factId({ kind: "wi", book: "b", entry: "e", mark: 2 }))).toEqual({ kind: "wi", book: "b", entry: "e", mark: 2 });
    expect(parseFactId("track:only")).toBeNull();
    expect(claimFactId("Dev owes  Sam money.", "a1")).toBe(debt.id);
    expect(claimFactId("Dev owes Sam money", "a3")).not.toBe(debt.id);
    const seen = { at: 5, what: "Dev counted his cash twice.", how: "saw" as const, by: null, place: "home" };
    expect(witnessRef(seen)).toBe(witnessRef({ ...seen }));
    expect(witnessRef(seen)).not.toBe(witnessRef({ ...seen, at: 6 }));
  });
});
