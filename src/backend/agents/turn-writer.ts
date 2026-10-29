// A turn's own tool access (INC2-SPEC C10): `turnReader`, what its roles read, and `turnWriter`, where
// they write: the turn's draft (`TurnDraft`), never the ledger. Everything here runs inside the
// chat's queued ledger operation that runs the turn, so nothing here goes through that queue: a write
// through it would wait behind its own turn for ever, and make that turn stale (classic-turn-map §10).
//
// The write path inside a turn (AGENT-LOOP-PLAN §6), for every operation:
// 1. The role's tier must take it (Settings → Agents → Roles): the GM's edits need the GM tier, a
//    workspace change the story's, and a role that only reads changes nothing.
// 2. The GM's edits a turn's agents stage together stop at the turn's cap (GM edits per turn).
// 3. It is checked exactly as the outside writer checks it (`checkOp`): read for its shape, held to
//    the role's knowledge, its change type's mode looked up for the role on its connection, the
//    spawn cap, and validated by the engine, against the head (before the plan) or the planned head
//    (after it), with what this agent staged before it in the same phase on top: each agent writes
//    into its own draft, so two agents that spend the same cash both stage, and the commit refuses
//    the second.
// 4. It is staged, or refused with its code and reason. A workspace file's body is stored as a blob
//    when it is staged, held for the turn until the turn's run ends. A change to the learned area
//    (a path under `learned/`) is staged the same way, and made in the chat's metadata when the turn
//    closes (`ChatAgentMeta.setLearned`): no record holds it, and a cancelled turn makes none.
//
// The orchestrator commits a phase's draft in the turn's fixed order (`commitOrder`: by role in §5's
// order, then by staging order), each operation re-validated in order (`commitStaged`): one under
// Confirm goes to the turn's review card instead, one that no longer holds is refused. An operation's
// key is the hash of the operation, so staging it again is the same operation and stages nothing more.

import { ROLE_IDS, type RoleId, type RoleTier } from "../../shared/agent-roles";
import type { AgentKnowledge } from "../../shared/agent-tools";
import { WRITE_NOTE } from "../../shared/agent-tools-write";
import type { ChatId, UserId } from "../../shared/ids";
import type { LedgerEvent } from "../../shared/ledger";
import { effectiveMemory } from "../../shared/minds";
import type { AgentChangeType, ExtractionLearning, UserSettings } from "../../shared/settings";
import type { WorldState } from "../../engine/state";
import { Working } from "../../engine/working";
import { loreBookIds } from "../book-lore";
import { latestTexts } from "../gm";
import { markWording, renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { LearnedFile } from "../chat-agent-meta";
import { readView, type ToolReader } from "./tools/read-view";
import { type ChatHead, listWorkspace } from "./tools/workspace";
import { PINS_PATH } from "./turn-task";
import { type AgentOp, checkOp, contextOf, isOpRefusal, opKey, opLines, type OpRefusal, type ToolWriter, withLearned, type WriterCtx, type WriterEnv } from "./tools/writer";

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
  changeType: AgentChangeType;
  /** Its change type's mode when it was staged; the commit asks again. */
  mode: "auto" | "confirm";
  /** What it needs of its role's tier. */
  tier: "story" | "gm";
  knowledge: AgentKnowledge;
  /** The connection its role runs on, which its change type's learned mode is keyed by. */
  connectionId: string | null;
  /** The change in plain words, as the role's knowledge has it. */
  lines: string[];
  /** Its events as staged, on its agent's own draft. */
  events: LedgerEvent[];
  /** A learned-area change instead, as staged: each path's file after it, null where it is taken out. */
  learned?: Record<string, LearnedFile | null>;
  /** Let through at its turn's review gate: it commits without asking again. */
  approved?: true;
  /** The change as the player character may read it, for the review card (a player surface): set when a commit sets it aside. */
  cardLines?: string[];
}

/** A turn's draft: every operation its roles staged, in staging order, and how many of the GM's edits among them and among those its earlier phases landed. */
export class TurnDraft {
  private seq = 0;
  private readonly ops: StagedOp[] = [];
  /** The GM's edits the turn's earlier phases landed, or put to its review card. */
  private gmLanded = 0;

