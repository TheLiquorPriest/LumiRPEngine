// The tools that need no Lumiverse: the agent guide and the docs, the published schemas, the
// starter worlds, and the engine run on this machine through the studio seam
// (`lumi-rp-engine/studio`): load (shape, migration, lint), Playtest and Check world.

import worldSchemaJson from "../../schemas/lre-world-v1.schema.json";
import { macrosIn } from "../engine/authoring";
import { STARTER_INFO, STARTER_WORLDS } from "../packs/index";
import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import { checkWorld, ENGINE_VERSION, EXPORT_FORMAT, exportFile, load, MAP_SCHEMA, playtest } from "../studio-api";
import type { LoadResult, PlaytestTurn, RunResult } from "../studio-api";
import type { Args } from "./args";
import { intArg, neededText, textArg, ToolError } from "./args";
import { BODY_LIMIT, clip, readAt } from "./read";
import type { ToolResult } from "./report";
import { contentsOf, json, lintSummary } from "./report";
import { docs, DOCS, guide } from "./texts";

const STARTER_IDS = STARTER_INFO.filter((t) => hasOwn(STARTER_WORLDS, t.id)).map((t) => t.id);

export function guideTool(args: Args): ToolResult {
  return { text: guide(textArg(args, "topic")) };
}

export function docsTool(args: Args): ToolResult {
  const query = neededText(args, "query", 'words to look up, such as "account opening" or "stage formula"');
  const doc = textArg(args, "doc");
  if (doc !== undefined && !hasOwn(DOCS, doc)) throw new ToolError(`doc is one of ${Object.keys(DOCS).join(", ")}.`);
  return { text: docs(query, doc) };
}

