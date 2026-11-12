// The harness engine: RPEngine's side of LumiAH (HARNESS-SLICE3). A chat whose engine is `harness`
// is played by the author, LumiAH's main agent for that chat, and the agents it starts. They decide
// everything a turn needs by calling tools, and the author writes the reply itself. RPEngine
// supplies those tools, the agents' definitions, the skills and the rules of the world, and makes no
// model call of its own: every model call is an agent's, in LumiAH's runtime (its DESIGN §25). A
// chat the engine plays runs only there (`ChatClaim.place`): no built-in way plays it, and while
// the runtime is down the chat plays nothing and says why.
//
// This is what LumiAH is given, to the shapes of its own boundary (`shapes.ts`):
// - `extension`: what an extension that builds LumiAH into itself supplies (`HarnessExtension`): its
//   definitions, what it claims of a chat, which model an agent runs on, and the run's milestones.
//   Each is told which user it is for, and answers for that user: nothing here guesses one.
// - `tools`: the tools that run in the extension (`ToolsPort`): listed for a chat, and run for a call
//   with a `ToolEnv` built for that call; told the user too, where the caller serves more than one.
//
// And what the ledger asks of the engine for a chat the harness plays (`HarnessHooks`): whether it
// plays the chat, whether its runtime can take a generation, and the turn's commit when its reply is
// saved or stopped.
//
// One turn, as the ledger and LumiAH tell it:
// 1. `GENERATION_STARTED` opens the pending turn, as for any engine. The guard asks whether the
//    harness can play the generation in its runtime (`refused`): one that isn't going there, or that
//    no runtime can take now, is stopped, and the chat says why and what to do. Nothing of the world
//    goes into the prompt: the author is shown only the player's newest message (`ChatClaim.request`).
// 2. `runBegan` opens the engine's side of the turn (`OpenTurn`): what it runs on, its staged writes
//    and its working state, on the generation's own pending turn, which takes the opening's
//    bookkeeping as its plan. Nothing is simulated: no action is read, no time passes, no one acts.
// 3. Each tool call runs with the calling agent's view, writer and tier (`OpenTurn.env`), once the
//    one gate every call enters by has seen that the tool is the caller's to call (`toolRefusal`).
// 4. The author writes the reply: each passage it releases, in order (`reply_write`), or a character's
//    answer it hands the stream to (`delegate` with `to_reply`). LumiAH's runtime streams them to
//    Lumiverse as one reply, and no writer writes any of it (`ChatClaim.reply`). The engine reads
//    nothing out of the reply.
// 5. The reply ends. Saved whole (`GENERATION_ENDED`): what is still staged is committed, what the
//    turn landed joins its planned events, the core commits the turn, and its record takes LumiAH's
//    own record of the turn. Stopped once something was released: the turn keeps what it had
//    committed, and its record says the reply was stopped. A turn has one record. A reply stopped
//    with nothing released, failed or empty, or a run that failed, leaves nothing: no record,
//    nothing staged, nothing half-written.
// 6. A job the turn's agents started writes through the ledger's path for writes outside a turn,
//    tied to the turn's record, until that record leaves the chat's path (`jobs.ts`).
//
// Nothing between a run's beginning and its reply's end waits on a clock: the turn stays open until
// its generation ends, is stopped, or another starts on the chat.

import type { RoleTier } from "../../shared/agent-roles";
import { defaultAgentSettings, type NewestMessage, type SovereignHand } from "../../shared/agent-settings";
import { HARNESS_AGENT, HARNESS_AGENT_IDS, HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TEXT } from "../../shared/harness-texts";
import { PREPARE_PATH } from "../../shared/harness-texts-prepare";
import { hashParts } from "../../shared/hash";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { LedgerEvent, Rec, RecHarness } from "../../shared/ledger";
import { MINDS_EVENTS } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
import type { UserSettings } from "../../shared/settings";
import type { WorldDoc } from "../../shared/world";
import { blankWorld } from "../../engine/authoring";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore, TurnModel } from "../../engine/ledger/journal";
import type { WorldState } from "../../engine/state";
import { activeRecord, activeText, ownMessage } from "../../engine/ledger/path";
import { turnStart } from "../../engine/turn";
import { Working } from "../../engine/working";
import { readSlice } from "../../packs/minds/core/state";
import type { Review } from "../agents/review";
import { HARNESS_LISTED, harnessTools, runHarnessTool } from "../agents/tools/harness";
import { type HarnessFiles, worldBuild } from "../agents/tools/harness-ports";
import type { HarnessTurn } from "../agents/tools/harness-turn";
import { outsideReader } from "../agents/tools/read-view";
import type { ToolEnv } from "../agents/tools/registry";
import { type ChatHead, chatHead, keptFiles } from "../agents/tools/workspace";
import { type ChatEngine, type ChatKnowledgePrefs, knowledgeOn, narratorView } from "../chat-knowledge-prefs";
import type { HarnessHooks, TurnContext } from "../ledger-io";
import { toChain } from "../ledger-io";
import { knowledgeSwitch, postMindsInput, postOpening } from "../minds";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { inTurn, type TurnFrame } from "../turn-frame";
import { clockMinutes } from "../view";
import { harnessDefinitions, harnessRole, worldGuidance } from "./definitions";
import { LUMIAH_TOOL } from "./definitions/lumiah";
import { jobEnv } from "./jobs";
import { type AnchorRow, anchorsOf, findTurn, noPartOf, recHarnessOf, unplayedOf } from "./record";
import type { AgentModelAsk, AgentModelChoice, ChatClaim, ClaimAsk, DefinitionsAsk, ExtensionDefinitions, HarnessExtension, HeldTools, JobView, ReleaseVerdict, RemoteTool, RemoteToolCall, ReplyRelease, ReplyWritten, RunBegan, RunEnded, StorySetting, ToolsPort } from "./shapes";
import { Cast, type Ceiling, closedAnswer, OpenTurn, reach, type Standing, standingOf, toolRefusal, type TurnCall } from "./turn";
import { chooseAgentModel } from "../../shared/story-models";
import { shapeNotebook } from "../story/notebook";
import { directLineGuidance, narrationGuidance, releaseGate, releaseNoted } from "../story/narration";
import { authorOpening } from "../story/opening";
import { prepareEnv } from "../story/prepare";
import { presetParts, readStoryPreset, type StoryPresetRead, type StoryReader } from "../story/preset";

/** Sovereign Hand as the harness's settings have it (`agents.harness.sovereignHand`), as the claim's word on whose messages are the chat's story. */
const SOVEREIGN_FROM: Readonly<Record<SovereignHand, StorySetting["from"]>> = { follow: "lumiverse", on: "replies", off: "everyone" };

/** What the author is given of the player's newest message under Sovereign Hand (`agents.harness.newestMessage`), as the claim's word. */
const NEWEST_GIVEN: Readonly<Record<NewestMessage, StorySetting["newest"]>> = { direction: "directive", leave_out: "leave_out" };

/** The family of each tool the engine lists, by its name. */
const FAMILY: ReadonlyMap<string, string> = new Map(HARNESS_LISTED.map((t) => [t.name, t.family]));

/** The one tool outside a person's own mind that a character's agent may call: writing a beat of its own act (`beat_write`, which holds it to its own). */
const BEAT_WRITE = "beat_write";

/** Which reader of the chat's preset each definition is (`presetParts`): the author, a person, the game master, the narrator. A definition not here reads no part of it. */
const PRESET_READER: Readonly<Record<string, StoryReader>> = { [HARNESS_AGENT.author]: "author", [HARNESS_AGENT.character]: "character", [HARNESS_AGENT.gm]: "gm", [HARNESS_AGENT.narrator]: "narrator" };

/**
 * What the engine adds to its definitions' instructions for one chat, by definition id, in order:
 * the definition's part of the chat's preset (`presetParts`, by reader; `read`: the preset as it was
 * read, null where it couldn't be, its macros resolved; the engine's own texts alone where the preset
 * gives that reader nothing); how the story's narration is set (the author: how a moment is
 * narrated, `narrationGuidance`; a person: how it speaks on the direct line, `directLineGuidance`,
 * nothing where every moment is narrated); and the author's opening (`authorOpening`; null where it
 * couldn't be read): the moment as it stands, the drafts that need it now and what the prepared
 * start still lacks, which no other agent of the chat reads. Only what holds text: a definition
 * given nothing has no entry.
 */
export function chatAdditions(input: { read: StoryPresetRead | null; settings: Pick<UserSettings, "narration" | "prompts">; opening: string | null }): ReadonlyMap<string, readonly string[]> {
  const { read, settings, opening } = input;
  const preset = read === null ? null : presetParts(read, settings.prompts.texts);
  const ends: Readonly<Record<string, readonly (string | null)[]>> = { [HARNESS_AGENT.author]: [narrationGuidance(settings), opening], [HARNESS_AGENT.character]: [directLineGuidance(read, settings)] };
  const added = new Map<string, readonly string[]>();
  for (const id of HARNESS_AGENT_IDS) {
    const reader = PRESET_READER[id];
    const more = [reader === undefined || preset === null ? "" : preset[reader], ...(ends[id] ?? [])].filter((part): part is string => part !== null && part.trim() !== "");
    if (more.length > 0) added.set(id, more);
  }
  return added;
}