  constructor(readonly generationId: string) {}

  /** What one agent staged in one phase, in staging order: its own draft. */
  own(agentId: string, phase: StagePhase): StagedOp[] {
    return this.ops.filter((o) => o.agentId === agentId && o.phase === phase);
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
    return staged;
  }

  /** A phase's operations, taken out of the draft, in the commit's order (`commitOrder`). */
  take(phase: StagePhase): StagedOp[] {
    const taken = commitOrder(this.ops.filter((o) => o.phase === phase));
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i]?.phase === phase) this.ops.splice(i, 1);
    return taken;
  }

  /** Everything staged and not yet committed: what the turn drops when it is cancelled or fails. */
  clear(): void {
    this.ops.length = 0;
  }

  /** What one agent staged and the turn hasn't committed: a run the main agent's revision replaced (C14), whose answer no longer stands. */
  drop(agentId: string): void {
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i]?.agentId === agentId) this.ops.splice(i, 1);
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
 * What an operation needs of its role's tier: the GM's edits the GM tier, a workspace change the
 * story's, but the pins manifest's (`.pins.json`, which sets what each agent is shown first and how
 * much of it): writing, moving, pinning or taking it out is the GM tier's, as the GM's own file.
 */
export function opTier(op: AgentOp): "story" | "gm" {
  if (op.kind === "ws_write" || op.kind === "ws_delete" || op.kind === "ws_pin") return op.path === PINS_PATH ? "gm" : "story";
  if (op.kind === "ws_move") return op.from === PINS_PATH || op.to === PINS_PATH ? "gm" : "story";
  return "gm";
}

// ---------------------------------------------------------------- reading

/** The head a turn's agents read and write against: the head before the plan, the planned head after it; null while the chat's world isn't loaded. */
export type TurnBase = () => ChatHead | null;

/**
 * A turn's reader (C10): the turn's base as `knowledge` reads it, built afresh on each read from the
 * turn's own core and chain, never through the ledger's queue. A role reading with its own
 * character's knowledge (`own`) has no reader here: the tool layer reads as the player character,
 * everyone or the GM, none of which is one character's own, so each such read is refused.
 */
export function turnReader(rt: Runtime, base: TurnBase, env: { userId: UserId; chatId: ChatId; knowledge: AgentKnowledge | null }): ToolReader {
  return {
    registry: rt.registry,
    async view() {
      const knowledge = env.knowledge;
      if (knowledge === null) throw new Error("this role reads with its own character's knowledge, which its own context gives it; the tools read as the player character, everyone or the GM");
      const head = base();
      if (!head) throw new Error("this chat's world isn't loaded");
      const settings = await rt.settings.get(env.userId);
      return readView({
        knowledge,
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
          const { read } = await loreBookIds(rt.host, world, env.chatId, env.userId);
          return (await Promise.all(read.map((book) => rt.host.books.entries(book, env.userId)))).flat();
        },
        workspace: () => listWorkspace(rt, { userId: env.userId, chatId: env.chatId, knowledge }),
      });
    },
  };
}

// ---------------------------------------------------------------- writing

/** Who writes into a turn, and against what. */
export interface TurnWriterEnv {
  userId: UserId;
  chatId: ChatId;
  role: RoleId;
  agentId: string;
  tier: RoleTier;
  /** The role's knowledge; null for one that reads with its own character's (`own`), which writes nothing here. */
  knowledge: AgentKnowledge | null;
  connectionId: string | null;
  phase: StagePhase;
  base: TurnBase;
  /** The learned area as the turn stands: the chat's, with what the turn committed to it so far. */
  learned: () => Readonly<Record<string, LearnedFile>>;
  reader: ToolReader;
  /** The turn's GM edits cap (Settings → Agents → Budgets, GM edits per turn). */
  gmOps: number;
  /** Holds the workspace bodies it stages until the turn's run lets them go. */
  holder: string;
  signal: AbortSignal;
}

