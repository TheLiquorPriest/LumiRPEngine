// The harness engine: RPEngine's side of LumiAH (HARNESS-SLICE3). A chat whose engine is `harness`
// is played by the author, LumiAH's main agent for that chat, and the agents it starts: characters,
// the game master, the knowledge inference. They decide everything a turn needs by calling tools.
// RPEngine supplies those tools, the agents' definitions, the skills and the rules of the world, and
// makes no model call of its own: every model call is an agent's, wherever LumiAH runs them (in
// its runtime, or built into Lumiverse: its DESIGN §25).
//
// This is what LumiAH is given, to the shapes of its own boundary (`shapes.ts`; nothing here imports
// LumiAH yet, and the step that mounts it swaps those copies for its package's):
// - `extension`: what an extension that builds LumiAH into itself supplies (`HarnessExtension`): its
//   definitions, what it claims of a chat, the writer's request rewritten, and the run's milestones.
//   Each is told which user it is for, and answers for that user: nothing here guesses one.
// - `tools`: the tools that run in the extension (`ToolsPort`): listed for a chat, and run for a call
//   with a `ToolEnv` built for that call; told the user too, where the caller serves more than one.
//
// And what the ledger asks of the engine for a chat the harness plays (`HarnessHooks`): whether it
// plays the chat, the engine's entries for a prompt, and the turn's commit when its reply is saved.
//
// One turn, as the ledger and LumiAH tell it:
// 1. `GENERATION_STARTED` opens the pending turn, as for any engine. The guard never stops the
//    generation: it writes each section into its entry as the chat's head has it, between markers
//    (`markers`). The prompt as Lumiverse assembles it is one a reply can be written from, whatever
//    becomes of the turn.
// 2. `runBegan` opens the engine's side of the turn (`OpenTurn`): what it runs on, its staged writes
//    and its working state, on the generation's own pending turn, which takes the opening's
//    bookkeeping as its plan. Nothing is simulated: no action is read, no time passes, no one acts.
// 3. Each tool call runs with the calling agent's view, writer and tier (`OpenTurn.env`), once the
//    one gate every call enters by has seen that the tool is the caller's to call (`toolRefusal`).
// 4. `writerRequest` swaps each marked span for the turn's own section, where the preset placed it.
//    Whoever writes the reply is sent that: LumiAH's writer, or Lumiverse's own generation. The
//    engine learns the reply's text only when LumiAH says it is written, or Lumiverse saves it.
// 5. `GENERATION_ENDED`, the reply saved: what is still staged is committed, what the turn landed
//    joins its planned events, the core commits the turn, and its record takes LumiAH's own record
//    of the turn. A turn has one record. A generation that was stopped, failed or came back empty,
//    or a run that failed, leaves nothing: no record, nothing staged, nothing half-written.
// 6. A job the turn's agents started writes through the ledger's path for writes outside a turn,
//    tied to the turn's record, until that record leaves the chat's path (`jobs.ts`).
//
// Nothing between a run's beginning and its writer's request waits on a clock: the turn stays open
// until its generation ends, is stopped, or another starts on the chat.

import type { RoleTier } from "../../shared/agent-roles";
import { defaultAgentSettings, type NewestMessage, type SovereignHand } from "../../shared/agent-settings";
import { HARNESS_AGENT, HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TEXT } from "../../shared/harness-texts";
import { hashParts } from "../../shared/hash";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { LedgerEvent, Rec, RecHarness } from "../../shared/ledger";
import { MINDS_EVENTS } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
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
import type { Delivered, HarnessHooks, TurnContext } from "../ledger-io";
import { toChain } from "../ledger-io";
import { knowledgeSwitch, postMindsInput, postOpening } from "../minds";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { inTurn, type TurnFrame } from "../turn-frame";
import { clockMinutes } from "../view";
import { harnessDefinitions, harnessRole, worldGuidance } from "./definitions";
import { LUMIAH_TOOL } from "./definitions/lumiah";
import { jobEnv } from "./jobs";
import { briefLines, markerNonce, placeParts, withoutBrief } from "./markers";
import { type AnchorRow, anchorsOf, departuresOf, findTurn, noPartOf, recHarnessOf, unplayedOf } from "./record";
import type { ChatClaim, ClaimAsk, DefinitionsAsk, ExtensionDefinitions, HarnessExtension, JobView, ModelMessage, RemoteTool, RemoteToolCall, ReplyWritten, RunBegan, RunEnded, StorySetting, ToolsPort, WriterRequest } from "./shapes";
import { Cast, type Ceiling, closedAnswer, OpenTurn, reach, type Standing, standingOf, toolRefusal, type TurnCall } from "./turn";

