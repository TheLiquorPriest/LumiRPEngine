// GM → the page by part (`frontend/gm/parts.ts`): each tab reads its own parts of the GM view, the
// edits with every tab's, and Live, the Assistant and the Workspace nothing else; a pack's tab that
// names none reads every part. When the chat moves on, only the open tab's parts are asked again,
// each with the key it holds, and one the move left as it was comes back `same`, the view the very
// one it was; another tab's wait, stale, until it opens. While a turn runs, a page that holds keeps
// its parts. A tab's view lists the roster slim but for the entities a page needs, read by id.

import { describe, expect, test } from "bun:test";
import { GM_TAB_PARTS, GmParts, gmReload, partsOf, thinEntity, type GmEngineTab, type GmPartRead } from "../../src/frontend/gm/parts";
import { UI_PACKS } from "../../src/frontend/packs";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { GM_PARTS, GM_ROSTER, type GmPartReply } from "../../src/shared/gm-parts";
import type { GmView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

/** A Port Alder chat after one turn, and a cache of its GM view's parts that keeps every request it sends. */
async function portAlder(): Promise<{ rig: Rig; chatId: string; parts: GmParts; asked: Record<string, unknown>[] }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  const asked: Record<string, unknown>[] = [];
  const read: GmPartRead = async (request) => {
    asked.push(request);
    const reply = await rig.send(request);
    return reply.type === "lre.result" ? (reply.body as unknown as GmPartReply) : null;
  };
  return { rig, chatId, parts: new GmParts(chatId, read), asked };
}

const world = { parts: partsOf("world", undefined) };
const story = { parts: partsOf("story", undefined) };

describe("each GM tab's parts", () => {
  test("every engine tab is listed with the edits; Live, the Assistant and the Workspace read only them; a pack's tab naming none reads every part", () => {
    expect(Object.keys(GM_TAB_PARTS).sort()).toEqual(["chat", "places", "story", "things", "world"]);
    for (const tab of Object.keys(GM_TAB_PARTS) as GmEngineTab[]) {
      const parts = partsOf(tab, undefined);
      expect(parts).toContain("edits");
      for (const part of parts) expect([...GM_PARTS, GM_ROSTER]).toContain(part);
    }
    const catalog = buildCatalog(UI_PACKS);
    const def = (id: string) => catalog.gmSections.find((d) => d.id === id);
    expect(def("core.live")?.parts).toEqual([]);
    for (const id of ["core.live", "core.assistant", "core.workspace"]) expect(partsOf(id as `${string}.${string}`, def(id))).toEqual(["edits"]);
    expect(partsOf("minds.gm", def("minds.gm"))).toEqual(["minds", GM_ROSTER, "places", "edits"]);
    // Orgs, Money and Routines read entities' fields, relations and levels: the whole view.
    for (const id of ["orgs.orgs", "economy.money", "castlife.routines"]) {
      expect(def(id)?.parts).toBeUndefined();
      expect(partsOf(id as `${string}.${string}`, def(id))).toEqual(GM_PARTS);
    }
    // A tab no pack registers shows World, and reads World's parts.
    expect(partsOf("gone.tab", undefined)).toEqual([...GM_TAB_PARTS.world, "edits"]);
  });

  test("a running turn holds the page's parts only when it holds; a chat that moved on loads them, one that didn't nothing", () => {
    expect(gmReload(null, "k1", "in_flight", "hold")).toBe("load");
    expect(gmReload("k1", "k1", "idle", "hold")).toBe("none");
    expect(gmReload("k1", "k1", "in_flight", "live")).toBe("none");
    expect(gmReload("k1", "k2", "in_flight", "hold")).toBe("hold");
    expect(gmReload("k1", "k2", "in_flight", "live")).toBe("load");
    expect(gmReload("k1", "k2", "idle", "hold")).toBe("load");
    expect(gmReload("k1", "k2", "paused", "hold")).toBe("load");
  });
});

