// The operation reference: docs/operations.md, generated from the engine's tools as they are registered.
//
//   bun scripts/operations.ts            writes docs/operations.md
//   bun scripts/operations.ts --check    exits 1 when the committed file differs from a fresh build
//
// Every everyday operation of `world_apply` and every searchable tool, each with what it takes and a
// worked example: the operations and tools as `src/iface/` registers them (their arguments' shapes,
// what they need, their lanes, their examples), and their words as their files in `guidance/.tools/`
// say them. Nothing here describes a tool in words of its own.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { OPERATION_PROPERTIES, OPERATIONS, SCENE_FROM_NOTHING } from "../src/iface/apply";
import type { ToolSpec } from "../src/iface/kit";
import { MAP_TOOLS } from "../src/iface/maptools";
import { SEARCHABLE_TOOLS } from "../src/iface/searchable";
import { PROVENANCE_PROPERTIES } from "../src/iface/source";
import { ENGINE_TOOLS, FIXED_TOOLS } from "../src/iface/tools";
import { shippedTexts, type ToolText, toolText } from "../src/iface/texts";
import type { JsonObject, JsonValue } from "../src/shared/json";

const ROOT = resolve(import.meta.dir, "..");
export const OPERATIONS_PATH = join(ROOT, "docs/operations.md");

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** An argument's shape in words a reader knows. */
function shapeOf(schema: JsonObject): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(", ")}`;
  if (Array.isArray(schema.anyOf)) {
    const consts = schema.anyOf.filter((s): s is JsonObject => isObject(s) && "const" in s);
    const others = schema.anyOf.filter((s) => !(isObject(s) && "const" in s)).map((s) => (isObject(s) ? shapeOf(s) : "any value"));
    return [...(consts.length > 0 ? [`one of ${consts.map((s) => String(s.const)).join(", ")}`] : []), ...others].join(", or ");
  }
  switch (schema.type) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "integer":
      return "whole number";
    case "boolean":
      return "true or false";
    case "array":
      return `list of ${isObject(schema.items) ? shapeOf(schema.items) : "any value"}`;
    case "object":
      return isObject(schema.properties) ? `object: ${Object.keys(schema.properties).join(", ")}` : "object";
    default:
      return "any value";
  }
}

/** A table cell: one line, with its bars kept as text. */
const cell = (text: string): string => text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

/** Each tool's file, read: its words for the model and for each argument. */
async function textsOf(names: readonly string[]): Promise<Map<string, ToolText>> {
  const files = shippedTexts();
  const out = new Map<string, ToolText>();
  for (const name of names) {
    const text = await files.read("tools", name);
    if (text === undefined) throw new Error(`guidance/.tools/${name}.md is missing`);
    out.set(name, toolText(text, `${name}.md`));
  }
  return out;
}

/** What each operation is, by operation: the parenthesis after its name in `world_apply`'s `op` argument (`move (go somewhere, others along)`). */
function operationLines(apply: ToolText): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of (apply.arguments["operations.op"] ?? "").matchAll(/([a-z_]+) \(([^()]+)\)/g)) if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2]);
  return out;
}

function everydaySection(apply: ToolText, said: ReadonlyMap<string, string>, sources: ReadonlyMap<string, string>): string[] {
  const of = apply.arguments;
  const lines = [
    "## Everyday operations",
    "",
    "Each is one item of `world_apply`'s `operations` list, named by `op`. A call's operations are applied in order and recorded in one write; a later one may name what an earlier one made.",
    "",
    "An operation whose entry says it takes its provenance takes these three arguments:",
    "",
    "| Argument | Shape | What it is |",
    "|---|---|---|",
    ...Object.entries(PROVENANCE_PROPERTIES).map(([arg, schema]) => `| \`${arg}\` | ${cell(shapeOf(OPERATION_PROPERTIES[arg] ?? schema))} | ${cell(of[`operations.${arg}`] ?? "")} |`),
    "",
    "A scene set from nothing in one call (an island, a kitchen on it, two people there, a lamp):",
    "",
    "```json",
    JSON.stringify(SCENE_FROM_NOTHING, null, 2),
    "```",
    "",
  ];
  for (const op of OPERATIONS) {
    lines.push(`### ${op.name}`, "");
    const what = said.get(op.name);
    if (what !== undefined) lines.push(what, "");
    lines.push(`Lane: ${op.lane}.${op.needs.length > 0 ? ` Needs: ${op.needs.map((n) => `\`${n}\``).join(", ")}.` : ""}${op.provenance === false ? "" : " Takes its provenance."}`, "");
    lines.push("| Argument | Shape | What it is |", "|---|---|---|");
    for (const arg of op.takes) lines.push(`| \`${arg}\` | ${cell(shapeOf(OPERATION_PROPERTIES[arg] ?? {}))} | ${cell(of[`operations.${arg}`] ?? "")} |`);
    lines.push("", ...reportsLine(op.name, sources), "Worked example:", "", "```json", JSON.stringify({ operations: [op.example] }, null, 2), "```", "");
  }
  return lines;
}

