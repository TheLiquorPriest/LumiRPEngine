// The agent tool layer's registry and read view (INC1-SPEC C6, R3a): the GM agent page lists exactly
// the tools there are, each with its description and its arguments'; an edited text reaches the tool
// `toolsFor` gives, and its reset brings the shipped one back; no schema names a place or an action
// under the player character's knowledge; the resolver names only what the view may, so a hidden one
// reads as one that doesn't exist; and a World Info entry's text reaches each view with its marks
// marked, in the user's wording, or left out where the player character doesn't hold them.

import { describe, expect, test } from "bun:test";
import { type Resolved, resolvePerson, resolvePlace, resolveTrack } from "../../src/backend/agents/tools/resolve";
import { type AgentOp, outsideWriter, type ToolWriter } from "../../src/backend/agents/tools/writer";
import { badValue, schemaWorld } from "../../src/backend/agents/tools/schema";
import { renderPrompt } from "../../src/backend/prompts";
import { TOOL_DEFINITIONS, toolsFor } from "../../src/backend/agents/tools/registry";
import { promptGroups } from "../../src/frontend/settings/agent-prompts";
import { TOOL_NOTE, TOOL_NOTES, TOOL_TEXTS, toolArgTextId, toolText, toolTextId } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { GM_AGENT_PAGE, promptDef } from "../../src/shared/prompts";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { agentTools, alderChat, HOME, KNOWLEDGE, toolEnv } from "../support/tools";

const FERRY = "FERRY-MARK: the ferry runs twice a day.";
const DEBT = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
const WRECK = "WRECK-MARK: the old boat went down with the marina's records aboard.";
const SEEN = "SEEN-MARK: Jordan saw the boat go down from the breakwater.";

/** A person no one in Port Alder knows of: the world keeps him secret, standing where Jordan wakes. */
const VEX: JsonObject = { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] };

/** The top-level arguments a tool's texts describe. */
const argsOf = (name: string): string[] => [...new Set((toolText(name)?.args ?? []).map((a) => a.path.split(".")[0] ?? a.path))].sort();

const propertiesOf = (schema: JsonObject): JsonObject => (schema.properties ?? {}) as JsonObject;

/** Whether a schema carries a description anywhere: a `description` that is text, never a property named so. */
function describes(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(describes);
  if (typeof node !== "object" || node === null) return false;
  return Object.entries(node).some(([key, value]) => (key === "description" && typeof value === "string") || describes(value));
}

/**
 * Where a schema holds what a Gemini connection refuses, at any depth: a node with no type of its
 * own (none, or a list of types), a union (`anyOf`, `oneOf`), or an object with no properties of its
 * own (a free-form one, whose keys only `additionalProperties` would name, or one with none at all),
 * the tool's own top level included: Gemini refuses a function whose parameters are an object of no
 * properties ("parameters.properties: should be non-empty for OBJECT type"). Its nodes are the
 * schema itself and each property's, items' and additional properties' schema. The host's Gemini
 * sanitizer (Lumiverse's `sanitizeGeminiSchema`, outside this repository) only drops keys Gemini
 * doesn't take, `additionalProperties` among them, and keeps `properties`: what is checked here is
 * what it sends.
 */
function geminiRefuses(node: unknown, at = "$"): string[] {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return [`${at}: not a schema`];
  const n = node as JsonObject;
  const props = typeof n.properties === "object" && n.properties !== null && !Array.isArray(n.properties) ? n.properties : null;
  const bare = n.type === "object" && (props === null || Object.keys(props).length === 0);
  const own = [...(typeof n.type === "string" ? [] : [`${at}.type`]), ...["anyOf", "oneOf"].filter((key) => key in n).map((key) => `${at}.${key}`), ...(bare ? [`${at}.properties`] : [])];
  const properties = props !== null ? Object.entries(props).flatMap(([name, p]) => geminiRefuses(p, `${at}.properties.${name}`)) : [];
  const items = n.items !== undefined ? geminiRefuses(n.items, `${at}.items`) : [];
  const more = typeof n.additionalProperties === "object" && n.additionalProperties !== null ? geminiRefuses(n.additionalProperties, `${at}.additionalProperties`) : [];
  return [...own, ...properties, ...items, ...more];
}

