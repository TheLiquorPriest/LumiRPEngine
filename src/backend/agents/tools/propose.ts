// What every write tool answers (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): its operation's dry run, never
// the write itself. An agent only proposes a change; the GM assistant collects its proposals (its
// `env.writer` keeps each dry run's operation) and applies them on the game master's Apply, or at
// once where Settings lets it. A tool answers the dry run as JSON: what the change would do in plain
// words, its change type and mode, or the code and reason it can't be made.

import { TOOL_NOTE, toolArgTextId } from "../../../shared/agent-tools";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { EditOp } from "../../../shared/protocol";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { own } from "../../../engine/pack-kit";
import { fieldDef } from "../../../engine/scope";
import type { ToolOutcome } from "../runtime";
import type { ToolReadView } from "./read-view";
import type { Resolved } from "./resolve";
import { jsonTextOf, needText } from "./schema";
import type { AgentOp, ToolWriter } from "./writer";

// The write tools' argument schemas that aren't the world's (`tools/schema.ts` has those): shared, as
// `toolsFor` copies a schema before it describes it.
export const BOOLEAN: JsonObject = { type: "boolean" };
export const NUMBER: JsonObject = { type: "number" };
export const TEXT_LIST: JsonObject = { type: "array", items: { type: "string" } };
/**
 * A value of any field's type, written as JSON (`jsonArg` reads it): every node of a schema has one
 * type of its own, which a Gemini connection requires, and only text holds a value of every type.
 */
export const JSON_VALUE: JsonObject = { type: "string" };

/**
 * A value argument as `JSON_VALUE` takes it: the JSON its text holds, else the text itself (plain
 * words); a value the model sent as itself, not as text, as it is. With `text` (a text or enum
 * field's value), the text itself unless it is written as a JSON string ("…" in quotes), so words
 * that look like JSON (1999, true) stay the words they are. Undefined when the argument is absent.
 */
export function jsonArg(args: JsonObject, key: string, text = false): JsonValue | undefined {
  const v = args[key];
  if (typeof v !== "string") return v;
  const parsed = jsonTextOf(v);
  return parsed === undefined || (text && typeof parsed !== "string") ? v : parsed;
}

/** A field's value argument (`jsonArg`), read as its field takes it: as text for a text or enum field of `entity`'s kind. */
export function fieldValueArg(view: ToolReadView, args: JsonObject, key: string, entity: string, field: string): JsonValue | undefined {
  const kind = own(view.state.entities, entity)?.kind;
  const type = kind === undefined ? undefined : fieldDef(view.registry, view.world, kind, field)?.type;
  return jsonArg(args, key, type === "text" || type === "enum");
}

/** The dry run of `op`, as a write tool answers it; an agent with no writer reads only. */
export async function propose(view: ToolReadView, writer: ToolWriter | null, op: AgentOp): Promise<ToolOutcome> {
  if (!writer) return view.refuse(WRITE_NOTE.noWriter);
  const out = await writer.dryRun(op);
  if ("refused" in out) return { text: JSON.stringify({ refused: { code: out.code, reason: out.reason } }), error: true };
  return view.answer({ proposed: { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines } });
}

/** A GM edit as a tool builds it from its arguments: the writer reads it for its shape again (`parseEditOps`), so a malformed one is refused there. */
export function gmEdit(op: JsonObject): AgentOp {
  return { kind: "gm_edit", op: op as unknown as EditOp };
}

/** The note that `tool` needs `arg`, with that argument's description in the user's words: for an argument that isn't a text, which `needText` reads. */
export function missing(view: ToolReadView, tool: string, arg: string): ToolOutcome {
  return view.refuse(TOOL_NOTE.missing, { tool, arg, text: view.text(toolArgTextId(tool, arg)) });
}

/** A true-or-false argument; null when it is absent or anything else. */
export function boolArg(args: JsonObject, key: string): boolean | null {
  const v = args[key];
  return typeof v === "boolean" ? v : null;
}

/** The id a name argument the tool can't do without resolves to (`resolve`, among what the view may name), or the note the model is answered with: missing, not found, or several. */
export function needId(view: ToolReadView, tool: string, args: JsonObject, key: string, resolve: (view: ToolReadView, said: string) => Resolved): string | ToolOutcome {
  const said = needText(view, tool, args, key);
  if (typeof said !== "string") return said;
  const r = resolve(view, said);
  return "refused" in r ? r.refused : r.id;
}

/**
 * An object argument whose absence the change reads as null (a section back to the world's, a
 * memory deleted, a chat's change dropped), written as JSON text (`jsonObject`) or sent as itself:
 * the object, null when it is absent or null, undefined when it is anything else (text that isn't
 * JSON included), which the tool refuses rather than read as absent and undo something.
 */
export function nullableObject(args: JsonObject, key: string): JsonObject | null | undefined {
  const raw = args[key];
  const v = typeof raw === "string" ? jsonTextOf(raw) : raw;
  if (raw === undefined || v === null) return null;
  return isRecord(v) ? (v as JsonObject) : undefined;
}
