// The active preset's say in world chats (DESIGN §6.8): `{{outlet::lre_<slot>}}` in an enabled block
// routes that section to its outlet twin for the generation, while the world's placement stands
// otherwise; switched-off "RPEngine · <step>" blocks are appended to that helper's prompt as style
// and rules (notes skipped, macros never resolved, length bounded, read once per preset revision);
// every world-chat reply gets the narrator rules, the order of authority and what marked facts mean,
// and "RPEngine · narrator" follows them as the player's own; Add RPEngine blocks fills in the rest.

import { describe, expect, test } from "bun:test";
import { NARRATOR_AUTHORITY, NARRATOR_SOURCE, PRESET_RULES_LEAD } from "../../src/backend/book";
import { MARKED_FACTS_RULE } from "../../src/engine/feed";
import { GUIDANCE_MAX_CHARS } from "../../src/backend/preset-binding";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { isRecord } from "../../src/shared/json";
import type { HostPresetBlock } from "../../src/backend/host";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

const block = (name: string, content: string, enabled: boolean, more: Partial<HostPresetBlock> = {}): HostPresetBlock => ({ id: `b_${name}`, name, content, enabled, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null, ...more });

/** The engine-book entry whose extension data has `key` set to `value` (a twin, the narrator rules). */
async function entryWith(rig: Rig, chatId: string, key: string, value: string): Promise<string> {
  const run = await rig.rt.runOf(chatId, rig.host.userId);
  const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
  const found = (await rig.host.books.entries(bookId, rig.host.userId)).find((e) => {
    const ns = e.extensions[LEDGER_NAMESPACE];
    return isRecord(ns) && ns[key] === value;
  });
  if (!found) throw new Error(`no entry with ${key} ${value}`);
  return found.id;
}

describe("the preset's outlets", () => {
  test("an enabled block holding {{outlet::lre_scene}} routes Scene to its outlet twin; without it the world's placement stands", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const twin = await entryWith(rig, chatId, "twin", "scene");
    expect(rig.host.storedEntry(twin)).toMatchObject({ position: 8, outlet: "lre_scene" });
    const own = (await rig.rt.book.slotEntries((await rig.rt.worlds.index((await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "", rig.host.userId))?.loreBookId ?? "", rig.host.userId)).get("scene") ?? "";
    rig.host.presetBlocks = [block("Story", "The story so far.\n{{outlet::LRE_Scene}}", true)];
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const at = (id: string) => rig.host.assembled.find((e) => e.id === id);
    expect(at(twin)?.content).toMatch(/^\[Scene\]\n/);
    expect(at(twin)).toMatchObject({ position: 8, outlet: "lre_scene" });
    expect(at(own)).toBeUndefined();
    // A switched-off block, or one limited to some generation types, places nothing.
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}", false), block("Swipes", "{{outlet::lre_scene}}", true, { injectionTrigger: ["swipe"] })];
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait.", "Nothing moves.");
    expect(at(own)?.content).toMatch(/^\[Scene\]\n/);
    expect(at(own)).toMatchObject({ position: 4, depth: 1, role: "system", outlet: null });
    expect(at(twin)).toBeUndefined();
  });
});

