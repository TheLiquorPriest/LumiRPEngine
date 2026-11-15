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
import { readText, safeFetch } from "./safe-fetch";
import type { LlmMessage } from "./steps";

export type Server = (request: Request) => Promise<Response>;

/** A message an extension writes with `chat.appendMessage` (`ChatAppendMessageDTO`): its role, text, and optionally the name, the character who speaks it (an assistant's) and its own metadata. */
export interface ChatAppend {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
  characterId?: string;
  metadata?: Record<string, unknown>;
}

/** What the extensions' `chat` calls reach of the chats (`spindle/worker-host.ts:4019-4024`, `:4123-4448`): the stand-in's chat rows (`rows.ts`) give it. */
export interface ChatStore {
  /** The user who owns the chat (`chats.user_id`); none where there is no such chat. */
  ownerOf(chatId: string): string | undefined;
  hasMessage(chatId: string, messageId: string): boolean;
  isHidden(chatId: string, messageId: string): boolean;
  /** `bulkSetHidden` (`services/chats.service.ts:3087-3132`). */
  hide(chatId: string, messageIds: readonly string[], hidden: boolean): void;
  /** A message written as `handleChatAppendMessage` writes one; gives its id. */
  append(chatId: string, message: ChatAppend): string;
}

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
  /**
   * `spindle.registerInterceptor` (`spindle/worker-runtime.ts:1813-1836`): the priority is the number given, else the options'; the filter `match` and `required` are the options' (the third
   * argument's where a number is given). One per extension, a second replacing the first; needs `interceptor`. The host checks `match` against the generation's context before it calls the extension.
   */
  registerInterceptor(handler: PromptHandler, priorityOrOptions?: number | InterceptorOptions, options?: InterceptorOptions): () => void;
  /**
   * `spindle.chat` (`spindle/worker-runtime.ts:2432-2454`; `spindle/worker-host.ts:4123-4448`): messages written, hidden and shown after they are made. Each needs `chat_mutation` ("Permission denied: chat_mutation …" without it),
   * and a user-scoped extension reaches only its installer's chats. `triggerGeneration` is not modelled: a test starts a generation as the user does.
   */
  readonly chat: {
    setMessageHidden(chatId: string, messageId: string, hidden: boolean): Promise<void>;
    setMessagesHidden(chatId: string, messageIds: readonly string[], hidden: boolean): Promise<void>;
    isMessageHidden(chatId: string, messageId: string): Promise<boolean>;
    appendMessage(chatId: string, message: ChatAppend): Promise<{ id: string }>;
  };
}

/** An entry an extension's interceptor added to the breakdown (`type: "extension"`, `services/generate.service.ts:565-583`). */
export interface ExtensionBreakdownEntry {
  type: "extension";
  name: string;
  role: string;
  content: string;
  extensionId: string;
  extensionName: string;
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
  /** The manifest's own limit for its prompt interceptor (`manifest.interceptorTimeoutMs`, `spindle/worker-host.ts:3159-3163`); it wins over the user's Spindle setting. */
  interceptorTimeoutMs: number | undefined;
  /** The calls the host has posted to the worker and not had an answer to, each rejected where the worker stops (`spindle/worker-host.ts:1572-1576`). */
  pending: Set<(error: Error) => void>;
  /** Its prompt interceptor now: a result for any other registration is ignored (`spindle/worker-host.ts:1913-1917`). */
  interceptor: InterceptorRegistration | null;
}

export interface Registration<H> {
  ext: Ext;
  priority: number;
  handler: H;
  required: boolean;
}

/** `InterceptorMatchDTO` (`lumiverse-spindle-types` `api.ts:78-96`): the filter a prompt interceptor is registered with. */
export interface InterceptorMatch {
  generationTypes?: string[];
  isDryRun?: boolean;
  presetField?: { path: string[]; exists?: boolean; oneOf?: unknown[]; notIn?: unknown[] };
}