describe("the GM agent page lists exactly the tools", () => {
  test("each tool's description and each of its arguments' are texts of the page's Tools group, and nothing else is", () => {
    const listed = promptGroups(GM_AGENT_PAGE).find((g) => g.title === "Tools")?.defs.map((d) => d.id) ?? [];
    const tools = TOOL_DEFINITIONS.flatMap((def) => [toolTextId(def.name), ...(toolText(def.name)?.args ?? []).map((a) => toolArgTextId(def.name, a.path))]);
    expect([...listed].sort()).toEqual([...tools].sort());
    expect(TOOL_TEXTS.map((t) => t.name).sort()).toEqual(TOOL_DEFINITIONS.map((d) => d.name).sort());
    for (const def of TOOL_DEFINITIONS) expect({ name: def.name, family: toolText(def.name)?.family, tier: toolText(def.name)?.tier }).toEqual({ name: def.name, family: def.family, tier: def.tier });
    // Each description is the tool's shipped text.
    for (const t of TOOL_TEXTS) expect(promptDef(toolTextId(t.name))?.text).toBe(t.text);
  });

  test("the notes the tools answer with are the page's Tool answers", () => {
    const listed = promptGroups(GM_AGENT_PAGE).find((g) => g.title === "Tool answers")?.defs.map((d) => d.id) ?? [];
    expect([...listed].sort()).toEqual(TOOL_NOTES.map((n) => n.id).sort());
  });

  test("each tool's schema has exactly the arguments its texts describe, and no description of its own, in every view", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      const view = await toolEnv(rig, chatId, knowledge).reader.view();
      const world = schemaWorld(view.world, view.registry, knowledge);
      for (const def of TOOL_DEFINITIONS) {
        const schema = def.parameters(world);
        expect({ tool: def.name, args: Object.keys(propertiesOf(schema)).sort() }).toEqual({ tool: def.name, args: argsOf(def.name) });
        expect({ tool: def.name, described: describes(schema) }).toEqual({ tool: def.name, described: false });
      }
    }
  });

  test("each tool's schema is one a Gemini connection takes, as it goes out in every view: each node one type of its own, no union, no object without properties, at any depth", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      for (const tool of await agentTools(rig, chatId, knowledge, { tiers: ["read", "gm"] })) expect({ tool: tool.name, refused: geminiRefuses(tool.parameters) }).toEqual({ tool: tool.name, refused: [] });
    }
    // Its own check finds them.
    expect(geminiRefuses({ type: "object", properties: { level: { type: ["integer", "null"] }, to: { type: "string", anyOf: [{ type: "string" }] }, value: {}, list: { type: "array", items: {} }, settings: { type: "object" }, params: { type: "object", additionalProperties: { type: "string" } }, none: { type: "object", properties: {} } } })).toEqual([
      "$.properties.level.type",
      "$.properties.to.anyOf",
      "$.properties.value.type",
      "$.properties.list.items.type",
      "$.properties.settings.properties",
      "$.properties.params.properties",
      "$.properties.none.properties",
    ]);
    // Nor may a tool's own top level take no argument.
    expect(geminiRefuses({ type: "object", properties: {} })).toEqual(["$.properties"]);
  });
});

describe("a value a tool doesn't take", () => {
  test("is answered with the values it takes, or without a list when there is none it may give", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "pov").reader.view();
    const vars = { tool: "gm_set_stage", arg: "stage", value: "Signed" };
    expect(badValue(view, "gm_set_stage", "stage", "Signed", ["kickoff", "signed"])).toEqual({ text: renderPrompt(TOOL_NOTE.badValue, {}, { ...vars, values: "kickoff, signed" }), error: true });
    const unlisted = badValue(view, "gm_set_stage", "stage", "Signed", []);
    expect(unlisted).toEqual({ text: renderPrompt(TOOL_NOTE.badValueUnlisted, {}, vars), error: true });
    expect(unlisted.text).not.toContain("one of");
    // Under the player character's knowledge a stage is named only as its quest log shows one: the start stage's id is no name it knows.
    const setStage = (await agentTools(rig, chatId, "pov", { tiers: ["gm"] })).find((t) => t.name === "gm_set_stage");
    if (!setStage) throw new Error("no gm_set_stage");
    const ran = await setStage.run({ track: "The Fleet Contract", stage: "kickoff" }, { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_stage" });
    expect(ran).toEqual({ text: renderPrompt(TOOL_NOTE.badValue, {}, { tool: "gm_set_stage", arg: "stage", value: "kickoff", values: "A deal on the table" }), error: true });
  });
});

