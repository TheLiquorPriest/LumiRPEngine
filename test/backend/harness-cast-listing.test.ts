// The tools as the harness lists them (`harnessTools`): every tool the old engines' agents are
// given is listed under its own name, with its family and a tier, or is one the harness has its own
// of; the harness engine's own tools are listed beside them, and are no tool of the old engines, so
// those engines send and run exactly what they did.

import { describe, expect, test } from "bun:test";
import { HARNESS_LISTED, HARNESS_OWN_NEEDS, HARNESS_SUPERSEDED, type HarnessNeeds, harnessTools } from "../../src/backend/agents/tools/harness";
import { HARNESS_TOOL_DEFINITIONS } from "../../src/backend/agents/tools/harness-tools";
import { describedSchema, TOOL_DEFINITIONS, toolsFor } from "../../src/backend/agents/tools/registry";
import type { RemoteTool } from "../../src/backend/harness/shapes";
import { TOOL_TEXTS, toolArgTextId, toolText, toolTextId } from "../../src/shared/agent-tools";
import { HARNESS_TOOL, HARNESS_TOOL_TEXTS, harnessToolText } from "../../src/shared/harness-texts";
import { NESTED_ARG_TEXTS } from "../../src/shared/harness-texts-args";
import { BUILD_TOOL } from "../../src/shared/harness-texts-build";
import { MINDS_TOOL } from "../../src/shared/harness-texts-minds";
import { PEOPLE_TOOL } from "../../src/shared/harness-texts-people";
import { PLAY_TOOL } from "../../src/shared/harness-texts-play";
import { PREPARE_TOOL } from "../../src/shared/harness-texts-prepare";
import { RECORD_TOOL } from "../../src/shared/harness-texts-record";
import { STAGE_TOOL } from "../../src/shared/harness-texts-stage";
import { STORY_TOOL } from "../../src/shared/harness-texts-story";
import { HARNESS_DESCRIBED, SURFACE_TOOL } from "../../src/shared/harness-texts-surfaces";
import { WORLD_TOOL } from "../../src/shared/harness-texts-world";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import { promptDef, type PromptTexts } from "../../src/shared/prompts";
import type { UserSettings } from "../../src/shared/settings";
import { defaultSettings } from "../../src/backend/settings-store";
import { stateOf } from "../support/mind-chat";
import { alderChat, toolEnv } from "../support/tools";

/** The harness's list for a Port Alder chat, in `texts` and under the settings `change` makes, with the chat it was read for. */
async function listed(texts: PromptTexts = {}, change: (s: UserSettings) => void = () => undefined): Promise<{ tools: RemoteTool[]; old: { name: string; parameters: JsonObject }[] }> {
  const { rig, chatId } = await alderChat();
  const { world } = await stateOf(rig, chatId);
  // What an agent of the old engines is given of the same tools, for the comparison: every tier, every family.
  const old = toolsFor({ world, tiers: ["read", "story", "gm"], texts, env: toolEnv(rig, chatId, "gm") });
  const settings = structuredClone(defaultSettings());
  settings.prompts.texts = texts;
  change(settings);
  return { tools: harnessTools({ world, registry: rig.rt.registry, settings }), old };
}

/** The schema at a dotted path of `schema`: through nested properties and an array's items. */
function at(schema: JsonObject, path: string): JsonObject | null {
  let node: JsonValue | undefined = schema;
  for (const key of path.split(".")) {
    const holder: JsonValue | undefined = isRecord(node) && node.type === "array" ? node.items : node;
    node = isRecord(holder) && isRecord(holder.properties) ? holder.properties[key] : undefined;
  }
  return isRecord(node) ? node : null;
}

/** What breaks a schema for a connection that takes one type a node and no object without properties (a Gemini connection): each as `path: what`. */
function unsafe(schema: JsonValue | undefined, path = "$"): string[] {
  if (!isRecord(schema)) return [`${path}: not a schema`];
  const out: string[] = [];
  if (typeof schema.type !== "string") out.push(`${path}: no single type`);
  for (const key of ["anyOf", "oneOf", "allOf"]) if (key in schema) out.push(`${path}: ${key}`);
  if (schema.type === "object") {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Object.keys(properties).length === 0) out.push(`${path}: an object of no properties`);
    for (const [key, child] of Object.entries(properties)) out.push(...unsafe(child, `${path}.${key}`));
  }
  if (schema.type === "array") out.push(...unsafe(schema.items, `${path}[]`));
  return out;
}

