// HostPort: the narrow port between the backend and Lumiverse (ARCHITECTURE §2, §8).
//
// Backend logic talks only to this interface. `backend/spindle-host.ts` implements it over the
// `spindle` global and is the only file that touches it; `test/support/fake-host.ts`
// implements it for tests by replaying the event orders recorded from a Lumiverse host (DESIGN §14).
// Shapes mirror the observed payloads: event payloads carry no userId, which the host passes
// as the handler's second argument.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatId, GenerationId, MessageId, UserId } from "../shared/ids";
import type { BackendToFrontend } from "../shared/protocol";
import type { Answers, Questions } from "../engine/decide";

export type HostGenerationType = "normal" | "regenerate" | "swipe" | "continue" | "impersonate";

/** A chat message as the backend sees it. `content` is the displayed swipe, `swipes[swipeId]`. */
export interface HostMessage {
  id: MessageId;
  chatId: ChatId;
  index: number;
  isUser: boolean;
  name: string;
  content: string;
  swipeId: number;
  swipes: string[];
  /** The whole `spindle_metadata` bag (every extension's namespace). */
  metadata: JsonObject;
}

// ---------------------------------------------------------------- events

export interface GenerationStartedEvent {
  generationId: GenerationId;
  chatId: ChatId;
  model: string;
  /** Null for Continue (DESIGN §5.1 step 1). */
  targetMessageId: MessageId | null;
  /** Present for every type, Continue included. */
  targetSwipeId: number | null;
  characterId: string | null;
  characterName: string | null;
  generationType: HostGenerationType;
  frontendSessionId?: string;
}

export interface GenerationInProgressEvent {
  generationId: GenerationId;
  chatId: ChatId;
  model: string;
  targetMessageId: MessageId | null;
  targetSwipeId: number | null;
  characterId: string | null;
  characterName: string | null;
  contextClipStats: JsonObject | null;
}

export interface GenerationEndedEvent {
  generationId: GenerationId;
  chatId: ChatId;
  /** The saved message; absent for Impersonate and on error. */
  messageId?: MessageId;
  /** The saved swipe's whole content (for Continue too). Empty on error, and possibly empty without one. */
  content: string;
  usage?: JsonObject;
  finish_reason?: string;
  generationType: HostGenerationType;
  frontendSessionId?: string;
  impersonateDraft?: string;
  error?: string;
}

/** No messageId; for a Continue, `content` is only the partial suffix (DESIGN §5.1 step 6). */
export interface GenerationStoppedEvent {
  generationId: GenerationId;
  chatId: ChatId;
  content: string;
}

export interface MessageEvent {
  chatId: ChatId;
  message: HostMessage;
}

export type SwipeAction = "added" | "navigated" | "updated" | "deleted";

export interface MessageSwipedEvent {
  chatId: ChatId;
  message: HostMessage;
  action: SwipeAction;
  /** For `updated`, the written swipe, which may differ from `message.swipeId`. */
  swipeId: number;
  /** Only on `navigated`. */
  previousSwipeId?: number;
}

export interface MessageDeletedEvent {
  chatId: ChatId;
  messageId: MessageId;
}

export interface ActivatedEntry {
  id: string;
  comment: string;
  source: string;
  bookId: string;
}

export interface WorldInfoActivatedEvent {
  chatId: ChatId;
  entries: ActivatedEntry[];
  stats: JsonObject;
}

export interface HostEventMap {
  GENERATION_STARTED: GenerationStartedEvent;
  GENERATION_IN_PROGRESS: GenerationInProgressEvent;
  GENERATION_ENDED: GenerationEndedEvent;
  GENERATION_STOPPED: GenerationStoppedEvent;
  MESSAGE_SENT: MessageEvent;
  MESSAGE_EDITED: MessageEvent;
  MESSAGE_SWIPED: MessageSwipedEvent;
  MESSAGE_DELETED: MessageDeletedEvent;
  WORLD_INFO_ACTIVATED: WorldInfoActivatedEvent;
}

export type HostEventName = keyof HostEventMap;

// ---------------------------------------------------------------- hooks

export interface ContextHandlerInput {
  chatId: ChatId;
  userId: UserId;
  generationType: HostGenerationType;
  dryRun: boolean;
  connectionId: string | null;
  personaId: string | null;
  frontendSessionId?: string;
}

/** A World Info entry as the interceptor sees it: the engine reads only which book it is in and its extension data. */
export interface InterceptorEntry {
  id: string;
  bookId: string;
  /** The entry's extension data (`lumi_rp_engine`: a slot, or the lore id of an entry an earlier build synced). */
  extensions: JsonObject;
}

/** The interceptor context; it carries no dry-run flag (G1). */
export interface InterceptorInput {
  chatId: ChatId;
  userId: UserId;
  entries: InterceptorEntry[];
}

export interface PlacementOverride {
  type: "chat_depth";
  role: "system" | "user" | "assistant";
  depth: number;
  direction: "from_start" | "from_end";
}

export interface InterceptorResult {
  disabled: string[];
  enabled: string[];
  forced: string[];
  mutated: { id: string; content?: string; placement?: PlacementOverride }[];
}

// ---------------------------------------------------------------- model calls

export interface QuietRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxTokens: number;
  json: boolean;
  connectionId: string | null;
  /** Overrides the connection's saved model for this call (a step's route, DESIGN §5.3 Custom). */
  model: string | null;
}

export interface QuietResult {
  content: string;
  finishReason: string;
  tokens: number;
}