describe("a field's value", () => {
  test("a text or enum field keeps the words written, unless they are written as a JSON string; any other field reads them as JSON", async () => {
    const { rig, chatId } = await alderChat();
    const base = toolEnv(rig, chatId, "gm");
    const real = outsideWriter(rig.rt, { ...base, connectionId: null });
    const sent: AgentOp[] = [];
    const writer: ToolWriter = {
      dryRun: (op) => {
        sent.push(op);
        return real.dryRun(op);
      },
      apply: (ops, label) => real.apply(ops, label),
    };
    const { world } = await base.reader.view();
    const setField = toolsFor({ world, tiers: ["gm"], texts: {}, env: { ...base, writer } }).find((t) => t.name === "gm_set_field");
    if (!setField) throw new Error("no gm_set_field");
    const set = async (field: string, value: string) => {
      const out = await setField.run({ entity: "Marcus Delgado", field, value }, { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_field" });
      expect({ field, value, error: out.error === true, text: out.text }).toMatchObject({ field, value, error: false });
      const op = sent.at(-1);
      return op?.kind === "gm_edit" ? op.op : undefined;
    };
    // A role is words: 1999 is the text 1999, as are words in quotes.
    expect(await set("role", "1999")).toMatchObject({ op: "set", entity: "marcus_delgado", field: "role", value: "1999" });
    expect(await set("role", '"1999"')).toMatchObject({ value: "1999" });
    expect(await set("role", "Owner and mechanic")).toMatchObject({ value: "Owner and mechanic" });
    // An age is a number, written as JSON.
    expect(await set("age", "53")).toMatchObject({ field: "age", value: 53 });
  });
});

describe("an optional object argument sent blank", () => {
  test("is left out, as a model that fills every text argument sends one it means to leave out; text that isn't a JSON object still says what it takes", async () => {
    const { rig, chatId } = await alderChat();
    const base = toolEnv(rig, chatId, "gm");
    const { world } = await base.reader.view();
    const tools = toolsFor({ world, tiers: ["read", "gm"], texts: {}, env: { ...base, writer: outsideWriter(rig.rt, { ...base, connectionId: null }) } });
    const run = async (name: string, args: JsonObject) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`no ${name}`);
      return tool.run(args, { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: `call_${name}` });
    };
    const odds = await run("checks_odds", { action: "accept_fleet_job" });
    expect(odds.error).toBeUndefined();
    const effect = await run("gm_effect", { effect: "no_such_effect" });
    for (const blank of ["", "  "]) {
      expect(await run("checks_odds", { action: "accept_fleet_job", params: blank })).toEqual(odds);
      expect(await run("gm_effect", { effect: "no_such_effect", args: blank })).toEqual(effect);
    }
    const needs = (tool: string, arg: string) => ({ text: renderPrompt(TOOL_NOTE.missing, {}, { tool, arg, text: promptDef(toolArgTextId(tool, arg))?.text ?? "" }), error: true as const });
    expect(await run("checks_odds", { action: "accept_fleet_job", params: "the boat" })).toEqual(needs("checks_odds", "params"));
    expect(await run("gm_effect", { effect: "no_such_effect", args: "[1]" })).toEqual(needs("gm_effect", "args"));
  });
});

