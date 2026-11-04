// The items replay golden (ITEMS-SPEC §9, §12 Phase 1): ledgers the build at 58b2ac44 recorded on
// its starter worlds (`replay-golden/`: Port Alder's give, receive, lend, retrieve, buy and claim;
// Mystery Manor's search and take), each with the world revision it was played on, fold to the
// state hashes that build left, in both folds and after every operation. The things model changes
// only how an op is resolved, never how a recorded event folds.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hashJson } from "../../../src/shared/hash";
import type { LedgerEvent, Rec } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { resolveFix } from "../../../src/engine/edits";
import type { ChainMessage, FoldInput } from "../../../src/engine/ledger/chain";
import { LedgerFold } from "../../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../../src/engine/ledger/path";
import { referenceFold } from "../../../src/engine/ledger/reference";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_PACKS } from "../../../src/packs/index";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const DIR = join(import.meta.dir, "replay-golden");

interface Golden {
  world: string;
  revision: string;
  events: LedgerEvent[];
  /** Each operation's events (`from` to `to`) and the state hash it left. */
  ops: { op: string; from: number; to: number; hash: string }[];
  hash: string;
}

const ledgers = JSON.parse(readFileSync(join(DIR, "ledgers.json"), "utf8")) as Record<string, Golden>;

/** The ledger as one turn's record on a chat, folded by the reference fold and the optimized one. */
function foldChat(world: WorldDoc, events: readonly LedgerEvent[]): { reference: string; optimized: string } {
  const revision = hashJson(world);
  const chain: ChainMessage[] = [
    { id: "a0", isUser: false, swipeId: 0, swipes: ["It begins."], ledger: null },
    { id: "u1", isUser: true, swipeId: 0, swipes: ["Play it out."], ledger: null },
    { id: "a1", isUser: false, swipeId: 0, swipes: ["It plays out."], ledger: null },
  ];
  const path = computePaths(chain, [])[2]?.parentPath ?? "";
  const rec: Rec = { v: 1, defHash: revision, seq: 0, swipeHash: contentId("It plays out."), path, seed: "golden", pre: events.length, events: [...events], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
  const reply = chain[2];
  if (reply) reply.ledger = { v: 1, swipes: { "0": rec }, markers: [] };
  const input: FoldInput = { worlds: (r) => (r === revision ? world : undefined), revision, pauses: [], tombstones: [], chain, resolveFix: (doc, state, entry) => resolveFix(reg, doc, state, entry, "golden") };
  const reference = referenceFold(input, reg);
  const optimized = new LedgerFold(reg).fold(input);
  expect(reference.violations).toEqual([]);
  expect(optimized.violations).toEqual([]);
  return { reference: hashJson(reference.state), optimized: hashJson(optimized.state) };
}

describe("items replay golden: ledgers recorded at 58b2ac44", () => {
  for (const [name, golden] of Object.entries(ledgers)) {
    test(`${name}: ${golden.ops.map((o) => o.op).join(", ")} fold to the recorded hashes`, () => {
      const world = JSON.parse(gunzipSync(readFileSync(join(DIR, golden.world))).toString("utf8")) as WorldDoc;
      expect(hashJson(world)).toBe(golden.revision);
      // After every operation, each event validated against the state before it.
      let state = startState(world, reg);
      for (const op of golden.ops) {
        state = fold(reg, world, state, golden.events.slice(op.from, op.to));
        expect([op.op, hashJson(state)]).toEqual([op.op, op.hash]);
      }
      // Whole, as a chat's record, in both folds.
      expect(foldChat(world, golden.events)).toEqual({ reference: golden.hash, optimized: golden.hash });
    });
  }
});