export interface InterceptorOptions {
  priority?: number;
  match?: InterceptorMatch;
  required?: boolean;
}

/** A prompt interceptor as the pipeline holds it (`spindle/interceptor-pipeline.ts:25-48`): for the user it is installed for alone, or for every user (`userId` null), behind its filter. */
export interface InterceptorRegistration extends Registration<PromptHandler> {
  match: InterceptorMatch | undefined;
  userId: string | null;
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

/** Spindle's proxy limits (`spindle/worker-host.ts:771-772`): fixed, as Lumiverse has them; the answer's cap is 25 MiB, 26,214,400 bytes. */
export const PROXY_TIMEOUT_MS = 30_000;
export const PROXY_MAX_BODY_BYTES = 25 * 1024 * 1024;

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

  /** The generating session of a user (`getActiveFrontendSession`, `spindle/frontend-session.ts:36-42`): the stand-in server answers it from its sockets; with none, none. */
  activeFrontendSession: (user: string) => string | undefined = () => undefined;

  /** What waits on each open modal, by the request id Lumiverse gives it (`worker-host-presentation-api.ts:504-512`). */
  private readonly modalWaits = new Map<string, { modals: Map<string, unknown>; key: string; resolve(answer: { dismissedBy: string }): void }[]>();

  waitForModal(requestId: string, wait: { modals: Map<string, unknown>; key: string; resolve(answer: { dismissedBy: string }): void }): void {
    this.modalWaits.set(requestId, [...(this.modalWaits.get(requestId) ?? []), wait]);
  }

  /**
   * A modal dismissed (`SPINDLE_MODAL_RESULT`, `ws/handler.ts:419-428`; `handleModalClose`, `:533-554`): every open modal of that request id gives, whichever user's socket said it (Lumiverse
   * matches the id alone), with who dismissed it, "user" where nobody says.
   */
  modalResult(requestId: string, dismissedBy?: string): void {
    const waiting = this.modalWaits.get(requestId) ?? [];
    this.modalWaits.delete(requestId);
    for (const wait of waiting) {
      wait.modals.delete(wait.key);
      wait.resolve({ dismissedBy: dismissedBy ?? "user" });
    }
  }

  /** An event on the bus (`ws/bus.ts:502-544`): to the extensions' workers; the host that has sockets (`rows.ts`) tells them too. */
  emit(event: string, payload: unknown, userId?: string, _options?: { topic?: string }): void {
    this.toWorkers(event, payload, userId);
  }

  /** An event posted to one worker alone (`postToWorker`, `spindle/worker-host.ts:1602-1609`): handled on a later task by its handlers, with no check that it asked for the event. */
  protected post(ext: Ext, event: string, payload: unknown, userId: string): void {
    const copy = structuredClone(payload);
    this.later(() => {
      if (ext.stopped) return;
      for (const handler of ext.handlers.get(event) ?? []) handler(copy, userId);
    });
  }

  protected readonly installed: Ext[] = [];
  /** The clock every timer of the host runs on: the process's own unless a test gives one it moves by hand. */
  clock: HostClock = PROCESS_CLOCK;
  /** How a later task is run: on the host's clock, so a test that moves time runs the worker's tasks too. */
  later: (run: () => void) => void = (run) => void this.clock.setTimeout(run, 0);
  /**
   * The oldest account, whose Spindle settings hold an operator's extension (`getFirstUserId`, `auth/seed.ts:34-52`): the stand-in server gives it the first account it was made with; null, and the
   * extension's limit is the default.
   */
  firstUser: string | null = null;

  /** A user's setting by its key (`getSetting`): the host that keeps the user's settings answers it (`rows.ts`); this one keeps none. */
  protected userSetting(_user: string, _key: string): unknown {
    return undefined;
  }

  /** The chats the extensions' `chat` calls reach: `rows.ts`, which holds them, gives them; this host holds none. */
  protected chatStore(): ChatStore | null {
    return null;
  }

