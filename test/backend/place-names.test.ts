// The places a reply's read is offered, and the places it names (DESIGN §9.4): the rooms around the
// player character by name whatever their order in the world, and a move given by a place's name
// lands there, the nearest place when two share the name.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "You read a narrator's roleplay reply";
const MARCUS = "marcus_delgado";
const PRIYA = "priya_nair";

/**
 * Port Alder with forty farms ahead of a cannery whose rooms come last in the world's order, and an
 * annex with a reception of its own put before the cannery's; the POV, Marcus and Priya on the
 * cannery's packing floor.
 */
async function cannery(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const put = async (id: string, name: string, parent: string): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value: { id, name, parent, fields: {} } }));
  for (let i = 0; i < 40; i++) await put(`farm_${i}`, `Farm ${i}`, "lakeshore_county");
  await put("annex", "Annex", "port_alder");
  await put("annex_reception", "Reception", "annex");
  await put("cannery", "The Cannery", "port_alder");
  for (const [id, name] of [
    ["cannery_floor", "Packing floor"],
    ["cannery_corridor", "Back corridor"],
    ["cannery_rooftop", "Rooftop terrace"],
    ["cannery_reception", "Reception"],
  ] as const)
    await put(id, name, "cannery");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", MARCUS, PRIYA].map((entity) => ({ op: "move", entity, to: "cannery_floor" })) }));
  return { rig, chatId };
}

/** Extract answers `extract`, keeping each prompt it is given; every other step says nothing. */
function script(rig: Rig, extract: JsonObject): string[] {
  const prompts: string[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (!system.includes(EXTRACT_MARK)) return "{}";
    prompts.push(system);
    return JSON.stringify(extract);
  };
  return prompts;
}

async function stateOf(rig: Rig, chatId: string): Promise<WorldState> {
  const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

describe("the places a reply's read names", () => {
  test("the read is offered the rooms around the player character by name, whatever their order in the world", async () => {
    const { rig, chatId } = await cannery();
    const prompts = script(rig, { proposals: [], where: null });
    await rig.turn(chatId, "I look around.", "Steam drifts up from the retorts.");
    const prompt = prompts[0] ?? "";
    for (const room of ["cannery_floor (Packing floor)", "cannery_corridor (Back corridor)", "cannery_rooftop (Rooftop terrace)", "cannery_reception (Reception)"]) expect(prompt).toContain(room);
  });

  test("a move given by a place's name lands there, the nearest of two that share it, and where the reply leaves the player character by name is offered", async () => {
    const { rig, chatId } = await cannery();
    script(rig, { proposals: [{ type: "location", entity: MARCUS, place: "Back corridor" }, { type: "location", entity: PRIYA, place: "reception" }], where: "the rooftop terrace" });
    await rig.turn(chatId, "I head up for air.", "Marcus heads out to the back corridor, Priya goes down to reception, and you climb out onto the rooftop terrace.");
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, MARCUS)).toBe("cannery_corridor");
    expect(placeOfEntity(state, PRIYA)).toBe("cannery_reception");
    const head = rig.host.head(chatId);
    const offered = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && c.kind === "confirm").map((c) => c.label);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toContain("Rooftop terrace");
  });
});
