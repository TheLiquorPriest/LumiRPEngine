// What every write tool answers (AGENT-LOOP-PLAN §6; INC1-SPEC R3b). Outside a turn, its operation's
// dry run, never the write itself: an agent only proposes a change, the GM assistant collects its
// proposals (its `env.writer` keeps each dry run's operation) and applies them on the game master's
// Apply, or at once where Settings lets it. Working a turn, the turn's writer stages it at once
// (`ToolWriter.stage`): it lands when the turn commits, or waits for the GM's Apply on the review
// card. Called by an outside client (DESIGN §23), its writer applies it at once as the GM's own edit
// (`ToolWriter.write`). A tool answers as JSON: what the change does in plain words, its change type
// and mode (in a turn, where it stands; applied, its Undo chip), or the code and reason it can't be made.

import { TOOL_NOTE, toolArgTextId } from "../../../shared/agent-tools";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { EditOp } from "../../../shared/protocol";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { own } from "../../../engine/pack-kit";
import { fieldDef } from "../../../engine/scope";
import { extractAnswer } from "../../steps";
import type { ToolOutcome } from "../runtime";
import type { ToolReadView } from "./read-view";
import type { ToolEnv } from "./registry";
import type { Resolved } from "./resolve";
import { jsonTextOf, needText } from "./schema";
import type { AgentOp, OpRefusal, ToolWriter } from "./writer";

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

/** A write the writer refused, as a write tool answers it: its code and reason, and the thing or place a make found there already (`exists`). */
export function refusedAnswer(out: OpRefusal): ToolOutcome {
  return { text: JSON.stringify({ refused: { code: out.code, reason: out.reason, ...(out.exists !== undefined ? { exists: out.exists } : {}) } }), error: true };
}

/**
 * What `op` comes to, as a write tool answers it: applied at once by an outside client's writer (its
 * Undo chip, and whether it waits for a turn under way), staged into the turn by a turn's writer, else
 * its dry run; an agent with no writer reads only.
 */
export async function propose(view: ToolReadView, writer: ToolWriter | null, op: AgentOp): Promise<ToolOutcome> {
  if (!writer) return view.refuse(WRITE_NOTE.noWriter);
  if (writer.write) {
    const out = await writer.write(op);
    if ("refused" in out) return refusedAnswer(out);
    return view.answer({ applied: { key: out.preview.key, changeType: out.preview.changeType, lines: out.preview.lines, undo: out.applied.chipId, pending: out.applied.pending } });
  }
  const out = writer.stage ? await writer.stage(op) : await writer.dryRun(op);
  if ("refused" in out) return refusedAnswer(out);
  const change = { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines };
  // A staged change says where it stands: landing with the turn, or waiting on the review card.
  if (writer.stage) return view.answer({ staged: { ...change, lands: view.text(out.mode === "confirm" ? WRITE_NOTE.stagedReview : WRITE_NOTE.staged) } });
  return view.answer({ proposed: change });
}

/**
 * A fact a Curator's tool notes for the reply's read (`ToolEnv.notes`): read as classic's parser reads
 * the read's own (money in minor units), checked by its channel against the head, then noted once,
 * to land with the read's changes under its type's mode; or why it can't be.
 */
export function noteFact(view: ToolReadView, env: Pick<ToolEnv, "notes">, fact: JsonObject): ToolOutcome {
  if (!env.notes) return view.refuse(WRITE_NOTE.noWriter);
  const type = String(fact.type);
  const read = extractAnswer({ proposals: [fact] }, { world: view.world, appliedMinutes: 0, channels: [type], moves: false }).proposals[0];
  const channel = view.registry.proposals.get(type);
  if (!read || !channel) return view.refuse(WRITE_NOTE.badOp);
  const bad = channel.validate(read, view.ctx);
  if (bad) return { text: JSON.stringify({ refused: { code: bad.code, reason: bad.gm ?? bad.reason } }), error: true };
  env.notes.add(read);
  return view.answer({ noted: { changeType: type, lands: view.text(WRITE_NOTE.noted, { type }) } });
}

/** A list-of-words argument, each trimmed and the blank ones left out; null when absent or not a list of words. */
export function wordsArg(args: JsonObject, key: string): string[] | null {
  const v = args[key];
  return Array.isArray(v) && v.every((s) => typeof s === "string") ? v.map((s) => s.trim()).filter((s) => s !== "") : null;
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
