// The GM assistant on a chat the harness plays (HARNESS-SLICE3 "Boundary with LumiAH"; DESIGN §4.5):
// where its answers come from. GM → Assistant keeps its page, its protocol and its thread on every
// chat (`agents/assistant.ts`). On a harness chat the engine makes no model call of its own, so the
// answer is LumiAH's: a side session of the chat's, one per thread, with the agent that stands in
// for the assistant there. This is that side of an answer (`SideAnswers`), over the ports the
// harness engine gives whoever follows a side session (`HarnessEngine.core`, `sideEnv`, `sideEnded`):
//
// - The session. The thread names it; it is that one while LumiAH still lists it among this chat's,
//   and one started now where it doesn't: the first message, a session removed on LumiAH's own
//   page, or a Branch, whose thread names the session of the chat it came from.
// - A turn. `side.send` answers with the turn's id at once, and the turn runs in the background. The
//   calls its agent makes of the engine's tools reach `sideEnv`, which gives the session's own agent
//   what the assistant's tools run with on any chat: the GM's view of the chat's head, and the
//   writer whose dry runs the answer collects, at the GM tier. A call never writes, and each is a
//   row of the answer's trace once it is answered. An agent that one starts only reads, as any side
//   session's does. LumiAH's own tools (the chat, its workspace) never come here: they are in
//   LumiAH's trace of the turn, not the answer's.
// - Its end. LumiAH says how every side turn ended (`sideEnded`): a turn that is done gives the
//   answer; one that was stopped is a cancelled answer and one that failed a failed one, each with
//   LumiAH's own reason.
// - Cancel stops the turn where LumiAH runs it built in. A turn it can't stop from here (it runs in
//   the user's runtime, or was lost) is over for the thread all the same, as cancelled, and what its
//   agent still calls then only reads.
//
// Nothing here calls a model, and nothing here waits on a clock.

import { STOP_TEXT } from "../../shared/agent-failures";
import type { RoleTier } from "../../shared/agent-roles";
import { HARNESS_AGENT } from "../../shared/harness-texts";
import type { ChatId, UserId } from "../../shared/ids";
import { isRecord, type JsonValue, safeKey } from "../../shared/json";
import type { AssistantStatus, TraceRow } from "../../shared/protocol";
import { type Answered, type AnswerTools, argsInShort, AssistantError, type SideAnswers, type SideTurn } from "../agents/assistant";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { HarnessCore, SideEnvOf } from "./extension";
import type { RunEnded, TurnStatus } from "./shapes";

/**
 * The definition the assistant's side session is with (`definitions/`). Its instructions and its
 * tool list are that definition's, the user's own where they changed them: nothing of them is
 * decided here.
 */
const ASSISTANT_AGENT: string = HARNESS_AGENT.assistant;

/**
 * The writer tier the session's own agent calls at: the game master's, as the assistant's on any
 * chat (`agents/assistant.ts`, its tiers). It is the assistant's standing, not a limit to set: what
 * it may change is held by each change type's mode, and every change waits for the user's Apply.
 */
const TIER: RoleTier = "gm";

/** How a side turn's end reads in the thread. */
const STATUS: Readonly<Record<TurnStatus, AssistantStatus>> = { done: "answered", stopped: "cancelled", failed: "failed" };

/** What a turn that ended here, with nothing heard from LumiAH, spent as far as the engine knows. */
const NOTHING_SPENT: Answered["usage"] = { in: 0, out: 0, cachedIn: 0 };

/**
 * Why the assistant can't answer a harness chat where LumiAH isn't there to ask (it couldn't be
 * built in when the extension started, or this build has none), and what to do. The page shows it
 * as it stands, so it is no model's text.
 */
const NOT_RUNNING =
  "This chat plays on the harness, and the harness isn't running in this LumiRPEngine, so the GM assistant has no one to ask here. Reload or update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine), or switch this chat to another engine (GM → This chat → Engine), where the assistant answers with its own model.";

/** What an answer of LumiAH's that doesn't read as one is refused with: the two are from different builds. */
const unreadable = (what: string): string => `The harness answered without ${what}, so the GM assistant can't go on here. Update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine): its harness and its assistant should be one build.`;

/**
 * What LumiAH answers to one thing asked of it, or its refusal as the page is told it: what it
 * didn't do, then its own words, which say what to do (a runtime to start, an answer to wait for,
 * an agent switched off).
 */
