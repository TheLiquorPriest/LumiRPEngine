// The editable texts in play (DESIGN §6.12): a narrator rule or a section's guidance of the user's own
// reaches the narrator's prompt from the next turn, Reset brings back the shipped text, a world's own
// wording of a section comes before the user's, and every turn records the texts it was made with,
// which its Re-narrate is sent again unless the user picks their current ones: the wording of a
// secret's mark too, in its sections, its rules and the World Info in its prompt alike.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { MARK_TEXT_IDS, MARKED_FACTS_RULE, NARRATOR_AUTHORITY, NARRATOR_SOURCE, sectionPromptId } from "../../src/shared/prompts";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";
import { attachBook } from "../support/tools";

const EDITED = "What each person knows: keep every character to what they know, and keep a marked fact out of the reply.";
const SHIPPED_RULES = ["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_AUTHORITY, MARKED_FACTS_RULE].join("\n");

/** The narrator rules the last reply's prompt held. */
function rules(rig: Rig): string {
  return rig.host.assembled.find((e) => e.content.startsWith("[Narrator rules]\n"))?.content ?? "";
}

/** Everything the last reply's prompt held. */
function prompt(rig: Rig): string {
  return rig.host.assembled.map((e) => e.content).join("\n");
}

/** Saves texts of the user's own as Settings → Agents → Prompts does (null resets one). */
async function save(rig: Rig, texts: JsonObject): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts } } }));
}

/** The head reply's record on swipe `swipe`. */
async function record(rig: Rig, chatId: string, swipe: number) {
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  return (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[head.id]?.ledger.swipes[String(swipe)];
}

describe("texts of the user's own reach the narrator", () => {
  test("an edited narrator rule is in the next reply's prompt, a bad placeholder isn't saved, and Reset brings back the shipped text", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await save(rig, { "narrator.marked_facts": EDITED });
    // A text with a placeholder it doesn't have is flagged and never stored: the saved one stays.
    await save(rig, { "narrator.marked_facts": `${EDITED} {{secrets}}` });
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rules(rig).startsWith(["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_AUTHORITY, EDITED].join("\n"))).toBe(true);
    expect(rules(rig)).not.toContain(MARKED_FACTS_RULE);
    expect(rules(rig)).not.toContain("secrets");
    await save(rig, { "narrator.marked_facts": null });
    await rig.turn(chatId, "I wait.", "Still quiet.");
    expect(rules(rig).startsWith(SHIPPED_RULES)).toBe(true);
    expect(rules(rig)).not.toContain(EDITED);
  });

  test("a section's guidance of the user's own leads its lines, and a world's own wording of it comes first", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await save(rig, { [sectionPromptId("scene")]: "Mine: the scene, as it stands.\n{{lines}}" });
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.section("Scene").startsWith("[Scene]\nMine: the scene, as it stands.\n- ")).toBe(true);
    // A world that words its own Scene.
    const worldId = await rig.newWorld("Worded");
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "patch", ops: [{ op: "add", path: "/sectionTemplates", value: { scene: "The world's: the scene, as it stands.\n{{lines}}" } }] }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const worded = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: worded }));
    await rig.turn(worded, "I look around.", "Quiet.");
    expect(rig.host.section("Scene").startsWith("[Scene]\nThe world's: the scene, as it stands.\n- ")).toBe(true);
  });
});

