// The agents' writer (C7; INC1-SPEC R3b; AGENT-LOOP-PLAN §6, "The write path, every time"). Every
// change an agent makes is an `AgentOp`: a GM edit, a mind or routine edit, a ✎ fix, or a workspace
// file written, deleted, moved or pinned (and, for the GM alone, a file's readers set). A dry run
// checks one as it would be written and says what it would change; apply writes a batch of them as
// one GM edit. This is the writer outside a turn's engine run (`outsideWriter`: the GM agent chat,
// GM → Workspace); a turn agent's, which writes inside the engine op, is Increment 2's.
//
// The write path, for every operation:
// 1. It is read for its shape and turned into what the engine writes (`FixOp`s): a GM edit as
//    `lre.edit` takes it, a ✎ fix as `lre.fix` does (locked fields refused, a place only one the
//    player character can see, a moved person's activity left behind), a workspace file's body as
//    the hash of the blob it will be, with whose knowledge may read the file: an agent's file, the
//    knowledge it writes under; the GM's own, the readers the GM chose, else the GM's alone. A file
//    under `learned/` is the learned area's instead: its change is made in the chat's metadata
//    (`ChatAgentMeta`), not its ledger, and no file moves into or out of the area.
// 2. It is held to the agent's knowledge through the tool layer's view (`ToolReadView`): an id the
//    view may not name reads as no such person, thing, place or track, in the tool layer's own words,
//    and, under any knowledge but the GM's, so does an id a value names where the engine reads one
//    (a reference field's, a routine block's place and company, a schedule's slots for a reference
//    field), a missing one alike; a workspace file the knowledge may not read is no file to it. Under
//    the player character's knowledge no effect is proposed at all.
// 3. Its change type (`changeTypeOf`) is looked up in the user's modes, keyed by the agent's role,
//    its connection and the type (`effectiveMode`): Never refuses it; Auto and Confirm say how its
//    proposal may land. The GM's own writes (`GM_ROLE`, GM → Workspace) are no agent's: no mode or
//    cap applies to them.
// 4. The caps apply: a GM spawn of a person once the chat has brought in as many people as the
//    world's spawn cap allows (Build → World) is refused.
// 5. The engine validates it as it validates GM edits (`resolveEdit`), against the head for a dry
//    run, and on apply against the head plus the batch's operations before it.
// 6. Apply writes the operations that pass as ONE `fix` post entry on the head: a GM edit
//    (`gm: true`) with one Undo chip, kept with what it asked for (`edit`), so one held through a
//    turn's engine run, which every agent write is whatever "Hold writes during the engine run" says
//    (`hold: true`, R4), lands when the turn closes, worked out again over what the turn did
//    (`resolveFix`), and never discards the turn. The entry names the agent (`PostEntry.agent`: its
//    role, the batch's key, the label it was applied with and the knowledge it wrote under). A
//    learned-area change lands at once, in the chat's metadata, with no Undo chip.
//
// Operation keys are a hash of the operation (`opKey`) and a batch's a hash of its role and its
// operations' keys, so a retry of a batch the head already has, or the journal holds, writes nothing
// again. What a dry run says is worded for the agent's knowledge: the author's lines for `gm`; the
// same for `everyone`, with an unrevealed secret's words marked as the narrator's scene view marks
// them, in the user's wording (the prompt registry's Secret marks texts); only what the player
// character may see for `pov`. The engine's refusals are the GM's reasons, marked the same way for
// `everyone`; under `pov` every one is the same note, whatever its reason, so none tells what the
// player character can't know. The writer's own answers are the tool layer's notes, editable texts.