/** Every source file of `src/iface/`, by its path from the repository, read once: where a tool's code is, for the reports it can give. */
function ifaceSources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".ts")) out.set(relative(ROOT, join(dir, entry.name)), readFileSync(join(dir, entry.name), "utf8"));
    }
  };
  walk(join(ROOT, "src/iface"));
  return out;
}

/** The reports the file that defines a tool or operation can give: every `report("name"` in it, with the file. */
function reportsLine(name: string, sources: ReadonlyMap<string, string>): string[] {
  const file = [...sources].find(([, text]) => text.includes(`name: "${name}"`));
  if (file === undefined) return [];
  const reports = [...new Set([...file[1].matchAll(/report\("([a-z_]+)"/g)].map((m) => m[1] as string))].sort();
  return reports.length === 0 ? [] : [`Reports its code (\`${file[0]}\`) can give: ${reports.map((r) => `\`${r}\``).join(", ")}.`, ""];
}

function toolEntry(spec: ToolSpec, text: ToolText, sources: ReadonlyMap<string, string>): string[] {
  const own = Object.entries(spec.properties).filter(([arg]) => !(spec.tier === "write" && Object.hasOwn(PROVENANCE_PROPERTIES, arg)));
  const sourced = Object.keys(PROVENANCE_PROPERTIES).every((arg) => Object.hasOwn(spec.properties, arg));
  const lines = [`#### ${spec.name}`, "", text.description, "", spec.tier === "write" ? `Writes the ${spec.lane ?? "engine"} lane.${sourced ? "" : " Takes no provenance."}` : "Reads; changes nothing.", ""];
  if (own.length > 0) {
    lines.push("| Argument | Shape | Needed | What it is |", "|---|---|---|---|");
    for (const [arg, schema] of own) lines.push(`| \`${arg}\` | ${cell(shapeOf(schema))} | ${spec.required.includes(arg) ? "yes" : ""} | ${cell(text.arguments[arg] ?? "")} |`);
    lines.push("");
  }
  return [...lines, ...reportsLine(spec.name, sources), "Worked example:", "", "```json", JSON.stringify(spec.example, null, 2), "```", ""];
}

/** The fixed tools besides `world_apply`, which the everyday operations are: reading the world, finding in it, and rolling. */
const FIXED_BESIDES_APPLY = FIXED_TOOLS.filter((t) => t.name !== "world_apply");

function fixedSection(texts: ReadonlyMap<string, ToolText>, sources: ReadonlyMap<string, string>): string[] {
  return ["## Fixed tools", "", "The agents' own list holds these with `world_apply`: read the tree at a point and depth, find by words, and roll.", "", ...FIXED_BESIDES_APPLY.flatMap((spec) => toolEntry(spec, texts.get(spec.name) as ToolText, sources))];
}

function searchableSection(texts: ReadonlyMap<string, ToolText>, sources: ReadonlyMap<string, string>): string[] {
  const lines = ["## Searchable tools", "", "Found by `tool_search` and called through `tool_use`, family by family. Every write also takes the provenance of an everyday operation (`source`, `precision`, `standing`), unless its entry says it takes none.", ""];
  const families = [...new Set(SEARCHABLE_TOOLS.map((t) => t.family))];
  for (const family of families) {
    lines.push(`### ${family}`, "");
    for (const spec of SEARCHABLE_TOOLS.filter((t) => t.family === family)) lines.push(...toolEntry(spec, texts.get(spec.name) as ToolText, sources));
  }
  return lines;
}

