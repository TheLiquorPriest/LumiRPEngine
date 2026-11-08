// The agents' writer (C7; INC1-SPEC R3b; AGENT-LOOP-PLAN §6, "The write path, every time"). Every
// change an agent makes is an `AgentOp`: a GM edit, a mind or routine edit, a ✎ fix, or a workspace
// file written, deleted, moved or pinned. A dry run checks one as it would be written and says what
// it would change; apply writes a batch of them as one GM edit. This is the writer outside a turn's
// engine run (`outsideWriter`: the GM agent chat, GM → Workspace, an agent turn's review card); a
// turn agent's, which stages into its turn instead, is `turn-writer.ts`, through the same checks
// (`checkOp`, `opLines`, `contextOf`).
//
// The write path, for every operation:
// 1. It is read for its shape and turned into what the engine writes (`FixOp`s): a GM edit as
//    `lre.edit` takes it, a ✎ fix as `lre.fix` does (locked fields refused, a place only one the
//    player character can see, a moved person's activity left behind), a workspace file's body as
//    the hash of the blob it will be. A file under `learned/` (the learned area) or `~/` (the global
//    workspace) is kept apart from the story instead: its change is made in its store (the chat's
//    metadata, `ChatAgentMeta`; the user's storage, `GlobalWorkspace`), not the ledger, and no file
//    moves between the chat's story, its learned area and the global workspace. Every agent may
//    read and write every file, the pins manifest among them; a transcript is read-only.
// 2. It is held to the agent's knowledge through the tool layer's view (`ToolReadView`): an id the
//    view may not name reads as no such person, thing, place or track, in the tool layer's own words,
//    and, under any knowledge but the GM's, so does an id a value names where the engine reads one
//    (a reference field's, a routine block's place and company, a schedule's slots for a reference
//    field), a missing one alike.
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
//    turn's engine run, as every write made then is (R4), lands when the turn closes, worked out
//    again over what the turn did (`resolveFix`), and never discards the turn. The entry names the
//    agent (`PostEntry.agent`: its
//    role, the batch's key, the label it was applied with and the knowledge it wrote under). A kept
//    file's change lands at once, in its store, with no Undo chip.
//
// Operation keys are a hash of the operation (`opKey`) and a batch's a hash of its role and its
// operations' keys, so a retry of a batch the head already has, or the journal holds, writes nothing
// again. What a dry run says is worded for the agent's view: the author's lines for `gm`; the same
// for `everyone`, with an unrevealed secret's words marked as the narrator's scene view marks them,
// in the user's wording (the prompt registry's Secret marks texts); only what the player character
// may see for the review card (`player`). The engine's refusals are the GM's reasons, marked the
// same way for `everyone`. The writer's own answers are the tool layer's notes, editable texts.