import { type AgentKnowledge, isAgentKnowledge, knowledgeWithin, TOOL_NOTE } from "../../../shared/agent-tools";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { hashJson } from "../../../shared/hash";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { FixOp, LedgerEvent, PostEntry } from "../../../shared/ledger";
import { isWitnessRef, type MindEditOp } from "../../../shared/minds";
import { EDIT_OPS_MAX, type EditOp, WRITE_REFUSED } from "../../../shared/protocol";
import { isOff, type RoutineEditOp } from "../../../shared/routines";
import { AGENT_CHANGE_LABEL, type AgentChangeType, type ExtractionLearning, type UserSettings } from "../../../shared/settings";
import { blobHash, isLearnedPath, isWorkspacePath } from "../../../shared/stores";
import { type FieldDef, spawnCapOf } from "../../../shared/world";
import { parseEditOps, resolveEdit } from "../../../engine/edits";
import { activeRecord } from "../../../engine/ledger/path";
import { own } from "../../../engine/pack-kit";
import { authorLines, playerLines } from "../../../engine/player-events";
import type { Rejection } from "../../../engine/registry";
import { fieldDef, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, canSeeField, canSeePlace, findLeaks, unrevealedSecrets } from "../../../engine/visibility";
import { Working } from "../../../engine/working";
import { readersOf, workspaceOf, wsDelete, wsPin, wsReaders, wsWrite } from "../../../engine/workspace";
import type { LearnedFile } from "../../chat-agent-meta";
import { markWording, renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { effectiveMode } from "../../settings-store";
import { appliedEvents, clockFixLine, fixChip, unseenFixLine } from "../../view";
import { readView, type ToolReadView } from "./read-view";
import type { ToolEnv } from "./registry";
import { chatHead, type ChatHead } from "./workspace";

// ---------------------------------------------------------------- the contract

/** One change an agent asks for. A GM edit's `op` is typed as `lre.edit` takes it; a mind's, a routine's and a ✎ fix's are read for their shape here. A file's `readers` are the GM's to choose: an agent's file is read with its own knowledge. */
export type AgentOp =
  | { kind: "gm_edit"; op: EditOp }
  | { kind: "mind_edit"; edit: JsonObject }
  | { kind: "routine_edit"; edit: JsonObject }
  | { kind: "fix"; fix: JsonObject }
  | { kind: "ws_write"; path: string; text: string; readers?: AgentKnowledge }
  | { kind: "ws_delete"; path: string }
  | { kind: "ws_move"; from: string; to: string }
  | { kind: "ws_pin"; path: string; pinned: boolean }
  | { kind: "ws_readers"; path: string; readers: AgentKnowledge };

/**
 * Whether an operation is the learned area's (a workspace change under `learned/`): made in the
 * chat's metadata at once, which no Undo chip takes back. A move into or out of the area is
 * refused, so its source decides.
 */
export function isLearnedOp(op: AgentOp): boolean {
  switch (op.kind) {
    case "ws_write":
    case "ws_delete":
    case "ws_pin":
    case "ws_readers":
      return typeof op.path === "string" && isLearnedPath(op.path);
    case "ws_move":
      return typeof op.from === "string" && isLearnedPath(op.from);
    default:
      return false;
  }
}

/** What a dry run found: the operation's key, its change type and mode, and what it would change in plain words, as the agent's knowledge has it. */
export interface OpPreview {
  key: string;
  changeType: AgentChangeType;
  /** The user's mode for its change type (Settings → Changes from the reply): Auto may apply it at once; Confirm waits for the game master's Apply. Never is a refusal. */
  mode: "auto" | "confirm";
  lines: string[];
}

/** An operation that can't be made: a code, why in plain words for the agent's knowledge, and its key when it could be read. */
export interface OpRefusal {
  refused: true;
  code: string;
  reason: string;
  key?: string;
}

/** What an apply did: the keys of the operations it wrote and of those it refused, each in order, the Undo chip of the GM edit it wrote, and whether that waits for a turn under way. */
export interface ApplyResult {
  applied: string[];
  refused: OpRefusal[];
  /** The chat's chip that undoes the batch; null while it is held, or when nothing was written. */
  chipId: string | null;
  /** Held through a turn's engine run or reply: it lands when the turn closes. */
  pending: boolean;
}

export interface ToolWriter {
  /** Checks one operation against the head as it would be written; never writes. */
  dryRun(op: AgentOp): Promise<OpPreview | OpRefusal>;
  /** Writes the operations that pass as one GM edit, held while a turn runs, with one Undo chip. */
  apply(ops: readonly AgentOp[], label: string): Promise<ApplyResult>;
}

/** Who writes, and as whom: the tool env without its writer, and the connection the agent runs on (null or absent: no learned mode applies). */
export type WriterEnv = Omit<ToolEnv, "writer"> & { connectionId?: string | null };

/** The role of the GM's own writes through the writer (GM → Workspace): no agent's, so no mode or cap applies. */
export const GM_ROLE = "gm";

/** An operation's key: the hash of the operation as given, so the same operation is the same key on every retry. */
export function opKey(op: AgentOp): string {
  return hashJson(["lre.agent.op", op as unknown as JsonValue]);
}

export function outsideWriter(rt: Runtime, env: WriterEnv): ToolWriter {
  return {
    dryRun: (op) => dryRun(rt, env, op),
    apply: (ops, label) => serialized(rt, env, () => apply(rt, env, ops, label)),
  };
}

// ---------------------------------------------------------------- reading an operation

/** The head an operation is checked against, read once per dry run or apply, with what its checks and wording read. */
interface Ctx {
  head: ChatHead;
  /** The head as the agent's knowledge reads it: what it may name, its marks, the tool layer's notes in the user's words. */
  view: ToolReadView;
  settings: UserSettings;
  learning: ExtractionLearning;
  /** The learned area as the chat's metadata holds it. */
  learned: Readonly<Record<string, LearnedFile>>;
}

/** An operation read: what the engine writes for it, how it validates, and a file's new body. */
interface Prepared {
  key: string;
  op: AgentOp;
  ops: FixOp[];
  /** A written file's body, put as a blob just before its write. */
  body?: { text: string; hash: string };
  /** A learned-area change instead (in the chat's metadata, not its ledger): each path's file after it, null where it is taken out, and the events that word it, never written. */
  learned?: { changes: Record<string, LearnedFile | null>; shown: LedgerEvent[] };
}

function refusal(code: string, reason: string, key?: string): OpRefusal {
  return { refused: true, code, reason, ...(key !== undefined ? { key } : {}) };
}

function isRefusal<T extends object>(v: T | OpRefusal): v is OpRefusal {
  return "refused" in v;
}

/** The minds' controls a mind edit takes, and Cast life's a routine edit takes: lookups over the ops, so a new one fails the typecheck until it is here. */
const MIND_OPS: Readonly<Record<MindEditOp["op"], true>> = { mind_pin: true, mind_refresh: true, mind_memory: true, mind_intent: true, mind_knowledge: true };
const ROUTINE_OPS: Readonly<Record<RoutineEditOp["op"], true>> = { routine_follow: true, routine_block: true, schedule_override: true };

/** One edit as `lre.edit` reads it, or null when it isn't one. */
function oneEdit(raw: unknown): EditOp | null {
  const [edit] = parseEditOps([raw]) ?? [];
  return edit ?? null;
}

/** The ✎ fix an agent asks for (`lre.fix`'s, `backend/dispatch.ts`): the clock, or one field the player could correct, against `state` (the head, and on apply the batch's operations before it). */
function prepareFix(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>, key: string, op: Extract<AgentOp, { kind: "fix" }>): Prepared | OpRefusal {
  const fix = op.fix;
  const bad = (): OpRefusal => refusal("bad_op", ctx.view.text(WRITE_NOTE.badOp), key);
  if (!isRecord(fix)) return bad();
  if (typeof fix.time === "string") return fix.entity !== undefined || fix.field !== undefined || fix.value !== undefined ? bad() : { key, op, ops: [{ op: "clock", time: fix.time }] };
  if (typeof fix.entity !== "string" || typeof fix.field !== "string" || fix.value === undefined) return bad();
  const { world } = ctx.head;
  // Each field is set as `lre.fix` sets it, under the player's rules (`fix_set`), inside the batch's GM edit: so one held through a reply is worked out again under the rules it was checked with.
  const set: FixOp = { op: "fix_set", entity: fix.entity, field: fix.field, value: fix.value as JsonValue };
  // A place fixed with ✎ is a real move, to a place the player character can see, of someone it
  // sees, and their activity is left behind where they were, as `lre.fix` does.
  if (fix.field === "place" && (typeof fix.value !== "string" || !canSeePlace(rt.registry, world, state, world.pov, fix.value) || !canSeeEntity(rt.registry, world, state, world.pov, fix.entity))) return refusal("missing_place", ctx.view.text(TOOL_NOTE.noPlace, { name: typeof fix.value === "string" ? fix.value : "" }), key);
  const doing = own(state.entities, fix.entity)?.fields.activity;
  const moved = fix.field === "place" && fix.value !== own(state.entities, fix.entity)?.fields.place;
  const ops: FixOp[] = moved && doing !== undefined && doing !== "idle" ? [set, { op: "fix_set", entity: fix.entity, field: "activity", value: "idle" }] : [set];
  return { key, op, ops };
}

type FileOp = Extract<AgentOp, { kind: "ws_write" | "ws_delete" | "ws_move" | "ws_pin" | "ws_readers" }>;

/**
 * A workspace operation against the files of `state` and of the learned area (`learned`), held to
 * those the agent's knowledge may read: one the batch wrote before it is the agent's own. A path
 * under `learned/` is the learned area's, changed in the chat's metadata; no file moves into or out
 * of it. An agent's file is read with its own knowledge; the GM's with the readers it chose, else
 * the GM's alone; and only the GM changes a file's readers without writing it.
 */
function prepareFile(ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, learned: Readonly<Record<string, LearnedFile>>, key: string, op: FileOp): Prepared | OpRefusal {
  const files = workspaceOf(state);
  const gm = env.agent.role === GM_ROLE;
  const readersAt = (path: string): AgentKnowledge | undefined => (isLearnedPath(path) ? own(learned, path)?.readers : own(files, path) !== undefined ? readersOf(state, path) : undefined);
  const hidden = (path: string): boolean => {
    const readers = readersAt(path);
    return readers !== undefined && !knowledgeWithin(readers, env.knowledge);
  };
  const bad = (path: unknown): OpRefusal | null => (isWorkspacePath(path) ? null : refusal("bad_path", ctx.view.text(WRITE_NOTE.badPath, { path: String(path) }), key));
  const none = (path: string): OpRefusal => refusal("no_file", ctx.view.text(WRITE_NOTE.noFile, { path }), key);
  const badOp = (): OpRefusal => refusal("bad_op", ctx.view.text(WRITE_NOTE.badOp), key);
  const same = (): OpRefusal => refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), key);
  const learn = (changes: Record<string, LearnedFile | null>, shown: LedgerEvent[], body?: { text: string; hash: string }): Prepared => ({ key, op, ops: [], ...(body ? { body } : {}), learned: { changes, shown } });
  switch (op.kind) {
    case "ws_write": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (typeof op.text !== "string" || (op.readers !== undefined && (!gm || !isAgentKnowledge(op.readers)))) return badOp();
      if (hidden(op.path)) return refusal("path_taken", ctx.view.text(WRITE_NOTE.pathTaken, { path: op.path }), key);
      // An agent's file is read with its own knowledge; the GM's with the readers it chose, else as the file is read now, a new one by the GM alone.
      const readers = gm ? (op.readers ?? readersAt(op.path) ?? "gm") : env.knowledge;
      const hash = blobHash(op.text);
      const body = { text: op.text, hash };
      if (!isLearnedPath(op.path)) return { key, op, ops: [{ op: "ws_write", path: op.path, hash, readers }], body };
      const now = own(learned, op.path);
      if (now?.hash === hash && now.readers === readers) return same();
      const shown = [...(now?.hash === hash ? [] : [wsWrite(op.path, hash)]), ...((now?.readers ?? "gm") !== readers ? [wsReaders(op.path, readers)] : [])];
      return learn({ [op.path]: { hash, readers, ...(now?.pinned ? { pinned: true as const } : {}), role: env.agent.role } }, shown, body);
    }
    case "ws_delete": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (hidden(op.path)) return none(op.path);
      if (!isLearnedPath(op.path)) return { key, op, ops: [{ op: "ws_delete", path: op.path }] };
      return own(learned, op.path) ? learn({ [op.path]: null }, [wsDelete(op.path)]) : none(op.path);
    }
    case "ws_move": {
      const wrong = bad(op.from) ?? bad(op.to);
      if (wrong) return wrong;
      if (hidden(op.from)) return none(op.from);
      if (isLearnedPath(op.from) !== isLearnedPath(op.to)) return refusal("learned_move", ctx.view.text(WRITE_NOTE.learnedMove, { path: op.from, to: op.to }), key);
      if (!isLearnedPath(op.from)) return { key, op, ops: [{ op: "ws_move", from: op.from, to: op.to }] };
      const file = own(learned, op.from);
      if (!file) return none(op.from);
      if (op.to === op.from) return same();
      if (own(learned, op.to)) return refusal("file_exists", ctx.view.text(WRITE_NOTE.fileExists, { to: op.to }), key);
      // The file keeps its pin and its readers, as a move in the head does.
      return learn({ [op.from]: null, [op.to]: file }, [wsWrite(op.to, file.hash), wsDelete(op.from), ...(file.pinned ? [wsPin(op.to, true)] : []), ...(file.readers !== "gm" ? [wsReaders(op.to, file.readers)] : [])]);
    }
    case "ws_pin": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (typeof op.pinned !== "boolean") return badOp();
      if (hidden(op.path)) return none(op.path);
      if (!isLearnedPath(op.path)) return { key, op, ops: [{ op: "ws_pin", path: op.path, pinned: op.pinned }] };
      const file = own(learned, op.path);
      if (!file) return none(op.path);
      if ((file.pinned === true) === op.pinned) return same();
      const { pinned: _pinned, ...rest } = file;
      return learn({ [op.path]: op.pinned ? { ...rest, pinned: true } : rest }, [wsPin(op.path, op.pinned)]);
    }
    case "ws_readers": {
      if (!gm || !isAgentKnowledge(op.readers)) return badOp();
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (!isLearnedPath(op.path)) return { key, op, ops: [{ op: "ws_readers", path: op.path, readers: op.readers }] };
      const file = own(learned, op.path);
      if (!file) return none(op.path);
      if (file.readers === op.readers) return same();
      return learn({ [op.path]: { ...file, readers: op.readers } }, [wsReaders(op.path, op.readers)]);
    }
  }
}

