// The reply's read and items (DESIGN §9.4, §4.3): the read is given the player's message as context,
// and a change applied from its confirm chip moves a quest that same turn, as an automatic one does.
// The reply's thing facts (ITEMS-SPEC §12 Phase 2, R1–R9), settled by the reconciler under their
// change types' modes, with the old pins carried over, and a fact naming someone unknown told so.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { SettingsStore } from "../../src/backend/settings-store";
import { accessFor } from "../../src/engine/access";
import type { ReadContext } from "../../src/engine/registry";
import type { WorldState } from "../../src/engine/state";
import { sizeOf, whoseOf } from "../../src/engine/things";
import { journalOf } from "../../src/packs/economy/core/journal";
import { hasOwn, isRecord, type JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

/** A Port Alder chat, with `puts` put into its world first, on `host` (one whose storage a test wrote) when given. */
async function chat(puts: [string, JsonObject][] = [], host?: FakeHost): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true, ...(host ? { host } : {}) });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  for (const [collection, value] of puts) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
  if (puts.length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

async function state(rig: Rig, chatId: string): Promise<WorldState> {
  return (await scene(rig, chatId)).state;
}

/** The chat's state at its head, and a context to read it with. */
async function scene(rig: Rig, chatId: string): Promise<{ state: WorldState; ctx: ReadContext }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const folded = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = folded ? core?.worldAt(folded.revision) : undefined;
  if (!folded || !world) throw new Error("no state");
  return { state: folded, ctx: rig.rt.registry.context(world, folded) };
}