import { ROLE_IDS, type RoleId } from "../../../shared/agent-roles";
import { TOOL_NOTE, type ToolView } from "../../../shared/agent-tools";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { hashJson } from "../../../shared/hash";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { FixOp, LedgerEvent, PostEntry } from "../../../shared/ledger";
import { isWitnessRef, type MindEditOp } from "../../../shared/minds";
import { EDIT_OPS_MAX, type EditOp, WRITE_REFUSED } from "../../../shared/protocol";
import { isOff, type RoutineEditOp } from "../../../shared/routines";
import { AGENT_CHANGE_LABEL, AGENT_CHANGE_TYPES, type AgentChangeType, type ChangeType, type ExtractionLearning, type UserSettings } from "../../../shared/settings";
import { type ItemChange, type ItemOp, sizeRank } from "../../../shared/things";
import { ORG_OP_CHANGE, orgOpIds } from "../../../shared/org-ops";
import { blobHash, isFilePath, isGlobalPath, isKeptPath, isLearnedPath, isTranscriptPath, type KeptFile } from "../../../shared/stores";
import { nounFor } from "../../../shared/words";
import { type FieldDef, spawnCapOf } from "../../../shared/world";
import { parseEditOps, resolveEdit } from "../../../engine/edits";
import { handChange } from "../../../engine/reconcile-things";
import { activeRecord } from "../../../engine/ledger/path";
import { own } from "../../../engine/pack-kit";
import { authorLines, playerLines } from "../../../engine/player-events";
import type { Rejection } from "../../../engine/registry";
import { fieldDef, kindIs } from "../../../engine/scope";
import { typeRowOf } from "../../../engine/thing-index";
import { sizeOf } from "../../../engine/things";
import { claimCap } from "../../../packs/economy/core/model";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, canSeePlace, findLeaks, unrevealedSecrets } from "../../../engine/visibility";
import { Working } from "../../../engine/working";
import { wsDelete, wsPin, wsWrite } from "../../../engine/workspace";
import { markWording, renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { effectiveMode } from "../../settings-store";
import { appliedEvents, clockFixLine, fixChip, unseenFixLine } from "../../view";
import { readView, type ToolReadView } from "./read-view";
import type { ToolEnv } from "./registry";
import { chatHead, type ChatHead, keptFiles } from "./workspace";

// ---------------------------------------------------------------- the contract

/** One change an agent asks for. A GM edit's `op` is typed as `lre.edit` takes it; a mind's, a routine's and a ✎ fix's are read for their shape here. A workspace path is the chat's, or the global workspace's under `~/`. */
export type AgentOp =
  | { kind: "gm_edit"; op: EditOp }
  | { kind: "mind_edit"; edit: JsonObject }
  | { kind: "routine_edit"; edit: JsonObject }
  | { kind: "fix"; fix: JsonObject }
  | { kind: "ws_write"; path: string; text: string }
  | { kind: "ws_delete"; path: string }
  | { kind: "ws_move"; from: string; to: string }
  | { kind: "ws_pin"; path: string; pinned: boolean };

/**
 * Whether an operation changes a file kept apart from the story (`isKeptPath`: under `learned/` or
 * `~/`): made in its store at once, which no Undo chip takes back. A move between the story and a
 * kept area, or between the two areas, is refused, so its source decides.
 */
export function isKeptOp(op: AgentOp): boolean {
  switch (op.kind) {
    case "ws_write":
    case "ws_delete":
    case "ws_pin":
      return typeof op.path === "string" && isKeptPath(op.path);
    case "ws_move":
      return typeof op.from === "string" && isKeptPath(op.from);
    default:
      return false;
  }
}

/** What a dry run found: the operation's key, its change type and mode, and what it would change in plain words, as the agent's knowledge has it. */
export interface OpPreview {
  key: string;
  changeType: ChangeType;
  /** The user's mode for its change type (Settings → Changes from the reply): Auto may apply it at once; Confirm waits for the game master's Apply. Never is a refusal. */
  mode: "auto" | "confirm";
  lines: string[];
}

/**
 * An operation that can't be made: a code, why in plain words for the agent's knowledge, and its key
 * when it could be read; a make that found what it would make names the thing or place there already
 * (`exists`, ITEMS-SPEC §6.1–6.2), so the agent uses that one.
 */
export interface OpRefusal {
  refused: true;
  code: string;
  reason: string;
  key?: string;
  exists?: string;
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
  /**
   * A turn's writer only (`turnWriter`): stages one operation into the turn at once, as a write tool
   * asks, and says what it staged: it lands when the turn commits, or, its mode Confirm, waits for the
   * GM's Apply on the turn's review card. A writer without it only proposes (`propose`).
   */
  stage?(op: AgentOp): Promise<OpPreview | OpRefusal>;
  /**
   * An outside client's writer only (`clientWriter`, DESIGN §23): checks one operation and, when it
   * passes, applies it at once, as the write tool asks: what it does, and the edit it landed as.
   */
  write?(op: AgentOp): Promise<{ preview: OpPreview; applied: ApplyResult } | OpRefusal>;
}

/**
 * Who writes, and as whom: the tool env without its writer, the connection the agent runs on (null
 * or absent: no learned mode applies), and whether it writes with the GM's say (`gm`, absent: it
 * does): a role below the GM tier makes a thing's or a place's change as the story's own, so it
 * merges no thing the world document defines, removes none, and moves a Built-in thing only once the
 * game master applies it.
 */
export type WriterEnv = Omit<ToolEnv, "writer"> & { connectionId?: string | null; gm?: boolean; client?: string };

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

/**
 * The writer of the agent tools an outside client calls (DESIGN §23; INC3-REEVAL decision 4): each
 * write tool applies its operation at once, as the GM's own edit (`GM_ROLE`: no mode or cap) with
 * one Undo chip, its entry naming the client (`client`); held while a turn runs, as every write is.
 */
export function clientWriter(rt: Runtime, env: WriterEnv & { client: string }): ToolWriter {
  const writer = outsideWriter(rt, { ...env, agent: { ...env.agent, role: GM_ROLE } });
  return {
    ...writer,
    async write(op) {
      const preview = await writer.dryRun(op);
      if (isRefusal(preview)) return preview;
      const applied = await writer.apply([op], `${env.client}: ${preview.lines[0] ?? changeLabel(preview.changeType)}`);
      if (applied.applied.includes(preview.key)) return { preview, applied };
      return applied.refused.find((r) => r.key === preview.key) ?? applied.refused[0] ?? refusal("no_change", "The change wasn't applied.", preview.key);
    },
  };
}

// ---------------------------------------------------------------- reading an operation

/** The head an operation is checked against, read once per dry run or apply, with what its checks and wording read. */
export interface WriterCtx {
  head: ChatHead;
  /** The head as the agent's knowledge reads it: what it may name, its marks, the tool layer's notes in the user's words. */
  view: ToolReadView;
  settings: UserSettings;
  learning: ExtractionLearning;
  /** The files kept apart from the story, by path: the learned area's, as the chat's metadata holds it, and the global workspace's. */
  kept: Readonly<Record<string, KeptFile>>;
  /** The connection an agent naming none works on (the user's default): its changes' learned modes count there, the key the review card counts their outcomes under. */
  active: string;
}

type Ctx = WriterCtx;

/** An operation read: what the engine writes for it, how it validates, and a file's new body. */
export interface PreparedOp {
  key: string;
  op: AgentOp;
  ops: FixOp[];
  /** A written file's body, put as a blob just before its write. */
  body?: { text: string; hash: string };
  /** A kept file's change instead (in its store, not the ledger): each path's file after it, null where it is taken out, and the events that word it, never written. */
  kept?: { changes: Record<string, KeptFile | null>; shown: LedgerEvent[] };
}

type Prepared = PreparedOp;

function refusal(code: string, reason: string, key?: string): OpRefusal {
  return { refused: true, code, reason, ...(key !== undefined ? { key } : {}) };
}

export function isOpRefusal<T extends object>(v: T | OpRefusal): v is OpRefusal {
  return "refused" in v;
}

const isRefusal = isOpRefusal;

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

type FileOp = Extract<AgentOp, { kind: "ws_write" | "ws_delete" | "ws_move" | "ws_pin" }>;

/** Where a file at `path` is kept: in the chat's story (its ledger), its learned area or the global workspace. */
function keptIn(path: string): "story" | "learned" | "global" {
  return isGlobalPath(path) ? "global" : isLearnedPath(path) ? "learned" : "story";
}

/**
 * A workspace operation against the files of `state` and the kept files (`kept`, the learned area's
 * and the global workspace's): a path under `learned/` or `~/` is a kept file's, changed in its
 * store; no file moves from the story, the learned area or the global workspace into another. Every
 * file is every agent's to write, the pins manifest among them; a transcript is kept as its turn
 * left it.
 */
function prepareFile(ctx: Ctx, env: WriterEnv, kept: Readonly<Record<string, KeptFile>>, key: string, op: FileOp): Prepared | OpRefusal {
  // A transcript (`transcripts/`) is kept as its turn left it: nothing writes, moves, deletes or pins one.
  const bad = (path: unknown): OpRefusal | null => (!isFilePath(path) ? refusal("bad_path", ctx.view.text(WRITE_NOTE.badPath, { path: String(path) }), key) : isTranscriptPath(path) ? refusal("transcript", ctx.view.text(WRITE_NOTE.transcriptReadOnly, { path }), key) : null);
  const none = (path: string): OpRefusal => refusal("no_file", ctx.view.text(WRITE_NOTE.noFile, { path }), key);
  const badOp = (): OpRefusal => refusal("bad_op", ctx.view.text(WRITE_NOTE.badOp), key);
  const same = (): OpRefusal => refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), key);
  const keep = (changes: Record<string, KeptFile | null>, shown: LedgerEvent[], body?: { text: string; hash: string }): Prepared => ({ key, op, ops: [], ...(body ? { body } : {}), kept: { changes, shown } });
  switch (op.kind) {
    case "ws_write": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (typeof op.text !== "string") return badOp();
      const hash = blobHash(op.text);
      const body = { text: op.text, hash };
      if (!isKeptPath(op.path)) return { key, op, ops: [{ op: "ws_write", path: op.path, hash }], body };
      const now = own(kept, op.path);
      if (now?.hash === hash) return same();
      return keep({ [op.path]: { hash, ...(now?.pinned ? { pinned: true as const } : {}), role: env.agent.role } }, [wsWrite(op.path, hash)], body);
    }
    case "ws_delete": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (!isKeptPath(op.path)) return { key, op, ops: [{ op: "ws_delete", path: op.path }] };
      return own(kept, op.path) ? keep({ [op.path]: null }, [wsDelete(op.path)]) : none(op.path);
    }
    case "ws_move": {
      const wrong = bad(op.from) ?? bad(op.to);
      if (wrong) return wrong;
      if (keptIn(op.from) !== keptIn(op.to)) return refusal("learned_move", ctx.view.text(WRITE_NOTE.learnedMove, { path: op.from, to: op.to }), key);
      if (!isKeptPath(op.from)) return { key, op, ops: [{ op: "ws_move", from: op.from, to: op.to }] };
      const file = own(kept, op.from);
      if (!file) return none(op.from);
      if (op.to === op.from) return same();
      if (own(kept, op.to)) return refusal("file_exists", ctx.view.text(WRITE_NOTE.fileExists, { to: op.to }), key);
      // The file keeps its pin, as a move in the head does.
      return keep({ [op.from]: null, [op.to]: file }, [wsWrite(op.to, file.hash), wsDelete(op.from), ...(file.pinned ? [wsPin(op.to, true)] : [])]);
    }
    case "ws_pin": {
      const wrong = bad(op.path);
      if (wrong) return wrong;
      if (typeof op.pinned !== "boolean") return badOp();
      if (!isKeptPath(op.path)) return { key, op, ops: [{ op: "ws_pin", path: op.path, pinned: op.pinned }] };
      const file = own(kept, op.path);
      if (!file) return none(op.path);
      if ((file.pinned === true) === op.pinned) return same();
      const { pinned: _pinned, ...rest } = file;
      return keep({ [op.path]: op.pinned ? { ...rest, pinned: true } : rest }, [wsPin(op.path, op.pinned)]);
    }
  }
}

