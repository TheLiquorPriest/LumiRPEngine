// A stand-in Lumiverse for tests: enough of the host and of Spindle's backend API to run the light
// extension (`src/ext`) against RPE's adapter (`src/adapter`) end to end, with no Lumiverse and no
// server. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; what is
// its own (assembling the prompt, activating lore, counting tokens) says so. Paths are Lumiverse's
// `src/`. Its "network" is a table of handlers by origin: an address with none answers as a stopped
// server does.

import type { ExtSpindle, InterceptorReturn, PermissionChange, PromptMessageDTO, ProxyAnswer, WorldInfoReturn } from "../../src/ext/spindle";
import { applyPostProcessing, buildBody, collapse, dropBlank, providerHeaders, readStream, readWhole, stripClosingTags, textOf, type LlmMessage, type LlmPart, type Role, type StreamedReply } from "./steps";

export interface Entry {
  id: string;
  book: string;
  content: string;
  comment?: string;
  keys?: string[];
  constant?: boolean;
  disabled?: boolean;
  extensions?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  hidden?: boolean;
  swipeId?: number;
  images?: { data: string; mime_type: string }[];
}

export interface Chat {
  id: string;
  user: string;
  character: { id: string; name: string };
  messages: ChatMessage[];
  books: Entry[];
  metadata?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  /** The connection's address; Lumiverse posts to `<base>/chat/completions`. */
  base: string;
  key: string;
  model: string;
}

export interface Block {
  id: string;
  name: string;
  role: Role;
  content: string;
  /** Spliced into the chat history this many messages from its end, not as history. */
  depth?: number;
}

export interface Preset {
  id: string;
  name: string;
  blocks: Block[];
  /** "Collapse into single user message". */
  collapse?: boolean;
  /** Ends the prompt as an assistant message the reply continues. */
  prefill?: string;
  parameters?: Record<string, unknown>;
}

export type Server = (request: Request) => Promise<Response>;

export interface GenerateInput {
  chat: string;
  connection: string;
  preset: string;
  type?: "normal" | "swipe" | "regenerate" | "continue" | "impersonate";
  dryRun?: boolean;
  persona?: string;
  parameters?: Record<string, unknown>;
}

/** What Lumiverse stores beside a reply (`services/generate.service.ts:4448-4469`). */
export interface Stored {
  entries: { name: string; type: string; tokens: number; role?: string; blockId?: string; content?: string }[];
  chatHistoryTokens: number;
  messages: { role: string; content: string }[];
  totalTokens: number;
  maxContext: number;
  model: string;
  provider: string;
  parameters: Record<string, unknown>;
  usage: Record<string, unknown> | null;
  presetName: string;
  presetId: string;
}

export interface Outcome {
  /** Null for a dry run, which announces none. */
  generationId: string | null;
  /** The generation's error, as Lumiverse ends it with one. */
  error: string | null;
  /** The prompt as Lumiverse finished it, after its interceptors, post-processing, the blank filter and collapse. */
  prompt: LlmMessage[];
  /** The request body sent to the connection; null when none was sent. */
  body: Record<string, unknown> | null;
  reply: StreamedReply | null;
  /** The generation's parameters as Lumiverse merged them, the interceptors' among them; null when it failed before. */
  parameters: Record<string, unknown> | null;
  stored: Stored | null;
  /** The World Info chain: how long it took, and the entries as it left them. */
  worldInfo: { ms: number; entries: Entry[] };
}

/** The extension side of one installed extension: Spindle's API as its worker sees it, and what the test does to it. */
export interface Installed extends ExtSpindle {
  grant(permission: string): void;
  revoke(permission: string): void;
  /** Its worker stopped: every registration of it goes, as Lumiverse drops them (`spindle/worker-host.ts:1563-1576`), and so does all it held in memory. */
  stop(): void;
  readonly logs: string[];
  /** Lumiverse's id for it. */
  readonly id: string;
  /** A `SPINDLE_BACKEND_MSG` from one of a user's sockets (`ws/handler.ts:440-467`). */
  fromFrontend(payload: unknown, user: string, session?: string): void;
  /** The modals it opened and has not closed, by user. */
  readonly modals: Map<string, { title: string; items: unknown[] }>;
}

