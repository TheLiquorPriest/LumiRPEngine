// The stand-in Lumiverse's extension host (`lumiverse.ts` builds on it): Spindle's side of each installed
// extension, as its worker sees it, with what a test does to it; what a worker registers (its World Info
// interceptor, its prompt interceptor, its handlers); the events forwarded to its worker; the interceptor
// pipeline a generation's prompt goes through; and the proxy that is an extension's road out. Also the
// stand-in's network, which the proxy and the chat connections reach: a table of handlers by origin, where
// an address with none answers as a stopped server does. What it copies from Lumiverse's source (staging at
// a70f4ed2) says the file and lines; paths are Lumiverse's `src/`.

import type { ExtSpindle, InterceptorReturn, PermissionChange, PromptMessageDTO, ProxyAnswer } from "../../src/ext/spindle";
import type { WorldInfoResult } from "./lore";
import type { LlmMessage } from "./steps";

export type Server = (request: Request) => Promise<Response>;

/** The extension side of one installed extension: Spindle's API as its worker sees it, and what the test does to it. */
export interface Installed extends ExtSpindle {
  grant(permission: string): void;
  revoke(permission: string): void;
  /** Its worker stopped: every registration of it goes, as Lumiverse drops them (`spindle/worker-host.ts:1563-1576`), and so does all it held in memory. */
  stop(): void;
  readonly logs: string[];
  /** Lumiverse's id for it. */
  readonly id: string;
  /** Its manifest's identifier, which names its own namespace of a preset's metadata (`spindle/worker-host.ts:3173`); by default its id. */
  readonly identifier: string;
  /**
   * One per extension; a second replaces the first (`spindle/worker-host.ts:4922`). Needs `generation` (`:4910-4919`). What it gives back is
   * Lumiverse's whole result (`WorldInfoInterceptorResultDTO`), of which RPE's own extension gives `disabled`, `enabled` and `mutated`.
   */
  registerWorldInfoInterceptor(handler: (ctx: unknown) => Promise<WorldInfoResult | void>, priority?: number): void;
  /** A `SPINDLE_BACKEND_MSG` from one of a user's sockets (`ws/handler.ts:440-467`). */
  fromFrontend(payload: unknown, user: string, session?: string): void;
  /** The modals it opened and has not closed, by user. */
  readonly modals: Map<string, { title: string; items: unknown[] }>;
  /**
   * `spindle.registerContextHandler` (`spindle/worker-runtime.ts:4288-4296`), which RPE's own extension does not call: another
   * extension's handler, given each generation's context first and giving back the context the generation goes on with.
   */
  registerContextHandler(handler: ContextHandler, priority?: number, opts?: { timeoutMs?: number; required?: boolean }): void;
}

export interface Ext {
  id: string;
  identifier: string;
  granted: Set<string>;
  changed: Set<(change: PermissionChange) => void>;
  /** The worker's handlers by event (`spindle/worker-runtime.ts:1747-1765`). */
  handlers: Map<string, Set<(payload: unknown, userId?: string) => void>>;
  /** The events the host forwards to it (`spindle/worker-host.ts:2885-2951`). */
  forwarded: Set<string>;
  frontend: Set<(payload: unknown, userId: string, session?: string) => void>;
  logs: string[];
}

export interface Registration<H> {
  ext: Ext;
  priority: number;
  handler: H;
  required: boolean;
}

export type WorldInfoHandler = (ctx: unknown) => Promise<WorldInfoResult | void>;
type PromptHandler = (messages: PromptMessageDTO[], context: unknown) => Promise<InterceptorReturn>;
export type ContextHandler = (context: unknown, signal?: AbortSignal) => Promise<unknown>;

/** Events that need `generation` (`spindle/worker-host.ts:2877-2883`). */
const GENERATION_EVENTS: Record<string, true> = { GENERATION_STARTED: true, GENERATION_IN_PROGRESS: true, GENERATION_ENDED: true, GENERATION_STOPPED: true, STREAM_TOKEN_RECEIVED: true };

/** A timer that does not keep the test process alive. */
export function quietTimer(ms: number, fn: () => void): Timer {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return timer;
}

