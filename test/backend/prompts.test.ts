// The editable texts (DESIGN §6.12): every shipped text is today's and valid as shipped; a built-in
// section reads the world's own wording, else the user's own text, else the shipped one; an agent's
// text is filled from its own placeholders only; a bad placeholder is flagged and never stored; Test
// runs a text whose answer keeps a contract once and checks the answer; and a turn's prompt set is
// stored once by its hash and read back by it.

import { describe, expect, test } from "bun:test";
import { sectionsOf } from "../../src/backend/book";
import { markWording, PromptSets, renderPrompt, resolvePrompt, testPrompt, turnPromptSet, type PromptContract } from "../../src/backend/prompts";
import { SettingsStore } from "../../src/backend/settings-store";
import { hasOwn, type JsonObject } from "../../src/shared/json";
import { FINAL_OUTPUT_PAGE, FINAL_OUTPUT_PROMPTS, MARK_TEXT_IDS, PROMPT_PAGES, PROMPTS, promptDef, promptProblems, sectionPromptId, type PromptDef } from "../../src/shared/prompts";
import { SECRET_MARK_WORDING, type SecretMarkWording } from "../../src/shared/secret-marks";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import { FakeHost } from "../support/fake-host";
import { testWorld } from "../support/test-pack";

function def(id: string): PromptDef {
  const found = promptDef(id);
  if (!found) throw new Error(`no text ${id}`);
  return found;
}

function template(world: Parameters<typeof sectionsOf>[0], slot: string, texts: Record<string, string> = {}): string | undefined {
  return sectionsOf(world, texts).find((s) => s.id === slot)?.template;
}

const codes = (d: PromptDef, text: string, maxChars?: number): string[] => promptProblems(d, text, maxChars).map((p) => p.code);

describe("the registry", () => {
  test("each built-in section's guidance is a text of its own, shipped as the section's template, keeping {{lines}}", () => {
    for (const section of Object.values(DEFAULT_SECTIONS)) {
      const text = def(sectionPromptId(section.id));
      expect(text.text).toBe(section.template);
      expect(codes(text, "Its guidance, without its lines.")).toEqual(["missing_placeholder"]);
    }
  });

  test("every text is valid as shipped, on a page Settings lists, under an id of its own", () => {
    const pages = new Set(PROMPT_PAGES.map((p) => p.id));
    for (const d of PROMPTS) {
      expect({ id: d.id, problems: promptProblems(d, d.text) }).toEqual({ id: d.id, problems: [] });
      expect(pages.has(d.page)).toBe(true);
    }
    expect(new Set(PROMPTS.map((d) => d.id)).size).toBe(PROMPTS.length);
  });

  test("a placeholder a text doesn't have is flagged, and so is one it must keep that's missing or past the length allowed", () => {
    expect(codes(def("narrator.marked_facts"), "Keep {{secrets}} from the reply.")).toEqual(["unknown_placeholder"]);
    expect(codes(def(sectionPromptId("scene")), "Where it happens.")).toEqual(["missing_placeholder"]);
    // Only the exact form is a placeholder: anything else in braces is flagged, and the lines have nowhere to go.
    expect(codes(def(sectionPromptId("scene")), "Where it happens.\n{{ Lines }}")).toEqual(["unknown_placeholder", "missing_placeholder"]);
    expect(codes(def("gm.system"), "You help with {{world}}, where {{pov}} plays.")).toEqual([]);
    expect(codes(def("gm.system"), "You help with {{world}}.", 10)).toEqual(["too_long"]);
  });

  test("a secret's mark is worded by the Final output's Secret marks texts, each shipped as today's wording and keeping the placeholders it needs", () => {
    const needs: Record<keyof SecretMarkWording, string[]> = { known: ["text", "known"], kept: ["text", "kept"], both: ["text", "known", "kept"], everyone: [], rule: ["forms"] };
    for (const [part, id] of Object.entries(MARK_TEXT_IDS) as [keyof SecretMarkWording, string][]) {
      const d = def(id);
      expect({ id, page: d.page, group: d.group, text: d.text }).toEqual({ id, page: FINAL_OUTPUT_PAGE.id, group: "Secret marks", text: SECRET_MARK_WORDING[part] });
      expect(d.vars.filter((v) => v.required).map((v) => v.name)).toEqual(needs[part]);
    }
    // The rule may also name the word for everyone; a mark's part names nothing else.
    expect(codes(def(MARK_TEXT_IDS.rule), "Marks: {{forms}}; {{everyone}} means all.")).toEqual([]);
    expect(codes(def(MARK_TEXT_IDS.known), "{{text}} ({{known}}) {{forms}}")).toEqual(["unknown_placeholder"]);
    expect(codes(def(MARK_TEXT_IDS.kept), "{{text}} is hidden.")).toEqual(["missing_placeholder"]);
    // A mark always needs words: an empty word for everyone isn't saved, nor sent where it was stored.
    expect(codes(def(MARK_TEXT_IDS.everyone), "  ")).toEqual(["empty"]);
    expect(codes(def("narrator.source"), "")).toEqual([]);
    // What a turn is marked in: the user's own part where it can be sent, the shipped one for the rest.
    expect(markWording({ [MARK_TEXT_IDS.kept]: "{{text}} (hidden from {{kept}})", [MARK_TEXT_IDS.both]: "No placeholders.", [MARK_TEXT_IDS.everyone]: "" })).toEqual({ ...SECRET_MARK_WORDING, kept: "{{text}} (hidden from {{kept}})" });
  });
});

