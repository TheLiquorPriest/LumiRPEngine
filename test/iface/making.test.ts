// Things and places made with advice asked: a new one is always made, the ones of the same name are named, nothing is read from a name,
// and no name is too long. Without the ask, today's find-first stands. Every name here is invented.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOp } from "../../src/engine/places-in-play";
import { applyItemOp, type ItemOpApplied, type ItemOpOptions, type ItemOpRefusal } from "../../src/engine/thing-ops";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { rig, registry, world } from "./rig";

const PLAIN: ItemOpOptions = { by: "gm", confirmed: true, gm: true, salt: "s" };
const ASKED: ItemOpOptions = { ...PLAIN, advise: true };

async function working(without?: string): Promise<Working> {
  const t = await rig();
  const reg = without === undefined ? registry() : createRegistry(ALL_PACKS.filter((p) => p.id !== without));
  return new Working(reg, world(), t.s.stateAt(t.turn.id).state.world);
}

const idOf = (out: ItemOpApplied | ItemOpRefusal): string => ("made" in out && out.made !== undefined ? out.made : "");
const codesOf = (out: { advice?: readonly { code: string }[] }): string[] => (out.advice ?? []).map((a) => a.code);

describe("making with advice asked", () => {
  test("a cask made where a cask stands is a second one, and the first is named by its id; without the ask it stands for it", async () => {
    const w = await working();
    const second = applyItemOp(w, { do: "make", name: "Cask of cider", at: { place: "cellar" }, why: "" }, ASKED);
    expect(idOf(second)).not.toBe("");
    expect(idOf(second)).not.toBe("cask");
    expect("advice" in second ? JSON.stringify(second.advice) : "").toContain("cask");
    const plain = applyItemOp(await working(), { do: "make", name: "Cask of cider", at: { place: "cellar" }, why: "" }, PLAIN);
    expect("code" in plain && plain.code).toBe("exists");
  });

  test("a thing made as Old sofa has no type, no weight and no size read from its name, and lands in a person's hands", async () => {
    const w = await working();
    const id = idOf(applyItemOp(w, { do: "make", name: "Old sofa", at: { in: "wren" }, why: "" }, ASKED));
    expect(w.state.entities[id]?.fields.type).toBeUndefined();
    expect(w.state.entities[id]?.fields.weight_g).toBeUndefined();
    expect(w.state.entities[id]?.relations).toContainEqual(expect.objectContaining({ type: "in", to: "wren" }));
  });

  test("a name of 120 characters is kept whole, made and relabelled", async () => {
    const w = await working();
    const long = "a ".repeat(60).trim();
    const id = idOf(applyItemOp(w, { do: "make", name: long, at: { in: "wren" }, why: "" }, ASKED));
    expect(w.state.entities[id]?.name).toBe(long);
    const longer = `${long} again and again and again`;
    expect("code" in applyItemOp(w, { do: "label", item: id, name: longer }, ASKED)).toBe(false);
    expect(w.state.entities[id]?.name).toBe(longer);
  });

  test("a thing made at no spot has no place and no holder; a vehicle in a world with no vehicles pack is a thing with its class, advised", async () => {
    const w = await working();
    const spoon = w.state.entities[idOf(applyItemOp(w, { do: "make", name: "Bent spoon", why: "" }, ASKED))];
    expect(spoon?.fields.place).toBeUndefined();
    expect(spoon?.relations.some((r) => r.type === "in")).toBe(false);
    const bare = await working("vehicles");
    const van = applyItemOp(bare, { do: "make", name: "Delivery van", class: "van", at: { place: "market_square" }, why: "" }, ASKED);
    expect("advice" in van ? codesOf(van) : []).toContain("made_as_thing");
    expect(bare.state.entities[idOf(van)]?.fields.vehicle_class).toBe("van");
  });

  test("a room named as one in the inn already is made and advises the first; past the cap it is made and says so; a 90-character name is kept", async () => {
    const w = await working();
    const room = { do: "make", name: "The Cellar", parent: "lamp_ladle", as: "room", why: "" } as const;
    const twice = placeOp(w.ctx, room, { by: "gm", salt: "s", advise: true });
    expect("made" in twice && twice.made !== "cellar").toBe(true);
    expect("advice" in twice ? codesOf(twice) : []).toContain("same_name");
    const plain = placeOp(w.ctx, room, { by: "gm", salt: "s" });
    expect("code" in plain && plain.code).toBe("exists");
    const capped = placeOp(w.ctx, { ...room, name: "x".repeat(90) }, { by: "gm", salt: "s", advise: true, cap: 0 });
    expect("advice" in capped ? codesOf(capped) : []).toContain("place_past_cap");
    expect("events" in capped && JSON.stringify(capped.events)).toContain("x".repeat(90));
  });
});
