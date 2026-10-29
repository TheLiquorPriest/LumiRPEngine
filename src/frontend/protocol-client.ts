// The frontend half of the protocol (ARCHITECTURE §4). Requests get a frontend-chosen `reqId` and
// resolve with exactly one result or error; state arrives as a snapshot followed by deltas. A
// delta whose `base` is not the held `rev` (or whose paths do not resolve) is discarded and the
// view is resynced; while a resync is outstanding every delta is discarded. Listener
// notifications are coalesced, so a burst of deltas renders once. A request waits for its answer
// as long as the user's Engine requests timeout (Settings → Timeouts): the hello's answer carries
// it, and so does every settings answer, so a change applies to the next request.
//
// A hello or resync (a sync) lasts until its view arrives, not just its answer: Lumiverse drops
// what a page sends while its socket is down or not yet authenticated, and a view the backend
// failed to build, or sent while the socket was down, never comes. So a sync ends with its view,
// with an error naming it (even after its answer), or at the Engine requests limit; the page then
// says why (`failed`), and the next stale delta or `retry` asks again. `retry` (a reconnect, the
// engine starting again, the page coming back into view, Try again) asks even while a sync waits,
// since that one may be lost.

import { isRecord } from "../shared/json";
import type { Limit } from "../shared/minds";
import { formatMs, TIMEOUTS, timerMs } from "../shared/timeouts";
import type { Activity } from "../shared/diagnostics";
import type { ChatId } from "../shared/ids";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { AssistantUpdate, AssistantView, DeltaOp, DraftChanged, ErrorCode, ErrorMessage, FrontendToBackend, GeneratePush, JobUpdate, MindsRunUpdate, ResultBodies, ResultMessage } from "../shared/protocol";
import type { AgentsView } from "../shared/agents";
import type { AcceptanceRunView, AcceptanceState } from "../shared/agent-settings";
import type { StateView } from "../shared/state-view";
import { applyDelta, DeltaError } from "./delta";
import type { RequestBody, Send } from "./registry";

/** The two host calls the client needs: `ctx.sendToBackend` and `ctx.onBackendMessage`. */
export interface Transport {
  send(payload: FrontendToBackend): void;
  subscribe(handler: (payload: unknown) => void): () => void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ClientOptions {
  /** How long a request waits before it resolves with an `unavailable` error, until the hello's answer says the user's (ms, or "none"). */
  requestMs?: Limit;
  newReqId?: () => string;
  /** Runs a coalesced notification; defaults to a microtask. */
  schedule?: (fn: () => void) => void;
  timers?: Timers;
}

export type SyncStatus = "closed" | "syncing" | "live" | "resyncing";

function isActivity(value: unknown): value is Activity {
  return isRecord(value) && typeof value.chatId === "string" && (value.state === "running" || value.state === "failed") && typeof value.label === "string" && typeof value.since === "number" && (value.turn === null || typeof value.turn === "string");
}

/** An acceptance run as pushed: a light check, as for the other pushes; the backend owns the rest of the shape. */
function isAcceptanceRun(value: unknown): value is AcceptanceRunView {
  return isRecord(value) && typeof value.label === "string" && typeof value.openedAt === "number" && (value.closedAt === null || typeof value.closedAt === "number") && Array.isArray(value.connections);
}

/** The GM assistant's thread as pushed: a light check, as for the other pushes; the backend owns the rest of the shape. */
function isAssistantView(value: unknown): value is AssistantView {
  return isRecord(value) && Array.isArray(value.thread) && Array.isArray(value.proposals) && (value.running === null || (isRecord(value.running) && typeof value.running.label === "string"));
}

export interface SyncState {
  chatId: ChatId | null;
  rev: number | null;
  view: StateView | null;
  status: SyncStatus;
  /** Deltas discarded and resyncs sent since `open`, for diagnostics. */
  resyncs: number;
  /** What the engine is doing for the chat now, or what failed last (`lre.activity`); null when idle. */
  activity: Activity | null;
  /** Whether this Lumiverse stops a generation for the engine run (`lre.hello`'s `canStop`); null until a hello answers. */
  canStop: boolean | null;
  /** Why the chat's last sync brought no view (its error, or none within the Engine requests limit), until the next sync; the page offers Try again. */
  failed: string | null;
}

/** The hello or resync waiting for its view: at most one, and a newer one replaces it. */
interface Sync {
  reqId: string;
  chatId: ChatId;
  timer: unknown;
}

interface Pending {
  type: keyof ResultBodies;
  /** The chat a hello named: its answer means the backend has heard this page on that chat. */
  chat?: ChatId | null;
  resolve: (message: ResultMessage | ErrorMessage) => void;
  timer: unknown;
}

const REQUEST_TYPES: Record<keyof ResultBodies, true> = {
  "lre.hello": true,
  "lre.state.resync": true,
  "lre.restart": true,
  "lre.page": true,
  "lre.action": true,
  "lre.chip": true,
  "lre.view.open": true,
  "lre.fix": true,
  "lre.edit": true,
  "lre.gm": true,
  "lre.sections": true,
  "lre.state.get": true,
  "lre.marker": true,
  "lre.keep": true,
  "lre.settings.get": true,
  "lre.settings.set": true,
  "lre.settings.caveats": true,
  "lre.editor": true,
  "lre.world": true,
  "lre.ui": true,
  "lre.map": true,
  "lre.chat.knowledge": true,
  "lre.job": true,
  "lre.lore": true,
  "lre.secrecy": true,
  "lre.preset": true,
  "lre.diag": true,
  "lre.minds": true,
  "lre.routine": true,
  "lre.character": true,
  "lre.agents": true,
  "lre.acceptance": true,
  "lre.cancel": true,
  "lre.assistant": true,
  "lre.workspace": true,
};

function isRequestType(value: unknown): value is keyof ResultBodies {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REQUEST_TYPES, value);
}

