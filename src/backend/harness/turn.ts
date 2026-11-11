// The engine's side of one harness turn (HARNESS-SLICE3: "One turn on the harness engine"). The turn
// is played by the author and the agents it starts, in LumiAH's runtime; nothing here calls a model or
// decides a step for one. What the engine keeps for the turn, from the run's start to its reply's
// commit:
//
// - The working state: the state the turn started from with what has landed on it, the opening's
//   bookkeeping first, then what each `commit` made definitive. It is the turn's own, in memory: the
//   journal takes it whole when the reply is saved (`close`), or never (a stopped or failed run
//   leaves nothing staged and nothing half-written).
// - The staged writes: the operations the write tools staged (`TurnDraft`, through the turn writer
//   every agent turn uses) and the changes the harness engine's own tools staged (`HarnessTurn.stage`),
//   in one staging order.
// - Who is who (`Cast`): each agent by its handle, as LumiAH says who it is on its calls: the
//   definition it runs as, whether it is the run's main agent (the author), and the agents over
//   it. The tier it writes at is its definition's, raised by the author's grants, and never above
//   that of an agent over it (`standingOf`); the person a character's agent thinks for is said once.
//
// A tool call reads the turn's landed state with what its own agent staged on top, and writes into
// the staging. `commit` lands what is staged, in staging order, each change checked again on the
// state as it then stands: an operation through `commitStaged`, as an agent turn's commit does; a
// change as its events, whole or not at all. A change whose type the user set to Confirm goes to the
// review card: held at a gate under the player's message while `commit` waits, or shown on the
// reply's card once it is written, as Settings → Agents → Review card says.
//
// Consequences stay the engine's: after a commit the world's rules hear what the story changed and
// its tracks step; a turn whose author never said how much time it took takes the scene's default
// tick (Settings: `agents.harness.defaultTick`), once nothing can say it any more.

import type { RoleId, RoleTier } from "../../shared/agent-roles";
import type { ToolView } from "../../shared/agent-tools";
import { WRITE_NOTE } from "../../shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../shared/harness-texts";
import { hashParts } from "../../shared/hash";
import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import type { ChatRun, LedgerEvent, RecAgent } from "../../shared/ledger";
import { type ChangeType, EXTRACTION_TYPES, type ExtractionLearning } from "../../shared/settings";
import type { KeptFile } from "../../shared/stores";
import type { WorldDoc } from "../../shared/world";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import { runRulesOnEvents } from "../../engine/rules";
import { advance } from "../../engine/simulate";
import type { WorldState } from "../../engine/state";
import { fightHoldsClock, turnElapsed } from "../../engine/time";
import { stepTracks } from "../../engine/tracks";
import { Working } from "../../engine/working";
import { type Review, reviewChipId, type StoredReviewItem } from "../agents/review";
import { HARNESS_LISTED, type HarnessListed } from "../agents/tools/harness";
import { type HarnessFiles, makeWorldActs, type WorldAct, type WorldBuild } from "../agents/tools/harness-ports";
import type { HarnessChange, HarnessCommit, HarnessTurn } from "../agents/tools/harness-turn";
import { refusedAnswer } from "../agents/tools/propose";
import type { LoreLoads, ToolEnv } from "../agents/tools/registry";
import type { ChatHead } from "../agents/tools/workspace";
import { contextOf, landKept, type OpRefusal, withKept, type WriterCtx } from "../agents/tools/writer";
import { type CommitCtx, commitStaged, stagedWorkspace, type StagedOp, TurnDraft, turnReader, turnWriter } from "../agents/turn-writer";
import { recordCommit } from "../agents/yields";
import { knowledgeOn } from "../chat-knowledge-prefs";
import type { StoredChip } from "../chips";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { effectiveMode, recordOutcome } from "../settings-store";
import type { TurnFrame } from "../turn-frame";
import { cardedChange, cardLines } from "./card";
import { harnessRole, type HarnessRole } from "./definitions";
import type { AgentRef, RemoteToolCall } from "./shapes";

/** The writer tiers, least first: a grant only ever raises one. */
const TIERS: readonly RoleTier[] = ["read", "story", "gm"];
const rank = (tier: RoleTier | undefined): number => (tier === undefined ? 0 : TIERS.indexOf(tier));

/** The view an agent of no definition of the engine's reads with (a user's own, LumiAH's): the scene as the narrator may be told it, every secret marked. */
const OTHER_VIEW: { view: ToolView; marks: boolean } = { view: "everyone", marks: true };

/**
 * The roles a tier's writes are made as where an agent's own definition doesn't hold that tier
 * (`writerRole`): the chronicler's at the story's, the author's at the game master's. They follow
 * the definitions (`definitions/index.ts`), so they are no setting of their own.
 */
const STORY_ROLE: RoleId = "curator";
const AUTHOR_ROLE: RoleId = "director";

const NO_GRANTS: ReadonlyMap<string, RoleTier> = new Map();

/** An agent of a run where it stands among the others: the definition it runs as, and the agents over it, from the run's main agent down to the one that started it. */
export interface Placed {
  /** Its key wherever its writes are kept: its handle; a job's agent's follows its job's id, so it is never a handle of the turn the job stages into. */
  id: string;
  def: string;
  above: readonly { id: string; def: string }[];
}

/**
 * One agent of a run, as LumiAH said who it is on its first call (`RemoteToolCall`): the
 * definition it runs as, whether it is the run's main agent, the agents over it. With how that
 * definition reads and writes, and the person it thinks for once it has said so.
 */
export interface TurnAgent extends Placed {
  role: HarnessRole | null;
  character: EntityId | null;
  /** It is its run's main agent: the author, where the run is a turn's own. */
  main: boolean;
  /** The job whose run it is of; null for an agent of a turn's own run. */
  job: string | null;
}

/** Who a call comes from, as LumiAH says it on every call. */
export type Caller = Pick<RemoteToolCall, "agentId" | "role" | "main" | "above">;

/** The agents over a caller as its call names them; none where it names none that can be read: a call that crossed a link is whatever was sent. */
function lineOf(above: unknown): AgentRef[] {
  return Array.isArray(above) ? above.filter((a): a is AgentRef => isRecord(a) && typeof a.agentId === "string" && typeof a.role === "string") : [];
}

/** An agent's handle, from its key: what the run that started it knows it by. */
const handleOf = (key: string): string => key.slice(key.lastIndexOf(">") + 1);

/**
 * The agents of one run: each known by its handle from the first call that came from it, as
 * LumiAH said who it is then, and kept for the run's whole life: a turn, its tail after the reply,
 * a job's run. So an agent is one record whatever part of the run its calls fall in, and who it
 * thinks for is never asked twice. The agents a caller names over it are placed too, before any
 * call of their own, so whoever started a job is known by where it stood.
 */
