// A move the reply describes toward someone's usual place (DESIGN §9.4, §6.10): extract is given the
// usual routines of the people with the player character, as it may know them, apart from the facts,
// and a move to "their usual spot" lands where their routine has them now, through the narrated-move
// path like any other. A usual place the player may not know never resolves, and a routine moves no
// one the reply doesn't describe moving.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const SHOP = "alder_automotive";

/**
 * Port Alder on a Monday just after noon, with Danny and Marcus at the shop with the player character
 * (`patch` changes the draft's places first). Its reply is `reply`, and extract answers `proposals`;
 * what extract was given comes back with where each of them ends up.
 */
async function lunchHour(reply: string, proposals: JsonObject[], patch: (places: Record<string, JsonObject>) => void = () => undefined) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { places: Record<string, JsonObject> } };
  const places = structuredClone(draft.places);
  patch(places);
  for (const [id, value] of Object.entries(places)) if (JSON.stringify(value) !== JSON.stringify(draft.places[id])) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value }));
  rig.body(await rig.send({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "replace", path: "/start", value: { place: SHOP, at: "2026-09-14T12:01" } }] }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Noon.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", DANNY, MARCUS].map((entity) => ({ op: "move", entity, to: SHOP })) }));
  const given: string[] = [];
  rig.host.quietReply = (req) => {
    if (!(req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) return "{}";
    given.push(`${req.messages[0]?.content ?? ""}\n${req.messages[1]?.content ?? ""}`);
    return JSON.stringify({ proposals, where: null });
  };
  await rig.turn(chatId, "I keep at the brakes.", reply);
  const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("the chat has no state");
  const extracted = given.at(-1) ?? "";
  const usual = /Usual routines \(where[^\n]*\n([\s\S]*?)\nNarration:/.exec(extracted)?.[1] ?? "";
  return { usual, extracted, danny: placeOfEntity(state, DANNY), marcus: placeOfEntity(state, MARCUS) };
}

const USUAL_LUNCH = "At noon Danny and Marcus pull their jackets on and head out to their usual lunch spots.";
const toUsual: JsonObject[] = [
  { type: "location", entity: DANNY, place: "usual" },
  { type: "location", entity: MARCUS, place: "usual" },
];

describe("a narrated move to someone's usual place", () => {
  test("extract gets the usual routines apart from the facts, and each move lands at their own routine's place for now", async () => {
    const r = await lunchHour(USUAL_LUNCH, toUsual);
    expect(r.usual).toContain(`${DANNY} (Danny Okafor) usually:`);
    expect(r.usual).toContain("Shoreline Fuel (shoreline_fuel)");
    expect(r.usual).toContain("The Rusty Anchor (rusty_anchor)");
    expect([r.danny, r.marcus]).toEqual(["shoreline_fuel", "rusty_anchor"]);
  });

  test("a usual place the player character may not know never resolves, and isn't named to extract", async () => {
    const r = await lunchHour(USUAL_LUNCH, toUsual, (places) => {
      const fuel = places.shoreline_fuel;
      if (fuel) fuel.visibility = "secret";
    });
    expect(r.extracted).not.toContain("shoreline_fuel");
    expect(r.extracted).not.toContain("Shoreline Fuel");
    expect(r.usual).toContain("The Rusty Anchor (rusty_anchor)");
    expect([r.danny, r.marcus]).toEqual([SHOP, "rusty_anchor"]);
  });

  test("a reply that moves no one moves no one, whatever their routine says", async () => {
    const r = await lunchHour("Danny and Marcus keep at the Silverado through the lunch hour.", []);
    expect(r.usual).toContain("Shoreline Fuel (shoreline_fuel)");
    expect([r.danny, r.marcus]).toEqual([SHOP, SHOP]);
  });

  test("a move to a named place reads as before", async () => {
    const r = await lunchHour("Marcus walks over to the Anchor for a Reuben.", [{ type: "location", entity: MARCUS, place: "rusty_anchor" }]);
    expect([r.danny, r.marcus]).toEqual([SHOP, "rusty_anchor"]);
  });
});
