// ✎ on the player's own things (ITEMS-SPEC §10.3; `lre.fix` with `thing`, the engine's `fix_item`)
// on Port Alder through the backend: Where is it? moves a thing of theirs to a place they know, with
// a Corrected chip whose Undo puts it back, and Size sets how big it is; someone else's thing, a
// place they can't know of and another person as the holder are refused, and nothing is written.
// Belongings' fixes (DESIGN §28.8): whose it is, who may use it and its name; a list of changes
// (`things`) is one entry with one Undo named by its label, all or none; and Play's Add makes a
// thing theirs, by type, by what it is or a vehicle's class, as the chat's claims policy allows.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { FIX_THINGS_MAX } from "../../src/shared/protocol";
import type { ThingType } from "../../src/shared/thing-view";
import type { VehicleClassChoice } from "../../src/shared/vehicles";
import { Rig } from "../support/rig";

/** A Port Alder chat after one turn, with a television of Jordan's standing at Alder Market. */
async function chat(): Promise<{ rig: Rig; chatId: string; tv: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "The kitchen is quiet.");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "item", change: { do: "make", name: "Television", size: "heavy", at: { place: "alder_market" }, owner: "pov", why: "Bought at the market" } }] }));
  const tv = Object.entries((await head(rig, chatId)).entities).find(([, e]) => e.name === "Television")?.[0];
  if (!tv) throw new Error("no television");
  return { rig, chatId, tv };
}

async function head(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  if (!render) throw new Error("no state");
  return render.state;
}

async function refused(rig: Rig, chatId: string, thing: Record<string, unknown>): Promise<string> {
  const reply = await rig.send({ type: "lre.fix", chatId, thing });
  if (reply.type !== "lre.error") throw new Error(`${JSON.stringify(thing)} was accepted`);
  return reply.message;
}

describe("✎ on your own things", () => {
  test("Where is it? moves your own television home, with a Corrected chip whose Undo puts it back", async () => {
    const { rig, chatId, tv } = await chat();
    const body = rig.body(await rig.send({ type: "lre.fix", chatId, thing: { do: "move", item: tv, to: { place: "harbor_street_114" } } }));
    expect(body.pending).toBe(false);
    expect(typeof body.undo).toBe("string");
    expect(placeOfEntity(await head(rig, chatId), tv)).toBe("harbor_street_114");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.id === body.undo);
    expect(chip?.label).toBe("Corrected");
    expect(chip?.actions.map((a) => a.label)).toContain("Undo");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: String(body.undo), choice: "undo" }));
    expect(placeOfEntity(await head(rig, chatId), tv)).toBe("alder_market");
  });

  test("Size sets how big your own thing is", async () => {
    const { rig, chatId, tv } = await chat();
    rig.body(await rig.send({ type: "lre.fix", chatId, thing: { do: "size", item: tv, size: "furniture" } }));
    expect((await head(rig, chatId)).entities[tv]?.fields.size).toBe("furniture");
  });

  test("someone else's thing, a place you can't know of and another person as the holder are refused, and nothing is written", async () => {
    const { rig, chatId, tv } = await chat();
    const before = JSON.stringify(await head(rig, chatId));
    expect(await refused(rig, chatId, { do: "move", item: "spare_relay", to: { place: "harbor_street_114" } })).not.toBe("");
    expect(await refused(rig, chatId, { do: "move", item: tv, to: { place: "birch_lane_12" } })).not.toBe("");
    expect(await refused(rig, chatId, { do: "move", item: "pov_pocketknife", to: { in: "danny_okafor" } })).not.toBe("");
    expect(JSON.stringify(await head(rig, chatId))).toBe(before);
  });
});

