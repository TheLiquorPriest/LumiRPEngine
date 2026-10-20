// The frontend half of the protocol (ARCHITECTURE §4). Requests get a frontend-chosen `reqId` and
// resolve with exactly one result or error; state arrives as a snapshot followed by deltas. A
// delta whose `base` is not the held `rev` (or whose paths do not resolve) is discarded and the
// view is resynced; while a resync is outstanding every delta is discarded. Listener
// notifications are coalesced, so a burst of deltas renders once. A request waits for its answer
// as long as the user's Engine requests timeout (Settings → Timeouts): the hello's answer carries
// it, and so does every settings answer, so a change applies to the next request.

import { isRecord } from "../shared/json";
import type { Limit } from "../shared/minds";
import { formatMs, TIMEOUTS, timerMs } from "../shared/timeouts";
import type { Activity } from "../shared/diagnostics";
import type { ChatId } from "../shared/ids";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { DeltaOp, DraftChanged, ErrorCode, ErrorMessage, FrontendToBackend, JobUpdate, ResultBodies, ResultMessage } from "../shared/protocol";
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

export interface SyncState {
  chatId: ChatId | null;
  rev: number | null;
  view: StateView | null;
  status: SyncStatus;
  /** Deltas discarded and resyncs sent since `open`, for diagnostics. */
  resyncs: number;
  /** What the engine is doing for the chat now, or what failed last (`lre.activity`); null when idle. */
  activity: Activity | null;
}

interface Pending {
  type: keyof ResultBodies;
  resolve: (message: ResultMessage | ErrorMessage) => void;
  timer: unknown;
}

const REQUEST_TYPES: Record<keyof ResultBodies, true> = {
  "lre.hello": true,
  "lre.state.resync": true,
  "lre.action": true,
  "lre.chip": true,
  "lre.view.open": true,
  "lre.fix": true,
  "lre.edit": true,
  "lre.gm": true,
  "lre.marker": true,
  "lre.keep": true,
  "lre.settings.get": true,
  "lre.settings.set": true,
  "lre.settings.caveats": true,
  "lre.editor": true,
  "lre.world": true,
  "lre.ui": true,
  "lre.map": true,
  "lre.job": true,
  "lre.lore": true,
  "lre.studio": true,
  "lre.preset": true,
  "lre.diag": true,
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
  private readonly draftListeners = new Set<(push: DraftChanged) => void>();
  private readonly unsubscribe: () => void;
  private requestMs: Limit;
  private readonly newReqId: () => string;
  private readonly schedule: (fn: () => void) => void;
  private readonly timers: Timers;
  private state: SyncState = { chatId: null, rev: null, view: null, status: "closed", resyncs: 0, activity: null };
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

  /** A world's draft changed on the backend (`lre.draft.changed`): written, discarded or committed by any session. */
  onDraftChanged(listener: (push: DraftChanged) => void): () => void {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  }

  /** The active Loom preset the frontend's state reports (`loom.activePresetId`), sent with each hello; undefined when it can't say. */
  presetId: string | null | undefined = undefined;

  /** Switches to a chat (or none) and asks for its snapshot. Pushes for any other chat are ignored. */
  open(chatId: ChatId | null): Promise<ResultMessage | ErrorMessage> {
    this.update({ chatId, rev: null, view: null, status: chatId === null ? "closed" : "syncing", resyncs: 0, activity: null });
    const reply = this.request({ type: "lre.hello", chatId, ...(this.presetId !== undefined ? { presetId: this.presetId } : {}) });
    void reply.then((message) => {
      if (message.type === "lre.error" && this.state.chatId === chatId) {
        this.update({ ...this.state, status: "closed" });
        this.emitError(message);
      }
    });
    return reply;
  }

  /** Discards the held view's rev and asks for a fresh snapshot (at most one outstanding). */
  resync(): void {
    const chatId = this.state.chatId;
    if (chatId === null || this.state.status === "resyncing") return;
    this.update({ ...this.state, status: "resyncing", resyncs: this.state.resyncs + 1 });
    void this.request({ type: "lre.state.resync", chatId }).then((message) => {
      if (message.type !== "lre.error" || this.state.chatId !== chatId || this.state.status !== "resyncing") return;
      // Leave resyncing so the next delta can ask again; surface the failure once.
      this.update({ ...this.state, status: this.state.view ? "live" : "syncing" });
      this.emitError(message);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const [reqId, entry] of this.pending) {
      this.timers.clear(entry.timer);
      entry.resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  private request(body: RequestBody): Promise<ResultMessage | ErrorMessage> {
    const { promise, resolve } = Promise.withResolvers<ResultMessage | ErrorMessage>();
    const reqId = this.newReqId();
    if (this.disposed) {
      resolve(errorMessage(reqId, "unavailable", "The extension was unloaded"));
      return promise;
    }
    const ms = timerMs(this.requestMs);
    const timer =
      ms === null
        ? null
        : this.timers.set(() => {
            if (!this.pending.delete(reqId)) return;
            resolve(errorMessage(reqId, "unavailable", `No reply from the engine within ${formatMs(ms)} (Settings → Timeouts → ${TIMEOUTS.requestMs.label}). It may still finish what was asked.`));
          }, ms);
    this.pending.set(reqId, { type: body.type, resolve, timer });
    const message = { ...body, lre: PROTOCOL_VERSION, reqId } as FrontendToBackend;
    try {
      this.transport.send(message);
    } catch (error) {
      this.pending.delete(reqId);
      this.timers.clear(timer);
      resolve(errorMessage(reqId, "unavailable", error instanceof Error ? error.message : String(error)));
    }
    return promise;
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
      case "lre.draft.changed":
        if (typeof payload.worldId === "string" && typeof payload.version === "number" && typeof payload.stored === "boolean" && (typeof payload.base === "string" || payload.base === null)) {
          const push: DraftChanged = { lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId: payload.worldId, version: payload.version, stored: payload.stored, base: payload.base };
          for (const listener of this.draftListeners) listener(push);
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
    entry.resolve(payload as unknown as ResultMessage);
  }

  private receiveError(payload: Record<string, unknown>): void {
    if (typeof payload.code !== "string" || typeof payload.message !== "string") return;
    const error = payload as unknown as ErrorMessage;
    const entry = typeof payload.reqId === "string" ? this.settle(payload.reqId) : null;
    if (entry) entry.resolve(error);
    else this.emitError(error);
  }

  private receiveSnapshot(payload: Record<string, unknown>): void {
    if (payload.chatId !== this.state.chatId || typeof payload.rev !== "number" || !isStateView(payload.view)) return;
    this.update({ ...this.state, rev: payload.rev, view: payload.view, status: "live" });
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