  /**
   * The wall-clock limit of an extension's prompt interceptor, worked out at each call (`resolveInterceptorTimeout`, `services/spindle-settings.service.ts:6-8`, `:22-28`, `:38-62`; `spindle/worker-host.ts:3159-3163`): the
   * manifest's `interceptorTimeoutMs` where it has one, else the Spindle setting of the user it is installed for (an operator's: the oldest account's), 10 seconds where neither is set; held between 1 and 300 seconds.
   */
  protected interceptorTimeout(ext: Ext): number {
    const clamp = (raw: unknown): number => Math.min(300_000, Math.max(1_000, Math.floor(typeof raw === "number" && Number.isFinite(raw) ? raw : 10_000)));
    if (typeof ext.interceptorTimeoutMs === "number" && Number.isFinite(ext.interceptorTimeoutMs)) return clamp(ext.interceptorTimeoutMs);
    const scoped = ext.scope === "user" ? ext.installedBy : null;
    const user = scoped !== null && scoped.length > 0 ? scoped : this.firstUser;
    if (user === null) return clamp(undefined);
    const settings = this.userSetting(user, "spindleSettings");
    return clamp(typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>).interceptorTimeoutMs : undefined);
  }
  protected worldInfo: Registration<WorldInfoHandler>[] = [];
  protected interceptors: InterceptorRegistration[] = [];
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
  install(granted: readonly string[], identifier?: string, options: { id?: string; scope?: "user" | "operator"; installedBy?: string | null; interceptorTimeoutMs?: number } = {}): Installed {
    const id = options.id ?? `ext-${this.nextId++}`;
    const scope = options.scope ?? "operator";
    const ext: Ext = { id, identifier: identifier ?? id, scope, installedBy: options.installedBy ?? null, stopped: false, granted: new Set(granted), changed: new Set(), handlers: new Map(), forwarded: new Set(), frontend: new Set(), logs: [], interceptorTimeoutMs: options.interceptorTimeoutMs, pending: new Set(), interceptor: null };
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
    // The start of each `chat` call (`spindle/worker-host.ts:4130-4143`, `:4375-4377`): `chat_mutation`, the chat's owner, and a user-scoped extension reaching only its installer's chats (`enforceScopedUser`, `:1178-1186`).
    const reach = (chatId: string, before?: () => void): { store: ChatStore; owner: string } => {
      if (!ext.granted.has("chat_mutation")) throw new Error("Permission denied: chat_mutation — Chat mutation permission not granted");
      before?.();
      const store = host.chatStore();
      const owner = store?.ownerOf(chatId);
      if (store === null || owner === undefined) throw new Error("Chat not found");
      if (ext.scope === "user") {
        if (ext.installedBy === null) throw new Error("Extension owner is not set");
        if (owner !== ext.installedBy) throw new Error("Extension is user-scoped and cannot access this user context");
      }
      return { store, owner };
    };
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
        // `frontend_message` (`spindle/worker-host.ts:2129-2160`): a user-scoped extension reaches its installer alone, whatever user the call names; an operator's reaches the user it names, or
        // every user's pages where it names none. A session named is sent to alone; one that is gone, with a user to tell, tells the sending worker alone, on a later task.
        const target = ext.scope === "user" ? (ext.installedBy ?? undefined) : typeof user === "string" && user.length > 0 ? user : undefined;
        const session = options?.frontendSessionId;
        if (session) {
          const delivered = target !== undefined && host.frontendSent({ extension: ext.id, payload: structuredClone(payload), user: target, session });
          if (!delivered && target !== undefined) host.post(ext, "FRONTEND_SESSION_CLOSED", { frontendSessionId: session }, target);
          return;
        }
        host.frontendSent({ extension: ext.id, payload: structuredClone(payload), user: target, session: undefined });
      },
      onFrontendMessage(handler) {
        ext.frontend.add(handler);
        return () => ext.frontend.delete(handler);
      },
      connections: {
        // `connections_get` (`spindle/worker-host.ts:3718-3760`) needs `generation`; the stand-in keeps no connection record a worker reads, so none is found.
        get: async () => {
          if (!ext.granted.has("generation")) throw new Error("Permission denied: generation — Connection profile access requires the generation permission");
          return null;
        },
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
        // `handleModalOpen` and `handleModalClose` (`spindle/worker-host-presentation-api.ts:486-554`): the user is the installer's for a user-scoped extension, else the one the call names, and an
        // operator's call with none fails; the modal is announced to the user, and the call gives when the modal is dismissed, with who dismissed it. A modal opened with a request id of the
        // caller's is closed by it, which dismisses it as the extension.
        open: async (options) => {
          const resolved = ext.scope === "user" ? (ext.installedBy ?? "") : (options.userId ?? "");
          if (resolved === "") throw new Error("userId is required for operator-scoped extensions");
          const requestId = `spindle-modal:${ext.id}:${options.modalRequestId ?? crypto.randomUUID()}`;
          const key = `${resolved}\u0000${options.modalRequestId ?? ""}`;
          const answered = Promise.withResolvers<{ dismissedBy: string }>();
          host.waitForModal(requestId, { modals, key, resolve: answered.resolve });
          modals.set(key, { title: options.title, items: options.items });
          host.emit("SPINDLE_MODAL_OPEN", { requestId, extensionId: ext.id, extensionName: ext.identifier, title: options.title, items: options.items, persistent: options.persistent ?? false }, resolved);
          return await answered.promise;
        },
        close: async (id, user) => {
          const resolved = ext.scope === "user" ? (ext.installedBy ?? "") : (user ?? "");
          if (resolved === "") throw new Error("userId is required for operator-scoped extensions");
          host.modalResult(`spindle-modal:${ext.id}:${id}`, "extension");
        },
      },
      chat: {
        setMessageHidden: async (chatId, messageId, hidden) => {
          const { store } = reach(chatId);
          if (!store.hasMessage(chatId, messageId)) throw new Error("Message not found");
          store.hide(chatId, [messageId], !!hidden);
        },
        setMessagesHidden: async (chatId, messageIds, hidden) => {
          const { store } = reach(chatId, () => {
            if (!Array.isArray(messageIds)) throw new Error("messageIds must be an array of strings");
          });
          store.hide(chatId, messageIds.filter((id): id is string => typeof id === "string" && id !== ""), !!hidden);
        },
        isMessageHidden: async (chatId, messageId) => {
          const { store } = reach(chatId);
          if (!store.hasMessage(chatId, messageId)) throw new Error("Message not found");
          return store.isHidden(chatId, messageId);
        },
        appendMessage: async (chatId, message) => {
          const { store } = reach(chatId);
          return { id: store.append(chatId, message) };
        },
      },
      grant: (permission) => change(permission, true),
      revoke: (permission) => change(permission, false),
      stop() {
        ext.stopped = true;
        host.installed.splice(0, host.installed.length, ...host.installed.filter((e) => e !== ext));
        host.worldInfo = host.worldInfo.filter((r) => r.ext !== ext);
        // A new list, as `unregisterByExtension` makes one (`spindle/interceptor-pipeline.ts:97-101`): a run that holds the list it began with still reaches this extension's registration.
        host.interceptors = host.interceptors.filter((r) => r.ext !== ext);
        host.contextHandlers = host.contextHandlers.filter((r) => r.ext !== ext);
        ext.interceptor = null;
        // Every call awaiting the worker is rejected (`spindle/worker-host.ts:1572-1576`).
        const waiting = [...ext.pending];
        ext.pending.clear();
        for (const reject of waiting) reject(new Error("Extension worker stopped"));
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
      registerInterceptor(handler, priorityOrOptions, options) {
        // `spindle/worker-host.ts:3137-3233`: needs `interceptor`; one per extension, the one before dropped in place, the list kept by priority (`:3165-3167`; `spindle/interceptor-pipeline.ts:87-95`).
        if (!ext.granted.has("interceptor")) {
          ext.logs.push("permission_denied: interceptor (registerInterceptor)");
          return () => undefined;
        }
        const numbered = typeof priorityOrOptions === "number";
        const given = numbered ? options : priorityOrOptions;
        const registration: InterceptorRegistration = { ext, priority: (numbered ? priorityOrOptions : priorityOrOptions?.priority) ?? 100, handler, required: given?.required === true, match: given?.match, userId: ext.scope === "user" ? ext.installedBy : null };
        const before = host.interceptors.findIndex((r) => r.ext === ext);
        if (before !== -1) host.interceptors.splice(before, 1);
        host.interceptors.push(registration);
        host.interceptors.sort((a, b) => a.priority - b.priority);
        ext.interceptor = registration;
        return () => {
          // The worker disposes only the registration it still holds (`spindle/worker-runtime.ts:1830-1836`).
          if (ext.interceptor !== registration) return;
          ext.interceptor = null;
          const at = host.interceptors.indexOf(registration);
          if (at !== -1) host.interceptors.splice(at, 1);
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

  /**
   * Spindle's proxy (`spindle/worker-host.ts:4641-4741`): needs `cors_proxy`; the request goes through `safeFetch` (`safe-fetch.ts`) with Lumiverse's limits, 30 seconds on the host's clock until the body has ended and
   * 25 MiB of answer, loopback and private addresses allowed (`allowPrivate`), a JavaScript path or answer refused; the answer's body is read as text. A refusal reaches the worker as the error's own message.
   */
  private async proxy(ext: Ext, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<ProxyAnswer> {
    if (!ext.granted.has("cors_proxy")) throw new Error("Permission denied: cors_proxy — CORS proxy permission not granted");
    const res = await safeFetch(this, url, { method: init.method || "GET", headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}), timeoutMs: PROXY_TIMEOUT_MS, maxBytes: PROXY_MAX_BODY_BYTES, blockJavaScript: true });
    return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: await readText(res, PROXY_MAX_BODY_BYTES) };
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
      // A call posted to the worker is rejected where the worker stops (`spindle/worker-host.ts:1572-1576`).
      if (!registration.ext.stopped) registration.ext.pending.add(timeout.reject);
      const timer = this.clock.setTimeout(() => {
        const error = new Error(`Context handler from ${registration.ext.id} timed out (${Math.round(registration.timeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      }, registration.timeoutMs);
      try {
        const call = (async () => {
          // A worker that is gone is posted the request and answers none (`:1602-1609`): the budget ends the wait, for a run that holds the list it began with.
          if (registration.ext.stopped) return await new Promise<never>(() => undefined);
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
        registration.ext.pending.delete(timeout.reject);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- the interceptor pipeline

  /**
   * The interceptor pipeline (`spindle/interceptor-pipeline.ts:103-227`), each handler behind its worker call (`spindle/worker-host.ts:3137-3233`): for each registration of the list it holds
   * (`:97-101`: a stopped extension's registration is still reached by a run that began before it stopped), in priority order, skipped for another user's generation (`:116-118`) and where its filter
   * does not match the context (`:119-121`; `isDryRun` is never set on the context, which names `dryRun`, so a filter on it never matches), and a generation that has been stopped ends it (`:122-124`). Its limit is
   * worked out at each call (`:125-136`) and runs until the answer: the answer, the limit, the generation's stop and the worker's stop each end the wait, whichever comes first (`:150-171`); the messages it is
   * given carry the history and lore flags (`spindle/worker-host.ts:3184-3198`); a throw comes back as an error (`spindle/worker-runtime.ts:4813-4826`, `spindle/worker-host.ts:1918-1921`); parameters are dropped
   * without `generation_parameters` (`:1922-1931`); an answer for a registration the worker no longer holds is ignored (`:1913-1917`). A fault ends the generation only where the registration is required (`:187-212`),
   * and a stop of the generation always does (`:188-198`).
   */
  protected async interceptorPipeline(messages: LlmMessage[], context: Record<string, unknown>, userId: string | null, signal?: AbortSignal): Promise<{ messages: LlmMessage[]; parameters: Record<string, unknown> | undefined; breakdown: ExtensionBreakdownEntry[] }> {
    let result = messages;
    // `collectSourceMessageMetadata` (`spindle/source-message-metadata.ts:59-75`).
    const sources = new Map<string, { index: number; metadata: unknown }>();
    for (const m of messages) if (m.__chatHistorySource === true && typeof m.__sourceMessageId === "string" && typeof m.__sourceIndexInChat === "number") sources.set(m.__sourceMessageId, { index: m.__sourceIndexInChat, metadata: m.__sourceMessageMetadata ?? {} });
    let merged: Record<string, unknown> | undefined;
    const entries: (ExtensionBreakdownEntry & { messageIndex: number })[] = [];
    for (const registration of this.interceptors) {
      if (registration.userId && registration.userId !== userId) continue;
      if (!matchesInterceptor(registration.match, context, registration.ext.identifier)) continue;
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const timeoutMs = this.interceptorTimeout(registration.ext);
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
      const ended = Promise.withResolvers<never>();
      const timer = this.clock.setTimeout(() => {
        const error = new Error(`Interceptor from ${registration.ext.id} timed out (${Math.round(timeoutMs / 1000)}s)`);
        controller.abort(error);
        ended.reject(error);
      }, timeoutMs);
      const onAbort = (): void => {
        const error = signal?.reason ?? new DOMException("Aborted", "AbortError");
        controller.abort(error);
        ended.reject(error);
      };
      if (signal !== undefined) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
      // The request is posted to the worker, which rejects it where it stops; one posted to a worker that is gone is answered by nothing (`:1602-1609`).
      const posted = !registration.ext.stopped;
      if (posted) registration.ext.pending.add(ended.reject);
      try {
        const call = (async () => {
          if (!posted) return await new Promise<never>(() => undefined);
          let returned: InterceptorReturn;
          try {
            returned = await registration.handler(structuredClone(dto) as PromptMessageDTO[], { ...projectedContext(context, registration.ext), signal: controller.signal });
          } catch (error) {
            throw new Error(error instanceof Error ? error.message : String(error));
          }
          // A result for a registration the worker no longer holds, or for a worker that has stopped, is ignored (`:1913-1917`), so no answer comes and the limit ends the wait.
          if (registration.ext.interceptor !== registration || registration.ext.stopped) return await new Promise<never>(() => undefined);
          const normalized: { messages: PromptMessageDTO[]; parameters?: Record<string, unknown>; breakdown?: unknown } = Array.isArray(returned) ? { messages: returned } : returned;
          let parameters = normalized.parameters;
          if (parameters && Object.keys(parameters).length > 0 && !registration.ext.granted.has("generation_parameters")) {
            this.log.push("Stripping interceptor parameters — generation_parameters permission not granted");
            parameters = undefined;
          }
          // The entries the extension marks for the breakdown (`messageIndex`, `name`), each taken as the host takes it (`spindle/worker-host.ts:1932-1936`, `:3245-3270`): one whose index is no message of its own result is dropped.
          const marked = Array.isArray(normalized.breakdown) ? (normalized.breakdown as { messageIndex?: unknown; name?: unknown }[]) : [];
          const breakdown = marked.flatMap((entry): (ExtensionBreakdownEntry & { messageIndex: number })[] => {
            const messageIndex = Number(entry?.messageIndex);
            const message = normalized.messages[messageIndex];
            if (!Number.isInteger(messageIndex) || messageIndex < 0 || message === undefined) return [];
            const content = typeof message.content === "string" ? message.content : (message.content as { text?: string }[]).map((part) => part.text || "").join("");
            const label = typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : registration.ext.identifier;
            return [{ type: "extension", messageIndex, name: label, role: message.role, content, extensionId: registration.ext.identifier, extensionName: registration.ext.identifier }];
          });
          return { messages: structuredClone(normalized.messages) as LlmMessage[], parameters, breakdown };
        })();
        // An answer that comes after the wait has ended fails no one.
        call.catch(() => undefined);
        const output = await Promise.race([call, ended.promise]);
        result = output.messages;
        if (output.parameters && Object.keys(output.parameters).length > 0) merged = { ...merged, ...output.parameters };
        entries.push(...output.breakdown);
      } catch (error) {
        if (signal?.aborted) throw error;
        this.log.push(`[Spindle] Interceptor error from ${registration.ext.id}: ${error instanceof Error ? error.message : String(error)}`);
        if (registration.required) throw error;
      } finally {
        this.clock.clearTimeout(timer);
        registration.ext.pending.delete(ended.reject);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    // `appendInterceptorBreakdownEntries` (`services/generate.service.ts:565-583`): after the assembly's own, in the order of the messages they mark.
    const breakdown = entries.sort((a, b) => a.messageIndex - b.messageIndex).map(({ messageIndex: _at, ...entry }) => entry);
    return { messages: result, parameters: merged, breakdown };
  }
}

/**
 * `matchesInterceptorContext` (`spindle/interceptor-pipeline.ts:56-82`): no filter matches every generation; a filter on the generation's type needs one the context names, and one on `isDryRun` the
 * context's own `isDryRun`, which Lumiverse never sets (it names `dryRun`), so it never matches a value; a filter on a field of the extension's own preset metadata reads it by its path.
 */
function matchesInterceptor(match: InterceptorMatch | undefined, context: Record<string, unknown>, identifier: string): boolean {
  if (match === undefined) return true;
  if (match.generationTypes !== undefined && match.generationTypes.length > 0) {
    if (typeof context.generationType !== "string" || !match.generationTypes.includes(context.generationType)) return false;
  }
  if (match.isDryRun !== undefined && context.isDryRun !== match.isDryRun) return false;
  const presetField = match.presetField;
  if (presetField === undefined) return true;
  let field: unknown = ownPresetMetadata(context, identifier);
  for (const key of presetField.path) {
    if (typeof field !== "object" || field === null || Array.isArray(field)) {
      field = undefined;
      break;
    }
    field = (field as Record<string, unknown>)[key];
  }
  if (presetField.exists !== undefined && (field !== undefined) !== presetField.exists) return false;
  if (presetField.oneOf !== undefined && !presetField.oneOf.some((candidate) => Object.is(candidate, field))) return false;
  if (presetField.notIn?.some((candidate) => Object.is(candidate, field))) return false;
  return true;
}

/** `readOwnPresetMetadata` (`spindle/preset-metadata-context.ts:30-44`): the extension's own namespace of the preset's metadata on the context, uncloned; an identifier Lumiverse's preset editor owns names none. */
function ownPresetMetadata(context: Record<string, unknown>, identifier: string): unknown {
  if (identifier === "" || LOOM_OWNED_PRESET_METADATA_KEYS.has(identifier) || identifier.startsWith("_lumiverse_")) return undefined;
  const metadata = context.__spindlePresetMetadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  return Object.hasOwn(metadata, identifier) ? (metadata as Record<string, unknown>)[identifier] : undefined;
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
  const metadata = ownPresetMetadata(projected, ext.identifier);
  delete projected.__spindlePresetMetadata;
  projected.presetMetadata = metadata === undefined ? undefined : structuredClone(metadata);
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