describe("resolution", () => {
  test("a built-in section reads the world's own wording, else the user's own text, else the shipped template", () => {
    const world = testWorld();
    const mine = { [sectionPromptId("scene")]: "Mine: where it happens.\n{{lines}}" };
    expect(template(world, "scene")).toBe(DEFAULT_SECTIONS.scene?.template);
    expect(template(world, "scene", mine)).toBe("Mine: where it happens.\n{{lines}}");
    const worded = { ...world, sectionTemplates: { scene: "The world's: where it happens.\n{{lines}}" } };
    expect(template(worded, "scene", mine)).toBe("The world's: where it happens.\n{{lines}}");
    // One without its lines, as a damaged set might hold, is never sent.
    expect(template(world, "scene", { [sectionPromptId("scene")]: "No lines." })).toBe(DEFAULT_SECTIONS.scene?.template);
  });

  test("an agent's text is the user's own over the shipped one, filled from its own placeholders only", () => {
    const vars = { world: "Port Alder", pov: "Jordan" };
    expect(resolvePrompt("gm.system", {}).source).toBe("default");
    expect(renderPrompt("gm.system", {}, vars)).toContain("Port Alder");
    expect(renderPrompt("gm.system", {}, vars)).not.toContain("{{");
    const own = { "gm.system": "Help the game master of {{world}}.{{nope}}" };
    expect(resolvePrompt("gm.system", own).source).toBe("user");
    expect(renderPrompt("gm.system", own, vars)).toBe("Help the game master of Port Alder.");
  });
});