/** A light structural check: the backend owns the shape, this only rejects a malformed push. */
function isStateView(value: unknown): value is StateView {
  return isRecord(value) && value.v === 1 && typeof value.chatId === "string" && Array.isArray(value.chips) && isRecord(value.panels);
}

function errorMessage(reqId: string | null, code: ErrorCode, message: string): ErrorMessage {
  return { lre: PROTOCOL_VERSION, type: "lre.error", reqId, code, message };
}

export class ProtocolClient {
  readonly send: Send;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly errorListeners = new Set<(error: ErrorMessage) => void>();
  private readonly jobListeners = new Set<(update: JobUpdate) => void>();
  private readonly mindsListeners = new Set<(update: MindsRunUpdate) => void>();
  private readonly draftListeners = new Set<(push: DraftChanged) => void>();
  private readonly generateListeners = new Set<(push: GeneratePush) => void>();
  private readonly agentsListeners = new Set<(view: AgentsView) => void>();
  private readonly acceptanceListeners = new Set<(state: AcceptanceState) => void>();
  private readonly assistantListeners = new Set<(update: AssistantUpdate) => void>();
  private readonly unsubscribe: () => void;
  private requestMs: Limit;
  private readonly newReqId: () => string;
  private readonly schedule: (fn: () => void) => void;
  private readonly timers: Timers;
  private state: SyncState = { chatId: null, rev: null, view: null, status: "closed", resyncs: 0, activity: null, canStop: null, failed: null };
  private sync: Sync | null = null;
  /** The chat whose hello the backend last answered for this page. */
  private greeted: ChatId | null | undefined = undefined;
  private notifyQueued = false;
  private disposed = false;
  private counter = 0;

