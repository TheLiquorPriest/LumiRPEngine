// The items family's read tools on Port Alder (INC1-SPEC R3a): what Jordan wears, carries and owns,
// what someone with him has on them, where a thing is and whose it is, and how worn his pickup is,
// under each knowledge an agent reads with. A secret thing in his toolbox never reaches the player
// character's knowledge: the narrator reads it marked, and the GM with its visibility.

import { describe, expect, test } from "bun:test";
import { bandOf, fieldDef } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { alderChat, answerOf, callTool, HOME, KNOWLEDGE, POV, toolEnv } from "../support/tools";

const JORDAN = "Jordan Ellis";
const HIDDEN = `${JORDAN} doesn't know that, and you read the world as ${JORDAN} knows it.`;
const LEDGER = "Vex's ledger";
/** A secret thing in Jordan's toolbox at the shop: no one knows of it. */
const SECRET: Record<string, JsonObject> = {
  vex_ledger: { id: "vex_ledger", kind: "item", name: LEDGER, tier: "background", fields: {}, relations: [{ type: "in", to: "pov_toolbox" }], visibility: "secret" },
};
/** What Danny has on him at home, where Jordan wakes: a thermos in hand, and a duffel bag with a key in it. */
const DANNY_GEAR: Record<string, JsonObject> = {
  thermos: { id: "thermos", kind: "item", name: "Thermos", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] },
  duffel: { id: "duffel", kind: "container", name: "Duffel bag", tier: "background", fields: { owner: "danny_okafor", capacity_l: 40 }, relations: [{ type: "in", to: "danny_okafor" }] },
  brass_key: { id: "brass_key", kind: "item", name: "Brass key", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "duffel" }] },
};

interface Ref {
  id?: string;
  name: string;
  visibility?: string;
}
interface Field {
  field: string;
  label: string;
  value: unknown;
  band?: string;
}
interface Item extends Ref {
  slot?: string;
  condition?: Field;
  contents?: Item[];
}
interface Stored extends Item {
  at: Ref | null;
}
interface Inventory {
  person: Ref;
  worn: Item[];
  carried: Item[];
  elsewhere?: Stored[];
  lent?: unknown[];
  borrowed?: unknown[];
}
interface Holder {
  thing: Ref;
  in: Ref[];
  held?: true;
  place: Ref | null;
  owners: (Ref & { role: string; share: number })[];
  users: Ref[];
}
interface Condition {
  thing: Ref;
  fields: Field[];
}

/** Every thing of a list, and every thing inside each, depth first. */
const everything = (items: readonly Item[]): Item[] => items.flatMap((i) => [i, ...everything(i.contents ?? [])]);
/** What an inventory has in Jordan's toolbox. */
const inToolbox = (inv: Inventory): Item[] => inv.elsewhere?.find((i) => i.id === "pov_toolbox")?.contents ?? [];

describe("items_inventory", () => {
  test("Jordan wears his wallet, keys and phone, and owns his toolbox at Alder Automotive and his pickup at home, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const { state, registry, world } = await toolEnv(rig, chatId, "gm").reader.view();
    const condition = state.entities.pov_truck?.fields.condition;
    const band = bandOf(fieldDef(registry, world, "vehicle", "condition")?.bands, Number(condition))?.label;
    expect(band).toBeDefined();
    for (const knowledge of KNOWLEDGE) {
      const inv = await answerOf<Inventory>(rig, chatId, knowledge, "items_inventory", { person: JORDAN });
      expect(inv.person).toMatchObject({ id: POV, name: JORDAN });
      expect(inv.worn.map((i) => i.id)).toEqual(expect.arrayContaining(["pov_wallet", "pov_keys", "pov_phone"]));
      const wallet = inv.worn.find((i) => i.id === "pov_wallet");
      expect(wallet?.slot).toBe("pocket");
      // What the wallet holds is nested in it, his cash aside: that is money, not a thing he carries.
      expect(everything(wallet?.contents ?? []).map((i) => i.id)).toEqual(expect.arrayContaining(["pov_debit_card", "pov_id"]));
      expect(everything([...inv.worn, ...inv.carried]).map((i) => i.id)).not.toContain("acct_pov_cash");
      const toolbox = inv.elsewhere?.find((i) => i.id === "pov_toolbox");
      expect(toolbox?.at).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
      expect(toolbox?.contents?.map((i) => i.id)).toContain("pov_headlamp");
      const truck = inv.elsewhere?.find((i) => i.id === "pov_truck");
      expect(truck?.at).toMatchObject({ id: HOME });
      expect(truck?.condition).toMatchObject({ field: "condition", value: condition, band });
      // What his pickup holds is in it, not listed again on its own.
      expect(everything(truck?.contents ?? []).map((i) => i.id)).toEqual(expect.arrayContaining(["pov_truck_glovebox", "pov_flashlight"]));
      expect(inv.elsewhere?.map((i) => i.id)).not.toContain("pov_flashlight");
      expect(inv.lent).toEqual([]);
      expect(inv.borrowed).toEqual([]);
    }
  });

  test("a secret thing in Jordan's toolbox: never under his knowledge, marked for the narrator, with its visibility for the GM", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    const pov = await callTool(rig, chatId, "pov", "items_inventory", { person: JORDAN });
    expect(pov.error).toBeUndefined();
    expect(pov.text).not.toContain("Vex");
    expect(pov.text).not.toContain("vex_ledger");
    expect(inToolbox(JSON.parse(pov.text) as Inventory).map((i) => i.id)).toEqual(["pov_headlamp"]);
    const everyone = await answerOf<Inventory>(rig, chatId, "everyone", "items_inventory", { person: JORDAN });
    expect(inToolbox(everyone)).toContainEqual({ id: "vex_ledger", name: secretMarkText(LEDGER, [], "everyone", SECRET_MARK_WORDING) });
    const gm = await answerOf<Inventory>(rig, chatId, "gm", "items_inventory", { person: JORDAN });
    expect(inToolbox(gm)).toContainEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
  });

  test("someone with Jordan: what he sees on them, never what is in their bag; someone away is beyond his knowledge", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: DANNY_GEAR } });
    const pov = await answerOf<Inventory>(rig, chatId, "pov", "items_inventory", { person: "Danny Okafor" });
    expect(pov.person).toMatchObject({ id: "danny_okafor" });
    expect(pov.worn).toEqual([]);
    expect(pov.carried.map((i) => i.id)).toEqual(["duffel", "thermos"]);
    expect(pov.carried.find((i) => i.id === "duffel")?.contents).toBeUndefined();
    // What he owns elsewhere and his loans aren't Jordan's to see.
    expect(pov.elsewhere).toBeUndefined();
    expect(JSON.stringify(pov)).not.toContain("Brass key");
    for (const knowledge of ["everyone", "gm"] as const) {
      const inv = await answerOf<Inventory>(rig, chatId, knowledge, "items_inventory", { person: "Danny Okafor" });
      expect(inv.carried.find((i) => i.id === "duffel")?.contents?.map((i) => i.id)).toEqual(["brass_key"]);
      expect(inv.elsewhere).toEqual([]);
    }
    expect(await callTool(rig, chatId, "pov", "items_inventory", { person: "Marcus Delgado" })).toEqual({ text: HIDDEN, error: true });
    const marcus = await answerOf<Inventory>(rig, chatId, "gm", "items_inventory", { person: "Marcus Delgado" });
    expect(marcus.worn.map((i) => i.id)).toContain("shop_office_key");
    expect(marcus.elsewhere?.find((i) => i.id === "shop_tow_truck")?.at).toMatchObject({ id: "alder_automotive" });
  });
});