describe("the tools the harness lists", () => {
  test("every tool of the old engines is listed under its own name, with its family and a tier, or is one the harness supersedes: never both, and nothing twice", async () => {
    const { tools, old } = await listed();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const def of TOOL_DEFINITIONS) {
      const tool = tools.find((t) => t.name === def.name);
      const superseded = hasOwn(HARNESS_SUPERSEDED, def.name);
      // Listed or superseded, one or the other.
      expect({ name: def.name, listed: tool !== undefined }).toEqual({ name: def.name, listed: !superseded });
      if (!tool) continue;
      // Its own family; a tool that only reads is `read`, one that changes what the engine keeps is `write`, and none acts outside the engine's record.
      expect({ name: tool.name, family: tool.family, tier: tool.tier, source: tool.source }).toEqual({ name: def.name, family: def.family, tier: def.tier === "read" ? "read" : "write", source: "extension" });
      // Its description is the old engines' own, but for a tool that works otherwise on the harness (a lore file goes to the harness's workspace), which is described for it in a text of its own.
      expect({ name: tool.name, description: tool.description }).toEqual({ name: def.name, description: promptDef(hasOwn(HARNESS_DESCRIBED, def.name) ? HARNESS_DESCRIBED[def.name] : toolTextId(def.name))?.text ?? "" });
      if (hasOwn(HARNESS_DESCRIBED, def.name)) expect({ name: def.name, own: tool.description !== (promptDef(toolTextId(def.name))?.text ?? "") }).toEqual({ name: def.name, own: true });
      // The same arguments, described the same, as an agent of the old engines is given; and, on the harness alone, a description for each argument below the top level that the old engines tell in the one above it.
      const given = old.find((t) => t.name === def.name);
      if (given) expect({ name: tool.name, parameters: tool.parameters }).toEqual({ name: def.name, parameters: describedSchema(def.name, NESTED_ARG_TEXTS.filter((a) => a.tool === def.name), given.parameters, {}) });
    }
    // What the harness doesn't list, and why each: the workspace's tools, which are LumiAH's there, and the one that makes a model call of the engine's own.
    expect(Object.keys(HARNESS_SUPERSEDED).sort()).toEqual(["condense", "workspace_delete", "workspace_edit", "workspace_grep", "workspace_list", "workspace_move", "workspace_pin", "workspace_read", "workspace_write"]);
    for (const [name, why] of Object.entries(HARNESS_SUPERSEDED)) expect({ name, real: TOOL_DEFINITIONS.some((d) => d.name === name), why: why.length > 20 }).toEqual({ name, real: true, why: true });
    expect(tools.length).toBe(TOOL_DEFINITIONS.length - Object.keys(HARNESS_SUPERSEDED).length + HARNESS_TOOL_DEFINITIONS.length);
    expect(tools.every((t) => t.tier === "read" || t.tier === "write")).toBe(true);
    // The engine's lore tools are kept: they read lore as the chat's knowledge marks and gates it.
    for (const name of ["lore_index", "lore_search", "lore_grep", "lore_read", "lore_load"]) expect(tools.find((t) => t.name === name)).toMatchObject({ family: "lore", tier: "read" });
    // And the two that keep a lore entry as a file are listed again: the file goes to the harness's workspace.
    for (const name of ["lore_save", "lore_draft"]) expect(tools.find((t) => t.name === name)).toMatchObject({ family: "lore", tier: "write" });
  });

  test("each argument of every listed tool carries its own description, never another argument's", async () => {
    const { tools } = await listed();
    for (const tool of tools) {
      const text = toolText(tool.name) ?? harnessToolText(tool.name);
      expect({ name: tool.name, texts: text !== undefined }).toEqual({ name: tool.name, texts: true });
      for (const arg of text?.args ?? []) expect({ arg: `${tool.name}.${arg.path}`, description: at(tool.parameters, arg.path)?.description }).toEqual({ arg: `${tool.name}.${arg.path}`, description: arg.text });
      const top = Object.keys(isRecord(tool.parameters.properties) ? tool.parameters.properties : {});
      expect({ name: tool.name, undescribed: top.filter((key) => !(text?.args ?? []).some((a) => a.path === key)) }).toEqual({ name: tool.name, undescribed: [] });
    }
    // The four that once carried `dry`'s description, the node their schema shared with it.
    const described = (name: string, path: string): unknown => at(tools.find((t) => t.name === name)?.parameters ?? {}, path)?.description;
    expect([described("item_make", "hidden"), described("item_home", "owner"), described("item_home", "clear"), described("item_wear", "off")]).toEqual(["true: hidden until searched.", "true: it is kept on its owner.", "true: the engine works out where it is kept.", "true: taken off."]);
    for (const name of ["item_make", "item_home", "item_wear"]) expect(described(name, "dry")).toBe("true: check only; nothing is staged.");
  });

  test("every argument of every listed tool has a description at every depth, each a text of the registry the user may replace", async () => {
    const { tools } = await listed();
    /** Each property below `schema`, by its dotted path: through nested objects and an array's items. */
    const below = (schema: unknown, prefix = ""): { path: string; node: Record<string, unknown> }[] => {
      if (!isRecord(schema)) return [];
      if (schema.type === "array") return below(schema.items, prefix);
      if (!isRecord(schema.properties)) return [];
      return Object.entries(schema.properties).flatMap(([key, node]) => (isRecord(node) ? [{ path: `${prefix}${key}`, node }, ...below(node, `${prefix}${key}.`)] : []));
    };
    const undescribed: string[] = [];
    const unregistered: string[] = [];
    for (const tool of tools) {
      for (const { path, node } of below(tool.parameters)) {
        if (typeof node.description !== "string" || node.description.trim() === "") undescribed.push(`${tool.name}.${path}`);
        else if (promptDef(toolArgTextId(tool.name, path))?.text !== node.description) unregistered.push(`${tool.name}.${path}`);
      }
    }
    expect(undescribed).toEqual([]);
    expect(unregistered).toEqual([]);
    // The nineteen the old engines tell in the description above them, described for the harness alone.
    const nested = ["money", "gear", "vehicles", "castlife", "relationships", "space", "calendar", "weather", "sheets"].map((d) => `gm_set_entity.levels.${d}`);
    nested.push(...["make", "model", "year", "colour", "plate", "specs", "specs.label", "specs.value"].map((p) => `item_make.details.${p}`), "item_label.specs.label", "item_label.specs.value");
    expect(NESTED_ARG_TEXTS.map((a) => `${a.tool}.${a.path}`)).toEqual(nested);
  });

  test("the harness engine's own tools are listed with the family and tier their texts say, each argument described, in schemas every connection takes", async () => {
    const { tools } = await listed();
    const names = [HARNESS_TOOL, PLAY_TOOL, MINDS_TOOL, PEOPLE_TOOL, STORY_TOOL, SURFACE_TOOL, WORLD_TOOL, BUILD_TOOL, RECORD_TOOL, STAGE_TOOL, PREPARE_TOOL].flatMap((family) => Object.values<string>(family));
    expect(HARNESS_TOOL_DEFINITIONS.map((d) => d.name)).toEqual(names);
    expect(HARNESS_TOOL_TEXTS.map((t) => t.name)).toEqual(names);
    const own = tools.filter((t) => HARNESS_TOOL_DEFINITIONS.some((d) => d.name === t.name));
    expect(own.map((t) => [t.name, t.family, t.tier])).toEqual([
      ["checks_stakes", "checks", "read"],
      ["time_pass", "time", "write"],
      ["commit", "turn", "write"],
      ["grant_writes", "turn", "write"],
      ["action_play", "checks", "write"],
      ["fight_read", "fights", "read"],
      ["fight_start", "fights", "write"],
      ["fight_round", "fights", "write"],
      ["fight_end", "fights", "write"],
      ["mind_fight", "mind", "write"],
      ["mind_read", "mind", "read"],
      ["mind_write", "mind", "write"],
      ["mind_digested", "mind", "write"],
      ["mind_seed", "minds", "read"],
      ["person_make", "people", "write"],
      ["item_away", "items", "write"],
      ["gm_take_out", "places", "write"],
      ["place_remove", "places", "write"],
      ["set_drop", "items", "write"],
      ["gm_effects", "money", "read"],
      ["sections_read", "knowledge", "read"],
      ["world_status", "world", "read"],
      ["world_read", "world", "read"],
      ["world_shape", "world", "read"],
      ["world_put", "world", "write"],
      ["world_remove", "world", "write"],
      ["world_set", "world", "write"],
      ["world_patch", "world", "write"],
      ["world_discard", "world", "write"],
      ["world_commit", "world", "write"],
      ["world_upgrade", "world", "write"],
      ["world_history", "world", "read"],
      ["world_restore", "world", "write"],
      ["world_made", "world", "read"],
      ["world_keep", "world", "write"],
      ["world_place", "world", "write"],
      ["world_path", "world", "write"],
      ["world_map", "world", "write"],
      ["world_map_place", "world", "write"],
      ["world_map_link", "world", "write"],
      ["world_map_settings", "world", "write"],
      ["beat_write", "story", "write"],
      ["beats_read", "story", "read"],
      ["beat_strike", "story", "write"],
      ["feed_read", "mind", "read"],
      ["cast_set", "story", "write"],
      ["cast_list", "story", "read"],
      ["draft_open", "story", "write"],
      ["draft_settle", "story", "write"],
      ["draft_drop", "story", "write"],
      ["drafts_due", "story", "read"],
      ["narration_read", "narration", "read"],
      ["passage_draft", "narration", "write"],
      ["passage_read", "narration", "read"],
      ["passage_check", "narration", "write"],
      ["prepare_survey", "prepare", "read"],
      ["prepare_status", "prepare", "read"],
      ["prepare_plan", "prepare", "write"],
      ["prepare_relive", "prepare", "write"],
      ["stretch_read", "prepare", "read"],
      ["stretch_beats", "prepare", "write"],
      ["stretch_done", "prepare", "write"],
      ["prepare_outline", "prepare", "write"],
      ["prepare_finish", "prepare", "write"],
    ]);
    for (const text of HARNESS_TOOL_TEXTS) {
      const tool = own.find((t) => t.name === text.name);
      const def = HARNESS_TOOL_DEFINITIONS.find((d) => d.name === text.name);
      expect({ name: text.name, family: tool?.family, tier: tool?.tier, defFamily: def?.family, defTier: def?.tier, description: tool?.description, source: tool?.source }).toEqual({ name: text.name, family: text.family, tier: text.tier, defFamily: text.family, defTier: text.tier, description: text.text, source: "extension" });
      // Each argument its texts describe is in its schema, with that description; every top-level argument is described.
      for (const arg of text.args) expect({ arg: `${text.name}.${arg.path}`, description: at(tool?.parameters ?? {}, arg.path)?.description }).toEqual({ arg: `${text.name}.${arg.path}`, description: arg.text });
      const top = Object.keys(isRecord(tool?.parameters.properties) ? tool.parameters.properties : {});
      expect({ name: text.name, described: text.args.filter((a) => !a.path.includes(".")).map((a) => a.path).sort() }).toEqual({ name: text.name, described: [...top].sort() });
      expect({ name: text.name, unsafe: unsafe(tool?.parameters) }).toEqual({ name: text.name, unsafe: [] });
      expect(top.length).toBeGreaterThan(0);
    }
  });

  test("the harness engine's own tools are no tool of the old engines: a classic step and an agents-engine role are given none of them", async () => {
    const { old } = await listed();
    const own = HARNESS_TOOL_DEFINITIONS.map((d) => d.name);
    expect(TOOL_DEFINITIONS.map((d) => d.name).filter((n) => own.includes(n))).toEqual([]);
    expect(TOOL_TEXTS.map((t) => t.name).filter((n) => own.includes(n))).toEqual([]);
    expect(old.map((t) => t.name).filter((n) => own.includes(n))).toEqual([]);
    expect(old.length).toBeGreaterThan(60);
  });

  test("the knowledge agent's tools and the reading of the reply after it are retired: the harness lists none of them, and no text of its names them", async () => {
    const { tools } = await listed();
    const retired = ["knowledge_scene", "knowledge_infer", "story_record", "story_departure"];
    expect(tools.map((t) => t.name).filter((n) => retired.includes(n))).toEqual([]);
    expect(HARNESS_LISTED.map((t) => t.name).filter((n) => retired.includes(n))).toEqual([]);
    expect(HARNESS_TOOL_TEXTS.map((t) => t.name).filter((n) => retired.includes(n))).toEqual([]);
    expect([...HARNESS_OWN_NEEDS.keys()].filter((n) => retired.includes(n))).toEqual([]);
  });

  test("a description is the user's own where they wrote one, for the old engines' tools and the harness's alike", async () => {
    const mine = { [toolTextId("checks_stakes")]: "Read it.", [toolArgTextId("time_pass", "minutes")]: "Minutes, whole.", [toolArgTextId("mind_write", "append")]: "Add it at the end.", [toolTextId("people_where")]: "Where is someone?" };
    const { tools } = await listed(mine);
    const of = (name: string): RemoteTool | undefined => tools.find((t) => t.name === name);
    expect(of("checks_stakes")?.description).toBe("Read it.");
    expect(at(of("time_pass")?.parameters ?? {}, "minutes")?.description).toBe("Minutes, whole.");
    expect(at(of("mind_write")?.parameters ?? {}, "append")?.description).toBe("Add it at the end.");
    expect(of("people_where")?.description).toBe("Where is someone?");
    // What they didn't write stays as shipped.
    expect(of("commit")?.description).toBe(HARNESS_TOOL_TEXTS.find((t) => t.name === "commit")?.text ?? "");
  });

  test("the list without a world says the same: each tool's family and tier, and the writer tier the engine takes it at", async () => {
    const { tools } = await listed();
    expect(HARNESS_LISTED.map((t) => [t.name, t.family, t.tier])).toEqual(tools.map((t) => [t.name, t.family, t.tier]));
    for (const tool of HARNESS_LISTED) {
      const def = TOOL_DEFINITIONS.find((d) => d.name === tool.name);
      // The harness engine's own record through the turn itself, not through a writer.
      expect({ name: tool.name, writer: tool.writer }).toEqual({ name: tool.name, writer: def ? def.tier : null });
      // Who may call it: one of the old engines' at its writer tier, one of the harness engine's own as the table beside the list says.
      const says: HarnessNeeds | undefined = def ? def.tier : HARNESS_OWN_NEEDS.get(tool.name);
      expect({ name: tool.name, says }).toEqual({ name: tool.name, says: tool.needs });
    }
    // Who may call each of the harness engine's own tools is said for every one of them, and for nothing that isn't one.
    expect([...HARNESS_OWN_NEEDS.keys()].sort()).toEqual(HARNESS_TOOL_DEFINITIONS.map((d) => d.name).sort());
  });

  test("a tool read whole names how much of its answer reaches the model so, from the player's settings, and no other tool names any", async () => {
    const whole = (tools: readonly RemoteTool[]) => Object.fromEntries(tools.flatMap((t) => (t.wholeChars === undefined ? [] : [[t.name, t.wholeChars]])));
    const shipped = whole((await listed()).tools);
    const { prepare, minds } = defaultSettings().story;
    expect(shipped[PREPARE_TOOL.read]).toBe(prepare.readChars);
    expect(shipped[PREPARE_TOOL.survey]).toBe(prepare.surveyChars);
    // A mind is read whole: every file full, each under its head.
    const files = Object.values(minds.chars).reduce((sum, n) => sum + n, 0);
    expect(shipped[MINDS_TOOL.read]).toBeGreaterThan(files);
    expect(shipped[MINDS_TOOL.read]).toBeLessThan(files + 4000);
    expect(Object.keys(shipped).sort()).toEqual([MINDS_TOOL.read, PREPARE_TOOL.survey, PREPARE_TOOL.read].sort());
    // Changed in Settings, the bounds follow.
    const changed = whole(
      (
        await listed({}, (s) => {
          s.story.prepare.readChars = 9000;
          s.story.prepare.surveyChars = 7000;
          s.story.minds.chars.memory += 10_000;
        })
      ).tools,
    );
    expect([changed[PREPARE_TOOL.read], changed[PREPARE_TOOL.survey]]).toEqual([9000, 7000]);
    // The memory file's 10,000 more, and its head's longer figures.
    const grown = (changed[MINDS_TOOL.read] ?? 0) - (shipped[MINDS_TOOL.read] ?? 0);
    expect(grown >= 10_000 && grown < 10_010).toBe(true);
  });
});