describe("toolsFor", () => {
  test("an edited description, and an argument's, reach the tool it gives; Reset brings the shipped text back", async () => {
    const { rig, chatId } = await alderChat();
    const where = async (texts: Record<string, string>) => (await agentTools(rig, chatId, "everyone", { texts })).find((t) => t.name === "people_where");
    const shipped = await where({});
    expect(shipped?.description).toBe(promptDef(toolTextId("people_where"))?.text);
    const argText = promptDef(toolArgTextId("people_where", "person"))?.text;
    if (argText === undefined) throw new Error("no shipped text for people_where's person");
    expect((propertiesOf(shipped?.parameters ?? {}).person as JsonObject).description).toBe(argText);

    const mine = { [toolTextId("people_where")]: "Where is someone right now? Ask by name.", [toolArgTextId("people_where", "person")]: "Who: a name as Port Alder has it." };
    const edited = await where(mine);
    expect(edited?.description).toBe("Where is someone right now? Ask by name.");
    expect((propertiesOf(edited?.parameters ?? {}).person as JsonObject).description).toBe("Who: a name as Port Alder has it.");
    // Another tool keeps its shipped text.
    expect((await agentTools(rig, chatId, "everyone", { texts: mine })).find((t) => t.name === "people_find")?.description).toBe(promptDef(toolTextId("people_find"))?.text);

    // Reset: the user's text is gone, so the shipped one is sent again.
    expect((await where({}))?.description).toBe(shipped?.description);
  });

  test("every argument of every tool goes out described", async () => {
    const { rig, chatId } = await alderChat();
    for (const tool of await agentTools(rig, chatId, "gm", { tiers: ["read", "gm"] })) {
      for (const path of argsOf(tool.name)) expect({ tool: tool.name, path, described: typeof (propertiesOf(tool.parameters)[path] as JsonObject | undefined)?.description === "string" }).toEqual({ tool: tool.name, path, described: true });
    }
  });

  test("only the tiers and families asked for", async () => {
    const { rig, chatId } = await alderChat();
    const env = toolEnv(rig, chatId, "gm");
    const { world } = await env.reader.view();
    const tier = (name: string) => TOOL_DEFINITIONS.find((d) => d.name === name);
    expect(toolsFor({ world, tiers: ["read"], texts: {}, env }).map((t) => t.name).sort()).toEqual(TOOL_DEFINITIONS.filter((d) => d.tier === "read").map((d) => d.name).sort());
    expect(toolsFor({ world, tiers: ["read"], families: ["people"], texts: {}, env }).map((t) => t.name)).toEqual(["people_find", "people_sheet", "people_where", "people_regard"]);
    for (const t of toolsFor({ world, tiers: ["gm"], texts: {}, env })) expect(tier(t.name)?.tier).toBe("gm");
  });

  test("under the player character's knowledge no schema names a place or an action; under everyone's and the GM's a place argument offers every place", async () => {
    const { rig, chatId } = await alderChat();
    const schemas = async (knowledge: "pov" | "everyone" | "gm") => JSON.stringify((await agentTools(rig, chatId, knowledge, { tiers: ["read", "gm"] })).map((t) => t.parameters));
    // Marcus's house is secret, and reading the bank statement is a step of the shop's secret.
    const pov = await schemas("pov");
    expect(pov).not.toContain("birch_lane_12");
    expect(pov).not.toContain("read_bank_statement");
    for (const knowledge of ["everyone", "gm"] as const) {
      const place = (await agentTools(rig, chatId, knowledge)).find((t) => t.name === "places_read");
      expect((propertiesOf(place?.parameters ?? {}).place as JsonObject).enum).toContain("birch_lane_12");
      expect(await schemas(knowledge)).toContain("read_bank_statement");
    }
  });
});

