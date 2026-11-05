// A turn's own tool access (INC2-SPEC C10): `turnReader`, what its roles read, and `turnWriter`, where
// they write: the turn's draft (`TurnDraft`), never the ledger. Everything here runs inside the
// chat's queued ledger operation that runs the turn, so nothing here goes through that queue: a write
// through it would wait behind its own turn for ever, and make that turn stale (classic-turn-map §10).
//
// The write path inside a turn (AGENT-LOOP-PLAN §6), for every operation:
// 1. The role's tier must take it (Settings → Agents → Roles): the GM's edits need the GM tier, a
//    workspace change (the pins manifest's among them) the story's, and a role that only reads
//    changes nothing.
// 2. The GM's edits a turn's agents stage together stop at the turn's cap (GM edits per turn).
// 3. It is checked exactly as the outside writer checks it (`checkOp`): read for its shape, under the
//    marked view every turn agent reads (`everyone`), its change type's mode looked up for the role on its connection, the
//    spawn cap, and validated by the engine, against the head (before the plan) or the planned head
//    (after it), with what this agent staged before it in the same phase on top: each agent writes
//    into its own draft, so two agents that spend the same cash both stage, and the commit refuses
//    the second.
// 4. It is staged, or refused with its code and reason, which the draft keeps for the run's answer
//    (`TurnDraft.writesOf`, `agents/yields.ts`). A role's write tool stages at once (`stage`, through
//    `propose`), and its answer says where the change stands: landing when the turn commits, or, its
//    mode Confirm, waiting for the GM's Apply on the review card. A workspace file's body is stored as
//    a blob when it is staged, held for the turn until the turn's run ends. A change to a kept file
//    (a path under `learned/`, the learned area, or `~/`, the global workspace) is staged the same
//    way, and made in its store when the turn closes (`landKept`): no record holds it, and a
//    cancelled turn makes none.
//
// The turn's roles read its workspace as the turn holds it (`stagedWorkspace`): what they and the runs
// before them staged is listed and read before it is committed.
//
// The orchestrator commits a phase's draft in the turn's fixed order (`commitOrder`: by role in §5's
// order, then by staging order), each operation re-validated in order (`commitStaged`): one under
// Confirm goes to the turn's review card instead, and so does one that names a thing or a place such
// a one makes, after it; one that no longer holds is refused. An operation's key is the hash of the
// operation, so staging it again is the same operation and stages nothing more.

