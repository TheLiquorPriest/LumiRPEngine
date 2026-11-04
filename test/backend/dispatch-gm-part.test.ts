// One part of the GM view, built alone (`lre.gm.part`): every part as the whole view holds it; with
// an id, of the entities, money or organizations only that one, by id or by name; a name two share
// refused with their ids; and no id on a part read whole. Its outline counts each part as the whole
// view holds it.

import { describe, expect, test } from "bun:test";
import { GM_OUTLINE, GM_PARTS } from "../../src/shared/gm-parts";
import { isRecord } from "../../src/shared/json";
import { Rig } from "../support/rig";

/** A Port Alder chat after one turn, with a second "Danny Okafor" in the world when `twin`. */
async function portAlder(twin = false): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  if (twin) {
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "entities", id: "danny_twin", value: { kind: "person", name: "Danny Okafor", tier: "background", fields: {}, relations: [] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  return { rig, chatId };
}

const part = async (rig: Rig, chatId: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> => rig.body(await rig.send({ type: "lre.gm.part", chatId, ...fields }));

describe("lre.gm.part", () => {
  test("each part, built alone, is the whole view's", async () => {
    const { rig, chatId } = await portAlder();
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    for (const name of GM_PARTS) {
      const one = await part(rig, chatId, { part: name });
      expect({ name, id: one.id, value: one.value }).toEqual({ name, id: null, value: whole[name] });
    }
    expect(whole.held).toEqual([]);
  });

  test("with an id, only that entity, party's money or organization, by id or by name", async () => {
    const { rig, chatId } = await portAlder();
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    const list = (key: string): Record<string, unknown>[] => (Array.isArray(whole[key]) ? whole[key].filter(isRecord) : []);
    const danny = list("money").find((m) => m.party === "danny_okafor");
    expect(danny).toBeDefined();
    expect(await part(rig, chatId, { part: "money", id: "danny_okafor" })).toEqual({ part: "money", id: "danny_okafor", value: [danny] });
    expect(await part(rig, chatId, { part: "money", id: "danny okafor" })).toEqual({ part: "money", id: "danny_okafor", value: [danny] });
    const pov = list("entities").find((e) => e.id === "pov");
    expect(await part(rig, chatId, { part: "entities", id: "pov" })).toEqual({ part: "entities", id: "pov", value: [pov] });
    const shop = list("orgs").find((o) => isRecord(o.page) && o.page.id === "alder_automotive_co");
    expect(shop).toBeDefined();
    expect(await part(rig, chatId, { part: "orgs", id: "Alder Automotive" })).toEqual({ part: "orgs", id: "alder_automotive_co", value: [shop] });
    // None so named: an empty list, not an error.
    expect(await part(rig, chatId, { part: "money", id: "nobody_here" })).toEqual({ part: "money", id: "nobody_here", value: [] });
  });

  test("a name two share is refused with their ids; an id on a part read whole, or an unknown part, is refused", async () => {
    const { rig, chatId } = await portAlder(true);
    const twice = await rig.send({ type: "lre.gm.part", chatId, part: "entities", id: "Danny Okafor" });
    expect(twice.type === "lre.error" ? twice.message : null).toContain("danny_okafor, danny_twin");
    expect(await part(rig, chatId, { part: "entities", id: "danny_twin" })).toMatchObject({ id: "danny_twin" });
    const keyed = await rig.send({ type: "lre.gm.part", chatId, part: "kinds", id: "person" });
    expect(keyed.type === "lre.error" ? keyed.message : null).toContain("only entities, money, orgs take an id");
    const unknown = await rig.send({ type: "lre.gm.part", chatId, part: "everything" });
    expect(unknown.type === "lre.error" ? unknown.message : null).toContain("part is one of");
  });

  test("the outline counts each part as the whole view holds it, and takes no id", async () => {
    const { rig, chatId } = await portAlder();
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    const counted = (name: string, v: unknown): number => (name === "minds" && isRecord(v) && Array.isArray(v.characters) ? v.characters.length : name === "encounter" ? (v === null ? 0 : 1) : Array.isArray(v) ? v.length : isRecord(v) ? Object.keys(v).length : -1);
    const outline = await part(rig, chatId, { part: GM_OUTLINE });
    expect(outline).toEqual({ part: GM_OUTLINE, id: null, value: GM_PARTS.map((name) => ({ part: name, count: counted(name, whole[name]) })) });
    expect(Array.isArray(outline.value) ? outline.value.filter((p) => isRecord(p) && typeof p.count === "number" && p.count > 0).length : 0).toBeGreaterThan(5);
    const keyed = await rig.send({ type: "lre.gm.part", chatId, part: GM_OUTLINE, id: "pov" });
    expect(keyed.type === "lre.error" ? keyed.message : null).toContain("the outline is read whole");
  });
});
