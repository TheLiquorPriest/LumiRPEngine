// "I buy this house" on Port Alder (DESIGN §27.9; ITEMS-SPEC §7.3). As an agent turn: Jordan stands
// in a cottage that is no property yet, and the Curator notes a purchase of its place (`property`)
// at the price the reply says, moving in (`live`). It lands with the reply's read: a property made of
// the place, valued at the price, Jordan its only owner; the price from his checking, with no sales
// tax on a house; his home the cottage from today, which his map marks as home with its property;
// the read's own purchase of it held for the Curator, so nothing is made of "the house". Read
// classic with no price, the purchase asks: Set price buys it at the price set, Apply makes it his
// with nothing charged and its chip prices it after. And GM → Money's Add a property at a place is
// the GM edit `economy.property_make` (`lre.edit`): a property of the place, for sale at its asking
// price, refused at a place that is one already or is no place. The models are scripted.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import type { PlaceDef } from "../../src/shared/world";
import { boughtLines, call, curatedTurn, curatorChat, resultsOf } from "../support/curator-chat";
import { stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";
import { alderChat } from "../support/tools";

const POV = "pov";
const CHECKING = "acct_pov_checking";
const COTTAGE = "lakeview_cottage";
/** The property a purchase makes of the cottage. */
const MADE = `property:${COTTAGE}`;
/** A cottage on the bluff, no property yet. */
const COTTAGE_PLACE: PlaceDef = { id: COTTAGE, name: "Lakeview Cottage", parent: "port_alder", timeZone: "America/New_York", sceneType: "downtime", fields: { description: "A two-bedroom cottage on the bluff, its porch facing the lake.", tags: ["home"] } };
const EXTRACT_MARK = "You read a narrator's roleplay reply";
const INTERPRET_MARK = "You map a player's typed input";
const SAID = "I buy this house.";
const REPLY = "The agent slides the deed across the kitchen table: one hundred eighty-five thousand, and the cottage is yours. You'll move in this weekend.";

/** Jordan in the cottage with $200,000 more in his checking. */
const settle = [
  { op: "move", entity: POV, to: COTTAGE },
  { op: "adjust", account: CHECKING, cents: 20_000_000 },
];

describe("I buy this house", () => {
  test("the Curator notes the purchase of the place: a property made of it at the price, Jordan's; no sales tax; his home from today, marked so on his map", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await curatorChat(rig, async (put) => put("places", COTTAGE, COTTAGE_PLACE as unknown as JsonObject));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: settle }));
    const played = await curatedTurn(rig, chatId, {
      said: SAID,
      reply: REPLY,
      // The read's own purchase of it, held for the Curator.
      read: [{ type: "purchase", payer: POV, item: "the house", category: "housing", price: 185000 }],
      curator: (_req, n) => (n === 0 ? { content: "", toolCalls: [call("purchase", { item: "Lakeview Cottage", category: "property", property: "Lakeview Cottage", price: 185000, live: true }, "p1")] } : JSON.stringify({ proposals: [] })),
    });
    expect(resultsOf(played.curator[1] as QuietRequest).join("\n")).toContain('"noted"');
    const { state, world } = await stateOf(rig, chatId);
    expect(state.entities[MADE]).toMatchObject({ kind: "property", name: "Lakeview Cottage" });
    expect(state.entities[MADE]?.fields).toMatchObject({ place: COTTAGE, value: 18_500_000, owners: [{ party: POV, role: "owner", share: 100 }], purchase_price: 18_500_000 });
    // The price and nothing more, from his checking: a house carries no sales tax.
    expect(boughtLines(state, POV)).toEqual([{ account: CHECKING, memo: "Bought Lakeview Cottage for $185,000.00", cents: 18_500_000 }]);
    // The read's "the house" didn't land beside it: no second purchase, nothing made of it.
    expect(Object.values(state.entities).some((e) => e.name === "the house")).toBe(false);
    // He lives there now: his map marks it home, with the property it is.
    expect(state.entities[POV]?.fields.home).toBe(COTTAGE);
    const marks = rig.rt.registry.context(world, state).query("economy.place_marks")(rig.rt.registry.context(world, state), POV);
    expect(marks.find((m) => m.place === COTTAGE)).toEqual({ place: COTTAGE, mark: "home", property: MADE });
    expect(marks.some((m) => m.place === "harbor_street_114")).toBe(false);
  });
});