export class Cast {
  private readonly agents = new Map<string, TurnAgent>();
  /** The agents a caller named over it that haven't called, by handle. */
  private readonly named = new Map<string, Placed>();

  /** `job`: the job whose run this is; null for a turn's own. */
  constructor(private readonly job: string | null = null) {}

  private key(handle: string): string {
    return this.job === null ? handle : `${this.job}>${handle}`;
  }

  /** The agent a call comes from. A call that doesn't say it is the main agent's isn't, and neither is one with an agent over it. */
  of(call: Caller): TurnAgent {
    const known = this.agents.get(call.agentId);
    if (known) return known;
    const above: { id: string; def: string }[] = [];
    for (const one of lineOf(call.above)) {
      if (!this.agents.has(one.agentId) && !this.named.has(one.agentId)) this.named.set(one.agentId, { id: this.key(one.agentId), def: one.role, above: [...above] });
      above.push({ id: this.key(one.agentId), def: one.role });
    }
    const agent: TurnAgent = { id: this.key(call.agentId), def: call.role, role: harnessRole(call.role), character: null, main: call.main === true && above.length === 0, above, job: this.job };
    this.agents.set(call.agentId, agent);
    this.named.delete(call.agentId);
    return agent;
  }

  /** Where an agent of the run stands, by its handle: one that called, or one a caller named over it. Null for a handle the run hasn't shown. */
  placed(handle: string): Placed | null {
    return this.agents.get(handle) ?? this.named.get(handle) ?? null;
  }

  /** Whether an agent the run has shown runs as the definition `def`. */
  runs(def: string): boolean {
    for (const agent of this.agents.values()) if (agent.def === def) return true;
    for (const agent of this.named.values()) if (agent.def === def) return true;
    return false;
  }
}

/** What holds a job's agents: the tier whoever started the job writes at, and that agent's handle. */
export interface Ceiling {
  tier: RoleTier;
  by: string;
}

/** Where a caller stands for a tool (`toolRefusal`). */
export interface Standing {
  /** The tier its own definition gives it, raised by what the author granted it. */
  own: RoleTier;
  /** The lowest tier an agent over it holds: those over it in its run, and whoever started its job. It writes no higher, whatever it runs as. */
  over: RoleTier;
  /** Who holds it to `over`, by key; null where no one over it holds less than the game master's tier. */
  under: string | null;
  /** It is the author: the main agent of a turn's own run. */
  author: boolean;
  /** The definition it runs as. */
  def: string;
}

/**
 * Where an agent stands: the tier of its own definition, raised by what the author granted it or
 * every agent of its definition (`grants`: by an agent's key, or by a definition's id), and the
 * lowest tier held the same way by an agent over it in its run or by whoever started its job
 * (`ceiling`). No tier comes with a definition's id alone: started by an agent that only reads, an
 * agent only reads, whatever it runs as.
 */
export function standingOf(agent: Placed, grants: ReadonlyMap<string, RoleTier> = NO_GRANTS, ceiling: Ceiling | null = null, author = false): Standing {
  const own = (who: { id: string; def: string }): RoleTier => TIERS[Math.max(rank(harnessRole(who.def)?.tier), rank(grants.get(who.id)), rank(grants.get(who.def)))] ?? "read";
  let over: RoleTier = ceiling?.tier ?? "gm";
  let under = ceiling !== null && ceiling.tier !== "gm" ? ceiling.by : null;
  for (const one of agent.above) {
    const tier = own(one);
    if (rank(tier) >= rank(over)) continue;
    over = tier;
    under = one.id;
  }
  return { own: own(agent), over, under, author, def: agent.def };
}

/** The tier a caller writes at: its own, never above what holds it. */
export function reach(who: Pick<Standing, "own" | "over">): RoleTier {
  return rank(who.over) < rank(who.own) ? who.over : who.own;
}

/**
 * The role an agent's writes are made as at the tier it writes at, whose modes and caps the writer
 * reads: the story's keeper's at the story's tier, whatever the agent runs as, since the story's
 * own changes to things and places are that role's (`opTier`), so a grant of the story's tier
 * opens them to whoever holds it; at the game master's, its definition's own, and the author's for
 * an agent of no definition of the engine's. Null for an agent that only reads.
 */
export function writerRole(role: HarnessRole | null, tier: RoleTier): RoleId | null {
  if (tier === "read") return null;
  return tier === "story" ? STORY_ROLE : (role?.role ?? AUTHOR_ROLE);
}

/** What each tool the harness lists needs of whoever calls it, and whether it changes anything, by its name. */
const LISTED: ReadonlyMap<string, Pick<HarnessListed, "needs" | "tier">> = new Map(HARNESS_LISTED.map((t) => [t.name, { needs: t.needs, tier: t.tier }]));

function refusal(code: string, reason: string, key?: string): OpRefusal {
  return { refused: true, code, reason, ...(key !== undefined ? { key } : {}) };
}

/**
 * Who may call a tool, by what the tool needs (`HarnessListed.needs`): the one rule the bridge
 * holds every call to before the tool runs (`HarnessEngine.call`), and every change a tool stages
 * once more as it is staged (`OpenTurn.stage`, `jobs.ts`), whatever tools the caller's definition
 * lists.
 * - A change of the story's or the game master's: an agent that writes at that tier (`reach`).
 * - The author's own tools: the main agent of a turn's own run.
 * - A mind's tools: an agent started as a character.
 * - A tool that writes, whoever it is for: no agent over the caller only reads.
 *
 * Null where the caller may; else the refusal in the user's words (`text`), worded as the writer or
 * the tool itself words the same refusal.
 */
export function toolRefusal(tool: string, who: Standing, text: (id: string, vars?: Readonly<Record<string, string>>) => string, key?: string): OpRefusal | null {
  const listed = LISTED.get(tool);
  // A tool the engine doesn't list is no one's: `runHarnessTool` answers that.
  if (!listed) return null;
  const { needs } = listed;
  const held = (): OpRefusal => refusal("held_under", text(HARNESS_NOTE.heldUnder, { tool, under: handleOf(who.under ?? ""), holds: who.over }), key);
  if (needs === "story" || needs === "gm") {
    if (rank(reach(who)) >= rank(needs)) return null;
    if (rank(who.own) >= rank(needs)) return held();
    return who.own === "read" ? refusal("no_writer", text(WRITE_NOTE.noWriter), key) : refusal("not_granted", text(WRITE_NOTE.notGranted, { tier: who.own, needs }), key);
  }
  if (needs === "author" && !who.author) return refusal("author_only", text(HARNESS_NOTE.authorOnly, { tool }), key);
  if (needs === "mind" && who.def !== HARNESS_AGENT.character) return refusal("not_character", text(HARNESS_NOTE.notCharacter, { tool }), key);
  return listed.tier !== "read" && who.over === "read" ? held() : null;
}