/** Reads an operation into what the engine writes for it against `state` and the kept files (`kept`), or why it can't be read. */
function prepare(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, kept: Readonly<Record<string, KeptFile>>, op: AgentOp): Prepared | OpRefusal {
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
      if (!edit) return bad(key);
      // A thing's change keeps its reason only as long as Settings → Changes from the reply lets one be, wherever it lands or is worked out again.
      const max = ctx.settings.thingReads.whyMax;
      if (edit.op === "item" && "why" in edit.change && edit.change.why.length > max) return { key, op, ops: [{ ...edit, change: { ...edit.change, why: edit.change.why.slice(0, max) } }] };
      return { key, op, ops: [edit] };
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
      return prepareFile(ctx, env, kept, key, op);
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
    case "org": {
      // Everyone and everything an organization's change names (ORG-SPEC §7.2): its people, entities (the organization, a job, an account) and places.
      const ids = orgOpIds(op.change);
      n.people.push(...ids.people);
      n.entities.push(...ids.entities);
      n.places.push(...ids.places);
      break;
    }
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

/** Whether a field holds money: setting or adding to it moves money against a correction, as `adjust` does. */
function moneyField(rt: Runtime, head: ChatHead, state: Readonly<WorldState>, entity: string, field: string): boolean {
  return fieldDef(rt.registry, head.world, own(state.entities, entity)?.kind ?? "", field)?.type === "money";
}

/** The change type of each item op (ITEMS-SPEC §5.4) but a handover, whose basis decides (`handChange`). */
const ITEM_OP_CHANGE: Readonly<Record<Exclude<ItemOp["do"], "hand">, ItemChange | AgentChangeType>> = {
  make: "item_make",
  move: "item_move",
  own: "item_own",
  grant: "item_grant",
  revoke: "item_grant",
  permit: "item_grant",
  unpermit: "item_grant",
  home: "item_home",
  use: "item_use",
  wear: "item_wear",
  condition: "item_condition",
  lose: "item_lose",
  label: "item_label",
  merge: "item_merge",
  remove: "item_remove",
  // A saved outfit or loadout made, dropped or changed into (C5's sets).
  set_save: "item_set",
  set_apply: "item_set",
  set_drop: "item_set",
};

/** An item op's change type: a handover that keeps the owner, changes it or is a theft as its basis says; every other op its own. */
export function itemChangeOf(op: ItemOp): ChangeType {
  return op.do === "hand" ? handChange(op.basis) : ITEM_OP_CHANGE[op.do];
}

/**
 * An operation's change type (AGENT-LOOP-PLAN §6): GM spawns, removals (of people; of anything else,
 * a destroy), money adjustments (an adjust, or a set, add or ✎ fix of a money field) and stages each
 * have their own, a workspace change is a note, a thing's or a place's change is the type its op
 * lands under (ITEMS-SPEC §5.4, the one list the reply's read and the Curator share), and every other
 * GM edit, mind, routine and ✎ fix is `gm_edit`.
 */
export function changeTypeOf(rt: Runtime, head: ChatHead, state: Readonly<WorldState>, op: AgentOp): ChangeType {
  switch (op.kind) {
    case "ws_write":
    case "ws_delete":
    case "ws_move":
    case "ws_pin":
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
        case "item":
          return itemChangeOf(edit.change);
        case "place":
          // A place made in play is its own type (a room or spot at once, a venue asking first); naming or removing one is a GM edit.
          return edit.change.do === "make" ? "place_make" : "gm_edit";
        case "org":
          // An organization's change is its people, its powers, its shares and structure, or its rules (ORG-SPEC §7.3).
          return ORG_OP_CHANGE[edit.change.do];
        default:
          return "gm_edit";
      }
    }
  }
}