describe("the preset's guidance", () => {
  test("a switched-off RPEngine · extract block is appended to the extract prompt after its template: notes skipped, macros neutralized, length bounded", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id: "read", value: { id: "read", purpose: "extract", template: "WORLD TEMPLATE: read the reply.", output: "text", signals: [] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const long = "word ".repeat(GUIDANCE_MAX_CHARS);
    rig.host.presetBlocks = [block("RPEngine · extract", `// a note for the author\nThe narrator writes in second person: you are Sam. {{char}} narrates.\n${long}`, false), block("RPEngine · choices", "Enabled, so not read.", true)];
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      if (system.includes(EXTRACT_MARK) || system.includes("WORLD TEMPLATE")) prompts.push(system);
      return '{"proposals": []}';
    };
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const system = prompts[0] ?? "";
    expect(system.indexOf("WORLD TEMPLATE")).toBeGreaterThanOrEqual(0);
    expect(system.indexOf("The narrator writes in second person")).toBeGreaterThan(system.indexOf("WORLD TEMPLATE"));
    expect(system).toContain("｛｛char｝｝ narrates.");
    expect(system).not.toContain("{{char}}");
    expect(system).not.toContain("a note for the author");
    expect((system.match(/word/g) ?? []).length * 5).toBeLessThanOrEqual(GUIDANCE_MAX_CHARS);
    expect(prompts.join("\n")).not.toContain("Enabled, so not read.");
  });

  test("a preset revision is read once; a new revision is read again", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.presetBlocks = [block("RPEngine · extract", "Second person.", false)];
    rig.host.quietReply = () => '{"proposals": []}';
    await rig.turn(chatId, "I look around.", "Quiet.");
    await rig.turn(chatId, "I wait.", "Still quiet.");
    expect(rig.host.blockReads).toBe(1);
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait more.", "Quieter.");
    expect(rig.host.blockReads).toBe(2);
  });

  test("every world-chat reply gets the narrator rules, with the order of authority and what marked facts mean, before the character, with no preset rules of its own", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const rules = await entryWith(rig, chatId, "narrator", "rules");
    await rig.turn(chatId, "I look around.", "Quiet.");
    const content = rig.host.assembled.find((e) => e.id === rules)?.content ?? "";
    // Where they come from, then the order of authority, then the guidance for marked facts under it.
    expect(content.startsWith(["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_AUTHORITY, MARKED_FACTS_RULE].join("\n"))).toBe(true);
    // It stays in the book only for the reply that took it.
    expect(rig.host.storedEntry(rules)).toMatchObject({ disabled: true, content: "" });
  });

  test("RPEngine · narrator reaches the narrator in world chats, after the order of authority and what marked facts mean, as the player's: before the character, or at {{outlet::lre_narrator}}", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const rules = await entryWith(rig, chatId, "narrator", "rules");
    const outlet = await entryWith(rig, chatId, "narrator", "outlet");
    rig.host.presetBlocks = [block("RPEngine · narrator", "Keep replies under 300 words.", false)];
    await rig.turn(chatId, "I look around.", "Quiet.");
    const at = (id: string) => rig.host.assembled.find((e) => e.id === id);
    const told = (content: string | undefined): boolean =>
      content !== undefined &&
      content.startsWith(["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_AUTHORITY, MARKED_FACTS_RULE].join("\n")) &&
      content.endsWith(`\n${PRESET_RULES_LEAD}\nKeep replies under 300 words.`) &&
      content.indexOf(PRESET_RULES_LEAD) > content.indexOf(MARKED_FACTS_RULE);
    expect(told(at(rules)?.content)).toBe(true);
    expect(at(outlet)).toBeUndefined();
    rig.host.presetBlocks = [...rig.host.presetBlocks, block("Rules", "{{outlet::lre_narrator}}", true)];
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait.", "Quiet.");
    expect(told(at(outlet)?.content)).toBe(true);
    expect(at(rules)).toBeUndefined();
  });

  test("Add RPEngine blocks adds each missing block switched off, notes only, under an RPEngine category; again adds nothing", async () => {
    const rig = new Rig();
    await rig.worldChat();
    // The frontend reports the Loom preset in use: there is no chat yet to read one from.
    rig.body(await rig.send({ type: "lre.preset", op: "active", presetId: "preset-1" }));
    rig.host.presetBlocks = [block("Main", "Write well.", true), block("RPEngine · judge", "Be generous.", false)];
    const card = rig.body(await rig.send({ type: "lre.preset", op: "add" })).card as { blocks: { target: string; state: string }[] };
    const names = rig.host.presetBlocks.map((b) => b.name);
    expect(names.slice(0, 3)).toEqual(["Main", "RPEngine · judge", "RPEngine"]);
    expect(rig.host.presetBlocks[2]?.marker).toBe("category");
    const added = rig.host.presetBlocks.slice(3);
    expect(added.map((b) => b.name)).toEqual(["interpret", "extract", "brief", "outline", "choices", "npc.choose", "puzzle.answer", "mind", "memory", "skip", "consolidate", "narrator"].map((t) => `RPEngine · ${t}`));
    expect(added.every((b) => !b.enabled && b.content.split("\n").every((line) => line === "" || line.startsWith("//")))).toBe(true);
    // One write of the preset, however many blocks it adds.
    expect(rig.host.presetWrites).toBe(1);
    expect(card.blocks.find((b) => b.target === "judge")?.state).toBe("read");
    expect(card.blocks.find((b) => b.target === "extract")?.state).toBe("empty");
    rig.body(await rig.send({ type: "lre.preset", op: "add" }));
    expect(rig.host.presetBlocks.map((b) => b.name)).toEqual(names);
    expect(rig.host.presetWrites).toBe(1);
  });
});

describe("outlets the host won't assemble", () => {
  test("a block limited to some characters' tags, or a radio category's second choice, places nothing; the first choice does", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const twin = await entryWith(rig, chatId, "twin", "scene");
    const routed = async (blocks: HostPresetBlock[]): Promise<boolean> => {
      rig.host.presetBlocks = blocks;
      rig.host.presetRevision++;
      await rig.turn(chatId, "I look around.", "Quiet.");
      return rig.host.assembled.some((e) => e.id === twin);
    };
    expect(await routed([block("Tagged", "{{outlet::lre_scene}}", true, { characterTagTrigger: ["rpg"] })])).toBe(false);
    const styles = block("Styles", "", true, { marker: "category", categoryMode: "radio" });
    expect(await routed([styles, block("Plain", "Write plainly.", true), block("Fancy", "{{outlet::lre_scene}}", true)])).toBe(false);
    expect(await routed([styles, block("Fancy", "{{outlet::lre_scene}}", true), block("Plain", "Write plainly.", true)])).toBe(true);
    expect(await routed([{ ...styles, categoryMode: "checkbox" }, block("Plain", "Write plainly.", true), block("Fancy", "{{outlet::lre_scene}}", true)])).toBe(true);
  });
});