/** Reads an operation into what the engine writes for it against `state` and the learned area (`learned`), or why it can't be read. */
function prepare(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, learned: Readonly<Record<string, LearnedFile>>, op: AgentOp): Prepared | OpRefusal {
  const bad = (key?: string): OpRefusal => refusal("bad_op", ctx.view.text(WRITE_NOTE.badOp), key);
  if (!isRecord(op)) return bad();
  let key: string;
  try {
    key = opKey(op);
  } catch {
    return bad();
  }
  switch (op.kind) {
    case "gm_edit": {
      const edit = oneEdit(op.op);
      return edit ? { key, op, ops: [edit] } : bad(key);
    }
    case "mind_edit": {
      const edit = oneEdit(op.edit);
      return edit && own(MIND_OPS, edit.op) ? { key, op, ops: [edit] } : bad(key);
    }
    case "routine_edit": {
      const edit = oneEdit(op.edit);
      return edit && own(ROUTINE_OPS, edit.op) ? { key, op, ops: [edit] } : bad(key);
    }
    case "fix":
      return prepareFix(rt, ctx, state, key, op);
    case "ws_write":
    case "ws_delete":
    case "ws_move":
    case "ws_pin":
    case "ws_readers":
      return prepareFile(ctx, env, state, learned, key, op);
    default:
      return bad(key);
  }
}