/** A change type in plain words: an agent type's label, else its id as Settings → Changes from the reply lists it. */
function changeLabel(type: ChangeType): string {
  const agent = AGENT_CHANGE_TYPES.find((t) => t === type);
  return agent ? AGENT_CHANGE_LABEL[agent] : type;
}

/**
 * The mode of an operation's change type for this agent, and whether the user pinned it, or why it
 * can't be made at all: Never, or the spawn cap, a per-chat total of the people it brought in. The
 * GM's own writes take neither.
 */
function gate(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, p: Prepared): { type: ChangeType; mode: "auto" | "confirm"; pinned: boolean } | OpRefusal {
  const { world } = ctx.head;
  const type = changeTypeOf(rt, ctx.head, state, p.op);
  if (env.agent.role === GM_ROLE) return { type, mode: "auto", pinned: true };
  const { mode, source } = effectiveMode(ctx.settings, ctx.learning, env.connectionId ?? ctx.active, type, env.agent.role);
  if (mode === "never") return refusal("mode_never", ctx.view.text(WRITE_NOTE.never, { type: changeLabel(type) }), p.key);
  const spawn = p.ops[0];
  if (type === "gm_spawn" && spawn?.op === "spawn" && kindIs(rt.registry, world, spawn.kind, "person")) {
    let introduced = 0;
    for (const [id, e] of Object.entries(state.entities)) if (own(world.entities, id) === undefined && kindIs(rt.registry, world, e.kind, "person")) introduced++;
    if (introduced >= spawnCapOf(world)) return refusal("spawn_cap", ctx.view.text(WRITE_NOTE.spawnCap, { count: String(introduced), people: nounFor(introduced, "person", "people") }), p.key);
  }
  return { type, mode, pinned: source === "pinned" };
}

