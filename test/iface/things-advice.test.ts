// The things model with advice asked: what its rules would refuse or move elsewhere is applied as asked and comes back as advice;
// without the ask, today's answer stands. Every name here is invented.

import { describe, expect, test } from "bun:test";
import { applyItemOp, type ItemOpOptions } from "../../src/engine/thing-ops";
import { relocateInto } from "../../src/engine/relocate";
import { Working } from "../../src/engine/working";
import { rig, registry, world } from "./rig";
import { familyRig } from "./families/kit";
import { SRC } from "./families/kit";

const OPTS: ItemOpOptions = { by: "gm", confirmed: true, gm: true, salt: "s" };

async function working(): Promise<Working> {
  const t = await rig();
  return new Working(registry(), world(), t.s.stateAt(t.turn.id).state.world);
}

describe("the things model asked for advice", () => {
  test("a thing above what a person carries stays in their hands with the advice; without the ask it lands where they stand", async () => {
    const asked = await working();
    const cask = asked.state.entities.cask;
    if (cask) cask.fields.size = "furniture";
    const big = applyItemOp(asked, { do: "move", item: "cask", to: { in: "bram" }, why: "" }, { ...OPTS, advise: true });
    expect("code" in big).toBe(false);
    expect(asked.state.entities.cask?.relations).toContainEqual(expect.objectContaining({ type: "in", to: "bram" }));
    expect("advice" in big ? big.advice?.map((a) => a.code) : []).toContain("above_carry");
    expect(asked.events.some((e) => e.type === "engine.note")).toBe(false);

    const plain = await working();
    const plainCask = plain.state.entities.cask;
    if (plainCask) plainCask.fields.size = "furniture";
    const placed = applyItemOp(plain, { do: "move", item: "cask", to: { in: "bram" }, why: "" }, OPTS);
    expect("code" in placed).toBe(false);
    expect("placed" in placed ? placed.placed : undefined).toBeDefined();
  });

  test("a loan and a permission ending before now are recorded with that end and advised; a return to a non-owner is a recorded return", async () => {
    const w = await working();
    const knife = w.state.entities.knife;
    if (knife) knife.fields.owner = "wren";
    const loan = applyItemOp(w, { do: "hand", item: "knife", to: "odile", basis: "loan", until: 1, why: "" }, { ...OPTS, advise: true });
    expect("advice" in loan ? loan.advice?.map((a) => a.code) : []).toContain("ends_before_now");
    expect(w.state.entities.odile?.relations.find((r) => r.type === "uses" && r.to === "knife")?.until).toBe(1);
    const back = applyItemOp(w, { do: "hand", item: "knife", to: "tam", basis: "return", why: "" }, { ...OPTS, advise: true });
    expect("advice" in back ? back.advice?.map((a) => a.code) : []).toContain("returned_not_owner");
    const refused = applyItemOp(await working(), { do: "hand", item: "knife", to: "odile", basis: "loan", until: 1, why: "" }, OPTS);
    expect("code" in refused && refused.code).toBe("bad_until");
  });

  test("a condition is counted from what is recorded, never held to its bounds, and advised past them", async () => {
    const t = await familyRig();
    const r = await t.call("item_condition", { item: "knife", delta: -500, ...SRC });
    expect(r.error).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.entities.knife?.fields.condition).toBe(-400);
    expect((r.reports ?? []).some((x) => x.includes("outside what its sheet allows"))).toBe(true);
  });

  test("someone put into a holder has no place of their own and is its driver when asked", async () => {
    const w = await working();
    const boarded = relocateInto(w.ctx, "bram", "cask", { driver: true });
    expect("events" in boarded).toBe(true);
    if ("events" in boarded) {
      expect(w.applyAll(boarded.events)).toHaveLength(boarded.events.length);
      expect(w.state.entities.bram?.fields.place).toBeNull();
      expect(w.state.entities.cask?.fields.driver).toBe("bram");
    }
  });
});