// ---------------------------------------------------------------- knowledge, modes and caps

/** The ids an operation names, by what each must be: a person, any entity (told as a thing when not found, as the resolver tells it), a relation's far end (an entity or a place), a place, a track, or a fact. */
interface Named {
  people: string[];
  entities: string[];
  ends: string[];
  places: string[];
  tracks: string[];
  facts: string[];
}

function namedIds(op: FixOp): Named {
  const n: Named = { people: [], entities: [], ends: [], places: [], tracks: [], facts: [] };
  switch (op.op) {
    case "set":
    case "fix_set":
    case "add":
    case "entity":
    case "classify":
    case "despawn":
    case "restore":
      n.entities.push(op.entity);
      break;
    case "mind_pin":
    case "mind_refresh":
    case "mind_memory":
    case "mind_intent":
    case "routine_follow":
    case "routine_block":
    case "schedule_override":
      n.people.push(op.entity);
      break;
    case "mind_knowledge": {
      // Whom its holding names (a teller, those it's kept from) and the facts it rests on are held to the agent's knowledge, as its fact is.
      const h = isRecord(op.holding) ? op.holding : null;
      n.people.push(op.entity, ...(typeof h?.by === "string" ? [h.by] : []), ...(Array.isArray(h?.keptFrom) ? h.keptFrom.filter((id): id is string => typeof id === "string") : []));
      n.facts.push(op.fact, ...(Array.isArray(h?.evidence) ? h.evidence.filter((ref): ref is string => typeof ref === "string" && !isWitnessRef(ref)) : []));
      break;
    }
    case "life":
      n.people.push(op.entity, ...(op.tell ?? []));
      break;
    case "link":
    case "unlink":
      n.entities.push(op.from);
      n.ends.push(op.to);
      break;
    case "move":
      n.entities.push(op.entity);
      n.places.push(op.to);
      break;
    case "put":
      n.entities.push(op.entity, ...(op.into !== null ? [op.into] : []));
      break;
    case "adjust":
      n.entities.push(op.account);
      break;
    case "stage":
      n.tracks.push(op.track);
      break;
    case "spawn":
      if (op.place !== undefined) n.places.push(op.place);
      break;
  }
  return n;
}

/**
 * The note for the first id an operation names that the agent's view may not name (the resolver's
 * rule, `ToolReadView.sees*`); null when it may name every one. One the view may not name and one
 * that doesn't exist read exactly alike, in the note for what the operation's slot takes, never by
 * what the hidden one is, so no answer tells a hidden id from a missing one. An entity the batch
 * brought in before this operation (in `state`, not in the head) is the agent's own.
 */
function unseen(ctx: Ctx, state: Readonly<WorldState>, ops: readonly FixOp[]): string | null {
  const { view } = ctx;
  const named = (id: string): boolean => own(state.entities, id) !== undefined && (own(view.state.entities, id) === undefined || view.seesEntity(id));
  const note = (id: string, kind: string): string => view.text(kind, { name: id });
  for (const op of ops) {
    const n = namedIds(op);
    for (const id of n.people) if (!named(id)) return note(id, TOOL_NOTE.noPerson);
    for (const id of n.entities) if (!named(id)) return note(id, TOOL_NOTE.noThing);
    for (const id of n.ends) if (!named(id) && !view.seesPlace(id)) return note(id, TOOL_NOTE.noThing);
    for (const id of n.places) if (!view.seesPlace(id)) return note(id, TOOL_NOTE.noPlace);
    for (const id of n.tracks) if (!view.seesTrack(id)) return note(id, TOOL_NOTE.noTrack);
    for (const id of n.facts) if (!view.seesFact(id)) return note(id, TOOL_NOTE.noFact);
  }
  return null;
}

