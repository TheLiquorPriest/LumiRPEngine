// Naming a kit piece in free text: an exact name, a part of it, or its words in any order.
import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { findPiece } from "../../../src/packs/gear/core/model";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const METRIC = "Combination wrench, metric (10, 12, 13, 14, 17, 19 mm)";

function atGarage(): Working {
  const world = modernUsWorld("kp", "Riverton");
  world.entities.you!.fields.place = "garage";
  return new Working(reg, world, startState(world));
}

describe("kit pieces named in free text", () => {
  test("words in any order find the piece; the closest name wins; nothing close finds nothing", () => {
    const w = atGarage();
    const name = (said: string): string | null => findPiece(w.ctx, "toolbox", said)?.name ?? null;
    expect(name("metric combination wrench")).toBe(METRIC);
    expect(name("combination wrench, metric (the 13 mm)")).toBe(METRIC);
    expect(name("the 13 mm wrench")).toBe(METRIC);
    expect(name("SAE combination wrenches")).toStartWith("Combination wrench, SAE");
    expect(name("adjustable")).toBe("Adjustable wrench, 8 in");
    expect(name("a banana")).toBeNull();
    expect(name("13 19")).toBeNull();
  });

  test("Take from a kit takes the piece the player named in their own words", () => {
    const w = atGarage();
    const r = resolveAction(reg, w, { action: "take_piece", params: { kit: "toolbox", piece: "metric combination wrench" } }, createRng("t"));
    expect([r.ok, r.rejected]).toEqual([true, []]);
    const taken = Object.values(w.state.entities).filter((e) => e.fields.from_kit === "toolbox").map((e) => e.fields.piece);
    expect(taken).toEqual([METRIC]);
  });
});