/** The Outline section's slot: where the author's brief goes. */
const OUTLINE_SLOT = "outline";

/** Sovereign Hand as the harness's settings have it (`agents.harness.sovereignHand`), as the claim's word on whose messages are the chat's story. */
const SOVEREIGN_FROM: Readonly<Record<SovereignHand, StorySetting["from"]>> = { follow: "lumiverse", on: "replies", off: "everyone" };

/** What the author is given of the player's newest message under Sovereign Hand (`agents.harness.newestMessage`), as the claim's word. */
const NEWEST_GIVEN: Readonly<Record<NewestMessage, StorySetting["newest"]>> = { direction: "directive", leave_out: "leave_out" };

/** The family of each tool the engine lists, by its name. */
const FAMILY: ReadonlyMap<string, string> = new Map(HARNESS_LISTED.map((t) => [t.name, t.family]));

/** Why the harness can't be chosen in a build that doesn't carry LumiAH, and what to do. The chat page shows it as it stands, so it is no model's text. */
const NOT_BUILT_IN = "This build of LumiRPEngine doesn't include the harness yet. Update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine), then choose Harness here.";

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

/** A run as its calls are served once no turn takes them: a job's, or what an agent of a turn still calls after its reply. Its agents are the run's own, from its first call to its last (`Cast`). */
interface SideRun {
  chatId: ChatId;
  userId: UserId;
  cast: Cast;
  staged: Map<string, "auto" | "confirm">;
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
  /** Each job the engine was told of, by its id: the turn it belongs to (LumiAH's `JobView.basis`), and who started it where LumiAH said: the agent, by its handle in the run it was of, and the job that run was, if it was a job's. */
  private readonly jobs = new Map<string, { basis: string; by: string | null; parent: string | null }>();
  /** Whose each chat is, as its guard last said. */
  private readonly owners = new Map<ChatId, UserId>();
  /** The opening a chat's core is planning now, and the consequences its commit reads: set around the core's own synchronous steps, inside the chat's queue. */
  private readonly plans = new Map<ChatId, (input: PlanInput) => LedgerEvent[]>();
  private readonly reads = new Map<ChatId, (input: ReadInput) => LedgerEvent[]>();
  private readonly closing = new Map<string, Closing>();
  /** The side sessions' turns under way, by the turn's id: a conversation with an agent that is no reply and no job. */
  private readonly talks = new Map<string, { chatId: ChatId; userId: UserId }>();
  /** The chats LumiAH is known to be switched on for since this backend started. */
  private readonly pinned = new Map<ChatId, true>();

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
   * LumiAH's own switch for a chat: turns it on when the chat is switched to the harness, and off
   * when it is switched away (HARNESS-SLICE3: "One control in the UI, not two"). Whoever mounts
   * LumiAH sets it. Until then nothing can play a harness chat, so none can be chosen (`blocked`).
   */
  pin: ((chatId: ChatId, userId: UserId, harness: boolean) => Promise<void>) | null = null;

  /**
   * Why LumiAH can't play a user's chats now, in words that say what to do about it (a permission
   * they haven't granted, a Lumiverse too old for it); null where it can. Whoever mounts LumiAH sets
   * it, from what LumiAH's own backend reports.
   */
  ready: ((userId: UserId) => Promise<string | null>) | null = null;

  /** Why a chat can't be switched to the harness now, and what to do; null where it can. GM → This chat → Engine says it under the switch, and a request to switch is refused with it. */
  async blocked(userId: UserId): Promise<string | null> {
    if (this.pin === null) return NOT_BUILT_IN;
    return (await this.ready?.(userId)) ?? null;
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
      writerRequest: (request) => this.writerRequest(request),
      runBegan: (run) => this.runBegan(run),
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

  /**
   * `HarnessHooks.plays`: the chat's own choice, as it stands. A chat the harness plays is one
   * LumiAH is switched on for: the two are set together (`choose`), but a chat that came by its
   * choice another way (a Branch copies it with the chat) is switched on here, before its prompt
   * is assembled, so its first reply is played like any other.
   */
  async plays(chatId: ChatId, userId: UserId): Promise<boolean> {
    this.remember(this.owners, chatId, userId);
    if ((await this.rt.chatKnowledge.engine(chatId, userId)) !== "harness") return false;
    if (this.pin !== null && !this.pinned.has(chatId)) {
      try {
        await this.pin(chatId, userId, true);
        this.remember(this.pinned, chatId, true);
      } catch (error) {
        // Its replies are then written with no turn played, and each says so: the reason is here.
        this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId} plays on the harness, which couldn't be switched on for it (${error instanceof Error ? error.message : String(error)})`, userId);
      }
    }
    return true;
  }