/** The state an agent's next operation is checked on: the base, with what it staged before in this phase on top. */
function ownState(rt: Runtime, draft: TurnDraft, env: TurnWriterEnv, head: ChatHead): Readonly<WorldState> {
  const own = draft.own(env.agentId, env.phase);
  if (own.length === 0) return head.state;
  const w = new Working(rt.registry, head.world, head.state);
  for (const o of own) w.applyAll(o.events);
  return w.state;
}

/**
 * C10's writer: `dryRun` checks an operation as it would be staged; `apply` stages those that pass
 * into the turn's draft, one by one, each on what the ones before it left, and never writes the
 * ledger: they land when the orchestrator commits the phase.
 */
export function turnWriter(rt: Runtime, draft: TurnDraft, env: TurnWriterEnv): ToolWriter {
  const context = async (): Promise<{ ctx: WriterCtx; settings: UserSettings; learning: ExtractionLearning } | OpRefusal> => {
    const settings = await rt.settings.get(env.userId);
    const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
    if (env.signal.aborted) return { refused: true, code: "cancelled", reason: note(WRITE_NOTE.cancelled) };
    if (env.knowledge === null || env.tier === "read") return { refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter) };
    const head = env.base();
    if (!head) return { refused: true, code: "no_world", reason: note(WRITE_NOTE.noWorld) };
    const learning = await rt.settings.learningOf(env.userId);
    return { ctx: contextOf(rt, { knowledge: env.knowledge }, head, settings, learning, env.learned(), await rt.activeConnectionId(env.userId)), settings, learning };
  };
  /** One operation checked for this agent on `state`: its role's tier (the GM tier takes every change, the story's all but the GM's edits), the turn's GM edits cap, then the outside writer's checks, on the learned area with what it staged there before in this phase. */
  const check = (c: { ctx: WriterCtx; settings: UserSettings }, state: Readonly<WorldState>, op: AgentOp, knowledge: AgentKnowledge) => {
    const needs = opTier(op);
    const key = keyOf(op);
    if (!(env.tier === "gm" || (env.tier === "story" && needs === "story"))) return refusalOf("not_granted", c.ctx.view.text(WRITE_NOTE.notGranted, { tier: env.tier, needs }), key);
    if (needs === "gm" && draft.gmStaged() >= env.gmOps) return refusalOf("gm_cap", c.ctx.view.text(WRITE_NOTE.gmCap, { count: String(draft.gmStaged()) }), key);
    const writer: WriterEnv = { userId: env.userId, chatId: env.chatId, knowledge, reader: env.reader, agent: { role: env.role, id: env.agentId }, signal: env.signal, connectionId: env.connectionId };
    const learned = draft.own(env.agentId, env.phase).reduce((files, o) => (o.learned ? withLearned(files, o.learned) : files), c.ctx.learned);
    return checkOp(rt, c.ctx, writer, state, learned, op);
  };
  return {
    async dryRun(op) {
      const c = await context();
      if (isOpRefusal(c)) return c;
      const knowledge = env.knowledge as AgentKnowledge;
      const state = ownState(rt, draft, env, c.ctx.head);
      const checked = check(c, state, op, knowledge);
      if (isOpRefusal(checked)) return checked;
      const after = new Working(rt.registry, c.ctx.head.world, state);
      after.applyAll(checked.events);
      return { key: checked.p.key, changeType: checked.type, mode: checked.mode, lines: opLines(rt, c.ctx, knowledge, checked.type, after.state, checked.shown) };
    },
    async apply(ops) {
      const c = await context();
      if (isOpRefusal(c)) return { applied: [], refused: ops.map((op): OpRefusal => ({ ...c, ...(keyOf(op) !== undefined ? { key: keyOf(op) } : {}) })), chipId: null, pending: false };
      const knowledge = env.knowledge as AgentKnowledge;
      const applied: string[] = [];
      const refused: OpRefusal[] = [];
      for (const op of ops) {
        const key = keyOf(op);
        // The same operation staged again by this agent is the one it staged: nothing more.
        if (key !== undefined && draft.own(env.agentId, env.phase).some((o) => o.key === key)) {
          applied.push(key);
          continue;
        }
        const state = ownState(rt, draft, env, c.ctx.head);
        const checked = check(c, state, op, knowledge);
        if (isOpRefusal(checked)) {
          refused.push(checked);
          continue;
        }
        // A file's body is stored as it is staged, held for the turn until its run lets it go.
        if (checked.p.body) await rt.blobs.put(env.userId, checked.p.body.text, env.holder);
        const after = new Working(rt.registry, c.ctx.head.world, state);
        after.applyAll(checked.events);
        draft.stage({ phase: env.phase, role: env.role, agentId: env.agentId, key: checked.p.key, op, changeType: checked.type, mode: checked.mode, tier: opTier(op), knowledge, connectionId: env.connectionId, lines: opLines(rt, c.ctx, knowledge, checked.type, after.state, checked.shown), events: checked.events, ...(checked.p.learned ? { learned: checked.p.learned.changes } : {}) });
        applied.push(checked.p.key);
      }
      // Staged, not written: it lands when the turn commits (`pending`), with no chip of its own.
      return { applied, refused, chipId: null, pending: applied.length > 0 };
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
  /** Each applied, with the events it added (none for a learned-area change). */
  committed: { op: StagedOp; events: LedgerEvent[] }[];
  /** Each under Confirm, for the turn's review card. */
  confirm: StagedOp[];
  /** Each that no longer holds, with why. */
  refused: { op: StagedOp; refusal: OpRefusal }[];
  /** The learned area's changes it committed, each path's file after them, null where taken out: made when the turn closes. */
  learned: Record<string, LearnedFile | null>;
}

/** What a turn's commit checks its operations with: each role's writer context, by the role's knowledge, against the turn's base and learned area. */
export interface CommitCtx {
  ctx(knowledge: AgentKnowledge): WriterCtx;
  reader: ToolReader;
  userId: UserId;
  chatId: ChatId;
  signal: AbortSignal;
}

/**
 * Commits `ops` (in `commitOrder`) onto `w` (INC2-SPEC C10): each re-validated in order on what the
 * ones before it left, through the outside writer's checks for its role; one under Confirm is set
 * aside for the review card, one that no longer holds is refused, and the rest apply, each whole
 * (its events one unit, so a rebased view keeps or drops it whole) or not at all. Synchronous: the
 * plan and the read call it inside the core's own steps.
 */
export function commitStaged(rt: Runtime, commit: CommitCtx, ops: readonly StagedOp[], w: Working): CommitOutcome {
  const out: CommitOutcome = { committed: [], confirm: [], refused: [], learned: {} };
  for (const op of ops) {
    const env: WriterEnv = { userId: commit.userId, chatId: commit.chatId, knowledge: op.knowledge, reader: commit.reader, agent: { role: op.role, id: op.agentId }, signal: commit.signal, connectionId: op.connectionId };
    const ctx = commit.ctx(op.knowledge);
    const checked = checkOp(rt, ctx, env, w.state, withLearned(ctx.learned, out.learned), op.op);
    if (isOpRefusal(checked)) {
      out.refused.push({ op, refusal: checked });
      continue;
    }
    if (checked.mode === "confirm" && op.approved !== true) {
      // The card is the player's, whatever the role read with: its lines are the player character's.
      const pov = commit.ctx("pov");
      const after = new Working(rt.registry, pov.head.world, w.state);
      after.applyAll(checked.events);
      out.confirm.push({ ...op, mode: "confirm", events: checked.events, cardLines: opLines(rt, pov, "pov", checked.type, after.state, checked.shown) });
      continue;
    }
    // A learned-area change writes no event: it is made in the chat's metadata when the turn closes.
    if (checked.p.learned) {
      Object.assign(out.learned, checked.p.learned.changes);
      out.committed.push({ op, events: [] });
      continue;
    }
    const mark = w.mark();
    const from = w.events.length;
    const kept = w.applyAll(checked.events);
    if (kept.length < checked.events.length) {
      w.restore(mark);
      out.refused.push({ op, refusal: refusalOf("write_refused", commit.ctx(op.knowledge).view.text(WRITE_NOTE.stale), op.key) });
      continue;
    }
    if (!checked.events.some((e) => e.group !== undefined)) w.unite(from, `agent:${op.key}`);
    out.committed.push({ op, events: w.events.slice(from) });
  }
  return out;
}
