// The GM's intent for a character (DESIGN §24.9): an `lre.edit` control folded into the minds slice,
// identically by both folds and through an Undo, rendered only for that character's own mind, and
// never told on a player line.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { EventRef, LedgerEvent, PostEntry, Rec } from "../../../src/shared/ledger";
import type { MindEditOp } from "../../../src/shared/minds";
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
import { intentLines, intentOf } from "../../../src/packs/minds/core/intent";
import { testPack, testWorlds } from "../../support/test-pack";

const registry = createRegistry([enginePack, testPack, mindsPack]);
const worlds = testWorlds();
const revision = [...worlds.keys()][0] ?? "";
const world = worlds.get(revision);
if (!world) throw new Error("no test world");

/** Hello, then a reply whose record holds the GM's edits as `fix` entries, in order. */
function chain(fixes: readonly LedgerEvent[][], undone: readonly EventRef[] = []): ChainMessage[] {
  const messages: ChainMessage[] = [
    { id: "a0", isUser: false, swipeId: 0, swipes: ["Morning."], ledger: null },
    { id: "u1", isUser: true, swipeId: 0, swipes: ["hello"], ledger: null },
    { id: "a1", isUser: false, swipeId: 0, swipes: ["Hi."], ledger: null },
  ];
  const path = computePaths(messages, [])[2]?.parentPath ?? "";
  const post: PostEntry[] = fixes.map((events, i) => ({ seq: i + 1, at: path, kind: "fix", events }));
  const rec: Rec = { v: 1, defHash: revision, seq: 0, swipeHash: contentId("Hi."), path, seed: "s", pre: 0, events: [], post, markersApplied: 0, status: "ok", undone: [...undone], intents: {} };
  const a1 = messages[2];
  if (a1) a1.ledger = { v: 1, swipes: { "0": rec }, markers: [] };
  return messages;
}

/** The chain through the reference fold and the optimized one, which must agree on everything. */
function both(messages: ChainMessage[]): FoldOutput {
  const input: FoldInput = { worlds: (r) => worlds.get(r), revision, pauses: [], tombstones: [], chain: messages, resolveFix: (world, state, entry) => resolveFix(registry, world, state, entry, "run") };
  const reference = referenceFold(input, registry);
  const optimized = new LedgerFold(registry).fold(input);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.violations).toEqual([]);
  expect(reference.violations).toEqual([]);
  return reference;
}

/** The GM's control as the events of its `fix` entry, made on the state the fixes so far fold to. */
function edit(state: WorldState, op: Omit<Extract<MindEditOp, { op: "mind_intent" }>, "op" | "entity">): LedgerEvent[] {
  if (!world) throw new Error("no test world");
  const out = mindEdit(registry.context(world, state), { op: "mind_intent", entity: "dev", ...op });
  if (!Array.isArray(out)) throw new Error(`refused: ${out.reason}`);
  return out;
}

describe("the GM's intent for a character", () => {
  test("set, changed one part at a time, cleared, and Undo fold the same in both folds", () => {
    const fixes: LedgerEvent[][] = [];
    const fold = (): WorldState => both(chain(fixes)).state;
    expect(intentOf(fold(), "dev")).toBeNull();

    fixes.push(edit(fold(), { text: "  Win back   Sam's trust ", approach: "proactive" }));
    expect(intentOf(fold(), "dev")).toEqual({ text: "Win back Sam's trust", approach: "proactive" });
    // A part left out is kept; the event carries the intent whole.
    fixes.push(edit(fold(), { text: "Leave town before dawn" }));
    expect(intentOf(fold(), "dev")).toEqual({ text: "Leave town before dawn", approach: "proactive" });
    const changed = fold();
    fixes.push(edit(fold(), { approach: null }));
    expect(intentOf(fold(), "dev")).toEqual({ text: "Leave town before dawn", approach: null });
    // Both parts empty clear it, leaving the slice as if it was never set.
    fixes.push(edit(fold(), { text: "" }));
    expect(intentOf(fold(), "dev")).toBeNull();
    expect(fold().packs.minds?.chars).toEqual({ dev: expect.not.objectContaining({ intent: expect.anything() }) });
    fixes.push(edit(fold(), { approach: "reactive" }));
    expect(intentOf(fold(), "dev")).toEqual({ text: "", approach: "reactive" });

    // Undo takes back the latest edits, and both folds land where the edit before them left it.
    const undo = (...seqs: number[]): EventRef[] => seqs.map((seq) => ({ in: "post", seq, index: 0 }));
    expect(intentOf(both(chain(fixes, undo(5))).state, "dev")).toBeNull();
    const undone = both(chain(fixes, undo(5, 4, 3))).state;
    expect(intentOf(undone, "dev")).toEqual({ text: "Leave town before dawn", approach: "proactive" });
    expect(hashJson(undone.packs.minds)).toBe(hashJson(changed.packs.minds));
  });

  test("an edit names at least one part, and only a character has an intent", () => {
    const state = both(chain([])).state;
    const ctx = registry.context(world, state);
    expect(Array.isArray(mindEdit(ctx, { op: "mind_intent", entity: "dev", approach: "reactive" }))).toBe(true);
    expect(Array.isArray(mindEdit(ctx, { op: "mind_intent", entity: "dev" }))).toBe(false);
    expect(Array.isArray(mindEdit(ctx, { op: "mind_intent", entity: world.pov, text: "Run" }))).toBe(false);
    expect(Array.isArray(mindEdit(ctx, { op: "mind_intent", entity: "nobody", text: "Run" }))).toBe(false);
  });

  test("their mind reads their aim in the GM's words, then how they go about it; no intent reads as nothing", () => {
    expect(intentLines(null)).toEqual([]);
    const aim = intentLines({ text: "Leave town before dawn", approach: null });
    expect(aim[0]).toBe("Leave town before dawn");
    const proactive = intentLines({ text: "Leave town before dawn", approach: "proactive" });
    const reactive = intentLines({ text: "Leave town before dawn", approach: "reactive" });
    // An approach adds one line after the aim, and each approach reads differently.
    expect(proactive.slice(0, -1)).toEqual(aim);
    expect(reactive.slice(0, -1)).toEqual(aim);
    expect(proactive.at(-1)).not.toBe(reactive.at(-1));
    // An approach alone is that one line.
    expect(intentLines({ text: "", approach: "reactive" })).toEqual(reactive.slice(-1));
  });

  test("no player line tells an intent", () => {
    const state = both(chain([])).state;
    const events = edit(state, { text: "Steal the ledger tonight", approach: "proactive" });
    const after = both(chain([events])).state;
    expect(playerLines(registry, world, after, world.pov, events, 20)).toEqual([]);
  });
});