describe("the resolver", () => {
  test("a name reaches its id by id in any case, by its whole name, by a word only one name has, and with its mark after it", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "everyone").reader.view();
    for (const said of ["danny_okafor", "DANNY_OKAFOR", "danny  okafor", "Danny", "Danny Okafor's", "Danny Okafor [secret; known to Marcus Delgado]"]) expect({ said, got: resolvePerson(view, said) }).toEqual({ said, got: { id: "danny_okafor" } });
    expect(resolvePlace(view, "the rusty anchor")).toEqual({ id: "rusty_anchor" });
    expect(resolveTrack(view, "s_shop_trouble")).toEqual({ id: "s_shop_trouble" });
  });

  test("a name that fits several is answered with each the view may name, by name and id", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "gm").reader.view();
    const got = resolvePerson(view, "Kowalczyk");
    expect("refused" in got && got.refused.error).toBe(true);
    const text = "refused" in got ? got.refused.text : "";
    for (const one of ["Helen Kowalczyk (helen_kowalczyk)", "Jess Kowalczyk (jess_kowalczyk)", "Maddie Kowalczyk (maddie_kowalczyk)"]) expect(text).toContain(one);
  });

  test("one the view can't see reads exactly as one that doesn't exist", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { vex_morrow: VEX } } });
    const pov = await toolEnv(rig, chatId, "pov").reader.view();
    const refusal = (got: Resolved): string => ("refused" in got ? got.refused.text : `resolved to ${got.id}`);
    expect(refusal(resolvePerson(pov, "Vex Morrow"))).toBe("No such person here: Vex Morrow.");
    expect(refusal(resolvePerson(pov, "vex_morrow"))).toBe("No such person here: vex_morrow.");
    expect(refusal(resolvePerson(pov, "Nobody Atall"))).toBe("No such person here: Nobody Atall.");
    expect(refusal(resolvePlace(pov, "12 Birch Lane"))).toBe("No such place here: 12 Birch Lane.");
    expect(refusal(resolveTrack(pov, "s_shop_trouble"))).toBe("No such quest, secret, puzzle or agenda here: s_shop_trouble.");
    const gm = await toolEnv(rig, chatId, "gm").reader.view();
    expect(resolvePerson(gm, "Vex Morrow")).toEqual({ id: "vex_morrow" });
    expect(resolvePlace(gm, "12 Birch Lane")).toEqual({ id: "birch_lane_12" });
  });
});

describe("World Info text in each view", () => {
  test("a user's entry reaches each view with every mark marked, or, for the player character, only the marks it holds", async () => {
    const { rig, chatId } = await alderChat();
    const entry = `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}\n{{// Secret (known to Jordan): ${SEEN}}}`;
    const read = async (knowledge: "pov" | "everyone" | "gm", text: string) => (await toolEnv(rig, chatId, knowledge).reader.view()).entryText(text);

    const pov = await read("pov", entry);
    expect(pov).toContain(FERRY);
    expect(pov).not.toContain(DEBT);
    expect(pov).toContain(secretMarkText(SEEN, ["Jordan Ellis"], "everyone", SECRET_MARK_WORDING));
    expect(await read("pov", `{{// Secret: ${WRECK}}}`)).not.toContain(WRECK);

    for (const knowledge of ["everyone", "gm"] as const) {
      const all = await read(knowledge, entry);
      expect(all).toContain(FERRY);
      expect(all).toContain(secretMarkText(DEBT, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING));
      expect(all).toContain(secretMarkText(SEEN, ["Jordan Ellis"], "everyone", SECRET_MARK_WORDING));
      expect(await read(knowledge, `{{// Secret: ${WRECK}}}`)).toBe(secretMarkText(WRECK, [], "everyone", SECRET_MARK_WORDING));
    }
  });

  test("a secret is marked in the user's own wording of a mark", async () => {
    const { rig, chatId } = await alderChat();
    const known = "{{text}} (a secret only {{known}} knows)";
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { "narrator.mark.known": known } } } }));
    const view = await toolEnv(rig, chatId, "everyone").reader.view();
    expect(view.entryText(`{{// Secret (known to Marcus): ${DEBT}}}`)).toBe(`${DEBT} (a secret only Marcus Delgado knows)`);
    expect(view.mark("Vex Morrow is here.", { known: ["Marcus Delgado"], kept: "everyone" })).toBe("Vex Morrow is here. (a secret only Marcus Delgado knows)");
    // Under the player character's knowledge and the GM's, nothing is marked that way.
    expect((await toolEnv(rig, chatId, "pov").reader.view()).mark("Vex Morrow is here.", { known: ["Marcus Delgado"], kept: "everyone" })).toBe("Vex Morrow is here.");
    expect((await toolEnv(rig, chatId, "gm").reader.view()).mark("Vex Morrow is here.", { known: ["Marcus Delgado"], kept: "everyone" })).toBe("Vex Morrow is here.");
  });
});
