// A reply that moves someone who doesn't act (DESIGN §8): the body stays where it lies. A body the
// POV knows of is declined in plain words; any other such move is dropped with nothing the player
// sees, so no refusal tells of a death the POV hasn't heard of.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/** A Port Alder chat whose reply brings Dale to the POV's flat; `start` is how the world starts him. */
async function daleComesOver(start: JsonObject) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject> } };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "dale_whitcomb", value: { ...draft.entities.dale_whitcomb, ...start } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const stateNow = async () => (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const before = await stateNow();
  const home = before ? placeOfEntity(before, "pov") : null;
  if (!before || !home) throw new Error("the chat has no state");
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "location", entity: "dale_whitcomb", place: home }] }) : "{}");
  await rig.turn(chatId, "Hey.", "Twenty minutes later Dale lets himself in and drops onto the couch.");
  const view = await rig.rt.view(chatId, rig.host.userId);
  const after = await stateNow();
  return {
    view,
    stayed: !!after && placeOfEntity(after, "dale_whitcomb") === placeOfEntity(before, "dale_whitcomb"),
    chips: view.chips.filter((c) => `${c.label} ${c.detail ?? ""}`.includes("Dale")),
  };
}

describe("a reply that moves someone who doesn't act", () => {
  test("someone the POV doesn't know is dead: the move is dropped, and nothing the player sees says so", async () => {
    const alive = await daleComesOver({});
    const dead = await daleComesOver({ life: "dead", lifeKnownBy: ["marcus_delgado"] });
    // The living Dale's move reaches the player (to undo or to apply); the dead one's reaches nothing.
    expect(alive.chips.length).toBeGreaterThan(0);
    expect(dead.stayed).toBe(true);
    expect(dead.chips).toEqual([]);
    const shown = JSON.stringify(dead.view);
    for (const said of ["didn't happen", "lies dead"]) expect(shown).not.toContain(said);
  });

  test("a body the POV knows of: a plain chip says so, with nothing of paying", async () => {
    const dead = await daleComesOver({ life: "dead" });
    expect(dead.stayed).toBe(true);
    expect(dead.chips.map((c) => c.kind)).toEqual(["decline"]);
    const [chip] = dead.chips;
    expect(chip?.detail).toContain("lies dead");
    expect(chip?.detail).not.toContain("..");
    expect(chip?.detail).not.toContain("unowned");
    expect(chip?.actions.map((a) => a.label)).not.toContain("Pay another way");
  });
});
