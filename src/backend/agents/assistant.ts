// The GM assistant (DESIGN §4.5; AGENT-LOOP-PLAN §9-§11; INC1-SPEC R6a, C8): GM → Assistant, the game
// master's chat with the GM agent about a chat's world, and GM → Workspace's reads and writes.
//
// The thread lives in the chat's metadata (`ChatAgentMeta`, `lumi_rp_engine.agents.assistant`): each
// message and each proposal is a blob, so a Branch keeps the thread as it stood and the sweep keeps
// what any chat's thread names. Each send starts an agent (`startAgent`) on Settings → Agents →
// Assistant: the read and GM tiers of the tool layer (`toolsFor`), reading the world with the
// assistant's knowledge, and a writer whose dry runs the answer collects as its proposal; the thread's
// latest exchanges go with it, as many as History tokens holds and only those written under the same
// knowledge as the assistant's now or a narrower one, the others left out with a note saying how
// many. Each message and proposal keeps the knowledge it was written under. The answer runs in the
// background: the request answers at once, and each change to the thread is pushed
// (`lre.assistant.update`) to the pages that asked about that chat's assistant, GM data shown only
// behind the GM gate.
//
// A proposal waits for Apply (all of it, or a pick) or No; with Apply set to at once it applies as
// soon as its answer is in, unless one of its changes is of a type that asks first. Applied, it is
// one GM edit with its Undo chip, held while the engine runs a turn (`outsideWriter`: `hold: true`),
// written with the wider of the knowledge it was proposed under and the assistant's then. Its write
// runs outside the thread's lock, so Cancel and the rest of the thread never wait on it. Cancel
// stops the answer; its limits are the assistant's budget over every agent's, the loop detector the
// runtime's. Each call is a Diagnostics agent record (a connection's refusal of native tools among
// them), and while it answers the chat's activity line shows the assistant's label and nothing else.

