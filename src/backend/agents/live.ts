// GM → Live (DESIGN §4.6; `shared/live.ts`): each chat's latest agent run as its agents work it, kept
// in memory and pushed to the pages watching it. The orchestrator starts a run's feed (`start`) and
// hands its handle (`LiveRun`) to everything that hears the run: the agent runtime's trace (each agent
// as it starts, each step of its transcript, each finished message), the turn's draft (what is staged,
// refused as it is staged, and dropped), its commits (what landed, what waits for the review card,
// what was refused and why), the main agent's failure, and the run's phases and end. The same entries
// make the turn's transcript, which its record keeps.
//
// Memory: one feed per chat, its latest run's, and per user at most Settings → Agents → Budgets'
// Chats in the live view (`agents.kept.live`), the chat whose run started longest ago let go first;
// a feed holds what its turn's agents did, as those agents hold it while they work. The pages that
// asked about a chat (`lre.live get`) hear it until they leave or close, as many chats per user as
// the same setting keeps. GM data: pushed only to the pages that asked, and shown behind the GM gate.

import type { ChatId, UserId } from "../../shared/ids";
import type { LiveChange, LiveEndState, LiveEntry, LiveEntryBody, LiveView } from "../../shared/live";
import { transcriptText } from "../../shared/live";
import { PROTOCOL_VERSION } from "../../shared/protocol";
import type { HostPort } from "../host";
import type { AgentStarted, AgentTrace, TranscriptEntry } from "./runtime";
import type { CommitOutcome, DraftWatch, StagedOp } from "./turn-writer";

interface Feed {
  chatId: ChatId;
  userId: UserId;
  view: LiveView;
  /** Entries made since the watching pages last heard, sent together once the work making them yields. */
  unsent: LiveEntry[];
  flushing: boolean;
}

export type LiveHost = Pick<HostPort, "frontend" | "on">;

export class LiveFeeds {
  /** Each chat's latest run, the one started longest ago first. */
  private readonly feeds = new Map<ChatId, Feed>();
  /** The pages watching each chat's live view, by `user \0 chat`, the chat asked about longest ago first. */
  private readonly watchers = new Map<string, Set<string>>();
  /** Who hears each entry as it joins a chat's feed (the loopback's bridge: an agent's thinking streams into a loopback turn's thinking block, D-5). */
  observer: ((chatId: ChatId, entry: LiveEntryBody) => void) | null = null;

  constructor(
    private readonly host: LiveHost,
    /** The user's Chats in the live view (Settings → Agents → Budgets). */
    private readonly kept: (userId: UserId) => number,
    private readonly now: () => number = () => Date.now(),
  ) {
    host.on("FRONTEND_SESSION_CLOSED", (e) => {
      for (const [key, sessions] of this.watchers) {
        sessions.delete(e.frontendSessionId);
        if (sessions.size === 0) this.watchers.delete(key);
      }
    });
  }

  /** A run starts in the chat: its feed takes the place of the chat's last, and past the user's chats kept, the one started longest ago goes. */
  start(input: { chatId: ChatId; userId: UserId; turn: string; kind: LiveView["kind"]; pipeline: LiveView["pipeline"]; text: string }): LiveRun {
    const feed: Feed = { chatId: input.chatId, userId: input.userId, view: { turn: input.turn, kind: input.kind, pipeline: input.pipeline, text: input.text, startedAt: this.now(), ended: null, entries: [] }, unsent: [], flushing: false };
    this.feeds.delete(input.chatId);
    this.feeds.set(input.chatId, feed);
    const own = [...this.feeds.values()].filter((f) => f.userId === input.userId);
    for (const old of own.slice(0, Math.max(0, own.length - this.kept(input.userId)))) this.feeds.delete(old.chatId);
    this.push(feed, { view: { ...feed.view, entries: [] } });
    return new LiveRun(this, feed);
  }