import { ROLE_IDS, type RoleId, type RoleTier } from "../../shared/agent-roles";
import type { ToolView } from "../../shared/agent-tools";
import { WRITE_NOTE } from "../../shared/agent-tools-write";
import type { ChatId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import type { LiveDropWhy } from "../../shared/live";
import { effectiveMemory } from "../../shared/minds";
import type { ChangeType, ExtractionLearning, UserSettings } from "../../shared/settings";
import { PLACE_EVENT } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { placeCapsOf } from "../../shared/world";
import { Working } from "../../engine/working";
import { loreBookIds } from "../book-lore";
import { latestTexts } from "../gm";
import { markWording, renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { KeptFile } from "../../shared/stores";
import { readView, type ToolReader, viewRouting } from "./tools/read-view";
import { type ChatHead, listWorkspace, type WorkspaceAt } from "./tools/workspace";
import { type AgentOp, checkOp, contextOf, isOpRefusal, opKey, opLines, type OpPreview, type OpRefusal, type ToolWriter, withKept, type WriterCtx, type WriterEnv } from "./tools/writer";

/** Where in its turn an operation was staged: before the plan, between the plan and the reply, or after the reply. */
export type StagePhase = "pre" | "plan" | "post";

/** One operation a role staged into its turn. */
export interface StagedOp {
  /** The turn's staging order. */
  seq: number;
  phase: StagePhase;
  role: RoleId;
  agentId: string;
  key: string;
  op: AgentOp;
  changeType: ChangeType;
  /** Its change type's mode when it was staged; the commit asks again. */
  mode: "auto" | "confirm";
  /** What it needs of its role's tier. */
  tier: "story" | "gm";
  /**
   * Staged with the GM's say: its role was at the GM tier, or the game master let it through at the
   * turn's review gate. A change to a thing or a place staged without it is the story's own
   * (`WriterEnv.gm`), and is checked so again when the turn commits.
   */
  gm: boolean;
  /** The connection its role runs on, which its change type's learned mode is keyed by. */
  connectionId: string | null;
  /** The change in plain words, as the role's knowledge has it. */
  lines: string[];
  /** Its events as staged, on its agent's own draft. */
  events: LedgerEvent[];
  /** A kept file's change instead, as staged: each path's file after it, null where it is taken out. */
  kept?: Record<string, KeptFile | null>;
  /** Let through at its turn's review gate: it commits without asking again. */
  approved?: true;
  /** The change as the player character may read it, for the review card (a player surface): set when a commit sets it aside. */
  cardLines?: string[];
}

/** Hears what a turn's roles stage, what is refused as they stage it, and what is dropped uncommitted, with why (GM → Live). */
export interface DraftWatch {
  staged(op: StagedOp): void;
  refused(at: { role: RoleId; agentId: string; phase: StagePhase; key?: string; code: string; reason: string }): void;
  dropped(ops: readonly StagedOp[], why: LiveDropWhy): void;
}

/**
 * A turn's draft: every operation its roles staged, in staging order, and how many of the GM's edits
 * among them and among those its earlier phases landed; and the writes each agent asked for that were
 * refused as they were staged, which its run's answer reports (`writesOf`).
 */
export class TurnDraft {
  private seq = 0;
  private readonly ops: StagedOp[] = [];
  /** The GM's edits the turn's earlier phases landed, or put to its review card. */
  private gmLanded = 0;
  /** Hears what is staged, refused and dropped: the turn's live view. */
  watch: DraftWatch | null = null;
  /** By agent: the writes it asked for that were refused as they were staged. */
  private readonly refusals = new Map<string, OpRefusal[]>();

  constructor(readonly generationId: string) {}

  /** What one agent staged in one phase, in staging order: its own draft. */
  own(agentId: string, phase: StagePhase): StagedOp[] {
    return this.ops.filter((o) => o.agentId === agentId && o.phase === phase);
  }

  /** Everything staged and not yet committed, every agent and phase, in staging order: what the turn's workspace reads with (`stagedWorkspace`). */
  pending(): readonly StagedOp[] {
    return this.ops;
  }

  /** What one agent staged that the turn hasn't committed, and the writes it asked for that were refused as they were staged. */
  writesOf(agentId: string): { staged: StagedOp[]; refused: OpRefusal[] } {
    return { staged: this.ops.filter((o) => o.agentId === agentId), refused: [...(this.refusals.get(agentId) ?? [])] };
  }

  /** The GM's edits of this turn so far, every phase and agent together: those its earlier phases landed (`landed`), and those staged since. **GM edits per turn** caps it. */
  gmStaged(): number {
    return this.gmLanded + this.ops.filter((o) => o.tier === "gm").length;
  }

  /** A phase's commit landed `count` of the GM's edits, or put them to the turn's review card: the turn's later phases count them. */
  landed(count: number): void {
    this.gmLanded += count;
  }

  stage(op: Omit<StagedOp, "seq">): StagedOp {
    const staged = { ...op, seq: ++this.seq };
    this.ops.push(staged);
    this.watch?.staged(staged);
    return staged;
  }

  /** A write the agent `at` asked for, refused as it was staged in its phase: kept for its run's answer, and heard by the turn's live view. */
  refuse(at: { role: RoleId; agentId: string; phase: StagePhase }, refusal: OpRefusal): void {
    this.refusals.set(at.agentId, [...(this.refusals.get(at.agentId) ?? []), refusal]);
    this.watch?.refused({ role: at.role, agentId: at.agentId, phase: at.phase, ...(refusal.key !== undefined ? { key: refusal.key } : {}), code: refusal.code, reason: refusal.reason });
  }

  /** A phase's operations, taken out of the draft, in the commit's order (`commitOrder`). */
  take(phase: StagePhase): StagedOp[] {
    const taken = commitOrder(this.ops.filter((o) => o.phase === phase));
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i]?.phase === phase) this.ops.splice(i, 1);
    return taken;
  }

  /** Everything staged and not yet committed: what the turn drops when it is cancelled or fails. */
  clear(): void {
    const dropped = this.ops.splice(0);
    this.refusals.clear();
    if (dropped.length > 0) this.watch?.dropped(dropped, "ended");
  }

  /** What one agent staged and the turn hasn't committed, and what it was refused: a run that failed, or one the main agent's revision replaced (C14), whose answer no longer stands. */
  drop(agentId: string, why: LiveDropWhy = "failed"): void {
    const dropped: StagedOp[] = [];
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i]?.agentId === agentId) dropped.unshift(...this.ops.splice(i, 1));
    this.refusals.delete(agentId);
    if (dropped.length > 0) this.watch?.dropped(dropped, why);
  }

  get size(): number {
    return this.ops.length;
  }
}