import { AGENT_ROLES, type AgentSettings, type AssistantApply, assistantBudget } from "../../shared/agent-settings";
import { type AgentKnowledge, isAgentKnowledge, knowledgeWithin, widerKnowledge } from "../../shared/agent-tools";
import { STEP_LABEL } from "../../shared/diagnostics";
import type { ChatId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { PromptTexts } from "../../shared/prompts";
import { GM_TEXT } from "../../shared/prompts";
import type { AssistantMessage, AssistantProposal, AssistantProposalOp, AssistantRequest, AssistantRun, AssistantView, ResultBodies, TraceRow, WorkspaceRequest } from "../../shared/protocol";
import { PROTOCOL_VERSION, WRITE_REFUSED } from "../../shared/protocol";
import type { ErrorCode } from "../../shared/protocol";
import { tokensOf } from "../book";
import { messageOf } from "../diagnostics";
import { toChain } from "../ledger-io";
import { renderPrompt } from "../prompts";
import { ACTIVE_CONNECTION, type LandedWrites, type Runtime } from "../runtime";
import { recordOutcome } from "../settings-store";
import { fixChip } from "../view";
import { activeRecord } from "../../engine/ledger/path";
import { AGENT_CHANGE_TYPES } from "../../shared/settings";
import { nounFor } from "../../shared/words";
import { askRollback, sessionView } from "./compaction";
import { type AgentHandle, type AgentHistoryMessage, type AgentReply, type AgentTool, type AgentTranscript, startAgent } from "./runtime";
import { outsideReader } from "./tools/read-view";
import { type ToolTier, toolsFor } from "./tools/registry";
import { listWorkspace, readWorkspaceFile } from "./tools/workspace";
import { type AgentOp, batchKey, GM_ROLE, isLearnedOp, type OpPreview, outsideWriter, type ToolWriter } from "./tools/writer";
import { recordAgentCalls } from "./transcripts";
import { emptyUsage } from "./usage";

/** The assistant's role: its id in `AGENT_ROLES`, its budget's and caching's key, and its Diagnostics records' role. */
export const ASSISTANT_ROLE = "assistant";

/** Its name as Settings → Agents gives it: the label its applied edits carry. */
const ROLE_LABEL = AGENT_ROLES.find((r) => r.id === ASSISTANT_ROLE)?.label ?? ASSISTANT_ROLE;

/** What the running row and the activity line show while it answers, and nothing else. */
const RUN_LABEL = STEP_LABEL.assistant ?? ROLE_LABEL;

/** The tool tiers it works with (INC1-SPEC R6a): every read, and the GM's edits as proposals. */
const TIERS: readonly ToolTier[] = ["read", "gm"];

/** The label GM → Workspace's own writes carry on their entry (GM-only). */
const WORKSPACE_LABEL = "GM → Workspace";

/** A request the assistant refuses, with the protocol's error code for it. */
export class AssistantError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

/** A message as its blob holds it, with the knowledge it was written under (absent: one kept before that was, taken as the GM's). */
interface StoredMessage extends AssistantMessage {
  v: 1;
  knowledge?: AgentKnowledge;
}

/** A change of a proposal as its blob holds it: the view's, with the operation Apply sends. */
interface StoredOp extends AssistantProposalOp {
  op: AgentOp;
}

/** A proposal as its blob holds it: the view's, with each change's operation, the agent that proposed it and the knowledge it was proposed under (absent: taken as the GM's). */
interface StoredProposal extends Omit<AssistantProposal, "ops"> {
  v: 1;
  agentId: string;
  ops: StoredOp[];
  knowledge?: AgentKnowledge;
  /** The connection its change types' modes and learning are keyed by: the one it was proposed on. */
  connection?: string;
  /** While its write is held for a turn: that write's key (`batchKey`), by which its Undo chip is named once it lands. */
  batch?: string;
  /** While a later Apply's write is held (one sending again what a turn refused): the keys of the changes it sent, the only ones that count when it settles. */
  again?: string[];
}

/** A blob of the thread and what it holds. */
interface Kept<T> {
  hash: string;
  value: T;
}

/** An answer under way. */
interface Run {
  /** Its own id, for the activity line. */
  id: string;
  agentId: string;
  label: string;
  startedAt: number;
  /** What its calls have spent so far. */
  tokens: { in: number; out: number };
  /** Ends its tools' work (`ToolEnv.signal`) and its send. */
  controller: AbortController;
  handle: AgentHandle | null;
}

/** A chat's thread as this service holds it while it works on it: read from the chat's metadata, kept current by its own writes. */
interface Thread {
  key: string;
  chatId: ChatId;
  userId: UserId;
  messages: Kept<StoredMessage>[];
  proposals: Kept<StoredProposal>[];
  run: Run | null;
}

/** What an answer needs once it is under way. */
interface Ask {
  handle: AgentHandle;
  /** The message as the agent is sent it (with the note on left-out messages when no earlier one goes). */
  text: string;
  /** The changes its edit tools' dry runs checked, by operation key, each once. */
  collected: Map<string, { op: AgentOp; preview: OpPreview }>;
  apply: AssistantApply;
  /** The knowledge it reads the world with, kept on its message and its proposal. */
  knowledge: AgentKnowledge;
  /** The connection's id for its records, or "active" for the user's default. */
  connection: string;
  /** The connection its change types' modes and learning are keyed by: its own, else the user's default's id. */
  modes: string;
  model: string | null;
}

/** How a held write settled: landed, with its Undo chip (none when the turn had made it so already), or refused, with why. */
type Settled = { chipId: string | null } | { refused: string };

const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

/**
 * What of the thread goes with a new message (Settings → Agents → Assistant, History tokens): its
 * exchanges, a message of yours with the answer to it, the newest first, as many as fit in `tokens`
 * by the engine's token estimate, and only those written under `knowledge` or a narrower one (a
 * message kept before its knowledge was, as the GM's); one whose answer said nothing (cancelled
 * before a word) goes with none. `left`: how many of the thread's messages aren't sent, which the
 * note counts.
 */
export function historyOf(messages: readonly (AssistantMessage & { knowledge?: AgentKnowledge })[], tokens: number, knowledge: AgentKnowledge): { history: AgentHistoryMessage[]; left: number } {
  const readable = (m: { knowledge?: AgentKnowledge }): boolean => knowledgeWithin(m.knowledge ?? "gm", knowledge);
  const exchanges: { user: string; answer: string }[] = [];
  for (const [at, m] of messages.entries()) {
    const next = messages[at + 1];
    if (m.role === "user" && next?.role === "assistant" && next.text.trim() !== "" && readable(m) && readable(next)) exchanges.push({ user: m.text, answer: next.text });
  }
  const kept: typeof exchanges = [];
  let used = 0;
  for (const e of exchanges.toReversed()) {
    used += tokensOf(e.user) + tokensOf(e.answer);
    if (used > tokens) break;
    kept.unshift(e);
  }
  return { history: kept.flatMap((e): AgentHistoryMessage[] => [{ role: "user", text: e.user }, { role: "assistant", text: e.answer }]), left: messages.length - kept.length * 2 };
}

/** An answer's tool calls, in the order they ran, from the agent's transcript. */
function traceOf(t: AgentTranscript): TraceRow[] {
  const args = new Map<string, JsonObject>();
  const rows: TraceRow[] = [];
  for (const e of t.entries) {
    if (e.kind === "answer") for (const call of e.calls) args.set(call.id, call.args);
    else if (e.kind === "result") {
      // Its arguments in short: each name with its value as JSON.
      const summary = Object.entries(args.get(e.callId) ?? {})
        .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
        .join(", ");
      rows.push({ tool: e.name, summary, ...(e.error ? { error: e.text } : {}), ms: e.ms });
    }
  }
  return rows;
}

function storedMessageOf(raw: JsonValue | null): StoredMessage | null {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.id !== "string" || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.text !== "string" || typeof raw.at !== "number") return null;
  return raw.knowledge === undefined || isAgentKnowledge(raw.knowledge) ? (raw as unknown as StoredMessage) : null;
}

function storedProposalOf(raw: JsonValue | null): StoredProposal | null {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.id !== "string" || typeof raw.messageId !== "string" || typeof raw.agentId !== "string" || (raw.status !== "open" && raw.status !== "applied" && raw.status !== "rejected") || !Array.isArray(raw.ops)) return null;
  if ((raw.connection !== undefined && typeof raw.connection !== "string") || (raw.batch !== undefined && typeof raw.batch !== "string") || (raw.knowledge !== undefined && !isAgentKnowledge(raw.knowledge))) return null;
  if (raw.again !== undefined && !(Array.isArray(raw.again) && raw.again.every((k) => typeof k === "string"))) return null;
  return raw.ops.every((o) => isRecord(o) && typeof o.key === "string" && isRecord(o.op)) ? (raw as unknown as StoredProposal) : null;
}

