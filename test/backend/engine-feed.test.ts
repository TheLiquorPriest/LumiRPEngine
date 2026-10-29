// The engine feed (DESIGN §6.11): a section's switch, caps and sources as the world sets them, the
// GM's per-chat settings over them with their Undo, and the scopes: the player character's view never
// names a secret, the GM's names it marked for the narrator only, and no player surface gets it. The
// narrator rules give the order of authority first, then what marked facts mean, in the same words
// with marked facts or without.

import { describe, expect, test } from "bun:test";
import { NARRATOR_AUTHORITY, NARRATOR_SOURCE } from "../../src/backend/book";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import { MARKED_FACTS_RULE, markedText } from "../../src/engine/feed";
import { editRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import type { SectionTemplate } from "../../src/shared/world";
import { Rig } from "../support/rig";

const SECRET = "Vex Morrow";
/** What the narrator knows as the player character knows it: no section marks a fact beyond his. */
const POV_VIEW = { narrator: { knowledge: "pov", secrets: "omit" } };

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

  test("the GM's sources to tick are every renderer's, each once, each in words and filling its own section", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, null);
    const sources = (await rig.rt.view(chatId, rig.host.userId)).controls?.sources ?? [];
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The shipped packs' sources as `include` names them, people's own and those riding beside them.
    for (const id of ["people", "present_gear", "routines", "location", "weather", "place_lore"]) expect(ids).toContain(id);
    expect(sources.find((s) => s.id === "present_gear")?.slot).toBe("people");
    // Every shipped renderer says what it tells: none falls back to its bare name.
    for (const s of sources) expect(s.label).not.toBe(s.id.replace(/_/g, " "));
  });

  test("the GM's settings replace the world's: a chat with no cap lifts the world's line cap, and its Undo brings it back", async () => {
    const rig = new Rig({ shipped: true });
    const people = DEFAULT_SECTIONS.people;
    if (!people) throw new Error("no shipped People");
    const crowd = Object.fromEntries(["ana", "ben", "cal", "dee"].map((id): [string, JsonObject] => [id, { id, kind: "person", name: `${id.toUpperCase()} Neighbour`, tier: "background", fields: { place: "harbor_street_114" }, relations: [] }]));
    const chatId = await alder(rig, { ...DEFAULT_SECTIONS, people: { ...people, maxLines: 3 } }, crowd);
    await edit(rig, chatId, { op: "feed", section: "people", to: {} });
    await undoLatest(rig, chatId);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(sent(rig).get(people.label)).toHaveLength(3);
    await edit(rig, chatId, { op: "feed", section: "people", to: {} });
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect((sent(rig).get(people.label) ?? []).length).toBeGreaterThan(3);
  });

  test("a section of marked facts alone that the host leaves out doesn't keep the turn's activation from reading confirmed", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, null);
    // The player character owns no property, so the GM-scoped Property section holds marked facts alone.
    await edit(rig, chatId, { op: "feed", section: "property", to: { scope: "gm" } });
    const prior = rig.host.worldInfoInterceptor;
    rig.host.worldInfoInterceptor = async (input) => {
      const verdict = prior ? await prior(input) : { disabled: [], enabled: [] };
      const books = [...rig.host.bookStore.values()].flatMap((b) => [...b.entries.values()]);
      const out = books.filter((e) => e.comment === "LRE · Property" || e.comment === "LRE · Narrator rules").map((e) => e.id);
      return { ...verdict, disabled: [...verdict.disabled, ...out] };
    };
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.assembled.some((e) => e.content.startsWith("[Property]"))).toBe(false);
    expect(rig.rt.inspectorRecords(chatId)?.at(-1)?.activation).toBe("confirmed");
  });
});

describe("feed scopes", () => {
  test("the player character's view never names a secret person here", async () => {
    const rig = new Rig({ shipped: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: POV_VIEW }));
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
    expect(rig.host.assembled.some((e) => e.content.startsWith("[Narrator rules]") && e.content.includes(MARKED_FACTS_RULE))).toBe(true);
    // Play's view: chips, the Journal, panels, the HUD.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(SECRET);
    expect(JSON.stringify(await rig.rt.view(chatId, rig.host.userId))).not.toContain(SECRET);
  });

  test("the narrator rules give the order of authority before what marked facts mean, in the same words whether or not the turn carries marked facts", async () => {
    const rig = new Rig({ shipped: true });
    // The player character's view first, so the turn carries no marked fact until the GM's scope adds one.
    rig.body(await rig.send({ type: "lre.settings.set", patch: POV_VIEW }));
    const chatId = await alder(rig, null, secretHere);
    const label = DEFAULT_SECTIONS.people?.label ?? "People";
    const marked = markedText({ text: `${SECRET} is here.`, known: "gm" });
    const rules = (): string => rig.host.assembled.find((e) => e.content.startsWith("[Narrator rules]\n"))?.content ?? "";
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(sent(rig).get(label)).not.toContain(marked);
    const plain = rules();
    // The GM's scope puts a marked fact into People.
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "gm" } });
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect(sent(rig).get(label)).toContain(marked);
    expect(rules()).toBe(plain);
    // The order of authority comes right after where the rules come from, and the guidance for
    // marked facts follows the order it works under, even on a turn that carries none.
    expect(plain.startsWith(["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_AUTHORITY, MARKED_FACTS_RULE].join("\n"))).toBe(true);
  });

  test("a scene-scope fact reaches the narrator marked, and no player surface, Journal line or panel", async () => {
    const rig = new Rig({ shipped: true });
    const FLASK = "Engraved silver flask";
    // Hers to know by the visibility rules (`known_by`, and she knows it); the player character doesn't.
    const chatId = await alder(rig, null, {
      nora: { id: "nora", kind: "person", name: "Nora Pell", tier: "supporting", fields: { place: "harbor_street_114" }, relations: [{ type: "knows", to: "flask" }] },
      flask: { id: "flask", kind: "item", name: FLASK, tier: "background", fields: { owner: "nora" }, relations: [{ type: "in", to: "nora" }], visibility: "known_by" },
    });
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "scene" } });
    await rig.turn(chatId, "I look around.", "Quiet.");
    const people = sent(rig).get(DEFAULT_SECTIONS.people?.label ?? "People") ?? [];
    const line = people.find((l) => l.includes(FLASK));
    expect(line).toBe(markedText({ text: `Nora Pell has ${FLASK}.`, known: "scene", who: "Nora Pell" }));
    // Play's view as pushed and as asked for, with every panel the chat has: nothing of it.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(FLASK);
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(JSON.stringify(view)).not.toContain(FLASK);
    for (const panel of Object.keys(view.panels)) expect(JSON.stringify(rig.body(await rig.send({ type: "lre.view.open", chatId, panel })))).not.toContain(FLASK);
  });
});