interface Ext {
  id: string;
  granted: Set<string>;
  changed: Set<(change: PermissionChange) => void>;
  /** The worker's handlers by event (`spindle/worker-runtime.ts:1747-1765`). */
  handlers: Map<string, Set<(payload: unknown, userId?: string) => void>>;
  /** The events the host forwards to it (`spindle/worker-host.ts:2885-2951`). */
  forwarded: Set<string>;
  frontend: Set<(payload: unknown, userId: string, session?: string) => void>;
  logs: string[];
}

interface Registration<H> {
  ext: Ext;
  priority: number;
  handler: H;
  required: boolean;
}

type WorldInfoHandler = (ctx: unknown) => Promise<WorldInfoReturn>;
type PromptHandler = (messages: PromptMessageDTO[], context: unknown) => Promise<InterceptorReturn>;

/** Events that need `generation` (`spindle/worker-host.ts:2877-2883`). */
const GENERATION_EVENTS: Record<string, true> = { GENERATION_STARTED: true, GENERATION_IN_PROGRESS: true, GENERATION_ENDED: true, GENERATION_STOPPED: true, STREAM_TOKEN_RECEIVED: true };

/** A timer that does not keep the test process alive. */
function later(ms: number, fn: () => void): Timer {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return timer;
}

export class StandIn {
  readonly servers = new Map<string, Server>();
  readonly chats = new Map<string, Chat>();
  readonly connections = new Map<string, Connection>();
  readonly presets = new Map<string, Preset>();
  /** What Lumiverse stored beside each reply, by message id, with its chat (`services/breakdown.service.ts:3-12`). */
  readonly stored = new Map<string, { chatId: string; data: Stored }>();
  readonly events: { event: string; payload: unknown }[] = [];
  readonly log: string[] = [];
  /** Each user's extension storage, by user and path (the stand-in's disk). */
  readonly storage = new Map<string, string>();
  /** Where `sendToFrontend` delivers: a test's sockets say whether the session was there; with none, nothing is delivered. */
  frontends: ((message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }) => boolean) | null = null;

  frontendSent(message: { extension: string; payload: unknown; user: string | undefined; session: string | undefined }): boolean {
    return this.frontends?.(message) ?? false;
  }
  private readonly installed: Ext[] = [];
  /** How a later task is run: on the process's own timers unless a test runs a clock of its own. */
  later: (run: () => void) => void = (run) => void setTimeout(run, 0);
  /** The user's `promptPostProcessing` setting (`services/generate.service.ts:1250-1256`). */
  postProcessing = "";
  /** `DEFAULT_INTERCEPTOR_TIMEOUT_MS` (`services/spindle-settings.service.ts:6`). */
  interceptorTimeoutMs = 10_000;
  /** A World Info interceptor's limit (`spindle/worker-host.ts:4937-4943`). */
  worldInfoTimeoutMs = 10_000;
  /** Spindle's proxy limit (`spindle/worker-host.ts:771`). */
  proxyTimeoutMs = 30_000;
  private worldInfo: Registration<WorldInfoHandler>[] = [];
  private interceptors: Registration<PromptHandler>[] = [];

  // ---------------------------------------------------------------- extensions

  /** Installs an extension with these permissions granted, and gives its worker's view of Spindle. */
  install(granted: readonly string[]): Installed {
    const ext: Ext = { id: `ext-${this.installed.length + 1}`, granted: new Set(granted), changed: new Set(), handlers: new Map(), forwarded: new Set(), frontend: new Set(), logs: [] };
    const modals = new Map<string, { title: string; items: unknown[] }>();
    const host = this;
    const change = (permission: string, granted: boolean): void => {
      if (granted) ext.granted.add(permission);
      else ext.granted.delete(permission);
      // `permission_changed` (`spindle/worker-runtime.ts:5065-5090`).
      for (const handler of ext.changed) handler({ permission, granted, allGranted: [...ext.granted] });
    };
    // Both are kept sorted by priority, lowest first; equal ones in the order registered (`spindle/interceptor-pipeline.ts:87-90`, `spindle/world-info-interceptor.ts:192-194`).
    const place = <H>(list: Registration<H>[], registration: Registration<H>): Registration<H>[] =>
      [...list.filter((r) => r.ext !== ext), registration].sort((a, b) => a.priority - b.priority);
    const api: Installed = {
      logs: ext.logs,
      id: ext.id,
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
        // A message for a session that is gone tells the worker so (`spindle/worker-host.ts:2143-2149`).
        if (!delivered && session !== undefined && user !== undefined) host.emit("FRONTEND_SESSION_CLOSED", { frontendSessionId: session }, user);
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

  /** `eventBus.emit` (`ws/bus.ts:502-544`): listeners run on a later task, never inline; the worker gets the payload and its user (`spindle/worker-host.ts:2917-2932`, `spindle/worker-runtime.ts:4773-4786`). */
  emit(event: string, payload: unknown, userId: string): void {
    this.events.push({ event, payload });
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
    const timer = later(this.proxyTimeoutMs, () => timeout.reject(new Error("The operation timed out.")));
    try {
      const res = await Promise.race([this.fetch(url, { method: init.method, headers: init.headers, body: init.body }), timeout.promise]);
      return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- a generation

  /** The World Info chain (`spindle/world-info-interceptor.ts:206-407`), each handler behind its worker call (`spindle/worker-host.ts:4927-4955`). */
  private async worldInfoChain(entries: readonly Entry[], ctx: Record<string, unknown>, userId: string): Promise<Entry[]> {
    const disabledByChain = new Set<string>();
    const enabledByChain = new Set<string>();
    const contentOverrides = new Map<string, string>();
    const candidateIds = new Set(entries.map((e) => e.id));
    let working: Entry[] = [...entries];
    const rebuildWorking = (): Entry[] =>
      entries.map((e) => {
        const isDisabled = disabledByChain.has(e.id);
        const wantsEnable = !isDisabled && enabledByChain.has(e.id) && e.disabled === true;
        const newContent = contentOverrides.get(e.id);
        if (!isDisabled && !wantsEnable && newContent === undefined) return e;
        return { ...e, ...(isDisabled ? { disabled: true } : {}), ...(wantsEnable ? { disabled: false } : {}), ...(newContent !== undefined ? { content: newContent } : {}) };
      });
    for (const registration of this.worldInfo) {
      const dto = { ...ctx, userId, entries: working.map((e) => ({ id: e.id, world_book_id: e.book, comment: e.comment ?? "", disabled: e.disabled === true, constant: e.constant === true, extensions: e.extensions ?? {}, key: e.keys ?? [], keysecondary: [], content: e.content })) };
      // The worker's call: a throw reaches the host as no result (`spindle/worker-runtime.ts:4970-4993`), and past the limit the host goes on without one (`spindle/worker-host.ts:4937-4943`).
      const call = registration.handler(structuredClone(dto)).catch((error: unknown) => {
        registration.ext.logs.push(`World-info interceptor error: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      const limit = Promise.withResolvers<undefined>();
      const timer = later(this.worldInfoTimeoutMs, () => {
        this.log.push("World-info interceptor timed out after 10s; skipping");
        limit.resolve(undefined);
      });
      const result = await Promise.race([call, limit.promise]);
      clearTimeout(timer);
      if (!result) continue;
      const copy = structuredClone(result);
      for (const id of copy.disabled ?? []) disabledByChain.add(id);
      for (const id of copy.enabled ?? []) enabledByChain.add(id);
      for (const m of copy.mutated ?? []) if (candidateIds.has(m.id) && m.content !== undefined) contentOverrides.set(m.id, m.content);
      working = rebuildWorking();
    }
    return working;
  }

  /**
   * The interceptor pipeline (`spindle/interceptor-pipeline.ts:103-227`), each handler behind its
   * worker call: the messages it is given carry the history and lore flags (`spindle/worker-host.ts:
   * 3184-3198`); a throw comes back as an error (`spindle/worker-runtime.ts:4813-4826`,
   * `spindle/worker-host.ts:1918-1921`); parameters are dropped without `generation_parameters`
   * (`spindle/worker-host.ts:1922-1931`).
   */
  private async interceptorPipeline(messages: LlmMessage[], context: Record<string, unknown>): Promise<{ messages: LlmMessage[]; parameters: Record<string, unknown> | undefined }> {
    let result = messages;
    // `collectSourceMessageMetadata` (`spindle/source-message-metadata.ts:59-75`).
    const sources = new Map<string, number>();
    for (const m of messages) if (m.__chatHistorySource === true && typeof m.__sourceMessageId === "string" && typeof m.__sourceIndexInChat === "number") sources.set(m.__sourceMessageId, m.__sourceIndexInChat);
    let merged: Record<string, unknown> | undefined;
    for (const registration of this.interceptors) {
      // `restoreSourceMessageMetadata` (`spindle/source-message-metadata.ts:77-106`), before each.
      for (const m of result) {
        const isHistory = m.__chatHistorySource === true || m.__isChatHistory === true;
        const id = typeof m.sourceMessageId === "string" ? m.sourceMessageId : typeof m.__sourceMessageId === "string" ? m.__sourceMessageId : undefined;
        for (const key of ["__chatHistorySource", "__sourceMessageId", "__sourceIndexInChat", "__isChatHistory", "sourceMessageId", "sourceIndexInChat"]) delete m[key];
        const index = isHistory && id !== undefined ? sources.get(id) : undefined;
        if (index === undefined) continue;
        m.__chatHistorySource = true;
        m.__sourceMessageId = id;
        m.__sourceIndexInChat = index;
      }
      const dto = result.map((m) => {
        const isHistory = m.__chatHistorySource === true;
        const isLore = m.__worldInfoSource === true;
        if (!isHistory && !isLore) return m;
        return { ...m, ...(isHistory ? { __isChatHistory: true } : {}), ...(isLore ? { __isWorldInfoEntry: true } : {}), ...(typeof m.__sourceMessageId === "string" ? { sourceMessageId: m.__sourceMessageId } : {}), ...(typeof m.__sourceIndexInChat === "number" ? { sourceIndexInChat: m.__sourceIndexInChat } : {}) };
      });
      const controller = new AbortController();
      const timeout = Promise.withResolvers<never>();
      const timer = later(this.interceptorTimeoutMs, () => {
        const error = new Error(`Interceptor from extension timed out (${Math.round(this.interceptorTimeoutMs / 1000)}s)`);
        controller.abort(error);
        timeout.reject(error);
      });
      try {
        const call = (async () => {
          let returned: InterceptorReturn;
          try {
            returned = await registration.handler(structuredClone(dto) as PromptMessageDTO[], { ...structuredClone(context), signal: controller.signal });
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

  /**
   * One generation, or a dry run: as `startGeneration` (`services/generate.service.ts:1546-3073`) and
   * `dryRunGeneration` (`:3080-3274`) order it. The prompt itself is assembled the stand-in's own way:
   * the preset's blocks, then each activated lore entry as a message of its own, then the chat's
   * visible messages as history, with any depth block spliced in and the prefill last.
   */
  async generate(input: GenerateInput): Promise<Outcome> {
    const chat = this.chats.get(input.chat);
    const connection = this.connections.get(input.connection);
    const preset = this.presets.get(input.preset);
    if (!chat || !connection || !preset) throw new Error("the stand-in has no such chat, connection or preset");
    const type = input.type ?? "normal";
    const dryRun = input.dryRun === true;
    const generationId = dryRun ? null : crypto.randomUUID();
    let target: { message: string | null; swipe: number | null } = { message: null, swipe: null };
    let excluded: string | null = null;
    let staged: string | null = null;
    if (!dryRun) {
      if (type === "normal") {
        // A new reply's message is made empty before the prompt, and left out of it (`:1988-2006`).
        staged = crypto.randomUUID();
        chat.messages.push({ id: staged, role: "assistant", content: "" });
        target = { message: staged, swipe: 0 };
        excluded = staged;
      } else if (type === "swipe" || type === "regenerate") {
        // The reply being replaced gets a new empty swipe and is left out of the prompt (`:1699-1720`, `prompt-assembly.service.ts:1900-1904`).
        const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
        if (last) {
          last.swipeId = (last.swipeId ?? 0) + 1;
          target = { message: last.id, swipe: last.swipeId };
          excluded = last.id;
        }
      } else if (type === "continue") {
        const last = chat.messages[chat.messages.length - 1];
        if (last) target = { message: last.id, swipe: last.swipeId ?? 0 };
      }
      // Announced before the prompt is assembled (`:2036-2055`), and the assembly starts on a later task (`:2068-2073`, `:1059`).
      this.emit("GENERATION_STARTED", { generationId, chatId: chat.id, model: connection.model, targetMessageId: target.message, targetSwipeId: target.swipe, backgroundSwipe: false, characterId: chat.character.id, characterName: chat.character.name, generationType: type, frontendSessionId: undefined }, chat.user);
    }
    // Two later tasks, as the continuation and the pipeline each wait for one.
    for (let i = 0; i < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const messages = chat.messages.filter((m) => m.id !== excluded);
    const indexOf = (id: string): number => chat.messages.findIndex((m) => m.id === id);

    // ---- lore, before activation (`prompt-assembly.service.ts:2282-2316`)
    const wiStarted = performance.now();
    const ctx = {
      purpose: "prompt",
      chatId: chat.id,
      characterId: chat.character.id,
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, is_user: m.role === "user", is_greeting: false, swipe_id: m.swipeId ?? 0, index_in_chat: indexOf(m.id) })),
      chatTurn: messages.length,
      chatMetadata: chat.metadata ?? {},
      activationSettings: { globalScanDepth: null, maxRecursionPasses: 0 },
    };
    const entries = this.worldInfo.length === 0 ? [...chat.books] : await this.worldInfoChain(chat.books, ctx, chat.user);
    const wiMs = performance.now() - wiStarted;
    // The stand-in's own activation: switched on and constant, or a key in a visible message.
    const scanned = messages.filter((m) => !m.hidden).map((m) => m.content.toLowerCase()).join("\n");
    const active = entries.filter((e) => !e.disabled && (e.constant === true || (e.keys ?? []).some((k) => scanned.includes(k.toLowerCase()))));

    // ---- the prompt (the stand-in's own assembly)
    const breakdown: { type: string; name: string; role?: string; content?: string; blockId?: string; messageCount?: number; firstMessageIndex?: number }[] = [];
    const prompt: LlmMessage[] = [];
    for (const block of preset.blocks.filter((b) => b.depth === undefined)) {
      prompt.push({ role: block.role, content: block.content });
      breakdown.push({ type: "block", name: block.name, role: block.role, content: block.content, blockId: block.id });
    }
    for (const e of active) {
      // The host strips a mark when it inserts the entry.
      const text = stripClosingTags(e.content);
      if (text.trim() === "") continue;
      prompt.push({ role: "system", content: text, __worldInfoSource: true });
      breakdown.push({ type: "world_info", name: e.comment || "World Info", role: "system", content: text });
    }
    const history: LlmMessage[] = messages
      .filter((m) => !m.hidden)
      .map((m) => {
        const content: string | LlmPart[] = m.images ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, ...i }))] : m.content;
        return { role: m.role, content, __chatHistorySource: true, __sourceMessageId: m.id, __sourceIndexInChat: indexOf(m.id) };
      });
    breakdown.push({ type: "chat_history", name: "Chat History", messageCount: history.length, firstMessageIndex: prompt.length });
    for (const block of preset.blocks.filter((b) => b.depth !== undefined)) {
      history.splice(Math.max(0, history.length - block.depth!), 0, { role: block.role, content: block.content });
      breakdown.push({ type: "block", name: block.name, role: block.role, content: block.content, blockId: block.id });
    }
    prompt.push(...history);
    if (preset.prefill !== undefined) prompt.push({ role: "assistant", content: preset.prefill, partial: true });

    // ---- the interceptors (`generate.service.ts:1063-1072`, `:1217-1247`; `spindle/world-info-capture.ts:17-52`)
    const context = {
      frontendSessionId: undefined,
      chatId: chat.id,
      connectionId: connection.id,
      personaId: input.persona,
      generationType: type,
      dryRun,
      userId: chat.user,
      activatedWorldInfo: active.map((e) => ({ id: e.id, comment: e.comment ?? "", keys: e.keys ?? [], source: "keyword", bookId: e.book })),
      presetId: preset.id,
      presetMetadata: undefined,
    };
    let sent: LlmMessage[] = prompt;
    let body: Record<string, unknown> | null = null;
    const worldInfo = { ms: wiMs, entries };
    try {
      const intercepted = this.interceptors.length > 0 ? await this.interceptorPipeline(prompt, context) : { messages: prompt, parameters: undefined };
      // After the interceptors: post-processing, the blank filter, collapse, then the parameters (`:1249-1256`, `:1414-1441`).
      sent = intercepted.messages;
      if (this.postProcessing) applyPostProcessing(sent, this.postProcessing);
      sent = dropBlank(sent);
      if (preset.collapse === true) collapse(sent);
      const parameters: Record<string, unknown> = { ...preset.parameters, ...intercepted.parameters, ...input.parameters };
      if (dryRun) return { generationId: null, error: null, prompt: sent, body: null, reply: null, parameters, stored: null, worldInfo };
      this.emit("WORLD_INFO_ACTIVATED", { chatId: chat.id, entries: context.activatedWorldInfo }, chat.user);
      // The streaming switch decides the call and is never sent (`generate.service.ts:3725-3726`): a stream,
      // or one whole answer in one call (`:3793-3815`).
      const streaming = parameters._streaming !== false;
      delete parameters._streaming;
      body = buildBody(connection.model, sent, parameters, streaming);
      const base = connection.base.replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/models$/, "");
      const res = await this.fetch(`${base}/chat/completions`, { method: "POST", headers: providerHeaders(connection.key), body: JSON.stringify(body) });
      const reply = streaming ? await readStream(res) : await readWhole(res);
      const messageId = target.message ?? crypto.randomUUID();
      const saved = chat.messages.find((m) => m.id === messageId);
      if (saved) saved.content = reply.content;
      this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, messageId, content: reply.content, usage: reply.usage, generationType: type }, chat.user);
      // Stored after the generation ends, beside the reply (`:4432-4476`); token counts are the stand-in's own.
      const tokens = (text: string): number => Math.ceil(text.length / 4);
      const historyTokens = history.reduce((n, m) => n + tokens(textOf(m)), 0);
      const entriesStored = breakdown.map((e) => ({ name: e.name, type: e.type, tokens: e.type === "chat_history" ? historyTokens : tokens(e.content ?? ""), ...(e.role ? { role: e.role } : {}), ...(e.blockId ? { blockId: e.blockId } : {}), content: e.content }));
      const stored: Stored = {
        entries: entriesStored.filter((e) => e.type !== "chat_history"),
        chatHistoryTokens: historyTokens,
        messages: sent.map((m) => ({ role: m.role, content: textOf(m) })),
        totalTokens: entriesStored.reduce((n, e) => n + e.tokens, 0),
        maxContext: 0,
        model: connection.model,
        provider: "custom",
        parameters,
        usage: reply.usage,
        presetName: preset.name,
        presetId: preset.id,
      };
      this.stored.set(messageId, { chatId: chat.id, data: stored });
      return { generationId, error: null, prompt: sent, body, reply, parameters, stored, worldInfo };
    } catch (error) {
      // A failed setup or call ends the generation with its error, its empty message removed (`:2987-3048`).
      const message = error instanceof Error ? error.message : String(error);
      if (staged !== null) chat.messages.splice(chat.messages.findIndex((m) => m.id === staged), 1);
      if (!dryRun) this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, error: message, generationType: type }, chat.user);
      return { generationId, error: message, prompt: sent, body, reply: null, parameters: null, stored: null, worldInfo };
    }
  }
}