/** One of a thing's type: its row's price where the catalogs give one (a band's typical), in minor units; null when nothing prices it. */
function priceOf(ctx: Working["ctx"], id: string): number | null {
  const price = typeRowOf(ctx, own(ctx.state.entities, id)?.fields ?? {})?.row.price_cents;
  if (typeof price === "number") return price;
  const typical = isRecord(price) ? price.typical : undefined;
  return typeof typical === "number" ? typical : null;
}

/**
 * Whether a thing's or a place's change asks first whatever its mode but a pin (ITEMS-SPEC §5.4, as
 * the reply's read asks): a new thing bigger than Armful (a vehicle among them) or costing more than
 * the world's claim cap, and a new venue.
 */
function asksFirst(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>, p: Prepared, events: readonly LedgerEvent[]): boolean {
  const edit = p.ops[0];
  if (edit?.op === "place") return edit.change.do === "make" && edit.change.as === "venue";
  if (edit?.op !== "item" || edit.change.do !== "make") return false;
  const made = events.find((e) => e.type === "spawn");
  if (made?.type !== "spawn") return false;
  const after = new Working(rt.registry, ctx.head.world, state);
  after.applyAll(events);
  const size = sizeOf(after.ctx, made.entity.id).size;
  if (size === "vehicle" || (size !== "unknown" && size !== "part" && sizeRank(size) > sizeRank("armful"))) return true;
  const cents = priceOf(after.ctx, made.entity.id);
  return cents !== null && cents > claimCap(ctx.head.world);
}