/** The turn's commit order (INC2-SPEC C10): by role in AGENT-LOOP-PLAN §5's order, then by staging order. */
export function commitOrder(ops: readonly StagedOp[]): StagedOp[] {
  const rank = (role: RoleId): number => ROLE_IDS.indexOf(role);
  return [...ops].sort((a, b) => rank(a.role) - rank(b.role) || a.seq - b.seq);
}

/**
 * A change to a thing or a place made in play (ITEMS-SPEC §7.3), and what it needs: the story's say
 * for every one but taking a thing or a place out of the world, which is the GM's; null for any
 * other operation.
 */
export function fabricOf(op: AgentOp): "story" | "gm" | null {
  if (op.kind !== "gm_edit" || !isRecord(op.op) || (op.op.op !== "item" && op.op.op !== "place")) return null;
  return op.op.change.do === "remove" ? "gm" : "story";
}

/**
 * What an operation needs of its role's tier: a workspace change (any file, the pins manifest among
 * them) the story's, and so the Curator's change to a thing or a place (ITEMS-SPEC §7.2), but for
 * taking one out of the world; every other change, any other role's change to a thing or a place
 * among them, the GM's.
 */
export function opTier(op: AgentOp, role: RoleId): "story" | "gm" {
  if (op.kind.startsWith("ws_")) return "story";
  return role === "curator" && fabricOf(op) === "story" ? "story" : "gm";
}

/** Whether an operation makes a thing (`item`) or a place (`place`). */
function makes(op: AgentOp, what: "item" | "place"): boolean {
  return op.kind === "gm_edit" && isRecord(op.op) && op.op.op === what && op.op.change.do === "make";
}

// ---------------------------------------------------------------- reading

/** The head a turn's agents read and write against: the head before the plan, the planned head after it; null while the chat's world isn't loaded. */
export type TurnBase = () => ChatHead | null;

/**
 * The workspace as a turn holds it while it runs (`WorkspaceAt`): `head`'s files and the kept files
 * (`kept`), with what the turn's agents staged and the turn hasn't committed on top, in the
 * commit's order (`commitOrder`), each on what the ones before it left, and who staged each file. A
 * change that waits for the review card (Confirm), or no longer applies, changes nothing here, as it
 * changes nothing when the turn commits. So each run reads the files it and the runs before it staged.
 */