describe("the user's own texts", () => {
  test("a text is stored only as it can be sent, the shipped text is never stored as the user's, and Reset brings it back", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    const user = host.userId;
    const texts = async (patch: Record<string, string | null>, more: JsonObject = {}) => (await store.set(user, { prompts: { texts: patch, ...more } })).prompts.texts;
    expect((await store.get(user)).prompts.texts).toEqual({});
    expect((await texts({ "narrator.marked_facts": "Keep secrets." }))["narrator.marked_facts"]).toBe("Keep secrets.");
    // A bad placeholder or a missing one: refused, and what was saved stays.
    expect((await texts({ "narrator.marked_facts": "Keep {{secrets}}." }))["narrator.marked_facts"]).toBe("Keep secrets.");
    expect(hasOwn(await texts({ [sectionPromptId("scene")]: "No lines." }), sectionPromptId("scene"))).toBe(false);
    // The shipped text word for word isn't the user's own, and an id no text has is nothing.
    expect(hasOwn(await texts({ [sectionPromptId("scene")]: DEFAULT_SECTIONS.scene?.template ?? "" }), sectionPromptId("scene"))).toBe(false);
    expect(hasOwn(await texts({ "no.such.text": "Anything." }), "no.such.text")).toBe(false);
    // Reset.
    expect(hasOwn(await texts({ "narrator.marked_facts": null }), "narrator.marked_facts")).toBe(false);
    // Past the longest a text of one's own may be: refused. Lowering the limit keeps a text already saved.
    expect(hasOwn(await texts({ "narrator.source": "A".repeat(21) }, { maxChars: 20 }), "narrator.source")).toBe(false);
    expect((await texts({ "narrator.source": "Short rules." }))["narrator.source"]).toBe("Short rules.");
    expect((await store.set(user, { prompts: { maxChars: 3 } })).prompts.texts["narrator.source"]).toBe("Short rules.");
    // As stored: a restart reads the same.
    expect((await new SettingsStore(host).get(user)).prompts).toEqual({ texts: { "narrator.source": "Short rules." }, maxChars: 3 });
  });

  test("a Re-narrate keeps its turn's texts until the user picks their current ones; a choice there isn't reads as the default", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    expect((await store.get(host.userId)).swipeTexts).toBe("turn");
    expect((await store.set(host.userId, { swipeTexts: "current" })).swipeTexts).toBe("current");
    expect((await store.set(host.userId, { swipeTexts: "sometimes" })).swipeTexts).toBe("turn");
  });

  test("a settings file from before the mark wording moved keeps the user's wording as their own texts, and keeps it where an earlier build reads it", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const kept = "{{text}} (hidden from {{kept}})";
    const rule = "Read a line written {{forms}} as a secret.";
    // The file's own text for the word for everyone stays: the stored part for it doesn't replace it.
    await host.storage.write("settings.json", JSON.stringify({ v: 1, narrator: { knowledge: "pov", secrets: "omit", marks: { kept, rule, everyone: "all of them" } }, prompts: { texts: { [MARK_TEXT_IDS.everyone]: "all but them" } } }), user);
    const store = new SettingsStore(host);
    const read = await store.get(user);
    expect(read.narrator).toEqual({ knowledge: "pov", secrets: "omit" });
    expect(read.prompts.texts).toEqual({ [MARK_TEXT_IDS.kept]: kept, [MARK_TEXT_IDS.rule]: rule, [MARK_TEXT_IDS.everyone]: "all but them" });
    expect(markWording(read.prompts.texts)).toEqual({ ...SECRET_MARK_WORDING, kept, rule, everyone: "all but them" });
    // The next write stores the texts, and keeps the wording where a build from before the move reads it, as the user's texts hold it.
    await store.set(user, { swipeTexts: "current" });
    const stored = JSON.parse((await host.storage.read("settings.json", user)) ?? "{}") as JsonObject;
    expect(stored.narrator).toEqual({ knowledge: "pov", secrets: "omit", marks: { kept, everyone: "all but them", rule } });
    expect(stored.prompts).toMatchObject({ texts: read.prompts.texts });
    // A part set back to the shipped text is gone from both, so it never comes back from the copy.
    await store.set(user, { prompts: { texts: { [MARK_TEXT_IDS.kept]: null } } });
    expect((JSON.parse((await host.storage.read("settings.json", user)) ?? "{}") as { narrator: JsonObject }).narrator.marks).toEqual({ everyone: "all but them", rule });
    expect(hasOwn((await new SettingsStore(host).get(user)).prompts.texts, MARK_TEXT_IDS.kept)).toBe(false);
    // A write in the old shape sends a key Settings no longer has: nothing of it is kept.
    const written = await store.set(user, { narrator: { marks: { known: "{{text}} ({{known}})" } } });
    expect(hasOwn(written.prompts.texts, MARK_TEXT_IDS.known)).toBe(false);
    expect(written.narrator).toEqual({ knowledge: "pov", secrets: "omit" });
    expect((JSON.parse((await host.storage.read("settings.json", user)) ?? "{}") as { narrator: JsonObject }).narrator.marks).toEqual({ everyone: "all but them", rule });
    // An empty word for everyone in an old file isn't the user's: the shipped one stands, as it did.
    await host.storage.write("settings.json", JSON.stringify({ v: 1, narrator: { knowledge: "pov", secrets: "omit", marks: { everyone: " " } } }), user);
    expect(hasOwn((await new SettingsStore(host).get(user)).prompts.texts, MARK_TEXT_IDS.everyone)).toBe(false);
  });
});

