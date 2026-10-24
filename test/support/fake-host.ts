// The fake host (DESIGN §14; ARCHITECTURE §7): an in-memory HostPort that replays the event
// orders and payloads recorded from a Lumiverse host (DESIGN §14). Generations are driven step
// by step (start, then finish or stop), so tests can interleave operations while a reply streams.
// The context handler runs as Lumiverse runs it: a non-required one that throws or runs out of time
// is skipped, a required one stops the generation, `cancelGeneration` stops it, and the prompt reads
// the World Info books as they are when it assembles.
//
// Event delivery: every host step queues its events; `settle()` delivers them in order and waits
// for the handlers' work. Handlers always read the host's current state, as on the real host.

import type { ListedTool } from "../../src/shared/agents";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { ChatId, MessageId, UserId } from "../../src/shared/ids";
import type { BackendToFrontend, GenerateAs } from "../../src/shared/protocol";
import type { Answers } from "../../src/engine/decide";
import type {
  ContextHandlerInput,
  ContextVerdict,
  DecideRequest,
  DryRun,
  HostBookEntry,
  HostBookEntryInput,
  HostCapabilities,
  HostEventMap,
  HostEventName,
  HostGenerationType,
  HostMessage,
  HostPort,
  HostPresetBlock,
  HostRegexScript,
  ProcessEvent,
  QuietRequest,
  QuietToolCall,
  WorldInfoInput,
  WorldInfoVerdict,
} from "../../src/backend/host";
import { ENGINE_EXTENSION, STUDIO_EXTENSION } from "../../src/shared/studio-bridge";
import { decodeEvent } from "../../src/backend/spindle-host";
import { FakeRpcPool } from "./fake-rpc";

export interface FakeMessage {
  id: MessageId;
  /** The host's `index_in_chat`: one past the chat's highest when the message is made, never renumbered after a deletion. */
  index: number;
  isUser: boolean;
  name: string;
  swipes: string[];
  swipeId: number;
  bag: JsonObject;
}

export interface FakeChat {
  id: ChatId;
  /** The chat's name as the chat list shows it. */
  name: string;
  metadata: JsonObject;
  messages: FakeMessage[];
}

type Handler = (payload: never, userId: UserId | null) => void;

/** A World Info entry a prompt held: its text and where it sat (position, depth, role, outlet). */
export interface AssembledEntry {
  id: string;
  content: string;
  position: number;
  depth: number;
  role: string | null;
  outlet: string | null;
}

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
  /** The generation stopped before its prompt: the guard cancelled it, or a required handler failed. */
  halted?: "cancelled" | "failed";
}

export interface StartOptions {
  type: HostGenerationType;
  /** Target message for regenerate, swipe and Continue (default: the head). */
  messageId?: MessageId;
  /** Normal replies: the host creates the reply at the end instead of staging it (P4's other save path). */
  createAtEnd?: boolean;
  /** The host stops waiting for the context handler (its timeout): a required one stops the generation, any other is skipped. */
  abandonContext?: boolean;
  /** The page the generation runs for (the host's execution document, `frontendSessionId`). */
  session?: string;
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
  /** The page a generation runs for when a test names none: the one Lumiverse page open. */
  static readonly PAGE = "page";
  readonly userId: UserId = "user-1";
  readonly chatsById = new Map<ChatId, FakeChat>();
  readonly files = new Map<string, string>();
  readonly sent: BackendToFrontend[] = [];
  /** Whom each message in `sent` went to: a user, and one session of theirs or (none named) every one. */
  readonly sentTo: { userId: UserId | null; session?: string }[] = [];
  /** Tests waiting for a message the backend sends later (`sentWhere`). */
  private readonly sendWaiters: { match: (message: BackendToFrontend) => boolean; resolve: (message: BackendToFrontend) => void }[] = [];

