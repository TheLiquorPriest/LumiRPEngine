// The engine feed (DESIGN §6.11): a section's switch, caps and sources as the world sets them, the
// GM's per-chat settings over them with their Undo, and the scopes: the player's never names a
// secret, the GM's names it marked for the narrator only, and no player surface gets it.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS } from "../../src/backend/book";
import type { Delivered } from "../../src/backend/ledger-io";
import { markedText } from "../../src/engine/feed";
import type { SectionRenderer } from "../../src/engine/registry";
import { editRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import type { SectionTemplate } from "../../src/shared/world";
import { Rig } from "../support/rig";

const SECRET = "Vex Morrow";

/** A Port Alder chat whose world has these sections (the shipped ones when none) and entities. */
async function alder(rig: Rig, sections: Record<string, SectionTemplate> | null, entities: Record<string, JsonObject> = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  for (const [id, value] of Object.entries(sections ?? {})) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "sections", id, value }));
  for (const [id, value] of Object.entries(entities)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id, value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** The sections the latest reply's prompt held, by label: each one's bullet lines. */
function sent(rig: Rig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of rig.host.assembled) {
    const m = /^\[([^\]]+)\]\n/.exec(e.content);
    if (m?.[1]) out.set(m[1], e.content.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)));
  }
  return out;
}

async function edit(rig: Rig, chatId: string, op: EditOp): Promise<void> {
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

async function undoLatest(rig: Rig, chatId: string): Promise<void> {
  const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!undo) throw new Error("no Undo chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
}

const secretHere: Record<string, JsonObject> = { lurker: { id: "lurker", kind: "person", name: SECRET, tier: "background", fields: { place: "harbor_street_114" }, relations: [], visibility: "secret" } };

describe("section settings", () => {
  test("a section switched off stays out, maxLines keeps its first lines and include fills a section from another's sources", async () => {
    const rig = new Rig({ shipped: true });
    const scene = DEFAULT_SECTIONS.scene;
    const people = DEFAULT_SECTIONS.people;
    if (!scene || !people) throw new Error("no shipped sections");
    const kit: SectionTemplate = { id: "kit", label: "Kit", rank: 20, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" }, include: ["location", "calendar", "weather"] };
    const chatId = await alder(rig, { ...DEFAULT_SECTIONS, scene: { ...scene, maxLines: 1 }, people: { ...people, enabled: false }, kit });
    await rig.turn(chatId, "I look around.", "Quiet.");
    const out = sent(rig);
    expect(out.has(people.label)).toBe(false);
    expect(out.get(scene.label)).toHaveLength(1);
    const kitLines = out.get("Kit") ?? [];
    expect(kitLines.length).toBeGreaterThan(1);
    expect(kitLines[0]).toEqual(out.get(scene.label)?.[0] ?? "");
  });

  test("the GM's setting for a section applies in the chat, and its Undo takes it away", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, null);
    const label = DEFAULT_SECTIONS.people?.label ?? "People";
    const chatSetting = async (): Promise<unknown> => (await rig.rt.view(chatId, rig.host.userId)).controls?.sections.find((s) => s.id === "people")?.chat;
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(sent(rig).has(label)).toBe(true);
    await edit(rig, chatId, { op: "feed", section: "people", to: { enabled: false } });
    expect(await chatSetting()).toEqual({ enabled: false });
    await undoLatest(rig, chatId);
    expect(await chatSetting()).toBeNull();
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect(sent(rig).has(label)).toBe(true);
    await edit(rig, chatId, { op: "feed", section: "people", to: { enabled: false } });
    await rig.turn(chatId, "And again.", "Nothing new.");
    expect(sent(rig).has(label)).toBe(false);
  });
});

describe("feed scopes", () => {
  test("the player scope never names a secret person here", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, null, secretHere);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.assembled.map((e) => e.content).join("\n")).not.toContain(SECRET);
  });

  test("the GM scope names them, marked for the narrator, and no player surface or Journal line does", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, null, secretHere);
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "gm" } });
    await rig.turn(chatId, "I look around.", "Quiet.");
    const people = sent(rig).get(DEFAULT_SECTIONS.people?.label ?? "People") ?? [];
    const line = people.find((l) => l.includes(SECRET));
    expect(line).toBe(markedText({ text: `${SECRET} is here.`, known: "gm" }));
    // The narrator rules tell what marked facts are for.
    expect(rig.host.assembled.some((e) => e.content.startsWith("[Narrator rules]"))).toBe(true);
    // Play's view: chips, the Journal, panels, the HUD.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(SECRET);
    expect(JSON.stringify(await rig.rt.view(chatId, rig.host.userId))).not.toContain(SECRET);
  });
});

describe("World Info sources", () => {
  test("a section line's World Info entry is in the turn's delivery record", async () => {
    const rig = new Rig({ shipped: true });
    const source = { bookId: "book-lore", entryId: "entry-7" };
    const renderer: SectionRenderer = { slot: "scene", source: "probe", render: () => ["The fog rolls in."], feed: () => [{ text: "The fog rolls in.", known: "pov", source }] };
    (rig.rt.registry.renderers as SectionRenderer[]).push(renderer);
    const delivered: Delivered[] = [];
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input) => {
      const d = await deliver(input);
      delivered.push(d);
      return d;
    };
    const chatId = await alder(rig, null);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(delivered.at(-1)?.sources).toEqual([source]);
  });
});