/** A call the gate closed, as it is answered: a change above the caller's tier as the writer answers one (`refusedAnswer`), anything else in its words alone, as a tool refuses. */
export function closedAnswer(closed: OpRefusal): { text: string; error: true } {
  return { text: closed.code === "no_writer" || closed.code === "not_granted" ? refusedAnswer(closed).text : closed.reason, error: true };
}

/** One call as a turn serves it: who calls, and what the bridge gives the call besides the turn. */
export interface TurnCall {
  agent: TurnAgent;
  /** The tool called: what a change it stages is held to once more (`toolRefusal`). */
  tool: string;
  /** For an agent of a job that runs beside the turn: what holds the job's agents (`Ceiling`). */
  ceiling: Ceiling | null;
  /** The chat's area of LumiAH's workspace, where whoever mounts LumiAH gives one (`ToolEnv.files`). */
  files: HarnessFiles | null;
}

/** A change one of the harness engine's own tools staged, with who staged it. */
interface StagedChange {
  change: HarnessChange;
  agentId: string;
  /** The role its change type's learned mode is read for; none for a type a reply's read may change, whose mode is the read's whoever stages it. */
  role: RoleId | null;
  /** Let through at the turn's gate: it lands without asking again. */
  approved?: true;
}

/** One staged write, in the turn's staging order: a write tool's operation, or a harness tool's change. */
type Staged = { seq: number; op: StagedOp } | { seq: number; staged: StagedChange };

/** A staged write that asks first. */
type Asked = { op: StagedOp } | { staged: StagedChange };

/** An act on the world's document a commit landed (`CommitOutcome.acts`): made in the world's store once the commit has landed everything else. */
type LandedAct = { op: StagedOp; act: WorldAct };

/** What a turn is opened with: the generation it is, what it runs on, and the state it starts from. */
export interface OpenTurnInit {
  chatId: ChatId;
  userId: UserId;
  generationId: string;
  frame: TurnFrame;
  run: ChatRun;
  core: LedgerCore;
  /** The chat before the turn's reply: what the turn answers, and what its agents read as the chat so far. */
  before: ChainMessage[];
  /** The state the turn started from, before anything of it landed, and the world played there. */
  start: WorldState;
  world: WorldDoc;
  /** The opening's bookkeeping, which the journal's planned turn already holds. */
  opening: readonly LedgerEvent[];
  seed: string;
  /** A Continue: it has no plan of its own, and what it lands joins its reply's record as a Continue's read does. */
  continues: boolean;
  kept: Record<string, KeptFile>;
  learning: ExtractionLearning;
  /** The user's default connection: what a change type's learned mode is keyed by where an agent names none. */
  active: string;
  said: HarnessTurn["said"];
  /** The document of the world the chat plays, as the `world` tools edit it (`worldBuild`). */
  build: WorldBuild | null;
}

/** What a turn leaves once its reply is committed. */
export interface TurnClose {
  /** The minutes of the scene's default tick the turn took, when no agent said its time. */
  defaultTick: number | null;
}

export class OpenTurn {
  readonly chatId: ChatId;
  readonly userId: UserId;
  readonly generationId: string;
  readonly frame: TurnFrame;
  readonly run: ChatRun;
  readonly seed: string;
  readonly continues: boolean;
  readonly said: HarnessTurn["said"];
  /** The lore the turn's agents loaded into the reply it is writing (`lore_load`): the Scene section's. */
  readonly loads: string[] = [];
  /** Ends when the turn is let go: every call still working for it stops. */
  private readonly stop = new AbortController();
  /** Ends when the turn closes: a commit still waiting at its gate goes on, and what it waited for goes to the reply's card. */
  private readonly finishing = new AbortController();
  private readonly core: LedgerCore;
  private readonly before: ChainMessage[];
  private readonly start: WorldState;
  private readonly draft: TurnDraft;
  /** The turn's landed events on the state it started from. */
  private readonly w: Working;
  /** How many of them are the opening's: the journal's planned turn holds those already. */
  private readonly opened: number;
  /** The landed state as the agents read it: a copy taken after each landing, never changed, so a read under way keeps its state. */
  private landedAt: { state: WorldState; world: WorldDoc; version: number };
  private readonly heads = new Map<string, { key: string; head: ChatHead }>();
  private order: Staged[] = [];
  private seq = 0;
  private commits = 0;
  /** The agents of the turn's own run. The engine keeps it past the turn's close, for what they still call once its reply is saved. */
  readonly cast = new Cast();
  /** What the author granted, by an agent's key or a definition's id (`grant`). */
  private readonly grants = new Map<string, RoleTier>();
  /** The landed state with what every agent staged on top (`whole`), as the turn stood when it was asked. */
  private all: { key: string; state: Readonly<WorldState>; world: WorldDoc } | null = null;
  /** How the gate's cards were answered for the harness tools' changes: counted toward what their types learn once the turn's record is written (`finish`), and never for a turn that was let go. */
  private readonly taught: { type: ChangeType; outcome: "accepted" | "rejected"; at: number }[] = [];
  private readonly kept: Record<string, KeptFile>;
  /** The kept files' changes the turn committed: made in their stores once the turn's record is written. */
  private readonly landing: Record<string, KeptFile | null> = {};
  private readonly learning: ExtractionLearning;
  private readonly active: string;
  private readonly build: WorldBuild | null;
  /** Each operation committed, with its events: which role wrote what, for the record. */
  private readonly committed: { op: StagedOp; events: LedgerEvent[] }[] = [];
  /** What asks first and waits for the reply's review card. */
  private readonly waiting: Asked[] = [];
  /** The gate the turn waits at, if a commit is waiting. */
  private gate: { key: string; done: PromiseWithResolvers<void> } | null = null;
  /** The commits' landings, one at a time. A commit's acts on the world's document are made after its landing and outside this chain, so the turn's last commit never waits on one (`makeActs`). */
  private committing: Promise<unknown> = Promise.resolve();
  /** The acts on the world's document the turn's commits landed, made a commit's after another's, in the order asked. */
  private acting: Promise<unknown> = Promise.resolve();
  /** Those its last commit landed, as its reply was saved: made once the turn's record is written (`late`). */
  private readonly left: LandedAct[] = [];
  /** A landed change said how much time the turn takes (none included). */
  private timeSaid = false;
  private tick: number | null = null;
  /** The writer's request was made from the turn (`sections`): whoever writes the reply, LumiAH's writer or Lumiverse's own generation, has what it will be given. */
  private requested = false;
  /**
   * The author handed the reply over with a brief (`writerRequest`, as LumiAH last asked it): the
   * reply is this turn's. False while it hasn't, and where LumiAH had the reply written without one
   * (the author failed, ran out of time or was stopped in the harness before it briefed the writer):
   * such a reply is one no turn was played for, and nothing of the turn stands.
   */
  briefed = false;
  /** The reply's text once LumiAH says it is written (`replyWritten`, or its run's end); null until then. */
  replied: string | null = null;
  closed = false;
  /** Settles once the turn's record is written or the turn is let go: a call that belongs to that record waits for it. */
  readonly settled = Promise.withResolvers<void>();
  /** The texts the writer's sections were made from, by their prompt set's hash: recorded on the turn's record. */
  prompts: string | null = null;