describe("Test", () => {
  const ANSWER: PromptContract = { id: "gm.answer", schema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false } };
  const answering: PromptDef = { ...def("gm.instructions"), contract: ANSWER.id };

  test("a text whose answer keeps a contract is run once, and an answer that breaks the contract fails", async () => {
    let asked = 0;
    const run = (reply: string) => async (): Promise<string> => {
      asked++;
      return reply;
    };
    const kept = await testPrompt(answering, "Answer in one line.", { maxChars: 20_000, contract: ANSWER, run: run('{"answer": "Danny is at the shop."}') });
    expect(kept).toEqual({ problems: [], contract: { answer: '{"answer": "Danny is at the shop."}', problems: [] } });
    const broken = await testPrompt(answering, "Answer in one line.", { maxChars: 20_000, contract: ANSWER, run: run('{"said": "Danny is at the shop."}') });
    expect(broken.contract?.problems.length).toBeGreaterThan(0);
    const prose = await testPrompt(answering, "Answer in one line.", { maxChars: 20_000, contract: ANSWER, run: run("Danny is at the shop.") });
    expect(prose.contract?.problems.length).toBeGreaterThan(0);
    expect(asked).toBe(3);
  });

  test("a text with a bad placeholder isn't run, and one without a contract is only checked", async () => {
    let asked = 0;
    const run = async (): Promise<string> => {
      asked++;
      return "{}";
    };
    const bad = await testPrompt(answering, "Answer about {{nope}}.", { maxChars: 20_000, contract: ANSWER, run });
    expect(bad.problems.map((p) => p.code)).toEqual(["unknown_placeholder"]);
    expect(bad.contract).toBeNull();
    expect(await testPrompt(def("gm.instructions"), "Answer in one line.", { maxChars: 20_000, contract: null, run })).toEqual({ problems: [], contract: null });
    expect(asked).toBe(0);
  });
});

describe("prompt sets", () => {
  test("a turn's set holds each text of the narrator's prompt as the user had it, and is stored once and read back by its hash", async () => {
    const set = turnPromptSet({ "narrator.marked_facts": "Keep secrets.", "gm.system": "Help." });
    expect(Object.keys(set.texts).sort()).toEqual(FINAL_OUTPUT_PROMPTS.map((d) => d.id).sort());
    expect(set.texts["narrator.marked_facts"]).toBe("Keep secrets.");
    expect(set.texts[sectionPromptId("scene")]).toBe(DEFAULT_SECTIONS.scene?.template);
    // The wording of a secret's mark is among them, so a Re-narrate is marked as its turn was.
    expect(set.texts[MARK_TEXT_IDS.known]).toBe(SECRET_MARK_WORDING.known);
    expect(set.texts[MARK_TEXT_IDS.rule]).toBe(SECRET_MARK_WORDING.rule);
    const host = new FakeHost();
    const sets = new PromptSets(host);
    const hash = await sets.put(host.userId, set);
    expect(await new PromptSets(host).put(host.userId, set)).toBe(hash);
    expect(await sets.get(host.userId, hash)).toEqual(set);
  });

  test("a hash that isn't one, or a file that isn't the set its name says, reads as no set", async () => {
    const host = new FakeHost();
    const sets = new PromptSets(host);
    // A set never stored is none.
    expect(await sets.get(host.userId, "0".repeat(32))).toBeNull();
    expect(await sets.get(host.userId, "../settings")).toBeNull();
    const forged = "1".repeat(32);
    await host.storage.write(`prompts/sets/${forged}.json`, JSON.stringify(turnPromptSet({})), host.userId);
    expect(await sets.get(host.userId, forged)).toBeNull();
  });
});
