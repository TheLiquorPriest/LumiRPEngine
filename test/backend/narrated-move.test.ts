// A reply that moves someone who doesn't act (DESIGN §8, §11): the story stands, so the body goes
// where the reply puts it, as any narrated move does. What the player sees of the move reads as it
// would for anyone, so it never tells of a death or a revival the POV hasn't heard of.

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
    arrived: !!after && placeOfEntity(after, "dale_whitcomb") === home,
    chips: view.chips.filter((c) => `${c.label} ${c.detail ?? ""}`.includes("Dale")),
  };
}

/** What the player sees of the move, without the ids that differ from chat to chat. */
const seen = (chips: { kind: string; label: string; detail?: string; actions: unknown[] }[]) => chips.map((c) => ({ kind: c.kind, label: c.label, detail: c.detail, actions: c.actions }));

describe("a reply that moves someone who doesn't act", () => {
  test("someone the POV doesn't know is dead: the move lands, read as the living one's does", async () => {
    const alive = await daleComesOver({});
    const dead = await daleComesOver({ life: "dead", lifeKnownBy: ["marcus_delgado"] });
    expect([alive.arrived, dead.arrived]).toEqual([true, true]);
    expect(alive.chips.map((c) => c.kind)).toEqual(["undo"]);
    expect(seen(dead.chips)).toEqual(seen(alive.chips));
    const shown = JSON.stringify(dead.view);
    for (const said of ["didn't happen", "lies dead"]) expect(shown).not.toContain(said);
  });

  test("a body the POV knows of: the move lands as told, with its Undo and nothing of paying", async () => {
    const alive = await daleComesOver({});
    const dead = await daleComesOver({ life: "dead" });
    expect(dead.arrived).toBe(true);
    expect(seen(dead.chips)).toEqual(seen(alive.chips));
    expect(dead.chips[0]?.actions.map((a) => a.label)).not.toContain("Pay another way");
  });

  test("a body the POV knows of, brought back out of its sight: the move lands as told, with no hint of the revival", async () => {
    const dead = await daleComesOver({ life: "dead" });
    const revived = await daleComesOver({ life: "dead" }, true);
    expect([revived.truth, revived.povTakes]).toEqual(["alive", "dead"]);
    expect(revived.arrived).toBe(true);
    const moves = revived.chips.filter((c) => c.kind === "undo" || c.kind === "decline");
    expect(seen(moves)).toEqual(seen(dead.chips));
  });
});