  constructor(
    private readonly rt: Runtime,
    private readonly review: Review,
    init: OpenTurnInit,
  ) {
    this.chatId = init.chatId;
    this.userId = init.userId;
    this.generationId = init.generationId;
    this.frame = init.frame;
    this.run = init.run;
    this.seed = init.seed;
    this.continues = init.continues;
    this.said = init.said;
    this.core = init.core;
    this.before = init.before;
    this.start = init.start;
    this.kept = init.kept;
    this.learning = init.learning;
    this.active = init.active;
    this.build = init.build;
    this.w = new Working(rt.registry, init.world, init.start);
    this.w.applyAll(init.opening);
    this.opened = this.w.events.length;
    this.landedAt = { state: structuredClone(this.w.state), world: this.w.world, version: 0 };
    this.draft = new TurnDraft(init.generationId);
    // The write tools stage through the turn writer; the turn keeps one order over them and the harness tools' changes.
    this.draft.watch = {
      staged: (op) => void this.order.push({ seq: ++this.seq, op }),
      refused: () => undefined,
      dropped: (ops) => {
        const gone = new Set(ops);
        this.order = this.order.filter((item) => !("op" in item) || !gone.has(item.op));
      },
    };
  }

  private get at(): { chatId: ChatId; userId: UserId; turn: string } {
    return { chatId: this.chatId, userId: this.userId, turn: this.generationId };
  }

  private text(id: string, vars: Readonly<Record<string, string>> = {}): string {
    return renderPrompt(id, this.frame.settings.prompts.texts, vars);
  }

  /** The holder of the blobs the turn's staged files hold, until its record carries them or the turn is let go. */
  private get holder(): string {
    return `harness:${this.generationId}`;
  }

  // ---------------------------------------------------------------- reading the turn

  /**
   * The turn's sections for its writer (`Runtime.harnessSections`), from what has landed, with its
   * time settled first, so they tell the time its record will hold. `outline`: the author's brief, a
   * line each.
   */
  async sections(outline: readonly string[]): Promise<{ slot: string; content: string }[]> {
    this.settleTime(false);
    this.requested = true;
    const built = await this.rt.harnessSections({ chatId: this.chatId, userId: this.userId, generationId: this.generationId, core: this.core, before: this.before, world: this.landedAt.world, state: this.landedAt.state, said: this.said.user, outline, loads: this.loads, elapsed: this.continues ? null : this.w.state.clock - this.start.clock });
    this.prompts = built.prompts;
    return built.fills;
  }

  /** The turn's landed events but the opening's: what joins its planned events when its reply is saved (a Continue's: what its read records). */
  private own(): LedgerEvent[] {
    return this.w.events.slice(this.opened);
  }

  private snap(): void {
    this.landedAt = { state: structuredClone(this.w.state), world: this.w.world, version: this.landedAt.version + 1 };
    this.heads.clear();
  }

  /** Whether an agent is the turn's author: the main agent of the turn's own run, as LumiAH says on its calls. Never an agent of a job, whatever it runs as, and never whoever of the author's definition calls first. */
  private authors(agent: TurnAgent): boolean {
    return agent.main && agent.job === null;
  }

  /** Where an agent stands now (`standingOf`), as the call finds it: a grant the author makes later raises it for the calls after. */
  standing(agent: TurnAgent, ceiling: Ceiling | null = null): Standing {
    return standingOf(agent, this.grants, ceiling, this.authors(agent));
  }

  /** Where an agent of the turn's own run stands for one who asks from outside it (a job it started): by its handle, as the turn's grants stand now. Null for a handle the run hasn't shown. */
  placing(handle: string): Standing | null {
    const placed = this.cast.placed(handle);
    return placed ? standingOf(placed, this.grants) : null;
  }

  /**
   * The turn's landed state with what every agent has staged on top, in staging order: what a cap
   * that holds across the turn is counted on. A tool reads only what landed and what its own agent
   * staged, so two agents staging side by side would each have the whole of a cap until a commit
   * landed. A staged write that no longer applies on the ones before it is left out, as it will be
   * when the turn commits.
   */
  private whole(): { state: Readonly<WorldState>; world: WorldDoc } {
    const key = `${this.landedAt.version}:${this.seq}:${this.order.length}`;
    if (this.all?.key === key) return this.all;
    const w = new Working(this.rt.registry, this.landedAt.world, this.landedAt.state);
    for (const item of this.order) {
      const events = "op" in item ? item.op.events : item.staged.change.events;
      const mark = w.lightMark();
      if (w.applyAll(events).length < events.length) w.restore(mark);
    }
    this.all = { key, state: w.state, world: w.world };
    return this.all;
  }

  /**
   * The head an agent reads and writes against: the turn's landed state with the changes it staged
   * itself on top, so it finds what it recorded earlier in the turn before the author commits it. The
   * chat it reads is the chat before the turn's reply.
   */
  private headFor(agent: TurnAgent): ChatHead {
    const mine = this.order.flatMap((item) => ("staged" in item && item.staged.agentId === agent.id ? [item.staged.change] : []));
    const key = `${this.landedAt.version}:${mine.length}`;
    const known = this.heads.get(agent.id);
    if (known?.key === key) return known.head;
    let { state, world } = this.landedAt;
    if (mine.length > 0) {
      const w = new Working(this.rt.registry, world, state);
      for (const change of mine) w.applyAll(change.events);
      state = w.state;
      world = w.world;
    }
    const head: ChatHead = { run: this.run, core: this.core, observed: this.before, world, state };
    this.heads.set(agent.id, { key, head });
    return head;
  }

  // ---------------------------------------------------------------- one tool call