export function schemaTool(args: Args): ToolResult {
  const which = textArg(args, "schema") ?? "world";
  if (which !== "world" && which !== "map") throw new ToolError('schema is "world" (lre-world-v1) or "map" (lre-map-v1).');
  const read = readAt(which === "map" ? MAP_SCHEMA : worldSchemaJson, { what: which === "map" ? "the map schema (lre-map-v1)" : "the world schema (lre-world-v1)", pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

export function templatesTool(): ToolResult {
  return { text: json({ templates: STARTER_INFO.filter((t) => STARTER_IDS.includes(t.id)) }) };
}

/** A starter as the export file Import reads, named as the template is; null when there is no such starter. */
export function templateFile(id: string): JsonValue | null {
  const info = STARTER_INFO.find((t) => t.id === id);
  const make = hasOwn(STARTER_WORLDS, id) ? STARTER_WORLDS[id] : undefined;
  return info && make ? exportFile(make(id, info.name)) : null;
}

export function templateTool(args: Args): ToolResult {
  const id = neededText(args, "id", `a starter's id: ${STARTER_IDS.join(", ")}`);
  const file = templateFile(id);
  if (file === null) throw new ToolError(`There is no starter "${id}". The starters: ${STARTER_IDS.join(", ")}.`);
  const read = readAt(file, { what: `the starter ${id} as an export file`, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

export interface WorldInput {
  /** The world as given: a file's JSON text, or the value given inline. */
  value: string | JsonValue;
  /** Where it came from, for the answer. */
  from: string;
}

/** The world a tool was given as `path` (a file) or `world` (inline); null when it was given neither. */
export function worldInput(args: Args, readFile: (path: string) => string): WorldInput | null {
  const path = textArg(args, "path");
  const inline = args.world;
  if (path !== undefined && inline !== undefined) throw new ToolError("Give the world one way: path (a file) or world (inline), not both.");
  if (path !== undefined) {
    try {
      return { value: readFile(path), from: path };
    } catch (error) {
      throw new ToolError(`Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (inline === undefined || inline === null) return null;
  if (typeof inline === "string") return { value: inline, from: "the world given inline" };
  if (!isRecord(inline)) throw new ToolError("world must be a world document or an export file (a JSON object), or its JSON text.");
  return { value: inline as JsonValue, from: "the world given inline" };
}

export interface Loaded {
  result: LoadResult;
  /** The engine version the document says last wrote it, before this engine migrates it. */
  writtenBy: string | null;
}

/** The studio's `load` (shape, migration, lint); a document the engine throws on is reported as an error, not a crash. */
export function loadWorld(value: string | JsonValue): Loaded {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = null;
    }
  }
  const doc = isRecord(raw) && raw.format === EXPORT_FORMAT ? raw.world : raw;
  const writtenBy = isRecord(doc) && typeof doc.engineVersion === "string" ? doc.engineVersion : null;
  try {
    // Parsed once: what didn't parse goes in as text, so load reports where the JSON breaks.
    return { result: load(raw === null ? value : (raw as JsonValue)), writtenBy };
  } catch (error) {
    return { result: { ok: false, issues: [{ severity: "error", path: "", code: "unreadable", message: `The engine can't read this world: ${error instanceof Error ? error.message : String(error)}` }] }, writtenBy };
  }
}

export function checkTool(args: Args, readFile: (path: string) => string): ToolResult {
  const input = worldInput(args, readFile);
  if (input === null) throw new ToolError("Give the world to check: path (a file) or world (inline).");
  const { result, writtenBy } = loadWorld(input.value);
  if (!result.ok) {
    const lint = lintSummary(result.issues, 60);
    return { text: json({ ok: false, from: input.from, loads: false, errors: lint.errors, issues: lint.first, moreIssues: lint.more, verdict: "It doesn't load: fix the shape errors first (each names the part that is wrong)." }), failed: true };
  }
  const lint = lintSummary(result.issues, 60);
  const hazards = macrosIn(result.world);
  const verdict =
    lint.errors > 0
      ? "It loads, but LumiRPEngine won't commit or import it until the errors are fixed."
      : hazards.length > 0
        ? "No errors. Review each macro hazard: Lumiverse acts on macros in lore and templates when it builds a prompt."
        : "Clean: it loads, and lint finds no errors.";
  const report = {
    ok: lint.errors === 0,
    from: input.from,
    world: { id: result.world.id, name: result.world.name, writtenBy, engine: ENGINE_VERSION },
    contents: contentsOf(result.world),
    errors: lint.errors,
    warnings: lint.warnings,
    infos: lint.infos,
    issues: lint.first,
    moreIssues: lint.more,
    macroHazards: hazards.slice(0, 40),
    moreMacroHazards: Math.max(0, hazards.length - 40),
    verdict,
  };
  return { text: json(report), ...(report.ok ? {} : { failed: true as const }) };
}

/** A turn within its share of the answer: the reply first, then as many notes as fit. */
function fitTurn(turn: PlaytestTurn, room: number): { user: string; reply: string; notes: string[] } {
  const reply = clip(turn.reply, Math.max(200, Math.floor(room * 0.6)));
  const notes: string[] = [];
  let used = 0;
  for (const [i, note] of turn.notes.entries()) {
    if (used + note.length > Math.max(200, room - reply.length)) {
      notes.push(`(${turn.notes.length - i} more notes)`);
      break;
    }
    notes.push(note);
    used += note.length + 4;
  }
  return { user: turn.user, reply, notes };
}

export type RunKind = "playtest" | "check_world";

/** Playtest or Check world on a loaded world, with the bundled engine. */
export function runWorld(kind: RunKind, world: WorldDoc, from: string, writtenBy: string | null, plan: { turns: readonly string[]; days: number }): ToolResult {
  let result: RunResult;
  try {
    result = kind === "playtest" ? playtest(world, plan.turns) : checkWorld(world, plan.days);
  } catch (error) {
    throw new ToolError(`The engine stopped on this world: ${error instanceof Error ? error.message : String(error)}. lre_check shows what lint finds in it.`);
  }
  const lint = lintSummary(result.lint, 0);
  const notes: string[] = [];
  if (writtenBy !== null && writtenBy !== ENGINE_VERSION) notes.push(`This world was last written by engine ${writtenBy}; these runs use the engine bundled here (${ENGINE_VERSION}), so play on your Lumiverse may differ.`);
  if (lint.errors > 0) notes.push(`The world has ${lint.errors} lint error${lint.errors === 1 ? "" : "s"} (lre_check lists them): LumiRPEngine won't commit it as it is.`);
  const room = Math.floor((BODY_LIMIT - 1500) / Math.max(1, result.turns.length));
  return {
    text: json({
      world: { id: world.id, name: world.name },
      from,
      engine: ENGINE_VERSION,
      ...(notes.length > 0 ? { notes } : {}),
      [kind === "playtest" ? "turns" : "days"]: result.turns.map((t) => fitTurn(t, room)),
      lint: { errors: lint.errors, warnings: lint.warnings },
    }),
  };
}