describe("GmParts", () => {
  test("once the chat moves on, World asks only its parts and the edits again, each with its key; Story's waits until Story opens", async () => {
    const { rig, chatId, parts, asked } = await portAlder();
    await parts.load(world);
    expect(asked.map((a) => a.part).sort()).toEqual([...world.parts].sort());
    expect(asked.every((a) => a.since === undefined)).toBe(true);
    // Story reads only what isn't kept: its tracks.
    await parts.load(story);
    expect(asked.slice(world.parts.length).map((a) => a.part)).toEqual(["tracks"]);
    const view = parts.view(world);
    const key = parts.key;
    expect(view).not.toBeNull();
    // Moved on with nothing changed: World's parts asked with their key, each answered same, the view the one it was.
    asked.length = 0;
    parts.moved();
    expect(parts.staleIn(world)).toBe(true);
    await parts.load(world);
    expect(asked.map((a) => a.part).sort()).toEqual([...world.parts].sort());
    expect(asked.every((a) => a.since === key)).toBe(true);
    expect(parts.staleIn(world)).toBe(false);
    expect(parts.key).toBe(key);
    expect(parts.view(world)).toBe(view);
    // An edit: World's parts are built again at a new key; Story's tracks wait, and a held page doesn't ask for them.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "danny_okafor", field: "notes", value: "Moved." }] }));
    asked.length = 0;
    parts.moved();
    await parts.load(world);
    expect(asked.map((a) => a.part).sort()).toEqual([...world.parts].sort());
    expect(parts.key).not.toBe(key);
    expect(parts.view(world)).not.toBe(view);
    expect(parts.view(world)?.edits.length).toBe((view?.edits.length ?? 0) + 1);
    asked.length = 0;
    await parts.load(story, { stale: false });
    expect(asked).toEqual([]);
    expect(parts.staleIn(story)).toBe(true);
    await parts.load(story);
    expect(asked).toEqual([{ type: "lre.gm.part", chatId, part: "tracks", since: key }]);
    expect(parts.staleIn(story)).toBe(false);
  }, 60_000);

  test("a tab's view lists the roster slim, the same view while nothing changed; a page's entity and money are read by id and laid over it", async () => {
    const { rig, chatId, parts, asked } = await portAlder();
    expect(parts.view(world)).toBeNull();
    await parts.load(world);
    const view = parts.view(world);
    if (!view) throw new Error("World's parts landed");
    expect(parts.view(world)).toBe(view);
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
    expect(view.entities.map((e) => e.id)).toEqual(whole.entities.map((e) => e.id));
    expect(view.entities.every(thinEntity)).toBe(true);
    expect(view.entities.map((e) => [e.name, e.kind, e.place, e.pov])).toEqual(whole.entities.map((e) => [e.name, e.kind, e.place, e.pov]));
    // Danny's sheet needs his entry and money: one read of each, by id.
    const danny = whole.entities.find((e) => e.id === "danny_okafor");
    if (!danny) throw new Error("Danny is in Port Alder");
    asked.length = 0;
    const sheet = { ...world, entities: [danny.id], money: [danny.id] };
    await parts.load(sheet);
    expect(asked).toEqual([
      { type: "lre.gm.part", chatId, part: "entities", ids: [danny.id] },
      { type: "lre.gm.part", chatId, part: "money", ids: [danny.id] },
    ]);
    const page = parts.view(sheet);
    const full = page?.entities.find((e) => e.id === danny.id);
    expect(full && thinEntity(full)).toBe(false);
    expect(full).toEqual(danny);
    expect(page?.money.find((m) => m.party === danny.id)).toEqual(whole.money.find((m) => m.party === danny.id));
    // Everyone else is the slim entry they were; the parts nothing changed are the very ones.
    expect(page?.entities.filter((e) => e.id !== danny.id)).toEqual(view.entities.filter((e) => e.id !== danny.id));
    expect(page?.entities.every((e, i) => e.id === danny.id || e === view.entities[i])).toBe(true);
    expect(page?.kinds).toBe(view.kinds);
    expect(parts.view(sheet)).toBe(page);
    // Asked again, nothing is sent.
    asked.length = 0;
    await parts.load(sheet);
    expect(asked).toEqual([]);
  }, 60_000);
});