describe("a turn's own texts", () => {
  test("an old turn's Re-narrate is sent the texts it was made with, and with your current texts chosen, your edit", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const made = rules(rig);
    expect(made.startsWith(SHIPPED_RULES)).toBe(true);
    const source = await record(rig, chatId, 0);
    // The turn recorded the texts its narrator prompt was made from.
    const set = await rig.rt.promptSets.get(rig.host.userId, source?.prompts ?? "");
    expect(set?.texts["narrator.marked_facts"]).toBe(MARKED_FACTS_RULE);
    expect(set?.texts[sectionPromptId("scene")]).toBe(DEFAULT_SECTIONS.scene?.template);
    await save(rig, { "narrator.marked_facts": EDITED });
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Still quiet.");
    expect(rules(rig)).toBe(made);
    expect((await record(rig, chatId, 1))?.prompts).toBe(source?.prompts);
    // Settings → Swipes: Re-narrate with my current texts.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeTexts: "current" } }));
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Quiet again.");
    expect(rules(rig)).toContain(EDITED);
    expect(rules(rig)).not.toContain(MARKED_FACTS_RULE);
    expect((await rig.rt.promptSets.get(rig.host.userId, (await record(rig, chatId, 2))?.prompts ?? ""))?.texts["narrator.marked_facts"]).toBe(EDITED);
  });

  test("a turn's Re-run is sent the texts it was made with too, and with your current texts chosen, your edit", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const made = rules(rig);
    await save(rig, { "narrator.marked_facts": EDITED });
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Still quiet.");
    expect(rules(rig)).toBe(made);
    expect((await record(rig, chatId, 1))?.prompts).toBe((await record(rig, chatId, 0))?.prompts);
    // Settings → Swipes: my current texts.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeTexts: "current" } }));
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Quiet again.");
    expect(rules(rig)).toContain(EDITED);
    expect(rules(rig)).not.toContain(MARKED_FACTS_RULE);
  });

  test("a turn recorded before turns named their texts is re-narrated with the shipped ones", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const source = await record(rig, chatId, 0);
    if (!source) throw new Error("no record");
    // As an earlier build recorded it: no prompt set.
    delete source.prompts;
    await save(rig, { "narrator.marked_facts": EDITED });
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Still quiet.");
    expect(rules(rig).startsWith(SHIPPED_RULES)).toBe(true);
    expect(rules(rig)).not.toContain(EDITED);
  });

  test("a Re-narrate marks a secret in the wording its turn was made with, in the World Info of its prompt and its rules, and with your current texts chosen, in yours", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // A book of the user's whose entry holds Marcus's secret, kept from everyone else: the narrator gets it marked.
    const debt = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
    await attachBook(rig, chatId, "Harbor notes", [{ comment: "The ferry", content: `The ferry runs twice a day.\n{{// Secret (known to Marcus): ${debt}}}`, keys: ["ferry"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {} }]);
    const mine = "{{text}} (only {{known}} know this)";
    await save(rig, { [MARK_TEXT_IDS.known]: mine });
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(prompt(rig)).toContain(`${debt} (only Marcus Delgado know this)`);
    expect(rules(rig)).toContain(secretMarkText("…", ["…"], "everyone", { ...SECRET_MARK_WORDING, known: mine }));
    const source = await record(rig, chatId, 0);
    expect((await rig.rt.promptSets.get(rig.host.userId, source?.prompts ?? ""))?.texts[MARK_TEXT_IDS.known]).toBe(mine);
    // A new wording of the user's: the turn's Re-narrate keeps the one it was made with.
    const now = "{{text}} (a secret of {{known}})";
    await save(rig, { [MARK_TEXT_IDS.known]: now });
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Still quiet.");
    expect(prompt(rig)).toContain(`${debt} (only Marcus Delgado know this)`);
    expect(prompt(rig)).not.toContain("(a secret of Marcus Delgado)");
    // Settings → Swipes: Re-narrate with my current texts.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeTexts: "current" } }));
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Quiet again.");
    expect(prompt(rig)).toContain(`${debt} (a secret of Marcus Delgado)`);
    expect(rules(rig)).toContain(secretMarkText("…", ["…"], "everyone", { ...SECRET_MARK_WORDING, known: now }));
    expect(prompt(rig)).not.toContain("know this)");
  });

  test("a swipe of a turn whose texts don't hold the mark wording marks a secret in the user's own, moved from an old settings file", async () => {
    const host = new FakeHost();
    const mine = "{{text}} <<hush: {{known}}>>";
    // Before the wording was a text of the registry, it was Settings → Narrator's, whatever the turn.
    host.files.set(`${host.userId}/settings.json`, JSON.stringify({ v: 1, minds: { enabled: false }, narrator: { knowledge: "scene", secrets: "marked", marks: { known: mine } } }));
    const rig = new Rig({ host });
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const theirs = secretMarkText("…", ["…"], "everyone", { ...SECRET_MARK_WORDING, known: mine });
    const shipped = secretMarkText("…", ["…"], "everyone");
    expect(rules(rig)).toContain(theirs);
    // As an earlier build recorded it: no prompt set. Its Re-run, then a Re-narrate of that one.
    const source = await record(rig, chatId, 0);
    if (!source) throw new Error("no record");
    delete source.prompts;
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Still quiet.");
    expect(rules(rig)).toContain(theirs);
    expect(rules(rig)).not.toContain(shipped);
    for (const swipe of [0, 1]) {
      const rec = await record(rig, chatId, swipe);
      if (rec) delete rec.prompts;
    }
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Quiet again.");
    expect(rules(rig)).toContain(theirs);
    expect(rules(rig)).not.toContain(shipped);
    // The new swipe's own set holds the wording it was made with.
    const set = await rig.rt.promptSets.get(rig.host.userId, (await record(rig, chatId, 2))?.prompts ?? "");
    expect(set?.texts[MARK_TEXT_IDS.known]).toBe(mine);
  });
});