  constructor(private readonly transport: Transport, options: ClientOptions = {}) {
    this.requestMs = options.requestMs ?? TIMEOUTS.requestMs.defaultMs;
    this.newReqId = options.newReqId ?? (() => `r${Date.now().toString(36)}-${(this.counter += 1).toString(36)}`);
    // Wrapped: browsers throw "Illegal invocation" when queueMicrotask is called as a method.
    this.schedule = options.schedule ?? ((fn) => queueMicrotask(fn));
    this.timers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as number) };
    this.unsubscribe = transport.subscribe((payload) => this.receive(payload));
    this.send = (request) => this.request(request);
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Errors not tied to a pending request (`reqId: null` or unknown), and failed hellos/resyncs. */
  onError(listener: (error: ErrorMessage) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onJob(listener: (update: JobUpdate) => void): () => void {
    this.jobListeners.add(listener);
    return () => this.jobListeners.delete(listener);
  }

  /** A GM's minds run moved on or ended (`lre.minds.update`): GM data, which only GM → Minds shows. */
  onMindsRun(listener: (update: MindsRunUpdate) => void): () => void {
    this.mindsListeners.add(listener);
    return () => this.mindsListeners.delete(listener);
  }

  /** A world's draft changed on the backend (`lre.draft.changed`): written, discarded or committed by any session. */
  onDraftChanged(listener: (push: DraftChanged) => void): () => void {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  }

  /** The engine prepared a chat's next generation and asks this frontend to start it (`lre.generate`, DESIGN §5.1). */
  onGenerate(listener: (push: GeneratePush) => void): () => void {
    this.generateListeners.add(listener);
    return () => this.generateListeners.delete(listener);
  }

  /** The MCP servers this account has seen, or the update notice, changed (`lre.agents.changed`, DESIGN §23). */
  onAgents(listener: (view: AgentsView) => void): () => void {
    this.agentsListeners.add(listener);
    return () => this.agentsListeners.delete(listener);
  }

  /** An acceptance run opened, closed or spent (`lre.acceptance.changed`, AGENT-LOOP-PLAN §12): Settings → Agents and the drawer's counter follow it. */
  onAcceptance(listener: (state: AcceptanceState) => void): () => void {
    this.acceptanceListeners.add(listener);
    return () => this.acceptanceListeners.delete(listener);
  }

  /** A chat's thread with the GM assistant changed (`lre.assistant.update`): GM data, which only GM → Assistant shows, behind the gate. */
  onAssistant(listener: (update: AssistantUpdate) => void): () => void {
    this.assistantListeners.add(listener);
    return () => this.assistantListeners.delete(listener);
  }

  /** Whether this page's document is on screen (setup reads `document.visibilityState`); sent with each hello, resync and `page`. */
  visible: () => boolean = () => true;

  /** Switches to a chat (or none) and asks for its snapshot. Pushes for any other chat are ignored. */
  open(chatId: ChatId | null): Promise<ResultMessage | ErrorMessage> {
    this.update({ chatId, rev: null, view: null, status: chatId === null ? "closed" : "syncing", resyncs: 0, activity: null, canStop: this.state.canStop, failed: null });
    return this.ask("lre.hello");
  }

  /** Discards the held view's rev and asks for a fresh snapshot, unless a sync already waits for one (a stale delta). */
  resync(): void {
    if (this.state.chatId !== null && this.sync === null) void this.ask("lre.state.resync");
  }

  /**
   * Asks for the chat's view again even while a sync waits, since what the page asked before may be
   * lost: it reconnected, its engine started again, it came back into view, or the player pressed
   * Try again. A hello again while the backend never answered one for this chat and no view came;
   * else a resync.
   */
  retry(): void {
    if (this.state.chatId !== null) void this.ask(this.state.view === null && this.greeted !== this.state.chatId ? "lre.hello" : "lre.state.resync");
  }

  /** Tells the backend whether this page shows its chat on screen now (DESIGN §5.1: who starts a prepared reply). */
  page(): void {
    void this.request({ type: "lre.page", chatId: this.state.chatId, viewing: this.state.chatId !== null && this.visible() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.timers.clear(this.sync?.timer ?? null);
    this.sync = null;
    for (const [reqId, entry] of this.pending) {
      this.timers.clear(entry.timer);
      entry.resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  /**
   * Sends the open chat's hello or resync as its one sync, ending any that waits. For a chat it lasts
   * until a view of the chat arrives, at most the Engine requests limit; a hello for no chat is an
   * ordinary request.
   */
  private ask(type: "lre.hello" | "lre.state.resync"): Promise<ResultMessage | ErrorMessage> {
    const chatId = this.state.chatId;
    this.endSync();
    if (chatId === null) {
      const reply = this.request({ type: "lre.hello", chatId, viewing: false });
      void reply.then((message) => {
        if (message.type === "lre.error" && this.state.chatId === null) this.emitError(message);
      });
      return reply;
    }
    this.update({ ...this.state, status: this.state.view ? "resyncing" : "syncing", resyncs: this.state.resyncs + (type === "lre.state.resync" ? 1 : 0), failed: null });
    const viewing = this.visible();
    const { reqId, reply } = this.post(type === "lre.hello" ? { type: "lre.hello", chatId, viewing } : { type: "lre.state.resync", chatId, viewing }, false);
    if (this.disposed) return reply;
    const ms = timerMs(this.requestMs);
    const timer = ms === null ? null : this.timers.set(() => this.syncFailed(reqId, errorMessage(reqId, "unavailable", `No view of this chat from the engine within ${formatMs(ms)} (Settings → Timeouts → ${TIMEOUTS.requestMs.label}). Try again, or the page asks again when it reconnects.`)), ms);
    this.sync = { reqId, chatId, timer };
    void reply.then((message) => {
      if (message.type === "lre.error") this.syncFailed(reqId, message);
    });
    return reply;
  }

  /**
   * Ends the sync that waits: a view of its chat came, a newer sync replaces it, or the page opened
   * another chat. An answer it still gets changes nothing, and if none comes it expires as any
   * request does.
   */
  private endSync(): void {
    const sync = this.sync;
    if (sync === null) return;
    this.sync = null;
    this.timers.clear(sync.timer);
    const entry = this.pending.get(sync.reqId);
    if (entry && entry.timer === null) entry.timer = this.limit(sync.reqId, entry.resolve);
  }

  /**
   * The sync brought no view: an error named it (even after its answer, when building the view
   * failed), or none came in time. The page says why once and holds what it has; the next stale
   * delta or `retry` asks again.
   */
  private syncFailed(reqId: string, error: ErrorMessage): void {
    const sync = this.sync;
    if (sync === null || sync.reqId !== reqId) return;
    this.sync = null;
    this.timers.clear(sync.timer);
    this.settle(reqId)?.resolve(error);
    if (this.state.chatId !== sync.chatId) return;
    this.update({ ...this.state, status: this.state.view ? "live" : "closed", failed: error.message });
    this.emitError(error);
  }

  private request(body: RequestBody): Promise<ResultMessage | ErrorMessage> {
    return this.post(body, true).reply;
  }

  /** Sends a request; an untimed one (a sync's) waits until its sync ends it. */
  private post(body: RequestBody, timed: boolean): { reqId: string; reply: Promise<ResultMessage | ErrorMessage> } {
    const { promise, resolve } = Promise.withResolvers<ResultMessage | ErrorMessage>();
    const reqId = this.newReqId();
    if (this.disposed) {
      resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
      return { reqId, reply: promise };
    }
    const entry: Pending = { type: body.type, resolve, timer: timed ? this.limit(reqId, resolve) : null, ...(body.type === "lre.hello" ? { chat: body.chatId } : {}) };
    this.pending.set(reqId, entry);
    const message = { ...body, lre: PROTOCOL_VERSION, reqId } as FrontendToBackend;
    try {
      this.transport.send(message);
    } catch (error) {
      this.pending.delete(reqId);
      this.timers.clear(entry.timer);
      resolve(errorMessage(reqId, "unavailable", error instanceof Error ? error.message : String(error)));
    }
    return { reqId, reply: promise };
  }

  /** A request's limit: at the user's Engine requests timeout, an unanswered request answers `unavailable`. */
  private limit(reqId: string, resolve: (message: ErrorMessage) => void): unknown {
    const ms = timerMs(this.requestMs);
    if (ms === null) return null;
    return this.timers.set(() => {
      if (this.pending.delete(reqId)) resolve(errorMessage(reqId, "unavailable", `No reply from the engine within ${formatMs(ms)} (Settings → Timeouts → ${TIMEOUTS.requestMs.label}). It may still finish what was asked.`));
    }, ms);
  }

  private receive(payload: unknown): void {
    if (this.disposed || !isRecord(payload) || payload.lre !== PROTOCOL_VERSION) return;
    switch (payload.type) {
      case "lre.result":
        this.receiveResult(payload);
        return;
      case "lre.error":
        this.receiveError(payload);
        return;
      case "lre.state.snapshot":
        this.receiveSnapshot(payload);
        return;
      case "lre.state.delta":
        this.receiveDelta(payload);
        return;
      case "lre.job.update":
        if (typeof payload.jobId === "string" && typeof payload.status === "string") {
          const update = payload as unknown as JobUpdate;
          for (const listener of this.jobListeners) listener(update);
        }
        return;
      case "lre.activity":
        if (payload.chatId === this.state.chatId && (payload.activity === null || isActivity(payload.activity))) this.update({ ...this.state, activity: payload.activity });
        return;
      case "lre.minds.update":
        if (typeof payload.chatId === "string" && isRecord(payload.run) && typeof payload.run.runId === "string") {
          const update = payload as unknown as MindsRunUpdate;
          for (const listener of this.mindsListeners) listener(update);
        }
        return;
      case "lre.draft.changed":
        if (typeof payload.worldId === "string" && typeof payload.version === "number" && typeof payload.stored === "boolean" && (typeof payload.base === "string" || payload.base === null)) {
          const push: DraftChanged = { lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId: payload.worldId, version: payload.version, stored: payload.stored, base: payload.base };
          for (const listener of this.draftListeners) listener(push);
        }
        return;
      case "lre.generate":
        if (typeof payload.chatId === "string" && typeof payload.turn === "string" && (payload.as === "regenerate" || payload.as === "continue" || payload.as === "send")) {
          const push: GeneratePush = { lre: PROTOCOL_VERSION, type: "lre.generate", chatId: payload.chatId, as: payload.as, turn: payload.turn };
          for (const listener of this.generateListeners) listener(push);
        }
        return;
      case "lre.agents.changed":
        if (isRecord(payload.view) && typeof payload.view.build === "string" && Array.isArray(payload.view.clients)) {
          const view = payload.view as unknown as AgentsView;
          for (const listener of this.agentsListeners) listener(view);
        }
        return;
      case "lre.acceptance.changed":
        if (isRecord(payload.state) && (payload.state.run === null || isAcceptanceRun(payload.state.run)) && (payload.state.last === null || isAcceptanceRun(payload.state.last))) {
          const state: AcceptanceState = { run: payload.state.run, last: payload.state.last };
          for (const listener of this.acceptanceListeners) listener(state);
        }
        return;
      case "lre.assistant.update":
        if (typeof payload.chatId === "string" && isAssistantView(payload.view)) {
          const update: AssistantUpdate = { lre: PROTOCOL_VERSION, type: "lre.assistant.update", chatId: payload.chatId, view: payload.view };
          for (const listener of this.assistantListeners) listener(update);
        }
        return;
    }
  }

  private settle(reqId: string): Pending | null {
    const entry = this.pending.get(reqId);
    if (!entry) return null;
    this.pending.delete(reqId);
    this.timers.clear(entry.timer);
    return entry;
  }

  private receiveResult(payload: Record<string, unknown>): void {
    if (typeof payload.reqId !== "string" || !isRequestType(payload.request)) return;
    const entry = this.settle(payload.reqId);
    if (!entry) return;
    if (entry.type !== payload.request || !isRecord(payload.body)) {
      entry.resolve(errorMessage(payload.reqId, "internal", `Result for ${String(payload.request)} answered a ${entry.type} request`));
      return;
    }
    // The user's Engine requests timeout, from the hello's answer or a settings answer.
    const body = payload.body;
    const settings = payload.request === "lre.settings.get" || payload.request === "lre.settings.set" ? body.settings : undefined;
    const limit = payload.request === "lre.hello" ? body.requestMs : isRecord(settings) && isRecord(settings.timeouts) ? settings.timeouts.requestMs : undefined;
    if (limit === "none" || (typeof limit === "number" && Number.isFinite(limit) && limit >= 0)) this.requestMs = limit;
    if (payload.request === "lre.hello") {
      if (entry.chat !== undefined) this.greeted = entry.chat;
      if (typeof body.canStop === "boolean" && body.canStop !== this.state.canStop) this.update({ ...this.state, canStop: body.canStop });
    }
    entry.resolve(payload as unknown as ResultMessage);
  }

  private receiveError(payload: Record<string, unknown>): void {
    if (typeof payload.code !== "string" || typeof payload.message !== "string") return;
    const error = payload as unknown as ErrorMessage;
    const entry = typeof payload.reqId === "string" ? this.settle(payload.reqId) : null;
    if (entry) entry.resolve(error);
    // A sync is answered at once and can still fail building its view: that error names it after its answer.
    else if (this.sync !== null && payload.reqId === this.sync.reqId) this.syncFailed(this.sync.reqId, error);
    else this.emitError(error);
  }

  private receiveSnapshot(payload: Record<string, unknown>): void {
    if (payload.chatId !== this.state.chatId || typeof payload.rev !== "number" || !isStateView(payload.view)) return;
    // Any view of the chat ends the sync waiting for one: a snapshot is the whole state at its rev.
    this.endSync();
    this.update({ ...this.state, rev: payload.rev, view: payload.view, status: "live", failed: null });
  }

  private receiveDelta(payload: Record<string, unknown>): void {
    if (payload.chatId !== this.state.chatId || typeof payload.base !== "number" || typeof payload.rev !== "number" || !Array.isArray(payload.ops)) return;
    if (this.state.status === "resyncing" || this.state.status === "syncing") return;
    if (this.state.view === null || this.state.rev !== payload.base) {
      this.resync();
      return;
    }
    let next: unknown;
    try {
      next = applyDelta(this.state.view, payload.ops as DeltaOp[]);
    } catch (error) {
      if (!(error instanceof DeltaError)) throw error;
      this.resync();
      return;
    }
    if (!isStateView(next)) {
      this.resync();
      return;
    }
    this.update({ ...this.state, rev: payload.rev, view: next });
  }

  private emitError(error: ErrorMessage): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private update(next: SyncState): void {
    this.state = next;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    this.schedule(() => {
      this.notifyQueued = false;
      if (this.disposed) return;
      for (const listener of this.listeners) listener(this.state);
    });
  }
}