  /**
   * Chooses the engine that plays a chat (GM → This chat → Engine), whole: LumiAH's own switch for
   * the chat follows the choice, so the two never disagree and the player has one control
   * (HARNESS-SLICE3). The harness is chosen only where LumiAH can play the chat, and its switch
   * goes on before the choice is kept, so a chat is never left on a harness nothing plays; it goes
   * off once another engine's choice is kept. A turn finishes on the engine it started on: while
   * one waits at a gate, what it kept for its resume would be lost, so the switch waits for it.
   * Refused (`EngineRefused`) in words that say what to do.
   */
  async choose(chatId: ChatId, userId: UserId, engine: ChatEngine): Promise<ChatKnowledgePrefs> {
    this.remember(this.owners, chatId, userId);
    const stay = "This chat stays on the engine it has.";
    if (engine === "harness") {
      const blocked = await this.blocked(userId);
      if (blocked !== null) throw new EngineRefused("unavailable", `${blocked} ${stay}`);
    }
    if (engine !== (await this.rt.chatKnowledge.engine(chatId, userId))) {
      const waiting = await this.rt.gateWaiting(chatId, userId);
      if (waiting !== null) throw new EngineRefused("conflict", `This chat's turn is waiting on ${waiting}. Answer or cancel it before you switch the engine: a turn finishes on the engine it started on.`);
    }
    if (engine === "harness") {
      try {
        await this.pin?.(chatId, userId, true);
        this.remember(this.pinned, chatId, true);
      } catch (error) {
        throw new EngineRefused("unavailable", `${error instanceof Error ? error.message : String(error)} ${stay}`);
      }
    }
    const prefs = await this.rt.chatKnowledge.set(chatId, userId, { engine: engine === "classic" ? null : engine });
    // A turn under way finishes on the engine and choices it started with (`TurnFrame`): the change applies from the chat's next turn.
    this.rt.push.changed(chatId, userId);
    if (engine !== "harness") {
      this.pinned.delete(chatId);
      await this.pin?.(chatId, userId, false);
    }
    return prefs;
  }

