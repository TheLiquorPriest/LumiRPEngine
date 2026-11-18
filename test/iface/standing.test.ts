// What the clock's passing does by itself (plan §6.1, §6.4): pay, bills and standing payments happen in their order as
// pass_time passes their day, each with its record, and the answer says what they did; what no record arranges (where
// people go, what they do) is left to the Author, listed as due.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { occurrences } from "../../src/packs/economy/core/flows";
import { balance } from "../../src/packs/economy/core/model";
import type { WorldDoc } from "../../src/shared/world";
import { familyRig } from "./families/kit";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-1" };
const DAY = 24 * 60;

/** Bram pays Wren two coins a week from a full till, the first of the week at nine; Wren's coin opens at 12. */
function paid(w: WorldDoc): void {
  w.realism.levels.money = 3;
  w.entities.acct_bram = { id: "acct_bram", kind: "account", name: "Bram's coin", tier: "background", fields: { owners: [{ party: "bram", role: "owner" }], product: "cash", opening: 100000 }, relations: [] };
  w.entities.wage = { id: "wage", kind: "flow", name: "Wren's wage", tier: "background", fields: { from: "acct_bram", to: "acct_wren", amount_cents: 2000, every: "week", flow_kind: "income", category: "wages" }, relations: [] };
}

async function rigged(edit: (w: WorldDoc) => void = paid) {
  let doc: WorldDoc | undefined;
  const t = await familyRig((w) => {
    edit(w);
    doc = w;
  });
  return { t, doc: doc as WorldDoc };
}

const operation = (r: Awaited<ReturnType<Awaited<ReturnType<typeof rigged>>["t"]["call"]>>): JsonObject => ((dataOf(r).operations as JsonObject[])[0] as JsonObject);

describe("a payday inside a skip", () => {
  test("every payday of thirty days is paid, the answer says how many times, and the answer's words are the files' lines", async () => {
    const { t, doc } = await rigged();
    const start = t.s.stateAt(t.turn.id).state.world.clock;
    const paydays = occurrences(doc, { every: "week" }, start, start + 30 * DAY);
    expect(paydays.length).toBeGreaterThanOrEqual(4);
    expect(balance(t.s.stateAt(t.turn.id).state.world, "acct_wren")).toBe(0);
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", for: "30 days", source: SRC }] });
    expect(r.error).toBeUndefined();
    const after = t.s.stateAt(t.turn.id).state.world;
    expect(after.clock).toBe(start + 30 * DAY);
    expect(balance(after, "acct_wren")).toBe(1200 + 2000 * paydays.length);
    expect(balance(after, "acct_bram")).toBe(100000 - 2000 * paydays.length);
    // The answer tells what happened, each line once with how many times.
    const ran = operation(r).ran as JsonObject[];
    expect(ran.some((l) => String(l.line).includes("Wren's wage") && l.times === paydays.length)).toBe(true);
    expect(texts(r).some((x) => x.includes("recorded") && x.includes("ran"))).toBe(true);
    wordsFromFiles(r);
  });

  test("a skip that ends half an hour after the payday has paid it, once; one that ends before it pays nothing, and the next pays it once", async () => {
    const { t, doc } = await rigged();
    const start = t.s.stateAt(t.turn.id).state.world.clock;
    const first = occurrences(doc, { every: "week" }, start, start + 30 * DAY)[0];
    if (first === undefined) throw new Error("the wage has no payday in thirty days");
    const payday = first.at;
    const wren = () => balance(t.s.stateAt(t.turn.id).state.world, "acct_wren");
    // An hour before payday: nothing is paid, and the clock stands where it was asked to.
    await t.call("world_apply", { operations: [{ op: "pass_time", minutes: payday - start - 60, source: SRC }] });
    expect(t.s.stateAt(t.turn.id).state.world.clock).toBe(payday - 60);
    expect(wren() === 0 || wren() === 1200).toBe(true);
    const before = wren();
    // Half an hour past it, in the middle of a part of the day: it is paid now.
    await t.call("world_apply", { operations: [{ op: "pass_time", minutes: 90, source: SRC }] });
    expect(t.s.stateAt(t.turn.id).state.world.clock).toBe(payday + 30);
    expect(wren()).toBe(1200 + 2000);
    expect(before).toBeLessThan(wren());
    // The rest of the day: not paid again.
    await t.call("world_apply", { operations: [{ op: "pass_time", minutes: 600, source: SRC }] });
    expect(wren()).toBe(1200 + 2000);
  });
});

describe("what no record arranges", () => {
  test("a person's routine is not carried out and a schedule that sets an owner's own value is", async () => {
    const { t } = await rigged((w) => {
      w.schedules = {
        tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }] },
        bram_mood: { id: "bram_mood", owner: "bram", target: "mood", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "cheerful" }] },
      };
    });
    const place = (): unknown => t.s.stateAt(t.turn.id).state.world.entities.tam?.fields.place;
    const where = place();
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", for: "two hours", source: SRC }] });
    expect(r.error).toBeUndefined();
    // Bram's mood is set by his schedule at nine; Tam stays where the story has him.
    expect(t.s.stateAt(t.turn.id).state.world.entities.bram?.fields.mood).toBe("cheerful");
    expect(place()).toBe(where);
    // The rig's list holds an arrival: the answer says that nothing it lists has happened.
    expect(texts(r).some((x) => x.includes("nothing in due has happened yet"))).toBe(true);
    wordsFromFiles(r);
  });

  test("an answer whose span lists nothing says nothing of what is left to the Author", async () => {
    const t = await rig({ due: { due: () => ({ items: [], more: 0 }) } });
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", for: "two hours", source: SRC }] });
    expect(r.error).toBeUndefined();
    expect(texts(r).some((x) => x.includes("nothing in due has happened"))).toBe(false);
  });
});
