// The fake host (DESIGN §14; ARCHITECTURE §7): an in-memory HostPort that replays the event
// orders and payloads recorded from a Lumiverse host (DESIGN §14). Generations are driven step
// by step (start, then finish or stop), so tests can interleave operations while a reply streams.
//
// Event delivery: every host step queues its events; `settle()` delivers them in order and waits
// for the handlers' work. Handlers always read the host's current state, as on the real host.

import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { ChatId, MessageId, UserId } from "../../src/shared/ids";
import type { BackendToFrontend } from "../../src/shared/protocol";
import type { Answers } from "../../src/engine/decide";
import type {
  ContextHandlerInput,
  DecideRequest,
  DryRun,
  HostBookEntry,
  HostBookEntryInput,
  HostEventMap,
  HostEventName,
  HostGenerationType,
  HostMessage,
  HostPort,
  HostPresetBlock,
  HostRegexScript,
  InterceptorInput,
  InterceptorResult,
  ProcessEvent,
  QuietRequest,
  QuietToolCall,
} from "../../src/backend/host";
import { ENGINE_EXTENSION, STUDIO_EXTENSION } from "../../src/shared/studio-bridge";
import { FakeRpcPool } from "./fake-rpc";

export interface FakeMessage {
  id: MessageId;
  isUser: boolean;
  name: string;
  swipes: string[];
  swipeId: number;
  bag: JsonObject;
}

export interface FakeChat {
  id: ChatId;
  metadata: JsonObject;
  messages: FakeMessage[];
}

type Handler = (payload: never, userId: UserId | null) => void;

export interface Generation {
  id: string;
  chatId: ChatId;
  type: HostGenerationType;
  /** The message the reply lands on (undefined for a normal reply created at the end, and for Impersonate). */
  messageId?: MessageId;
  /** The swipe the generation writes (`updated` reports it even after the user navigates). */
  swipeId: number;
  /** Continue: the original content and the postfix. */
  original?: string;
  postfix: string;
  open: boolean;
}

export interface StartOptions {
  type: HostGenerationType;
  /** Target message for regenerate, swipe and Continue (default: the head). */
  messageId?: MessageId;
  /** Normal replies: the host creates the reply at the end instead of staging it (P4's other save path). */
  createAtEnd?: boolean;
  /** The host gives up on the context handler: it runs with its signal already aborted, so nothing is planned. */
  abandonContext?: boolean;
}

export interface FinishOptions {
  /** P4: the host's macro re-render of the turn's own user messages, after the save and before ENDED. */
  rerender?: Record<MessageId, string>;
  /** Continue: the host's re-render changes the prefix (literal braces); a second MESSAGE_EDITED follows. */
  rerenderPrefix?: (content: string) => string;
  /** The host reports the generation ended in error. */
  error?: string;
}

export class FakeHost implements HostPort {
  readonly userId: UserId = "user-1";
  readonly chatsById = new Map<ChatId, FakeChat>();
  readonly files = new Map<string, string>();
  readonly sent: BackendToFrontend[] = [];
  private readonly handlers = new Map<HostEventName, Set<Handler>>();
  private readonly frontendHandlers = new Set<(message: unknown, userId: UserId, sessionId?: string) => void>();
  private contextHandler: ((input: ContextHandlerInput, signal: AbortSignal) => Promise<void>) | null = null;
  /** The context handler's registered timeout (the host would give up on it after this). */
  contextTimeoutMs = 0;
  private interceptor: ((input: InterceptorInput) => Promise<InterceptorResult | null>) | null = null;
  private readonly queue: { event: HostEventName; payload: HostEventMap[HostEventName] }[] = [];
  private readonly inFlight = new Map<string, Generation>();
  private nextId = 0;
  /** Resolves once the backend has finished the work the delivered events started (its queues). */
  idle: () => Promise<void> = async () => undefined;

  constructor(private readonly options: { wiBook: boolean } = { wiBook: true }) {}