export interface DecideRequest {
  state: JsonValue;
  questions: Questions;
  connectionId: string | null;
  model: string | null;
}

export interface DecideResult {
  answers: Answers;
  model: string;
  tokens: number;
}

// ---------------------------------------------------------------- lore books, dry runs, processes

export interface HostBookEntry {
  id: string;
  bookId: string;
  comment: string;
  content: string;
  keys: string[];
  disabled: boolean;
  constant: boolean;
  /** Host position code (0 = before character, 1 = after, 4 = at depth, …). */
  position: number;
  depth: number;
  role: string | null;
  order: number;
  extensions: JsonObject;
}

export type HostBookEntryInput = Omit<HostBookEntry, "id" | "bookId">;

/** A child lane's message or lifecycle change (`backendProcesses`). */
export interface ProcessEvent {
  processId: string;
  key: string;
  state?: string;
  payload?: unknown;
  error?: string;
}

export interface ProcessHandle {
  processId: string;
  send(payload: unknown): void;
  stop(): Promise<void>;
}

/** A dry-run assembly: the prompt, the preset blocks that assembled, and the final model parameters. */
export interface DryRun {
  messages: { role: string; content: string }[];
  /** Preset blocks in the assembled prompt (enabled ones), resolved, in order. */
  blocks: { id: string | null; name: string; content: string }[];
  /** The final max-tokens parameter, when anything sets one. */
  maxTokens: number | null;
  model: string;
}

// ---------------------------------------------------------------- the port

export interface HostPort {
  chats: {
    messages(chatId: ChatId, userId: UserId): Promise<HostMessage[]>;
    /** Replaces the message's whole `spindle_metadata` bag (host semantics; G2). Callers read-merge-write. */
    writeMetadata(chatId: ChatId, messageId: MessageId, bag: JsonObject, userId: UserId): Promise<void>;
    chatMetadata(chatId: ChatId, userId: UserId): Promise<JsonObject>;
    mergeChatMetadata(chatId: ChatId, patch: JsonObject, userId: UserId): Promise<void>;
    /** Appends a user message, optionally triggering a generation (palette and chip actions). */
    appendUserMessage(chatId: ChatId, content: string, metadata: JsonObject, triggerGeneration: boolean, userId: UserId): Promise<MessageId>;
    /** The chat the user has open, if any (`chats.getActive`). */
    active(userId: UserId): Promise<ChatId | null>;
  };
  storage: {
    read(path: string, userId: UserId): Promise<string | null>;
    write(path: string, data: string, userId: UserId): Promise<void>;
    move(from: string, to: string, userId: UserId): Promise<void>;
    remove(path: string, userId: UserId): Promise<void>;
    /** Every file under the prefix directory, recursively, as full storage paths (`"worlds/w_1/index.json"`). */
    list(prefix: string, userId: UserId): Promise<string[]>;
  };
  on<K extends HostEventName>(event: K, handler: (payload: HostEventMap[K], userId: UserId | null) => void): () => void;
  registerContextHandler(handler: (input: ContextHandlerInput, signal: AbortSignal) => Promise<void>, timeoutMs: number): void;
  registerInterceptor(handler: (input: InterceptorInput) => Promise<InterceptorResult | null>, priority: number): void;
  models: {
    quiet(request: QuietRequest, userId: UserId, signal: AbortSignal): Promise<QuietResult>;
    decide(request: DecideRequest, userId: UserId, signal: AbortSignal): Promise<DecideResult>;
  };
  tokens: {
    /** The host tokenizer's count for each text (the user's main model, as the prompt breakdown counts), or null when it can't count in time. */
    count(texts: readonly string[], userId: UserId): Promise<number[] | null>;
  };
  frontend: {
    send(message: BackendToFrontend, userId: UserId | null, frontendSessionId?: string): void;
    onMessage(handler: (message: unknown, userId: UserId, frontendSessionId?: string) => void): () => void;
    /** `spindle.ui.closeDrawer` (the frontend has no such API; DESIGN §12). */
    closeDrawer(userId: UserId): Promise<void>;
  };
  books: {
    create(name: string, description: string, userId: UserId): Promise<string>;
    exists(bookId: string, userId: UserId): Promise<boolean>;
    entries(bookId: string, userId: UserId): Promise<HostBookEntry[]>;
    createEntry(bookId: string, entry: HostBookEntryInput, userId: UserId): Promise<string>;
    deleteEntry(entryId: string, userId: UserId): Promise<void>;
  };
  /** A dry-run assembly of the chat's next prompt (deliverability check, DESIGN §4.2; the D32 preset lint). */
  dryRun(chatId: ChatId, userId: UserId): Promise<DryRun>;
  presets: {
    /** The preset the chat's prompts assemble with: the default connection's, else the active Loom preset. */
    active(chatId: ChatId, userId: UserId): Promise<{ id: string; name: string } | null>;
  };
  connections: {
    /** The user's default connection: the one a generation without its own route uses. */
    active(userId: UserId): Promise<{ id: string; name: string } | null>;
  };
  processes: {
    spawn(options: { entry: string; kind: string; key: string; payload: JsonValue; userId: UserId }): Promise<ProcessHandle>;
    onMessage(handler: (event: ProcessEvent) => void): () => void;
    onLifecycle(handler: (event: ProcessEvent) => void): () => void;
  };
  /**
   * A log line. With `userId` it concerns that user's chats: the diagnostics mirror keeps it in
   * their own storage, never in the extension-wide file.
   */
  log(level: "info" | "warn" | "error", message: string, userId?: UserId): void;
}