async function asked(what: string, ask: () => Promise<JsonValue>): Promise<JsonValue> {
  try {
    return await ask();
  } catch (error) {
    throw new AssistantError(isRecord(error) && error.code === "conflict" ? "conflict" : "unavailable", `The harness didn't ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A side turn that is the assistant's, while it is under way. */
interface Live {
  chatId: ChatId;
  userId: UserId;
  turn: string;
  tools: AnswerTools;
  /** Ends when the answer is cancelled in the thread. */
  signal: AbortSignal;
  /** Its agent's calls of the engine's tools, in the order they were answered. */
  trace: TraceRow[];
  /** The turn is over for the thread: once, however often it is said. */
  end(said: Omit<Answered, "trace">): void;
}

export class SideAssistant implements SideAnswers {
  /** The assistant's turns under way, by the turn's id. */
  private readonly turns = new Map<string, Live>();
  /** The chats a message is being sent in. Its turn's id is known once LumiAH answers the send, and the turn may call a tool or end before that: what comes for a turn of that chat meanwhile waits here. */
  private readonly sending = new Map<ChatId, Promise<void>>();

  constructor(private readonly rt: Runtime) {
    rt.harness.sideEnv = this.env;
    rt.harness.sideEnded = (run) => void this.ended(run);
  }

  private core(): HarnessCore {
    const core = this.rt.harness.core;
    if (core === null) throw new AssistantError("unavailable", NOT_RUNNING);
    return core;
  }

  /** Whether LumiAH lists `session` among this chat's side sessions, with the assistant's agent. */
  private async listed(core: HarnessCore, at: { chatId: ChatId; userId: UserId }, session: string): Promise<boolean> {
    const list = await asked("list this chat's conversations", () => core.ask(at.userId, "sides.list", { chatId: at.chatId }, { chat: at.chatId }));
    const rows: unknown[] = isRecord(list) && Array.isArray(list.sides) ? list.sides : [];
    return rows.some((row) => isRecord(row) && row.id === session && row.agent === ASSISTANT_AGENT);
  }

  async session(input: { chatId: ChatId; userId: UserId; kept: string | null }): Promise<string> {
    const core = this.core();
    const { chatId, userId, kept } = input;
    if (kept !== null && (await this.listed(core, input, kept))) return kept;
    const started = await asked("start the GM assistant's conversation", () => core.ask(userId, "sides.start", { chatId, agent: ASSISTANT_AGENT }, { chat: chatId }));
    const id = isRecord(started) && isRecord(started.side) ? started.side.id : undefined;
    if (!safeKey(id)) throw new AssistantError("unavailable", unreadable("the conversation it started"));
    return id;
  }

  async send(input: { chatId: ChatId; userId: UserId; session: string; text: string; tools: AnswerTools; signal: AbortSignal }): Promise<SideTurn> {
    const core = this.core();
    const { chatId, userId } = input;
    // What a Cancel stops the turn with, in the user's words, as a cancelled answer of the engine's own agent says it: read now, so that Cancel waits on nothing.
    const cancelled = renderPrompt(STOP_TEXT.cancelled, (await this.rt.settings.get(userId)).prompts.texts, {});
    const sending = Promise.withResolvers<void>();
    this.sending.set(chatId, sending.promise);
    try {
      const sent = await asked("take your message", () => core.ask(userId, "side.send", { session: input.session, text: input.text }, { chat: chatId }));
      const turn = isRecord(sent) && typeof sent.turn === "string" ? sent.turn : "";
      if (turn === "") throw new AssistantError("unavailable", unreadable("the turn your message began"));
      const ended = Promise.withResolvers<Answered>();
      const live: Live = {
        chatId,
        userId,
        turn,
        tools: input.tools,
        signal: input.signal,
        trace: [],
        end: (said) => {
          if (this.turns.get(turn) !== live) return;
          this.turns.delete(turn);
          // The rows as they stand now: a call still running when the turn ended is answered to no one.
          ended.resolve({ ...said, trace: [...live.trace] });
        },
      };
      this.turns.set(turn, live);
      return { turn, ended: ended.promise, stop: () => this.stop(live, cancelled) };
    } finally {
      if (this.sending.get(chatId) === sending.promise) this.sending.delete(chatId);
      sending.resolve();
    }
  }

  async remove(input: { chatId: ChatId; userId: UserId; session: string }): Promise<void> {
    const core = this.core();
    if (!(await this.listed(core, input, input.session))) return;
    await asked("remove the GM assistant's conversation", () => core.ask(input.userId, "sides.remove", { id: input.session }, { chat: input.chatId }));
  }

  /** Cancel. LumiAH ends a turn it stops and says so (`sideEnded`), with `why` as its reason. */
  private stop(live: Live, why: string): void {
    if (this.turns.get(live.turn) !== live) return;
    if (this.rt.harness.core?.stop(live.userId, live.turn, why)) return;
    // Not a turn under way here: it runs in the user's runtime, which this port doesn't reach, or it is gone. Nothing would say how it ended, so it ends here.
    live.end({ status: "cancelled", text: "", reason: why, usage: NOTHING_SPENT });
  }

  /** `HarnessEngine.sideEnded`, for every side session's turn: one of the assistant's is the answer the thread waits for. */
  private async ended(run: RunEnded): Promise<void> {
    await this.sending.get(run.chatId);
    this.turns.get(run.turn)?.end({ status: STATUS[run.status], text: run.status === "done" ? run.reply : "", ...(run.reason !== undefined ? { reason: run.reason } : {}), usage: run.usage });
  }

  /**
   * `HarnessEngine.sideEnv`, for every tool call of a side session's turn. The session's own agent,
   * in a turn that is the assistant's and still under way, is given the assistant's tools' env and
   * tier, and its call a row in the answer's trace once it is answered. Any other call is none of the
   * assistant's: an agent the session's own started, a turn already cancelled here, or another
   * side session altogether.
   */
  private readonly env: SideEnvOf = async ({ call, userId, signal }) => {
    await this.sending.get(call.chatId);
    const live = this.turns.get(call.turn);
    if (!live || live.userId !== userId || live.chatId !== call.chatId || !call.main) return null;
    const began = Date.now();
    return {
      env: { userId, chatId: call.chatId, ...live.tools, agent: { role: call.role, id: call.agentId }, signal: AbortSignal.any([signal, live.signal]), files: this.rt.harness.files?.({ chatId: call.chatId, userId }) ?? null },
      tier: TIER,
      answered: (out) => void live.trace.push({ tool: call.name, summary: argsInShort(call.args), ...(out.error ? { error: out.text } : {}), ms: Date.now() - began }),
    };
  };
}
