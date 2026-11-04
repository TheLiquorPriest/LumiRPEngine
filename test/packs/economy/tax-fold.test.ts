// Phase 5's tax events fold identically (ORG-SPEC §3.11, §8; DESIGN §14): Riverton's clerk paid by
// Brightline from 15 December to 3 February accrues FUTA and SUTA on each paycheck, Brightline pays
// the fourth quarter's SUTA and files its FUTA return on 1 February, the player gives the parish
// church a deductible gift, and a parent's
// consolidated return marks its member's period filed. Recorded as one turn's ledger, it folds in the
// reference fold and the optimized one to the same state, whose unemployment, donation and estimated-
// tax records are the ones the live run left; folded event by event, each new event is accepted.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, Rec } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { resolveFix } from "../../../src/engine/edits";
import type { ChainMessage, FoldInput } from "../../../src/engine/ledger/chain";
import { LedgerFold } from "../../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../../src/engine/ledger/path";
import { referenceFold } from "../../../src/engine/ledger/reference";
import { objOf, sliceOf } from "../../../src/engine/pack-kit";
import type { WorldState } from "../../../src/engine/state";
import { DONATION } from "../../../src/packs/economy/core/exempt";
import { UNEMPLOYMENT_ACCRUED, UNEMPLOYMENT_PAID } from "../../../src/packs/economy/core/unemployment";
import { fold, startState } from "../support";
import { account, act, CLERK, entity, lapse, reg, setup } from "./work-world";

const DAY = 1440;
const CHURCH = "st_marys_parish";

/** The ledger as one turn's record on a chat, folded by the reference fold and the optimized one. */
function foldChat(world: WorldDoc, events: readonly LedgerEvent[]): { reference: WorldState; optimized: WorldState } {
  const revision = hashJson(world);
  const chain: ChainMessage[] = [
    { id: "a0", isUser: false, swipeId: 0, swipes: ["It begins."], ledger: null },
    { id: "u1", isUser: true, swipeId: 0, swipes: ["Play it out."], ledger: null },
    { id: "a1", isUser: false, swipeId: 0, swipes: ["It plays out."], ledger: null },
  ];
  const path = computePaths(chain, [])[2]?.parentPath ?? "";
  const rec: Rec = { v: 1, defHash: revision, seq: 0, swipeHash: contentId("It plays out."), path, seed: "tax-fold", pre: events.length, events: [...events], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
  const reply = chain[2];
  if (reply) reply.ledger = { v: 1, swipes: { "0": rec }, markers: [] };
  const input: FoldInput = { worlds: (r) => (r === revision ? world : undefined), revision, pauses: [], tombstones: [], chain, resolveFix: (doc, state, entry) => resolveFix(reg, doc, state, entry, "tax-fold") };
  const reference = referenceFold(input, reg);
  const optimized = new LedgerFold(reg).fold(input);
  expect(reference.violations).toEqual([]);
  expect(optimized.violations).toEqual([]);
  return { reference: reference.state, optimized: optimized.state };
}

/** The economy records Phase 5 writes, and the ones beside them it reads. */
function records(state: Readonly<WorldState>): JsonObject {
  const economy = sliceOf(state, "economy");
  return { unemployment: objOf(economy.unemployment), donations: objOf(economy.donations), estimated: objOf(economy.estimated), payroll_taxes: objOf(economy.payroll_taxes) };
}

describe("Phase 5's tax events fold identically", () => {
  test("accruals, a SUTA payment, a gift and a filed member period fold the same in both folds, to the records the live run left", () => {
    const { world, w } = setup((wd) => {
      wd.start.at = "2026-12-15T07:00";
      wd.entities.brightline!.fields.region = "oh";
      wd.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK);
      wd.entities[CHURCH] = entity(CHURCH, "group", "St Mary's Parish", { tax_exempt: "church" });
      wd.entities.church_checking = account("church_checking", CHURCH, "checking", 0);
    });
    lapse(w, 50 * DAY);
    expect(act(w, "economy.donate", { from: "you", to: CHURCH, cents: 5_000 }).rejected).toEqual([]);
    expect(w.apply({ type: "economy.estimated_tax", data: { party: "brightline", periods: [{ key: "2027:1,2,3", cents: 0 }], business: true } })).toBeNull();
    const types = new Set<string>(w.events.map((e) => e.type));
    for (const type of [UNEMPLOYMENT_ACCRUED, UNEMPLOYMENT_PAID, DONATION]) expect(types.has(type)).toBe(true);

    const live = records(w.state);
    expect(Object.keys(live.unemployment as JsonObject)).toEqual(["brightline"]);
    const { reference, optimized } = foldChat(world, w.events);
    expect(hashJson(optimized)).toBe(hashJson(reference));
    expect(records(reference)).toEqual(live);
    // Event by event, every one is accepted, to the same records.
    expect(records(fold(reg, world, startState(world, reg), w.events))).toEqual(live);
  });
});