  /** The first message sent so far that `match` accepts, or, when there is none yet, the first one sent from now on. */
  sentWhere(match: (message: BackendToFrontend) => boolean): Promise<BackendToFrontend> {
    const found = this.sent.find(match);
    if (found) return Promise.resolve(found);
    const { promise, resolve } = Promise.withResolvers<BackendToFrontend>();
    this.sendWaiters.push({ match, resolve });
    return promise;
  }
  private readonly handlers = new Map<HostEventName, Set<Handler>>();
  private readonly frontendHandlers = new Set<(message: unknown, userId: UserId, sessionId?: string) => void>();
  private contextHandler: ((input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict>) | null = null;
  /** The context handler's registered timeout (the host would give up on it after this). */
  contextTimeoutMs = 0;
  /** Whether the handler registered as required: its failure or timeout stops the generation. */
  contextRequired = false;
  /** Tests waiting for the context handler to be asked about a generation (`contextAsked`). */
  private readonly contextWaiters: { type: HostGenerationType; resolve: () => void }[] = [];

  /** Resolves once the context handler is asked about the next generation of `type` (a test seam: it fires as the handler is called). */
  contextAsked(type: HostGenerationType): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.contextWaiters.push({ type, resolve });
    return promise;
  }
  /** What this host does with the handler's answer (`cancelGeneration`, `required`) and frontend pages; a test plays an older host by switching one off. */
  capabilities: HostCapabilities = { cancel: true, required: true, sessions: true };
  /** The frontend's side of `lre.generate` (DESIGN §5.1): what the engine asked to start, of which page, in order, until `start` plays it. */
  readonly restarts: { chatId: ChatId; as: GenerateAs; turn: string; session?: string }[] = [];
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
    messages: async (chatId) => this.chat(chatId).messages.map((m) => this.toHost(chatId, m)),
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
    // The real host lists only its owner's chats.
    list: async (userId) => (userId === this.userId ? [...this.chatsById.values()].reverse().map((c) => ({ id: c.id, name: c.name, metadata: structuredClone(c.metadata) })) : []),
    // `chat.updateMessage` with swipes: MESSAGE_EDITED (and SWIPE_EDITED, which the port doesn't hear).
    setSwipes: async (chatId, messageId, swipes, swipeId) => {
      const m = this.message(chatId, messageId);
      if (swipes.length === 0 || swipeId < 0 || swipeId >= swipes.length) throw new Error("updateMessage: swipe_id out of range");
      m.swipes = [...swipes];
      m.swipeId = swipeId;
      this.emit("MESSAGE_EDITED", { chatId, message: this.hostMessage(chatId, messageId) });
    },
  };

  /** The chat the user has open (`chats.getActive`). */
  activeChat: ChatId | null = null;
  /** The active preset as a dry run sees it (the D32 lint). */
  preset: { name: string; blocks: { id: string; name: string; content: string }[]; maxTokens: number | null; model: string } = { name: "Default", blocks: [], maxTokens: null, model: "fake" };

  /** The default preset's blocks (`presets.blocks`) and its revision, which each change made through the port bumps. */
  presetBlocks: HostPresetBlock[] = [];
  presetRevision = 1;
  /** How many times a preset's blocks were read (each revision is read once). */
  blockReads = 0;
  /** Presets besides the default one, "preset-1" (whose name is `preset.name`). */
  readonly otherPresets = new Map<string, { name: string; revision: number; blocks: HostPresetBlock[] }>();
  /** The preset the host generates every chat with (`presets.getActive`), and the block states its profile bindings set, by block id. */
  activePreset: string | null = "preset-1";
  blockStates: Record<string, boolean> = {};
  /** Set: the host can't say which preset a chat generates with (`presets.getActive` throws this). */
  presetUnknown: string | null = null;
  /** The connection the context handler is given (`connectionId`). */
  contextConnectionId: string | null = null;

  /** How many times a preset was written. */
  presetWrites = 0;

  presets: HostPort["presets"] = {
    get: async (presetId) => {
      if (presetId === "preset-1") return { id: presetId, name: this.preset.name, revision: this.presetRevision };
      const other = this.otherPresets.get(presetId);
      return other ? { id: presetId, name: other.name, revision: other.revision } : null;
    },
    active: async () => {
      if (this.presetUnknown !== null) throw new Error(this.presetUnknown);
      return { presetId: this.activePreset, blockStates: structuredClone(this.blockStates) };
    },
    blocks: async (presetId) => {
      this.blockReads++;
      return structuredClone(presetId === "preset-1" ? this.presetBlocks : (this.otherPresets.get(presetId)?.blocks ?? []));
    },
    insertBlocks: async (presetId, revision, at, blocks) => {
      if (presetId !== "preset-1" || revision !== this.presetRevision) throw new Error("the preset changed while the blocks were being added; try again");
      const created = blocks.map((block): HostPresetBlock => {
        const id = this.newId("block");
        return block.kind === "category" ? { id, name: block.name, content: "", enabled: true, marker: "category", injectionTrigger: [], characterTagTrigger: [], categoryMode: "checkbox" } : { id, name: block.name, content: block.content, enabled: false, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null };
      });
      this.presetBlocks.splice(at ?? this.presetBlocks.length, 0, ...created);
      this.presetRevision++;
      this.presetWrites++;
    },
  };

  /** The user's default connection (`connections.list`, `is_default`). */
  activeConnection: { id: string; name: string } | null = null;

  connections: HostPort["connections"] = {
    active: async () => this.activeConnection,
  };

  /** `mcp_servers`, granted or not; Lumiverse's MCP server profiles, each with what its client holds; and each Spindle read, in order. */
  mcpGranted = false;
  readonly mcpProfiles: { id: string; name: string; transport: "stdio" | "streamable_http" | "sse"; connected: boolean; tools: ListedTool[] }[] = [];
  readonly mcpReads: string[] = [];

  mcp: HostPort["mcp"] = {
    granted: () => this.mcpGranted,
    stdioProfiles: async () => {
      if (!this.mcpGranted) throw new Error("Permission denied: mcp_servers — MCP server permission not granted");
      this.mcpReads.push("list");
      return this.mcpProfiles.filter((p) => p.transport === "stdio").map((p) => ({ id: p.id, name: p.name }));
    },
    status: async (profileId) => {
      if (!this.mcpGranted) throw new Error("Permission denied: mcp_servers — MCP server permission not granted");
      this.mcpReads.push(`status ${profileId}`);
      const p = this.mcpProfiles.find((x) => x.id === profileId);
      if (p === undefined) throw new Error("MCP server not found");
      return { connected: p.connected, tools: p.connected ? structuredClone(p.tools) : [] };
    },
  };

  /** The user's regex scripts: the engine's own, and any a test plants (`mine: false` for one the engine may not change). */
  readonly regexScripts = new Map<string, HostRegexScript & { scriptId: string; disabled: boolean }>();

  regex: HostPort["regex"] = {
    chatScripts: async (chatId) => [...this.regexScripts.values()].filter((s) => s.chatId !== null && (chatId === null || s.chatId === chatId)).map(({ scriptId: _id, disabled: _off, ...s }) => structuredClone(s)),
    globalScripts: async () => [...this.regexScripts.values()].filter((s) => s.chatId === null).map(({ scriptId: _id, disabled: _off, ...s }) => structuredClone(s)),
    write: async (id, script) => {
      // The host normalizes a script id and keeps it unique per user.
      const scriptId = script.scriptId.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
      if ([...this.regexScripts.values()].some((s) => s.scriptId === scriptId && s.id !== id)) throw new Error("script_id already exists");
      const prior = id === null ? undefined : this.regexScripts.get(id);
      if (id !== null && !prior?.mine) throw new Error("Regex script not found or not this extension's");
      const next = { id: id ?? this.newId("regex"), chatId: script.chatId, mine: true, scriptId, findRegex: script.findRegex, replaceString: script.replaceString, flags: script.flags, placement: [...script.placement], targets: [...script.targets], runOnEdit: script.runOnEdit, sortOrder: script.sortOrder, metadata: structuredClone(script.metadata), disabled: prior?.disabled ?? false };
      this.regexScripts.set(next.id, next);
      return next.id;
    },
    remove: async (id) => {
      if (!this.regexScripts.get(id)?.mine) throw new Error("Regex script not found or not this extension's");
      this.regexScripts.delete(id);
    },
  };

  /**
   * `text` through the chat's enabled scripts on `target` for AI output (no macros: plain replacement), in
   * the order the host runs them: the frontend runs display scripts by sort order alone, the backend runs
   * the others global first, then the chat's, each by sort order; the order they were made in breaks a tie.
   * An edit runs only the run-on-edit ones.
   */
  scripted(chatId: ChatId, target: "response" | "display" | "prompt", text: string, edit = false): string {
    const tier = (s: HostRegexScript) => (target !== "display" && s.chatId !== null ? 1 : 0);
    const scripts = [...this.regexScripts.values()].filter((s) => !s.disabled && (s.chatId === null || s.chatId === chatId) && s.targets.includes(target) && s.placement.includes("ai_output") && (!edit || s.runOnEdit));
    return scripts.sort((a, b) => tier(a) - tier(b) || a.sortOrder - b.sortOrder).reduce((out, s) => out.replace(new RegExp(s.findRegex, s.flags), s.replaceString), text);
  }

  /** A reply as the host saves it: its `response` scripts applied; an edit runs only the run-on-edit ones. */
  baked(chatId: ChatId, text: string, edit = false): string {
    return this.scripted(chatId, "response", text, edit);
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

  /** The extension's own storage, by path; kept across a restart, as a host keeps it. */
  readonly extensionFiles = new Map<string, string>();
  extensionStorage: HostPort["extensionStorage"] = {
    read: async (path) => this.extensionFiles.get(path) ?? null,
    write: async (path, data) => {
      this.extensionFiles.set(path, data);
    },
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

  registerContextHandler(handler: (input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict>, options: { timeoutMs: number; required: boolean }): void {
    this.contextHandler = handler;
    this.contextTimeoutMs = options.timeoutMs;
    this.contextRequired = options.required && this.capabilities.required;
  }

  /** The World Info interceptor, asked before activation in every assembly as Lumiverse asks it. */
  worldInfoInterceptor: ((input: WorldInfoInput) => Promise<WorldInfoVerdict>) | null = null;

  registerWorldInfoInterceptor(handler: (input: WorldInfoInput) => Promise<WorldInfoVerdict>): void {
    this.worldInfoInterceptor = handler;
  }

  /** The user's global books, which every chat's prompt scans beside the chat's own. */
  globalBooks: string[] = [];

  /**
   * Scripted model replies for tests (a quiet call's text, or its text and tool calls); throwing
   * plays a failed call. The default refuses: the ledger suite makes no model calls. Live model
   * behaviour is checked on the real host only.
   */
  quietReply: ((request: QuietRequest) => string | { content: string; toolCalls?: QuietToolCall[]; finishReason?: string }) | null = null;
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
      return typeof reply === "string" ? { content: reply, finishReason: "stop", tokens: 0 } : { content: reply.content, finishReason: reply.finishReason ?? (reply.toolCalls ? "tool_calls" : "stop"), tokens: 0, ...(reply.toolCalls ? { toolCalls: reply.toolCalls } : {}) };
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
    send: (message, userId, frontendSessionId) => {
      this.sent.push(message);
      this.sentTo.push({ userId, ...(frontendSessionId !== undefined ? { session: frontendSessionId } : {}) });
      // The frontend open on the chat starts the generation the engine prepared (`start` plays it).
      if (message.type === "lre.generate") this.restarts.push({ chatId: message.chatId, as: message.as, turn: message.turn, ...(frontendSessionId !== undefined ? { session: frontendSessionId } : {}) });
      for (const waiter of this.sendWaiters.filter((w) => w.match(message))) {
        this.sendWaiters.splice(this.sendWaiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
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

  /** Every toast shown, with its user. */
  readonly toasts: { message: string; userId: UserId }[] = [];
  toast(message: string, userId: UserId): void {
    this.toasts.push({ message, userId });
  }

  readonly logs: string[] = [];
  /** Log lines tied to a user, by user (the per-user diagnostics mirror). */
  readonly userLogs = new Map<UserId, string[]>();

  /** Each user line's turn (a generation id), where the line named one; by the line's index in `userLogs`. */
  readonly logTurns = new Map<UserId, (string | null)[]>();

  log(level: "debug" | "info" | "warn" | "error", message: string, userId?: UserId, turn?: string): void {
    this.logs.push(`${level}: ${message}`);
    if (!userId) return;
    this.userLogs.set(userId, [...(this.userLogs.get(userId) ?? []), `${level}: ${message}`]);
    this.logTurns.set(userId, [...(this.logTurns.get(userId) ?? []), turn ?? null]);
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
    const chat: FakeChat = { id, name: `Chat ${this.nextId}`, metadata: {}, messages: [] };
    this.chatsById.set(id, chat);
    if (greeting !== undefined) this.append(chat, { id: this.newId("m"), isUser: false, name: "Narrator", swipes: [greeting], swipeId: 0, bag: {} });
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

  /** A new message at the chat's end, numbered as the host numbers it (`createMessage`: one past the highest `index_in_chat`). */
  append(chat: FakeChat, message: Omit<FakeMessage, "index">): FakeMessage {
    const m: FakeMessage = { ...message, index: chat.messages.reduce((top, x) => Math.max(top, x.index), -1) + 1 };
    chat.messages.push(m);
    return m;
  }

  private toHost(chatId: ChatId, m: FakeMessage): HostMessage {
    return { id: m.id, chatId, index: m.index, isUser: m.isUser, name: m.name, content: m.swipes[m.swipeId] ?? "", swipeId: m.swipeId, swipes: [...m.swipes], metadata: structuredClone(m.bag) };
  }

  private hostMessage(chatId: ChatId, messageId: MessageId): HostMessage {
    return this.toHost(chatId, this.message(chatId, messageId));
  }

  // ------------------------------------------------------------------ user operations

  sendUser(chatId: ChatId, text: string, metadata: JsonObject = {}): MessageId {
    const m = this.append(this.chat(chatId), { id: this.newId("u"), isUser: true, name: "User", swipes: [text], swipeId: 0, bag: structuredClone(metadata) });
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

  /** Deletes a chat: CHAT_DELETED. As on the host, its chat-scoped regex scripts stay. */
  deleteChat(chatId: ChatId): void {
    this.chatsById.delete(chatId);
    this.emit("CHAT_DELETED", { chatId });
  }

  /** Branch: a new chat with copies of the messages up to `messageId`, metadata included. Silent. */
  branch(chatId: ChatId, messageId: MessageId): ChatId {
    const c = this.chat(chatId);
    const index = c.messages.findIndex((m) => m.id === messageId);
    const id = `chat-${++this.nextId}`;
    this.chatsById.set(id, { id, name: `${c.name} (branch)`, metadata: structuredClone(c.metadata), messages: c.messages.slice(0, index + 1).map((m) => ({ ...structuredClone(m), id: this.newId(m.isUser ? "u" : "m") })) });
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

  /** One of the user's Lumiverse pages disconnects (`FRONTEND_SESSION_CLOSED`). */
  closeSession(session: string): void {
    this.emit("FRONTEND_SESSION_CLOSED", { frontendSessionId: session });
  }

  /** The user's settings are written (`SETTINGS_UPDATED`): a Lumiverse page saves its settings as one batch naming every key (`settings.putMany`), read as the engine reads the host's payload. */
  settingsSaved(keys: string[]): void {
    const event = decodeEvent("SETTINGS_UPDATED", { keys });
    if (event) this.emit("SETTINGS_UPDATED", event);
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
    this.restarts.length = 0;
    this.handlers.clear();
    this.contextHandler = null;
    this.frontendHandlers.clear();
    this.processHandlers.clear();
    this.lifecycleHandlers.clear();
    this.rpcPool.dropOwner(ENGINE_EXTENSION);
  }

  // ------------------------------------------------------------------ generations

  /**
   * A generation as the player starts it (Send, Regenerate, swipe, Continue). When the guard stops it
   * to run the engine first, the engine asks a page to start it again (`lre.generate`), as this
   * plays: that page claims the turn (`claimRestart`) and runs the frontend's Regenerate or Continue,
   * or for a new reply after a reply the player's Send again. The generation returned is the one the
   * reply streams in (DESIGN §5.1); a run that failed, or a claim refused, returns the stopped one.
   */
  async start(chatId: ChatId, opts: StartOptions): Promise<Generation> {
    let g = await this.begin(chatId, opts);
    for (let round = 0; g.halted === "cancelled" && round < 3; round++) {
      const at = this.restarts.findIndex((r) => r.chatId === chatId);
      if (at < 0) return g;
      const [restart] = this.restarts.splice(at, 1);
      if (!restart || (restart.as !== "send" && this.claimRestart && !(await this.claimRestart(restart)))) return g;
      const type: HostGenerationType = restart.as === "continue" ? "continue" : restart.as === "send" ? "normal" : "regenerate";
      g = await this.begin(chatId, { type, ...(opts.createAtEnd ? { createAtEnd: true } : {}), ...(restart.session !== undefined ? { session: restart.session } : {}) });
    }
    return g;
  }

  /** How a page claims a prepared turn before it starts it (`lre.restart`); the rig sends the request, the ledger harness asks the service. */
  claimRestart: ((restart: { chatId: ChatId; turn: string; session?: string }) => Promise<boolean>) | null = null;

  /**
   * One generation as Lumiverse runs it, up to its streaming: its target staged, GENERATION_STARTED,
   * the context handler, and then either the prompt (World Info read from the books as they are now,
   * WORLD_INFO_ACTIVATED, GENERATION_IN_PROGRESS) or a stop before it.
   */
  async begin(chatId: ChatId, opts: StartOptions): Promise<Generation> {
    const c = this.chat(chatId);
    // Lumiverse's fallback (generate.service.ts:1541-1549): a Regenerate, swipe or Continue with no
    // target, in a chat that ends with the player's message, is a new reply.
    const type: HostGenerationType = (opts.type === "regenerate" || opts.type === "swipe" || opts.type === "continue") && !opts.messageId && c.messages.at(-1)?.isUser !== false ? "normal" : opts.type;
    const g: Generation = { id: this.newId("gen"), chatId, type, swipeId: 0, postfix: "", open: true };
    let targetMessageId: MessageId | null = null;
    let targetSwipeId: number | null = 0;
    if (type === "normal") {
      if (!opts.createAtEnd) {
        const m = this.append(c, { id: this.newId("m"), isUser: false, name: "Narrator", swipes: [""], swipeId: 0, bag: {} });
        this.emit("MESSAGE_SENT", { chatId, message: this.hostMessage(chatId, m.id) });
        g.messageId = m.id;
        targetMessageId = m.id;
      } else {
        targetSwipeId = null;
      }
    } else if (type === "regenerate" || type === "swipe") {
      const target = opts.messageId ? this.message(chatId, opts.messageId) : this.head(chatId);
      if (!target) throw new Error("no assistant message to regenerate");
      target.swipes.push("");
      target.swipeId = target.swipes.length - 1;
      this.emit("MESSAGE_SWIPED", { chatId, message: this.hostMessage(chatId, target.id), action: "added", swipeId: target.swipeId });
      g.messageId = target.id;
      g.swipeId = target.swipeId;
      targetMessageId = target.id;
      targetSwipeId = target.swipeId;
    } else if (type === "continue") {
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
    this.emit("GENERATION_STARTED", { generationId: g.id, chatId, model: "fake", targetMessageId, targetSwipeId, characterId: null, characterName: "Narrator", generationType: type });
    await this.settle();
    // The host names the page the generation runs for; with one page open, it is that page.
    const verdict = await this.runContext({ chatId, userId: this.userId, generationType: type, dryRun: false, connectionId: this.contextConnectionId, personaId: null, frontendSessionId: opts.session ?? FakeHost.PAGE }, opts.abandonContext === true);
    if (verdict !== "go") return this.halt(g, verdict);
    const prompt = await this.worldInfo(chatId);
    this.assembled = prompt.placed;
    if (this.options.wiBook) this.emit("WORLD_INFO_ACTIVATED", { chatId, entries: prompt.activated.map((e) => ({ id: e.id, comment: e.comment, source: "constant", bookId: e.bookId })), stats: {} });
    this.emit("GENERATION_IN_PROGRESS", { generationId: g.id, chatId, model: "fake", targetMessageId, targetSwipeId, characterId: null, characterName: "Narrator" });
    await this.settle();
    return g;
  }

  /**
   * The context handler as Lumiverse calls it (context-handler.ts): one that throws, or that the host
   * stops waiting for, is skipped, unless it registered as required; `cancel` stops the generation.
   */
  private async runContext(input: ContextHandlerInput, abandon: boolean): Promise<"go" | "cancelled" | "failed"> {
    if (!this.contextHandler) return "go";
    for (const waiter of this.contextWaiters.filter((w) => w.type === input.generationType)) {
      this.contextWaiters.splice(this.contextWaiters.indexOf(waiter), 1);
      waiter.resolve();
    }
    const context = new AbortController();
    if (abandon) context.abort();
    try {
      const verdict = await this.contextHandler(input, context.signal);
      if (abandon) return this.contextRequired ? "failed" : "go";
      return verdict === "cancel" && this.capabilities.cancel ? "cancelled" : "go";
    } catch {
      return this.contextRequired ? "failed" : "go";
    }
  }

  /**
   * Lumiverse stops a generation before its prompt (generate.service.ts:2903-2938): a new reply's
   * staged message is deleted, a swipe's blank one stays; `cancelGeneration` ends it with
   * GENERATION_STOPPED, a required handler's failure with GENERATION_ENDED and an error.
   */
  private async halt(g: Generation, how: "cancelled" | "failed"): Promise<Generation> {
    g.open = false;
    g.halted = how;
    this.inFlight.delete(g.id);
    if (g.type === "normal" && g.messageId) {
      const c = this.chat(g.chatId);
      c.messages = c.messages.filter((m) => m.id !== g.messageId);
      this.emit("MESSAGE_DELETED", { chatId: g.chatId, messageId: g.messageId });
    }
    if (how === "cancelled") this.emit("GENERATION_STOPPED", { generationId: g.id, chatId: g.chatId, content: "" });
    else this.emit("GENERATION_ENDED", { generationId: g.id, chatId: g.chatId, content: "", generationType: g.type, error: "a required context handler failed" });
    await this.settle();
    return g;
  }

  /**
   * A dry run: the context handler is asked with `dryRun`; the assembly is returned, nothing is
   * written. `cancelGeneration` fails it, as Lumiverse's pipeline throws for any assembly the
   * handler cancels (generate.service.ts:1050-1058 on staging 7524546f).
   */
  async dryRun(chatId: ChatId): Promise<DryRun> {
    if (this.contextHandler) {
      const verdict = await this.contextHandler({ chatId, userId: this.userId, generationType: "normal", dryRun: true, connectionId: null, personaId: null }, new AbortController().signal);
      if (verdict === "cancel" && this.capabilities.cancel) throw new Error("Generation cancelled by an extension");
    }
    const lore = (await this.worldInfo(chatId)).placed.map((e) => e.content);
    const chat = this.chat(chatId).messages.filter((m) => m.isUser || (m.swipes[m.swipeId] ?? "") !== "").map((m) => ({ role: m.isUser ? "user" : "assistant", content: m.swipes[m.swipeId] ?? "" }));
    return { messages: [...lore.map((content) => ({ role: "system", content })), ...chat], blocks: structuredClone(this.preset.blocks), maxTokens: this.preset.maxTokens, model: this.preset.model };
  }

  /** The outlets a test build's prompt holds (null: every outlet an entry names). */
  assembledOutlets: Set<string> | null = null;

  /**
   * The World Info a prompt gets, read from the chat's books and the global ones as they are now. The
   * interceptor runs first, as Lumiverse's does: an off vote wins, `enabled` switches on an entry
   * stored switched off, and a throw leaves the entries as stored. Then every enabled constant entry
   * with text activates; an outlet-only one (position 8) reaches the prompt only where an assembled
   * block holds its outlet.
   */
  private async worldInfo(chatId: ChatId): Promise<{ activated: (HostBookEntry & { outlet: string | null })[]; placed: AssembledEntry[] }> {
    const ids = this.chat(chatId).metadata.chat_world_book_ids;
    const scanned = [...new Set([...(Array.isArray(ids) ? ids : []), ...this.globalBooks])].filter((id): id is string => typeof id === "string");
    const candidates = scanned.flatMap((bookId) => [...(this.bookStore.get(bookId)?.entries.values() ?? [])].map((e) => structuredClone(e)));
    if (this.worldInfoInterceptor) {
      try {
        const verdict = await this.worldInfoInterceptor({ chatId, userId: this.userId, entries: candidates.map((e) => ({ id: e.id, bookId: e.bookId, disabled: e.disabled, extensions: structuredClone(e.extensions) })), chatMetadata: structuredClone(this.chat(chatId).metadata) });
        const off = new Set(verdict.disabled);
        const on = new Set(verdict.enabled);
        for (const e of candidates) e.disabled = off.has(e.id) || (e.disabled && !on.has(e.id));
      } catch {
        // Lumiverse logs the failure and activates the entries as stored.
      }
    }
    const activated = candidates.filter((e) => !e.disabled && e.constant && e.content !== "");
    // An outlet-only entry reaches the prompt where an enabled block of the preset the host assembles with (its block states applied) holds its outlet.
    const blocks = this.activePreset === null ? [] : this.activePreset === "preset-1" ? this.presetBlocks : (this.otherPresets.get(this.activePreset)?.blocks ?? []);
    const held = new Set(blocks.filter((b) => this.blockStates[b.id] ?? b.enabled).flatMap((b) => [...b.content.matchAll(/\{\{outlet::([^}]*)\}\}/gi)].map((m) => (m[1] ?? "").trim().toLowerCase())));
    const outlets = this.assembledOutlets ?? (this.presetPlacesOutlets ? held : null);
    const placed = activated.filter((e) => e.position !== 8 || outlets === null || outlets.has(e.outlet ?? "")).map((e) => ({ id: e.id, content: e.content, position: e.position, depth: e.depth, role: e.role, outlet: e.outlet }));
    return { activated, placed };
  }

  /** A preset saved, as Lumiverse reports any preset write (`PRESET_CHANGED`, `{ id }`). */
  emitPresetChanged(presetId: string): void {
    this.emit("PRESET_CHANGED", { presetId });
  }

  /** Whether an outlet-only entry reaches the prompt only where the active preset's enabled blocks hold its outlet, as Lumiverse assembles (`assembledOutlets` null and this off: every outlet an entry names). */
  presetPlacesOutlets = false;

  /** The World Info the last generation's prompt held (tests read the sections it carried). */
  assembled: AssembledEntry[] = [];

  /** The text of the section the last prompt held under `[label]`, or "" when it held none. */
  section(label: string): string {
    return this.assembled.find((e) => e.content.startsWith(`[${label}]`))?.content ?? "";
  }

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
    list: async () => [...this.bookStore.entries()].map(([id, book]) => ({ id, name: book.name, engine: book.name.startsWith("LumiRPEngine · ") })),
    global: async () => [...this.globalBooks],
    entries: async (bookId) => [...(this.bookStore.get(bookId)?.entries.values() ?? [])].map(({ outlet: _outlet, ...e }) => structuredClone(e)),
    entry: async (entryId) => {
      const stored = this.storedEntry(entryId);
      if (!stored) return null;
      const { outlet: _outlet, ...e } = stored;
      return e;
    },
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
    fill: async (entryId, content) => {
      this.fills.push({ entryId, content });
      for (const book of this.bookStore.values()) {
        const e = book.entries.get(entryId);
        if (e) book.entries.set(entryId, { ...e, content: content ?? "", disabled: content === null, constant: content !== null });
      }
    },
    setExtensions: async (entryId, extensions, disabled) => {
      for (const book of this.bookStore.values()) {
        const e = book.entries.get(entryId);
        if (e) book.entries.set(entryId, { ...e, extensions: structuredClone(extensions), disabled: disabled ?? e.disabled });
      }
    },
    deleteEntry: async (entryId) => {
      for (const book of this.bookStore.values()) book.entries.delete(entryId);
    },
  };

  /** Entries the backend moved, in order. */
  readonly placed: string[] = [];
  /** Every entry fill, in order: its text, or null for emptied and switched off. */
  readonly fills: { entryId: string; content: string | null }[] = [];

  /** Payloads sent to spawned lanes, by process id. */
  readonly processMail = new Map<string, unknown[]>();
  /** Each lane spawn's options, in order (its start-up and heartbeat waits among them). */
  readonly spawned: Parameters<HostPort["processes"]["spawn"]>[0][] = [];
  private readonly processHandlers = new Set<(event: ProcessEvent) => void>();

  processes: HostPort["processes"] = {
    spawn: async (options) => {
      this.spawned.push(options);
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
      const m = this.append(this.chat(chatId), { id: this.newId("m"), isUser: false, name: "Narrator", swipes: [text], swipeId: 0, bag: {} });
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
