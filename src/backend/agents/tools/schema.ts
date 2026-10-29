// The agent tools' JSON Schemas (AGENT-LOOP-PLAN §6; §16: a fixed output contract each, whose
// descriptions stay editable): written by hand with these helpers, the world's ids filled in as
// enums (kinds, fields, places, actions), and the arguments a call gives read back. A schema carries
// no description of its own: `toolsFor` fills each from the tool's registry texts.
//
// A tool's `parameters` gets the world as the agent may name it (`schemaWorld`): its kinds and
// actions as played, the packs' under the world's own. Under the player character's knowledge it
// holds no places and no actions, whose ids could name what the player character can't know (a
// secret room, a step of a secret the story hasn't come to), and only the fields anyone may see: such
// an argument is then a free name, which the resolver checks against the view.

import type { Registry } from "../../../engine/registry-impl";
import { visibilityOf } from "../../../engine/visibility";
import { type AgentKnowledge, TOOL_NOTE, toolArgTextId } from "../../../shared/agent-tools";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { type KindDef, playedKinds, type WorldDoc } from "../../../shared/world";
import type { ToolOutcome } from "../runtime";
import type { ToolReadView } from "./read-view";

/** The world as the agent may name it (see the header). */
export function schemaWorld(world: WorldDoc, registry: Registry, knowledge: AgentKnowledge): WorldDoc {
  const kinds = playedKinds(Object.fromEntries(registry.kinds), world.kinds);
  if (knowledge !== "pov") return { ...world, kinds, actions: { ...Object.fromEntries(registry.actions), ...world.actions } };
  const shown: Record<string, KindDef> = {};
  for (const [id, kind] of Object.entries(kinds)) shown[id] = { ...kind, fields: Object.fromEntries(Object.entries(kind.fields).filter(([, def]) => visibilityOf(def.visibility) === "public")) };
  return { ...world, kinds: shown, actions: {}, places: {} };
}

// ---------------------------------------------------------------- writing schemas

/** An object of `properties`, `required` among them, nothing else. */
export function objectSchema(properties: Readonly<Record<string, JsonObject>>, required: readonly string[] = []): JsonObject {
  return { type: "object", properties: { ...properties }, ...(required.length > 0 ? { required: [...required] } : {}), additionalProperties: false };
}

/** A string, one of `values` when there are any. */
export function text(values: readonly string[] = []): JsonObject {
  return values.length > 0 ? { type: "string", enum: [...values] } : { type: "string" };
}

/** A whole number within `bounds`. */
export function integer(bounds: { minimum?: number; maximum?: number } = {}): JsonObject {
  return { type: "integer", ...bounds };
}

/**
 * An object argument whose keys are its own (an action's arguments, a change's fields, a block),
 * written as JSON text: a Gemini connection refuses an object node with no properties of its own,
 * and these have none fixed. `objectArg` and `nullableObject` read it.
 */
export function jsonObject(): JsonObject {
  return { type: "string" };
}

/** Whether `kind` is `ancestor` or extends it, among `kinds`; a loop of Extends ends the walk. */
function extendsKind(kinds: Readonly<Record<string, KindDef>>, kind: string, ancestor: string): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = kind; at !== undefined && !seen.has(at); at = hasOwn(kinds, at) ? kinds[at]?.extends : undefined) {
    if (at === ancestor) return true;
    seen.add(at);
  }
  return false;
}

/** The world's kind ids, or only those that are or extend `ancestor`, sorted. */
export function kindEnum(world: WorldDoc, ancestor?: string): string[] {
  return Object.keys(world.kinds)
    .filter((k) => ancestor === undefined || extendsKind(world.kinds, k, ancestor))
    .sort();
}

/** The field ids of `kind` and the kinds it extends, or of every kind, sorted. */
export function fieldEnum(world: WorldDoc, kind?: string): string[] {
  const out = new Set<string>();
  for (const [id, def] of Object.entries(world.kinds)) {
    if (kind !== undefined && !extendsKind(world.kinds, kind, id)) continue;
    for (const field of Object.keys(def.fields)) out.add(field);
  }
  return [...out].sort();
}

/** The world's place ids, sorted; none under the player character's knowledge (`schemaWorld`). */
export function placeEnum(world: WorldDoc): string[] {
  return Object.keys(world.places).sort();
}

/** The world's action ids, the packs' included, sorted; none under the player character's knowledge (`schemaWorld`). */
export function actionEnum(world: WorldDoc): string[] {
  return Object.keys(world.actions).sort();
}

// ---------------------------------------------------------------- reading arguments

/** A non-blank string argument, trimmed; else null. */
export function textArg(args: JsonObject, key: string): string | null {
  const v = args[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** A whole-number argument (a numeric string read as one); else null. */
export function intArg(args: JsonObject, key: string): number | null {
  const v: JsonValue | undefined = args[key];
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/** What JSON text holds; undefined when it isn't JSON. */
export function jsonTextOf(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Whether an argument was given: one sent as blank text (a model that fills every text argument
 * sends one it means to leave out so) counts as left out, as `textArg` reads it.
 */
export function argGiven(args: JsonObject, key: string): boolean {
  const v = args[key];
  return v !== undefined && !(typeof v === "string" && v.trim() === "");
}

/** An object argument, written as JSON text (`jsonObject`) or sent as itself; null when it is left out (`argGiven`) or isn't one. */
export function objectArg(args: JsonObject, key: string): JsonObject | null {
  if (!argGiven(args, key)) return null;
  const raw = args[key];
  const v = typeof raw === "string" ? jsonTextOf(raw) : raw;
  return isRecord(v) ? (v as JsonObject) : null;
}

/** A string argument the tool can't do without, or the note that it's missing, with its description in the user's words. */
export function needText(view: ToolReadView, tool: string, args: JsonObject, key: string): string | ToolOutcome {
  return textArg(args, key) ?? view.refuse(TOOL_NOTE.missing, { tool, arg: key, text: view.text(toolArgTextId(tool, key)) });
}

/** The note that `value` isn't one of the values an argument takes, listing them; with none it may list, the note without a list. */
export function badValue(view: ToolReadView, tool: string, arg: string, value: string, values: readonly string[]): ToolOutcome {
  return values.length > 0 ? view.refuse(TOOL_NOTE.badValue, { tool, arg, value, values: values.join(", ") }) : view.refuse(TOOL_NOTE.badValueUnlisted, { tool, arg, value });
}