export function stagedWorkspace(rt: Runtime, draft: TurnDraft, head: ChatHead, kept: Readonly<Record<string, KeptFile>>): WorkspaceAt {
  const ops = commitOrder(draft.pending()).filter((o) => o.mode === "auto" && o.op.kind.startsWith("ws_"));
  if (ops.length === 0) return { head, kept, staged: new Map() };
  const w = new Working(rt.registry, head.world, head.state);
  let area = kept;
  const staged = new Map<string, { role: string; key: string }>();
  for (const o of ops) {
    const by = { role: o.role, key: o.key };
    if (o.kept) {
      area = withKept(area, o.kept);
      for (const path of Object.keys(o.kept)) staged.set(path, by);
      continue;
    }
    const mark = w.mark();
    if (w.applyAll(o.events).length < o.events.length) {
      w.restore(mark);
      continue;
    }
    for (const e of o.events) if ("data" in e && isRecord(e.data) && typeof e.data.path === "string") staged.set(e.data.path, by);
  }
  // The world played for the staged state (`Working.world`), so a place made in play is in it too.
  return { head: { ...head, state: w.state, world: w.world }, kept: area, staged };
}

/**
 * A turn's reader (C10): the turn's base as `view` reads it (`gm` with `marks` for every role and
 * the main agent, whatever perspective it works from: nothing left out, every secret marked; plain
 * `gm` for the turn's own commit), built afresh on each read from the turn's own core and chain,
 * never through the ledger's queue, with what its agent staged before in its phase on top (`own`),
 * as its writes are checked, so it finds what it made earlier in the turn; its
 * workspace, with `staged`, as the turn holds it (`stagedWorkspace`), else the chat's as it stands.
 */
export function turnReader(rt: Runtime, base: TurnBase, env: { userId: UserId; chatId: ChatId; knowledge: ToolView; marks?: boolean; staged?: (head: ChatHead) => WorkspaceAt; own?: () => readonly StagedOp[] }): ToolReader {
  return {
    registry: rt.registry,
    async view() {
      const knowledge = env.knowledge;
      const at = base();
      if (!at) throw new Error("this chat's world isn't loaded");
      const head = withOwn(rt, at, env.own?.() ?? []);
      const settings = await rt.settings.get(env.userId);
      const files = { userId: env.userId, chatId: env.chatId, knowledge };
      return readView({
        knowledge,
        marks: env.marks,
        registry: rt.registry,
        world: head.world,
        state: head.state,
        texts: settings.prompts.texts,
        wording: markWording(settings.prompts.texts),
        threshold: settings.minds.knowledge.threshold,
        minds: { enabled: settings.minds.enabled, memory: effectiveMemory(head.world, settings.minds), latest: latestTexts(head.observed) },
        lore: (world) => rt.readLore(env.chatId, env.userId, world),
        blob: (hash) => rt.blobs.get(env.userId, hash),
        books: async (world) => {
          const { read } = await loreBookIds(rt.host, world, env.chatId, env.userId, (await rt.settings.get(env.userId)).loreBooks);
          return (await Promise.all(read.map((book) => rt.host.books.entries(book, env.userId)))).flat();
        },
        // The workspace's own staged files are on the base, as `stagedWorkspace` lays them.
        workspace: () => listWorkspace(rt, files, env.staged?.(at)),
        routing: viewRouting(rt, env.userId, settings.loreIndex),
      });
    },
  };
}

/** A head with one agent's own staged events on top, each on what the ones before it left, and the world they play (a place it made is in it); the head itself when it staged nothing. */
function withOwn(rt: Runtime, head: ChatHead, own: readonly StagedOp[]): ChatHead {
  if (own.length === 0) return head;
  const w = new Working(rt.registry, head.world, head.state);
  for (const o of own) w.applyAll(o.events);
  return { ...head, state: w.state, world: w.world };
}

// ---------------------------------------------------------------- writing

/** Who writes into a turn, and against what. */
export interface TurnWriterEnv {
  userId: UserId;
  chatId: ChatId;
  role: RoleId;
  agentId: string;
  tier: RoleTier;
  connectionId: string | null;
  phase: StagePhase;
  base: TurnBase;
  /** The kept files as the turn stands: the chat's learned area and the global workspace, with what the turn committed to them so far. */
  kept: () => Readonly<Record<string, KeptFile>>;
  reader: ToolReader;
  /** The turn's GM edits cap (Settings → Agents → Budgets, GM edits per turn). */
  gmOps: number;
  /** Holds the workspace bodies it stages until the turn's run lets them go. */
  holder: string;
  signal: AbortSignal;
}