/**
 * The note for the first id an operation's values name where the engine reads an id that the
 * agent's view may not name: a reference field's value (each item of a list of them), a relation's
 * reference fields, a routine block's place and company, a schedule's slots when its target is a
 * reference field. A missing one reads exactly as a hidden one, in the note for what the slot
 * takes, so no answer tells them apart; null when the view may name every one. Null clears a
 * reference, and names nothing.
 */
function unseenValues(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>, ops: readonly FixOp[]): string | null {
  const { view } = ctx;
  const { world } = ctx.head;
  const entity = (id: unknown): boolean => typeof id === "string" && own(state.entities, id) !== undefined && (own(view.state.entities, id) === undefined || view.seesEntity(id));
  const place = (id: unknown): boolean => typeof id === "string" && view.seesPlace(id);
  const note = (id: unknown, kind: string): string => view.text(kind, { name: typeof id === "string" ? id : JSON.stringify(id) });
  /** A value of a field of this definition: a reference names an entity (of its kind, when it names one) or, with none named, a place too. */
  const ref = (def: FieldDef, value: unknown): string | null => {
    if (def.type === "list") return def.of === "ref" && Array.isArray(value) ? (value.map((item) => ref({ ...def, type: "ref" }, item)).find((n) => n !== null) ?? null) : null;
    if (def.type !== "ref" || value === null) return null;
    return entity(value) || (def.ref === undefined && place(value)) ? null : note(value, TOOL_NOTE.noThing);
  };
  const fieldOf = (id: string, field: string): FieldDef | undefined => {
    const kind = own(state.entities, id)?.kind;
    return kind === undefined ? undefined : fieldDef(rt.registry, world, kind, field);
  };
  for (const op of ops) {
    if (op.op === "set" || op.op === "fix_set") {
      const def = fieldOf(op.entity, op.field);
      const hidden = def ? ref(def, op.value) : null;
      if (hidden !== null) return hidden;
    } else if (op.op === "link" && op.fields) {
      // A relation's own fields: a reference among them names an entity as a field's does.
      const rel = own(world.relations, op.rel) ?? rt.registry.relations.get(op.rel);
      for (const [key, value] of Object.entries(op.fields)) {
        const def = rel ? own(rel.fields, key) : undefined;
        const hidden = def ? ref(def, value) : null;
        if (hidden !== null) return hidden;
      }
    } else if (op.op === "routine_block" && op.value !== null && !isOff(op.value)) {
      const block = op.value;
      if (isRecord(block.place) && "place" in block.place && !place(block.place.place)) return note(block.place.place, TOOL_NOTE.noPlace);
      for (const id of block.company?.who.ids ?? []) if (!entity(id)) return note(id, TOOL_NOTE.noPerson);
      for (const id of block.company?.who.memberOf ?? []) if (!entity(id)) return note(id, TOOL_NOTE.noThing);
    } else if (op.op === "schedule_override" && op.value !== null && !("off" in op.value)) {
      const target = own(world.schedules, op.schedule)?.target;
      const def = target === undefined ? undefined : fieldOf(op.entity, target);
      if (!def) continue;
      for (const slot of op.value.slots) {
        const given = Object.entries(slot.given ?? {});
        const values: unknown[] = [...(slot.value !== undefined ? [slot.value] : []), ...(slot.weighted ?? []).map((w) => w.value), ...given.flatMap(([after, weighted]) => [after, ...weighted.map((w) => w.value)])];
        for (const value of values) {
          const hidden = ref(def, value);
          if (hidden !== null) return hidden;
        }
      }
    }
  }
  return null;
}

/**
 * The note for the first field an operation sets or adds to that the player character's view may
 * not read (`seesField`): one its kind has no such field as reads exactly as a hidden one, so no
 * answer tells of a hidden field, or of its value by how a change to it would land. Null when it may
 * read every one.
 */
function unseenField(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>, ops: readonly FixOp[]): string | null {
  const { world } = ctx.head;
  for (const op of ops) {
    if (op.op !== "set" && op.op !== "fix_set" && op.op !== "add") continue;
    const kind = own(state.entities, op.entity)?.kind;
    const declared = kind !== undefined && fieldDef(rt.registry, world, kind, op.field) !== undefined;
    if (!declared || !canSeeField(rt.registry, world, state, world.pov, op.entity, op.field)) return ctx.view.text(TOOL_NOTE.noField, { name: op.field });
  }
  return null;
}

/** Whether a field holds money: setting or adding to it moves money against a correction, as `adjust` does. */
function moneyField(rt: Runtime, head: ChatHead, state: Readonly<WorldState>, entity: string, field: string): boolean {
  return fieldDef(rt.registry, head.world, own(state.entities, entity)?.kind ?? "", field)?.type === "money";
}

/**
 * An operation's change type (AGENT-LOOP-PLAN §6): GM spawns, removals (of people; of anything else,
 * a destroy), money adjustments (an adjust, or a set, add or ✎ fix of a money field) and stages each
 * have their own, a workspace change is a note, and every other GM edit, mind, routine and ✎ fix is
 * `gm_edit`.
 */
export function changeTypeOf(rt: Runtime, head: ChatHead, state: Readonly<WorldState>, op: AgentOp): AgentChangeType {
  switch (op.kind) {
    case "ws_write":
    case "ws_delete":
    case "ws_move":
    case "ws_pin":
    case "ws_readers":
      return "workspace";
    case "mind_edit":
    case "routine_edit":
      return "gm_edit";
    case "fix":
      return isRecord(op.fix) && typeof op.fix.entity === "string" && typeof op.fix.field === "string" && moneyField(rt, head, state, op.fix.entity, op.fix.field) ? "money_adjust" : "gm_edit";
    case "gm_edit": {
      const edit = op.op;
      switch (edit.op) {
        case "spawn":
          return "gm_spawn";
        case "despawn": {
          const kind = own(state.entities, edit.entity)?.kind;
          return kind !== undefined && !kindIs(rt.registry, head.world, kind, "person") ? "destroy" : "despawn";
        }
        case "adjust":
          return "money_adjust";
        case "set":
        case "add":
          return moneyField(rt, head, state, edit.entity, edit.field) ? "money_adjust" : "gm_edit";
        case "stage":
          return "stage";
        default:
          return "gm_edit";
      }
    }
  }
}

