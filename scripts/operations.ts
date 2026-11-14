// The operation reference: docs/operations.md, generated from the engine's tools as they are registered.
//
//   bun scripts/operations.ts            writes docs/operations.md
//   bun scripts/operations.ts --check    exits 1 when the committed file differs from a fresh build
//
// Every everyday operation of `world_apply` and every searchable tool, each with what it takes and a
// worked example: the operations and tools as `src/iface/` registers them (their arguments' shapes,
// what they need, their lanes, their examples), and their words as their files in `guidance/.tools/`
// say them. Nothing here describes a tool in words of its own.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OPERATION_PROPERTIES, OPERATIONS } from "../src/iface/apply";
import type { ToolSpec } from "../src/iface/kit";
import { SEARCHABLE_TOOLS } from "../src/iface/searchable";
import { PROVENANCE_PROPERTIES } from "../src/iface/source";
import { shippedTexts, splitFile, type ToolText, toolText } from "../src/iface/texts";
import type { JsonObject, JsonValue } from "../src/shared/json";

const ROOT = resolve(import.meta.dir, "..");
export const OPERATIONS_PATH = join(ROOT, "docs/operations.md");

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** An argument's shape in words a reader knows. */
function shapeOf(schema: JsonObject): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(", ")}`;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map((s) => (isObject(s) ? shapeOf(s) : "any value")).join(", or ");
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

/** The lines of `world_apply`'s file that say what each operation is (`- move: …`), by operation. */
async function operationLines(): Promise<Map<string, string>> {
  const text = (await shippedTexts().read("tools", "world_apply")) ?? "";
  const out = new Map<string, string>();
  for (const line of splitFile(text, "world_apply.md").body.split("\n")) {
    const m = /^- ([a-z_]+): (.+)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2]);
  }
  return out;
}

function everydaySection(apply: ToolText, said: ReadonlyMap<string, string>): string[] {
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
    ...Object.entries(PROVENANCE_PROPERTIES).map(([arg, schema]) => `| \`${arg}\` | ${cell(shapeOf(schema))} | ${cell(of[`operations.${arg}`] ?? "")} |`),
    "",
  ];
  for (const op of OPERATIONS) {
    lines.push(`### ${op.name}`, "");
    const what = said.get(op.name);
    if (what !== undefined) lines.push(what, "");
    lines.push(`Lane: ${op.lane}.${op.needs.length > 0 ? ` Needs: ${op.needs.map((n) => `\`${n}\``).join(", ")}.` : ""}${op.provenance === false ? "" : " Takes its provenance."}`, "");
    lines.push("| Argument | Shape | What it is |", "|---|---|---|");
    for (const arg of op.takes) lines.push(`| \`${arg}\` | ${cell(shapeOf(OPERATION_PROPERTIES[arg] ?? {}))} | ${cell(of[`operations.${arg}`] ?? "")} |`);
    lines.push("", "Worked example:", "", "```json", JSON.stringify({ operations: [op.example] }, null, 2), "```", "");
  }
  return lines;
}

function toolEntry(spec: ToolSpec, text: ToolText): string[] {
  const own = Object.entries(spec.properties).filter(([arg]) => !(spec.tier === "write" && Object.hasOwn(PROVENANCE_PROPERTIES, arg)));
  const lines = [`#### ${spec.name}`, "", text.description, "", spec.tier === "write" ? `Writes the ${spec.lane ?? "engine"} lane.` : "Reads; changes nothing.", ""];
  if (own.length > 0) {
    lines.push("| Argument | Shape | Needed | What it is |", "|---|---|---|---|");
    for (const [arg, schema] of own) lines.push(`| \`${arg}\` | ${cell(shapeOf(schema))} | ${spec.required.includes(arg) ? "yes" : ""} | ${cell(text.arguments[arg] ?? "")} |`);
    lines.push("");
  }
  return [...lines, "Worked example:", "", "```json", JSON.stringify(spec.example, null, 2), "```", ""];
}

function searchableSection(texts: ReadonlyMap<string, ToolText>): string[] {
  const lines = ["## Searchable tools", "", "Found by `tool_search` and called through `tool_use`, family by family. Every write also takes the provenance of an everyday operation (`source`, `precision`, `standing`).", ""];
  const families = [...new Set(SEARCHABLE_TOOLS.map((t) => t.family))];
  for (const family of families) {
    lines.push(`### ${family}`, "");
    for (const spec of SEARCHABLE_TOOLS.filter((t) => t.family === family)) lines.push(...toolEntry(spec, texts.get(spec.name) as ToolText));
  }
  return lines;
}

export async function buildOperations(): Promise<string> {
  const texts = await textsOf(["world_apply", ...SEARCHABLE_TOOLS.map((t) => t.name)]);
  const lines = [
    "# The engine's operations",
    "",
    "Generated by `bun scripts/operations.ts` from the engine's tools as `src/iface/` registers them and their files in `guidance/.tools/`. Do not edit it by hand: change a tool or its file and run the script again (`--check` says whether this file is current).",
    "",
    `${OPERATIONS.length} everyday operations and ${SEARCHABLE_TOOLS.length} searchable tools.`,
    "",
    ...everydaySection(texts.get("world_apply") as ToolText, await operationLines()),
    ...searchableSection(texts),
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