describe("a house bought with no price, read classic", () => {
  /** Port Alder classic with the cottage, Jordan in it with $200,000 more, and one turn whose read says he bought the house, at no price. */
  async function unpriced(mode?: "auto"): Promise<{ rig: Rig; chatId: string }> {
    const { rig, chatId } = await alderChat({ put: { places: { [COTTAGE]: COTTAGE_PLACE as unknown as JsonObject } } });
    if (mode) rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode } } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: settle }));
    rig.host.quietReply = (req) => {
      const prompt = req.messages.map((m) => m.content).join("\n");
      if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "Lakeview Cottage", category: "property", property: COTTAGE }] });
      return "{}";
    };
    await rig.turn(chatId, SAID, "The agent slides the deed across the kitchen table, and the cottage is yours.");
    return { rig, chatId };
  }

  const chipOf = async (rig: Rig, chatId: string) => (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.label.startsWith("Bought Lakeview Cottage"));

  test("asks: Set price buys it at the price set, a property made of the place at that value", async () => {
    const { rig, chatId } = await unpriced();
    const chip = await chipOf(rig, chatId);
    expect(chip?.actions.map((a) => a.id)).toEqual(["price", "confirm", "reject"]);
    expect((await stateOf(rig, chatId)).state.entities[MADE]).toBeUndefined();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "price", payload: { cents: 17_000_000 } }));
    const { state } = await stateOf(rig, chatId);
    expect(state.entities[MADE]?.fields).toMatchObject({ place: COTTAGE, value: 17_000_000, owners: [{ party: POV, role: "owner", share: 100 }], purchase_price: 17_000_000 });
    expect(boughtLines(state, POV)).toEqual([{ account: CHECKING, memo: "Bought Lakeview Cottage for $170,000.00", cents: 17_000_000 }]);
  });

  test("landed by itself, it is his with nothing charged, and its chip prices it after: the price alone, no sales tax, the property worth it", async () => {
    const { rig, chatId } = await unpriced("auto");
    const before = await stateOf(rig, chatId);
    expect(before.state.entities[MADE]?.fields).toMatchObject({ place: COTTAGE, value: 0, owners: [{ party: POV, role: "owner", share: 100 }] });
    expect(boughtLines(before.state, POV)).toEqual([]);
    const chip = await chipOf(rig, chatId);
    expect(chip?.label).toBe("Bought Lakeview Cottage: no price");
    expect(chip?.actions.map((a) => a.id)).toContain("price");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "price", payload: { cents: 17_000_000 } }));
    const { state } = await stateOf(rig, chatId);
    // Paid as a house is bought, never as goods at a till: the price, with no sales tax on it.
    expect(boughtLines(state, POV)).toEqual([{ account: CHECKING, memo: "Bought Lakeview Cottage for $170,000.00", cents: 17_000_000 }]);
    expect(state.entities[MADE]?.fields).toMatchObject({ value: 17_000_000, purchase_price: 17_000_000, owners: [{ party: POV, role: "owner", share: 100 }] });
  });
});

describe("GM → Money's Add a property at a place", () => {
  test("is the GM edit economy.property_make: a property of the place, for sale at its asking price; refused at a place that is one already, or no place", async () => {
    const { rig, chatId } = await alderChat({ put: { places: { [COTTAGE]: COTTAGE_PLACE as unknown as JsonObject } } });
    const make = (args: JsonObject) => rig.send({ type: "lre.edit", chatId, ops: [{ op: "effect", effect: "economy.property_make", args }] });
    rig.body(await make({ place: COTTAGE, value: 18_000_000, asking_price: 19_500_000 }));
    const { state, world } = await stateOf(rig, chatId);
    expect(state.entities[MADE]).toMatchObject({ kind: "property", name: "Lakeview Cottage" });
    expect(state.entities[MADE]?.fields).toEqual({ place: COTTAGE, value: 18_000_000, asking_price: 19_500_000 });
    // Up for sale where Jordan can see it: his map marks it so.
    const ctx = rig.rt.registry.context(world, state);
    expect(ctx.query("economy.place_marks")(ctx, POV).find((m) => m.place === COTTAGE)).toEqual({ place: COTTAGE, mark: "for_sale", property: MADE });
    for (const [args, code] of [
      [{ place: COTTAGE }, "already_property"],
      [{ place: "harbor_street_114" }, "already_property"],
      [{ place: "no_such_place" }, "missing_place"],
    ] as const) {
      const reply = await make(args);
      expect(reply.type).toBe("lre.error");
      // The place alone, never its property's name: Play's place sheet offers this where the player may not know of the property.
      if (reply.type === "lre.error") expect(`${reply.code}: ${reply.message}`).toBe(code === "missing_place" ? "validation: no place no such place" : `validation: ${world.places[args.place]?.name} is a property already`);
    }
    // A purchase isn't a GM effect: Buy is a turn.
    const buy = await rig.send({ type: "lre.edit", chatId, ops: [{ op: "effect", effect: "economy.property_buy", args: { property: MADE } }] });
    expect(buy.type).toBe("lre.error");
  });
});