// ---------------------------------------------------------------- wording for the agent's knowledge

/** Marks, as the narrator's scene view marks one, each text that holds an unrevealed secret's words of `state`: kept from the player character, in the user's wording. Only everyone's view marks (`ToolReadView.mark`). */
function marker(rt: Runtime, ctx: Ctx, state: Readonly<WorldState>): (text: string) => string {
  const { world } = ctx.head;
  const secrets = unrevealedSecrets(rt.registry, world, state);
  const kept = [own(state.entities, world.pov)?.name ?? world.pov];
  return (text) => (findLeaks(text, secrets).length > 0 ? ctx.view.mark(text, { known: [], kept }) : text);
}

/** A refusal from the engine, worded for the agent's view: the GM's reason, or everyone's with its secrets marked; with the thing or place a make found there already. */
function refused(rt: Runtime, ctx: Ctx, view: ToolView, rejection: Rejection, key: string): OpRefusal {
  const reason = rejection.gm ?? rejection.reason;
  const out = refusal(rejection.code, view === "gm" ? reason : marker(rt, ctx, ctx.head.state)(reason), key);
  return "exists" in rejection && typeof rejection.exists === "string" ? { ...out, exists: rejection.exists } : out;
}

/**
 * What an operation's events change, in plain words, for `reader`; `after` is the state they leave,
 * which names whom they bring in. A workspace change reads as the GM's line of it, with its path, for
 * the GM alone: for anyone else it is one line naming no file, as the Journal shows it none. The
 * review card (`player`, a player surface) reads it as the player character may.
 */
export function opLines(rt: Runtime, ctx: Ctx, reader: ToolView | "player", type: ChangeType, after: Readonly<WorldState>, events: readonly LedgerEvent[]): string[] {
  const reg = rt.registry;
  const world = ctx.head.world;
  if (type === "workspace") return reader === "gm" ? authorLines(reg, world, after, events, events.length) : [ctx.view.text(WRITE_NOTE.workspaceLine)];
  const clock = clockFixLine(events);
  if (reader === "player") {
    const lines = [...(clock ? [clock] : []), ...playerLines(reg, world, after, world.pov, events, events.length)];
    return lines.length > 0 || events.length === 0 ? lines : [unseenFixLine(reg, world, after, events)];
  }
  const lines = [...(clock ? [clock] : []), ...authorLines(reg, world, after, events, events.length)];
  return reader === "gm" ? lines : lines.map(marker(rt, ctx, after));
}

// ---------------------------------------------------------------- dry run and apply

/** The head and what an operation's checks read; a refusal when the work was cancelled, or the chat plays no world or its revision isn't loaded. */
async function context(rt: Runtime, env: WriterEnv): Promise<Ctx | OpRefusal> {
  const settings = await rt.settings.get(env.userId);
  if (env.signal.aborted) return refusal("cancelled", renderPrompt(WRITE_NOTE.cancelled, settings.prompts.texts, {}));
  const head = await chatHead(rt, env.chatId, env.userId);
  if (!head) return refusal("no_world", renderPrompt(WRITE_NOTE.noWorld, settings.prompts.texts, {}));
  return contextOf(rt, env, head, settings, await rt.settings.learningOf(env.userId), await keptFiles(rt, env.chatId, env.userId), await rt.activeConnectionId(env.userId));
}

/** The writer's context over a head and kept files in hand: a turn's own, as its engine run reads them (`turn-writer.ts`), never through the ledger's queue. */
export function contextOf(rt: Runtime, env: Pick<WriterEnv, "knowledge">, head: ChatHead, settings: UserSettings, learning: ExtractionLearning, kept: Readonly<Record<string, KeptFile>>, active: string): Ctx {
  const view = readView({ knowledge: env.knowledge, registry: rt.registry, world: head.world, state: head.state, texts: settings.prompts.texts, wording: markWording(settings.prompts.texts), threshold: settings.minds.knowledge.threshold });
  return { head, view, settings, learning, kept, active };
}

