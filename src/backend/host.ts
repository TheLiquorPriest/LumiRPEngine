// HostPort: the narrow port between the backend and Lumiverse (ARCHITECTURE §2, §8).
//
// Backend logic talks only to this interface. `backend/spindle-host.ts` implements it over the
// `spindle` global and is the only file that touches it; `test/support/fake-host.ts`
// implements it for tests by replaying the event orders recorded from a Lumiverse host (DESIGN §14).
// Shapes mirror the observed payloads: event payloads carry no userId, which the host passes
// as the handler's second argument.

import type { ListedTool } from "../shared/agents";
import type { JsonObject, JsonValue } from "../shared/json";
import type { ReasoningChoice, SamplingParams } from "../shared/settings";
import type { Limit } from "../shared/minds";
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

/** A chat of the user's as the chat list has it: its name and its whole metadata bag (every extension's). */
export interface HostChat {
  id: ChatId;
  name: string;
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

/** A chat deleted (the host sends `{ id }`). */
export interface ChatDeletedEvent {
  chatId: ChatId;
}

/** A preset was written (`PRESET_CHANGED`): its blocks, and so the outlets it places, may differ now. */
export interface PresetChangedEvent {
  presetId: string | null;
}

/** One of the user's Lumiverse settings was written (`SETTINGS_UPDATED`), the active preset among them. */
export interface SettingsUpdatedEvent {
  key: string | null;
}

/** A loaded Lumiverse page of the user's disconnected (`FRONTEND_SESSION_CLOSED`): the session routing named it. */
export interface FrontendSessionClosedEvent {
  frontendSessionId: string;
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
  CHAT_DELETED: ChatDeletedEvent;
  PRESET_CHANGED: PresetChangedEvent;
  SETTINGS_UPDATED: SettingsUpdatedEvent;
  FRONTEND_SESSION_CLOSED: FrontendSessionClosedEvent;
}

export type HostEventName = keyof HostEventMap;

// ---------------------------------------------------------------- hooks

export interface ContextHandlerInput {
  chatId: ChatId;
  userId: UserId;
  /** `other`: a type the engine doesn't play (the host's `quiet`). */
  generationType: HostGenerationType | "other";
  dryRun: boolean;
  connectionId: string | null;
  personaId: string | null;
  frontendSessionId?: string;
}

/** What a context handler tells the host: go on to the prompt, or stop the generation before it (`cancelGeneration`). */
export type ContextVerdict = "go" | "cancel";

/** What the running Lumiverse does with a context handler's answer (DESIGN §5.1). */
export interface HostCapabilities {
  /** `cancelGeneration` stops the generation (the `preAssemblyGenerationContext` contract). */
  cancel: boolean;
  /** A `required` handler that fails or runs out of time stops the generation instead of being skipped (`required-context-handlers-v1`). */
  required: boolean;
  /** Frontend messages name the page they came from, and a send may go to that page alone (`frontend-session-routing-v1`). */
  sessions: boolean;
}

// ---------------------------------------------------------------- model calls

export interface QuietMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface QuietRequest {
  messages: QuietMessage[];
  maxTokens: number;
  json: boolean;
  connectionId: string | null;
  /** Overrides the connection's saved model for this call (a step's route, DESIGN §5.3 Custom). */
  model: string | null;
  /** Tools the model may call instead of answering (lore lookups, DESIGN §5.4); absent: none. */
  tools?: QuietTool[];
  /** How hard the model reasons (a step's or the helper model's effort); absent or `inherit`: the connection's own reasoning settings. */
  effort?: ReasoningChoice;
  /** Sampling parameters by the host's names; each left out is the connection's own (its preset's). */
  params?: SamplingParams;
}

/** A tool a quiet call offers (the host's `ToolSchemaDTO`): its parameters as a JSON Schema. */
export interface QuietTool {
  name: string;
  description: string;
  parameters: JsonObject;
}

/** A tool call the model made (the host's `ToolCallDTO`), its arguments parsed. */
export interface QuietToolCall {
  name: string;
  args: JsonObject;
  callId: string;
}

export interface QuietResult {
  content: string;
  finishReason: string;
  tokens: number;
  /** The prompt's and the answer's tokens, when the provider reports them apart. */
  tokensIn?: number;
  tokensOut?: number;
  /** The model that answered, when the host says. */
  model?: string;
  /** Present when the model called tools; the host has no tool-role messages, so results go back in a user message. */
  toolCalls?: QuietToolCall[];
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

export type HostBookEntryInput = Omit<HostBookEntry, "id" | "bookId"> & {
  /** The `{{outlet::name}}` the entry fills, kept in its `extensions.outlet_name`; none when absent. */
  outlet?: string | null;
};

/** Where an entry sits in the prompt. The host keeps the outlet beside the extension data, so reading an entry back doesn't show it. */
export interface HostEntryPlacement {
  /** Host position code (0 = before character, 4 = at depth, 8 = only at its outlet, …). */
  position: number;
  depth: number;
  role: "system" | "user" | "assistant";
  /** Null takes the entry out of any outlet. */
  outlet: string | null;
}

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

/** A preset prompt block as the engine reads it (`presets.blocks`). */
export interface HostPresetBlock {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  /** `"category"` for a category header, another marker for a structural block, else null. */
  marker: string | null;
  /** The generation types the block assembles for; empty for every one. */
  injectionTrigger: string[];
  /** The character tags the block assembles for (any one of them); empty for every character. */
  characterTagTrigger: string[];
  /** On a category header: `radio` keeps only the first switched-on block under it, `checkbox` each one. */
  categoryMode: "radio" | "checkbox" | null;
}

/** A block the engine adds to a preset: a category header, or text that stays switched off. */
export type HostPresetBlockInput = { kind: "category"; name: string } | { kind: "text"; name: string; content: string };

// ---------------------------------------------------------------- regex scripts

/** A regex script of the user's (`regex_scripts`), scoped to a chat or global, as the backend reads one. */
export interface HostRegexScript {
  id: string;
  /** The chat it is scoped to; null for a global one. */
  chatId: ChatId | null;
  /** This extension created it, so it may change or delete it (the host's `can_mutate`). */
  mine: boolean;
  findRegex: string;
  replaceString: string;
  flags: string;
  placement: string[];
  /** Where it runs; one script may run on several targets. */
  targets: string[];
  runOnEdit: boolean;
  /** Lower runs earlier: on display among every script, elsewhere within its scope (global ones before a chat's). */
  sortOrder: number;
  metadata: JsonObject;
}

/** A script the backend writes, scoped to a chat, or global with `chatId` null. Its capture references are the host's (`$&`, `$1`), with no macros. */
export interface HostRegexScriptInput {
  name: string;
  /** Stable and unique per user: the host refuses a second script with the same one. */
  scriptId: string;
  chatId: ChatId | null;
  findRegex: string;
  replaceString: string;
  flags: string;
  placement: "ai_output"[];
  targets: ("response" | "display" | "prompt")[];
  runOnEdit: boolean;
  sortOrder: number;
  description: string;
  folder: string;
  metadata: JsonObject;
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
    /** Every chat of the user's, most recently updated first (`chats.list`, paged through). */
    list(userId: UserId): Promise<HostChat[]>;
    /** Rewrites a message's swipes and the one shown (`chat.updateMessage`); the host keeps the swipe dates in step. */
    setSwipes(chatId: ChatId, messageId: MessageId, swipes: readonly string[], swipeId: number, userId: UserId): Promise<void>;
  };
  storage: {
    read(path: string, userId: UserId): Promise<string | null>;
    write(path: string, data: string, userId: UserId): Promise<void>;
    move(from: string, to: string, userId: UserId): Promise<void>;
    remove(path: string, userId: UserId): Promise<void>;
    /** Every file under the prefix directory, recursively, as full storage paths (`"worlds/w_1/index.json"`). */
    list(prefix: string, userId: UserId): Promise<string[]>;
  };
  /** The extension's own storage (`spindle.storage`), shared by every user: only what is no one's, such as the build it last started as. */
  extensionStorage: {
    read(path: string): Promise<string | null>;
    write(path: string, data: string): Promise<void>;
  };
  on<K extends HostEventName>(event: K, handler: (payload: HostEventMap[K], userId: UserId | null) => void): () => void;
  /** What the host does with the context handler's answer, read once at start. */
  readonly capabilities: HostCapabilities;
  /** The one context handler (the guard, DESIGN §5.1): `required` asks the host to stop the generation when it fails or runs out of time. */
  registerContextHandler(handler: (input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict>, options: { timeoutMs: number; required: boolean }): void;
  models: {
    quiet(request: QuietRequest, userId: UserId, signal: AbortSignal): Promise<QuietResult>;
    decide(request: DecideRequest, userId: UserId, signal: AbortSignal): Promise<DecideResult>;
  };
  tokens: {
    /** The host tokenizer's count for each text (the user's main model, as the prompt breakdown counts), or null when it can't count; rejects with a `TimeoutFired` when counting takes longer than `limit` (Settings → Timeouts → Token counts). */
    count(texts: readonly string[], userId: UserId, limit: Limit): Promise<number[] | null>;
  };
  frontend: {
    send(message: BackendToFrontend, userId: UserId | null, frontendSessionId?: string): void;
    onMessage(handler: (message: unknown, userId: UserId, frontendSessionId?: string) => void): () => void;
    /** `spindle.ui.closeDrawer` (the frontend has no such API; DESIGN §12). */
    closeDrawer(userId: UserId): Promise<void>;
  };
  /** A toast on the user's open pages (`spindle.toast.info`), titled LumiRPEngine. */
  toast(message: string, userId: UserId): void;
  books: {
    create(name: string, description: string, userId: UserId): Promise<string>;
    exists(bookId: string, userId: UserId): Promise<boolean>;
    /** Every World Info book of the user's (`world_books.list`, paged through); `engine`: one the engine made for a world. */
    list(userId: UserId): Promise<{ id: string; name: string; engine: boolean }[]>;
    entries(bookId: string, userId: UserId): Promise<HostBookEntry[]>;
    /** One entry by id (`world_books.entries.get`), or null when it is gone. */
    entry(entryId: string, userId: UserId): Promise<HostBookEntry | null>;
    createEntry(bookId: string, entry: HostBookEntryInput, userId: UserId): Promise<string>;
    /** Moves an entry (its position, depth, role and outlet) and rewrites its extension data. */
    place(entryId: string, placement: HostEntryPlacement, extensions: JsonObject, userId: UserId): Promise<void>;
    /** Fills an entry and switches it on as a constant one, or with null empties it and switches it off; where it sits stays. */
    fill(entryId: string, content: string | null, userId: UserId): Promise<void>;
    deleteEntry(entryId: string, userId: UserId): Promise<void>;
  };
  /** A dry-run assembly of the chat's next prompt (deliverability check, DESIGN §4.2; the D32 preset lint). */
  dryRun(chatId: ChatId, userId: UserId): Promise<DryRun>;
  presets: {
    /** A preset with its revision (each change to it bumps it); null when there's no such preset. */
    get(presetId: string, userId: UserId): Promise<{ id: string; name: string; revision: number } | null>;
    /** The preset a connection links, if it links one. */
    ofConnection(connectionId: string, userId: UserId): Promise<string | null>;
    /** The preset the chat's last reply was assembled with, when the host kept its breakdown. */
    lastUsed(chatId: ChatId, userId: UserId): Promise<string | null>;
    /** The preset's blocks, in order. */
    blocks(presetId: string, userId: UserId): Promise<HostPresetBlock[]>;
    /** Inserts blocks at `at` (null: the end) in one write of the preset's stored blocks as they are, while it is still at `revision`. */
    insertBlocks(presetId: string, revision: number, at: number | null, blocks: readonly HostPresetBlockInput[], userId: UserId): Promise<void>;
  };
  connections: {
    /** The user's default connection: the one a generation without its own route uses. */
    active(userId: UserId): Promise<{ id: string; name: string } | null>;
  };
  /**
   * Lumiverse's MCP server profiles (`spindle.mcp.servers`, the `mcp_servers` permission; DESIGN §23,
   * G13), read to find the ones that run lumirpengine. Nothing here creates, changes or connects one.
   */
  mcp: {
    /** Whether `mcp_servers` is granted now. */
    granted(): boolean;
    /** The user's stdio profiles, each by its id and name: nothing else of a profile is kept. */
    stdioProfiles(userId: UserId): Promise<{ id: string; name: string }[]>;
    /** Whether Lumiverse's client is connected to the profile, and the tools it holds for it, as the server listed them. */
    status(profileId: string, userId: UserId): Promise<{ connected: boolean; tools: ListedTool[] }>;
  };
  regex: {
    /** Chat-scoped scripts: one chat's, or with null every chat's. */
    chatScripts(chatId: ChatId | null, userId: UserId): Promise<HostRegexScript[]>;
    /** Global scripts. */
    globalScripts(userId: UserId): Promise<HostRegexScript[]>;
    /** Writes a script: a new one when `id` is null, else `id`'s definition (whether it is switched on stays the user's). Its id. */
    write(id: string | null, script: HostRegexScriptInput, userId: UserId): Promise<string>;
    remove(id: string, userId: UserId): Promise<void>;
  };
  processes: {
    /** `startupMs` and `heartbeatMs`: how long Lumiverse waits for the process to start and between its heartbeats, already within its limits (`HOST_LIMITS`; a heartbeat of 0 checks none). */
    spawn(options: { entry: string; kind: string; key: string; payload: JsonValue; userId: UserId; startupMs: number; heartbeatMs: number }): Promise<ProcessHandle>;
    onMessage(handler: (event: ProcessEvent) => void): () => void;
    onLifecycle(handler: (event: ProcessEvent) => void): () => void;
  };
  /**
   * The shared RPC pool (`spindle.rpcPool`, DESIGN §15). A read carries no request and no user,
   * so this extension serves per-user endpoints and reads another's the same way.
   */
  rpc: {
    /**
     * Serves `<this extension>.<channel>` on demand, replacing what was there. The handler learns
     * which extension reads; `requires` is the read policy (the permissions both sides must hold,
     * and the only ones the handler's calls may use). What it returns is structured-cloned to the
     * reader, so it may hand over a cached document.
     */
    handle(channel: string, requires: readonly string[], handler: (requester: string) => Promise<unknown>): void;
    unregister(channel: string): void;
    /** Reads another extension's `<extension>.<channel>`; rejects when nothing is registered there or its handler throws. */
    read(endpoint: string): Promise<unknown>;
  };
  /**
   * A log line. With `userId` it concerns that user's chats: the diagnostics mirror keeps it in
   * their own storage, never in the extension-wide file. `turn` (a generation id) tags the line with
   * the turn it belongs to. `debug` lines go to the mirror only.
   */
  log(level: "debug" | "info" | "warn" | "error", message: string, userId?: UserId, turn?: string): void;
}