/** The mode of an operation's change type for this agent, or why it can't be made at all: Never, or the spawn cap, a per-chat total of the people it brought in. The GM's own writes take neither. */
function gate(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, p: Prepared): { type: AgentChangeType; mode: "auto" | "confirm" } | OpRefusal {
  const { world } = ctx.head;
  const type = changeTypeOf(rt, ctx.head, state, p.op);
  if (env.agent.role === GM_ROLE) return { type, mode: "auto" };
  const { mode } = effectiveMode(ctx.settings, ctx.learning, env.connectionId ?? null, type, env.agent.role);
  if (mode === "never") return refusal("mode_never", ctx.view.text(WRITE_NOTE.never, { type: AGENT_CHANGE_LABEL[type] }), p.key);
  const spawn = p.ops[0];
  if (type === "gm_spawn" && spawn?.op === "spawn" && kindIs(rt.registry, world, spawn.kind, "person")) {
    let introduced = 0;
    for (const [id, e] of Object.entries(state.entities)) if (own(world.entities, id) === undefined && kindIs(rt.registry, world, e.kind, "person")) introduced++;
    if (introduced >= spawnCapOf(world)) return refusal("spawn_cap", ctx.view.text(WRITE_NOTE.spawnCap, { count: String(introduced) }), p.key);
  }
  return { type, mode };
}

// ---------------------------------------------------------------- wording for the agent's knowledge

/** Marks, as the narrator's scene view marks one, each text that holds an unrevealed secret's words of `state`: kept from the player character, in the user's wording. Only everyone's view marks (`ToolReadView.mark`). */
function marker(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>): (text: string) => string {
  const { world } = ctx.head;
  const secrets = unrevealedSecrets(rt.registry, world, state);
  const kept = [own(state.entities, world.pov)?.name ?? world.pov];
  return (text) => (findLeaks(text, secrets).length > 0 ? ctx.view.mark(text, { known: [], kept }) : text);
}

/** A refusal from the engine, worded for the agent's knowledge: the GM's reason; everyone's, its secrets marked; under the player character's, one note whatever the reason, so no refusal tells what the player character can't know. */
function refused(rt: Runtime, ctx: Ctx, knowledge: AgentKnowledge, rejection: Rejection, key: string): OpRefusal {
  if (knowledge === "gm") return refusal(rejection.code, rejection.gm ?? rejection.reason, key);
  if (knowledge === "everyone") return refusal(rejection.code, marker(rt, ctx, ctx.head.state)(rejection.gm ?? rejection.reason), key);
  return refusal("refused", ctx.view.text(WRITE_NOTE.povRefused, { pov: ctx.view.name(ctx.view.pov) }), key);
}

/** What an operation's events change, in plain words, as the agent's knowledge may have them; `after` is the state they leave, which names whom they bring in. A workspace change reads as the GM's line of it under every knowledge: its paths are the agents' own names. */
function linesOf(rt: Runtime, ctx: Ctx, knowledge: AgentKnowledge, type: AgentChangeType, after: Readonly<WorldState>, events: readonly LedgerEvent[]): string[] {
  const reg = rt.registry;
  const world = ctx.head.world;
  if (type === "workspace") return authorLines(reg, world, after, events, events.length);
  const clock = clockFixLine(events);
  if (knowledge === "pov") {
    const lines = [...(clock ? [clock] : []), ...playerLines(reg, world, after, world.pov, events, events.length)];
    return lines.length > 0 || events.length === 0 ? lines : [unseenFixLine(reg, world, after, events)];
  }
  const lines = [...(clock ? [clock] : []), ...authorLines(reg, world, after, events, events.length)];
  return knowledge === "gm" ? lines : lines.map(marker(rt, ctx, after));
}

// ---------------------------------------------------------------- dry run and apply

/** The head and what an operation's checks read; a refusal when the work was cancelled, or the chat plays no world or its revision isn't loaded. */
async function context(rt: Runtime, env: WriterEnv): Promise<Ctx | OpRefusal> {
  const settings = await rt.settings.get(env.userId);
  if (env.signal.aborted) return refusal("cancelled", renderPrompt(WRITE_NOTE.cancelled, settings.prompts.texts, {}));
  const head = await chatHead(rt, env.chatId, env.userId);
  if (!head) return refusal("no_world", renderPrompt(WRITE_NOTE.noWorld, settings.prompts.texts, {}));
  const learning = await rt.settings.learningOf(env.userId);
  const view = readView({ knowledge: env.knowledge, registry: rt.registry, world: head.world, state: head.state, texts: settings.prompts.texts, wording: markWording(settings.prompts.texts), threshold: settings.minds.knowledge.threshold });
  const { learned } = await rt.chatAgents.get(env.chatId, env.userId);
  return { head, view, settings, learning, learned };
}

/** A checked operation: what it writes in the head (none for a learned-area change), its type and mode, and the events that word it. */
interface Checked {
  p: Prepared;
  type: AgentChangeType;
  mode: "auto" | "confirm";
  events: LedgerEvent[];
  shown: LedgerEvent[];
}