/**
 * A proposal whose held write settled: applied, named its Undo chip when it has one; or, refused,
 * each change that write held saying why (`WRITE_REFUSED`), and open again unless a change landed
 * without it: a learned-area change, made at Apply, stands applied, and the proposal with it, whose
 * refused changes a later Apply may send again (`appliable`).
 */
function settledProposal(p: StoredProposal, how: Settled): StoredProposal {
  const { pending: _held, batch: _batch, again: _again, ...rest } = p;
  if (!("refused" in how)) return { ...rest, status: "applied", ...(how.chipId !== null ? { chipId: how.chipId } : {}) };
  const ops = rest.ops.map(({ applied, ...o }): StoredOp => (applied && isLearnedOp(o.op) ? { ...o, applied } : applied ? { ...o, refused: { code: WRITE_REFUSED, reason: how.refused } } : o));
  return { ...rest, status: ops.some((o) => o.applied) ? "applied" : "open", ops };
}

/**
 * The changes an Apply of `p` may send: an open proposal's (all of them: none has landed); an
 * applied one's whose write was refused for when it came (`WRITE_REFUSED`: the turn's close refused
 * it, or a turn landed between its check and its write), while what landed beside it stands. None
 * for one turned down, or held for a turn.
 */
function appliable(p: StoredProposal): StoredOp[] {
  if (p.status === "open") return p.ops.filter((o) => !o.applied);
  if (p.status === "applied" && !p.pending) return p.ops.filter((o) => !o.applied && o.refused?.code === WRITE_REFUSED);
  return [];
}

/**
 * What an applied proposal counts toward the assistant's learning once its changes land: each change
 * it applied as accepted, each one its pick left out as rejected; one refused counts neither way.
 * `only`: a later Apply's changes, the only ones it counts (what landed before it counted then).
 */
function outcomesOf(p: Pick<StoredProposal, "ops">, only?: ReadonlySet<string>): { changeType: string; outcome: "accepted" | "rejected" }[] {
  return p.ops.filter((o) => only === undefined || only.has(o.key)).flatMap((o): { changeType: string; outcome: "accepted" | "rejected" }[] => (o.applied ? [{ changeType: o.changeType, outcome: "accepted" }] : o.refused ? [] : [{ changeType: o.changeType, outcome: "rejected" }]));
}

export class Assistant {
  /** The threads being worked on, by `user \0 chat`: kept while an answer is under way, else only while a request uses one. */
  private readonly threads = new Map<string, Thread>();
  /** Each chat's work in order (`withThread`): one request or answer's change at a time. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /** The pages that asked about each chat's assistant, by `user \0 chat`: its pushes go to them, and to no other page. */
  private readonly watchers = new Map<string, Set<string>>();
  /** Answers under way, for `settle`. */
  private readonly running = new Set<Promise<void>>();
  /** Proposals whose write is under way, by `user \0 chat \0 proposal`: it runs outside the thread's lock, and nothing applies or turns one down meanwhile. */
  private readonly applying = new Set<string>();
  /** Held writes that settled before the Apply that made them took in its result, by `user \0 chat \0 batch`: that Apply settles its proposal from here (`landed`). */
  private readonly early = new Map<string, Settled>();
  private seq = 0;

  constructor(private readonly rt: Runtime) {}

  start(): void {
    // A proposal applied while a turn ran is named its write's Undo chip once that write lands.
    this.rt.onWritesLanded((input) => this.landed(input));
    // A closed page gets no more pushes.
    this.rt.host.on("FRONTEND_SESSION_CLOSED", (e) => {
      for (const [key, sessions] of this.watchers) {
        sessions.delete(e.frontendSessionId);
        if (sessions.size === 0) this.watchers.delete(key);
      }
    });
  }

  /** Resolves once no answer is under way (tests; shutdown). */
  async settle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  /** `lre.assistant` (C8): every op answers the thread as it stands after it. */
  async request(r: AssistantRequest, userId: UserId, session: string | undefined): Promise<AssistantView> {
    const key = `${userId}\u0000${r.chatId}`;
    if (session !== undefined) {
      const sessions = this.watchers.get(key) ?? new Set<string>();
      sessions.add(session);
      this.watchers.set(key, sessions);
    }
    switch (r.op) {
      case "get":
        return this.withThread(r.chatId, userId, async (t) => this.viewOf(t));
      case "send": {
        const text = typeof r.text === "string" ? r.text.trim() : "";
        if (text === "") throw new AssistantError("bad_request", "Write a message for the assistant.");
        return this.withThread(r.chatId, userId, (t) => this.send(t, text));
      }
      case "cancel": {
        // Heard at once, never behind the thread's lock (an Apply's or a save's): the answer ends as
        // soon as its call or tools hear it, as cancelled; its message and the push follow.
        const running = this.threads.get(key)?.run;
        running?.handle?.cancel();
        running?.controller.abort();
        return this.withThread(r.chatId, userId, async (t) => this.viewOf(t));
      }
      case "apply": {
        if (typeof r.proposalId !== "string") throw new AssistantError("bad_request", "Name the proposal to apply.");
        const keys = r.keys;
        if (keys !== undefined && (!Array.isArray(keys) || !keys.every((k) => typeof k === "string"))) throw new AssistantError("bad_request", "Pick changes by their keys.");
        await this.applyProposal(r.chatId, userId, r.proposalId, keys);
        return this.withThread(r.chatId, userId, async (t) => this.viewOf(t));
      }
      case "reject": {
        if (typeof r.proposalId !== "string") throw new AssistantError("bad_request", "Name the proposal to turn down.");
        return this.withThread(r.chatId, userId, async (t) => {
          const p = this.openProposal(t, r.proposalId);
          await this.save(t, { proposals: [{ ...p, status: "rejected" }] });
          await this.learn(t.userId, await this.connectionOf(t.userId, p), p.ops.map((o) => ({ changeType: o.changeType, outcome: "rejected" as const })));
          this.push(t);
          return this.viewOf(t);
        });
      }
      case "clear":
        return this.withThread(r.chatId, userId, async (t) => {
          if (t.run) throw new AssistantError("conflict", "The assistant is still answering: wait for its answer, or Cancel it, before you clear the conversation.");
          // What the thread named is unreferenced now; the sweep removes it once its retention has passed.
          await this.rt.chatAgents.setAssistant(t.chatId, t.userId, () => ({ messages: [], proposals: {} }));
          t.messages = [];
          t.proposals = [];
          this.push(t);
          return this.viewOf(t);
        });
    }
    throw new AssistantError("bad_request", "op must be get, send, cancel, apply, reject or clear");
  }

