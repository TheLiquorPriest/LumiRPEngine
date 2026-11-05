// "I buy a car" as an agent turn on Port Alder (DESIGN §9.5; ITEMS-SPEC §7.3): the Curator looks the
// class up (`vehicles_classes`) and notes a purchase of a vehicle of it, which lands with the reply's
// read under the Purchases mode: a vehicle of that class, Jordan's, at his home, worth what he paid
// and as the reply describes it, never an item; his money charged its price and Michigan's 6% sales
// tax, once, the read's own purchase of it held for the Curator and not landed beside it. Bought on
// a loan, the down payment and the tax on the whole price are paid now, the rest a car loan the car
// secures. A vehicle the Curator makes (`item_make` with a class) asks first: it waits on the review
// card, and the GM's Apply makes it a vehicle of its class. The models are scripted.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { WorldState } from "../../src/engine/state";
import type { JsonObject } from "../../src/shared/json";
import type { ReviewCardView } from "../../src/shared/protocol";
import { boughtLines, call, curatedTurn, curatorChat, resultsOf } from "../support/curator-chat";
import type { QuietScript } from "../support/fake-host";
import { DANNY, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const POV = "pov";
const HOME = "harbor_street_114";
const CHECKING = "acct_pov_checking";
const SAID = "I buy the used silver Camry from the listing in the Gazette.";
const REPLY = "The seller drops the silver 2019 Camry off out front: twenty-one thousand five hundred, and it's yours.";
/** The read's own purchase of the car, a change of the Curator's types that it holds aside for it. */
const READ_PURCHASE: JsonObject = { type: "purchase", payer: "pov", item: "silver Camry", category: "vehicles", price: 21500 };
const DETAILS: JsonObject = { make: "Toyota", model: "Camry", year: 2019, colour: "silver" };

/** Port Alder on agents, purchases landing with the turn, and $30,000 more in Jordan's checking. */
async function carChat(rig: Rig): Promise<string> {
  const chatId = await curatorChat(rig);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: CHECKING, cents: 3_000_000 }] }));
  return chatId;
}

/** The Curator as its texts ask: it looks the class up, then notes the purchase of a vehicle of the class it found, with `extra`. */
function buysCar(extra: JsonObject = {}): (req: QuietRequest, n: number) => QuietScript {
  return (req, n) => {
    if (n === 0) return { content: "", toolCalls: [call("vehicles_classes", { search: "camry" }, "v1")] };
    if (n === 1) {
      const found = /"id":"(\w+)"/.exec(resultsOf(req).join("\n"))?.[1] ?? "";
      return { content: "", toolCalls: [call("purchase", { item: "silver Camry", category: "vehicles", class: found, price: 21500, details: DETAILS, ...extra }, "p1")] };
    }
    return JSON.stringify({ proposals: [] });
  };
}

/** The vehicles bought in play, by id. */
const boughtVehicles = (state: WorldState): string[] => Object.keys(state.entities).filter((id) => state.entities[id]?.kind === "vehicle" && (state.entities[id]?.fields.got as JsonObject | undefined)?.how === "bought");

describe("I buy a car", () => {
  test("the Curator finds the class and notes the purchase: one car of it, Jordan's, at his home, worth its price; charged once, with Michigan's sales tax", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await carChat(rig);
    const played = await curatedTurn(rig, chatId, { said: SAID, reply: REPLY, read: [READ_PURCHASE], curator: buysCar() });
    // Looked up, then noted, then closed: the class came from the read of the world's classes.
    expect(played.curator).toHaveLength(3);
    expect(resultsOf(played.curator[2] as QuietRequest).join("\n")).toContain('"noted"');
    const cars = boughtVehicles(played.state);
    expect(cars).toHaveLength(1);
    const car = played.state.entities[cars[0] ?? ""];
    expect(car?.fields).toMatchObject({ class: "midsize_sedan", owner: POV, place: HOME, value: 2_150_000, make: "Toyota", model: "Camry", year: 2019, colour: "silver" });
    // A vehicle, never an item by the reply's words: nothing else was made of it.
    expect(Object.values(played.state.entities).filter((e) => /camry/i.test(e.name)).map((e) => e.kind)).toEqual(["vehicle"]);
    // $21,500 and 6% on it, once: the read's own purchase, held for the Curator, didn't land beside it.
    expect(boughtLines(played.state, POV).map((b) => [b.account, b.cents])).toEqual([[CHECKING, 2_150_000 + 129_000]]);
  });

  test("on a loan: the down payment and the tax on the whole price now, the rest a car loan the car secures", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await carChat(rig);
    const played = await curatedTurn(rig, chatId, {
      said: SAID,
      reply: "Sam takes three thousand down and writes up the rest over sixty months at the credit union.",
      read: [READ_PURCHASE],
      curator: buysCar({ finance: { down: 3000, term: 60 } }),
    });
    const [car] = boughtVehicles(played.state);
    expect(car).toBeDefined();
    // $3,000 down and the tax on all $21,500, not on the $3,000.
    const [line] = boughtLines(played.state, POV);
    expect(line?.memo).toEndWith(", $3,000.00 down");
    expect(line?.cents).toBe(300_000 + 129_000);
    const loan = played.state.entities[`${car}:loan`];
    expect(loan?.fields).toMatchObject({ product: "loan", secured_by: car, term_months: 60 });
    expect(played.state.accounts[`${car}:loan`]).toBe(-1_850_000);
  });
});

describe("a vehicle the Curator makes", () => {
  test("asks first: it waits on the review card, and the GM's Apply makes it a vehicle of its class where the reply puts it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await curatorChat(rig);
    const make = call("item_make", { name: "Danny's old Civic", class: "compact_car", details: { make: "Honda", model: "Civic", year: 2009, colour: "blue" }, at: HOME, owner: DANNY, why: "Danny's old Civic is parked out front" }, "m1");
    const played = await curatedTurn(rig, chatId, {
      said: "I look out at the street.",
      reply: "Danny's old blue Civic is parked out front, one hubcap missing.",
      curator: (_req, n) => (n === 0 ? { content: "", toolCalls: [make] } : JSON.stringify({ proposals: [] })),
    });
    // Its tool said so: staged, asking first.
    const staged = JSON.parse(resultsOf(played.curator[1] as QuietRequest)[0] ?? "{}") as { staged?: { changeType: string; mode: string } };
    expect(staged.staged).toMatchObject({ changeType: "item_make", mode: "confirm" });
    expect(Object.values(played.state.entities).some((e) => e.name === "Danny's old Civic")).toBe(false);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect(cards.map((c) => c.items.map((i) => `${i.role}:${i.changeType}:${i.status}`))).toEqual([["curator:item_make:open"]]);
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: cards[0]?.turn }));
    const civic = Object.values((await stateOf(rig, chatId)).state.entities).find((e) => e.name === "Danny's old Civic");
    expect(civic?.kind).toBe("vehicle");
    expect(civic?.fields).toMatchObject({ class: "compact_car", owner: DANNY, place: HOME, make: "Honda", model: "Civic", year: 2009, colour: "blue" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
