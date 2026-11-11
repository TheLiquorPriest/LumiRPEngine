// What every write tool answers (AGENT-LOOP-PLAN §6; INC1-SPEC R3b). Outside a turn, its operation's
// dry run, never the write itself: an agent only proposes a change, the GM assistant collects its
// proposals (its `env.writer` keeps each dry run's operation) and applies them on the game master's
// Apply, or at once where Settings lets it. Working a turn, the turn's writer stages it at once
// (`ToolWriter.stage`): it lands when the turn commits, or waits for the GM's Apply on the review
// card. A tool answers as JSON: what the change does in plain words, its change type and mode (and, in
// a turn, where it stands), or the code and reason it can't be made.

import { ROLE_TIERS } from "../../../shared/agent-roles";
import { TOOL_NOTE, toolArgTextId, type ToolTier } from "../../../shared/agent-tools";
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

/** What `op` comes to, as a write tool answers it: staged into the turn by a turn's writer, else its dry run; an agent with no writer reads only. */
export async function propose(view: ToolReadView, writer: ToolWriter | null, op: AgentOp): Promise<ToolOutcome> {
  if (!writer) return view.refuse(WRITE_NOTE.noWriter);
  const out = writer.stage ? await writer.stage(op) : await writer.dryRun(op);
  if ("refused" in out) return refusedAnswer(out);
  const change = { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines };
  // A staged change says where it stands: landing with the turn, waiting on the review card, or written already where no turn holds it.
  if (writer.stage) return view.answer({ staged: { ...change, lands: out.mode === "confirm" ? view.text(WRITE_NOTE.stagedReview) : (out.written ?? view.text(WRITE_NOTE.staged)) } });
  return view.answer({ proposed: change });
}

/**
 * Why the calling agent may not make a change of the tier `needs` that never passes through the
 * writer (a noted fact, a harness tool's own staged change), which checks its operations' tiers
 * itself; null when it may. On the harness the turn says what the caller holds (`HarnessTurn.tier`,
 * the author's grants included; unsaid, the game master's for the author and nothing for anyone
 * else): an agent there is given whatever tools its definition lists, a user's own among them, so
 * being given a tool says nothing of who it is. The old engines give an agent a tool only at a tier
 * its role holds (`roleToolScope`), and have no turn to ask.
 */
export function tierRefusal(view: ToolReadView, env: Pick<ToolEnv, "turn">, needs: ToolTier): ToolOutcome | null {
  const turn = env.turn;
  if (!turn) return null;
  const held = turn.tier ?? (turn.main ? "gm" : "read");
  if (ROLE_TIERS.indexOf(held) >= ROLE_TIERS.indexOf(needs)) return null;
  return held === "read" ? view.refuse(WRITE_NOTE.noWriter) : view.refuse(WRITE_NOTE.notGranted, { tier: held, needs });
}

/** The tier a noted fact is: the story's own change (ITEMS-SPEC §7.3), which every tool that notes one is listed at. */
export const NOTE_TIER: ToolTier = "story";

/**
 * A fact a Curator's tool notes for the reply's read (`ToolEnv.notes`): read as classic's parser reads
 * the read's own (money in minor units), checked by its channel against the head, then noted once,
 * to land with the read's changes under its type's mode; or why it can't be. The caller's tier is
 * held here (`tierRefusal`), where every tool that notes passes, and before anything of the fact is
 * read: a note is no operation of the writer's, so nothing after this checks who makes it.
 */
export function noteFact(view: ToolReadView, env: Pick<ToolEnv, "notes" | "turn">, fact: JsonObject): ToolOutcome {
  if (!env.notes) return view.refuse(WRITE_NOTE.noWriter);
  const below = tierRefusal(view, env, NOTE_TIER);
  if (below) return below;
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
