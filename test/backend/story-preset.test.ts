// The chat's preset as the story engine reads it (DEPTH2-PLAN §7): each block goes to the part its
// category names, and a block in no known category to the narrator; a switched-off block is left
// out; a part keeps to its size limit, leaving a block out whole; the author is given the
// presentation modules by name and the narrator a module's text only when it is asked for, a name
// no module has refused; the preset's variables reach the macros; and a pass that can't be split
// back into its blocks resolves each block alone.

import { describe, expect, test } from "bun:test";
import type { HostPresetBlock, HostPromptValues } from "../../src/backend/host";
import { presetFor, readStoryPreset, type StoryPresetHost } from "../../src/backend/story/preset";
import { STORY_PRESET_DEFAULTS, type StoryPresetSettings } from "../../src/shared/settings";
import { HOST_REPO, hostTwoPass } from "../support/host-macros";

const block = (name: string, content: string, more: Partial<HostPresetBlock> = {}): HostPresetBlock => ({ id: `b_${name}`, name, content, enabled: true, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null, ...more });
const category = (name: string): HostPresetBlock => block(name, "", { marker: "category" });

/** A made-up preset on a host whose macro engine is `resolve`. */
function hostOf(blocks: HostPresetBlock[], resolve: (template: string) => string, more: { states?: Record<string, boolean>; values?: HostPromptValues } = {}): StoryPresetHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    presets: {
      active: async () => ({ presetId: "p1", blockStates: more.states ?? {} }),
      get: async (id) => ({ id, name: "Made up", revision: 3, values: more.values ?? {} }),
      blocks: async () => structuredClone(blocks),
    },
    macros: {
      resolve: async (template) => {
        calls.push(template);
        return { text: resolve(template), diagnostics: [] };
      },
    },
  };
}

/** A stand-in for Lumiverse's macros: {{user}}, the card's post-history instructions, {{setvar}} in its scoped form and {{var}}, left to right. */
function tinyMacros(template: string): string {
  const vars = new Map<string, string>();
  return template.replace(/\{\{setvar::([^}]+)\}\}([\s\S]*?)\{\{\/setvar\}\}|\{\{var::([^}:]+)\}\}|\{\{user\}\}|\{\{charPostHistoryInstructions\}\}/g, (token, setName?: string, setValue?: string, getName?: string) => {
    if (setName !== undefined) {
      vars.set(setName, setValue ?? "");
      return "";
    }
    if (getName !== undefined) return vars.get(getName) ?? "";
    return token === "{{user}}" ? "Alice" : "The card's own note.";
  });
}

const settings = (limits: Partial<StoryPresetSettings["limits"]> = {}): StoryPresetSettings => ({ categories: { ...STORY_PRESET_DEFAULTS.categories }, limits: { ...STORY_PRESET_DEFAULTS.limits, ...limits } });