/** Prepares, holds to knowledge, gates and validates one operation against `state` and the learned area (`learned`): what it writes and its mode, or why not. */
function check(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, learned: Readonly<Record<string, LearnedFile>>, op: AgentOp): Checked | OpRefusal {
  const p = prepare(rt, ctx, env, state, learned, op);
  if (isRefusal(p)) return p;
  const pov = { pov: ctx.view.name(ctx.view.pov) };
  // Under the player character's knowledge no effect is proposed: what one touches reaches past what
  // it may know, so every effect is refused alike, whatever it names.
  if (env.knowledge === "pov" && p.ops.some((o) => o.op === "effect")) return refusal("pov_effect", ctx.view.text(WRITE_NOTE.povEffect, pov), p.key);
  // Under the player character's knowledge only its own mind may be changed: anyone else's is beyond
  // it, so every change to one is refused alike, whoever it is and whatever that mind holds.
  if (env.knowledge === "pov" && p.ops.some((o) => own(MIND_OPS, o.op) !== undefined && "entity" in o && o.entity !== ctx.head.world.pov)) return refusal("not_your_mind", ctx.view.text(WRITE_NOTE.notYourMind, pov), p.key);
  const hidden = unseen(ctx, state, p.ops) ?? (env.knowledge !== "gm" ? unseenValues(rt, ctx, state, p.ops) : null) ?? (env.knowledge === "pov" ? unseenField(rt, ctx, state, p.ops) : null);
  if (hidden !== null) return refusal("not_found", hidden, p.key);
  // Under the player character's knowledge a spawn takes no id of its own: a refusal of only a taken
  // one would tell an id someone it can't know holds from a free one, so every id is refused alike.
  const named = env.knowledge === "pov" ? p.ops.find((o) => o.op === "spawn" && o.id !== undefined) : undefined;
  if (named?.op === "spawn") return refusal("bad_id", ctx.view.text(WRITE_NOTE.spawnId, { id: named.id ?? "" }), p.key);
  const g = gate(rt, ctx, env, state, p);
  if (isRefusal(g)) return g;
  // A learned-area change is the chat's metadata's, not the engine's: it writes no event.
  if (p.learned) return { p, type: g.type, mode: g.mode, events: [], shown: p.learned.shown };
  // A GM edit's rules; a ✎ fix's operations keep the player's (`fix_set`).
  const out = resolveEdit(rt.registry, ctx.head.world, state, p.ops, { gm: true, runSeed: ctx.head.run.runSeed });
  if ("rejection" in out) return refused(rt, ctx, env.knowledge, out.rejection, p.key);
  // A change that changes nothing is one note under the player character's knowledge, as every
  // refusal is there: that a value is already at its bound is the value told.
  if (out.events.length === 0) return env.knowledge === "pov" ? refusal("refused", ctx.view.text(WRITE_NOTE.povRefused, pov), p.key) : refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), p.key);
  return { p, type: g.type, mode: g.mode, events: out.events, shown: out.events };
}

async function dryRun(rt: Runtime, env: WriterEnv, op: AgentOp): Promise<OpPreview | OpRefusal> {
  const ctx = await context(rt, env);
  if (isRefusal(ctx)) return ctx;
  const checked = check(rt, ctx, env, ctx.head.state, ctx.learned, op);
  if (isRefusal(checked)) return checked;
  const after = new Working(rt.registry, ctx.head.world, ctx.head.state);
  after.applyAll(checked.events);
  return { key: checked.p.key, changeType: checked.type, mode: checked.mode, lines: linesOf(rt, ctx, env.knowledge, checked.type, after.state, checked.shown) };
}

/**
 * Whether the batch with `key` is `role`'s latest write, held in the journal or on the head reply:
 * then this apply is a retry of it, which writes nothing again. Only the latest counts, so a batch
 * asked for again after another one (pin, unpin, pin) is a new write.
 */
function written(ctx: Ctx, role: string, key: string): { chipId: string | null; pending: boolean; applied: string[] } | null {
  const { core, observed } = ctx.head;
  const held = core.journal.held.findLast((h) => h.write.kind === "post" && h.write.entry.agent?.role === role);
  if (held) {
    const agent = held.write.kind === "post" ? held.write.entry.agent : undefined;
    return agent?.key === key ? { chipId: null, pending: true, applied: agent.applied ?? [] } : null;
  }
  const chain = core.chain(observed);
  const index = chain.findLastIndex((m) => !m.isUser);
  const m = chain[index];
  const rec = m ? activeRecord(m, core.journal.tombstones) : null;
  if (!m || !rec) return null;
  // A write the turn it was held through already made so landed with no events of its own: it is still the role's latest.
  const latest = appliedEvents(rec, core.fold(observed), index).agents.findLast((a) => a.agent.role === role);
  return latest && latest.agent.key === key ? { chipId: latest.events.length > 0 ? fixChip(m.id, m.swipeId, latest.seq) : null, pending: false, applied: latest.agent.applied ?? [] } : null;
}

/** A batch's key (`PostEntry.agent.key`): its role and the keys of the operations it asks for, as given, so a retry of the same request finds the write it already made before any of them is checked again. */
export function batchKey(role: string, ops: readonly AgentOp[]): string {
  return hashJson(["lre.agent.batch", role, ops.map((op) => keyOf(op).key ?? null)]);
}

/** An operation's key for a refusal of the whole batch, when it can be read. */
function keyOf(op: AgentOp): { key?: string } {
  try {
    return { key: opKey(op) };
  } catch {
    return {};
  }
}

/** A sequence for the held writes' ids: each write is the journal's own, as the dispatcher's are. */
let writes = 0;