  /** The chat's live view now, the entries made so far in it: its latest run kept, or null. Entries never change once made, so the copy shares them. */
  view(chatId: ChatId, userId: UserId): LiveView | null {
    const feed = this.feeds.get(chatId);
    return feed && feed.userId === userId ? { ...feed.view, entries: [...feed.view.entries, ...feed.unsent] } : null;
  }

  /** The page `session` hears the chat's live view from now on; past the user's chats kept, the chat asked about longest ago stops being heard. */
  watch(chatId: ChatId, userId: UserId, session: string): void {
    const key = `${userId}\u0000${chatId}`;
    const sessions = this.watchers.get(key) ?? new Set<string>();
    sessions.add(session);
    this.watchers.delete(key);
    this.watchers.set(key, sessions);
    const own = [...this.watchers.keys()].filter((k) => k.startsWith(`${userId}\u0000`));
    for (const k of own.slice(0, Math.max(0, own.length - this.kept(userId)))) this.watchers.delete(k);
  }

  /** The page stops hearing the chat's live view. */
  leave(chatId: ChatId, userId: UserId, session: string): void {
    const key = `${userId}\u0000${chatId}`;
    const sessions = this.watchers.get(key);
    sessions?.delete(session);
    if (sessions?.size === 0) this.watchers.delete(key);
  }

  /** An entry joins the feed, sent to the watching pages with the others made before the work yields. */
  add(feed: Feed, body: LiveEntryBody): void {
    feed.unsent.push({ ...body, seq: feed.view.entries.length + feed.unsent.length + 1, at: this.now() } as LiveEntry);
    this.observer?.(feed.chatId, body);
    this.schedule(feed);
  }

  /** The run ended, or waits at a gate (`waiting`, which a resume reopens); its entries so far are sent with it. */
  end(feed: Feed, state: LiveEndState, reason?: string): void {
    feed.view.ended = { state, at: this.now(), ...(reason !== undefined ? { reason } : {}) };
    this.flush(feed);
  }

  /** The run goes on after its gate. */
  reopen(feed: Feed): void {
    feed.view.ended = null;
    this.add(feed, { kind: "resume" });
  }

  /** The feed's view whole, its entries made so far in it. */
  whole(feed: Feed): LiveView {
    this.flush(feed);
    return feed.view;
  }

  private schedule(feed: Feed): void {
    if (feed.flushing) return;
    feed.flushing = true;
    queueMicrotask(() => this.flush(feed));
  }

  private flush(feed: Feed): void {
    feed.flushing = false;
    const entries = feed.unsent.splice(0);
    feed.view.entries.push(...entries);
    if (entries.length > 0 || feed.view.ended !== null) this.push(feed, { turn: feed.view.turn, entries, ended: feed.view.ended });
  }

  /** A change to the pages watching the chat, while the feed is the chat's latest run; a host that names no pages (`""`) tells every page of the user. */
  private push(feed: Feed, change: LiveChange): void {
    if (this.feeds.get(feed.chatId) !== feed) return;
    const sessions = this.watchers.get(`${feed.userId}\u0000${feed.chatId}`);
    if (!sessions) return;
    for (const session of sessions) this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.live.update", chatId: feed.chatId, ...change }, feed.userId, session === "" ? undefined : session);
  }
}

/**
 * One run's feed, as everything that hears the run writes to it: the agent runtime's trace
 * (`AgentTrace`), the turn's draft (`draft`), its commits (`committed`), and the orchestrator's own
 * entries and end. A run whose chat started another keeps writing to its own feed, which no page hears.
 */
export class LiveRun implements AgentTrace {
  constructor(
    private readonly feeds: LiveFeeds,
    private readonly feed: Feed,
  ) {}

  add(body: LiveEntryBody): void {
    this.feeds.add(this.feed, body);
  }