describe("Belongings' fixes: whose it is, who may use it, its name, and a list of them at once", () => {
  /** A fix applied, its answer's body. */
  const fix = async (rig: Rig, chatId: string, thing: Record<string, unknown>): Promise<Record<string, unknown>> => rig.body(await rig.send({ type: "lre.fix", chatId, thing }));
  const mayUse = (state: WorldState, who: string, item: string): boolean => state.entities[who]?.relations.some((r) => r.type === "uses" && r.to === item) === true;

  test("his watch made nobody's and his again, the toolbox lent to Danny till tomorrow and taken back, and the TV renamed", async () => {
    const { rig, chatId, tv } = await chat();
    await fix(rig, chatId, { do: "own", item: "pov_watch", owner: null });
    expect((await head(rig, chatId)).entities.pov_watch?.fields.owner).toBeNull();
    await fix(rig, chatId, { do: "own", item: "pov_watch", owner: "self" });
    expect((await head(rig, chatId)).entities.pov_watch?.fields.owner).toBe("pov");
    const until = (await head(rig, chatId)).clock + 1440;
    const lent = await fix(rig, chatId, { do: "grant", item: "pov_toolbox", who: "danny_okafor", until });
    expect((await head(rig, chatId)).entities.danny_okafor?.relations).toContainEqual({ type: "uses", to: "pov_toolbox", fields: { basis: "loan", by: "pov" }, until });
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.id === lent.undo)?.label).toBe("Corrected");
    await fix(rig, chatId, { do: "revoke", item: "pov_toolbox", who: "danny_okafor" });
    expect(mayUse(await head(rig, chatId), "danny_okafor", "pov_toolbox")).toBe(false);
    await fix(rig, chatId, { do: "label", item: tv, name: "Old TV" });
    expect((await head(rig, chatId)).entities[tv]?.name).toBe("Old TV");
  });

  test("refused, with nothing written: a household he isn't in, a grant to himself or ending before now, taking back leave nobody has, and someone else's thing", async () => {
    const { rig, chatId } = await chat();
    const before = JSON.stringify(await head(rig, chatId));
    const clock = (await head(rig, chatId)).clock;
    expect(await refused(rig, chatId, { do: "own", item: "pov_watch", owner: "household" })).toBe("You aren't in a household");
    expect(await refused(rig, chatId, { do: "grant", item: "pov_toolbox", who: "pov" })).toBe("no such person");
    expect(await refused(rig, chatId, { do: "grant", item: "pov_toolbox", who: "danny_okafor", until: clock })).toBe("an end is after now");
    expect(await refused(rig, chatId, { do: "revoke", item: "pov_toolbox", who: "danny_okafor" })).toBe("Danny Okafor has no leave to use it");
    expect(await refused(rig, chatId, { do: "label", item: "spare_relay", name: "My relay" })).toBe("Spare relay isn't yours to change");
    expect(JSON.stringify(await head(rig, chatId))).toBe(before);
  });

  test("a list of changes is one entry with one Undo, named by its label, told only as its group says; one refused refuses them all", async () => {
    const { rig, chatId, tv } = await chat();
    const before = JSON.stringify(await head(rig, chatId));
    const things = [
      { do: "label", item: "pov_watch", name: "Grandpa's watch" },
      { do: "move", item: tv, to: { place: "harbor_street_114" } },
      { do: "grant", item: "pov_toolbox", who: "danny_okafor" },
    ];
    const body = rig.body(await rig.send({ type: "lre.fix", chatId, label: "Sorted my things", things }));
    const state = await head(rig, chatId);
    expect([state.entities.pov_watch?.name, placeOfEntity(state, tv), mayUse(state, "danny_okafor", "pov_toolbox")]).toEqual(["Grandpa's watch", "harbor_street_114", true]);
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.id === body.undo);
    expect(chip?.label).toBe("Sorted my things");
    expect(chip?.detail).toContain("Wristwatch is now called Grandpa's watch");
    // Nothing in it hands a thing to anyone: it is a Things change, not told unless asked.
    expect(chip?.actions.map((a) => a.id)).toEqual(["tell", "undo"]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: String(body.undo), choice: "undo" }));
    expect(JSON.stringify(await head(rig, chatId))).toBe(before);
    // One refused (the relay is Marcus's), none is made.
    const mixed = await rig.send({ type: "lre.fix", chatId, label: "Mixed", things: [things[0], { do: "move", item: "spare_relay", to: { place: "harbor_street_114" } }] });
    expect(mixed).toMatchObject({ type: "lre.error", code: "validation" });
    expect(JSON.stringify(await head(rig, chatId))).toBe(before);
    // Without a label, with none, or with more than one entry takes, it is no request.
    for (const bad of [{ things }, { label: "None", things: [] }, { label: "Too many", things: Array.from({ length: FIX_THINGS_MAX + 1 }, () => things[0]) }, { label: "Odd", things: [{ do: "polish", item: tv }] }]) {
      expect(await rig.send({ type: "lre.fix", chatId, ...bad })).toMatchObject({ type: "lre.error", code: "bad_request", message: `1 to ${FIX_THINGS_MAX} changes to things, with a label` });
    }
  });
});

describe("Play's Add (DESIGN §28.16)", () => {
  test("a thing made his where he can see, by type, by what it is, or a vehicle by its class, from what Add offers; under Hold me to the world, refused", async () => {
    const { rig, chatId } = await chat();
    const offered = rig.body(await rig.send({ type: "lre.things", scope: "play", chatId, op: "types" }));
    const types = offered.types as ThingType[];
    expect(types.find((t) => t.id === "mug_ceramic")).toMatchObject({ table: "gear.items", categoryId: "household", priceCents: expect.any(Number) });
    expect(types.find((t) => t.id === "first_aid_kit")).toMatchObject({ table: "gear.kits", name: "First-aid kit, household", categoryId: null });
    expect((offered.classes as VehicleClassChoice[]).map((c) => c.id)).toContain("compact_car");
    // Simulation asks before it adds anything: no cap to ask over.
    expect(offered.cap).toBeUndefined();
    for (const thing of [
      { do: "make", name: "Coffee mug", type: "mug_ceramic", at: { place: "harbor_street_114" } },
      { do: "make", name: "Shoebox", is: "container", at: { place: "harbor_street_114" } },
      { do: "make", name: "Beater", class: "compact_car", details: { make: "Ford", model: "Focus", year: 2009 }, at: { place: "harbor_street_114" } },
    ])
      rig.body(await rig.send({ type: "lre.fix", chatId, thing }));
    const state = await head(rig, chatId);
    const named = (name: string) => Object.values(state.entities).find((e) => e.name === name);
    expect(named("Coffee mug")).toMatchObject({ kind: "item", fields: { catalog: "mug_ceramic", owner: "pov", place: "harbor_street_114", made: { by: "player" } } });
    expect(named("Shoebox")).toMatchObject({ kind: "container", fields: { holds: "hand", owner: "pov" } });
    expect(named("Beater")).toMatchObject({ kind: "vehicle", fields: { class: "compact_car", owner: "pov", make: "Ford", model: "Focus", year: 2009, place: "harbor_street_114" } });
    expect(await refused(rig, chatId, { do: "make", name: "Mug", at: { place: "birch_lane_12" } })).toBe("no such place");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "claims", to: { mode: "hold", capped: false } }));
    expect(await refused(rig, chatId, { do: "make", name: "Mug", at: { place: "harbor_street_114" } })).toBe("This chat holds you to the world: nothing is added that the story hasn't brought in.");
  });
});