  /** The shared RPC pool both extensions use, with each one's manifest permissions granted. */
  readonly rpcPool = new FakeRpcPool({
    [ENGINE_EXTENSION]: ["generation", "context_handler", "chats", "chat_mutation", "world_books", "presets", "decisions", "ui_panels"],
    [STUDIO_EXTENSION]: ["generation", "chats", "chat_mutation", "characters", "world_books", "personas"],
  });

  // ------------------------------------------------------------------ HostPort

  rpc: HostPort["rpc"] = this.rpcPool.port(ENGINE_EXTENSION);

  chats: HostPort["chats"] = {
    messages: async (chatId) => this.chat(chatId).messages.map((m, index) => this.toHost(chatId, m, index)),
    writeMetadata: async (chatId, messageId, bag) => {
      const m = this.message(chatId, messageId);
      m.bag = structuredClone(bag);
      // updateMessage emits MESSAGE_EDITED for metadata-only writes too.
      this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, messageId) });
    },
    // The real host resolves a chat for its owner only; another user sees no metadata.
    chatMetadata: async (chatId, userId) => (userId === this.userId ? structuredClone(this.chat(chatId).metadata) : {}),
    mergeChatMetadata: async (chatId, patch) => {
      const c = this.chat(chatId);
      c.metadata = { ...c.metadata, ...structuredClone(patch) };
    },
    appendUserMessage: async (chatId, content, metadata) => this.sendUser(chatId, content, metadata),
    active: async () => this.activeChat,
  };

  /** The chat the user has open (`chats.getActive`). */
  activeChat: ChatId | null = null;
  /** The active preset as a dry run sees it (the D32 lint). */
  preset: { name: string; blocks: { id: string; name: string; content: string }[]; maxTokens: number | null; model: string } = { name: "Default", blocks: [], maxTokens: null, model: "fake" };

  /** The active preset's blocks (`presets.blocks`) and its revision, which each change made through the port bumps. */
  presetBlocks: HostPresetBlock[] = [];
  presetRevision = 1;
  /** How many times the preset's blocks were read (each revision is read once). */
  blockReads = 0;

  presets: HostPort["presets"] = {
    active: async () => ({ id: "preset-1", name: this.preset.name, revision: this.presetRevision }),
    blocks: async () => {
      this.blockReads++;
      return structuredClone(this.presetBlocks);
    },
    addBlock: async (_presetId, block, index) => {
      const id = this.newId("block");
      const created: HostPresetBlock = block.kind === "category" ? { id, name: block.name, content: "", enabled: true, marker: "category", injectionTrigger: [] } : { id, name: block.name, content: block.content, enabled: false, marker: null, injectionTrigger: [] };
      this.presetBlocks.splice(index ?? this.presetBlocks.length, 0, created);
      this.presetRevision++;
    },
  };

  /** The user's default connection (`connections.list`, `is_default`). */
  activeConnection: { id: string; name: string } | null = null;

  connections: HostPort["connections"] = {
    active: async () => this.activeConnection,
  };

  /** The user's regex scripts: the engine's own, and any a test plants (`mine: false` for one the engine may not change). */
  readonly regexScripts = new Map<string, HostRegexScript & { scriptId: string; disabled: boolean }>();

  regex: HostPort["regex"] = {
    chatScripts: async (chatId) => [...this.regexScripts.values()].filter((s) => chatId === null || s.chatId === chatId).map(({ scriptId: _id, disabled: _off, ...s }) => structuredClone(s)),
    write: async (id, script) => {
      // The host normalizes a script id and keeps it unique per user.
      const scriptId = script.scriptId.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
      if ([...this.regexScripts.values()].some((s) => s.scriptId === scriptId && s.id !== id)) throw new Error("script_id already exists");
      const prior = id === null ? undefined : this.regexScripts.get(id);
      if (id !== null && !prior?.mine) throw new Error("Regex script not found or not this extension's");
      const next = { id: id ?? this.newId("regex"), chatId: script.chatId, mine: true, scriptId, findRegex: script.findRegex, replaceString: script.replaceString, flags: script.flags, placement: [...script.placement], targets: [...script.targets], runOnEdit: script.runOnEdit, metadata: structuredClone(script.metadata), disabled: prior?.disabled ?? false };
      this.regexScripts.set(next.id, next);
      return next.id;
    },
    remove: async (id) => {
      if (!this.regexScripts.get(id)?.mine) throw new Error("Regex script not found or not this extension's");
      this.regexScripts.delete(id);
    },
  };

  /** A reply as the host saves it: the chat's enabled `response` scripts applied in turn (no macros: plain replacement); an edit runs only the run-on-edit ones. */
  baked(chatId: ChatId, text: string, edit = false): string {
    let out = text;
    for (const s of this.regexScripts.values()) if (!s.disabled && s.chatId === chatId && s.targets.includes("response") && s.placement.includes("ai_output") && (!edit || s.runOnEdit)) out = out.replace(new RegExp(s.findRegex, s.flags), s.replaceString);
    return out;
  }

  storage: HostPort["storage"] = {
    read: async (path, userId) => this.files.get(`${userId}/${path}`) ?? null,
    write: async (path, data, userId) => {
      this.files.set(`${userId}/${path}`, data);
    },
    move: async (from, to, userId) => {
      const data = this.files.get(`${userId}/${from}`);
      if (data === undefined) throw new Error(`no file ${from}`);
      this.files.set(`${userId}/${to}`, data);
      this.files.delete(`${userId}/${from}`);
    },
    remove: async (path, userId) => {
      this.files.delete(`${userId}/${path}`);
    },
    list: async (prefix, userId) => [...this.files.keys()].filter((k) => k.startsWith(`${userId}/${prefix}`)).map((k) => k.slice(userId.length + 1)),
  };

  on<K extends HostEventName>(event: K, handler: (payload: HostEventMap[K], userId: UserId | null) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const h = handler as Handler;
    set.add(h);
    return () => set.delete(h);
  }

  registerContextHandler(handler: (input: ContextHandlerInput, signal: AbortSignal) => Promise<void>, timeoutMs: number): void {
    this.contextHandler = handler;
    this.contextTimeoutMs = timeoutMs;
  }

  registerInterceptor(handler: (input: InterceptorInput) => Promise<InterceptorResult | null>): void {
    this.interceptor = handler;
  }

  /**
   * Scripted model replies for tests (a quiet call's text, or its text and tool calls); throwing
   * plays a failed call. The default refuses: the ledger suite makes no model calls. Live model
   * behaviour is checked on the real host only.
   */
  quietReply: ((request: QuietRequest) => string | { content: string; toolCalls?: QuietToolCall[] }) | null = null;
  /** Every quiet call made, for assertions. */
  readonly quietCalls: QuietRequest[] = [];
  /** Scripted Decision API answers; null (the default) means no Decision connection, so steps fall back to the helper. */
  decideReply: ((request: DecideRequest) => Answers) | null = null;
  readonly decideCalls: DecideRequest[] = [];

  models: HostPort["models"] = {
    quiet: async (request) => {
      this.quietCalls.push(request);
      if (!this.quietReply) throw new Error("the fake host makes no model calls");
      const reply = this.quietReply(request);
      return typeof reply === "string" ? { content: reply, finishReason: "stop", tokens: 0 } : { content: reply.content, finishReason: reply.toolCalls ? "tool_calls" : "stop", tokens: 0, ...(reply.toolCalls ? { toolCalls: reply.toolCalls } : {}) };
    },
    decide: async (request) => {
      this.decideCalls.push(request);
      if (!this.decideReply) throw new Error("the fake host has no Decision connection");
      return { answers: this.decideReply(request), model: request.model ?? "fake", tokens: 0 };
    },
  };
  /** The host tokenizer stand-in (words, numbers and symbols each one token); null plays a host that can't count. */
  tokenCount: ((text: string) => number) | null = (text) => text.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g)?.length ?? 0;
  /** Every token count asked for, for assertions. */
  readonly tokenCalls: string[][] = [];
  tokens: HostPort["tokens"] = {
    count: async (texts) => {
      this.tokenCalls.push([...texts]);
      const count = this.tokenCount;
      return count ? texts.map((t) => count(t)) : null;
    },
  };

  frontend: HostPort["frontend"] = {
    send: (message) => {
      this.sent.push(message);
    },
    onMessage: (handler) => {
      this.frontendHandlers.add(handler);
      return () => this.frontendHandlers.delete(handler);
    },
    closeDrawer: async () => {
      this.drawerClosed++;
    },
  };

  /** How many times the backend closed the drawer. */
  drawerClosed = 0;

  readonly logs: string[] = [];
  /** Log lines tied to a user, by user (the per-user diagnostics mirror). */
  readonly userLogs = new Map<UserId, string[]>();

  log(level: "info" | "warn" | "error", message: string, userId?: UserId): void {
    this.logs.push(`${level}: ${message}`);
    if (userId) this.userLogs.set(userId, [...(this.userLogs.get(userId) ?? []), `${level}: ${message}`]);
  }

  // ------------------------------------------------------------------ delivery

  private emit<K extends HostEventName>(event: K, payload: HostEventMap[K]): void {
    this.queue.push({ event, payload: structuredClone(payload) });
  }

  /** Delivers queued events in order; after each, waits until the backend is idle. */
  async settle(): Promise<void> {
    for (let guard = 0; guard < 100_000; guard++) {
      const next = this.queue.shift();
      if (!next) {
        await this.idle();
        if (this.queue.length === 0) return;
        continue;
      }
      for (const h of this.handlers.get(next.event) ?? []) h(next.payload as never, this.userId);
      await this.idle();
    }
    throw new Error("settle: event storm");
  }

  // ------------------------------------------------------------------ chat model

  createChat(greeting?: string): ChatId {
    const id = `chat-${++this.nextId}`;
    const chat: FakeChat = { id, metadata: {}, messages: [] };
    this.chatsById.set(id, chat);
    if (greeting !== undefined) chat.messages.push({ id: this.newId("m"), isUser: false, name: "Narrator", swipes: [greeting], swipeId: 0, bag: {} });
    return id;
  }

  chat(chatId: ChatId): FakeChat {
    const c = this.chatsById.get(chatId);
    if (!c) throw new Error(`no chat ${chatId}`);
    return c;
  }

  message(chatId: ChatId, messageId: MessageId): FakeMessage {
    const m = this.chat(chatId).messages.find((x) => x.id === messageId);
    if (!m) throw new Error(`no message ${messageId}`);
    return m;
  }

  head(chatId: ChatId): FakeMessage | undefined {
    return [...this.chat(chatId).messages].reverse().find((m) => !m.isUser);
  }

  private newId(prefix: string): string {
    return `${prefix}${++this.nextId}`;
  }

  private toHost(chatId: ChatId, m: FakeMessage, index: number): HostMessage {
    return { id: m.id, chatId, index, isUser: m.isUser, name: m.name, content: m.swipes[m.swipeId] ?? "", swipeId: m.swipeId, swipes: [...m.swipes], metadata: structuredClone(m.bag) };
  }

  private hostMessage(chatId: ChatId, messageId: MessageId): HostMessage {
    const c = this.chat(chatId);
    const index = c.messages.findIndex((m) => m.id === messageId);
    const m = c.messages[index];
    if (!m) throw new Error(`no message ${messageId}`);
    return this.toHost(chatId, m, index);
  }

  // ------------------------------------------------------------------ user operations

  sendUser(chatId: ChatId, text: string, metadata: JsonObject = {}): MessageId {
    const m: FakeMessage = { id: this.newId("u"), isUser: true, name: "User", swipes: [text], swipeId: 0, bag: structuredClone(metadata) };
    this.chat(chatId).messages.push(m);
    this.emit("MESSAGE_SENT", { chatId, message: this.hostMessage(chatId, m.id) });
    return m.id;
  }

  /** Edits the displayed swipe in place (PUT /messages/:id): MESSAGE_EDITED. */
  editMessage(chatId: ChatId, messageId: MessageId, text: string): void {
    const m = this.message(chatId, messageId);
    m.swipes[m.swipeId] = m.isUser ? text : this.baked(chatId, text, true);
    this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, messageId) });
  }

  /** Adds a swipe with content; it becomes displayed: MESSAGE_SWIPED added. */
  addSwipe(chatId: ChatId, messageId: MessageId, text: string): void {
    const m = this.message(chatId, messageId);
    m.swipes.push(text);
    m.swipeId = m.swipes.length - 1;
    this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, messageId), action: "added", swipeId: m.swipeId });
  }

  navigate(chatId: ChatId, messageId: MessageId, swipeId: number): void {
    const m = this.message(chatId, messageId);
    if (swipeId < 0 || swipeId >= m.swipes.length || swipeId === m.swipeId) return;
    const previousSwipeId = m.swipeId;
    m.swipeId = swipeId;
    this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, messageId), action: "navigated", swipeId, previousSwipeId });
  }

  /** Rewrites one swipe (PUT /swipe/:i): MESSAGE_SWIPED updated; `message.content` stays the displayed swipe. */
  putSwipe(chatId: ChatId, messageId: MessageId, swipeId: number, text: string): void {
    const m = this.message(chatId, messageId);
    if (swipeId < 0 || swipeId >= m.swipes.length) return;
    m.swipes[swipeId] = text;
    this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, messageId), action: "updated", swipeId });
  }

  /** Deletes a swipe: the host shifts `swipes` but not `spindle_metadata`. */
  deleteSwipe(chatId: ChatId, messageId: MessageId, swipeId: number): void {
    const m = this.message(chatId, messageId);
    if (m.swipes.length < 2 || swipeId < 0 || swipeId >= m.swipes.length) return;
    m.swipes.splice(swipeId, 1);
    if (m.swipeId >= m.swipes.length || m.swipeId > swipeId) m.swipeId = Math.max(0, m.swipeId - 1);
    this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, messageId), action: "deleted", swipeId });
  }

  deleteMessage(chatId: ChatId, messageId: MessageId): void {
    const c = this.chat(chatId);
    c.messages = c.messages.filter((m) => m.id !== messageId);
    this.emit("MESSAGE_DELETED", { chatId, messageId });
  }

  /** Branch: a new chat with copies of the messages up to `messageId`, metadata included. Silent. */
  branch(chatId: ChatId, messageId: MessageId): ChatId {
    const c = this.chat(chatId);
    const index = c.messages.findIndex((m) => m.id === messageId);
    const id = `chat-${++this.nextId}`;
    this.chatsById.set(id, { id, metadata: structuredClone(c.metadata), messages: c.messages.slice(0, index + 1).map((m) => ({ ...structuredClone(m), id: this.newId(m.isUser ? "u" : "m") })) });
    return id;
  }

  /** Export then import: like a branch of the whole chat. */
  importCopy(chatId: ChatId): ChatId {
    const last = this.chat(chatId).messages.at(-1);
    return last ? this.branch(chatId, last.id) : this.createChat();
  }

  /** Another writer replaces the whole bag without our namespace (G2). */
  clobberForeign(chatId: ChatId, messageId: MessageId): void {
    const m = this.message(chatId, messageId);
    m.bag = { other_extension: { note: `clobbered ${++this.nextId}` } };
    this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, messageId) });
  }

  /** A frontend echo writes back a stale copy of the bag. */
  clobberEcho(chatId: ChatId, messageId: MessageId, stale: JsonObject): void {
    const m = this.message(chatId, messageId);
    m.bag = structuredClone(stale);
    this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, messageId) });
  }

  /** Host restart: in-flight generations vanish and their staged empty replies are removed; the extension's handlers go with it. */
  restart(): void {
    for (const g of this.inFlight.values()) {
      if (g.messageId && g.type === "normal") {
        const c = this.chat(g.chatId);
        const m = c.messages.find((x) => x.id === g.messageId);
        if (m && (m.swipes[g.swipeId] ?? "") === "") c.messages = c.messages.filter((x) => x.id !== g.messageId);
      }
      g.open = false;
    }
    this.inFlight.clear();
    this.queue.length = 0;
    this.handlers.clear();
    this.contextHandler = null;
    this.interceptor = null;
    this.frontendHandlers.clear();
    this.processHandlers.clear();
    this.lifecycleHandlers.clear();
    this.rpcPool.dropOwner(ENGINE_EXTENSION);
  }

  // ------------------------------------------------------------------ generations

  async start(chatId: ChatId, opts: StartOptions): Promise<Generation> {
    const c = this.chat(chatId);
    const g: Generation = { id: this.newId("gen"), chatId, type: opts.type, swipeId: 0, postfix: "", open: true };
    let targetMessageId: MessageId | null = null;
    let targetSwipeId: number | null = 0;
    if (opts.type === "normal") {
      if (!opts.createAtEnd) {
        const m: FakeMessage = { id: this.newId("m"), isUser: false, name: "Narrator", swipes: [""], swipeId: 0, bag: {} };
        c.messages.push(m);
        this.emit("MESSAGE_SENT", { chatId, message: this.hostMessage(chatId, m.id) });
        g.messageId = m.id;
        targetMessageId = m.id;
      } else {
        targetSwipeId = null;
      }
    } else if (opts.type === "regenerate" || opts.type === "swipe") {
      const target = opts.messageId ? this.message(chatId, opts.messageId) : this.head(chatId);
      if (!target) throw new Error("no assistant message to regenerate");
      target.swipes.push("");
      target.swipeId = target.swipes.length - 1;
      this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, target.id), action: "added", swipeId: target.swipeId });
      g.messageId = target.id;
      g.swipeId = target.swipeId;
      targetMessageId = target.id;
      targetSwipeId = target.swipeId;
    } else if (opts.type === "continue") {
      const target = opts.messageId ? this.message(chatId, opts.messageId) : this.head(chatId);
      if (!target) throw new Error("no assistant message to continue");
      g.messageId = target.id;
      g.swipeId = target.swipeId;
      g.original = target.swipes[target.swipeId] ?? "";
      g.postfix = " ";
      targetSwipeId = target.swipeId;
    } else {
      targetSwipeId = null;
    }
    this.inFlight.set(g.id, g);
    this.emit("GENERATION_STARTED", { generationId: g.id, chatId, model: "fake", targetMessageId, targetSwipeId, characterId: null, characterName: "Narrator", generationType: opts.type });
    await this.settle();
    const context = new AbortController();
    if (opts.abandonContext) context.abort();
    if (this.contextHandler) await this.contextHandler({ chatId, userId: this.userId, generationType: opts.type, dryRun: false, connectionId: null, personaId: null }, context.signal);
    await this.runInterceptor(chatId);
    if (this.options.wiBook) this.emit("WORLD_INFO_ACTIVATED", { chatId, entries: [], stats: {} });
    this.emit("GENERATION_IN_PROGRESS", { generationId: g.id, chatId, model: "fake", targetMessageId, targetSwipeId, characterId: null, characterName: "Narrator" });
    await this.settle();
    return g;
  }

  /** A dry run: the context handler and interceptor run with `dryRun`; the assembly is returned, nothing is written. */
  async dryRun(chatId: ChatId): Promise<DryRun> {
    if (this.contextHandler) await this.contextHandler({ chatId, userId: this.userId, generationType: "normal", dryRun: true, connectionId: null, personaId: null }, new AbortController().signal);
    const result = await this.runInterceptor(chatId);
    const lore: string[] = [];
    for (const m of result?.mutated ?? []) if (m.content !== undefined && (result?.enabled.includes(m.id) || result?.forced.includes(m.id))) lore.push(m.content);
    const chat = this.chat(chatId).messages.filter((m) => m.isUser || (m.swipes[m.swipeId] ?? "") !== "").map((m) => ({ role: m.isUser ? "user" : "assistant", content: m.swipes[m.swipeId] ?? "" }));
    return { messages: [...lore.map((content) => ({ role: "system", content })), ...chat], blocks: structuredClone(this.preset.blocks), maxTokens: this.preset.maxTokens, model: this.preset.model };
  }

  private async runInterceptor(chatId: ChatId): Promise<InterceptorResult | null> {
    if (!this.interceptor) return null;
    const ids = this.chat(chatId).metadata.chat_world_book_ids;
    const entries: InterceptorInput["entries"] = [];
    for (const bookId of Array.isArray(ids) ? ids : []) {
      if (typeof bookId !== "string") continue;
      for (const e of this.bookStore.get(bookId)?.entries.values() ?? []) entries.push({ id: e.id, bookId, extensions: e.extensions });
    }
    this.lastInterceptor = await this.interceptor({ chatId, userId: this.userId, entries });
    return this.lastInterceptor;
  }

  /** The interceptor's last answer (tests inspect the slots it filled). */
  lastInterceptor: InterceptorResult | null = null;

  // ------------------------------------------------------------------ lore books and processes

  /** Books and their entries, each with the outlet the host keeps beside its extension data (reading an entry back doesn't show it). */
  readonly bookStore = new Map<string, { name: string; entries: Map<string, HostBookEntry & { outlet: string | null }> }>();

  /** An entry as the host stores it, outlet included (tests read where it sits). */
  storedEntry(entryId: string): (HostBookEntry & { outlet: string | null }) | undefined {
    for (const book of this.bookStore.values()) {
      const e = book.entries.get(entryId);
      if (e) return structuredClone(e);
    }
    return undefined;
  }

  /** Edits an entry as the host's World Info UI would. */
  editEntry(entryId: string, patch: Partial<HostBookEntryInput>): void {
    for (const book of this.bookStore.values()) {
      const e = book.entries.get(entryId);
      if (e) book.entries.set(entryId, { ...e, ...structuredClone(patch) });
    }
  }

  books: HostPort["books"] = {
    create: async (name) => {
      const id = this.newId("book");
      this.bookStore.set(id, { name, entries: new Map() });
      return id;
    },
    exists: async (bookId) => this.bookStore.has(bookId),
    entries: async (bookId) => [...(this.bookStore.get(bookId)?.entries.values() ?? [])].map(({ outlet: _outlet, ...e }) => structuredClone(e)),
    createEntry: async (bookId, entry) => {
      const book = this.bookStore.get(bookId);
      if (!book) throw new Error(`no book ${bookId}`);
      const id = this.newId("entry");
      book.entries.set(id, { ...structuredClone(entry), outlet: entry.outlet ?? null, id, bookId });
      return id;
    },
    place: async (entryId, placement, extensions) => {
      this.placed.push(entryId);
      for (const book of this.bookStore.values()) {
        const e = book.entries.get(entryId);
        if (e) book.entries.set(entryId, { ...e, ...structuredClone(placement), extensions: structuredClone(extensions) });
      }
    },
    deleteEntry: async (entryId) => {
      for (const book of this.bookStore.values()) book.entries.delete(entryId);
    },
  };

  /** Entries the backend moved, in order. */
  readonly placed: string[] = [];

  /** Payloads sent to spawned lanes, by process id. */
  readonly processMail = new Map<string, unknown[]>();
  private readonly processHandlers = new Set<(event: ProcessEvent) => void>();

  processes: HostPort["processes"] = {
    spawn: async () => {
      const processId = this.newId("proc");
      this.processMail.set(processId, []);
      return {
        processId,
        send: (payload: unknown) => this.processMail.get(processId)?.push(payload),
        stop: async () => {
          this.processMail.delete(processId);
        },
      };
    },
    onMessage: (handler) => {
      this.processHandlers.add(handler);
      return () => this.processHandlers.delete(handler);
    },
    onLifecycle: (handler) => {
      this.lifecycleHandlers.add(handler);
      return () => this.lifecycleHandlers.delete(handler);
    },
  };
  private readonly lifecycleHandlers = new Set<(event: ProcessEvent) => void>();

  /** A lane answers (tests play the child process). */
  reply(processId: string, payload: JsonValue): void {
    for (const h of this.processHandlers) h({ processId, key: "", payload });
  }

  /** A lane changes state (exits, fails, times out). */
  lifecycle(processId: string, key: string, state: string, error?: string): void {
    for (const h of this.lifecycleHandlers) h({ processId, key, state, ...(error ? { error } : {}) });
  }

  async finish(g: Generation, reply: string, opts: FinishOptions = {}): Promise<void> {
    // The host bakes the generated text (for a Continue, only what was added) before it saves it.
    const text = g.type === "impersonate" ? reply : this.baked(g.chatId, reply);
    if (!g.open) return;
    g.open = false;
    this.inFlight.delete(g.id);
    const chatId = g.chatId;
    if (g.type === "impersonate") {
      this.emit("GENERATION_ENDED", { generationId: g.id, chatId, content: text, generationType: g.type, impersonateDraft: text });
      await this.settle();
      return;
    }
    if (g.type === "normal" && !g.messageId) {
      const m: FakeMessage = { id: this.newId("m"), isUser: false, name: "Narrator", swipes: [text], swipeId: 0, bag: {} };
      this.chat(chatId).messages.push(m);
      g.messageId = m.id;
      this.emit("MESSAGE_SENT", { chatId, message: this.hostMessage(chatId, m.id) });
    } else {
      const target = g.messageId ? this.chat(chatId).messages.find((m) => m.id === g.messageId) : undefined;
      if (!target) {
        // The target was deleted while the reply streamed; the host reports the end without a message.
        this.emit("GENERATION_ENDED", { generationId: g.id, chatId, content: "", generationType: g.type, error: "message deleted" });
        await this.settle();
        return;
      }
      if (g.type === "continue") {
        target.swipes[g.swipeId] = (g.original ?? "") + g.postfix + text;
        this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, target.id) });
        if (opts.rerenderPrefix) {
          target.swipes[g.swipeId] = opts.rerenderPrefix(target.swipes[g.swipeId] ?? "");
          this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, target.id) });
        }
      } else if (g.type === "normal") {
        target.swipes[g.swipeId] = text;
        this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, target.id) });
      } else {
        target.swipes[g.swipeId] = text;
        this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, target.id), action: "updated", swipeId: g.swipeId });
      }
    }
    for (const [id, rendered] of Object.entries(opts.rerender ?? {})) {
      const u = this.chat(chatId).messages.find((m) => m.id === id);
      if (!u) continue;
      u.swipes[u.swipeId] = rendered;
      this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, id) });
    }
    const saved = this.chat(chatId).messages.find((m) => m.id === g.messageId);
    const content = saved ? (saved.swipes[g.swipeId] ?? "") : "";
    this.emit("GENERATION_ENDED", { generationId: g.id, chatId, ...(g.messageId && !opts.error ? { messageId: g.messageId } : {}), content, generationType: g.type, ...(opts.error ? { error: opts.error } : {}) });
    await this.settle();
  }

  async stop(g: Generation, partial: string): Promise<void> {
    if (!g.open) return;
    g.open = false;
    this.inFlight.delete(g.id);
    const chatId = g.chatId;
    const target = g.messageId ? this.chat(chatId).messages.find((m) => m.id === g.messageId) : undefined;
    if (target && g.type !== "impersonate") {
      target.swipes[g.swipeId] = g.type === "continue" ? (g.original ?? "") + g.postfix + partial : partial;
      this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, target.id) });
    }
    this.emit("GENERATION_STOPPED", { generationId: g.id, chatId, content: partial });
    await this.settle();
  }

  isOpen(g: Generation): boolean {
    return g.open;
  }
}