/** A checked operation: what it writes in the head (none for a kept file's change), its type and mode, and the events that word it. */
export interface CheckedOp {
  p: Prepared;
  type: ChangeType;
  mode: "auto" | "confirm";
  events: LedgerEvent[];
  shown: LedgerEvent[];
}

/**
 * Prepares, holds to the view, gates and validates one operation against `state` and the kept files
 * (`kept`): what it writes and its mode, or why not. A turn role's thing or place change is made by
 * it (`made.by`), and one below the GM tier (`env.gm` false) is the story's own: it merges no thing
 * the world document defines and removes none, and a Built-in thing it moves waits for the game
 * master's Apply, whatever the mode. A new thing that is big or costly, or a new venue, asks first
 * unless its type is pinned (ITEMS-SPEC §5.3–5.4).
 */
export function checkOp(rt: Runtime, ctx: Ctx, env: WriterEnv, state: Readonly<WorldState>, kept: Readonly<Record<string, KeptFile>>, op: AgentOp): CheckedOp | OpRefusal {
  const p = prepare(rt, ctx, env, state, kept, op);
  if (isRefusal(p)) return p;
  const hidden = unseen(ctx, state, p.ops) ?? (env.knowledge !== "gm" ? unseenValues(rt, ctx, state, p.ops) : null);
  if (hidden !== null) return refusal("not_found", hidden, p.key);
  const g = gate(rt, ctx, env, state, p);
  if (isRefusal(g)) return g;
  // A kept file's change is its store's, not the engine's: it writes no event.
  if (p.kept) return { p, type: g.type, mode: g.mode, events: [], shown: p.kept.shown };
  // A GM edit's rules; a ✎ fix's operations keep the player's (`fix_set`).
  const gm = env.gm ?? true;
  const by = ROLE_IDS.find((r: RoleId) => r === env.agent.role);
  // A minds edit's words are held to the user's lengths, refused past them, as the GM's own are.
  const opts = { gm, runSeed: ctx.head.run.runSeed, mindLengths: ctx.settings.minds.lengths, ...(by !== undefined ? { by } : {}) };
  let out = resolveEdit(rt.registry, ctx.head.world, state, p.ops, opts);
  const builtin = !gm && "rejection" in out && out.rejection.code === "builtin";
  if (builtin) out = resolveEdit(rt.registry, ctx.head.world, state, p.ops, { ...opts, confirmed: true });
  if ("rejection" in out) return refused(rt, ctx, env.knowledge, out.rejection, p.key);
  if (out.events.length === 0) return refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), p.key);
  const mode = builtin || (!g.pinned && asksFirst(rt, ctx, state, p, out.events)) ? "confirm" : g.mode;
  return { p, type: g.type, mode, events: out.events, shown: out.events };
}