async function apply(rt: Runtime, env: WriterEnv, ops: readonly AgentOp[], label: string): Promise<ApplyResult> {
  const all = (r: OpRefusal): ApplyResult => ({ applied: [], refused: ops.map((op) => ({ ...r, ...keyOf(op) })), chipId: null, pending: false });
  const ctx = await context(rt, env);
  if (isRefusal(ctx)) return all(ctx);
  if (ops.length > EDIT_OPS_MAX) return all(refusal("too_many", ctx.view.text(WRITE_NOTE.tooMany, { max: String(EDIT_OPS_MAX) })));
  // The batch's key: its role and the keys of the operations it asks for, as given, so a retry of
  // the same request finds the write it already made before any of them is checked again.
  const asks = ops.map((op) => keyOf(op).key ?? null);
  const key = batchKey(env.agent.role, ops);
  const already = written(ctx, env.agent.role, key);
  if (already) return { applied: already.applied, refused: asks.flatMap((ask) => (ask && already.applied.includes(ask) ? [] : [refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), ask ?? undefined)])), chipId: already.chipId, pending: already.pending };
  const { world, run } = ctx.head;
  // Each operation is checked against the head and the learned area and the ones before it that
  // passed; one that doesn't is left out and the rest still go. Refusals come back in the
  // operations' order.
  const running = new Working(rt.registry, world, ctx.head.state);
  let learned: Record<string, LearnedFile> = { ...ctx.learned };
  const verdicts: (Prepared | OpRefusal)[] = [];
  for (const op of ops) {
    const checked = check(rt, ctx, env, running.state, learned, op);
    if (isRefusal(checked)) {
      verdicts.push(checked);
      continue;
    }
    if (checked.p.learned) learned = withLearned(learned, checked.p.learned.changes);
    else running.applyAll(checked.events);
    verdicts.push(checked.p);
  }
  const kept = verdicts.filter((v): v is Prepared => !isRefusal(v));
  if (kept.length === 0) return { applied: [], refused: verdicts.filter((v): v is OpRefusal => isRefusal(v)), chipId: null, pending: false };
  const files = kept.filter((p) => p.learned !== undefined);
  const edits = kept.filter((p) => p.learned === undefined);
  /** The kept operations the write refused after all, each as its refusal words it. */
  const refusedAs = new Map<Prepared, OpRefusal>();
  const refuseEdits = (why: (p: Prepared) => OpRefusal): void => {
    for (const p of edits) refusedAs.set(p, why(p));
  };
  let chipId: string | null = null;
  let pending = false;
  // Each new body is stored first, held for this write until its record, the journal or the learned index points at it.
  const holder = `agent:${key}`;
  try {
    for (const p of kept) if (p.body) await rt.blobs.put(env.userId, p.body.text, holder);
    // The learned area's changes land at once, in the chat's metadata: no turn holds them, and a swipe never changes them.
    if (files.length > 0) await rt.chatAgents.setLearned(env.chatId, env.userId, Object.assign({}, ...files.map((p) => p.learned?.changes ?? {})) as Record<string, LearnedFile | null>);
    if (edits.length > 0) {
      // The batch is one GM edit, resolved as `resolveFix` will resolve it again: one generator over
      // all of its operations, so a rebased view or a held landing works out the same ids.
      const asked: FixOp[] = edits.flatMap((p) => p.ops);
      const group = resolveEdit(rt.registry, world, ctx.head.state, asked, { gm: true, runSeed: run.runSeed });
      if ("rejection" in group) refuseEdits((p) => refused(rt, ctx, env.knowledge, group.rejection, p.key));
      else if (group.events.length === 0) refuseEdits((p) => refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), p.key));
      else {
        const agent: NonNullable<PostEntry["agent"]> = { role: env.agent.role, key, applied: edits.map((p) => p.key), label, ...(env.agent.role !== GM_ROLE ? { knowledge: env.knowledge } : {}) };
        const result = await rt.ledger.write(env.chatId, env.userId, { kind: "post", id: `a${Date.now().toString(36)}${(++writes).toString(36)}`, target: "head", entry: { kind: "fix", gm: true, events: group.events, edit: { ops: asked }, agent }, hold: true });
        if (result.reason === "paused") refuseEdits((p) => refusal("paused", ctx.view.text(WRITE_NOTE.paused), p.key));
        // The chat changed between the check and the write (a turn landed): the ledger's reason is the GM's.
        else if (!result.applied && !result.pending) refuseEdits((p) => refused(rt, ctx, env.knowledge, { code: WRITE_REFUSED, reason: ctx.view.text(WRITE_NOTE.stale), ...(result.reason ? { gm: result.reason } : {}) }, p.key));
        else {
          chipId = result.posted ? fixChip(result.posted.messageId, result.posted.swipeId, result.posted.seq) : null;
          pending = result.pending;
        }
      }
    }
  } finally {
    rt.blobs.release(env.userId, holder);
  }
  const applied = kept.filter((p) => !refusedAs.has(p)).map((p) => p.key);
  if (applied.length > 0) rt.push.changed(env.chatId, env.userId);
  const refusals = verdicts.flatMap((v): OpRefusal[] => {
    if (isRefusal(v)) return [v];
    const after = refusedAs.get(v);
    return after ? [after] : [];
  });
  return { applied, refused: refusals, chipId, pending };
}

/** The learned area with `changes` made: a file at each path, none where it is null. */
function withLearned(learned: Readonly<Record<string, LearnedFile>>, changes: Readonly<Record<string, LearnedFile | null>>): Record<string, LearnedFile> {
  const out = { ...learned };
  for (const [path, file] of Object.entries(changes)) {
    if (file === null) delete out[path];
    else out[path] = file;
  }
  return out;
}

/** Applies in turn per chat, so a retry finds the batch it repeats already written. */
const queues = new WeakMap<Runtime, Map<string, Promise<unknown>>>();

function serialized<T>(rt: Runtime, env: { chatId: ChatId; userId: UserId }, task: () => Promise<T>): Promise<T> {
  const byChat = queues.get(rt) ?? new Map<string, Promise<unknown>>();
  queues.set(rt, byChat);
  const key = `${env.userId}\u0000${env.chatId}`;
  const next = (byChat.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
  byChat.set(key, next);
  const done = (): void => {
    if (byChat.get(key) === next) byChat.delete(key);
  };
  next.then(done, done);
  return next;
}
