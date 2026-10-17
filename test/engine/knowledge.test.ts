// What the player layer may know (DESIGN §7): people and places the POV can see, through `knows`
// relations, `knownBy` selectors and its own observations (`space.seen`).

import { describe, expect, test } from "bun:test";
import { paramCandidates } from "../../src/engine/resolve";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function riverton(): Working {
  const world = modernUsWorld("k", "Riverton");
  // Someone the player can't see, standing in the player's apartment.
  world.entities.lurker = { id: "lurker", kind: "person", name: "The Lurker", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "secret" };
  world.entities.stranger = { id: "stranger", kind: "person", name: "Quiet Stranger", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "known_by" };
  world.entities.maya!.fields.place = "apartment";
  return new Working(reg, world, startState(world));
}

describe("palette targets", () => {
  test("a secret or unknown person at the player's place is never a target", () => {
    const w = riverton();
    const chat = reg.actions.get("chat_with");
    if (!chat) throw new Error("no chat_with");
    expect(paramCandidates(reg, w.world, w.state, chat, "target")).toEqual(["maya"]);
    w.apply({ type: "link", rel: "knows", from: "you", to: "stranger" });
    expect(paramCandidates(reg, w.world, w.state, chat, "target")).toEqual(["maya", "stranger"]);
  });
});