async function dryRun(rt: Runtime, env: WriterEnv, op: AgentOp): Promise<OpPreview | OpRefusal> {
  const ctx = await context(rt, env);
  if (isRefusal(ctx)) return ctx;
  const checked = checkOp(rt, ctx, env, ctx.head.state, ctx.kept, op);
  if (isRefusal(checked)) return checked;
  const after = new Working(rt.registry, ctx.head.world, ctx.head.state);
  after.applyAll(checked.events);
  return { key: checked.p.key, changeType: checked.type, mode: checked.mode, lines: opLines(rt, ctx, env.knowledge, checked.type, after.state, checked.shown) };
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
  // Each operation is checked against the head and the kept files and the ones before it that
  // passed; one that doesn't is left out and the rest still go. Refusals come back in the
  // operations' order.
  const running = new Working(rt.registry, world, ctx.head.state);
  let kept: Record<string, KeptFile> = { ...ctx.kept };
  const verdicts: (Prepared | OpRefusal)[] = [];
  for (const op of ops) {
    const checked = checkOp(rt, ctx, env, running.state, kept, op);
    if (isRefusal(checked)) {
      verdicts.push(checked);
      continue;
    }
    if (checked.p.kept) kept = withKept(kept, checked.p.kept.changes);
    else running.applyAll(checked.events);
    verdicts.push(checked.p);
  }
  const passed = verdicts.filter((v): v is Prepared => !isRefusal(v));
  if (passed.length === 0) return { applied: [], refused: verdicts.filter((v): v is OpRefusal => isRefusal(v)), chipId: null, pending: false };
  const files = passed.filter((p) => p.kept !== undefined);
  const edits = passed.filter((p) => p.kept === undefined);
  /** The kept operations the write refused after all, each as its refusal words it. */
  const refusedAs = new Map<Prepared, OpRefusal>();
  const refuseEdits = (why: (p: Prepared) => OpRefusal): void => {
    for (const p of edits) refusedAs.set(p, why(p));
  };
  let chipId: string | null = null;
  let pending = false;
  // Each new body is stored first, held for this write until its record, the journal or a kept index points at it.
  const holder = `agent:${key}`;
  try {
    for (const p of passed) if (p.body) await rt.blobs.put(env.userId, p.body.text, holder);
    // A kept file's change lands at once, in its store: no turn holds it, and a swipe never changes it.
    if (files.length > 0) await landKept(rt, env.chatId, env.userId, Object.assign({}, ...files.map((p) => p.kept?.changes ?? {})) as Record<string, KeptFile | null>);
    if (edits.length > 0) {
      // The batch is one GM edit, resolved as `resolveFix` will resolve it again: one generator over
      // all of its operations, so a rebased view or a held landing works out the same ids.
      const asked: FixOp[] = edits.flatMap((p) => p.ops);
      const group = resolveEdit(rt.registry, world, ctx.head.state, asked, { gm: true, runSeed: run.runSeed, mindLengths: ctx.settings.minds.lengths });
      if ("rejection" in group) refuseEdits((p) => refused(rt, ctx, env.knowledge, group.rejection, p.key));
      else if (group.events.length === 0) refuseEdits((p) => refusal("no_change", ctx.view.text(WRITE_NOTE.noChange), p.key));
      else {
        const agent: NonNullable<PostEntry["agent"]> = { role: env.agent.role, key, applied: edits.map((p) => p.key), label, ...(env.agent.role !== GM_ROLE ? { knowledge: env.knowledge } : {}), ...(env.client !== undefined ? { client: env.client } : {}) };
        const result = await rt.ledger.write(env.chatId, env.userId, { kind: "post", id: `a${Date.now().toString(36)}${(++writes).toString(36)}`, target: "head", entry: { kind: "fix", gm: true, events: group.events, edit: { ops: asked }, agent } });
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
  const applied = passed.filter((p) => !refusedAs.has(p)).map((p) => p.key);
  // The chat's state moves only with a GM edit written (its Undo chip); a kept file's change touches none of it.
  if (edits.some((p) => !refusedAs.has(p))) rt.push.changed(env.chatId, env.userId);
  const refusals = verdicts.flatMap((v): OpRefusal[] => {
    if (isRefusal(v)) return [v];
    const after = refusedAs.get(v);
    return after ? [after] : [];
  });
  return { applied, refused: refusals, chipId, pending };
}

/** The kept files with `changes` made: a file at each path, none where it is null. */
export function withKept(kept: Readonly<Record<string, KeptFile>>, changes: Readonly<Record<string, KeptFile | null>>): Record<string, KeptFile> {
  const out = { ...kept };
  for (const [path, file] of Object.entries(changes)) {
    if (file === null) delete out[path];
    else out[path] = file;
  }
  return out;
}

/**
 * Makes kept files' changes in their stores: those under `learned/` in the chat's metadata, those
 * under `~/` in the user's global workspace. Each body is a blob the caller stored and holds until
 * this lands.
 */
export async function landKept(rt: Pick<Runtime, "chatAgents" | "globalFiles">, chatId: ChatId, userId: UserId, changes: Readonly<Record<string, KeptFile | null>>): Promise<void> {
  const learned = Object.fromEntries(Object.entries(changes).filter(([path]) => isLearnedPath(path)));
  const global = Object.fromEntries(Object.entries(changes).filter(([path]) => isGlobalPath(path)));
  await Promise.all([Object.keys(learned).length > 0 ? rt.chatAgents.setLearned(chatId, userId, learned) : null, Object.keys(global).length > 0 ? rt.globalFiles.set(userId, global) : null]);
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
