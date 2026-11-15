// The stand-in Lumiverse's extension host (`lumiverse.ts` builds on it): Spindle's side of each installed
// extension, as its worker sees it, with what a test does to it; what a worker registers (its World Info
// interceptor, its prompt interceptor, its handlers); the events forwarded to its worker; the interceptor
// pipeline a generation's prompt goes through; and the proxy that is an extension's road out. Also the
// stand-in's network, which the proxy and the chat connections reach: a table of handlers by origin, where
// an address with none answers as a stopped server does. What it copies from Lumiverse's source (staging at
// a70f4ed2) says the file and lines; paths are Lumiverse's `src/`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { ExtSpindle, InterceptorReturn, PermissionChange, PromptMessageDTO, ProxyAnswer } from "../../src/ext/spindle";
import type { WorldInfoResult } from "./lore";
import type { LlmMessage } from "./steps";

export type Server = (request: Request) => Promise<Response>;

/** The extension side of one installed extension: Spindle's API as its worker sees it, and what the test does to it. */
export interface Installed extends ExtSpindle {
  /** Low-level, for a test that starts a worker by hand with `install(granted)`: the change reaches the worker at once, with none of the manager's announcements (an admin's grant is `spindle.setPermissions`). */
  grant(permission: string): void;
  revoke(permission: string): void;
  /** Its worker stopped: every registration of it goes, as Lumiverse drops them (`spindle/worker-host.ts:1563-1576`), and so does all it held in memory. */
  stop(): void;
  readonly logs: string[];
  /** Lumiverse's id for it. */
  readonly id: string;
  /** Where it was installed for: one user's alone (`install_scope: "user"`, with who installed it), or the operator's, for every user (`worker-host.ts:getScopedUserId`). */
  readonly scope: "user" | "operator";
  readonly installedBy: string | null;
  /**
   * `spindle.storage` (`spindle/worker-host-storage-api.ts:124-135`, `:173-185`): the extension's own folder, `<data>/extensions/<identifier>/storage/`, or for a user-scoped
   * extension its installer's `<data>/users, <user>/extensions/<identifier>/`; a path out of it is refused, a file that is not there is "File not found".
   */
  readonly storage: { read(path: string): Promise<string>; write(path: string, data: string): Promise<void> };
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
  scope: "user" | "operator";
  installedBy: string | null;
  /** Its worker stopped: nothing is delivered to it, and a task already posted to it is dropped. */
  stopped: boolean;
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

/** What the host's timers run on: the three calls of RPH's `Clock`. A test gives its own to move time by hand. */
export interface HostClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The process's own clock, where a test gives none; its timers do not keep the test process alive. */
export const PROCESS_CLOCK: HostClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as Timer),
};

/** Spindle's proxy limit (`spindle/worker-host.ts:771`): fixed, as Lumiverse has it. */
export const PROXY_TIMEOUT_MS = 30_000;