describe("items_holder", () => {
  test("Jordan's debit card is in his wallet, on him at home, and his, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      const held = await answerOf<Holder>(rig, chatId, knowledge, "items_holder", { thing: "pov_debit_card" });
      expect(held.thing).toMatchObject({ id: "pov_debit_card", name: "Debit card" });
      expect(held.in.map((h) => h.id)).toEqual(["pov_wallet", POV]);
      expect(held.held).toBeUndefined();
      expect(held.place).toMatchObject({ id: HOME });
      expect(held.owners).toEqual([{ id: POV, name: JORDAN, role: "owner", share: 100 }]);
      expect(held.users).toEqual([]);
    }
  });

  test("a secret thing is no such thing to Jordan; the narrator reads it marked, the GM with its visibility", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    expect(await callTool(rig, chatId, "pov", "items_holder", { thing: LEDGER })).toEqual({ text: `No such thing here: ${LEDGER}.`, error: true });
    const everyone = await answerOf<Holder>(rig, chatId, "everyone", "items_holder", { thing: LEDGER });
    expect(everyone.thing).toEqual({ id: "vex_ledger", name: secretMarkText(LEDGER, [], "everyone", SECRET_MARK_WORDING) });
    expect(everyone.in.map((h) => h.id)).toEqual(["pov_toolbox"]);
    expect(everyone.place).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
    expect(everyone.owners).toEqual([]);
    const gm = await answerOf<Holder>(rig, chatId, "gm", "items_holder", { thing: LEDGER });
    expect(gm.thing).toEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
    expect(gm.in.map((h) => h.id)).toEqual(["pov_toolbox"]);
  });
});

describe("items_condition", () => {
  test("Jordan's pickup: its condition with its band's word, its status, fuel and mileage, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const { state, registry, world } = await toolEnv(rig, chatId, "gm").reader.view();
    const truck = state.entities.pov_truck?.fields ?? {};
    const band = bandOf(fieldDef(registry, world, "vehicle", "condition")?.bands, Number(truck.condition))?.label;
    expect(band).toBeDefined();
    for (const knowledge of KNOWLEDGE) {
      const read = await answerOf<Condition>(rig, chatId, knowledge, "items_condition", { thing: "Your pickup" });
      expect(read.thing).toMatchObject({ id: "pov_truck" });
      const field = (id: string): Field | undefined => read.fields.find((f) => f.field === id);
      expect(field("condition")).toMatchObject({ label: "Condition", value: truck.condition, band });
      expect(field("status")?.value).toBe(truck.status);
      expect(field("fuel_pct")?.value).toBe(truck.fuel_pct);
      expect(field("odometer_mi")?.value).toBe(truck.odometer_mi);
      // Its home base is a place, named as the knowledge names it.
      expect(field("home")?.value).toMatchObject({ id: HOME });
      // Where it is and whose it is aren't its condition.
      expect(field("owner")).toBeUndefined();
      expect(field("place")).toBeUndefined();
    }
  });

  test("a secret thing's condition is no such thing to Jordan", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    expect(await callTool(rig, chatId, "pov", "items_condition", { thing: LEDGER })).toEqual({ text: `No such thing here: ${LEDGER}.`, error: true });
    expect((await answerOf<Condition>(rig, chatId, "gm", "items_condition", { thing: LEDGER })).thing).toEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
  });
});