  /**
   * Runs `fn` on the chat's thread once every change before it for that chat has been made: read
   * from the chat's metadata unless an answer under way holds it. Forgotten again unless an answer
   * runs, so a request after another reads what the metadata holds then.
   */
  private async withThread<T>(chatId: ChatId, userId: UserId, fn: (t: Thread) => Promise<T>): Promise<T> {
    const key = `${userId}\u0000${chatId}`;
    const work = (this.locks.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        let t = this.threads.get(key);
        if (!t) {
          t = { key, chatId, userId, ...(await this.load(chatId, userId)), run: null };
          this.threads.set(key, t);
        }
        try {
          return await fn(t);
        } finally {
          if (t.run === null && this.threads.get(key) === t) this.threads.delete(key);
        }
      });
    this.locks.set(key, work);
    try {
      return await work;
    } finally {
      if (this.locks.get(key) === work) this.locks.delete(key);
    }
  }

  /** The chat's thread as its metadata names it; a blob that is gone or doesn't read is left out, and said in the log. */
  private async load(chatId: ChatId, userId: UserId): Promise<Pick<Thread, "messages" | "proposals">> {
    const { assistant } = await this.rt.chatAgents.get(chatId, userId);
    const messages: Kept<StoredMessage>[] = [];
    const proposals: Kept<StoredProposal>[] = [];
    let lost = 0;
    for (const hash of assistant.messages) {
      const value = storedMessageOf(await this.rt.blobs.getJson(userId, hash));
      if (value) messages.push({ hash, value });
      else lost++;
    }
    for (const hash of Object.values(assistant.proposals)) {
      const value = storedProposalOf(await this.rt.blobs.getJson(userId, hash));
      if (value) proposals.push({ hash, value });
      else lost++;
    }
    if (lost > 0) this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: ${lost} of the GM assistant thread's messages and proposals couldn't be read, so they're left out`, userId);
    return { messages, proposals };
  }

  /**
   * Stores `messages` (after the thread's) and `proposals` (each in its own place, a new one after
   * the rest) as blobs, held until the chat's metadata names them, then names them there and in `t`:
   * all of it, or nothing when the metadata can't be written.
   */
  private async save(t: Thread, change: { messages?: readonly StoredMessage[]; proposals?: readonly StoredProposal[] }): Promise<void> {
    const holder = `assistant:${t.chatId}:${++this.seq}`;
    try {
      const put = async <T>(value: T): Promise<Kept<T>> => ({ hash: await this.rt.blobs.putJson(t.userId, value as unknown as JsonValue, holder), value });
      const messages = await Promise.all((change.messages ?? []).map(put));
      const proposals = await Promise.all((change.proposals ?? []).map(put));
      await this.rt.chatAgents.setAssistant(t.chatId, t.userId, (now) => ({ messages: [...now.messages, ...messages.map((m) => m.hash)], proposals: { ...now.proposals, ...Object.fromEntries(proposals.map((p) => [p.value.id, p.hash])) } }));
      t.messages.push(...messages);
      for (const p of proposals) {
        const at = t.proposals.findIndex((q) => q.value.id === p.value.id);
        if (at >= 0) t.proposals[at] = p;
        else t.proposals.push(p);
      }
    } finally {
      this.rt.blobs.release(t.userId, holder);
    }
  }

  private viewOf(t: Thread): AssistantView {
    const run = t.run;
    const running: AssistantRun | null = run ? { agentId: run.agentId, label: run.label, tokens: { ...run.tokens }, startedAt: run.startedAt } : null;
    // Less the blobs' format and the knowledge each was written under; a proposal also less its agent and its operations, which only Apply sends.
    const thread = t.messages.map(({ value: { v: _v, knowledge: _knowledge, ...m } }): AssistantMessage => m);
    const proposals = t.proposals.map(({ value: { v: _v, agentId: _agent, knowledge: _knowledge, connection: _connection, batch: _batch, again: _again, ops, ...p } }): AssistantProposal => ({ ...p, ops: ops.map(({ op: _op, ...o }) => o) }));
    return { thread, running, proposals };
  }

  /** Sends the thread as it stands to the pages that asked about it, and to no other. */
  private push(t: Thread): void {
    const sessions = this.watchers.get(t.key);
    if (!sessions || sessions.size === 0) return;
    const view = this.viewOf(t);
    for (const session of sessions) this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.assistant.update", chatId: t.chatId, view }, t.userId, session);
  }

  /**
   * Adds your message and starts the agent on it (C8 `send`): one answer at a time per chat. The
   * agent reads the world as it stands now, with the assistant's knowledge; its edit tools only check
   * a change (the writer here collects what they checked) until you apply it.
   */
  private async send(t: Thread, text: string): Promise<AssistantView> {
    if (t.run) throw new AssistantError("conflict", "The assistant is still answering your last message: wait for its answer, or Cancel it.");
    const { chatId, userId } = t;
    const core = await this.rt.ledger.core(chatId, userId);
    const render = core?.renderState(toChain(await this.rt.host.chats.messages(chatId, userId)));
    if (!render) throw new AssistantError("unavailable", "the chat's world revision is not loaded");
    const { world, state } = render;
    const settings = await this.rt.settings.get(userId);
    const agents = settings.agents;
    const own = agents.assistant;
    const texts: PromptTexts = settings.prompts.texts;
    const vars = { world: world.name, pov: state.entities[world.pov]?.name ?? world.pov };
    const system = [renderPrompt(GM_TEXT.system, texts, { ...vars, knowledge: renderPrompt(GM_TEXT.knowledge[own.knowledge], texts, vars) }), renderPrompt(GM_TEXT.instructions, texts, vars)].filter((s) => s.trim() !== "").join("\n\n");
    // The thread's latest exchanges written with as much as it knows now or less go with it; when any are left out, the first message sent says how many.
    const { history, left } = historyOf(
      t.messages.map((m) => m.value),
      own.historyTokens,
      own.knowledge,
    );
    const note = left > 0 ? renderPrompt(GM_TEXT.historyNote, texts, { ...vars, count: String(left), messages: nounFor(left, "message", "messages") }).trim() : "";
    const first = history[0];
    if (note !== "" && first) history[0] = { role: first.role, text: `${note}\n\n${first.text}` };
    const sent = note !== "" && !first ? `${note}\n\n${text}` : text;
    const run: Run = { id: newId("run"), agentId: "", label: RUN_LABEL, startedAt: Date.now(), tokens: { in: 0, out: 0 }, controller: new AbortController(), handle: null };
    // The runtime names each tool run's agent itself; the writer's agent is named once the agent starts.
    const agent = { role: ASSISTANT_ROLE, id: "" };
    // One reader for the whole answer: each tool call reads the chat's head afresh through it, so a turn that lands meanwhile is seen.
    const reads = { userId, chatId, knowledge: own.knowledge };
    const base = { ...reads, reader: outsideReader(this.rt, reads), agent, signal: run.controller.signal };
    // The connection its change types' modes and learning are keyed by (role × connection × type): its own, else your default's.
    const modes = own.connectionId ?? (await this.rt.activeConnectionId(userId));
    const real = outsideWriter(this.rt, { ...base, connectionId: modes });
    const collected = new Map<string, { op: AgentOp; preview: OpPreview }>();
    const writer: ToolWriter = {
      // A change the head would take is the answer's to propose; a later check of the same change replaces it.
      dryRun: async (op) => {
        const preview = await real.dryRun(op);
        if (!("refused" in preview)) collected.set(preview.key, { op, preview });
        return preview;
      },
      apply: async () => {
        throw new Error("the GM assistant's changes land from its proposals, on your Apply, never from its tools");
      },
    };
    const tools = toolsFor({ world, tiers: TIERS, texts, env: { ...base, writer } }).map((tool) => this.watched(t, run, tool));
    const handle = startAgent({ role: ASSISTANT_ROLE, connectionId: own.connectionId, model: own.model, effort: own.effort, system, prefix: [], tools, budget: assistantBudget(agents), history }, { host: this.rt.host, userId, settings: agents, texts, accounts: this.rt.agentAccounts, turn: null });
    run.handle = handle;
    run.agentId = handle.id;
    agent.id = handle.id;
    await this.save(t, { messages: [{ v: 1, id: newId("m"), role: "user", text, at: Date.now(), knowledge: own.knowledge }] });
    t.run = run;
    this.answer(t, run, { handle, text: sent, collected, apply: own.apply, knowledge: own.knowledge, connection: own.connectionId ?? ACTIVE_CONNECTION, modes, model: own.model });
    return this.viewOf(t);
  }

  /** `tool`, pushing the tokens the answer has spent so far before each run: each round of tool calls follows a call. */
  private watched(t: Thread, run: Run, tool: AgentTool): AgentTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      run: (args, ctx) => {
        const used = run.handle?.usage();
        if (used && (used.in !== run.tokens.in || used.out !== run.tokens.out)) {
          run.tokens = { in: used.in, out: used.out };
          this.push(t);
        }
        return tool.run(args, ctx);
      },
    };
  }

  /**
   * The answer, in the background: the agent's send, its calls' Diagnostics records, then its
   * message and its proposal in the thread (a cancelled answer proposes nothing), and, with Apply at
   * once, the proposal applied when the answer is whole and none of its changes asks first.
   */
  private answer(t: Thread, run: Run, ask: Ask): void {
    const { chatId, userId } = t;
    const done = (async () => {
      this.rt.diag.agentWorking(chatId, userId, run.id, run.label);
      this.push(t);
      let reply: AgentReply;
      try {
        reply = await ask.handle.send(ask.text, run.controller.signal);
      } catch (error) {
        reply = { status: "failed", text: "", code: "failed", reason: messageOf(error), usage: emptyUsage() };
      } finally {
        this.rt.diag.agentDone(chatId, userId, run.id);
      }
      const transcript = ask.handle.transcript();
      // Each call the answer made, and how it stopped short of an answer if it did, as Diagnostics agent records outside any turn.
      await recordAgentCalls(this.rt.diag, { at: { chatId, userId, turn: null }, phase: null, role: ASSISTANT_ROLE, connection: ask.connection, model: ask.model ?? null, transcript }).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the GM assistant's calls weren't all recorded (${messageOf(error)})`, userId));
      const atOnce = await this.withThread(chatId, userId, async (u) => {
        try {
          const trace = traceOf(transcript);
          const answer: StoredMessage = {
            v: 1,
            id: newId("m"),
            role: "assistant",
            text: reply.text,
            at: Date.now(),
            ...(trace.length > 0 ? { trace } : {}),
            usage: { in: reply.usage.in, out: reply.usage.out, cached: reply.usage.cachedIn, ...(reply.usage.cacheWrite !== undefined ? { written: reply.usage.cacheWrite } : {}) },
            status: reply.status,
            ...(reply.status !== "answered" && reply.reason ? { reason: reply.reason } : {}),
            knowledge: ask.knowledge,
          };
          const ops = [...ask.collected.values()].map(({ op, preview }): StoredOp => ({ key: preview.key, changeType: preview.changeType, lines: [...preview.lines], mode: preview.mode, op }));
          const proposal: StoredProposal | null = reply.status !== "cancelled" && ops.length > 0 ? { v: 1, id: newId("p"), messageId: answer.id, agentId: run.agentId, status: "open", ops, knowledge: ask.knowledge, connection: ask.modes } : null;
          await this.save(u, { messages: [answer], proposals: proposal ? [proposal] : [] });
          // An answer stopped short leaves its changes for you to look at; one that asks first waits for Apply.
          return proposal && ask.apply === "at_once" && reply.status === "answered" && ops.every((o) => o.mode !== "confirm") ? proposal.id : null;
        } finally {
          u.run = null;
        }
      }).catch((error: unknown) => {
        this.rt.diag.error({ chatId, userId, turn: null }, "assistant", error, "its answer wasn't kept in the thread");
        t.run = null;
        return null;
      });
      this.push(t);
      if (atOnce !== null) await this.applyProposal(chatId, userId, atOnce, undefined).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the GM assistant's changes weren't applied at once (${messageOf(error)}); they wait for Apply`, userId));
    })();
    this.running.add(done);
    void done.finally(() => this.running.delete(done));
  }

  /** The connection a proposal's change types are keyed by: the one it was proposed on, else the assistant's own, else your default's. */
  private async connectionOf(userId: UserId, p: StoredProposal): Promise<string> {
    return p.connection ?? (await this.rt.settings.get(userId)).agents.assistant.connectionId ?? (await this.rt.activeConnectionId(userId));
  }

  /**
   * Counts each change's outcome toward its type's learning, for the assistant's role on `connection`
   * (AGENT-LOOP-PLAN §6: role × connection × type, with D4's thresholds). No chip announces a flip:
   * the chat is a player surface. A failure is logged, and never undoes what was done.
   */
  private async learn(userId: UserId, connection: string, outcomes: readonly { changeType: string; outcome: "accepted" | "rejected" | "undone" }[]): Promise<void> {
    if (outcomes.length === 0) return;
    try {
      const settings = await this.rt.settings.get(userId);
      const learning = await this.rt.settings.learningOf(userId);
      const now = Date.now();
      for (const o of outcomes) {
        const type = AGENT_CHANGE_TYPES.find((t) => t === o.changeType);
        if (type) recordOutcome(settings, learning, connection, type, o.outcome, now, ASSISTANT_ROLE);
      }
      await this.rt.settings.saveLearning(userId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] the GM assistant's changes weren't counted toward what it learns (${messageOf(error)})`, userId);
    }
  }

  /**
   * An applied proposal's Undo, wherever it was pressed (its card, the chat, GM → Edits): the
   * proposal says it was undone, and each change the Undo took back says so and counts as undone
   * toward its type's learning. A change it made in the learned area is no chip's to take back: it
   * stays applied, and counts as it did. A failure here is logged: the Undo stands.
   */
  async undone(chatId: ChatId, userId: UserId, chipId: string): Promise<void> {
    await this.withThread(chatId, userId, async (t) => {
      const p = t.proposals.find(({ value: q }) => q.status === "applied" && q.chipId === chipId && q.undone !== true)?.value;
      if (!p) return;
      const ops = p.ops.map((o): StoredOp => (o.applied && !isLearnedOp(o.op) ? { ...o, undone: true } : o));
      await this.save(t, { proposals: [{ ...p, ops, undone: true }] });
      this.push(t);
      await this.learn(userId, await this.connectionOf(userId, p), ops.filter((o) => o.undone).map((o) => ({ changeType: o.changeType, outcome: "undone" as const })));
    }).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the GM assistant's thread didn't take in an Undo (${messageOf(error)})`, userId));
  }

  /**
   * Writes that settled (`Runtime.onWritesLanded`), heard inside the ledger operation that settled
   * them. A proposal applied while a turn ran is named its write's Undo chip once it lands, read here
   * from the reply it landed on (none when the turn had already made it so), and counts toward what
   * the assistant learns then; one whose write the turn's close refused waits for Apply or No again,
   * each change it held saying why, and counts nothing, unless it made a learned-area change too:
   * that one landed at Apply, so the proposal stays applied and counts what landed. A write that
   * settles before its Apply took in its own result is kept for that Apply to settle (`early`). The
   * thread is pushed after.
   */
  private landed(input: LandedWrites): void {
    const ours = (w: LandedWrites["writes"][number]): string[] => (w.kind === "post" && w.entry.agent?.role === ASSISTANT_ROLE ? [w.entry.agent.key] : []);
    const keys = new Set(input.writes.flatMap(ours));
    const refused = new Map(input.refused.flatMap((r) => ours(r.write).map((key) => [key, r.reason] as const)));
    if (keys.size === 0 && refused.size === 0) return;
    const head = input.core.chain(input.observed).findLast((m) => !m.isUser);
    const rec = head ? activeRecord(head, input.core.journal.tombstones) : null;
    const how = new Map<string, Settled>();
    for (const key of keys) {
      const entry = rec?.post.findLast((p) => p.kind === "fix" && p.agent?.role === ASSISTANT_ROLE && p.agent.key === key);
      how.set(key, { chipId: head && entry && entry.events.length > 0 ? fixChip(head.id, head.swipeId, entry.seq) : null });
    }
    for (const [key, reason] of refused) how.set(key, { refused: reason });
    const { chatId, userId } = input;
    const done = this.withThread(chatId, userId, async (t) => {
      const held = t.proposals.flatMap(({ value: p }) => (p.pending && p.batch !== undefined && how.has(p.batch) ? [p] : []));
      // One the Apply under way made, which hasn't taken in its result yet: that Apply settles it.
      const claimed = new Set(held.map((p) => p.batch));
      if ([...this.applying].some((mark) => mark.startsWith(`${t.key}\u0000`))) for (const [batch, settled] of how) if (!claimed.has(batch)) this.early.set(`${t.key}\u0000${batch}`, settled);
      if (held.length === 0) return;
      const settled = held.map((p) => ({ next: settledProposal(p, how.get(p.batch ?? "") ?? { chipId: null }), only: p.again ? new Set(p.again) : undefined }));
      await this.save(t, { proposals: settled.map((s) => s.next) });
      this.push(t);
      // A later Apply's write counts only the changes it sent: what landed before it counted then.
      for (const { next, only } of settled) if (next.status === "applied") await this.learn(userId, await this.connectionOf(userId, next), outcomesOf(next, only));
    }).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: a GM assistant proposal held for a turn wasn't updated once the turn closed (${messageOf(error)})`, userId));
    this.running.add(done);
    void done.finally(() => this.running.delete(done));
  }

  /** The proposal `id`, or why not: one whose Apply is under way is neither applied again nor turned down. */
  private proposal(t: Thread, id: string): StoredProposal {
    const p = t.proposals.find((q) => q.value.id === id)?.value;
    if (!p) throw new AssistantError("not_found", "There is no such proposal in this conversation.");
    if (this.applying.has(`${t.key}\u0000${id}`)) throw new AssistantError("conflict", "That proposal is being applied.");
    return p;
  }

  /** The open proposal `id`, as No takes it, or why not. */
  private openProposal(t: Thread, id: string): StoredProposal {
    const p = this.proposal(t, id);
    if (p.status !== "open") throw new AssistantError("bad_request", `That proposal was ${p.status} already.`);
    return p;
  }

  /**
   * Applies the proposal `id` (C8 `apply`), the changes it may send (`appliable`: an open one's,
   * or an applied one's whose write a turn refused) or those of them `keys` picks, as one GM edit,
   * held while the engine runs a turn: what landed is applied, with the edit's chip for its Undo
   * (none while it is held); what the head refused says why. A later Apply skips what landed
   * already, and counts only what it sent. A proposal none of whose changes landed stays open. It is
   * written with the wider of the knowledge it was proposed under and the assistant's now, so a file
   * it writes is read only with as much as went into it. The write runs outside the thread's lock:
   * Cancel, a new message and the rest of the thread never wait on it.
   */
  private async applyProposal(chatId: ChatId, userId: UserId, id: string, keys: readonly string[] | undefined): Promise<void> {
    const thread = `${userId}\u0000${chatId}`;
    const mark = `${thread}\u0000${id}`;
    const begun = await this.withThread(chatId, userId, async (t) => {
      const p = this.proposal(t, id);
      const may = appliable(p);
      if (may.length === 0) throw new AssistantError("bad_request", `That proposal was ${p.status} already.`);
      if (keys !== undefined && keys.some((k) => !p.ops.some((o) => o.key === k))) throw new AssistantError("bad_request", "Pick changes the proposal holds.");
      const picked = keys === undefined ? may : may.filter((o) => keys.includes(o.key));
      if (picked.length === 0) throw new AssistantError("bad_request", "Pick at least one change to apply.");
      this.applying.add(mark);
      return { p, picked, again: p.status === "applied" };
    });
    const batch = batchKey(ASSISTANT_ROLE, begun.picked.map((o) => o.op));
    const sent = new Set(begun.picked.map((o) => o.key));
    try {
      const own = (await this.rt.settings.get(userId)).agents.assistant;
      const base = { userId, chatId, knowledge: widerKnowledge(begun.p.knowledge ?? "gm", own.knowledge) };
      const connection = begun.p.connection ?? own.connectionId ?? (await this.rt.activeConnectionId(userId));
      const writer = outsideWriter(this.rt, { ...base, reader: outsideReader(this.rt, base), agent: { role: ASSISTANT_ROLE, id: begun.p.agentId }, signal: new AbortController().signal, connectionId: connection });
      // The writer pushes the chat's state once the edit lands or is held, its Undo chip among it.
      const result = await writer.apply(
        begun.picked.map((o) => o.op),
        ROLE_LABEL,
      );
      await this.withThread(chatId, userId, async (t) => {
        // Cleared meanwhile: what landed keeps its Undo chip in the chat.
        const p = t.proposals.find((q) => q.value.id === id)?.value;
        if (!p) return;
        const applied = new Set(result.applied);
        const refused = new Map(result.refused.flatMap((r) => (r.key !== undefined ? [[r.key, r] as const] : [])));
        // Each change as this Apply left it: what an Apply before it refused is said again, or no
        // more. A later Apply leaves what it didn't send as it was: what landed, and what it left.
        const ops = p.ops.map((op): StoredOp => {
          if (begun.again && !sent.has(op.key)) return op;
          const { applied: _before, refused: _was, ...o } = op;
          if (applied.has(o.key)) return { ...o, applied: true };
          const no = refused.get(o.key);
          return no ? { ...o, refused: { code: no.code, reason: no.reason } } : o;
        });
        const landed = applied.size > 0;
        // Held while a turn runs: its write's key, by which its Undo chip is named once it lands (`landed`), unless it settled already.
        const early = landed && result.pending ? this.early.get(`${thread}\u0000${batch}`) : undefined;
        const after: StoredProposal = { ...p, ops, ...(landed ? { status: "applied" as const, ...(result.chipId !== null ? { chipId: result.chipId } : {}), ...(result.pending ? { pending: true as const, batch, ...(begun.again ? { again: [...sent] } : {}) } : {}) } : {}) };
        const next = early ? settledProposal(after, early) : after;
        await this.save(t, { proposals: [next] });
        this.push(t);
        // What landed counts toward what the assistant learns now; one held for a turn, once it lands. A later Apply counts only what it sent.
        if (next.status === "applied" && next.pending !== true) await this.learn(userId, connection, outcomesOf(next, begun.again ? sent : undefined));
      });
    } finally {
      this.applying.delete(mark);
      this.early.delete(`${thread}\u0000${batch}`);
    }
  }
}