/** The chat's one chip `which` finds. */
async function chipOf(rig: Rig, chatId: string, which: (c: Chip) => boolean): Promise<Chip> {
  const found = (await rig.rt.view(chatId, rig.host.userId)).chips.filter(which);
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} chips found`);
  return one;
}

async function answer(rig: Rig, chatId: string, chip: Chip, choice: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice }));
}

/** What the postings whose memo is `memo` moved, by account, in minor units. */
function posted(s: WorldState, memo: string): Record<string, number> {
  const out: Record<string, number> = {};
  const journal = s.packs.economy?.journal;
  for (const account of Object.keys(isRecord(journal) ? journal : {})) for (const j of journalOf(s, account)) if (j.memo === memo) out[account] = (out[account] ?? 0) + j.cents;
  return out;
}

/** Things (by id) the predicate keeps. */
function things(s: WorldState, keep: (e: WorldState["entities"][string]) => boolean): string[] {
  return Object.keys(s.entities).filter((id) => {
    const e = s.entities[id];
    return e !== undefined && keep(e);
  });
}

describe("the reply's read", () => {
  test("the read is given the player's message beside the reply", async () => {
    const { rig, chatId } = await chat();
    const asked: QuietRequest[] = [];
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) asked.push(req);
      return "{}";
    };
    await rig.turn(chatId, "I ask Danny to toss me the spare keys.", "Danny tosses them over.");
    expect(asked.length).toBe(1);
    expect(asked[0]?.messages.slice(1).some((m) => m.content.includes("I ask Danny to toss me the spare keys."))).toBe(true);
  });

  test("a found quest item applied from its confirm chip advances the quest that same turn", async () => {
    const key: JsonObject = { id: "brass_key", kind: "item", name: "Brass key", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] };
    const quest: JsonObject = {
      id: "the_key",
      kind: "quest",
      label: "Get the key",
      start: "find",
      visibility: "public",
      stages: { find: { label: "Get the brass key", next: [{ to: "done", when: "carries(pov, 'brass_key')" }] }, done: { label: "Got it", next: [] } },
    };
    const { rig, chatId } = await chat([["entities", key], ["tracks", quest]]);
    // A handover lands on its own (ITEMS-SPEC §5.4); pinned to Confirm, it waits on its chip.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { item_hand: { mode: "confirm" } } } }));
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "give", item: "brass_key", from: "danny_okafor", to: "pov" }] }) : "{}");
    await rig.turn(chatId, "I ask Danny for the brass key.", "Danny hands you the brass key.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    if (!chip) throw new Error("no confirm chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" }));
    const after = await state(rig, chatId);
    expect(after.entities.brass_key?.relations).toContainEqual({ type: "in", to: "pov" });
    expect(after.tracks.the_key?.stage).toBe("done");
  });
});

/** The read answers with `proposals`, each turn alike. */
function read(rig: Rig, proposals: JsonObject[]): void {
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
}

/** Puts `entity` at `place`, as the GM's Move does. */
async function move(rig: Rig, chatId: string, entity: string, place: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity, to: place }] }));
}

const TRUCK_KEYS: JsonObject = { id: "danny_truck_keys", kind: "item", name: "Truck keys", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] };
const TOSSED = { type: "give", item: "danny_truck_keys", from: "danny_okafor", to: "pov", why: "Danny tosses Jordan his truck keys so he can move the truck" };

// ITEMS-SPEC §12 Phase 2: the read's thing facts, settled by the reconciler (§5.3) under their change types' modes (§5.4).
describe("the reply's thing facts", () => {
  test("R1: a refrigerator bought at Alder Market and delivered is Jordan's, at 114 Harbor Street, never on him", async () => {
    const { rig, chatId } = await chat();
    await move(rig, chatId, "pov", "alder_market");
    read(rig, [{ type: "purchase", item: "refrigerator", category: "home_furnishings", payer: "pov" }]);
    await rig.turn(chatId, "I buy a fridge and have it delivered.", "You buy a refrigerator at Alder Market; it's delivered Tuesday.");
    // A purchase asks first (§5.4, unchanged).
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "confirm" && c.label.startsWith("Bought refrigerator")), "confirm");
    const after = await state(rig, chatId);
    const fridges = things(after, (e) => e.fields.catalog === "refrigerator");
    expect(fridges.length).toBe(1);
    const fridge = after.entities[fridges[0] ?? ""];
    expect(fridge?.fields).toMatchObject({ place: "harbor_street_114", owner: "pov" });
    expect(fridge?.relations.some((r) => r.type === "in")).toBe(false);
  });

  test("R2: keys tossed over land in Jordan's hands, still Danny's, on a hold grant, with Undo and nothing to answer", async () => {
    const { rig, chatId } = await chat([["entities", TRUCK_KEYS]]);
    read(rig, [TOSSED]);
    await rig.turn(chatId, "I ask Danny for his keys.", "Danny tosses you his truck keys so you can move the truck.");
    const after = await state(rig, chatId);
    expect(after.entities.danny_truck_keys?.relations).toContainEqual({ type: "in", to: "pov" });
    expect(after.entities.danny_truck_keys?.fields).toMatchObject({ owner: "danny_okafor", got: { how: "holding", from: "danny_okafor" } });
    expect(after.entities.pov?.relations).toContainEqual({ type: "uses", to: "danny_truck_keys", fields: { basis: "hold", by: "danny_okafor" } });
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "confirm")).toBe(false);
    // A hold lands with its Undo, which hands the keys back and ends the grant.
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "undo" && c.label === "Danny Okafor gave Truck keys to you, to hold"), "undo");
    const undone = await state(rig, chatId);
    expect(undone.entities.danny_truck_keys?.relations).toContainEqual({ type: "in", to: "danny_okafor" });
    expect(undone.entities.pov?.relations.some((r) => r.type === "uses" && r.to === "danny_truck_keys")).toBe(false);
  });

  test("R3: \"keep the jacket\" asks before ownership changes, and Apply makes it yours", async () => {
    const jacket: JsonObject = { id: "danny_jacket", kind: "item", name: "Denim jacket", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "pov" }] };
    const { rig, chatId } = await chat([["entities", jacket]]);
    read(rig, [{ type: "owner", item: "danny_jacket", owner: "pov", why: "Danny says keep the jacket" }]);
    await rig.turn(chatId, "I hand Danny his jacket back.", "\"Keep the jacket,\" Danny says.");
    expect((await state(rig, chatId)).entities.danny_jacket?.fields.owner).toBe("danny_okafor");
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "confirm"), "confirm");
    expect((await state(rig, chatId)).entities.danny_jacket?.fields.owner).toBe("pov");
  });

  test("R4: Jordan's old guitar sold to Marcus for $200 is the same guitar, Marcus's and with him, the $200 posted, and no second guitar", async () => {
    const guitar: JsonObject = { id: "pov_guitar", kind: "item", name: "Old guitar", tier: "background", fields: { owner: "pov" }, relations: [{ type: "in", to: "pov" }] };
    const { rig, chatId } = await chat([["entities", guitar]]);
    await move(rig, chatId, "marcus_delgado", "harbor_street_114");
    read(rig, [{ type: "purchase", item: "old guitar", payer: "marcus_delgado", seller: "pov", price: 200 }]);
    await rig.turn(chatId, "I sell Marcus my old guitar.", "Marcus counts out $200 and takes your old guitar.");
    // A sale asks first, as any purchase does, at the price agreed: no till, so no sales tax.
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "confirm" && c.label === "Bought old guitar: $200.00"), "confirm");
    const after = await state(rig, chatId);
    expect(after.entities.pov_guitar?.relations).toContainEqual({ type: "in", to: "marcus_delgado" });
    expect(after.entities.pov_guitar?.fields).toMatchObject({ owner: "marcus_delgado", got: { how: "bought" } });
    expect(things(after, (e) => /guitar/i.test(e.name))).toEqual(["pov_guitar"]);
    // The $200 is posted from Marcus to Jordan, one posting with the guitar.
    expect(posted(after, "Bought Old guitar")).toEqual({ acct_marcus_checking: -20000, acct_pov_checking: 20000 });
  });

  test("R5: milk put in a fridge the world lacks makes the fridge at 114 Harbor Street, presumed Helen's, Jordan's to use as a housemate, the milk in it", async () => {
    const { rig, chatId } = await chat();
    read(rig, [{ type: "put", entity: "pov", item: "the milk", into: "the fridge", why: "Jordan puts the milk in the fridge" }]);
    await rig.turn(chatId, "I put the milk away.", "You put the milk in the fridge.");
    // A new thing bigger than Armful asks first (§5.4).
    expect(things(await state(rig, chatId), (e) => e.fields.catalog === "refrigerator")).toEqual([]);
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "confirm" && c.label === "You put the milk in the fridge"), "confirm");
    const { state: after, ctx } = await scene(rig, chatId);
    const [fridge = "", ...more] = things(after, (e) => e.fields.catalog === "refrigerator");
    expect(more).toEqual([]);
    expect(after.entities[fridge]?.fields.place).toBe("harbor_street_114");
    expect(hasOwn(after.entities[fridge]?.fields ?? {}, "owner")).toBe(false);
    expect(sizeOf(ctx, fridge).size).toBe("furniture");
    expect(whoseOf(ctx, fridge)).toEqual({ owners: ["helen_kowalczyk"], presumed: "property" });
    expect(accessFor(ctx, "pov", fridge).use).toEqual({ basis: "housemate", via: "helen_kowalczyk", presumed: true });
    expect(things(after, (e) => e.relations.some((r) => r.type === "in" && r.to === fridge)).map((id) => after.entities[id]?.name)).toEqual(["Milk"]);
  });

  test("R6: checking the phone left at home brings it along, with a Brought along receipt and Undo", async () => {
    const { rig, chatId } = await chat();
    // Jordan is at the shop; the phone is at home.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "alder_automotive" }, { op: "move", entity: "pov_phone", to: "harbor_street_114" }] }));
    read(rig, [{ type: "has", entity: "pov", item: "phone", why: "Jordan checks his phone" }]);
    await rig.turn(chatId, "I check my messages.", "You thumb through your phone between jobs.");
    expect((await state(rig, chatId)).entities.pov_phone?.relations).toContainEqual({ type: "in", to: "pov" });
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.label.startsWith("Brought along"));
    expect(chip).toMatchObject({ kind: "undo", label: "Brought along: phone (it was at 114 Harbor Street)" });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "undo" }));
    const undone = await state(rig, chatId);
    expect(undone.entities.pov_phone?.fields.place).toBe("harbor_street_114");
    expect(undone.entities.pov_phone?.relations.some((r) => r.type === "in")).toBe(false);
  });

  test("R9: Marcus carries two wallets and hands Jordan \"the wallet\": Which one?, and the pick is the one handed over", async () => {
    const wallet = (id: string): JsonObject => ({ id, kind: "item", name: "Wallet", tier: "background", fields: { owner: "marcus_delgado" }, relations: [{ type: "in", to: "marcus_delgado" }] });
    const { rig, chatId } = await chat([["entities", wallet("marcus_wallet_a")], ["entities", wallet("marcus_wallet_b")]]);
    await move(rig, chatId, "marcus_delgado", "harbor_street_114");
    read(rig, [{ type: "give", item: "the wallet", from: "marcus_delgado", to: "pov", why: "Marcus hands Jordan the wallet" }]);
    await rig.turn(chatId, "I ask Marcus for the wallet.", "Marcus hands you the wallet.");
    const chip = await chipOf(rig, chatId, (c) => c.kind === "confirm" && c.label.startsWith("Which one?"));
    expect(chip.actions.map((a) => [a.id, a.label])).toEqual([
      ["pick:0", "Wallet (1) (Marcus Delgado's)"],
      ["pick:1", "Wallet (2) (Marcus Delgado's)"],
      ["reject", "No"],
    ]);
    const held = (s: WorldState, by: string): string[] => ["marcus_wallet_a", "marcus_wallet_b"].filter((id) => s.entities[id]?.relations.some((r) => r.type === "in" && r.to === by));
    // Nothing moves till the player picks.
    expect(held(await state(rig, chatId), "marcus_delgado")).toHaveLength(2);
    await answer(rig, chatId, chip, "pick:1");
    const after = await state(rig, chatId);
    expect(held(after, "pov")).toHaveLength(1);
    expect(held(after, "marcus_delgado")).toHaveLength(1);
  });

  test("a move lands with its Undo: a mug picked up goes back where it lay", async () => {
    const mug: JsonObject = { id: "kitchen_mug", kind: "item", name: "Coffee mug", tier: "background", fields: { place: "harbor_street_114" }, relations: [] };
    const { rig, chatId } = await chat([["entities", mug]]);
    read(rig, [{ type: "take", entity: "pov", item: "the coffee mug", why: "Jordan picks up his mug" }]);
    await rig.turn(chatId, "I grab my mug.", "You pick up the coffee mug.");
    expect((await state(rig, chatId)).entities.kitchen_mug?.relations).toContainEqual({ type: "in", to: "pov" });
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "undo" && c.label === "You picked up the coffee mug"), "undo");
    const undone = (await state(rig, chatId)).entities.kitchen_mug;
    expect(undone?.fields.place).toBe("harbor_street_114");
    expect(undone?.relations.some((r) => r.type === "in")).toBe(false);
  });

  test("a reply makes at most the user's Things made from a reply: one more is a Not tracked receipt", async () => {
    const { rig, chatId } = await chat();
    // Pinned, a new thing lands on its own however much it costs, so only the cap holds one back.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { thingReads: { madeMax: 1 }, extraction: { item_make: { mode: "auto" } } } }));
    read(rig, [
      { type: "has", entity: "pov", item: "a harmonica", why: "Jordan plays a harmonica" },
      { type: "has", entity: "pov", item: "a kazoo", why: "then a kazoo" },
    ]);
    await rig.turn(chatId, "I play some music.", "You play a harmonica, then a kazoo.");
    const after = await state(rig, chatId);
    expect(things(after, (e) => /harmonica|kazoo/i.test(e.name)).map((id) => [after.entities[id]?.name, after.entities[id]?.relations])).toEqual([["Harmonica", [{ type: "in", to: "pov" }]]]);
    const receipt = await chipOf(rig, chatId, (c) => c.kind === "untracked");
    expect(receipt.label).toBe("Not tracked: You have a kazoo now");
    expect(receipt.detail).toContain("as many things as one reply may (Settings → Changes from the reply)");
  });

  test("a thing fact naming someone the player character doesn't know is a Not tracked receipt, unless its change type is Never", async () => {
    const { rig, chatId } = await chat();
    read(rig, [
      { type: "give", item: "a wallet", from: "vex_morrow", to: "pov", why: "a stranger hands Jordan a wallet" },
      { type: "take", entity: "vex_morrow", item: "the crowbar", why: "the stranger picks up a crowbar" },
    ]);
    const receipts = async (): Promise<string[]> => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "untracked").map((c) => c.label);
    await rig.turn(chatId, "I look around.", "A stranger hands you a wallet, then picks up a crowbar.");
    expect(await receipts()).toEqual(["Not tracked: Someone you don't know gave a wallet to you", "Not tracked: Someone you don't know picked up the crowbar"]);
    // Moves set to Never: the take tells nothing, the handover still does.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { item_move: { mode: "never" } } } }));
    await rig.turn(chatId, "I look around again.", "The stranger does it all again.");
    expect(await receipts()).toEqual(["Not tracked: Someone you don't know gave a wallet to you"]);
  });
});

// ITEMS-SPEC §5.4: the old thing-fact types' pins and learning carry over, once, to the change types they became.
describe("the old pins", () => {
  test("each carries over once: two that differ ask, a change type's own pin wins, and the old names are gone", async () => {
    const host = new FakeHost();
    const old = { take: { mode: "never" }, drop: { mode: "confirm" }, use_up: { mode: "never", maxDelta: 3 }, lose: { mode: "auto" }, wear: { mode: "confirm" }, item_wear: { mode: "never" } };
    await host.storage.write("settings.json", JSON.stringify({ v: 1, extraction: old }), host.userId);
    await host.storage.write("extraction-learning.json", JSON.stringify({ v: 1, connections: { c: { take: { accepted: 3, rejected: 1, recent: "aaar", learned: "auto" }, drop: { accepted: 2, rejected: 0, recent: "aa", learned: "auto" }, give: { accepted: 1, rejected: 2, recent: "arr" } } } }), host.userId);
    const store = new SettingsStore(host);
    const pins = (await store.get(host.userId)).extraction;
    expect(pins).toMatchObject({ item_move: { mode: "confirm" }, item_use: { mode: "never", maxDelta: 3 }, item_lose: { mode: "auto" }, item_wear: { mode: "never" } });
    expect(hasOwn(pins, "item_hand")).toBe(false);
    for (const name of Object.keys(old).filter((k) => !k.startsWith("item_"))) expect(hasOwn(pins, name)).toBe(false);
    // Learning windows join: the counts summed, the windows in turn, a learned mode only when they agree.
    const learning = (await store.learningOf(host.userId)).connections.c;
    expect(learning?.item_move).toEqual({ accepted: 5, rejected: 1, recent: "aaaraa", learned: "auto" });
    expect(learning?.item_hand).toEqual({ accepted: 1, rejected: 2, recent: "arr" });
  });

  test("a give pinned to Confirm before the change types makes a handover ask", async () => {
    const host = new FakeHost();
    // Saved before the change types, with minds off and new chats on classic, as the rig's own file keeps a test chat (INC3 3a).
    await host.storage.write("settings.json", JSON.stringify({ v: 1, minds: { enabled: false }, agents: { newChats: "classic" }, extraction: { give: { mode: "confirm" } } }), host.userId);
    const { rig, chatId } = await chat([["entities", TRUCK_KEYS]], host);
    expect((rig.body(await rig.send({ type: "lre.settings.get" })).extraction as JsonObject).item_hand).toMatchObject({ mode: "confirm", source: "pinned" });
    read(rig, [TOSSED]);
    await rig.turn(chatId, "I ask Danny for his keys.", "Danny tosses you his truck keys so you can move the truck.");
    expect((await state(rig, chatId)).entities.danny_truck_keys?.relations).toContainEqual({ type: "in", to: "danny_okafor" });
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.kind === "confirm"), "confirm");
    expect((await state(rig, chatId)).entities.danny_truck_keys?.relations).toContainEqual({ type: "in", to: "pov" });
  });
});