/** Why the harness can't be chosen in a build that doesn't carry LumiAH, and what to do. The chat page shows it as it stands, so it is no model's text. */
const NOT_BUILT_IN = "This build of LumiRPEngine doesn't include the harness yet. Update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine), then choose Harness here.";

/** Why a reply of a chat that was just set to the runtime didn't go there: the generation was already on its way to the chat's old connection. */
const SET_JUST_NOW = "This chat was set to play in LumiRPEngine's runtime just now, so this reply didn't go there. The next one will.";

/** How many tools a line of the words below names before it says how many more there are. */
const TOOLS_NAMED = 8;

/** Tools as the words below name them: "a", "a and b", "a, b and c", the rest past `TOOLS_NAMED` as how many more. */
function toolList(tools: readonly string[]): string {
  const named = tools.length > TOOLS_NAMED ? [...tools.slice(0, TOOLS_NAMED), `${tools.length - TOOLS_NAMED} more`] : [...tools];
  return named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : (named[0] ?? "");
}

/** Why a chat plays no turn while an agent of the cast can't use a tool it is given, said before a line for each such agent. The chat page shows it as it stands, so it is no model's text. */
const UNHELD = "This chat plays no turn while one of LumiRPEngine's agents can't use a tool it needs.";

/** An agent's tools the user switched off, and where to switch them on. */
const switchedOff = (agent: string, tools: readonly string[]): string =>
  tools.length === 1 ? `${agent} can't use ${toolList(tools)}: it is switched off. On the Tools page of the Harness tab, switch it on.` : `${agent} can't use ${toolList(tools)}: they are switched off. On the Tools page of the Harness tab, switch them on.`;

/** An agent's tools that no tool here answers to, and how to give it LumiRPEngine's own again. */
const notHere = (agent: string, tools: readonly string[]): string => `${agent} is given ${toolList(tools)}, which ${tools.length === 1 ? "isn't a tool" : "aren't tools"} here. On the Agents page of the Harness tab, reset ${agent} to LumiRPEngine's own.`;

type PlanInput = Parameters<TurnModel["plan"]>[0];
type ReadInput = Parameters<TurnModel["read"]>[0];

/**
 * The engine's tools as LumiAH lists and calls them (`ToolsPort`), each also told whose the call is
 * where the caller knows: LumiAH's backend serves every user of a Lumiverse and names the one it
 * asks for last, where its core's own port serves one user and names none.
 */
export interface EngineTools extends ToolsPort {
  list(chatId: string, userId?: string): Promise<RemoteTool[]>;
  call(call: RemoteToolCall, signal: AbortSignal, userId?: string): Promise<{ text: string; error?: boolean }>;
}

/** An engine choice that can't be made now, in words the page shows as they stand: what is in the way, and what to do. */
export class EngineRefused extends Error {
  constructor(
    readonly code: "unavailable" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "EngineRefused";
  }
}

/**
 * LumiAH's core as its own pages reach it, where LumiAH is mounted: one thing asked of it for a
 * user, done where the chat it is about runs (built in, or in the user's runtime). The ops are
 * LumiAH's (`sides.list`, `sides.start`, `sides.turns`, `sides.remove`, `side.send`,
 * `workspace.list`, `workspace.read`, `workspace.write`, …), each taking and giving plain JSON; a
 * refusal rejects with LumiAH's own words. The GM assistant of a harness chat talks through it.
 */
export interface HarnessCore {
  ask(userId: UserId, op: string, args: JsonObject, where?: { chat?: ChatId | null; side?: string; job?: string }): Promise<JsonValue>;
  /** Stops a side session's turn or a job's run that runs built in; false when it isn't one under way here. */
  stop(userId: UserId, run: string, why: string): boolean;
  /** The side sessions' turns and jobs' runs under way built in, by their ids. */
  running(userId: UserId): string[];
  /**
   * What the latest run LumiAH's live view holds of a stream has spent: a job's (the stream is the
   * job's id, and its count runs over every run of the job) or a chat's reply turns' (the chat's
   * id). Null where the live view holds no run of it, or one that made no model call yet.
   */
  spent?(userId: UserId, stream: string): RunSpent | null;
}

/** What a run has spent, as LumiAH counts it: its tokens in and out, its model calls, and what its latest call weighed, in and out. */
export interface RunSpent {
  in: number;
  out: number;
  calls: number;
  last: number;
}

/**
 * What a tool call of a side session's turn runs with, from whoever started that turn: the call's
 * env, and the writer tier the caller is let (what the call's gate holds the tool's own needs to);
 * null for a turn that isn't theirs, whose calls read the chat and write nothing. `answered`: told
 * once how the call was answered, whatever answered it: the tool, the gate's refusal, or that the
 * engine couldn't run it.
 */
export type SideEnvOf = (input: { call: RemoteToolCall; userId: UserId; signal: AbortSignal }) => Promise<{ env: ToolEnv; tier: RoleTier; answered?: (out: { text: string; error?: boolean }) => void } | null>;

/**
 * LumiAH's own tools that read World Info. In a chat the engine plays, the world's lore is the
 * engine's to read, under its secrets rule: those of these names the engine has a tool for are
 * replaced by it (LumiAH's rule for a chat an extension claims), and the rest are withdrawn.
 */
const LUMIAH_LORE: readonly string[] = [LUMIAH_TOOL.loreIndex, LUMIAH_TOOL.loreSearch, LUMIAH_TOOL.loreGrep, LUMIAH_TOOL.loreRead, LUMIAH_TOOL.activeLore, LUMIAH_TOOL.loreRelated, LUMIAH_TOOL.loreAbout];

/** LumiAH's lore tools the claim withdraws in a chat the engine plays: those the engine has no tool of the same name for. No agent there is given them. */
export const LUMIAH_WITHDRAWN: readonly string[] = LUMIAH_LORE.filter((name) => !FAMILY.has(name));

/** A run as its calls are served once no turn takes them: a job's, or what an agent of a turn still calls after its reply. Its agents are the run's own, from its first call to its last (`Cast`). `directed`: the claim's word for the run, that the player directs the story (`HarnessTurn.directed`). */
interface SideRun {
  chatId: ChatId;
  userId: UserId;
  cast: Cast;
  staged: Map<string, "auto" | "confirm">;
  directed: boolean;
  /** The log was told that this run is tied to no reply the engine knows. */
  warned?: boolean;
}

/** What one call runs with once it has passed its gate, and where its caller stands for that gate. */
interface Served {
  /** Built as the tool runs, inside the turn's frame where the call is a turn's. */
  env(): ToolEnv;
  standing: Standing;
  frame: TurnFrame | null;
  answered?: (out: { text: string; error?: boolean }) => void;
  /** A job the engine can tie to no reply: it reads the chat as it stands, and what it would change is answered so. */
  noReply?: true;
}

/** What a turn left for its commit, between `beforeCommit` and `afterCommit`. */
interface Closing {
  /** A Continue's landed events, which its read records. */
  events: LedgerEvent[];
  /** Whether the core read them. */
  read: boolean;
}

export class HarnessEngine implements HarnessHooks {
  /** The open turns, by their generation's id: LumiAH's id of a run that answers a generation. */
  private readonly turns = new Map<string, OpenTurn>();
  /** Each turn being opened: a call that comes before its opening is done waits for it. */
  private readonly opening = new Map<string, Promise<void>>();
  /** A generation whose run began with nothing to stand on (an earlier message edited, waiting on Keep or Discard): its reply commits as the core commits an unplanned turn. */
  private readonly blank = new Map<string, string>();
  /** Why a run that failed or was stopped left nothing, by its generation's id. */
  private readonly failed = new Map<string, string>();
  /** LumiAH's record of a turn whose run ended before its reply was committed. */
  private readonly records = new Map<string, JsonObject>();
  /** The turns that committed or were let go, and whose chat each was: a later call of the same run is no turn's. `settled`: a committed turn's, until what its last commit asked of the world's document is made. */
  private readonly over = new Map<string, { chatId: ChatId; userId: UserId; committed: boolean; settled?: Promise<void> }>();
  /** The runs that aren't a generation's own turn, and each committed turn's own run for what its agents still call. */
  private readonly sides = new Map<string, SideRun>();
  /** Each job the engine was told of, by its id: the turn it belongs to (LumiAH's `JobView.basis`; null for one the user started), who started it where LumiAH said (the agent, by its handle in the run it was of), the job that run was, if it was a job's, whether the next turn waits for it, and the plan file its objective names (`author/prepare.md` for the story's prepared start). */
  private readonly jobs = new Map<string, { basis: string | null; by: string | null; parent: string | null; due: NonNullable<JobView["due"]> | null; plan: string | null }>();
  /** Whose each chat is, as its guard last said. */
  private readonly owners = new Map<ChatId, UserId>();
  /** The opening a chat's core is planning now, and the consequences its commit reads: set around the core's own synchronous steps, inside the chat's queue. */
  private readonly plans = new Map<ChatId, (input: PlanInput) => LedgerEvent[]>();
  private readonly reads = new Map<ChatId, (input: ReadInput) => LedgerEvent[]>();
  private readonly closing = new Map<string, Closing>();
  /** The side sessions' turns under way, by the turn's id: a conversation with an agent that is no reply and no job. */
  private readonly talks = new Map<string, { chatId: ChatId; userId: UserId }>();
  /** The harness chats LumiAH couldn't be set on in its runtime yet (no runtime was ever set up, another harness answers the chat), whose each is and LumiAH's words for why: set when the user's runtime changes (`runtimeChanged`) or a reply of the chat starts (`refused`). */
  private readonly unseated = new Map<ChatId, { userId: UserId; why: string }>();
  /** Whether the player directs the story in each chat, as its claim last said (Sovereign Hand): the claim is asked at the start of every run, just before the run begins. */
  private readonly directed = new Map<ChatId, boolean>();

