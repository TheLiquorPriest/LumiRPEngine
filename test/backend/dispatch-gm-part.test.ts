// One part of the GM view, built alone (`lre.gm.part`): every part as the whole view holds it; with
// an id, of the entities, money or organizations only that one, by id or by name; a name two share
// refused with their ids; and no id on a part read whole. Its outline counts each part as the whole
// view holds it. The roster is the entities slim; ids and a kind pick some; a read naming the key it
// holds builds nothing while the chat is unchanged.

import { describe, expect, test } from "bun:test";
import { GM_OUTLINE, GM_PARTS, GM_ROSTER, gmRosterEntry } from "../../src/shared/gm-parts";
import type { GmEntity, GmRosterEntry } from "../../src/shared/state-view";
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

/** An answer as it was built: its key aside (`answered` reads it). */
const part = async (rig: Rig, chatId: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const { key: _key, ...built } = await answered(rig, chatId, fields);
  return built;
};

const answered = async (rig: Rig, chatId: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> => rig.body(await rig.send({ type: "lre.gm.part", chatId, ...fields }));

describe("lre.gm.part's roster, picks and keys", () => {
  test("the roster is the whole view's entities, slim, and stays small beside them", async () => {
    const { rig, chatId } = await portAlder();
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    const entities = (Array.isArray(whole.entities) ? whole.entities : []) as GmEntity[];
    const roster = await part(rig, chatId, { part: GM_ROSTER });
    expect(roster).toEqual({ part: GM_ROSTER, id: null, value: entities.map(gmRosterEntry) });
    const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");
    expect(bytes(roster.value) / entities.length).toBeLessThan(400);
    expect(bytes(roster.value)).toBeLessThan(bytes(entities) * 0.05);
  });

  test("ids pick those entities, in their order; a kind picks those of it; an org by id builds that one alone", async () => {
    const { rig, chatId } = await portAlder();
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    const entities = (Array.isArray(whole.entities) ? whole.entities : []) as GmEntity[];
    const [a, b] = entities.filter((e) => e.person);
    if (!a || !b) throw new Error("two people");
    expect((await part(rig, chatId, { part: "entities", ids: [b.id, "nobody_here", a.id] })).value).toEqual([b, a]);
    expect((await part(rig, chatId, { part: GM_ROSTER, ids: [a.id] })).value).toEqual([gmRosterEntry(a)]);
    const people = (await part(rig, chatId, { part: GM_ROSTER, kind: "person" })).value as GmRosterEntry[];
    expect(people.map((e) => e.id)).toEqual(entities.filter((e) => e.person).map((e) => e.id));
    const orgs = (Array.isArray(whole.orgs) ? whole.orgs : []) as { page: { id: string } }[];
    const shop = orgs.find((o) => o.page.id === "alder_automotive_co");
    expect((await part(rig, chatId, { part: "orgs", ids: ["alder_automotive_co"] })).value).toEqual([shop]);
    const refused = await rig.send({ type: "lre.gm.part", chatId, part: "kinds", ids: ["x"] });
    expect(refused.type === "lre.error" ? refused.message : null).toContain("take ids");
  });

  test("a read naming the key it holds is answered same while nothing changed, and the key moves with an edit", async () => {
    const { rig, chatId } = await portAlder();
    const first = await answered(rig, chatId, { part: "tiers" });
    expect(typeof first.key).toBe("string");
    expect(await answered(rig, chatId, { part: "tiers", since: first.key })).toEqual({ part: "tiers", id: null, key: first.key, same: true });
    expect((await answered(rig, chatId, { part: "tiers", since: "an older key" })).value).toEqual(first.value);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "danny_okafor", field: "notes", value: "Moved." }] }));
    const after = await answered(rig, chatId, { part: "tiers", since: first.key });
    expect(after.same).toBeUndefined();
    expect(after.key).not.toBe(first.key);
  });
});

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
    const expected = GM_PARTS.map((name) => ({ part: name as string, count: counted(name, whole[name]) }));
    // The roster, right after the entities it lists, counts as many.
    expected.splice(1, 0, { part: GM_ROSTER, count: counted("entities", whole.entities) });
    expect(outline).toEqual({ part: GM_OUTLINE, id: null, value: expected });
    expect(Array.isArray(outline.value) ? outline.value.filter((p) => isRecord(p) && typeof p.count === "number" && p.count > 0).length : 0).toBeGreaterThan(5);
    const keyed = await rig.send({ type: "lre.gm.part", chatId, part: GM_OUTLINE, id: "pov" });
    expect(keyed.type === "lre.error" ? keyed.message : null).toContain("the outline is read whole");
  });
});