/**
 * C10's writer: `dryRun` checks an operation as it would be staged; `apply` stages those that pass
 * into the turn's draft, one by one, each on what the ones before it left, and `stage` one, as a write
 * tool asks (`propose`), saying what it staged. None writes the ledger: they land when the
 * orchestrator commits the phase. What it refuses to stage, the draft keeps for the run's answer.
 */
export function turnWriter(rt: Runtime, draft: TurnDraft, env: TurnWriterEnv): ToolWriter {
  const context = async (): Promise<{ ctx: WriterCtx; settings: UserSettings; learning: ExtractionLearning } | OpRefusal> => {
    const settings = await rt.settings.get(env.userId);
    const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
    if (env.signal.aborted) return { refused: true, code: "cancelled", reason: note(WRITE_NOTE.cancelled) };
    if (env.tier === "read") return { refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter) };
    const head = env.base();
    if (!head) return { refused: true, code: "no_world", reason: note(WRITE_NOTE.noWorld) };
    const learning = await rt.settings.learningOf(env.userId);
    return { ctx: contextOf(rt, { knowledge: "everyone" }, head, settings, learning, env.kept(), await rt.activeConnectionId(env.userId)), settings, learning };
  };
  /**
   * One operation checked for this agent on `state`: its role's tier (the GM tier takes every change,
   * the story's all but the GM's edits), the turn's GM edits cap; for a change to a thing or a place,
   * the Curator's ops per turn, and the things and the places one turn may make; then the outside
   * writer's checks, on the kept files with what it staged there before in this phase, as the story's
   * own change unless its role is at the GM tier.
   */
  const check = (c: { ctx: WriterCtx; settings: UserSettings }, state: Readonly<WorldState>, op: AgentOp) => {
    const needs = opTier(op, env.role);
    const key = keyOf(op);
    if (!(env.tier === "gm" || (env.tier === "story" && needs === "story"))) return refusalOf("not_granted", c.ctx.view.text(WRITE_NOTE.notGranted, { tier: env.tier, needs }), key);
    if (needs === "gm" && draft.gmStaged() >= env.gmOps) return refusalOf("gm_cap", c.ctx.view.text(WRITE_NOTE.gmCap, { count: String(draft.gmStaged()) }), key);
    if (fabricOf(op) !== null) {
      const staged = draft.pending();
      const curated = staged.filter((o) => o.role === "curator" && fabricOf(o.op) !== null).length;
      if (env.role === "curator" && curated >= c.settings.agents.curatorOps) return refusalOf("curator_cap", c.ctx.view.text(WRITE_NOTE.curatorCap, { count: String(curated) }), key);
      const things = staged.filter((o) => makes(o.op, "item")).length;
      if (makes(op, "item") && things >= c.settings.thingReads.madeMax) return refusalOf("made_cap", c.ctx.view.text(WRITE_NOTE.madeCap, { count: String(things) }), key);
      const places = staged.filter((o) => makes(o.op, "place")).length;
      if (makes(op, "place") && places >= placeCapsOf(c.ctx.head.world).turn) return refusalOf("place_cap", c.ctx.view.text(WRITE_NOTE.placeCap, { count: String(places) }), key);
    }
    const writer: WriterEnv = { userId: env.userId, chatId: env.chatId, knowledge: "everyone", reader: env.reader, agent: { role: env.role, id: env.agentId }, signal: env.signal, connectionId: env.connectionId, gm: env.tier === "gm" };
    const kept = draft.own(env.agentId, env.phase).reduce((files, o) => (o.kept ? withKept(files, o.kept) : files), c.ctx.kept);
    return checkOp(rt, c.ctx, writer, state, kept, op);
  };
  /** Why nothing can be staged now (`context`), for one operation, kept for the run's answer. */
  const unstaged = (c: OpRefusal, op: AgentOp): OpRefusal => {
    const key = keyOf(op);
    const refusal = { ...c, ...(key !== undefined ? { key } : {}) };
    draft.refuse(env, refusal);
    return refusal;
  };
  /** One operation staged for this agent on what it staged before it: what it staged (the same operation again is the one it staged, and stages nothing more), or why not, kept for the run's answer. */
  const stageOne = async (c: { ctx: WriterCtx; settings: UserSettings }, op: AgentOp): Promise<OpPreview | OpRefusal> => {
    const key = keyOf(op);
    const again = key === undefined ? undefined : draft.own(env.agentId, env.phase).find((o) => o.key === key);
    if (again) return { key: again.key, changeType: again.changeType, mode: again.mode, lines: again.lines };
    // Checked on the base with what this agent staged before in this phase on top.
    const state = withOwn(rt, c.ctx.head, draft.own(env.agentId, env.phase)).state;
    const checked = check(c, state, op);
    if (isOpRefusal(checked)) {
      draft.refuse(env, checked);
      return checked;
    }
    // A file's body is stored as it is staged, held for the turn until its run lets it go.
    if (checked.p.body) await rt.blobs.put(env.userId, checked.p.body.text, env.holder);
    const after = new Working(rt.registry, c.ctx.head.world, state);
    after.applyAll(checked.events);
    const lines = opLines(rt, c.ctx, "everyone", checked.type, after.state, checked.shown);
    draft.stage({ phase: env.phase, role: env.role, agentId: env.agentId, key: checked.p.key, op, changeType: checked.type, mode: checked.mode, tier: opTier(op, env.role), gm: env.tier === "gm", connectionId: env.connectionId, lines, events: checked.events, ...(checked.p.kept ? { kept: checked.p.kept.changes } : {}) });
    return { key: checked.p.key, changeType: checked.type, mode: checked.mode, lines };
  };
  return {
    async dryRun(op) {
      const c = await context();
      if (isOpRefusal(c)) return c;
      const state = withOwn(rt, c.ctx.head, draft.own(env.agentId, env.phase)).state;
      const checked = check(c, state, op);
      if (isOpRefusal(checked)) return checked;
      const after = new Working(rt.registry, c.ctx.head.world, state);
      after.applyAll(checked.events);
      return { key: checked.p.key, changeType: checked.type, mode: checked.mode, lines: opLines(rt, c.ctx, "everyone", checked.type, after.state, checked.shown) };
    },
    async apply(ops) {
      const c = await context();
      if (isOpRefusal(c)) return { applied: [], refused: ops.map((op) => unstaged(c, op)), chipId: null, pending: false };
      const applied: string[] = [];
      const refused: OpRefusal[] = [];
      for (const op of ops) {
        const out = await stageOne(c, op);
        if (isOpRefusal(out)) refused.push(out);
        else applied.push(out.key);
      }
      // Staged, not written: it lands when the turn commits (`pending`), with no chip of its own.
      return { applied, refused, chipId: null, pending: applied.length > 0 };
    },
    async stage(op) {
      const c = await context();
      return isOpRefusal(c) ? unstaged(c, op) : stageOne(c, op);
    },
  };
}

