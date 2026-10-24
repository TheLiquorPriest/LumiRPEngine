// Moves are story first (DESIGN §9.4, §4.1): a move the reply tells lands whether or not a route
// joins the places, a move it only implies never tells the next reply it didn't happen, typed Go
// goes by any mode or nominally, and only the world's travel simulation brings route checks back.
// ✎ Place moves the POV for real, and a refused confirm-mode change gets its chip.

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
const SHOP = "alder_automotive";
/** A place no route reaches, added to Port Alder. */
const ROCK = "lighthouse_rock";

/** Port Alder with Marcus and the POV at the shop, a place no route reaches and a secret one; `mapSettings` as given. */
async function portAlder(mapSettings?: JsonObject): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  await put("places", ROCK, { id: ROCK, name: "Lighthouse Rock", parent: "lakeshore_county", fields: {} });
  await put("places", "smugglers_den", { id: "smugglers_den", name: "Smugglers' Den", parent: "port_alder", visibility: "secret", fields: {} });
  // The market's spot on the town's map, where an arrival stands.
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { places: Record<string, JsonObject> } };
  await put("places", "alder_market", { ...draft.places.alder_market, cell: { x: 4, y: 7 } });
  if (mapSettings) rig.body(await rig.send({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "add", path: "/mapSettings", value: { display: "knowledge", grid: { movement: false, sightRadius: 3 }, ...mapSettings } }] }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", MARCUS].map((entity) => ({ op: "move", entity, to: SHOP })) }));
  return { rig, chatId };
}

/** Answers interpret with `read` and extract with `extract`; every other step says nothing. */
function script(rig: Rig, read: JsonObject, extract: JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify(read);
    if (system.includes(EXTRACT_MARK)) return JSON.stringify(extract);
    return "{}";
  };
}

const NONE: JsonObject = { action: null, params: {}, confidence: 0.9 };

async function stateOf(rig: Rig, chatId: string): Promise<WorldState> {
  const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

/** The latest reply's decline chips. */
async function declines(rig: Rig, chatId: string) {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && c.kind === "decline");
}

describe("story-first moves", () => {
  test("a narrated move no route reaches lands", async () => {
    const { rig, chatId } = await portAlder();
    script(rig, NONE, { proposals: [{ type: "location", entity: MARCUS, place: ROCK }], where: null });
    await rig.turn(chatId, "I wave Marcus off.", "Marcus rows out to Lighthouse Rock.");
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(ROCK);
    expect(await declines(rig, chatId)).toEqual([]);
  });

  test("with the travel simulation on, it's refused as before", async () => {
    const { rig, chatId } = await portAlder({ travelSimulation: true });
    script(rig, NONE, { proposals: [{ type: "location", entity: MARCUS, place: ROCK }], where: null });
    await rig.turn(chatId, "I wave Marcus off.", "Marcus rows out to Lighthouse Rock.");
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(SHOP);
    expect((await declines(rig, chatId)).length).toBe(1);
  });

  test("a move the reply only implies that can't happen leaves no Outcome note", async () => {
    const { rig, chatId } = await portAlder({ travelSimulation: true });
    script(rig, NONE, { proposals: [], where: ROCK });
    await rig.turn(chatId, "I look around.", "Wind whips off the water around the lighthouse.");
    expect(await rig.rt.outcomeNotes.list(chatId, rig.host.userId)).toEqual([]);
    expect(await declines(rig, chatId)).toEqual([]);
  });

  test("typed Go to a place only a road reaches goes there", async () => {
    const { rig, chatId } = await portAlder();
    script(rig, { action: "go", params: { to: "chicago_il" }, confidence: 0.9 }, { proposals: [], where: null });
    const before = (await stateOf(rig, chatId)).clock;
    await rig.turn(chatId, "I head to Chicago.", "The lake falls behind you.");
    const after = await stateOf(rig, chatId);
    expect(placeOfEntity(after, "pov")).toBe("chicago_il");
    expect(after.clock).toBeGreaterThan(before);
  });
});

describe("✎ Place", () => {
  test("moves the POV for real: its activity stays behind and it stands where it arrives", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "pov", field: "activity", value: "work" }] }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "place", value: "alder_market" }));
    const pov = (await stateOf(rig, chatId)).entities.pov;
    expect(pov?.fields.place).toBe("alder_market");
    expect(pov?.fields.activity).not.toBe("work");
    expect([pov?.fields.x, pov?.fields.y]).toEqual([4, 7]);
  });
});

describe("a refused confirm-mode change", () => {
  test("gets a decline chip; one naming a place the POV may not know shows nothing", async () => {
    const { rig, chatId } = await portAlder();
    script(rig, NONE, { proposals: [{ type: "transfer", from: MARCUS, to: "pov", amount: 0 }], where: null });
    await rig.turn(chatId, "I ask Marcus about pay.", "Marcus waves the question off.");
    expect((await declines(rig, chatId)).length).toBe(1);
    script(rig, NONE, { proposals: [{ type: "knows", who: "pov", fact: "smugglers_den" }], where: null });
    await rig.turn(chatId, "I listen.", "Marcus mutters about the old smugglers.");
    expect(await declines(rig, chatId)).toEqual([]);
  });
});