/**
 * GM → Workspace (C8 `lre.workspace`): the chat's workspace at its head and its learned area, read
 * with the GM's knowledge, and your own changes to it, each one GM edit through the writer the
 * agents' tools use, with its Undo chip, held while the engine runs a turn (a learned file's at
 * once, in the chat's metadata). A file you write is yours alone until you say who else may read it
 * (`readers`, on the write or by itself). The main agent's session is there too, whose latest
 * compaction you may roll back (`compaction.ts`).
 */
export async function workspaceRequest(rt: Runtime, r: WorkspaceRequest, userId: UserId): Promise<ResultBodies["lre.workspace"]> {
  const base = { userId, chatId: r.chatId, knowledge: "gm" as const };
  const text = (v: unknown, what: string): string => {
    if (typeof v !== "string") throw new AssistantError("bad_request", `Give the ${what}.`);
    return v;
  };
  const readers = (v: unknown): AgentKnowledge => {
    if (!isAgentKnowledge(v)) throw new AssistantError("bad_request", "Say who may read the file: pov, everyone or gm.");
    return v;
  };
  if (r.op === "list") return { files: await listWorkspace(rt, base) };
  if (r.op === "read") return { text: await readWorkspaceFile(rt, base, text(r.path, "file's path")) };
  if (r.op === "session") return { session: await sessionView(rt, r.chatId, userId) };
  if (r.op === "rollback") {
    const session = await askRollback(rt, r.chatId, userId);
    if (!session) throw new AssistantError("validation", "The main agent's session has no compaction to roll back.");
    return { session };
  }
  let op: AgentOp;
  if (r.op === "write") op = { kind: "ws_write", path: text(r.path, "file's path"), text: text(r.text, "file's text"), ...(r.readers !== undefined ? { readers: readers(r.readers) } : {}) };
  else if (r.op === "delete") op = { kind: "ws_delete", path: text(r.path, "file's path") };
  else if (r.op === "move") op = { kind: "ws_move", from: text(r.from, "file's path"), to: text(r.to, "path to move it to") };
  else if (r.op === "pin") {
    if (typeof r.pinned !== "boolean") throw new AssistantError("bad_request", "Say whether the file is pinned.");
    op = { kind: "ws_pin", path: text(r.path, "file's path"), pinned: r.pinned };
  } else if (r.op === "readers") op = { kind: "ws_readers", path: text(r.path, "file's path"), readers: readers(r.readers) };
  else throw new AssistantError("bad_request", "op must be list, read, write, delete, move, pin, readers, session or rollback");
  // Your own change is no agent's operation: the GM's role skips the change types' modes (`GM_ROLE`). The writer pushes the chat's state after it.
  const writer = outsideWriter(rt, { ...base, reader: outsideReader(rt, base), agent: { role: GM_ROLE, id: GM_ROLE }, signal: new AbortController().signal, connectionId: null });
  const result = await writer.apply([op], WORKSPACE_LABEL);
  if (result.applied.length === 0) throw new AssistantError("validation", result.refused[0]?.reason ?? "The change was refused.");
  return { files: await listWorkspace(rt, base), pending: result.pending, undo: result.chipId };
}