  /** How the run ended; once it ended for good, a later end changes nothing (a run let go after it closed). */
  end(state: LiveEndState, reason?: string): void {
    const ended = this.feed.view.ended;
    if (ended !== null && ended.state !== "waiting") return;
    this.feeds.end(this.feed, state, reason);
  }

  /** The gate's resume takes the run up again. */
  resume(): void {
    if (this.feed.view.ended?.state === "waiting") this.feeds.reopen(this.feed);
  }

  /** The run's transcript, as its record keeps it. */
  transcript(): string {
    return transcriptText(this.feeds.whole(this.feed));
  }

  // ---------------------------------------------------------------- the agents (AgentTrace)

  start(agent: AgentStarted): void {
    const { tag } = agent;
    this.add({ kind: "agent", agent: agent.id, role: agent.role, ...(tag.run !== undefined ? { run: tag.run } : {}), ...(tag.phase !== undefined ? { phase: tag.phase } : {}), ...(tag.stage !== undefined ? { stage: tag.stage } : {}), ...(tag.task !== undefined ? { task: tag.task } : {}), model: agent.model, connection: agent.connectionId, effort: agent.effort, system: agent.system, prefix: agent.prefix, history: agent.history });
  }

  entry(agentId: string, e: TranscriptEntry): void {
    switch (e.kind) {
      case "message":
        this.add({ kind: "message", agent: agentId, text: e.text });
        return;
      case "answer":
        this.add({ kind: "answer", agent: agentId, text: e.text, ...(e.reasoning ? { reasoning: e.reasoning } : {}), calls: e.calls.map((c) => ({ id: c.id, name: c.name, args: c.args })), usage: { in: e.usage.in, cachedIn: e.usage.cachedIn, out: e.usage.out, reasoningOut: e.usage.reasoningOut }, model: e.model, finish: e.finishReason, ms: e.ms });
        return;
      case "tools_refused":
        this.add({ kind: "tools_refused", agent: agentId, reason: e.reason, ms: e.ms });
        return;
      case "result":
        this.add({ kind: "result", agent: agentId, call: e.callId, name: e.name, text: e.text, error: e.error, ms: e.ms });
        return;
      case "stop":
        this.add({ kind: "stop", agent: agentId, status: e.status, code: e.code, reason: e.reason });
        return;
    }
  }

  idle(agentId: string, spent: { in: number; out: number }): void {
    this.add({ kind: "idle", agent: agentId, usage: spent });
  }

  // ---------------------------------------------------------------- the writes

  /** What the turn's roles stage, what is refused as they stage it, and what is dropped. */
  draft(): DraftWatch {
    const write = (op: StagedOp, body: Partial<Extract<LiveEntryBody, { kind: "write" }>> & Pick<Extract<LiveEntryBody, { kind: "write" }>, "outcome">): void => this.add({ kind: "write", key: op.key, run: op.agentId, role: op.role, phase: op.phase, ...body });
    return {
      staged: (op) => write(op, { outcome: "staged", changeType: op.changeType, lines: op.lines }),
      refused: (at) => this.add({ kind: "write", key: at.key ?? "", run: at.agentId, role: at.role, phase: at.phase, outcome: "refused", code: at.code, reason: at.reason }),
      dropped: (ops, why) => {
        for (const op of ops) write(op, { outcome: "dropped", why });
      },
    };
  }

  /** What a phase's commit made of its operations: each landed, held for the review card, or refused with why. */
  committed(out: CommitOutcome): void {
    const write = (op: StagedOp, body: Pick<Extract<LiveEntryBody, { kind: "write" }>, "outcome" | "code" | "reason">): void => this.add({ kind: "write", key: op.key, run: op.agentId, role: op.role, phase: op.phase, ...body });
    for (const { op } of out.committed) write(op, { outcome: "landed" });
    for (const op of out.confirm) write(op, { outcome: "held" });
    for (const { op, refusal } of out.refused) write(op, { outcome: "refused", code: refusal.code, reason: refusal.reason });
  }
}