describe("the story engine's preset reader", () => {
  test("each block goes to the part its category names, a block in no known category to the narrator, and a switched-off block nowhere", async () => {
    const host = hostOf(
      [
        block("Loose start", "Before any category."),
        category("✦ Story contract ✦"),
        block("Truths", "This is {{user}}'s story.\n// a note for the preset's writer only"),
        category("Author"),
        block("Direction", "Decide what the world does."),
        category("characters"),
        block("Being a person", "You are this person."),
        block("Old habit", "Switched off in the preset.", { enabled: false }),
        block("Off for this chat", "Switched off by the chat's binding."),
        category("Game master"),
        block("Rulings", "Rule on what is contested."),
        category("Voice"),
        block("Lines", "Second person, past tense."),
        category("Narrator"),
        block("Prose", "Write the beats as prose."),
        category("Odds and ends"),
        block("Stray", "In a category no one named."),
      ],
      tinyMacros,
      { states: { "b_Off for this chat": false } },
    );
    const read = await readStoryPreset(host, "c1", "u1", settings());
    expect(read.preset).toEqual({ id: "p1", name: "Made up", revision: 3 });
    expect(read.parts).toEqual({
      contract: "This is Alice's story.",
      author: "Decide what the world does.",
      character: "You are this person.",
      gm: "Rule on what is contested.",
      voice: "Second person, past tense.",
      // The card's own post-history instructions end the narrator's part when no block names them.
      narrator: "Before any category.\n\nWrite the beats as prose.\n\nIn a category no one named.\n\nThe card's own note.",
    });
    expect(read.separately).toBe(false);
    expect(host.calls).toHaveLength(1);
    expect(presetFor(read, "character", {}).text).toBe("This is Alice's story.\n\nYou are this person.");
    expect(presetFor(read, "direct", {}).text).toBe("This is Alice's story.\n\nYou are this person.\n\nSecond person, past tense.");
    expect(presetFor(read, "gm", {}).text).toBe("This is Alice's story.\n\nRule on what is contested.");
    expect(presetFor(read, "narrator", {}).text.startsWith("This is Alice's story.\n\nSecond person, past tense.\n\nBefore any category.")).toBe(true);
  });

  test("a part keeps to its size limit: a block that would pass it is left out whole, and the read names it", async () => {
    const host = hostOf([category("Author"), block("Short", "Ten chars."), block("Long", "x".repeat(50)), block("Tail", "Tail ends.")], (t) => t);
    const read = await readStoryPreset(host, "c1", "u1", settings({ author: 100 }));
    expect(read.parts.author).toBe(`Ten chars.\n\n${"x".repeat(50)}\n\nTail ends.`);
    const tight = await readStoryPreset(host, "c1", "u1", settings({ author: 30 }));
    expect(tight.parts.author).toBe("Ten chars.\n\nTail ends.");
    expect(tight.over).toEqual([{ part: "author", block: "Long", chars: 50 }]);
  });

  test("the author is given the modules by name with their lines; the narrator a module's text only when asked for it by name; a name no module has is refused", async () => {
    const host = hostOf(
      [
        category("Presentation modules"),
        block("Phone texts", "// When someone texts, the thread as their phone shows it.\nPHONE RULES"),
        block("Chapter header", "Start the passage with a chapter header.\nMore of it."),
        block("Weather header", "{{var::Weather}}"),
        category("Narrator"),
        block("Prose", "Write the beats."),
      ],
      tinyMacros,
    );
    const read = await readStoryPreset(host, "c1", "u1", settings());
    // A module whose text is empty (its variable off) isn't offered.
    expect(read.modules.map((m) => [m.name, m.line])).toEqual([
      ["Phone texts", "When someone texts, the thread as their phone shows it."],
      ["Chapter header", "Start the passage with a chapter header."],
    ]);
    const author = presetFor(read, "author", {}).text;
    expect(author).toContain("- Phone texts: When someone texts, the thread as their phone shows it.\n- Chapter header: Start the passage with a chapter header.");
    expect(author).not.toContain("PHONE RULES");
    expect(presetFor(read, "narrator", {}).text).not.toContain("PHONE RULES");
    const asked = presetFor(read, "narrator", {}, ["phone TEXTS"]);
    expect(asked.text).toContain("PHONE RULES");
    expect(asked.text).not.toContain("chapter header");
    expect(asked.refused).toBeNull();
    const missing = presetFor(read, "narrator", {}, ["Weather header", "Chapter header"]);
    expect(missing.text).toContain("Start the passage with a chapter header.");
    expect(missing.refused).toBe("There is no presentation module called Weather header. The modules are: Phone texts, Chapter header.");
  });

  test("the preset's variables reach the macros as the preset's user set them, a multiselect's queries answered", async () => {
    const host = hostOf(
      [
        category("Settings"),
        block("Prose settings", "", {
          variables: [
            { name: "Length", type: "select", defaultValue: "short", options: [{ id: "short", value: "Keep it short." }, { id: "long", value: "Take your time." }] },
            { name: "Extras", type: "multiselect", defaultValue: [], options: [{ id: "a", value: "A" }, { id: "b", value: "B" }] },
          ],
        }),
        category("Narrator"),
        block("Prose", "Length: {{var::Length}} B chosen: {{var::Extras::ison::b}}. A chosen: {{VAR::Extras::ison::a}}."),
      ],
      tinyMacros,
      { values: { "b_Prose settings": { Length: "long", Extras: ["b"] } } },
    );
    const read = await readStoryPreset(host, "c1", "u1", settings());
    expect(read.parts.narrator.split("\n\n")[0]).toBe("Length: Take your time. B chosen: true. A chosen: false.");
  });

  test("a block whose braces don't match is read on its own, and a pass that can't be split back into its blocks reads each block alone", async () => {
    // A macro engine that loses the marks between blocks when given more than one.
    const host = hostOf([category("Author"), block("One", "First."), block("Two", "Second.")], (t) => (t.split("\u27E6").length > 2 ? "garbled" : t));
    const read = await readStoryPreset(host, "c1", "u1", settings());
    expect(read.separately).toBe(true);
    expect(read.parts.author).toBe("First.\n\nSecond.");
    expect(host.calls).toHaveLength(4);

    // A block with a macro never closed is kept out of the one pass, which still splits back.
    const lone = hostOf([category("Author"), block("Broken", "Kept {{if::{{var::x}} open"), block("Fine", "Whole.")], (t) => t);
    const kept = await readStoryPreset(lone, "c1", "u1", settings());
    expect(kept.separately).toBe(false);
    expect(kept.parts.author).toBe("Kept {{if::{{var::x}} open\n\nWhole.");
    expect(lone.calls).toHaveLength(2);
    expect(lone.calls[0]).not.toContain("Kept");
    expect(kept.diagnostics).toContain(`The preset's block "Broken" has a macro whose braces don't match, so it was read on its own.`);
  });

  test.skipIf(HOST_REPO === null)("Lumiverse's own macro engine reads the seeded variables, a variable one block sets reaches the next, and the pass splits back", async () => {
    const repo = HOST_REPO ?? "";
    const host = hostOf(
      [
        category("Settings"),
        block("Prose settings", "", { variables: [{ name: "Mode", type: "select", defaultValue: "a", options: [{ id: "a", value: "novel" }, { id: "b", value: "roleplay" }] }] }),
        category("Narrator"),
        block("Mode", "{{if::{{eq::{{var::Mode}}::novel}}}}NOVEL{{else}}OTHER{{/if}} {{setvar::Flag::On}}"),
        block("After", "{{if::{{getvar::Flag}}}}FLAG SEEN{{/if}} for {{user}}"),
      ],
      (template) => hostTwoPass(repo, [template])[0]?.first ?? "",
      { values: { "b_Prose settings": { Mode: "a" } } },
    );
    const read = await readStoryPreset(host, "c1", "u1", settings());
    expect(read.separately).toBe(false);
    expect(read.parts.narrator.startsWith("NOVEL\n\nFLAG SEEN for Alice")).toBe(true);
  });
});
