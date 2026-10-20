// Section placement in the engine's book (DESIGN §4.2, §6.4): a section whose Position is an outlet
// is stored outlet-only with its `outlet_name`, so it lands at `{{outlet::name}}` and nowhere else,
// where the engine run fills it; a chat-depth section is stored at its depth, which Lumiverse counts
// from the end. When a section's Position changes, its existing entry follows; a move in the host's
// editor stands until then, and a native entry an earlier build made keeps its place.

import { describe, expect, test } from "bun:test";
import { slotOfEntry } from "../../src/backend/book";
import { entryInput } from "../../src/backend/spindle-host";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const scene = (position: JsonObject): JsonObject => ({ id: "scene", label: "Scene", rank: 2, template: "{{lines}}", position });

async function placeScene(rig: Rig, worldId: string, position: JsonObject): Promise<void> {
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "sections", id: "scene", value: scene(position) }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
}

async function sceneEntry(rig: Rig, worldId: string): Promise<string> {
  const bookId = (await rig.rt.worlds.index(worldId, rig.host.userId))?.loreBookId ?? "";
  const id = (await rig.host.books.entries(bookId, rig.host.userId)).find((e) => slotOfEntry(e.extensions) === "scene")?.id;
  if (!id) throw new Error("no Scene entry");
  return id;
}

describe("a section's entry follows its Position", () => {
  test("an outlet section is stored outlet-only with its outlet name, which the host reads from the entry's extensions", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    await placeScene(rig, worldId, { type: "outlet", name: "my_scene" });
    const stored = rig.host.storedEntry(await sceneEntry(rig, worldId));
    expect(stored?.position).toBe(8);
    expect(stored?.outlet).toBe("my_scene");
    // As the host is asked to create one.
    const created = entryInput({ comment: "LRE · Scene", content: "", keys: [], disabled: true, constant: false, position: 8, depth: 4, role: "system", order: 102, extensions: { [LEDGER_NAMESPACE]: { slot: "scene" } }, outlet: "my_scene" });
    expect(created.extensions?.outlet_name).toBe("my_scene");
    expect(created.position).toBe(8);
  });

  test("changing the Position moves the same entry: to a chat depth, to another outlet, to native", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    await placeScene(rig, worldId, { type: "outlet", name: "my_scene" });
    const id = await sceneEntry(rig, worldId);
    await placeScene(rig, worldId, { type: "chat_depth", role: "user", depth: 3, direction: "from_end" });
    expect(await sceneEntry(rig, worldId)).toBe(id);
    expect(rig.host.storedEntry(id)).toMatchObject({ position: 4, depth: 3, role: "user", outlet: null });
    await placeScene(rig, worldId, { type: "outlet", name: "Scene_Notes" });
    expect(rig.host.storedEntry(id)).toMatchObject({ position: 8, outlet: "Scene_Notes" });
    await placeScene(rig, worldId, { type: "native" });
    expect(rig.host.storedEntry(id)).toMatchObject({ position: 0, outlet: null });
    expect(slotOfEntry(rig.host.storedEntry(id)?.extensions ?? {})).toBe("scene");
  });

  test("a move in the host's editor stands until the Position changes; a native entry an earlier build made keeps its place", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    await placeScene(rig, worldId, { type: "chat_depth", role: "system", depth: 1, direction: "from_end" });
    const id = await sceneEntry(rig, worldId);
    rig.host.editEntry(id, { position: 1 });
    // Attaching ensures the book again; the section's Position hasn't changed.
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    expect(rig.host.storedEntry(id)?.position).toBe(1);
    // An earlier build's native entry: no Position recorded, placed by hand.
    rig.host.editEntry(id, { position: 2, extensions: { [LEDGER_NAMESPACE]: { slot: "scene" } } });
    await placeScene(rig, worldId, { type: "native" });
    expect(rig.host.storedEntry(id)?.position).toBe(2);
    expect(rig.host.placed).not.toContain(id);
  });

  test("the engine run fills an outlet section's own entry, which reaches the prompt at its outlet; a chat on the revision that moved it to the chat gets it at that depth", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    await placeScene(rig, worldId, { type: "outlet", name: "my_scene" });
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const id = await sceneEntry(rig, worldId);
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const filled = rig.host.assembled.find((e) => e.id === id);
    expect(filled?.content).toMatch(/^\[Scene\]\n/);
    expect(filled).toMatchObject({ position: 8, outlet: "my_scene" });
    // A chat started on the revision that moved it gets it at that chat depth, counted from the end.
    await placeScene(rig, worldId, { type: "chat_depth", role: "system", depth: 1, direction: "from_start" });
    const later = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: later }));
    await rig.turn(later, "I wait.", "Nothing moves.");
    expect(rig.host.assembled.find((e) => e.id === id)).toMatchObject({ position: 4, depth: 1, role: "system", outlet: null });
  });

  test("a chat on an older revision that places the section in the chat gets it there once after a later revision moves it to an outlet", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    await placeScene(rig, worldId, { type: "chat_depth", role: "system", depth: 1, direction: "from_end" });
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const id = await sceneEntry(rig, worldId);
    // The head moves the section's own entry to an outlet; the chat stays on its revision.
    await placeScene(rig, worldId, { type: "outlet", name: "my_scene" });
    expect(rig.host.storedEntry(id)?.outlet).toBe("my_scene");
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const scene = rig.host.assembled.filter((e) => e.content.startsWith("[Scene]\n"));
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ position: 4, depth: 1, role: "system", outlet: null });
  });
});