  /**
   * What one tool call runs with (HARNESS-SLICE3 step 4): the calling agent's view of the turn's head,
   * a writer at the tier it writes at that stages into the turn, where it loads lore into the reply,
   * the chat's files, and the turn itself as the harness engine's own tools reach it. An agent of a
   * job that runs beside the turn stages into it as the agents the author starts do.
   */
  env(call: TurnCall, signal: AbortSignal): ToolEnv {
    const { agent } = call;
    const both = AbortSignal.any([signal, this.stop.signal]);
    const base = (): ChatHead => this.headFor(agent);
    const staged = (head: ChatHead) => stagedWorkspace(this.rt, this.draft, head, withKept(this.kept, this.landing));
    const { view, marks } = agent.role ?? OTHER_VIEW;
    const reader = turnReader(this.rt, base, { userId: this.userId, chatId: this.chatId, knowledge: view, marks, staged, own: () => this.draft.own(agent.id, "pre") });
    const tier = reach(this.standing(agent, call.ceiling));
    // An agent writes as the role its tier's changes are made as, whatever it runs as; one of the engine's own that only reads is told so by its own writer, and an agent of no definition of the engine's has none until the author grants it a tier.
    const role = writerRole(agent.role, tier) ?? agent.role?.role ?? null;
    const writer = role ? turnWriter(this.rt, this.draft, { userId: this.userId, chatId: this.chatId, role, agentId: agent.id, tier, connectionId: null, phase: "pre", base, kept: () => withKept(this.kept, this.landing), reader, gmOps: this.frame.settings.agents.gmOpsPerTurn, holder: this.holder, signal: both }) : null;
    const loads: LoreLoads = {
      add: (loreId) => {
        // Once the writer's request is made, nothing more reaches the reply.
        if (this.requested || this.closed) return false;
        if (!this.loads.includes(loreId)) this.loads.push(loreId);
        return true;
      },
    };
    return { userId: this.userId, chatId: this.chatId, knowledge: view, marks, reader, writer, agent: { role: agent.def, id: agent.id }, signal: both, loads, build: this.build, files: call.files, turn: this.turnFor(call, tier, both) };
  }

  /** The turn as one agent's harness tools reach it. */
  private turnFor(call: TurnCall, tier: RoleTier, signal: AbortSignal): HarnessTurn {
    const { agent } = call;
    const main = this.authors(agent);
    return {
      main,
      // As the call finds it: a grant the author makes later raises it for the calls after.
      tier,
      get character() {
        return agent.character;
      },
      bind: (entity) => {
        if (agent.character !== null) return agent.character === entity;
        agent.character = entity;
        return true;
      },
      grant: (to, granted) => this.grant(agent, to, granted),
      knowing: knowledgeOn(this.frame.chat, this.landedAt.world, this.frame.settings),
      settings: this.frame.settings,
      host: this.rt.host,
      seed: this.seed,
      runSeed: this.run.runSeed,
      start: this.start,
      landed: () => [...this.w.events],
      whole: () => this.whole().state,
      staged: () => this.order.flatMap((item) => ("op" in item ? item.op.events : item.staged.change.events)),
      said: this.said,
      reply: null,
      stage: (change) => this.stage(call, change, signal),
      commit: async (note) => {
        if (!main) return refusal("not_main", this.text(HARNESS_NOTE.notMain));
        if (this.closed) return refusal("not_turn", this.text(HARNESS_NOTE.notTurn));
        return this.commit(note, signal);
      },
    };
  }

  /**
   * `grant_writes`: opens a tier's changes to one agent of the turn's own run, by its handle, or
   * to every agent of a definition, by its id, for the rest of the turn, whatever the agent runs
   * as; it is never taken back. Only the author grants. False where `to` names no one; a refusal,
   * with why, where the grant would open nothing: a tier above the author's own, an agent started
   * by one that holds less (it writes no higher than that one, `standingOf`), a person's own mind.
   */
  private grant(by: TurnAgent, to: string, tier: RoleTier): boolean | OpRefusal {
    if (!this.authors(by) || this.closed) return false;
    const one = this.cast.placed(to);
    // A handle the turn's run has shown, a definition one of its agents runs as, or one of the engine's own: a grant to no one grants nothing.
    if (one === null && harnessRole(to) === null && !this.cast.runs(to)) return false;
    // Every agent reads, and a grant never lowers a tier: nothing to open.
    if (tier === "read") return true;
    // A person's own mind is held to its own tools whatever tier it has (`HarnessEngine.call`).
    if ((one?.def ?? to) === HARNESS_AGENT.character) return refusal("grant_mind", this.text(HARNESS_NOTE.grantMind, { to }));
    const yours = reach(this.standing(by));
    if (rank(tier) > rank(yours)) return refusal("grant_above", this.text(HARNESS_NOTE.grantAbove, { tier, yours }));
    for (const over of one?.above ?? []) {
      const holds = standingOf({ ...over, above: [] }, this.grants).own;
      if (rank(holds) < rank(tier)) return refusal("grant_under", this.text(HARNESS_NOTE.grantUnder, { to, tier, under: handleOf(over.id), holds }));
    }
    if (rank(tier) > rank(this.grants.get(to))) this.grants.set(to, tier);
    return true;
  }

  // ---------------------------------------------------------------- staging

  /** The mode of a change type now, for whoever staged it. */
  private modeOf(type: ChangeType, role: RoleId | null): "auto" | "confirm" | "never" {
    return effectiveMode(this.frame.settings, this.learning, this.active, type, role ?? undefined).mode;
  }

  /**
   * A change its type's channel made, checked by that channel once more on the turn as every agent
   * has staged it (`whole`): its tool read only what its own agent staged, so a cap that holds
   * across the turn (the people replies may introduce) or a name another agent just gave would be
   * each agent's own until a commit landed. Null where it holds, or no channel takes it.
   */
  private across(change: HarnessChange): OpRefusal | null {
    const proposal = change.proposal;
    const channel = proposal && typeof proposal.type === "string" ? this.rt.registry.proposals.get(proposal.type) : undefined;
    if (!proposal || !channel) return null;
    const { state, world } = this.whole();
    const bad = channel.validate(proposal, this.rt.registry.context(world, state));
    return bad ? refusal(bad.code, bad.gm ?? bad.reason, change.key) : null;
  }

  /**
   * Stages one change of a harness tool: its events are the engine's own, made by the validator of
   * the step the tool stands in for, on the state its call read. Checked here: that the tool is the
   * caller's to call (the call's own gate once more, so no change rests on that one line), the
   * user's mode for its type, and what holds across the turn (`across`). It lands when the author
   * commits, checked on the state as it then stands. The same change staged again is the one staged.
   */
  private async stage(call: TurnCall, change: HarnessChange, signal: AbortSignal): Promise<{ mode: "auto" | "confirm" } | OpRefusal> {
    const { agent } = call;
    if (signal.aborted) return refusal("cancelled", this.text(WRITE_NOTE.cancelled), change.key);
    if (this.closed) return refusal("no_turn", this.text(HARNESS_NOTE.noTurn), change.key);
    const closed = toolRefusal(call.tool, this.standing(agent, call.ceiling), (id, vars) => this.text(id, vars), change.key);
    if (closed) return closed;
    // Only the author says how much time its turn takes.
    if (change.time !== undefined && !this.authors(agent)) return refusal("not_main", this.text(HARNESS_NOTE.notMain), change.key);
    const type = change.changeType;
    // A type a reply's read may change keeps the read's mode, whoever stages it; any other is its role's.
    const role = type !== null && !(EXTRACTION_TYPES as readonly string[]).includes(type) ? (agent.role?.role ?? null) : null;
    let mode: "auto" | "confirm" = "auto";
    if (type !== null) {
      const now = this.modeOf(type, role);
      if (now === "never") return refusal("mode_never", this.text(WRITE_NOTE.never, { type }), change.key);
      // Confirm sends it to the review card, with a proposal the card can make it from or, with none, in its tool's own plain words.
      mode = now;
    }
    if (this.order.some((item) => "staged" in item && item.staged.change.key === change.key)) return { mode };
    const over = this.across(change);
    if (over) return over;
    this.order.push({ seq: ++this.seq, staged: { change, agentId: agent.id, role } });
    return { mode };
  }