  /**
   * How many of each thing the engine keeps about runs that are over, or not its own to bound (a
   * turn that closed or was let go, a job's run and the turn it belongs to, the agents of each,
   * whose a chat is): the oldest goes first. Bookkeeping, not a limit on any agent: a run forgotten
   * only has its late calls answered that no turn is open, and nothing here holds a turn's work
   * (open turns are bounded by Settings → Agents → Budgets, Agent turns under way). These tables
   * are the engine's, with every user's runs in them together: an entry is bounded by the setting
   * (`agents.harness.runsRemembered`) of the user whose run the engine last heard begin (`claim`),
   * which need not be the entry's own.
   */
  private remembered = defaultAgentSettings().harness.runsRemembered;

  private remember<K, V>(map: Map<K, V>, key: K, value: V): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.remembered) map.delete(map.keys().next().value as K);
  }

  /**
   * LumiAH's own switch for a chat: on, in LumiAH's runtime, when the chat is switched to the
   * harness, and off when it is switched away (HARNESS-SLICE3: "One control in the UI, not two").
   * Rejects in LumiAH's own words where the chat can't be set on now. Whoever mounts LumiAH sets
   * it. Until then nothing can play a harness chat, so none can be chosen (`blocked`).
   */
  pin: ((chatId: ChatId, userId: UserId, harness: boolean) => Promise<void>) | null = null;

  /**
   * Why a reply of a chat (`chatId`; null: of any of the user's chats) can't be played in LumiAH's
   * runtime now, in plain words that say what to do: a permission it needs isn't granted, no runtime
   * is linked, its link is refused, it isn't set up to answer chats yet. Null where it can. Whoever
   * mounts LumiAH sets it, from what LumiAH's own backend reports.
   */
  runtime: ((userId: UserId, chatId: ChatId | null) => Promise<string | null>) | null = null;

  /**
   * Whether a reply of a chat made on `connectionId` goes to LumiAH's runtime: LumiAH is on for the
   * chat there, and that connection is the runtime's own for it. Whoever mounts LumiAH sets it.
   */
  seated: ((chatId: ChatId, userId: UserId, connectionId: string | null) => Promise<boolean>) | null = null;

  /**
   * Each agent that can run in a chat, as LumiAH holds it there: each tool its definition names
   * that it can't use, with why (LumiAH's `agents.held`, asked where the chat runs). Whoever mounts
   * LumiAH sets it; without it no turn is held to its agents' tools.
   */
  held: ((userId: UserId, chatId: ChatId) => Promise<readonly HeldTools[]>) | null = null;

  /**
   * Why the harness can't play this chat of the user's now, and what to do; null where it can: why
   * it can't play any of the user's chats, else LumiAH's words for this one while it can't be set to
   * the runtime (another harness answers it, say), else an agent of the cast that can't use a tool it
   * is given there (`unheld`). A chat that couldn't be set before is set again here, once nothing
   * keeps the user's runtime from every chat (a permission granted since): the player has nothing
   * more to press. GM → This chat → Engine says it under the switch and Play on its first screen,
   * and the guard stops a harness chat's generations with the same words (`refused`): no other
   * engine plays one.
   */
  async blocked(userId: UserId, chatId: ChatId): Promise<string | null> {
    if (this.pin === null || this.runtime === null) return NOT_BUILT_IN;
    const all = await this.runtime(userId, null);
    if (all !== null) return all;
    const unset = this.unseated.get(chatId)?.userId === userId ? await this.seat(chatId, userId) : null;
    if (unset !== null) return unset;
    return (await this.rt.chatKnowledge.engine(chatId, userId)) === "harness" ? this.unheld(userId, chatId) : null;
  }

  /**
   * Why the cast can't play a chat of the user's now: an agent of the engine's that can't use a tool
   * its definition names there, because the user switched the tool off or no tool of that name is
   * there, in words that name each such agent and its tools and say what to do. Null where each can
   * use all it is given. A tool the engine's own claim withdraws in the chat is no fault: the engine
   * leaves it out on purpose. Null too where LumiAH can't say (the log says why): the turn goes on,
   * and an agent short of a tool is told so when it calls it.
   */
  private async unheld(userId: UserId, chatId: ChatId): Promise<string | null> {
    if (this.held === null) return null;
    let agents: readonly HeldTools[];
    try {
      agents = await this.held(userId, chatId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: LumiAH didn't say which tools its agents can use here (${error instanceof Error ? error.message : String(error)})`, userId);
      return null;
    }
    const cast: readonly string[] = HARNESS_AGENT_IDS;
    const lines = agents
      .filter((agent) => cast.includes(agent.id))
      .flatMap((agent) => {
        const off = agent.cannot.filter((c) => c.why === "off").map((c) => c.tool);
        const unknown = agent.cannot.filter((c) => c.why === "unknown").map((c) => c.tool);
        return [...(off.length > 0 ? [switchedOff(agent.name, off)] : []), ...(unknown.length > 0 ? [notHere(agent.name, unknown)] : [])];
      });
    return lines.length === 0 ? null : [UNHELD, ...lines].join(" ");
  }

  /** Whose a chat is, where LumiAH's backend knows and neither the call nor the ledger says. Whoever mounts LumiAH may set it. */
  owner: ((chatId: ChatId) => Promise<UserId | null>) | null = null;

  /** The chat's area of LumiAH's workspace, as the engine's tools reach it (`ToolEnv.files`). Whoever mounts LumiAH sets it; without it those tools say there is no workspace. */
  files: ((at: { chatId: ChatId; userId: UserId }) => HarnessFiles) | null = null;

  /** LumiAH's core as its pages reach it (`HarnessCore`). Whoever mounts LumiAH sets it. */
  core: HarnessCore | null = null;

  /** What the calls of a side session's turn run with, where someone has more to give than a read of the chat (the GM assistant: its own writer). */
  sideEnv: SideEnvOf | null = null;

  /** A side session's turn began, or ended: whoever follows one (the GM assistant's page) hears here. */
  sideBegan: ((run: RunBegan) => void) | null = null;
  sideEnded: ((run: RunEnded) => void) | null = null;

  /** LumiAH's record on a reply of a chat was written or changed in the ledger: whoever mounts LumiAH has it read the chat's records again, since Lumiverse tells nobody of a write that isn't its own. */
  recorded: ((chatId: ChatId) => void) | null = null;

  readonly extension: HarnessExtension;
  readonly tools: EngineTools;

  constructor(
    private readonly rt: Runtime,
    private readonly review: Review,
  ) {
    this.extension = {
      name: "LumiRPEngine",
      definitions: (ask) => this.definitions(ask),
      claim: (ask) => this.claim(ask),
      runBegan: (run) => this.runBegan(run),
      agentModel: (ask) => this.agentModel(ask),
      releasing: (release) => this.releasing(release),
      released: (release) => this.released(release),
      replyWritten: (reply) => this.replyWritten(reply),
      runEnded: (run) => this.runEnded(run),
    };
    this.tools = { list: (chatId, userId) => this.list(chatId, userId), call: (call, signal, userId) => this.call(call, signal, userId) };
  }

  // ---------------------------------------------------------------- whose chat, which engine

  /**
   * Whose a chat is: the user LumiAH says the call is for. Where a caller names none (the core's own
   * tools port serves one user and says no name), whose the chat's guard last said, the open ledger
   * has, or LumiAH's backend knows it to be. A user a caller named is never kept for a later call:
   * only what Lumiverse's own events said of a chat is.
   */
  private async userOf(chatId: ChatId, told = ""): Promise<UserId | null> {
    if (told !== "") return told;
    const known = this.owners.get(chatId) ?? this.rt.ledger.ownerOf(chatId) ?? (await this.owner?.(chatId)) ?? null;
    if (known !== null) this.remember(this.owners, chatId, known);
    return known;
  }

  /** `HarnessHooks.plays`: the chat's own choice, as it stands. Whether the harness can play it now is the guard's to ask (`refused`). */
  async plays(chatId: ChatId, userId: UserId): Promise<boolean> {
    this.remember(this.owners, chatId, userId);
    return (await this.rt.chatKnowledge.engine(chatId, userId)) === "harness";
  }

  /**
   * `HarnessHooks.refused`: why the harness can't play this generation of a chat it plays, in plain
   * words that say what to do; null where it can. It plays a turn only in LumiAH's runtime, where
   * the author writes the reply itself: the generation must be on its way there (`seated`: LumiAH is
   * on for the chat in the runtime, and the generation's connection is the runtime's), and the
   * runtime must be able to take it now (`runtime`). A chat not yet set to the runtime (a Branch
   * copies its engine with it; one chosen before any runtime was set up) is set now. A generation
   * already on the runtime's connection then goes there: a Branch copies the chat's connection too,
   * so its first reply plays. One on another connection is stopped, and the next reply goes there.
   * A chat that can't be set reaches no runtime, so what keeps the user's runtime from every chat is
   * said first, then LumiAH's words for this one. Where the runtime can take it, the turn still
   * starts only once every agent of the cast can use each tool it is given there (`unheld`).
   */
  async refused(input: { chatId: ChatId; userId: UserId; connectionId: string | null }): Promise<string | null> {
    const { chatId, userId, connectionId } = input;
    this.remember(this.owners, chatId, userId);
    if (this.pin === null || this.runtime === null || this.seated === null) return NOT_BUILT_IN;
    let seated = await this.seated(chatId, userId, connectionId);
    const unset = seated ? null : await this.seat(chatId, userId);
    if (unset !== null) return (await this.runtime(userId, null)) ?? unset;
    if (!seated) seated = await this.seated(chatId, userId, connectionId);
    return (await this.runtime(userId, chatId)) ?? (seated ? await this.unheld(userId, chatId) : SET_JUST_NOW);
  }

  /**
   * Sets a chat the harness plays on in LumiAH's runtime (`pin`): null once it is, else LumiAH's
   * words for why it can't be now (no runtime was ever set up, another harness answers the chat, a
   * permission isn't granted). One that can't be set now is set again when the user's runtime
   * changes (`runtimeChanged`), and its pages say why it doesn't play meanwhile.
   */
  private async seat(chatId: ChatId, userId: UserId): Promise<string | null> {
    try {
      await this.pin?.(chatId, userId, true);
      this.unseated.delete(chatId);
      return null;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.remember(this.unseated, chatId, { userId, why });
      this.rt.host.log("info", `[LumiRPEngine] chat ${chatId} plays on the harness, and isn't set to its runtime yet: ${why}`, userId);
      return why;
    }
  }

  /** The user's runtime linked, dropped, was refused or got its connection (LumiAH's `onRuntime`): each harness chat of theirs that couldn't be set to it yet is set now, and its pages read again. */
  async runtimeChanged(userId: UserId): Promise<void> {
    for (const [chatId, { userId: owner }] of [...this.unseated]) {
      if (owner !== userId) continue;
      if ((await this.rt.chatKnowledge.engine(chatId, userId)) !== "harness") this.unseated.delete(chatId);
      else if ((await this.seat(chatId, userId)) === null) this.rt.push.changed(chatId, userId);
    }
  }

  /**
   * A page opened a chat (its hello): one the harness plays that isn't set to its runtime yet (one
   * from before an update, a Branch) is set now, before any reply is asked of it, so none is lost
   * to setting it. Where it can't be set yet nothing changes, and Play says why (`blocked`). The
   * guard still sets a chat whose reply comes first (`refused`).
   */
  async opened(chatId: ChatId, userId: UserId): Promise<void> {
    if (this.pin === null || this.seated === null) return;
    this.remember(this.owners, chatId, userId);
    try {
      if ((await this.rt.chatKnowledge.engine(chatId, userId)) !== "harness" || (await this.seated(chatId, userId, null))) return;
      if ((await this.seat(chatId, userId)) === null) this.rt.push.changed(chatId, userId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId} wasn't set to its runtime as it opened: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }

  /**
   * Chooses the engine that plays a chat (GM → This chat → Engine), whole: LumiAH's own switch for
   * the chat follows the choice, so the two never disagree and the player has one control
   * (HARNESS-SLICE3). The harness plays a chat only in LumiAH's runtime, so choosing it sets the
   * chat there too (`seat`). Until it can play (no runtime is linked, a permission isn't granted),
   * the chat plays nothing and its pages say why and what to do: no other engine stands in. A turn
   * finishes on the engine it started on: while one waits at a gate, what it kept for its resume
   * would be lost, so the switch waits for it. Refused (`EngineRefused`) in words that say what to do.
   */
  async choose(chatId: ChatId, userId: UserId, engine: ChatEngine): Promise<ChatKnowledgePrefs> {
    this.remember(this.owners, chatId, userId);
    if (engine === "harness" && this.pin === null) throw new EngineRefused("unavailable", `${NOT_BUILT_IN} This chat stays on the engine it has.`);
    if (engine !== (await this.rt.chatKnowledge.engine(chatId, userId))) {
      const waiting = await this.rt.gateWaiting(chatId, userId);
      if (waiting !== null) throw new EngineRefused("conflict", `This chat's turn is waiting on ${waiting}. Answer or cancel it before you switch the engine: a turn finishes on the engine it started on.`);
    }
    const prefs = await this.rt.chatKnowledge.set(chatId, userId, { engine: engine === "classic" ? null : engine });
    // A turn under way finishes on the engine and choices it started with (`TurnFrame`): the change applies from the chat's next turn.
    this.rt.push.changed(chatId, userId);
    if (engine === "harness") await this.seat(chatId, userId);
    else {
      this.unseated.delete(chatId);
      await this.pin?.(chatId, userId, false);
    }
    return prefs;
  }

  /**
   * A chat has just been given its world: it plays on the harness from its first turn, in LumiAH's
   * runtime, with nothing more to choose. Where the harness can't play it yet, it plays nothing until
   * it can, and its pages say why: no quieter engine stands in. The chats made before keep the
   * engine they had: only a chat's first attach comes here.
   */
  async adopt(chatId: ChatId, userId: UserId): Promise<void> {
    try {
      await this.choose(chatId, userId, "harness");
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the new world chat couldn't be set to the harness (${error instanceof Error ? error.message : String(error)})`, userId);
    }
  }

  // ---------------------------------------------------------------- what LumiAH is given

  /**
   * The engine's agent definitions and skills for a user, in their own words where they wrote them;
   * the shipped ones where the call names no user. For a run about a chat, each definition's
   * instructions end with what the engine adds for that chat (`chatAdditions`): its part of the
   * chat's preset, how the story's narration is set, and the author's opening. A preset or an
   * opening that can't be read gives nothing, and the log says why: the run goes on with the rest.
   */
  private async definitions(ask: DefinitionsAsk): Promise<ExtensionDefinitions> {
    if (ask.userId === "") return harnessDefinitions({});
    const userId = ask.userId;
    const settings = await this.rt.settings.get(userId);
    const defs = harnessDefinitions(settings.prompts.texts);
    if (ask.chatId === null) return defs;
    const chatId = ask.chatId;
    const unread = (what: string) => (error: unknown) => {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: ${what} (${error instanceof Error ? error.message : String(error)})`, userId);
      return null;
    };
    const [read, opening] = await Promise.all([
      readStoryPreset(this.rt.host, chatId, userId, settings.storyPreset).catch(unread("the preset's parts for the agents weren't read, so they run on the engine's own texts")),
      authorOpening(this.rt, { chatId, userId }, this.files?.({ chatId, userId }) ?? null, settings).catch(unread("the author's opening wasn't read: the moment, the drafts due and the story's preparation")),
    ]);
    const added = chatAdditions({ read, settings, opening });
    const agents = defs.agents.map((agent) => {
      const more = added.get(agent.id);
      return more === undefined ? agent : { ...agent, instructions: [agent.instructions, ...more].join("\n\n") };
    });
    return { ...defs, agents };
  }

  /**
   * What the engine supplies for a chat: for a world chat on the harness, its author as the main
   * agent and the world's guidance, and its word that the chat plays only in LumiAH's runtime
   * (`place`), that the author is shown only the player's newest message of what Lumiverse
   * assembled (`request`), and that the reply is only what the chat's agents release (`reply`).
   * Nothing for any other chat, which LumiAH answers itself. LumiAH's own lore tools give way to
   * the engine's there, and those the engine has none of its own name for are withdrawn
   * (`LUMIAH_WITHDRAWN`).
   *
   * Three things head the guidance when they apply. Guidance heads an agent's instructions, so each
   * is the first thing the run's author reads, and a level cut for its length (LumiAH's setting)
   * keeps it:
   * - The run's story is the model's replies alone (Sovereign Hand, as the claim's own word on the
   *   story and what holds without it resolve, `storyHolds`): the player's message is a direction,
   *   which the author carries out through its tools.
   * - The turn before was still being recorded when this run began, and the wait for it ran out
   *   (Settings: `agents.harness.commitWaitMs`). A turn's tail never holds the player, so the run
   *   goes on, and its author knows the last turn's changes may not all be in.
   * - The reply the turn follows stands with no turn played: nothing it tells is in the world.
   */
  private async claim(ask: ClaimAsk): Promise<ChatClaim | null> {
    const userId = await this.userOf(ask.chatId, ask.userId);
    if (!userId || (await this.rt.chatKnowledge.engine(ask.chatId, userId)) !== "harness") return null;
    const settings = await this.rt.settings.get(userId);
    this.remembered = settings.agents.harness.runsRemembered;
    const texts = settings.prompts.texts;
    const whole = await this.caughtUp(ask.chatId, userId, settings.agents.harness.commitWaitMs);
    const head = await chatHead(this.rt, ask.chatId, userId);
    if (!head) return null;
    const narrator = narratorView(await this.rt.chatKnowledge.get(ask.chatId, userId), head.world, settings);
    const guidance = worldGuidance({ world: head.world, state: head.state, texts, narrator });
    const unplayed = unplayedBefore(lastReply(head), texts);
    // The claim's word on what counts as the chat's story: whose messages are, as Sovereign Hand is set for the harness, and what of the newest the author is given. Whether a hidden message is read is LumiAH's own setting.
    const story: Partial<StorySetting> = { from: SOVEREIGN_FROM[settings.agents.harness.sovereignHand], newest: NEWEST_GIVEN[settings.agents.harness.newestMessage] };
    // What the run reads as its story is known now, before the guidance is read: the claim's word stands over what holds without it, and following Lumiverse is its Sovereign Hand switch as LumiAH read it (off where Lumiverse doesn't say). The run that begins next is told it too (`HarnessTurn.directed`).
    const directed = (story.from === "lumiverse" ? (ask.sovereignHand === true ? "replies" : "everyone") : story.from) === "replies";
    this.remember(this.directed, ask.chatId, directed);
    const first = [
      ...(directed ? [renderPrompt(HARNESS_TEXT.sovereign, texts, {})] : []),
      ...(whole ? [] : [renderPrompt(HARNESS_TEXT.behind, texts, {})]),
      ...(unplayed !== null ? [renderPrompt(HARNESS_TEXT.unplayed, texts, { why: unplayed })] : []),
    ].filter((text) => text.trim() !== "");
    return { mainAgent: HARNESS_AGENT.author, guidance: first.length > 0 ? { ...guidance, text: `${first.join("\n\n")}\n\n${guidance.text}` } : guidance, withdraw: [...LUMIAH_WITHDRAWN], story, place: "runtime", request: "newest", reply: "released" };
  }

  /**
   * Waits until the chat's ledger has done what it had to do when a run began: the turn before
   * it, committed. Every write of a chat goes through one queue, and a reply's commit joins it the
   * moment Lumiverse says the reply is saved, which is before the next prompt is assembled: so an
   * empty step at the queue's end is done exactly when that commit is. True at once where the queue
   * holds nothing, however short the wait is set: there is nothing to be behind. False when `ms` ran
   * out first: the run goes on without it.
   */
  private async caughtUp(chatId: ChatId, userId: UserId, ms: number): Promise<boolean> {
    if (!this.rt.ledger.queued(chatId)) return true;
    const done = this.rt.ledger.with(chatId, userId, () => undefined).then(
      () => true,
      () => true,
    );
    const late = Promise.withResolvers<boolean>();
    const timer = setTimeout(() => late.resolve(false), ms);
    try {
      return await Promise.race([done, late.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The engine's tools as LumiAH lists them for a chat: those of a world chat on the harness, and
   * none for any other chat. About no chat it is the engine's whole catalogue, on a world of
   * nothing: LumiAH reads that list for its own Agents and Tools pages, which hold a definition's
   * tools to it, so without it no definition of the engine's could be saved there. A tool called
   * outside a world chat on the harness still answers that no turn is open.
   */
  private async list(chatId: string, told = ""): Promise<RemoteTool[]> {
    if (chatId === "") return harnessTools({ world: blankWorld("catalogue", ""), registry: this.rt.registry, texts: told !== "" ? (await this.rt.settings.get(told)).prompts.texts : {} });
    const userId = await this.userOf(chatId, told);
    if (!userId || (await this.rt.chatKnowledge.engine(chatId, userId)) !== "harness") return [];
    const head = await chatHead(this.rt, chatId, userId);
    if (!head) return [];
    return harnessTools({ world: head.world, registry: this.rt.registry, texts: (await this.rt.settings.get(userId)).prompts.texts });
  }

  /**
   * One tool call (HARNESS-SLICE3 step 4). A call of an open turn's run runs in that turn, on what
   * the turn runs on. A job's call stages into its turn while that turn is still to be written (a job
   * that runs beside it); once the reply is written it belongs to the record the reply's commit
   * writes, waits for that commit, and writes at once, tied to the record. A call of a side
   * session's turn reads the chat as it stands. A call of a run the engine knows nothing of is
   * answered so; it never runs on the chat's head as if it were anyone's.
   *
   * Whatever a call would run with, it passes one gate first (`toolRefusal`): what the tool needs,
   * against where the caller stands as LumiAH says who it is on the call. Closed, the tool never
   * runs, whatever tools the caller's definition lists.
   */
  private async call(call: RemoteToolCall, signal: AbortSignal, told = ""): Promise<{ text: string; error?: boolean }> {
    await this.opening.get(call.turn);
    const userId = await this.userOf(call.chatId, told);
    const texts = userId ? (await this.rt.settings.get(userId)).prompts.texts : {};
    const say = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
    // A person's own mind reads through its own tools alone, whatever its definition was given: the read view has no one person's point of view, so any other tool would show it what that person doesn't know. Its own acts it writes as beats (`beat_write`), which holds it to its own.
    const family = FAMILY.get(call.name);
    if (call.role === HARNESS_AGENT.character && family !== undefined && family !== HARNESS_FAMILY.mind && call.name !== BEAT_WRITE) return { text: say(HARNESS_NOTE.mindOnly, { tool: call.name }), error: true };
    let served: Served | null = null;
    let out: { text: string; error?: boolean };
    try {
      const got = await this.serve(call, userId, signal, say);
      if ("text" in got) return got;
      served = got;
      const closed = toolRefusal(call.name, got.standing, say);
      const run = (): Promise<{ text: string; error?: boolean }> => runHarnessTool(got.env(), call.name, call.args);
      // A job tied to no reply is told that, not that its starter holds too little.
      out = closed ? (got.noReply ? { text: JSON.stringify({ refused: { code: "no_basis", reason: say(HARNESS_NOTE.noBasis) } }), error: true } : closedAnswer(closed)) : await (got.frame ? inTurn(got.frame, run) : run());
    } catch (error) {
      // A tool that throws is the engine's fault, never the model's: said plainly, and logged.
      const reason = error instanceof Error ? error.message : String(error);
      this.rt.host.log("error", `[LumiRPEngine] harness tool ${call.name} failed: ${error instanceof Error ? (error.stack ?? reason) : reason}`, userId ?? undefined);
      out = { text: say(HARNESS_NOTE.toolFailed, { tool: call.name, reason }), error: true };
    }
    served?.answered?.(out);
    return out;
  }

  /** What a call runs with and where its caller stands; or its answer, where the engine has nothing to run it on. */
  private async serve(call: RemoteToolCall, userId: UserId | null, signal: AbortSignal, say: (id: string) => string): Promise<Served | { text: string; error: true }> {
    const as = call.as ?? null;
    const own = this.turns.get(call.turn);
    if (own && !own.closed) {
      const mine: TurnCall = { agent: own.cast.of(call), tool: call.name, ceiling: null, files: this.files?.({ chatId: own.chatId, userId: own.userId }) ?? null, as, job: null };
      return { env: () => own.env(mine, signal), standing: own.standing(mine.agent), frame: own.frame };
    }
    // A side session's turn: a conversation with an agent, tied to no reply. It reads the chat as it stands, as its definition reads; what more it may do is whoever started it's to give (`sideEnv`), and no agent of it is an author.
    if (this.talks.has(call.turn)) {
      if (!userId || call.chatId === "") return { text: say(HARNESS_NOTE.noTurn), error: true };
      const given = (await this.sideEnv?.({ call, userId, signal })) ?? { env: this.reading(call, userId, signal), tier: "read" as RoleTier };
      return { env: () => given.env, standing: { own: given.tier, over: "gm", under: null, author: false, def: call.role }, frame: null, ...(given.answered ? { answered: given.answered } : {}) };
    }
    const job = this.jobs.get(call.turn);
    const files = userId ? (this.files?.({ chatId: call.chatId, userId }) ?? null) : null;
    // A job no reply's turn started belongs to no turn: it works on the chat as it stands (`prepareEnv`). The story's prepared start writes on the chat's first reply, any other on its newest.
    if (job && job.basis === null) {
      const side = this.sides.get(call.turn);
      if (!userId || !side) return { text: say(HARNESS_NOTE.noTurn), error: true };
      const agent = side.cast.of(call);
      const prepared = this.preparing(call.turn);
      // The player's own job, and every job of the prepared start, stand as their definitions: the job's main agent running as the author stands as the author. One an agent started outside them (in a conversation with an agent, or in another job of the player's) is held to that agent, who wrote nothing there: it reads, and what it would change is refused.
      const held = job.by !== null && !prepared;
      const standing = standingOf(agent, undefined, held ? this.ceilingOf(call.turn) : null, agent.main && agent.def === HARNESS_AGENT.author);
      const env = await prepareEnv(this.rt, { chatId: call.chatId, userId, job: call.turn, prepared, directed: side.directed, agent, tier: reach(standing), files, as, signal });
      if ("refused" in env) return { text: JSON.stringify({ refused: { code: env.code, reason: env.reason } }), error: true };
      return { env: () => env, standing, frame: null, ...(held ? { noReply: true as const } : {}) };
    }
    // A job's run, or what an agent of a turn still calls once its reply is saved: the turn whose record it belongs to.
    const known = job?.basis ?? (own || this.over.has(call.turn) ? call.turn : null);
    if (!userId || (known === null && !this.sides.has(call.turn))) return { text: say(HARNESS_NOTE.noTurn), error: true };
    // A run tied to no reply (a job's run the engine was never told of, started outside a reply's turn): it reads the chat as it stands and changes nothing (`jobEnv`).
    const basis = known ?? "";
    const ceiling: Ceiling | null = job ? this.ceilingOf(call.turn) : known === null ? { tier: "read", by: call.turn } : null;
    const turn = this.turns.get(basis);
    const beside = turn && !turn.closed && turn.replied === null ? this.sides.get(call.turn) : undefined;
    if (turn && beside) {
      const theirs: TurnCall = { agent: beside.cast.of(call), tool: call.name, ceiling, files, as, job: job ? call.turn : null };
      return { env: () => turn.env(theirs, signal), standing: turn.standing(theirs.agent, ceiling), frame: turn.frame };
    }
    // A call that belongs to the turn's record waits for it, and for what the turn's last commit asked of the world's document. The call ending ends the wait as the commit does.
    const settled = turn?.settled.promise ?? this.over.get(basis)?.settled;
    if (settled && !signal.aborted) {
      const ended = Promise.withResolvers<void>();
      signal.addEventListener("abort", () => ended.resolve(), { once: true });
      await Promise.race([settled, ended.promise]);
    }
    // A turn that was let go wrote no record: nothing belongs to it.
    if (this.over.get(basis)?.committed === false) return { text: say(HARNESS_NOTE.noTurn), error: true };
    // A run the engine never heard begin, or has forgotten: who its agents were is gone with it, and none is made anew for a late call.
    const side = this.sides.get(call.turn);
    if (!side) return { text: say(HARNESS_NOTE.noTurn), error: true };
    const agent = side.cast.of(call);
    // No grant reaches past the turn it was made in: after the reply an agent stands where its definition and the agents over it leave it.
    const standing = standingOf(agent, undefined, ceiling, agent.main && agent.job === null);
    const env = await jobEnv(this.rt, this.review, { chatId: call.chatId, userId, basis, committed: this.over.get(basis)?.committed === true, agent, standing, tool: call.name, files, staged: side.staged, signal, as, directed: side.directed, job: job ? call.turn : null });
    if ("refused" in env) return { text: JSON.stringify({ refused: { code: env.code, reason: env.reason } }), error: true };
    const noReply = known === null || (!turn && !this.over.has(basis));
    // Said once per run, for whoever reads the log: which of the two it was.
    if (noReply && !side.warned) {
      side.warned = true;
      this.rt.host.log("warn", `[LumiRPEngine] run ${call.turn.slice(0, 12)} is tied to no reply the engine knows (${known === null ? "it was started outside a reply's turn" : `turn ${basis.slice(0, 12)} was never opened here`}): it reads the chat as it stands and changes nothing`, userId);
    }
    return { env: () => env, standing, frame: null, ...(noReply ? { noReply: true as const } : {}) };
  }

  /**
   * What holds a job's agents: the tier whoever started the job writes at, where it stands in the
   * run it started the job from. That run is the job's turn (its grants as they stand while it is
   * open; its agents as it left them once it closed, a grant ending with its turn), or the job
   * whose agent started this one, itself held the same way. An agent the engine never heard from,
   * by a call of its own or as one over a caller, can't be placed, so its job only reads; so does
   * a job the engine was told of with no one who started it.
   */
  private ceilingOf(id: string, seen: ReadonlySet<string> = new Set()): Ceiling {
    const job = this.jobs.get(id);
    if (!job || job.by === null || job.basis === null || seen.has(id)) return { tier: "read", by: job?.by ?? id };
    if (job.parent !== null) {
      const starter = this.sides.get(job.parent)?.cast.placed(job.by);
      return { tier: starter ? reach(standingOf(starter, undefined, this.ceilingOf(job.parent, new Set([...seen, id])))) : "read", by: job.by };
    }
    const open = this.turns.get(job.basis);
    const left = open ? null : this.sides.get(job.basis)?.cast.placed(job.by);
    const standing = open ? open.placing(job.by) : left ? standingOf(left) : null;
    return { tier: standing ? reach(standing) : "read", by: job.by };
  }

  /** What a call of a side session's turn runs with where nobody gives it more: the chat as it stands, read as the calling agent's definition reads, and nothing to write with. */
  private reading(call: RemoteToolCall, userId: UserId, signal: AbortSignal): ToolEnv {
    const { view, marks } = harnessRole(call.role) ?? { view: "everyone" as const, marks: true };
    const base = { userId, chatId: call.chatId, knowledge: view, marks };
    return { ...base, reader: outsideReader(this.rt, base), writer: null, agent: { role: call.role, id: call.agentId, ...(call.as !== undefined ? { as: call.as } : {}) }, signal, files: this.files?.({ chatId: call.chatId, userId }) ?? null };
  }

  /** A run begins. A turn that answers a generation opens the engine's side of it; a job's run is noted, to be tied to its turn; a side session's turn is noted, and whoever follows it is told. */
  private runBegan(run: RunBegan): Promise<void> {
    if (run.kind === "side") {
      if (run.userId !== "") this.remember(this.talks, run.turn, { chatId: run.chatId, userId: run.userId });
      this.sideBegan?.(run);
      return Promise.resolve();
    }
    const began = this.begin(run).catch((error: unknown) => this.rt.host.log("error", `[LumiRPEngine] chat ${run.chatId}: the harness turn ${run.turn.slice(0, 8)} wasn't opened (${error instanceof Error ? (error.stack ?? error.message) : String(error)})`));
    this.opening.set(run.turn, began);
    return began.finally(() => {
      if (this.opening.get(run.turn) === began) this.opening.delete(run.turn);
    });
  }

  private async begin(run: RunBegan): Promise<void> {
    const chatId = run.chatId;
    const userId = await this.userOf(chatId, run.userId);
    if (!userId) return;
    // A job's run started again goes on as the run before it left it: who its agents were, and what it wrote. Whether the player directs the story is the claim's word, asked as this run began.
    if (run.kind === "job") return this.remember(this.sides, run.turn, this.sides.get(run.turn) ?? { chatId, userId, cast: new Cast(run.turn), staged: new Map(), directed: this.directed.get(chatId) ?? false });
    // What the turn runs on: as its generation's guard took it, so the whole turn reads one set of settings and choices.
    const frame = this.rt.ledger.harnessFrame(chatId, run.turn) ?? (await this.rt.frame(chatId, userId));
    const chatRun = await this.rt.runOf(chatId, userId);
    if (frame.chat.engine !== "harness" || !chatRun) return;
    await this.notebook(chatId, userId, frame);
    await this.rt.ledger.with(chatId, userId, (core, observed) => inTurn(frame, () => this.open(run.turn, frame, chatRun.runSeed, core, observed)));
    // Agent turns under way, across the user's chats (Settings → Agents → Budgets): the oldest is let go when another starts.
    const mine = [...this.turns.values()].filter((t) => t.userId === userId);
    for (const stale of mine.slice(0, Math.max(0, mine.length - frame.settings.agents.kept.runs))) await this.dropped({ chatId: stale.chatId, userId, generationId: stale.generationId, why: "more turns were under way than the engine keeps" });
  }

  /**
   * The author's notebook, ready before the author starts on a turn: each of its files the chat's
   * area lacks is written in its first shape, and its first page is pinned for the author, so LumiAH
   * shows it to the author at the turn's start (`shapeNotebook`). A notebook that can't be made now
   * costs the turn nothing: it is made at the next.
   */
  private async notebook(chatId: ChatId, userId: UserId, frame: TurnFrame): Promise<void> {
    const files = this.files?.({ chatId, userId });
    const core = this.core;
    if (!files || !core) return;
    const pin = async (path: string, agent: string): Promise<void> => void (await core.ask(userId, "workspace.pin", { chatId, area: "chat", path, on: true, role: agent }, { chat: chatId }));
    await shapeNotebook({ list: files.list, write: files.write, pin }, frame.settings.prompts.texts).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the author's notebook wasn't made ready (${error instanceof Error ? error.message : String(error)})`, userId));
  }

  /**
   * Opens the engine's side of a turn, inside the chat's queue (HARNESS-SLICE3 step 3), on the
   * generation's own pending turn: one generation, one window, one pending turn. The turn's plan is
   * its opening's bookkeeping alone (`openingEvents`); a Continue has none, and reads the chat's
   * head. Under a pause there is no state to stand on: the turn stays blank, its tools say so, and
   * its reply commits as the core commits an unplanned turn.
   */
  private async open(generationId: string, frame: TurnFrame, runSeed: string, core: LedgerCore, observed: ChainMessage[]): Promise<void> {
    const { chatId, userId } = frame;
    core.sync(observed);
    const p = core.journal.pending[generationId];
    if (!p || p.kind === "impersonate" || this.turns.has(generationId)) return;
    const run = await this.rt.runOf(chatId, userId);
    if (!run) return;
    const continues = p.kind === "continue";
    const target = p.messageId ? observed.findIndex((m) => m.id === p.messageId) : -1;
    const before = continues || target < 0 ? [...observed] : observed.slice(0, target);
    let at: { start: WorldState; world: WorldDoc } | null = null;
    if (continues) {
      const head = core.renderState(observed);
      at = head ? { start: head.state, world: head.world } : null;
    } else {
      this.plans.set(chatId, (input) => openingEvents(this.rt, frame, runSeed, input));
      try {
        core.plan(generationId, observed, false);
      } finally {
        this.plans.delete(chatId);
      }
      const planned = p.planned ? core.renderPlanned(observed, p, true) : null;
      at = planned?.start ? { start: planned.start, world: planned.world } : null;
    }
    if (!at) return void this.remember(this.blank, generationId, "an earlier message was edited: Keep or Discard it first");
    const said = ownMessage(before);
    const earlier = before.findLast((m) => !m.isUser);
    const answers: HarnessTurn["said"] = continues ? { messageId: null, user: "", before: earlier ? activeText(earlier) : "" } : { messageId: said?.id ?? null, user: said ? activeText(said) : "", before: earlier ? activeText(earlier) : "" };
    const turn = new OpenTurn(this.rt, this.review, {
      chatId,
      userId,
      generationId,
      frame,
      run,
      core,
      before,
      start: at.start,
      world: at.world,
      opening: continues ? [] : [...p.events],
      // A Continue has no plan to seed: its dice are its generation's own, the same whenever it is asked.
      seed: continues ? hashParts("lre.harness.continue", runSeed, generationId) : p.seed,
      continues,
      kept: await keptFiles(this.rt, chatId, userId),
      learning: await this.rt.settings.learningOf(userId),
      active: await this.rt.activeConnectionId(userId),
      said: answers,
      build: await worldBuild(this.rt, chatId, userId),
      directed: this.directed.get(chatId) ?? false,
    });
    this.turns.set(generationId, turn);
  }

  /** The turn's reply was written whole. */
  private async replyWritten(reply: ReplyWritten): Promise<void> {
    const turn = this.turns.get(reply.turn);
    if (turn) turn.replied = reply.reply;
  }

  /**
   * A run ended. A turn's that failed, or was stopped with nothing of its reply released, leaves
   * nothing, whatever its generation then does. One that is done, or was stopped once some of its
   * reply was released, hands the engine LumiAH's own record of the turn, which the turn's record
   * takes: with the reply's commit when that is still to come, else now. Stopped, what was released
   * stands, and the turn commits as its generation stops (`TurnContext.stopped`). The jobs its
   * agents started belong to that record. A job's run stays known when it ends (`sides`): a job its
   * agents started is held to where they stood, and a run of it started again goes on as the same
   * agents.
   */
  private async runEnded(run: RunEnded): Promise<void> {
    if (run.kind === "side") {
      this.talks.delete(run.turn);
      this.sideEnded?.(run);
      return;
    }
    if (run.kind === "job") return;
    // Named by the turn's record alone, a job has its turn and no one who started it: `jobKnown` says who.
    for (const job of run.record?.jobs ?? []) if (!this.jobs.has(job.id)) this.remember(this.jobs, job.id, { basis: run.turn, by: null, parent: null, due: null, plan: null });
    const stands = run.status === "done" || (run.status === "stopped" && run.reply.trim() !== "");
    // The reply's text reaches the engine here too, where its run ends before anything else says it was written.
    const open = this.turns.get(run.turn);
    if (open && open.replied === null && stands) open.replied = run.reply;
    const userId = await this.userOf(run.chatId, run.userId);
    if (!userId) return;
    if (!stands) {
      const texts = (await this.rt.settings.get(userId)).prompts.texts;
      const why = renderPrompt(run.status === "stopped" ? HARNESS_TEXT.unplayedStopped : HARNESS_TEXT.unplayedFailed, texts, { reason: run.reason ? `: ${run.reason.slice(0, 300)}` : "" });
      // Kept for the generation's end, which may still save a reply: nothing of this turn stands for it.
      if (!this.over.get(run.turn)?.committed) this.remember(this.failed, run.turn, why);
      if (this.turns.has(run.turn)) await this.dropped({ chatId: run.chatId, userId, generationId: run.turn, why });
      return;
    }
    if (!run.record) return;
    const record = run.record as unknown as JsonObject;
    if (!this.over.get(run.turn)?.committed) return this.remember(this.records, run.turn, record);
    await this.keep(run.chatId, userId, run.turn, record);
  }

  /**
   * Which connection, model and effort an agent of a run starts on (LumiAH's `agentModel`): the
   * story's choice for its definition, the person it plays (`as`) and how it stands
   * (`chooseAgentModel`), with the job whose run it is of where it is a job's, whether the job's own
   * agent or one an agent of it started. Null: its definition's own.
   */
  private async agentModel(ask: AgentModelAsk): Promise<AgentModelChoice | null> {
    if (ask.userId === "") return null;
    const job = ask.kind === "job" ? this.jobs.get(ask.turn) : undefined;
    return chooseAgentModel(await this.rt.settings.get(ask.userId), { definition: ask.definition, as: ask.as, standing: ask.standing, job: job ? { basis: job.basis, ...(job.due !== null ? { due: job.due } : {}), prepared: this.preparing(ask.turn) } : null });
  }

  /** Whether job `id` is of the story's prepared start: the preparation's own job (its plan is the preparation's file), or one an agent of it started, however far down. */
  private preparing(id: string): boolean {
    const seen = new Set<string>();
    for (let at: string | null = id; at !== null && !seen.has(at); ) {
      seen.add(at);
      const job = this.jobs.get(at);
      if (!job) return false;
      if (job.plan === PREPARE_PATH) return true;
      at = job.parent;
    }
    return false;
  }

  /**
   * Whether a passage an agent of a turn releases may go out (LumiAH's `releasing`): the turn's
   * stage book holds it to what the turn decided (`releaseGate`). A passage of no open turn of the
   * engine's is refused: nothing of it is the engine's to tell.
   */
  private async releasing(release: ReplyRelease): Promise<ReleaseVerdict> {
    const open = this.turns.get(release.turn);
    if (!open || open.closed) return { refused: renderPrompt(HARNESS_NOTE.noTurn, release.userId !== "" ? (await this.rt.settings.get(release.userId)).prompts.texts : {}, {}) };
    return releaseGate(open.stageBook, open.frame.settings, { role: release.agent.role, text: release.text });
  }

  /** A passage went out, or a handed-on stream ended (LumiAH's `released`): the turn's stage book notes what reached the player. */
  private released(release: ReplyRelease): Promise<void> {
    const open = this.turns.get(release.turn);
    if (open) releaseNoted(open.stageBook, { role: release.agent.role, text: release.text });
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- LumiAH's records in the ledger

  /**
   * A job as LumiAH lists it. The turn it belongs to is the turn its writes are tied to, and who
   * started it is who its agents are held to (`ceilingOf`): the agent whose `job_start` made it,
   * and the job that agent was of, where it was a job's own. Whoever mounts LumiAH tells the engine
   * of each job as it starts. One the user started belongs to no turn: it works on the chat as it
   * stands (`prepareEnv`), the story's prepared start on the chat's first reply (`preparing`).
   */
  jobKnown(job: Pick<JobView, "id" | "basis" | "by" | "parent" | "due" | "plan">): void {
    this.remember(this.jobs, job.id, { basis: job.basis, by: job.by.who === "agent" ? job.by.id : null, parent: job.parent ?? null, due: job.due ?? null, plan: job.plan ?? null });
  }

  /** Writes LumiAH's record of turn `turn` into the record that turn wrote, wherever it is now. */
  private async keep(chatId: ChatId, userId: UserId, turn: string, record: JsonObject): Promise<void> {
    const refused = await this.rt.ledger.recordHarness(chatId, userId, (core, observed) => {
      const found = findTurn(core, observed, turn);
      const held = found ? recHarnessOf(found.rec) : null;
      return found && held ? { messageId: found.messageId, swipeId: found.swipeId, harness: { ...held, record } } : null;
    });
    if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: LumiAH's record of turn ${turn.slice(0, 8)} wasn't kept (${refused})`, userId);
    else this.recorded?.(chatId);
  }

  /**
   * LumiAH's records on each reply of the chat, oldest first, for every swipe that holds one: what
   * its anchor port reads (`ChatPort.path`'s `anchor`). The ledger is the anchor: each is read from
   * the record its reply holds, the journal's over the message's.
   */
  async anchors(chatId: ChatId, userId: UserId): Promise<AnchorRow[]> {
    const core = await this.rt.ledger.core(chatId, userId);
    return core ? anchorsOf(core, toChain(await this.rt.host.chats.messages(chatId, userId))) : [];
  }

  /**
   * Writes LumiAH's record for one swipe of a reply: what its anchor port writes (`ChatPort.anchor`),
   * as a turn's run ends and whenever the record changes after (a job that ended, a rollback).
   * LumiAH anchors a turn's record once the reply is saved, which may be before the reply's commit
   * wrote the record it rides in: it is kept for that commit then, over the one the run's end
   * handed the engine (the same record, without what LumiAH's backend adds to it for itself).
   *
   * On a reply no turn was played for, LumiAH's record says it had no part in the reply, and why,
   * in its own words. It is kept beside the mark, so LumiAH's pages list the reply as theirs do, and
   * its words become the mark's: what the game master reads on the reply and the next turn's author
   * is told. It names no turn of the engine's, so nothing is tied to it.
   *
   * False when that swipe holds no record a harness turn wrote or marked, and none is about to.
   */
  async anchor(chatId: ChatId, userId: UserId, messageId: MessageId, swipeId: number, record: JsonObject): Promise<boolean> {
    let marked = false;
    const refused = await this.rt.ledger.recordHarness(chatId, userId, (core, observed) => {
      const rec = core.chain(observed).find((m) => m.id === messageId)?.ledger?.swipes[String(swipeId)];
      const held = recHarnessOf(rec);
      if (held) return { messageId, swipeId, harness: { ...held, record } };
      const mark = unplayedOf(rec);
      if (mark === null) return null;
      marked = true;
      return { messageId, swipeId, harness: { turns: [], unplayed: noPartOf(record) ?? mark.why, record } };
    });
    if (refused === null) {
      this.recorded?.(chatId);
      // The reply's flag says why in LumiAH's words now.
      if (marked) this.rt.push.changed(chatId, userId);
      return true;
    }
    const turn = typeof record.generationId === "string" ? record.generationId : "";
    if (!this.turns.has(turn)) return false;
    this.remember(this.records, turn, record);
    return true;
  }

  // ---------------------------------------------------------------- what the core plans and reads for a harness turn

  /** The plan the core asks for while a harness turn opens: its opening's bookkeeping; null for any other turn, which the engine plans. */
  plan(chatId: ChatId, input: PlanInput): LedgerEvent[] | null {
    return this.plans.get(chatId)?.(input) ?? null;
  }

  /** The read the core asks for as a harness turn commits: what follows from the turn with no model; null for any other turn, whose reply the engine reads. */
  read(chatId: ChatId, input: ReadInput): LedgerEvent[] | null {
    return this.reads.get(chatId)?.(input) ?? null;
  }

  // ---------------------------------------------------------------- the ledger's hooks

  /** The gate card `turn` of a chat was answered (`lre.review`, or its chip): a harness turn's commit waiting on it goes on. False when no harness turn waits there. */
  reviewed(chatId: ChatId, turn: string): boolean {
    let waited = false;
    for (const open of this.turns.values()) if (open.chatId === chatId && open.answered(turn)) waited = true;
    return waited;
  }

  /**
   * `HarnessHooks.beforeCommit`, inside the chat's queue, the reply saved or stopped. The turn takes
   * its last commit and nothing more: what is still staged lands with it, unless the reply was
   * stopped, and then the turn keeps only what it had committed. What it landed joins the journal's
   * planned turn. What follows from the turn with no model is made ready for the core's own commit,
   * which reads it (`read`): off-screen catch-up, the turn's tick rules and the story's tracks
   * (`postTurn`), then who was there for the turn and what the world authors that the chat doesn't
   * hold yet (`postOpening`). A Continue has no plan: what it landed is what its read records.
   */
  async beforeCommit(input: TurnContext): Promise<string | null> {
    const { chatId, userId, generationId, core, observed } = input;
    const turn = this.turns.get(generationId);
    if (!turn) return this.blank.has(generationId) ? null : (this.failed.get(generationId) ?? renderPrompt(HARNESS_TEXT.unplayedNoRun, (await this.rt.settings.get(userId)).prompts.texts, {}));
    const events = await turn.close(input.stopped === true);
    const closing: Closing = { events, read: false };
    this.closing.set(generationId, closing);
    if (turn.continues) {
      this.reads.set(chatId, (read) => {
        closing.read = true;
        const w = new Working(this.rt.registry, read.ctx.world, read.state);
        w.applyAll(events);
        return [...w.events];
      });
      return null;
    }
    core.appendPlanned(generationId, events, observed);
    const context = core.commitContext(generationId, input.messageId, observed);
    const knowing = context ? knowledgeOn(turn.frame.chat, context.world, turn.frame.settings) : false;
    const presence = context ? await postOpening(this.rt.minds, postMindsInput(context, { chatId, userId, messageId: input.messageId, user: turn.said.user, reply: input.content, guidance: {}, knowledge: knowing })) : null;
    this.reads.set(chatId, (read) => {
      closing.read = true;
      const w = new Working(this.rt.registry, read.ctx.world, read.state);
      w.applyAll(this.rt.turnConsequences({ world: read.ctx.world, state: w.state, runSeed: turn.run.runSeed, seed: read.seed, appliedMinutes: clockMinutes(context?.pre ?? []) }));
      w.applyAll(presence?.events ?? []);
      return [...w.events];
    });
    return null;
  }

  /**
   * `HarnessHooks.afterCommit`: the turn's record is written. It takes the harness's part: the turn
   * that wrote it (after those a Continue adds to), LumiAH's record of it when its run already
   * ended, and the default tick when the turn took one. The turn closes: which role wrote what, the
   * kept files it changed, its review card.
   */
  async afterCommit(input: TurnContext): Promise<void> {
    const { chatId, userId, generationId, core, observed, messageId, swipeId } = input;
    this.reads.delete(chatId);
    const closing = this.closing.get(generationId);
    this.closing.delete(generationId);
    const turn = this.turns.get(generationId);
    this.blank.delete(generationId);
    if (!turn) return;
    try {
      // A Continue the core accepted unread recorded nothing of the turn: what it landed is written beside the reply, as a read of it would have been.
      if (turn.continues && closing && !closing.read && closing.events.length > 0) {
        const written = core.write({ kind: "post", id: `harness-continue:${generationId}`, target: "head", entry: { kind: "cont", events: closing.events } }, observed);
        if (!written.applied) this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: what a Continue's agents committed didn't land (${written.reason ?? "refused"})`, userId);
      }
      const close = await turn.finish(core, observed, messageId, swipeId);
      const held = recHarnessOf(core.chain(observed).find((m) => m.id === messageId)?.ledger?.swipes[String(swipeId)]);
      const record = this.records.get(generationId) ?? (turn.continues ? held?.record : undefined);
      this.records.delete(generationId);
      const harness: RecHarness = { turns: [...(turn.continues ? (held?.turns ?? []) : []), generationId], ...(record ? { record } : {}), ...(close.defaultTick !== null ? { defaultTick: close.defaultTick } : {}) };
      const refused = core.recordHarness(messageId, swipeId, harness, observed);
      if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the turn's record doesn't name its harness turn (${refused})`, userId);
      else this.recorded?.(chatId);
    } finally {
      // The turn stays known until its record names it, so a call that came meanwhile finds the one or the other. Its agents are the same agents in what they still call: the turn's own cast serves its tail, and none is made again.
      this.remember(this.over, generationId, { chatId, userId, committed: true, settled: turn.settled.promise });
      this.remember(this.sides, generationId, { chatId, userId, cast: turn.cast, staged: new Map(), directed: turn.directed });
      this.turns.delete(generationId);
      // What its last commit landed of the world's document is made as this operation lets go of the chat's ledger (`OpenTurn.late`): nothing here waits for it, and whoever waits for the turn does.
      void turn.late().finally(() => turn.settled.resolve());
    }
  }

  /** `HarnessHooks.dropped`: nothing of the generation's turn stands. Its staged writes, what it committed and its gate's card go; a later call of its run is answered that no turn is open. */
  async dropped(input: { chatId: ChatId; userId: UserId; generationId: string; why: string }): Promise<void> {
    const { chatId, userId, generationId } = input;
    this.reads.delete(chatId);
    this.closing.delete(generationId);
    this.blank.delete(generationId);
    this.records.delete(generationId);
    const turn = this.turns.get(generationId);
    this.turns.delete(generationId);
    if (!this.over.get(generationId)?.committed) this.remember(this.over, generationId, { chatId, userId, committed: false });
    if (!turn) return;
    await turn.drop();
    this.rt.host.log("info", `[LumiRPEngine] chat ${chatId}: harness turn ${generationId.slice(0, 8)} was let go with nothing landed (${input.why})`, userId);
  }
}

/** The record of the last reply with text the chat shows, which a reply being written (still empty) comes after: the reply a turn follows, whose marks its author is told first. Null where there is none. */
function lastReply(head: ChatHead): Rec | null {
  const reply = head.core.chain(head.observed).findLast((m) => !m.isUser && activeText(m) !== "");
  return reply ? activeRecord(reply, head.core.journal.tombstones) : null;
}

/** Why the reply a turn follows (`rec`, `lastReply`) stands with no turn played, if it does, as the author is told it, in `texts`. */
function unplayedBefore(rec: Rec | null, texts: PromptTexts): string | null {
  const mark = unplayedOf(rec);
  if (mark === null) return null;
  return mark.added ? renderPrompt(HARNESS_TEXT.unplayedAdded, texts, { why: mark.why }) : mark.why;
}

/**
 * A harness turn's opening, as the plan the core asks for (HARNESS-SLICE3 step 3): bookkeeping
 * alone, with nothing simulated. What every planned turn does first (`turnStart`: a fresh pause
 * pinned to its scene or a lifted one cleared, the player character's detail opened), whether the
 * chat tracks who knows what, when that changed, and the minds' round, as a classic turn's pre phase
 * records them. No action is read, no time passes and no one acts: those are the author's, by tools.
 */
function openingEvents(rt: Runtime, frame: TurnFrame, runSeed: string, input: PlanInput): LedgerEvent[] {
  const w = new Working(rt.registry, input.ctx.world, input.state);
  turnStart(rt.registry, w, runSeed);
  const { settings } = frame;
  const switched = knowledgeSwitch(w.state, knowledgeOn(frame.chat, input.ctx.world, settings), settings.minds.knowledge.threshold);
  if (switched) w.apply(switched);
  // The round every turn with minds on opens, and once more as they are switched off after being on.
  if (settings.minds.enabled) w.apply({ type: MINDS_EVENTS.round, data: { at: w.state.clock, on: true } });
  else if (readSlice(w.state).on) w.apply({ type: MINDS_EVENTS.round, data: { at: w.state.clock, on: false } });
  return [...w.events];
}
