// A reply that moves someone who doesn't act (DESIGN §8): the body stays where it lies. A body the
// POV knows of is declined in plain words, even one since brought back out of its sight; any other
// such move is dropped with nothing the player sees, so no refusal tells of a death or a revival the
// POV hasn't heard of.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { lifeKnownTo, lifeOf } from "../../src/engine/life";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/**
 * A Port Alder chat whose reply brings Dale to the POV's flat; `start` is how the world starts him.
 * `revive`: a turn first, after which a GM edit brings him back to life away from the POV.
 */
async function daleComesOver(start: JsonObject, revive = false) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject> } };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "dale_whitcomb", value: { ...draft.entities.dale_whitcomb, ...start } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const stateNow = async () => (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (revive) {
    rig.host.quietReply = () => JSON.stringify({ proposals: [] });
    await rig.turn(chatId, "Morning.", "The kettle clicks off.");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "life", entity: "dale_whitcomb", to: "alive" }] }));
  }
  const before = await stateNow();
  const home = before ? placeOfEntity(before, "pov") : null;
  if (!before || !home) throw new Error("the chat has no state");
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "location", entity: "dale_whitcomb", place: home }] }) : "{}");
  await rig.turn(chatId, "Hey.", "Twenty minutes later Dale lets himself in and drops onto the couch.");
  const view = await rig.rt.view(chatId, rig.host.userId);
  const after = await stateNow();
  return {
    view,
    truth: lifeOf(before, "dale_whitcomb"),
    povTakes: lifeKnownTo(before, "dale_whitcomb", "pov"),
    stayed: !!after && placeOfEntity(after, "dale_whitcomb") === placeOfEntity(before, "dale_whitcomb"),
    arrived: !!after && placeOfEntity(after, "dale_whitcomb") === home,
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

  test("a body the POV knows of, brought back out of its sight: still declined as that body, with no hint of the revival", async () => {
    const revived = await daleComesOver({ life: "dead" }, true);
    expect([revived.truth, revived.povTakes]).toEqual(["alive", "dead"]);
    expect(revived.arrived).toBe(false);
    const moves = revived.chips.filter((c) => c.kind === "undo" || c.kind === "decline");
    expect(moves.map((c) => c.kind)).toEqual(["decline"]);
    expect(moves[0]?.detail).toContain("lies dead");
  });
});