function mapSection(texts: ReadonlyMap<string, ToolText>, sources: ReadonlyMap<string, string>): string[] {
  return ["## Map tools", "", "Found by `tool_search` as the searchable tools are: lay a room, place people and things on its squares, edit it, work its doors, show it and measure on it.", "", ...MAP_TOOLS.flatMap((spec) => toolEntry(spec, texts.get(spec.name) as ToolText, sources))];
}

/** The families each domain skill's work is in; a tool of the family `reads` is placed by name. */
const SKILL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  economy: ["money", "business"],
  "items-and-wardrobe": ["things"],
  vehicles: ["vehicles"],
  "ruleset-and-sheets": ["checks", "people"],
  combat: ["fights"],
  "places-and-maps": ["map"],
  quests: [],
  time: ["time", "calendar"],
  groups: ["groups"],
};
const READS_IN: Readonly<Record<string, string>> = { items_access: "items-and-wardrobe", items_of: "items-and-wardrobe", orgs_list: "groups", orgs_read: "groups", people_regard: "ruleset-and-sheets", places_route: "places-and-maps", money_balances: "economy" };

/** Per domain skill: the operations and engine tools its text names, the snake_case names it gives that no engine tool or operation has (RPH's tools among them), and the tools of its families it does not name. */
function skillsSection(): string[] {
  const known = new Set([...OPERATIONS.map((o) => o.name), ...ENGINE_TOOLS.map((t) => t.name)]);
  const lines = ["## What each domain skill names", "", "For each domain skill: the everyday operations and engine tools its text names in backticks; the names with an underscore it gives that are no engine tool or operation (RPH's own tools among them: each one is for the skill's writer to check); and the engine tools of its families it does not name.", ""];
  for (const [skill, families] of Object.entries(SKILL_FAMILIES)) {
    const text = readFileSync(join(ROOT, "guidance/.skills", skill, "SKILL.md"), "utf8");
    const said = [...new Set([...text.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1] as string))];
    const named = said.filter((n) => known.has(n));
    const unknown = said.filter((n) => !known.has(n) && n.includes("_"));
    const mine = ENGINE_TOOLS.filter((t) => families.includes(t.family) || READS_IN[t.name] === skill).map((t) => t.name);
    const unsaid = mine.filter((n) => !said.includes(n));
    const list = (names: readonly string[]): string => (names.length === 0 ? "none" : names.map((n) => `\`${n}\``).join(", "));
    lines.push(`### ${skill}`, "", `- Names: ${list(named)}.`, `- Names with no engine tool or operation of that name: ${list(unknown)}.`, `- Its families' tools it does not name: ${list(unsaid)}.`, "");
  }
  return lines;
}

export async function buildOperations(): Promise<string> {
  const texts = await textsOf(["world_apply", ...ENGINE_TOOLS.map((t) => t.name).filter((n) => n !== "world_apply")]);
  const sources = ifaceSources();
  const lines = [
    "# The engine's operations",
    "",
    "Generated by `bun scripts/operations.ts` from the engine's tools as `src/iface/` registers them and their files in `guidance/.tools/`. Do not edit it by hand: change a tool or its file and run the script again (`--check` says whether this file is current).",
    "",
    `${OPERATIONS.length} everyday operations, ${FIXED_BESIDES_APPLY.length} more fixed tools, ${SEARCHABLE_TOOLS.length} searchable tools and ${MAP_TOOLS.length} map tools.`,
    "",
    ...everydaySection(texts.get("world_apply") as ToolText, operationLines(texts.get("world_apply") as ToolText), sources),
    ...fixedSection(texts, sources),
    ...searchableSection(texts, sources),
    ...mapSection(texts, sources),
    ...skillsSection(),
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

if (import.meta.main) {
  const text = await buildOperations();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OPERATIONS_PATH, "utf8");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.log("docs/operations.md differs from a fresh build; run `bun scripts/operations.ts`");
      process.exit(1);
    }
    console.log("docs/operations.md is current");
  } else {
    writeFileSync(OPERATIONS_PATH, text);
    console.log(`wrote ${OPERATIONS_PATH} (${text.length} bytes)`);
  }
}
