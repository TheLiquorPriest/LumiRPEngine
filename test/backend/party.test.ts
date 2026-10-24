// Companions (DESIGN §9.3, §9.4): typed Go brings the people it names along, someone the GM marks as
// travelling with the player character follows its moves unless the same reply took them elsewhere,
// the ✎ "Where are they?" moves someone in People with its own Undo, and the GM's Bring to brings
// someone to the player character's place.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { bringOp, paletteRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { GmView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "You read a narrator's roleplay reply";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const SHOP = "alder_automotive";
const MARKET = "alder_market";
const ANCHOR = "rusty_anchor";
/** Someone at the shop the POV can't see. */
const WATCHER = "the_watcher";

/** Port Alder with the POV, Marcus and Danny at the shop, and someone there the POV can't see. */
async function portAlder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  // A place the POV doesn't know of, which no ✎ may name.
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "smugglers_den", value: { id: "smugglers_den", name: "Smugglers' Den", parent: "port_alder", visibility: "secret", fields: {} } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: WATCHER, value: { id: WATCHER, kind: "character", name: "The Watcher", tier: "background", visibility: "secret", fields: { place: SHOP }, relations: [] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["pov", MARCUS, DANNY, WATCHER].map((entity) => ({ op: "move", entity, to: SHOP })) }));
  return { rig, chatId };
}

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

async function undoLast(rig: Rig, chatId: string): Promise<void> {
  const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!undo) throw new Error("no Undo chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
}

describe("companions", () => {
  test("typed Go with someone brings them along, and only them", async () => {
    const { rig, chatId } = await portAlder();
    script(rig, { action: "go", params: { to: MARKET, with: [DANNY] }, confidence: 0.9 }, { proposals: [], where: null });
    await rig.turn(chatId, "Danny and I head to the market.", "You and Danny walk over to the market.");
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, "pov")).toBe(MARKET);
    expect(placeOfEntity(state, DANNY)).toBe(MARKET);
    expect(placeOfEntity(state, MARCUS)).toBe(SHOP);
  });

  test("the Actions sheet's With picker offers the people here the player character can see, and Go brings the ones ticked", async () => {
    const { rig, chatId } = await portAlder();
    const view = await rig.rt.view(chatId, rig.host.userId);
    const go = view.palette?.entries.find((e) => e.action === "go");
    expect(go?.people?.options.map((o) => o.id)).toEqual([DANNY, MARCUS]);
    const market = go?.options.find((o) => o.params.to === MARKET);
    if (!go || !market) throw new Error("no Go to the market");
    // Staged by the sheet, it runs on the next message.
    script(rig, NONE, { proposals: [], where: null });
    rig.body(await rig.send(paletteRequest(go, [market], chatId, undefined, undefined, [MARCUS])));
    await rig.turn(chatId, "Come on, Marcus.", "You and Marcus head over to the market.");
    let state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, "pov")).toBe(MARKET);
    expect(placeOfEntity(state, MARCUS)).toBe(MARKET);
    expect(placeOfEntity(state, DANNY)).toBe(SHOP);
    // A hand-made request naming someone hidden with the player character doesn't bring them.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: WATCHER, to: MARKET }] }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "go", params: { to: SHOP, with: [WATCHER, MARCUS] }, source: "palette" }));
    await rig.turn(chatId, "Back to the shop.", "You and Marcus walk back to the shop.");
    state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, "pov")).toBe(SHOP);
    expect(placeOfEntity(state, MARCUS)).toBe(SHOP);
    expect(placeOfEntity(state, WATCHER)).toBe(MARKET);
  });

  test("a party member follows a narrated move of the player character, unless the reply sends them elsewhere", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [MARCUS, DANNY].map((from) => ({ op: "link", rel: "travels_with", from, to: "pov" })) }));
    script(rig, NONE, { proposals: [{ type: "location", entity: DANNY, place: ANCHOR }, { type: "location", entity: "pov", place: MARKET }], where: null });
    await rig.turn(chatId, "I head out.", "Danny peels off for the Anchor; you and Marcus walk to the market.");
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, "pov")).toBe(MARKET);
    expect(placeOfEntity(state, MARCUS)).toBe(MARKET);
    expect(placeOfEntity(state, DANNY)).toBe(ANCHOR);
  });

  test("Where are they? moves someone in People to a place the POV knows, and its Undo puts them back", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: MARCUS, field: "place", value: MARKET }));
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(MARKET);
    await undoLast(rig, chatId);
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(SHOP);
    expect((await rig.send({ type: "lre.fix", chatId, entity: MARCUS, field: "place", value: "smugglers_den" })).type).toBe("lre.error");
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(SHOP);
  });

  test("Bring to brings someone to the player character's place", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: MARCUS, to: ANCHOR }] }));
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
    const marcus = gm.entities.find((e) => e.id === MARCUS);
    const op = marcus ? bringOp(marcus, gm) : null;
    if (!op) throw new Error("no Bring to");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [op] }));
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(SHOP);
    await undoLast(rig, chatId);
    expect(placeOfEntity(await stateOf(rig, chatId), MARCUS)).toBe(ANCHOR);
  });
});
