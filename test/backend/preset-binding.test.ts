// The active preset's say in world chats (DESIGN §6.8): `{{outlet::lre_<slot>}}` in an enabled block
// routes that section to its outlet twin for the generation, while the world's placement stands
// otherwise; switched-off "RPEngine · <step>" blocks are appended to that helper's prompt as style
// and rules (notes skipped, macros never resolved, length bounded, read once per preset revision);
// "RPEngine · narrator" reaches the narrator in world chats; Add RPEngine blocks fills in the rest.

import { describe, expect, test } from "bun:test";
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
    let result = rig.host.lastInterceptor;
    expect(result?.enabled).toContain(twin);
    expect(result?.mutated.find((m) => m.id === twin)?.content).toMatch(/^\[Scene\]\n/);
    expect(result?.mutated.find((m) => m.id === twin)?.placement).toBeUndefined();
    expect(result?.disabled).toContain(own);
    // A switched-off block, or one limited to some generation types, places nothing.
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}", false), block("Swipes", "{{outlet::lre_scene}}", true, { injectionTrigger: ["swipe"] })];
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait.", "Nothing moves.");
    result = rig.host.lastInterceptor;
    expect(result?.enabled).toContain(own);
    expect(result?.mutated.find((m) => m.id === own)?.placement).toEqual({ type: "chat_depth", role: "system", depth: 1, direction: "from_end" });
    expect(result?.disabled).toContain(twin);
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

  test("RPEngine · narrator reaches the narrator in world chats: before the character, or at {{outlet::lre_narrator}}", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const rules = await entryWith(rig, chatId, "narrator", "rules");
    const outlet = await entryWith(rig, chatId, "narrator", "outlet");
    rig.host.presetBlocks = [block("RPEngine · narrator", "Trust the Outcome.", false)];
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.id === rules)?.content).toBe("[Narrator rules]\nTrust the Outcome.");
    expect(rig.host.lastInterceptor?.disabled).toContain(outlet);
    rig.host.presetBlocks = [...rig.host.presetBlocks, block("Rules", "{{outlet::lre_narrator}}", true)];
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait.", "Quiet.");
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.id === outlet)?.content).toBe("[Narrator rules]\nTrust the Outcome.");
    expect(rig.host.lastInterceptor?.disabled).toContain(rules);
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
    expect(added.map((b) => b.name)).toEqual(["interpret", "extract", "brief", "outline", "choices", "npc.choose", "contradiction", "puzzle.answer", "narrator"].map((t) => `RPEngine · ${t}`));
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

describe("which preset counts", () => {
  test("the Loom preset the frontend reports is read first, the one the generation's connection links only without it, and the last reply's after that", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.otherPresets.set("linked", { name: "Linked", revision: 1, blocks: [block("Story", "{{outlet::lre_scene}}", true)] });
    rig.host.otherPresets.set("loom", { name: "Loom", revision: 1, blocks: [] });
    rig.host.connectionPresets.set("conn-1", "linked");
    rig.host.contextConnectionId = "conn-1";
    rig.host.lastUsedPreset = null;
    const twin = await entryWith(rig, chatId, "twin", "scene");
    const routed = async (text: string): Promise<boolean> => {
      await rig.turn(chatId, text, "Quiet.");
      return rig.host.lastInterceptor?.enabled.includes(twin) === true;
    };
    // Without a Loom preset, the one the generation's connection links places Scene.
    expect(await routed("I look around.")).toBe(true);
    // The Loom preset the frontend reports comes first.
    rig.body(await rig.send({ type: "lre.preset", op: "active", presetId: "loom" }));
    expect(await routed("I wait.")).toBe(false);
    // A hello saying none is active: the connection's again.
    rig.body(await rig.send({ type: "lre.hello", chatId, presetId: null }));
    expect(await routed("I wait more.")).toBe(true);
    // With neither, the one the chat's last reply was assembled with; with none of the three, no preset.
    rig.host.contextConnectionId = null;
    rig.host.lastUsedPreset = "linked";
    expect(await routed("I wait again.")).toBe(true);
    rig.host.lastUsedPreset = null;
    expect(await routed("I wait once more.")).toBe(false);
    // Settings → Preset names the Loom preset.
    rig.body(await rig.send({ type: "lre.preset", op: "active", presetId: "loom" }));
    const card = rig.body(await rig.send({ type: "lre.preset", op: "get" })).card as { preset: { name: string } | null };
    expect(card.preset?.name).toBe("Loom");
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
      return rig.host.lastInterceptor?.enabled.includes(twin) === true;
    };
    expect(await routed([block("Tagged", "{{outlet::lre_scene}}", true, { characterTagTrigger: ["rpg"] })])).toBe(false);
    const styles = block("Styles", "", true, { marker: "category", categoryMode: "radio" });
    expect(await routed([styles, block("Plain", "Write plainly.", true), block("Fancy", "{{outlet::lre_scene}}", true)])).toBe(false);
    expect(await routed([styles, block("Fancy", "{{outlet::lre_scene}}", true), block("Plain", "Write plainly.", true)])).toBe(true);
    expect(await routed([{ ...styles, categoryMode: "checkbox" }, block("Plain", "Write plainly.", true), block("Fancy", "{{outlet::lre_scene}}", true)])).toBe(true);
  });

  test("a routed section the test build doesn't find goes back to the world's placement while that preset revision stands", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const twin = await entryWith(rig, chatId, "twin", "scene");
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}", true)];
    // The host leaves the block out (a profile switched it off, say): no assembled prompt holds the outlet.
    rig.host.assembledOutlets = new Set();
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.lastInterceptor?.enabled).toContain(twin);
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    await rig.turn(chatId, "I wait.", "Quiet.");
    expect(rig.host.lastInterceptor?.enabled).not.toContain(twin);
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.id !== twin && m.content?.startsWith("[Scene]"))?.placement).toEqual({ type: "chat_depth", role: "system", depth: 1, direction: "from_end" });
    // The preset's next revision is tried again.
    rig.host.presetRevision++;
    await rig.turn(chatId, "I wait more.", "Quiet.");
    expect(rig.host.lastInterceptor?.enabled).toContain(twin);
  });
});