  /**
   * A chat has just been given its world: it plays on the harness from its first turn, where the
   * harness can play it, with nothing for the player to set up. Where it can't, the chat plays its
   * classic steps, and GM → This chat → Engine says why and what to do. The chats made before keep
   * the engine they had: only a chat's first attach comes here.
   */
  async adopt(chatId: ChatId, userId: UserId): Promise<void> {
    if ((await this.blocked(userId)) !== null) return;
    try {
      await this.choose(chatId, userId, "harness");
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the new world chat stays on its classic steps (${error instanceof Error ? error.message : String(error)})`, userId);
    }
  }

  // ---------------------------------------------------------------- what LumiAH is given

  /** The engine's agent definitions and skills for a user, in their own words where they wrote them; the shipped ones where the call names no user. */
  private async definitions(ask: DefinitionsAsk): Promise<ExtensionDefinitions> {
    return harnessDefinitions(ask.userId !== "" ? (await this.rt.settings.get(ask.userId)).prompts.texts : {});
  }

  /**
   * What the engine supplies for a chat: its author as the main agent and the world's guidance, for
   * a world chat on the harness; nothing for any other, which LumiAH answers itself. LumiAH's own
   * lore tools give way to the engine's there (`LUMIAH_LORE`).
   *
   * Four things head the guidance when they apply. Guidance heads an agent's instructions, so each
   * is the first thing the run's author reads, and a level cut for its length (LumiAH's setting)
   * keeps it:
   * - The run's story is the model's replies alone (Sovereign Hand, as the claim's own word on the
   *   story and what holds without it resolve, `storyHolds`): the player's message is a direction,
   *   which the author carries out through its tools.
   * - The turn before was still being recorded when this run began, and the wait for it ran out
   *   (Settings: `agents.harness.commitWaitMs`). A turn's tail never holds the player, so the run
   *   goes on, and its author knows the last turn's changes may not all be in.
   * - The reply the turn follows stands with no turn played: the author reads it first and records
   *   what it established.
   * - The reply the turn follows says something against what its turn decided (`departuresOf`):
   *   the world kept the turn's, and the author steers the story back to it unless the player asks
   *   otherwise.
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
    const last = lastReply(head);
    const unplayed = unplayedBefore(last, texts);
    const departed = departuresOf(last);
    // The claim's word on what counts as the chat's story: whose messages are, as Sovereign Hand is set for the harness, and what of the newest the author is given. Whether a hidden message is read is LumiAH's own setting.
    const story: Partial<StorySetting> = { from: SOVEREIGN_FROM[settings.agents.harness.sovereignHand], newest: NEWEST_GIVEN[settings.agents.harness.newestMessage] };
    // What the run reads as its story is known now, before the guidance is read: the claim's word stands over what holds without it, and following Lumiverse is its Sovereign Hand switch as LumiAH read it (off where Lumiverse doesn't say).
    const directed = (story.from === "lumiverse" ? (ask.sovereignHand === true ? "replies" : "everyone") : story.from) === "replies";
    const first = [
      ...(directed ? [renderPrompt(HARNESS_TEXT.sovereign, texts, {})] : []),
      ...(whole ? [] : [renderPrompt(HARNESS_TEXT.behind, texts, {})]),
      ...(unplayed !== null ? [renderPrompt(HARNESS_TEXT.unplayed, texts, { why: unplayed })] : []),
      ...(departed.length > 0 ? [renderPrompt(HARNESS_TEXT.departed, texts, { lines: departed.map((line) => `- ${line}`).join("\n") })] : []),
    ].filter((text) => text.trim() !== "");
    const mine = new Set(harnessTools({ world: head.world, registry: this.rt.registry, texts }).map((tool) => tool.name));
    return { mainAgent: HARNESS_AGENT.author, guidance: first.length > 0 ? { ...guidance, text: `${first.join("\n\n")}\n\n${guidance.text}` } : guidance, withdraw: LUMIAH_LORE.filter((name) => !mine.has(name)), story };
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
    // A person's own mind reads through its own tools alone, whatever its definition was given: the read view has no one person's point of view, so any other tool would show it what that person doesn't know.
    const family = FAMILY.get(call.name);
    if (call.role === HARNESS_AGENT.character && family !== undefined && family !== HARNESS_FAMILY.mind) return { text: say(HARNESS_NOTE.mindOnly, { tool: call.name }), error: true };
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
    const own = this.turns.get(call.turn);
    if (own && !own.closed) {
      const mine: TurnCall = { agent: own.cast.of(call), tool: call.name, ceiling: null, files: this.files?.({ chatId: own.chatId, userId: own.userId }) ?? null };
      return { env: () => own.env(mine, signal), standing: own.standing(mine.agent), frame: own.frame };
    }
    // A side session's turn: a conversation with an agent, tied to no reply. It reads the chat as it stands, as its definition reads; what more it may do is whoever started it's to give (`sideEnv`), and no agent of it is an author.
    if (this.talks.has(call.turn)) {
      if (!userId || call.chatId === "") return { text: say(HARNESS_NOTE.noTurn), error: true };
      const given = (await this.sideEnv?.({ call, userId, signal })) ?? { env: this.reading(call, userId, signal), tier: "read" as RoleTier };
      return { env: () => given.env, standing: { own: given.tier, over: "gm", under: null, author: false, def: call.role }, frame: null, ...(given.answered ? { answered: given.answered } : {}) };
    }
    // A job's run, or what an agent of a turn still calls once its reply is saved: the turn whose record it belongs to.
    const job = this.jobs.get(call.turn);
    const known = job?.basis ?? (own || this.over.has(call.turn) ? call.turn : null);
    if (!userId || (known === null && !this.sides.has(call.turn))) return { text: say(HARNESS_NOTE.noTurn), error: true };
    // A run tied to no reply (a job the user or a side session started): it reads the chat as it stands and changes nothing (`jobEnv`).
    const basis = known ?? "";
    const ceiling: Ceiling | null = job ? this.ceilingOf(call.turn) : known === null ? { tier: "read", by: call.turn } : null;
    const files = this.files?.({ chatId: call.chatId, userId }) ?? null;
    const turn = this.turns.get(basis);
    const beside = turn && !turn.closed && turn.replied === null ? this.sides.get(call.turn) : undefined;
    if (turn && beside) {
      const theirs: TurnCall = { agent: beside.cast.of(call), tool: call.name, ceiling, files };
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
    const env = await jobEnv(this.rt, this.review, { chatId: call.chatId, userId, basis, committed: this.over.get(basis)?.committed === true, agent, standing, tool: call.name, files, staged: side.staged, signal });
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
    if (!job || job.by === null || seen.has(id)) return { tier: "read", by: job?.by ?? id };
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
    return { ...base, reader: outsideReader(this.rt, base), writer: null, agent: { role: call.role, id: call.agentId }, signal, files: this.files?.({ chatId: call.chatId, userId }) ?? null };
  }

  /**
   * The writer's request, with the engine's sections where the preset placed them (HARNESS-SLICE3:
   * "Sections where the preset places them"): built now, from the state the author's commits left,
   * with the brief as the Outline, each swapped for the span the guard marked for it (which holds the
   * section as the chat's head had it); one with no span goes, with the others like it, before the
   * player's last message. The brief the core put in goes once the Outline carries it. Whoever
   * writes the reply is sent these: LumiAH's writer, or Lumiverse's own generation.
   *
   * For a generation that is no open harness turn (it never opened, or is over) the sections stay as
   * the chat's head had them and only their marker lines go; null where there are none: as the core
   * built it.
   */
  private async writerRequest(request: WriterRequest): Promise<ModelMessage[] | null> {
    await this.opening.get(request.generationId);
    const turn = this.turns.get(request.generationId);
    const nonce = markerNonce(request.generationId);
    if (!turn || turn.closed) {
      const bare = placeParts(request.messages, null, nonce).messages;
      return bare.length === request.messages.length && bare.every((m, i) => m === request.messages[i]) ? null : bare;
    }
    // As LumiAH last asked: a request it makes with no brief is one the author never handed over.
    turn.briefed = request.brief !== null;
    return inTurn(turn.frame, async () => {
      const fills = await turn.sections(briefLines(request.brief));
      const messages = fills.some((f) => f.slot === OUTLINE_SLOT) ? withoutBrief(request.messages, request.brief) : request.messages;
      return placeParts(messages, fills.map((f) => ({ part: f.slot, text: f.content })), nonce).messages;
    });
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
    // A job's run started again goes on as the run before it left it: who its agents were, and what it wrote.
    if (run.kind === "job") return this.remember(this.sides, run.turn, this.sides.get(run.turn) ?? { chatId, userId, cast: new Cast(run.turn), staged: new Map() });
    // What the turn runs on: as its generation's guard took it, so the whole turn reads one set of settings and choices.
    const frame = this.rt.ledger.harnessFrame(chatId, run.turn) ?? (await this.rt.frame(chatId, userId));
    // Its run begins from the assembled prompt: the book that held the prompt's sections goes back now, before the author works, so no other chat of the world waits on it.
    this.rt.ledger.harnessAssembled(chatId, run.turn);
    const chatRun = await this.rt.runOf(chatId, userId);
    if (frame.chat.engine !== "harness" || !chatRun) return;
    await this.rt.ledger.with(chatId, userId, (core, observed) => inTurn(frame, () => this.open(run.turn, frame, chatRun.runSeed, core, observed)));
    // Agent turns under way, across the user's chats (Settings → Agents → Budgets): the oldest is let go when another starts.
    const mine = [...this.turns.values()].filter((t) => t.userId === userId);
    for (const stale of mine.slice(0, Math.max(0, mine.length - frame.settings.agents.kept.runs))) await this.dropped({ chatId: stale.chatId, userId, generationId: stale.generationId, why: "more turns were under way than the engine keeps" });
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
    });
    this.turns.set(generationId, turn);
  }

  /** The turn's reply was written whole. */
  private async replyWritten(reply: ReplyWritten): Promise<void> {
    const turn = this.turns.get(reply.turn);
    if (turn) turn.replied = reply.reply;
  }

  /**
   * A run ended. A turn's that failed or was stopped leaves nothing, whatever its generation then
   * does. One that is done hands the engine LumiAH's own record of the turn, which the turn's record
   * takes: with the reply's commit when that is still to come, else now. The jobs its agents started
   * belong to that record. A job's run stays known when it ends (`sides`): a job its agents started
   * is held to where they stood, and a run of it started again goes on as the same agents.
   */
  private async runEnded(run: RunEnded): Promise<void> {
    if (run.kind === "side") {
      this.talks.delete(run.turn);
      this.sideEnded?.(run);
      return;
    }
    if (run.kind === "job") return;
    // Named by the turn's record alone, a job has its turn and no one who started it: `jobKnown` says who.
    for (const job of run.record?.jobs ?? []) if (!this.jobs.has(job.id)) this.remember(this.jobs, job.id, { basis: run.turn, by: null, parent: null });
    // The reply's text reaches the engine here too, where its run ends before anything else says it was written.
    const open = this.turns.get(run.turn);
    if (open && open.replied === null && run.status === "done") open.replied = run.reply;
    const userId = await this.userOf(run.chatId, run.userId);
    if (!userId) return;
    if (run.status !== "done") {
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

  // ---------------------------------------------------------------- LumiAH's records in the ledger

  /**
   * A job as LumiAH lists it. The turn it belongs to is the turn its writes are tied to, and who
   * started it is who its agents are held to (`ceilingOf`): the agent whose `job_start` made it,
   * and the job that agent was of, where it was a job's own. Whoever mounts LumiAH tells the engine
   * of each job as it starts. One the user started belongs to no turn: nothing is kept of it, and
   * its calls write nothing.
   */
  jobKnown(job: Pick<JobView, "id" | "basis" | "by" | "parent">): void {
    if (job.basis !== null) this.remember(this.jobs, job.id, { basis: job.basis, by: job.by.who === "agent" ? job.by.id : null, parent: job.parent ?? null });
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

  /** `HarnessHooks.markers`. */
  markers(input: { chatId: ChatId; userId: UserId; generationId: string }): Promise<Delivered> {
    return this.rt.harnessMarkers(input);
  }

  /** The gate card `turn` of a chat was answered (`lre.review`, or its chip): a harness turn's commit waiting on it goes on. False when no harness turn waits there. */
  reviewed(chatId: ChatId, turn: string): boolean {
    let waited = false;
    for (const open of this.turns.values()) if (open.chatId === chatId && open.answered(turn)) waited = true;
    return waited;
  }

  /**
   * `HarnessHooks.beforeCommit`, inside the chat's queue, the reply saved. The turn takes its last
   * commit and nothing more; what it landed joins the journal's planned turn. What follows from the
   * turn with no model is made ready for the core's own commit, which reads it (`read`): off-screen
   * catch-up, the turn's tick rules and the story's tracks (`postTurn`), then who was there for the
   * turn and what the world authors that the chat doesn't hold yet (`postOpening`). A Continue has
   * no plan: what it landed is what its read records.
   */
  async beforeCommit(input: TurnContext): Promise<string | null> {
    const { chatId, userId, generationId, core, observed } = input;
    const turn = this.turns.get(generationId);
    if (!turn) return this.blank.has(generationId) ? null : (this.failed.get(generationId) ?? renderPrompt(HARNESS_TEXT.unplayedNoRun, (await this.rt.settings.get(userId)).prompts.texts, {}));
    // The reply was written with nothing handed over from the turn: its author failed, ran out of time or was stopped in the harness before it briefed the writer, and LumiAH let the reply be written without it. Nothing of the turn stands, as for a run that was stopped; LumiAH's own words for why reach the mark with its record (`anchor`).
    if (!turn.briefed) {
      const why = renderPrompt(HARNESS_TEXT.unplayedNoBrief, turn.frame.settings.prompts.texts, {});
      await this.dropped({ chatId, userId, generationId, why });
      return why;
    }
    const events = await turn.close();
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
    const p = core.journal.pending[generationId];
    if (p && turn.prompts !== null) p.prompts = turn.prompts;
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
   * ended, and the default tick when the turn took one. A Continue keeps the lines of departure the
   * reply holds: the reply still says what they are about. The turn closes: which role wrote what,
   * the kept files it changed, its review card.
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
      const harness: RecHarness = { turns: [...(turn.continues ? (held?.turns ?? []) : []), generationId], ...(record ? { record } : {}), ...(close.defaultTick !== null ? { defaultTick: close.defaultTick } : {}), ...(turn.continues && held?.departures ? { departures: held.departures } : {}) };
      const refused = core.recordHarness(messageId, swipeId, harness, observed);
      if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the turn's record doesn't name its harness turn (${refused})`, userId);
      else this.recorded?.(chatId);
    } finally {
      // The turn stays known until its record names it, so a call that came meanwhile finds the one or the other. Its agents are the same agents in what they still call: the turn's own cast serves its tail, and none is made again.
      this.remember(this.over, generationId, { chatId, userId, committed: true, settled: turn.settled.promise });
      this.remember(this.sides, generationId, { chatId, userId, cast: turn.cast, staged: new Map() });
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