  // ---------------------------------------------------------------- committing

  /**
   * Makes everything staged so far definitive (HARNESS-SLICE3 step 5), one commit at a time: each
   * takes what is staged as it starts, in staging order. `closing`: the turn's last, as its reply is
   * saved, which waits at no gate.
   *
   * An act on the world's document that lands is made once the rest has landed, before the commit
   * answers, and its line says what it came to. The last commit's are kept for `late`: it runs
   * inside the chat's own ledger operation, where an Upgrade, a write of that ledger, would wait on
   * itself.
   */
  commit(note: string | null, signal: AbortSignal, closing = false): Promise<HarnessCommit> {
    const acts: LandedAct[] = [];
    const landing = this.committing.catch(() => undefined).then(() => this.commitNow(signal, closing, acts));
    this.committing = landing;
    return landing.then(async (out) => {
      if (closing) this.left.push(...acts);
      else await this.makeActs(acts, out);
      this.rt.host.log("info", `[LumiRPEngine] turn ${this.generationId.slice(0, 8)}: commit${note ? ` (${note.slice(0, 200)})` : ""}: ${out.landed.length} landed, ${out.review.length} to review, ${out.refused.length} refused${closing && acts.length > 0 ? `, ${acts.length} of the world's document to make` : ""}`, this.userId);
      return out;
    });
  }

  private async commitNow(signal: AbortSignal, closing: boolean, acts: LandedAct[]): Promise<HarnessCommit> {
    const out: HarnessCommit = { landed: [], review: [], refused: [] };
    const taken = new Set(this.draft.take("pre"));
    const items = this.order.filter((item) => !("op" in item) || taken.has(item.op));
    this.order = [];
    if (items.length === 0) return out;
    const from = this.w.events.length;
    const ask: Asked[] = [];
    const ctx = this.commitCtx();
    // Operations staged one after another commit together, so one that names a thing another makes still finds it (`commitStaged`).
    let ops: StagedOp[] = [];
    for (const item of items) {
      if ("op" in item) {
        ops.push(item.op);
        continue;
      }
      this.commitOps(ctx, ops, out, ask, acts);
      ops = [];
      this.commitChange(item.staged, out, ask);
    }
    this.commitOps(ctx, ops, out, ask, acts);
    if (ask.length > 0) await this.askFirst(ctx, ask, out, signal, closing, acts);
    if (this.w.events.length > from) {
      // The story moves on from what landed: a stage it made true is entered now, so the author and the writer read it.
      stepTracks(this.rt.registry, this.w, hashParts(this.seed, "harness", "tracks", String(++this.commits)));
      this.snap();
    }
    return out;
  }

  /**
   * Makes the acts a commit landed, in the order asked and after those of the commits before it,
   * and tells each in `out`: landed, with what it came to, or refused with the world's store's
   * reason. One the store refuses stops none of the others.
   */
  private makeActs(acts: readonly LandedAct[], out: HarnessCommit): Promise<void> {
    if (acts.length === 0) return Promise.resolve();
    const made = this.acting
      .catch(() => undefined)
      .then(async () => {
        const results = await makeWorldActs(this.rt, { chatId: this.chatId, userId: this.userId }, acts.map((a) => a.act));
        const refused: { op: StagedOp; refusal: OpRefusal }[] = [];
        acts.forEach(({ op }, i) => {
          const result = results[i];
          if (result && "made" in result) return void out.landed.push([...op.lines, result.made]);
          const reason = result?.refused ?? this.text(WRITE_NOTE.stale);
          out.refused.push({ lines: op.lines, reason });
          refused.push({ op, refusal: refusal("world_refused", reason, op.key) });
        });
        recordCommit(this.rt, this.at, this.frame.settings.prompts.texts, { confirm: [], refused });
      });
    this.acting = made;
    return made;
  }

  /** What a commit checks operations with: the roles' writer context over the turn's landed state as the commit starts. */
  private commitCtx(): CommitCtx {
    const head: ChatHead = { run: this.run, core: this.core, observed: this.before, world: this.w.world, state: structuredClone(this.w.state) };
    let ctx: WriterCtx | null = null;
    return {
      ctx: () => (ctx ??= contextOf(this.rt, { knowledge: "everyone" }, head, this.frame.settings, this.learning, withKept(this.kept, this.landing), this.active)),
      reader: turnReader(this.rt, () => head, { userId: this.userId, chatId: this.chatId, knowledge: "gm" }),
      userId: this.userId,
      chatId: this.chatId,
      signal: this.stop.signal,
    };
  }

  /** Commits a run of operations onto the turn's state, as an agent turn's commit does (`commitStaged`): each lands, asks first, or is refused with why. An act on the world's document that lands joins `acts`, to be made once the commit has landed (`makeActs`). */
  private commitOps(ctx: CommitCtx, ops: readonly StagedOp[], out: HarnessCommit, ask: Asked[], acts: LandedAct[]): void {
    if (ops.length === 0) return;
    const done = commitStaged(this.rt, ctx, ops, this.w);
    // What landed, or went to the review card, of the GM's edits counts toward the turn's cap.
    this.draft.landed([...done.committed.map((c) => c.op), ...done.acts.map((a) => a.op), ...done.confirm].filter((op) => op.tier === "gm").length);
    this.committed.push(...done.committed);
    Object.assign(this.landing, done.kept);
    for (const c of done.committed) out.landed.push(c.op.lines);
    for (const r of done.refused) out.refused.push({ lines: r.op.lines, reason: r.refusal.reason });
    for (const op of done.confirm) ask.push({ op });
    acts.push(...done.acts);
    recordCommit(this.rt, this.at, this.frame.settings.prompts.texts, { confirm: [], refused: done.refused });
  }

  /** Commits one harness tool's change: its type's mode asked again, then its events, whole or not at all. */
  private commitChange(staged: StagedChange, out: HarnessCommit, ask: Asked[]): void {
    const { change } = staged;
    const type = change.changeType;
    if (type !== null && staged.approved !== true) {
      const mode = this.modeOf(type, staged.role);
      if (mode === "never") return void out.refused.push({ lines: change.lines, reason: this.text(WRITE_NOTE.never, { type }) });
      if (mode === "confirm") return void ask.push({ staged });
    }
    const w = this.w;
    const mark = w.lightMark();
    const from = w.events.length;
    if (w.applyAll(change.events).length < change.events.length) {
      // No longer true of the state as it stands: what landed before it changed what it was made on.
      const why = w.dropped.at(-1)?.rejection;
      w.restore(mark);
      return void out.refused.push({ lines: change.lines, reason: why ? (why.gm ?? why.reason) : this.text(WRITE_NOTE.stale) });
    }
    // One unit, so a rebased view keeps or drops the change whole; a change that groups its own events keeps its groups.
    if (!change.events.some((e) => e.group !== undefined)) w.unite(from, `harness:${change.key}`);
    // The world's rules hear what the story changed, as they hear a reply's read. Passed time ran them as it passed, and an action or a fight's round ran them as it was played: what either staged is what the rules made already.
    if (type !== null && type !== "play" && change.time === undefined && w.events.length > from) runRulesOnEvents(this.rt.registry, w, w.events.slice(from), { seed: hashParts(this.seed, "harness", "rules", change.key) });
    if (change.time !== undefined) this.timeSaid = true;
    out.landed.push(change.lines);
  }

  /** An asking write as its review card's item: an operation as an agent turn's is, a change as its card tells it (`cardLines`). */
  private cardItem(asked: Asked): StoredReviewItem {
    if ("op" in asked) {
      const op = asked.op;
      return { key: op.key, source: "agent", role: op.role, changeType: op.changeType, lines: op.cardLines ?? [], status: "open", op: op.op, agentId: op.agentId, connection: op.connectionId };
    }
    const { change } = asked.staged;
    return { key: change.key, source: "read", role: "read", changeType: String(change.changeType), lines: cardLines(this.rt, change, this.w.ctx), status: "open" };
  }

  /**
   * What asks first (Settings → Changes from the reply: Confirm). At a gate (Settings → Agents →
   * Review card), while the turn has a player's message to hold the card under and its reply isn't
   * written, the commit waits on the card: what the game master lets through lands now, the rest is
   * refused. Otherwise it waits for the reply's card, where Apply lands it after the turn.
   */
  private async askFirst(ctx: CommitCtx, ask: Asked[], out: HarnessCommit, signal: AbortSignal, closing: boolean, acts: LandedAct[]): Promise<void> {
    const linesOf = (a: Asked): string[] => ("op" in a ? a.op.lines : a.staged.change.lines);
    const later = (items: readonly Asked[]): void => {
      for (const a of items) {
        this.waiting.push(a);
        out.review.push(linesOf(a));
      }
    };
    const anchor = this.said.messageId;
    if (closing || this.finishing.signal.aborted || this.frame.settings.agents.review.placement !== "gate" || anchor === null) return later(ask);
    const key = `${anchor}:gate`;
    const done = Promise.withResolvers<void>();
    this.gate = { key, done };
    // The call ending, or the turn closing, ends the wait as an answer does.
    const ended = AbortSignal.any([signal, this.finishing.signal]);
    ended.addEventListener("abort", () => done.resolve(), { once: true });
    try {
      await this.review.make({ chatId: this.chatId, userId: this.userId, turn: key, messageId: anchor, placement: "gate", text: this.said.user, items: ask.map((a) => this.cardItem(a)) });
      this.rt.diag.rest({ chatId: this.chatId, userId: this.userId }, `Waiting for you to review ${ask.length === 1 ? "a change" : `${ask.length} changes`}…`);
      if (!ended.aborted) await done.promise;
    } finally {
      this.gate = null;
    }
    const answers = await this.cardAnswers(key);
    await this.review.drop(this.chatId, this.userId, key);
    const keyOf = (a: Asked): string => ("op" in a ? a.op.key : a.staged.change.key);
    const unanswered = ask.filter((a) => answers.get(keyOf(a)) === undefined || answers.get(keyOf(a)) === "open");
    // The reply was written while the card waited: what it held waits on the reply's card instead.
    if (this.finishing.signal.aborted && !signal.aborted) later(unanswered);
    else for (const a of unanswered) out.refused.push({ lines: linesOf(a), reason: this.text(WRITE_NOTE.cancelled) });
    const outcomes: { type: ChangeType; outcome: "accepted" | "rejected" }[] = [];
    for (const a of ask) {
      const answer = answers.get(keyOf(a));
      if (answer !== "approved" && answer !== "rejected") continue;
      if ("staged" in a && a.staged.change.changeType !== null) outcomes.push({ type: a.staged.change.changeType, outcome: answer === "approved" ? "accepted" : "rejected" });
      if (answer === "rejected") out.refused.push({ lines: linesOf(a), reason: this.text(HARNESS_NOTE.declined) });
      else if ("op" in a) this.commitOps(ctx, [{ ...a.op, approved: true }], out, [], acts);
      else this.commitChange({ ...a.staged, approved: true }, out, []);
    }
    // Counted toward what their types learn only once the turn's record is written (`finish`): a turn that is let go taught nothing.
    for (const one of outcomes) this.taught.push({ ...one, at: Date.now() });
  }

  /** How the game master answered each item of the gate's card, by its key. */
  private async cardAnswers(key: string): Promise<Map<string, string>> {
    const chip: StoredChip | undefined = (await this.rt.chips.list(this.chatId, this.userId)).find((c) => c.id === reviewChipId(key));
    const items = Array.isArray(chip?.payload.items) ? chip.payload.items : [];
    return new Map(items.flatMap((item): [string, string][] => (isRecord(item) && typeof item.key === "string" && typeof item.status === "string" ? [[item.key, item.status]] : [])));
  }

  /** Counts the gate's answers to harness tools' changes toward their types' learning, as a confirm chip's answer counts; the card counted its operations. A failure is logged and never undoes the answer. */
  private async learned(): Promise<void> {
    const outcomes = this.taught.splice(0);
    if (outcomes.length === 0) return;
    try {
      for (const { type, outcome, at } of outcomes) recordOutcome(this.frame.settings, this.learning, this.active, type, outcome, at);
      await this.rt.settings.saveLearning(this.userId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] a harness turn's reviewed changes weren't counted toward what their types learn (${error instanceof Error ? error.message : String(error)})`, this.userId);
    }
  }

  /** The gate's card was answered (`lre.review`, or its chip): the commit waiting on it goes on. False when this turn waits at no such gate. */
  answered(key: string): boolean {
    if (this.gate?.key !== key) return false;
    this.gate.done.resolve();
    return true;
  }

  // ---------------------------------------------------------------- the turn's time

  /**
   * The scene's default tick, for a turn no agent said the time of (Settings:
   * `agents.harness.defaultTick`): applied once nothing can say it any more, as the writer is asked
   * (so its sections tell the time the record will hold) or, at the latest, as the turn closes
   * (`final`). A turn that said its time, none included, moved its clock some other way, or plays
   * inside a fight whose rounds take no clock time, takes none. Before the turn closes, a time still
   * staged counts as said: it lands with the turn's last commit.
   */
  settleTime(final: boolean): void {
    if (this.tick !== null || this.continues || !this.frame.settings.agents.harness.defaultTick) return;
    if (this.timeSaid || this.own().some((e) => e.type === "clock")) return;
    if (!final && this.order.some((item) => "staged" in item && item.staged.change.time !== undefined)) return;
    if (fightHoldsClock(this.w.ctx)) return;
    const { minutes } = turnElapsed(this.w.world, this.w.state, null);
    if (minutes <= 0) return;
    advance(this.rt.registry, this.w, this.w.state.clock + minutes, { runSeed: this.run.runSeed, mode: "turn", cause: "tick" });
    stepTracks(this.rt.registry, this.w, hashParts(this.seed, "harness", "tick"));
    this.tick = minutes;
    this.snap();
  }

  // ---------------------------------------------------------------- the turn's end

  /**
   * The turn's reply is saved (HARNESS-SLICE3 step 8): what is still staged is committed, the turn's
   * time settled, and the turn takes nothing more. The events it leaves join the journal's planned
   * turn (a Continue's: its read).
   */
  async close(): Promise<LedgerEvent[]> {
    this.finishing.abort();
    await this.commit(null, this.stop.signal, true);
    this.settleTime(true);
    this.closed = true;
    return this.own();
  }

  /**
   * The turn's record is written: it says which role wrote which of its events, the kept files its
   * agents changed are made in their stores, what asks first goes on the reply's review card, and
   * what the gate's cards taught is counted.
   */
  async finish(core: LedgerCore, observed: readonly ChainMessage[], messageId: MessageId, swipeId: number): Promise<TurnClose> {
    try {
      const reply = core.chain(observed).find((m) => m.id === messageId);
      const rec = reply ? activeRecord(reply, core.journal.tombstones) : null;
      if (rec && this.committed.length > 0) {
        const agents = this.committed.flatMap(({ op, events }): RecAgent[] => {
          const from = rangeOf(rec.events, events);
          return from === null ? [] : [{ role: op.role, key: op.key, from, to: from + events.length }];
        });
        const refused = agents.length > 0 ? core.recordAgents(messageId, swipeId, [...(rec.agents ?? []), ...agents], observed) : null;
        if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${this.chatId}: the turn's record doesn't say which role wrote its events (${refused})`, this.userId);
      }
      if (Object.keys(this.landing).length > 0) await landKept(this.rt, this.chatId, this.userId, this.landing).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${this.chatId}: the turn's changes to the learned area and the global workspace weren't made (${error instanceof Error ? error.message : String(error)})`, this.userId));
      await this.card(messageId, swipeId);
      await this.learned();
      if (this.tick !== null) this.rt.diag.yielded(this.at, "read", "time", `no agent of the turn said how much time it took, so the scene's default tick passed: ${this.tick} ${this.tick === 1 ? "minute" : "minutes"}`, false);
    } finally {
      this.release();
    }
    return { defaultTick: this.tick };
  }

  /**
   * Makes what the turn's last commit landed of the world's document, now that the turn's record
   * is written, and waits for those an earlier commit's call is still making. Whoever waits for
   * the turn's record waits for this too, so a job reads the world as the turn left it. One that
   * fails is logged, and the turn stands without it.
   */
  async late(): Promise<void> {
    const out: HarnessCommit = { landed: [], review: [], refused: [] };
    const acts = this.left.splice(0);
    try {
      await this.makeActs(acts, out);
      await this.acting;
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${this.chatId}: what the turn's agents asked of the world's document wasn't all made (${error instanceof Error ? error.message : String(error)})`, this.userId);
    }
    if (acts.length > 0) this.rt.host.log("info", `[LumiRPEngine] turn ${this.generationId.slice(0, 8)}: of the world's document, ${out.landed.length} made and ${out.refused.length} refused once its reply was saved`, this.userId);
  }

  /** The reply's review card for what still asks first: an operation as an agent turn's, applied through the writer; a harness tool's change as a confirm chip the card holds, applied as a reply's own confirm is. */
  private async card(messageId: MessageId, swipeId: number): Promise<void> {
    if (this.waiting.length === 0) return;
    const items: StoredReviewItem[] = [];
    const chips: StoredChip[] = [];
    for (const asked of this.waiting) {
      if ("op" in asked) {
        items.push(this.cardItem(asked));
        continue;
      }
      const { change } = asked.staged;
      if (change.changeType === null) continue;
      const carded = cardedChange(this.rt, change, change.changeType, this.w.ctx, { id: `confirm:${messageId}:${this.generationId}:h${chips.length}`, messageId, swipeId, connection: this.active, detail: change.time !== undefined ? "The turn's agents say this much time passed. Apply it?" : "A change the turn's agents recorded. Apply it?" });
      chips.push(carded.chip);
      items.push(carded.item);
    }
    await this.rt.chips.add(this.chatId, this.userId, chips);
    await this.review.make({ chatId: this.chatId, userId: this.userId, turn: `${messageId}:${swipeId}`, messageId, swipeId, placement: "chips", text: this.said.user, items });
  }

  /** Lets the turn go with nothing landed (a stopped or failed run, a reply that never came): its staged writes, its committed state and its gate's card all go. */
  async drop(): Promise<void> {
    this.closed = true;
    const gate = this.gate;
    this.finishing.abort();
    this.stop.abort();
    this.order = [];
    this.left.length = 0;
    this.taught.length = 0;
    this.draft.clear();
    this.release();
    this.settled.resolve();
    if (gate) await this.review.drop(this.chatId, this.userId, gate.key).catch(() => undefined);
  }

  private release(): void {
    this.rt.blobs.release(this.userId, this.holder);
  }
}

/** Where `slice` sits in `events`, by value: the first run of events that equals it, or null. */
function rangeOf(events: readonly LedgerEvent[], slice: readonly LedgerEvent[]): number | null {
  if (slice.length === 0) return null;
  const want = slice.map((e) => JSON.stringify(e));
  for (let i = 0; i + want.length <= events.length; i++) if (want.every((w, j) => JSON.stringify(events[i + j]) === w)) return i;
  return null;
}