function refusalOf(code: string, reason: string, key?: string): OpRefusal {
  return { refused: true, code, reason, ...(key !== undefined ? { key } : {}) };
}

function keyOf(op: AgentOp): string | undefined {
  try {
    return opKey(op);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- committing

/** What a commit made of a phase's operations, in the commit's order. */
export interface CommitOutcome {
  /** Each applied, with the events it added (none for a kept file's change). */
  committed: { op: StagedOp; events: LedgerEvent[] }[];
  /** Each under Confirm, for the turn's review card. */
  confirm: StagedOp[];
  /** Each that no longer holds, with why. */
  refused: { op: StagedOp; refusal: OpRefusal }[];
  /** The kept files' changes it committed, each path's file after them, null where taken out: made when the turn closes. */
  kept: Record<string, KeptFile | null>;
}

/** What a turn's commit checks its operations with: the roles' writer context, against the turn's base and kept files. */
export interface CommitCtx {
  ctx(): WriterCtx;
  reader: ToolReader;
  userId: UserId;
  chatId: ChatId;
  signal: AbortSignal;
}

/** Whether `value` names one of `ids` anywhere in it, as a whole string. */
function namesAny(value: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) return value.some((v) => namesAny(v, ids));
  return isRecord(value) && Object.values(value).some((v) => namesAny(v, ids));
}

/**
 * Commits `ops` (in `commitOrder`) onto `w` (INC2-SPEC C10): each re-validated in order on what the
 * ones before it left, through the outside writer's checks for its role; one under Confirm is set
 * aside for the review card, one that no longer holds is refused, and the rest apply, each whole
 * (its events one unit, so a rebased view keeps or drops it whole) or not at all. An operation that
 * names a thing or a place one set aside makes can't hold on `w`, where that make never landed: it
 * is checked on the set-aside operations' events instead and, if it holds there, set aside after its
 * make, so the card's Apply lands both, in order (a make's id is its edit's own, the same then as
 * now). Synchronous: the plan and the read call it inside the core's own steps.
 */
export function commitStaged(rt: Runtime, commit: CommitCtx, ops: readonly StagedOp[], w: Working): CommitOutcome {
  const out: CommitOutcome = { committed: [], confirm: [], refused: [], kept: {} };
  // What the operations set aside make, and their events, in order.
  const made = new Set<string>();
  const aside: LedgerEvent[] = [];
  for (const op of ops) {
    const env: WriterEnv = { userId: commit.userId, chatId: commit.chatId, knowledge: "everyone", reader: commit.reader, agent: { role: op.role, id: op.agentId }, signal: commit.signal, connectionId: op.connectionId, gm: op.gm };
    const ctx = commit.ctx();
    let on: Working = w;
    if (made.size > 0 && !op.op.kind.startsWith("ws_") && namesAny(op.op, made)) {
      on = new Working(rt.registry, ctx.head.world, w.state);
      on.applyAll(aside);
    }
    const checked = checkOp(rt, ctx, env, on.state, withKept(ctx.kept, out.kept), op.op);
    if (isOpRefusal(checked)) {
      out.refused.push({ op, refusal: checked });
      continue;
    }
    if (on !== w || (checked.mode === "confirm" && op.approved !== true)) {
      // The card is the player's: its lines are the player character's.
      const after = new Working(rt.registry, ctx.head.world, on.state);
      after.applyAll(checked.events);
      out.confirm.push({ ...op, mode: "confirm", events: checked.events, cardLines: opLines(rt, ctx, "player", checked.type, after.state, checked.shown) });
      // The things and places it makes: a spawned entity's id, a place made in play's.
      for (const e of checked.events) {
        if (e.type === "spawn") made.add(e.entity.id);
        else if (e.type === PLACE_EVENT && "data" in e && isRecord(e.data) && typeof e.data.place === "string") made.add(e.data.place);
      }
      aside.push(...checked.events);
      continue;
    }
    // A kept file's change writes no event: it is made in its store when the turn closes.
    if (checked.p.kept) {
      Object.assign(out.kept, checked.p.kept.changes);
      out.committed.push({ op, events: [] });
      continue;
    }
    const mark = w.mark();
    const from = w.events.length;
    const kept = w.applyAll(checked.events);
    if (kept.length < checked.events.length) {
      w.restore(mark);
      out.refused.push({ op, refusal: refusalOf("write_refused", ctx.view.text(WRITE_NOTE.stale), op.key) });
      continue;
    }
    if (!checked.events.some((e) => e.group !== undefined)) w.unite(from, `agent:${op.key}`);
    out.committed.push({ op, events: w.events.slice(from) });
  }
  return out;
}