export class ExtensionHost {
  readonly servers = new Map<string, Server>();
  readonly log: string[] = [];
  /**
   * Lumiverse's data folder as the extensions' files sit in it (`manager.service.ts:707-721`, `:2109-2135`; `auth/provision.ts:38-49`): each file by its path from the data
   * folder, `extensions/<identifier>/storage/<path>` for an operator's extension, `users/<user>/extensions/<identifier>/<path>` for a user's files. Held in memory, and written
   * to the folder `dataDir` names where a test gives one, so a reader of the files finds them where Lumiverse puts them.
   */
  readonly disk = new Map<string, string>();
  dataDir: string | null = null;
  /** Where `sendToFrontend` delivers: a test's sockets say whether the session was there; with none, nothing is delivered. */
  frontends: ((message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }) => boolean) | null = null;

  frontendSent(message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }): boolean {
    return this.frontends?.(message) ?? false;
  }
  protected readonly installed: Ext[] = [];
  /** The clock every timer of the host runs on: the process's own unless a test gives one it moves by hand. */
  clock: HostClock = PROCESS_CLOCK;
  /** How a later task is run: on the host's clock, so a test that moves time runs the worker's tasks too. */
  later: (run: () => void) => void = (run) => void this.clock.setTimeout(run, 0);
  /** `DEFAULT_INTERCEPTOR_TIMEOUT_MS` (`services/spindle-settings.service.ts:6`). */
  interceptorTimeoutMs = 10_000;
  protected worldInfo: Registration<WorldInfoHandler>[] = [];
  protected interceptors: Registration<PromptHandler>[] = [];
  /** The context handlers (`spindle/context-handler.ts`), each with its wall-clock budget. */
  protected contextHandlers: (Registration<ContextHandler> & { timeoutMs: number })[] = [];

  /** A file under the data folder: in memory, else on the disk where `dataDir` names a folder. */
  readFile(path: string): string | undefined {
    const held = this.disk.get(path);
    if (held !== undefined || this.dataDir === null) return held;
    const real = join(this.dataDir, path);
    return existsSync(real) ? readFileSync(real, "utf-8") : undefined;
  }

  writeFile(path: string, text: string): void {
    this.disk.set(path, text);
    if (this.dataDir === null) return;
    const real = join(this.dataDir, path);
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, text, "utf-8");
  }

  /** `resolveWithin` (`spindle/worker-host-storage-api.ts:128-135`): the path inside the base, or "Path traversal detected". */
  private within(base: string, requested: string): string {
    const target = posix.normalize(posix.join(base, requested));
    if (target !== base && !target.startsWith(`${base}/`)) throw new Error("Path traversal detected");
    return target;
  }

  private nextId = 1;

  /**
   * Starts an extension's worker with these permissions granted, and gives its view of Spindle. The id and the install scope are the manager's own where it
   * makes the worker (`spindle.ts`); a test that starts one by hand gets the next id, an operator's scope and its manifest `identifier` as its id.
   */
  install(granted: readonly string[], identifier?: string, options: { id?: string; scope?: "user" | "operator"; installedBy?: string | null } = {}): Installed {
    const id = options.id ?? `ext-${this.nextId++}`;
    const scope = options.scope ?? "operator";
    const ext: Ext = { id, identifier: identifier ?? id, scope, installedBy: options.installedBy ?? null, stopped: false, granted: new Set(granted), changed: new Set(), handlers: new Map(), forwarded: new Set(), frontend: new Set(), logs: [] };
    const modals = new Map<string, { title: string; items: unknown[] }>();
    const host = this;
    const change = (permission: string, granted: boolean): void => {
      if (granted) ext.granted.add(permission);
      else ext.granted.delete(permission);
      for (const handler of ext.changed) handler({ permission, granted, allGranted: [...ext.granted] });
    };
    /** The extension's own folder, by its install scope (`worker-host-storage-api.ts:116-122`). */
    const storageRoot = (): string => {
      if (ext.scope === "user") {
        if (ext.installedBy === null) throw new Error("Extension owner is not set");
        return `users/${ext.installedBy}/extensions/${ext.identifier}`;
      }
      return `extensions/${ext.identifier}/storage`;
    };
    /** The folder `userStorage` reads and writes (`:249-262`): a user-scoped extension's installer's, else the user the call names. */
    const userRoot = (requested: string | undefined): string => {
      if (ext.scope === "user") {
        if (ext.installedBy === null) throw new Error("Extension owner is not set");
        return `users/${ext.installedBy}/extensions/${ext.identifier}`;
      }
      if (requested === undefined || requested === "") throw new Error("userId is required for operator-scoped extensions");
      return `users/${requested}/extensions/${ext.identifier}`;
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
      scope: ext.scope,
      installedBy: ext.installedBy,
      storage: {
        read: async (path) => {
          const text = host.readFile(host.within(storageRoot(), path));
          if (text === undefined) throw new Error("File not found");
          return text;
        },
        write: async (path, data) => host.writeFile(host.within(storageRoot(), path), data),
      },
      userStorage: {
        // `getJson` reads the fallback for a missing or unreadable file, and for a call the host refuses, an operator-scoped extension's with no user among them
        // (`spindle/worker-runtime.ts:2198-2210`); `setJson` throws what the host says (`:2211-2221`).
        getJson: async <T>(path: string, options: { fallback: T; userId?: string }): Promise<T> => {
          try {
            const text = host.readFile(host.within(userRoot(options.userId), path));
            return text === undefined ? options.fallback : (JSON.parse(text) as T);
          } catch {
            return options.fallback;
          }
        },
        setJson: async (path, value, options) => host.writeFile(host.within(userRoot(options?.userId), path), JSON.stringify(value, null, 2)),
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
        ext.stopped = true;
        host.installed.splice(0, host.installed.length, ...host.installed.filter((e) => e !== ext));
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

  /**
   * An event for the extensions' workers alone: listeners run on a later task, never inline; the worker gets the payload and its user (`spindle/worker-host.ts:2917-2932`,
   * `spindle/worker-runtime.ts:4773-4786`). An extension installed for one user hears that user's events alone, and none that name no user (`:2920-2922`), and the
   * announcement of a permission's change reaches the extension it is about (`:2923-2929`).
   */
  toWorkers(event: string, payload: unknown, userId?: string): void {
    for (const ext of this.installed) {
      if (!ext.forwarded.has(event)) continue;
      if (ext.scope === "user" && userId !== ext.installedBy) continue;
      if (event === "SPINDLE_PERMISSION_CHANGED" && (payload as { extensionId?: string } | null)?.extensionId !== ext.id) continue;
      const copy = structuredClone(payload);
      this.later(() => {
        if (ext.stopped) return;
        for (const handler of ext.handlers.get(event) ?? []) handler(copy, userId);
      });
    }
  }

  /**
   * A permission granted or revoked reaches the running worker (`spindle/worker-host.ts:1648-1656`, `spindle/worker-runtime.ts:5065-5090`): posted to it, and handled on a later
   * task, where its grants become the set the host sent whole, and its `onChanged` handlers and those of `PERMISSION_CHANGED` hear the detail, which names the extension by its
   * identifier. Until then the worker still holds what it held.
   */
  notifyPermissionChanged(id: string, permission: string, granted: boolean, allGranted: readonly string[]): void {
    const ext = this.installed.find((e) => e.id === id);
    if (ext === undefined) return;
    const detail = { extensionId: ext.identifier, permission, granted, allGranted: [...allGranted] };
    this.later(() => {
      if (ext.stopped) return;
      ext.granted.clear();
      for (const p of detail.allGranted) ext.granted.add(p);
      for (const handler of [...ext.changed]) {
        try {
          handler(detail);
        } catch (error) {
          ext.logs.push(`Permission changed handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const handler of [...(ext.handlers.get("PERMISSION_CHANGED") ?? [])]) {
        try {
          handler(detail);
        } catch (error) {
          ext.logs.push(`PERMISSION_CHANGED event handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  }

  // ---------------------------------------------------------------- the network

  /**
   * A request on the stand-in's network: the handler at its origin, or a refused connection. A request given a signal ends when the signal does, as a
   * `fetch` does, whether or not the handler heeds it.
   */
  async fetch(url: string, init: RequestInit): Promise<Response> {
    const origin = new URL(url).origin;
    const server = this.servers.get(origin);
    if (server === undefined) throw new Error("Unable to connect. Is the computer able to access the url?");
    const signal = init.signal;
    if (signal === undefined || signal === null) return await server(new Request(url, init));
    if (signal.aborted) throw signal.reason ?? new DOMException("This operation was aborted", "AbortError");
    const aborted = Promise.withResolvers<never>();
    const onAbort = (): void => aborted.reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([server(new Request(url, init)), aborted.promise]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Spindle's proxy (`spindle/worker-host.ts:4641-4741`): needs `cors_proxy`; loopback allowed (`allowPrivate`, `utils/safe-fetch.ts:267-286`); 30 seconds; the body as text. */
  private async proxy(ext: Ext, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<ProxyAnswer> {
    if (!ext.granted.has("cors_proxy")) throw new Error("Permission denied: cors_proxy — CORS proxy permission not granted");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Only http and https URLs are allowed, got: ${parsed.protocol}`);
    const timeout = Promise.withResolvers<never>();
    const timer = this.clock.setTimeout(() => timeout.reject(new Error("The operation timed out.")), PROXY_TIMEOUT_MS);
    try {
      const res = await Promise.race([this.fetch(url, { method: init.method, headers: init.headers, body: init.body }), timeout.promise]);
      return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
    } finally {
      this.clock.clearTimeout(timer);
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
      const timer = this.clock.setTimeout(() => {
        const error = new Error(`Context handler from ${registration.ext.id} timed out (${Math.round(registration.timeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      }, registration.timeoutMs);
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
        this.clock.clearTimeout(timer);
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
      const timer = this.clock.setTimeout(() => {
        const error = new Error(`Interceptor from extension timed out (${Math.round(this.interceptorTimeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      }, this.interceptorTimeoutMs);
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
        this.clock.clearTimeout(timer);
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