export class ExtensionHost {
  readonly servers = new Map<string, Server>();
  readonly log: string[] = [];
  /** Each user's extension storage, by user and path (the stand-in's disk). */
  readonly storage = new Map<string, string>();
  /** Where `sendToFrontend` delivers: a test's sockets say whether the session was there; with none, nothing is delivered. */
  frontends: ((message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }) => boolean) | null = null;

  frontendSent(message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }): boolean {
    return this.frontends?.(message) ?? false;
  }
  protected readonly installed: Ext[] = [];
  /** How a later task is run: on the process's own timers unless a test runs a clock of its own. */
  later: (run: () => void) => void = (run) => void setTimeout(run, 0);
  /** `DEFAULT_INTERCEPTOR_TIMEOUT_MS` (`services/spindle-settings.service.ts:6`). */
  interceptorTimeoutMs = 10_000;
  /** A World Info interceptor's limit (`spindle/worker-host.ts:4937-4943`). */
  worldInfoTimeoutMs = 10_000;
  /** Spindle's proxy limit (`spindle/worker-host.ts:771`). */
  proxyTimeoutMs = 30_000;
  protected worldInfo: Registration<WorldInfoHandler>[] = [];
  protected interceptors: Registration<PromptHandler>[] = [];
  /** The context handlers (`spindle/context-handler.ts`), each with its wall-clock budget. */
  protected contextHandlers: (Registration<ContextHandler> & { timeoutMs: number })[] = [];
  /** The timer a context handler's budget runs on: the process's own unless a test gives one; gives what clears it. */
  budgetTimer: (ms: number, fire: () => void) => () => void = (ms, fire) => {
    const timer = quietTimer(ms, fire);
    return () => clearTimeout(timer);
  };

  /** Installs an extension with these permissions granted, and gives its worker's view of Spindle; its manifest `identifier` is its id unless one is given. */
  install(granted: readonly string[], identifier?: string): Installed {
    const id = `ext-${this.installed.length + 1}`;
    const ext: Ext = { id, identifier: identifier ?? id, granted: new Set(granted), changed: new Set(), handlers: new Map(), forwarded: new Set(), frontend: new Set(), logs: [] };
    const modals = new Map<string, { title: string; items: unknown[] }>();
    const host = this;
    const change = (permission: string, granted: boolean): void => {
      if (granted) ext.granted.add(permission);
      else ext.granted.delete(permission);
      // `permission_changed` (`spindle/worker-runtime.ts:5065-5090`).
      for (const handler of ext.changed) handler({ permission, granted, allGranted: [...ext.granted] });
    };
    // Each list is kept sorted by priority, lowest first; equal ones in the order registered (`spindle/interceptor-pipeline.ts:87-90`,
    // `spindle/world-info-interceptor.ts:192-194`, `spindle/context-handler.ts:23-26`).
    const place = <R extends Registration<unknown>>(list: R[], registration: R): R[] =>
      [...list.filter((r) => r.ext !== ext), registration].sort((a, b) => a.priority - b.priority);
    const api: Installed = {
      logs: ext.logs,
      id: ext.id,
      identifier: ext.identifier,
      modals,
      fromFrontend(payload, user, session) {
        // The host posts it to the worker, which runs its handlers on a later task (`spindle/worker-host.ts:1611-1613`).
        const copy = structuredClone(payload);
        host.later(() => {
          for (const handler of ext.frontend) handler(copy, user, session);
        });
      },
      sendToFrontend(payload, user, options) {
        const session = options?.frontendSessionId;
        const delivered = host.frontendSent({ extension: ext.id, payload: structuredClone(payload), user, session });
        // A message for a session that is gone tells the worker so, and no socket (`spindle/worker-host.ts:2143-2149`).
        if (!delivered && session !== undefined && user !== undefined) host.toWorkers("FRONTEND_SESSION_CLOSED", { frontendSessionId: session }, user);
      },
      onFrontendMessage(handler) {
        ext.frontend.add(handler);
        return () => ext.frontend.delete(handler);
      },
      userStorage: {
        // `getJson` reads the fallback for a missing or unreadable file (`spindle/worker-runtime.ts:2198-2210`).
        getJson: async <T>(path: string, options: { fallback: T; userId?: string }): Promise<T> => {
          const text = host.storage.get(`${options.userId ?? ""}\u0000${path}`);
          if (text === undefined) return options.fallback;
          try {
            return JSON.parse(text) as T;
          } catch {
            return options.fallback;
          }
        },
        setJson: async (path, value, options) => {
          host.storage.set(`${options?.userId ?? ""}\u0000${path}`, JSON.stringify(value, null, 2));
        },
      },
      modal: {
        // A modal opened with a request id of the caller's is closed by it (`spindle/worker-host-presentation-api.ts:486-554`).
        open: async (options) => {
          modals.set(`${options.userId ?? ""}\u0000${options.modalRequestId ?? ""}`, { title: options.title, items: options.items });
          return { dismissedBy: "extension" };
        },
        close: async (id, user) => {
          modals.delete(`${user ?? ""}\u0000${id}`);
        },
      },
      grant: (permission) => change(permission, true),
      revoke: (permission) => change(permission, false),
      stop() {
        host.worldInfo = host.worldInfo.filter((r) => r.ext !== ext);
        host.interceptors = host.interceptors.filter((r) => r.ext !== ext);
        host.contextHandlers = host.contextHandlers.filter((r) => r.ext !== ext);
        ext.handlers.clear();
        ext.forwarded.clear();
        ext.changed.clear();
        ext.frontend.clear();
      },
      registerWorldInfoInterceptor(handler, priority) {
        // `spindle/worker-host.ts:4909-4958`: needs `generation`; one per extension.
        if (!ext.granted.has("generation")) {
          ext.logs.push("permission_denied: generation (registerWorldInfoInterceptor)");
          return;
        }
        host.worldInfo = place(host.worldInfo, { ext, priority: priority ?? 100, handler, required: false });
      },
      registerInterceptor(handler, options) {
        // `spindle/worker-host.ts:3137-3233`: needs `interceptor`; one per extension.
        if (!ext.granted.has("interceptor")) {
          ext.logs.push("permission_denied: interceptor (registerInterceptor)");
          return () => undefined;
        }
        const registration: Registration<PromptHandler> = { ext, priority: options.priority ?? 100, handler, required: options.required === true };
        host.interceptors = place(host.interceptors, registration);
        return () => {
          host.interceptors = host.interceptors.filter((r) => r !== registration);
        };
      },
      registerContextHandler(handler, priority, opts) {
        // `spindle/worker-host.ts:4745-4797`: needs `context_handler`; one per extension, a second replacing the first; its budget
        // 10 seconds, or the one asked for held between 1 and 120.
        if (!ext.granted.has("context_handler")) {
          host.log.push(`[Spindle:${ext.id}] Context handler permission not granted`);
          ext.logs.push("permission_denied: context_handler (registerContextHandler)");
          return;
        }
        const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) ? Math.min(Math.max(opts.timeoutMs, 1_000), 120_000) : 10_000;
        host.contextHandlers = place(host.contextHandlers, { ext, priority: priority ?? 100, handler, required: opts?.required === true, timeoutMs });
      },
      on(event, handler) {
        // `spindle/worker-runtime.ts:1747-1765`: the host is asked once, when the first handler is added.
        let set = ext.handlers.get(event);
        if (set === undefined) {
          set = new Set();
          ext.handlers.set(event, set);
          if (Object.hasOwn(GENERATION_EVENTS, event) && !ext.granted.has("generation")) ext.logs.push(`permission_denied: generation (subscribe_event:${event})`);
          else ext.forwarded.add(event);
        }
        set.add(handler);
        return () => {
          set.delete(handler);
          if (set.size === 0) {
            ext.handlers.delete(event);
            ext.forwarded.delete(event);
          }
        };
      },
      cors: (url, init) => host.proxy(ext, url, init),
      permissions: {
        has: (permission) => ext.granted.has(permission),
        getGranted: async () => [...ext.granted],
        onChanged(handler) {
          ext.changed.add(handler);
          return () => ext.changed.delete(handler);
        },
      },
      log: {
        info: (message) => ext.logs.push(message),
        warn: (message) => ext.logs.push(message),
        error: (message) => ext.logs.push(message),
      },
    };
    this.installed.push(ext);
    return api;
  }

  /** An event for the extensions' workers alone: listeners run on a later task, never inline; the worker gets the payload and its user (`spindle/worker-host.ts:2917-2932`, `spindle/worker-runtime.ts:4773-4786`). */
  toWorkers(event: string, payload: unknown, userId: string): void {
    for (const ext of this.installed) {
      if (!ext.forwarded.has(event)) continue;
      const copy = structuredClone(payload);
      this.later(() => {
        for (const handler of ext.handlers.get(event) ?? []) handler(copy, userId);
      });
    }
  }

  // ---------------------------------------------------------------- the network

  /** A request on the stand-in's network: the handler at its origin, or a refused connection. */
  async fetch(url: string, init: RequestInit): Promise<Response> {
    const origin = new URL(url).origin;
    const server = this.servers.get(origin);
    if (server === undefined) throw new Error("Unable to connect. Is the computer able to access the url?");
    return await server(new Request(url, init));
  }

  /** Spindle's proxy (`spindle/worker-host.ts:4641-4741`): needs `cors_proxy`; loopback allowed (`allowPrivate`, `utils/safe-fetch.ts:267-286`); 30 seconds; the body as text. */
  private async proxy(ext: Ext, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<ProxyAnswer> {
    if (!ext.granted.has("cors_proxy")) throw new Error("Permission denied: cors_proxy — CORS proxy permission not granted");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Only http and https URLs are allowed, got: ${parsed.protocol}`);
    const timeout = Promise.withResolvers<never>();
    const timer = quietTimer(this.proxyTimeoutMs, () => timeout.reject(new Error("The operation timed out.")));
    try {
      const res = await Promise.race([this.fetch(url, { method: init.method, headers: init.headers, body: init.body }), timeout.promise]);
      return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- the context handlers

  /**
   * `ContextHandlerChain.run` (`spindle/context-handler.ts:39-131`), each handler behind its worker call (`spindle/worker-host.ts:
   * 4771-4796`, `spindle/worker-runtime.ts:4886-4917`): lowest priority first, each given the context the one before gave back and
   * giving back the one after, within its budget. A handler that throws or runs out of budget is passed over, the context as it
   * was, unless it is required: then the generation fails with its error.
   */
  protected async contextHandlerChain(context: Record<string, unknown>, userId: string): Promise<unknown> {
    let result: unknown = context;
    for (const registration of this.contextHandlers) {
      const controller = new AbortController();
      const timeout = Promise.withResolvers<never>();
      const clear = this.budgetTimer(registration.timeoutMs, () => {
        const error = new Error(`Context handler from ${registration.ext.id} timed out (${Math.round(registration.timeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      });
      try {
        const call = (async () => {
          try {
            // Across the worker's boundary both ways, so a copy each way (`spindle/worker-runtime.ts:4891-4896`).
            return structuredClone(await registration.handler(structuredClone(result), controller.signal));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            registration.ext.logs.push(`Context handler error: ${message}`);
            throw new Error(message);
          }
        })();
        // A handler that fails after its budget ran out fails no one: the chain has gone on.
        call.catch(() => undefined);
        result = await Promise.race([call, timeout.promise]);
      } catch (error) {
        this.log.push(`[Spindle] Context handler error from ${registration.ext.id} (user ${userId}): ${error instanceof Error ? error.message : String(error)}`);
        if (registration.required) throw error;
      } finally {
        clear();
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- the interceptor pipeline

  /**
   * The interceptor pipeline (`spindle/interceptor-pipeline.ts:103-227`), each handler behind its
   * worker call: the messages it is given carry the history and lore flags (`spindle/worker-host.ts:
   * 3184-3198`); a throw comes back as an error (`spindle/worker-runtime.ts:4813-4826`,
   * `spindle/worker-host.ts:1918-1921`); parameters are dropped without `generation_parameters`
   * (`spindle/worker-host.ts:1922-1931`).
   */
  protected async interceptorPipeline(messages: LlmMessage[], context: Record<string, unknown>): Promise<{ messages: LlmMessage[]; parameters: Record<string, unknown> | undefined }> {
    let result = messages;
    // `collectSourceMessageMetadata` (`spindle/source-message-metadata.ts:59-75`).
    const sources = new Map<string, { index: number; metadata: unknown }>();
    for (const m of messages) if (m.__chatHistorySource === true && typeof m.__sourceMessageId === "string" && typeof m.__sourceIndexInChat === "number") sources.set(m.__sourceMessageId, { index: m.__sourceIndexInChat, metadata: m.__sourceMessageMetadata ?? {} });
    let merged: Record<string, unknown> | undefined;
    for (const registration of this.interceptors) {
      // `restoreSourceMessageMetadata` (`spindle/source-message-metadata.ts:77-106`), before each.
      for (const m of result) {
        const isHistory = m.__chatHistorySource === true || m.__isChatHistory === true;
        const id = typeof m.sourceMessageId === "string" ? m.sourceMessageId : typeof m.__sourceMessageId === "string" ? m.__sourceMessageId : undefined;
        for (const key of ["__chatHistorySource", "__sourceMessageId", "__sourceIndexInChat", "__sourceMessageMetadata", "__isChatHistory", "sourceMessageId", "sourceIndexInChat"]) delete m[key];
        const identity = isHistory && id !== undefined ? sources.get(id) : undefined;
        if (identity === undefined) continue;
        m.__chatHistorySource = true;
        m.__sourceMessageId = id;
        m.__sourceIndexInChat = identity.index;
        m.__sourceMessageMetadata = identity.metadata;
      }
      const dto = result.map((m) => {
        const isHistory = m.__chatHistorySource === true;
        const isLore = m.__worldInfoSource === true;
        if (!isHistory && !isLore) return m;
        return { ...m, ...(isHistory ? { __isChatHistory: true } : {}), ...(isLore ? { __isWorldInfoEntry: true } : {}), ...(typeof m.__sourceMessageId === "string" ? { sourceMessageId: m.__sourceMessageId } : {}), ...(typeof m.__sourceIndexInChat === "number" ? { sourceIndexInChat: m.__sourceIndexInChat } : {}) };
      });
      const controller = new AbortController();
      const timeout = Promise.withResolvers<never>();
      const timer = quietTimer(this.interceptorTimeoutMs, () => {
        const error = new Error(`Interceptor from extension timed out (${Math.round(this.interceptorTimeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      });
      try {
        const call = (async () => {
          let returned: InterceptorReturn;
          try {
            returned = await registration.handler(structuredClone(dto) as PromptMessageDTO[], { ...projectedContext(context, registration.ext), signal: controller.signal });
          } catch (error) {
            throw new Error(error instanceof Error ? error.message : String(error));
          }
          const normalized = Array.isArray(returned) ? { messages: returned } : returned;
          let parameters = normalized.parameters;
          if (parameters && Object.keys(parameters).length > 0 && !registration.ext.granted.has("generation_parameters")) {
            this.log.push("Stripping interceptor parameters — generation_parameters permission not granted");
            parameters = undefined;
          }
          return { messages: structuredClone(normalized.messages) as LlmMessage[], parameters };
        })();
        const output = await Promise.race([call, timeout.promise]);
        result = output.messages;
        if (output.parameters && Object.keys(output.parameters).length > 0) merged = { ...merged, ...output.parameters };
      } catch (error) {
        this.log.push(`[Spindle] Interceptor error: ${error instanceof Error ? error.message : String(error)}`);
        if (registration.required) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return { messages: result, parameters: merged };
  }
}

/** `toCaptureDTO` (`spindle/world-info-capture.ts:17-29`): an activated entry as an extension is told it, a peer's book told as a persona's. */
function toldEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const dto: Record<string, unknown> = { id: entry.id, comment: entry.comment, keys: entry.keys, source: entry.source };
  if (entry.score !== undefined) dto.score = entry.score;
  if (entry.bookId !== undefined) dto.bookId = entry.bookId;
  if (entry.bookSource === "peer") dto.bookSource = "persona";
  else if (entry.bookSource !== undefined) dto.bookSource = entry.bookSource;
  return dto;
}

/**
 * `projectWorldInfoCaptureContext` (`spindle/world-info-capture.ts:31-73`) over `projectPresetMetadataContext` (`spindle/preset-metadata-context.ts:48-76`),
 * as the worker host hands an interceptor its context (`spindle/worker-host.ts:3200-3204`): a copy, the full preset metadata gone and only the
 * extension's own namespace of it left as `presetMetadata`, each activated entry cut to what an extension is told, and `capturedWorldInfo` only
 * for the extension that asked to capture, never one the context already held.
 */
function projectedContext(context: Record<string, unknown>, ext: Ext): Record<string, unknown> {
  const projected = structuredClone(context);
  const metadata = projected.__spindlePresetMetadata;
  delete projected.__spindlePresetMetadata;
  // An identifier Lumiverse's preset editor owns names no namespace of an extension's (`:14-27`).
  const owned = LOOM_OWNED_PRESET_METADATA_KEYS.has(ext.identifier) || ext.identifier.startsWith("_lumiverse_");
  const own = !owned && typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && Object.hasOwn(metadata, ext.identifier) ? (metadata as Record<string, unknown>)[ext.identifier] : undefined;
  projected.presetMetadata = own === undefined ? undefined : structuredClone(own);
  const captures = projected.__spindleWorldInfoCaptures;
  delete projected.__spindleWorldInfoCaptures;
  delete projected.capturedWorldInfo;
  const told = (entries: unknown[]): Record<string, unknown>[] => entries.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string").map(toldEntry);
  if (Array.isArray(projected.activatedWorldInfo)) projected.activatedWorldInfo = told(projected.activatedWorldInfo);
  if (typeof captures === "object" && captures !== null && Object.hasOwn(captures, ext.id)) {
    const entries: unknown = (captures as Record<string, unknown>)[ext.id];
    projected.capturedWorldInfo = Array.isArray(entries) ? told(entries) : [];
  }
  return projected;
}

/** The preset metadata keys Lumiverse's own editor owns (`spindle/preset-metadata-context.ts:14-24`). */
const LOOM_OWNED_PRESET_METADATA_KEYS = new Set(["source", "modelProfiles", "schemaVersion", "description", "coverUrl", "cover_url", "isDefault", "lastProfileKey", "promptVariables"]);
