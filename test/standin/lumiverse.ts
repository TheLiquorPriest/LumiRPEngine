// A stand-in Lumiverse for tests: enough of the host and of Spindle's backend API to run the light
// extension (`src/ext`) against RPE's adapter (`src/adapter`) end to end, with no Lumiverse and no
// server. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; what is
// its own (assembling the prompt, activating lore, counting tokens) says so. Paths are Lumiverse's
// `src/`. It is cut along Lumiverse's own areas: the extension host with its interceptor pipeline, its
// proxy and the network (`host.ts`); the chats, their rows and the events of each write (`rows.ts`);
// the World Info chain and activation (`lore.ts`); the prompt's assembly (`assembly.ts`). This file is
// the generation that runs through them all, and the chat connections and presets it reads.

import { assemble, type BreakdownEntry, type Ending, type GenerationType, type Preset } from "./assembly";
import { collectWorldInfoSources, type Character } from "./books";
import { cortexConfigOf, cortexEnabledForChat, type ContextClipStats, type MessageLimit } from "./history";
import { activateLore, DEFAULT_EMBEDDING_SETTINGS, normalizeWorldInfoSettings, worldInfoChain, worldInfoContext, type ActivatedWorldInfoEntry, type Activation, type EmbeddingSettings, type Entry, type VectorSearch, type WiState, type WorldInfoSettings } from "./lore";
import { Databanks, Memory } from "./memory";
import { ChatRows, indexInChat, type Chat, type ChatMessage, type Stored } from "./rows";
import { GenerationRegistry, InferenceAdmission, TEARDOWN_WAIT_MS, type ActiveGeneration } from "./registry";
import { applyPostProcessing, buildBody, collapse, dropBlank, providerHeaders, readStream, readWhole, textOf, type LlmMessage, type StreamSeen, type StreamedReply } from "./steps";
import { normalizeStoredExtra, SWIPE_SCOPED_EXTRA_KEYS } from "./extra";
import { StreamFrames } from "./frames";
import { extractDelimitedReasoning, finishedText, partialText, resolveMacros, resolveReasoningDelimiters, type ResponseScript, type TextSettings } from "./save";
import { resolveGenerationTokenCounts, timingMetrics, type Timing } from "./metrics";

export type { Chat, ChatMessage } from "./rows";
export type { Installed } from "./host";
export type { Preset } from "./assembly";

export interface Connection {
  id: string;
  /** The connection's address; Lumiverse posts to `<base>/chat/completions`. */
  base: string;
  key: string;
  model: string;
  /** Its name, which a failed generation's end event carries (`connectionName`, `services/generate.service.ts:630-647`). */
  name?: string;
  /** Its provider (`connection.provider`): a DeepSeek or Moonshot connection is sent the preset's reasoning prefill (`services/prompt-assembly.service.ts:4164-4181`). */
  provider?: string;
  /** The user's default connection (`is_default`, `getDefaultConnection`, `services/connections.service.ts:336-339`): what a request that names none and has no selection falls to. */
  isDefault?: boolean;
  /** Its own record: a "Start Reply With" bound to it stands in place of the user's, an empty one too (`services/prompt-assembly.service.ts:4130-4137`). */
  metadata?: { reasoningBindings?: { promptBias?: string } };
}

export interface GenerateInput {
  chat: string;
  /**
   * The connection the caller names (`connection_id`, `services/generate.service.ts:1731-1735`): the composer sends the user's selected one. Left out, what Lumiverse does
   * with none: the user's selection, else the default connection, else the first of his. The chat's pin comes before either (`resolveChatGenerationConnection`).
   */
  connection?: string;
  preset: string;
  type?: GenerationType;
  dryRun?: boolean;
  persona?: string;
  parameters?: Record<string, unknown>;
  /** An impersonation kept as a draft for the input box, saving no message (`impersonate_draft`, `services/generate.service.ts:1905`, `:4172-4175`). */
  impersonateDraft?: boolean;
  /**
   * The message a continue goes on, as the caller names it (`message_id`, `services/generate.service.ts:1809-1814`). Left out, it is
   * what Lumiverse's own page names: the chat's last message when that is not the user's (`frontend/src/components/chat/InputArea.tsx:2238-2250`).
   */
  message?: string;
  /**
   * The character a group chat's generation is for (`target_character_id`, `services/generate.service.ts:1830-1836`): taken only where the chat is a group and the
   * character one of its members. A regenerate, a swipe or a continue is for the one who spoke its message before this.
   */
  targetCharacter?: string;
  /**
   * A background swipe (`background_swipe`, `services/generate.service.ts:1587-1600`): a swipe or a regenerate that leaves the swipe the reader has selected. It is
   * refused for any other kind ("background_swipe requires an assistant swipe target"), for a target that is not an assistant's of the chat ("Invalid background swipe
   * target") and while the chat has a generation running ("A generation is already running for this chat", `:1608`).
   */
  backgroundSwipe?: boolean;
  /** What the player typed before an impersonation (`impersonate_input`, `services/generate.service.ts:2773-2774`), and the mode he chose (`impersonate_mode`, absent: "prompts", `:2769-2772`). */
  impersonateInput?: string;
  impersonateMode?: "prompts" | "oneliner";
  /** The feedback of a regenerate (`regen_feedback`, `regen_feedback_position`, `regen_feedback_format`, `services/generate.service.ts:257-259`): what he typed, where it goes and its format. */
  regenFeedback?: { text: string; position: "system" | "user"; format?: string };
}

export interface Outcome {
  /** Null for a dry run, which announces none. */
  generationId: string | null;
  /** The message the reply was saved in, or kept in when it failed or was stopped; absent where none was. */
  messageId?: string;
  /** The generation's error, as Lumiverse ends it with one. */
  error: string | null;
  /** The user stopped it (`POST /api/v1/generate/stop`): what was streamed until then is saved, and is `reply`'s text. */
  stopped: boolean;
  /** The prompt as Lumiverse finished it, after its interceptors, post-processing, the blank filter and collapse. */
  prompt: LlmMessage[];
  /** The request body sent to the connection; null when none was sent. */
  body: Record<string, unknown> | null;
  reply: StreamedReply | null;
  /** The generation's parameters as Lumiverse merged them, the interceptors' among them; null when it failed before. */
  parameters: Record<string, unknown> | null;
  stored: Stored | null;
  /**
   * The World Info chain: how long it took, and the entries as it left them; how each entry that activated did, as Lumiverse works it out and
   * does not tell; and the statistics its assembly makes of the activation (`worldInfoStats`, `services/prompt-assembly.service.ts:2563-2597`),
   * which a dry run reports and the event of a generation's lore carries.
   */
  worldInfo: { ms: number; entries: Entry[]; activated: Activation[]; stats: Record<string, unknown> };
  /**
   * A dry run's: the breakdown its assembly made, the chat history's entry left out (`services/generate.service.ts:3255`); its
   * interceptors add none. Absent for a generation, whose breakdown is the one Lumiverse stores beside the reply (`stored`).
   */
  breakdown?: BreakdownEntry[];
  /** What the clipping to the preset's context size and the context anchor did (`contextClipStats`, `services/prompt-assembly.service.ts:4351-4358`); a dry run reports it too. Absent where the prompt was never assembled. */
  contextClipStats?: ContextClipStats;
}

export class StandIn extends ChatRows {
  readonly connections = new Map<string, Connection>();
  /** The connection the user has selected (the `activeProfileId` setting, `services/connections.service.ts:373-384`): what the composer sends as `connection_id` with each of his requests. */
  activeConnection: string | undefined;
  /** The chunks and consolidations of the chats' memory, and the databanks and documents a `#mention` reads; set `db` before adding any (`memory.ts`). */
  readonly memory = new Memory(() => this.db, () => this.now());
  readonly databanks = new Databanks(() => this.db, () => this.now());
  readonly presets = new Map<string, Preset>();
  /** What each generation's stream has shown the player so far, its reply and its thinking, by generation (the streaming bubble). */
  readonly streams = new Map<string, StreamSeen>();
  /** The user's `promptPostProcessing` setting (`services/generate.service.ts:1250-1256`). */
  postProcessing = "";
  /** The user's "Start Reply With" setting (`promptBias`, `services/prompt-assembly.service.ts:4134-4137`). */
  promptBias = "";
  /**
   * The council's deliberation, when the council is on and the preset does not place it by macro:
   * Lumiverse splices it into the prompt after its interceptors, four messages from the end
   * (`services/generate.service.ts:2881-2893`), so no interceptor ever sees it.
   */
  councilBlock: string | null = null;
  /** The user's `worldInfoSettings` (`services/prompt-assembly.service.ts:2273-2280`): Lumiverse's defaults where unset. */
  worldInfoSettings: Partial<WorldInfoSettings> = {};
  /**
   * The books of the chat's active multiplayer peers' personas, relayed to this instance (`multiplayerWorldInfoProvider`,
   * `services/prompt-assembly.service.ts:2262-2271`): after the books the chat reads, their entries of any user's join the chain and activate,
   * their books attached as "peer" and, as Lumiverse names none of them, with no name.
   */
  readonly peerBooks = new Set<string>();
  /** The vector search a test scripts; null, no embeddings connection, as on the test bed, and no entry activates by vector. */
  vectorSearch: VectorSearch | null = null;
  /** The user's embeddings settings the ranking reads. */
  embeddingSettings: EmbeddingSettings = DEFAULT_EMBEDDING_SETTINGS;
  /** The draws of a probability or a group (`Math.random` in Lumiverse); a test may give its own. */
  random: () => number = Math.random;
  /** The generations going on, with what stops each, and the idle sweep that ends a silent one (`services/generation/active-generation-registry.ts`; `registry.ts`). */
  readonly registry = new GenerationRegistry(() => this.clock);
  /** The inference scheduler's admission of a provider call: off, as Lumiverse's default, unless a test sets its concurrency (`registry.ts`). */
  readonly inference = new InferenceAdmission();
  /** The user's response scripts (`target: "response"`, `services/generate.service.ts:4106-4116`): the stand-in's own small kind, a regular expression and its replacement (`save.ts`). */
  regexScripts: ResponseScript[] = [];
  /** True where the tokenizer throws, as it can: a reply is saved and ended, and no breakdown is stored for it (`services/generate.service.ts:4432-4497`). */
  tokenizerFails = false;
  /** The models its tokenizer knows (`countForModel`, `services/tokenizer.service.ts`): a reply's token count is worked out only for these, else only the provider's own count is used. Counts are the stand-in's own, a quarter of the characters. */
  readonly tokenizedModels = new Set<string>();

  /**
   * `POST /api/v1/generate/stop` (`routes/generate.routes.ts:45-65`): the generation named (a stale id falls back to the chat's when the chat is given), else the chat's, else
   * every one of the user's; whether any was.
   */
  stop(user: string, ask: { generation?: string; chat?: string }): boolean {
    if (ask.generation !== undefined) {
      const stopped = this.registry.stopGeneration(user, ask.generation);
      return !stopped && ask.chat !== undefined ? this.registry.stopChat(user, ask.chat) : stopped;
    }
    if (ask.chat !== undefined) return this.registry.stopChat(user, ask.chat);
    this.registry.stopUser(user);
    return true;
  }

  /** A message by its id among the user's own, whichever chat holds it (`getMessage`, `services/chats.service.ts:2356-2360`). */
  private holding(user: string, id: string): { chat: Chat; message: ChatMessage } | undefined {
    for (const chat of this.chats.values()) {
      if (chat.user !== user) continue;
      const message = chat.messages.find((m) => m.id === id);
      if (message !== undefined) return { chat, message };
    }
    return undefined;
  }

  /** The chat's last message that is not the user's, by its place, hidden ones and an extension's system messages included (`getLastAssistantMessage`, `services/chats.service.ts:2066-2072`: `is_user = 0`). */
  private lastNonUser(chat: Chat): { chat: Chat; message: ChatMessage } | undefined {
    const message = chat.messages.findLast((m) => m.role !== "user");
    return message === undefined ? undefined : { chat, message };
  }

  /** The user's act of switching the composer's connection: his later requests name it, and a chat pinned to another connection keeps its pin. */
  switchConnection(id: string): void {
    if (!this.connections.has(id)) throw new Error("the stand-in has no such connection");
    this.activeConnection = id;
  }

  /**
   * `resolveChatGenerationConnection` (`services/generation/connection-resolution.ts:29-91`), for a request of the user's own: the chat's pin (`connection_profile_id`, with the model
   * it pins, `connection_model`) while it names a connection that exists; else the connection the request names, or with none his selection or the default; else, with none named,
   * his selection, the default or the first he has (`resolveActingConnectionId`, `services/connections.service.ts:405-409`). A model roulette and an Edit-and-Send request are not modelled.
   */
  private connectionFor(chat: Chat, requested: string | undefined): Connection {
    const metadata = this.metadataOf(chat);
    const asked = requested?.trim() || undefined;
    const pin = typeof metadata.connection_profile_id === "string" ? metadata.connection_profile_id.trim() : "";
    const pinned = pin !== "" ? this.connections.get(pin) : undefined;
    const active = this.activeConnection !== undefined && this.connections.has(this.activeConnection) ? this.activeConnection : undefined;
    const standing = [...this.connections.values()].find((c) => c.isDefault === true);
    const named = (id: string | undefined): Connection | undefined => (id === undefined ? standing : this.connections.get(id));
    const found = pinned ?? named(asked ?? active) ?? (asked !== undefined ? undefined : named(active ?? standing?.id ?? this.connections.keys().next().value));
    if (found === undefined) throw new Error("No connection profile found. Configure a default connection or select one for this chat.");
    const model = pinned !== undefined && typeof metadata.connection_model === "string" ? metadata.connection_model.trim() : "";
    return model !== "" ? { ...found, model } : found;
  }

  /**
   * One generation, or a dry run: as `startGeneration` (`services/generate.service.ts:1546-3073`) and `dryRunGeneration` (`:3080-3274`) order it. The prompt itself is
   * assembled the stand-in's own way (`assembly.ts`). A generation takes its chat before anything is staged (`takeChat`); a dry run takes none.
   */
  async generate(input: GenerateInput, started?: (generationId: string | null) => void): Promise<Outcome> {
    const chat = this.chats.get(input.chat);
    const preset = this.presets.get(input.preset);
    if (!chat || !preset) throw new Error("the stand-in has no such chat or preset");
    const connection = this.connectionFor(chat, input.connection);
    // Every message the stand-in holds has its stored number from here on (`ChatRows.numbered`).
    this.numbered(chat);
    if (input.dryRun === true) return await this.run(input, chat, connection, preset, null, started);
    const taken = await this.takeChat(input, chat);
    try {
      return await this.run(input, chat, connection, preset, taken.live, started);
    } finally {
      // Out of the registry after its last event, the chat's lock given up where it is still its own, and a newer generation of the chat let go
      // (`services/generate.service.ts:3050`, `:3067-3069`, `:4579-4586`).
      this.registry.remove(taken.live.id);
      this.registry.clearChat(chat.user, chat.id, taken.live.id);
      taken.done();
    }
  }

  /**
   * One generation of a chat at a time (`services/generate.service.ts:1585-1660`): a background swipe needs an assistant swipe target (`:1592-1600`) and is refused while
   * the chat has a generation (`:1608`); any other stops the one running and waits for its teardown, up to two seconds on the host's clock, before it takes the chat
   * (`:1609-1630`). The generation is then registered, its last text time its start (`:1632-1651`).
   */
  private async takeChat(input: GenerateInput, chat: Chat): Promise<{ live: ActiveGeneration; done: () => void }> {
    const type = input.type ?? "normal";
    const backgroundSwipe = input.backgroundSwipe === true;
    if (backgroundSwipe && type !== "swipe" && type !== "regenerate") throw new Error("background_swipe requires an assistant swipe target");
    if (backgroundSwipe) {
      const target = input.message === undefined ? chat.messages.findLast((m) => m.role !== "user") : chat.messages.find((m) => m.id === input.message);
      if (target === undefined || target.role === "user") throw new Error("Invalid background swipe target");
    }
    const running = this.registry.chatGeneration(chat.user, chat.id);
    if (backgroundSwipe && running !== undefined) throw new Error("A generation is already running for this chat");
    if (running !== undefined) {
      const existing = this.registry.get(running);
      if (existing !== undefined) {
        existing.stop.abort();
        const patience = Promise.withResolvers<void>();
        const timer = this.clock.setTimeout(patience.resolve, TEARDOWN_WAIT_MS);
        await Promise.race([existing.completion, patience.promise]);
        this.clock.clearTimeout(timer);
      }
      this.registry.remove(running);
      this.registry.clearChat(chat.user, chat.id, running);
    }
    const finished = Promise.withResolvers<void>();
    const now = this.clock.now();
    const live: ActiveGeneration = { id: crypto.randomUUID(), user: chat.user, chat: chat.id, stop: new AbortController(), startedAt: now, lastTokenAt: now, waitingForInference: false, completion: finished.promise };
    this.registry.register(live);
    return { live, done: finished.resolve };
  }

  private async run(input: GenerateInput, chat: Chat, connection: Connection, preset: Preset, live: ActiveGeneration | null, started?: (generationId: string | null) => void): Promise<Outcome> {
    const type = input.type ?? "normal";
    const dryRun = live === null;
    const generationId = live === null ? null : live.id;
    // The user's generating session, named when the generation is started (`getActiveFrontendSession`, `services/generate.service.ts:1550`, `:3090`): the newest frontend session that is not a widget's.
    const frontendSessionId = this.activeFrontendSession(chat.user);
    const backgroundSwipe = !dryRun && input.backgroundSwipe === true;
    let target: { message: string | null; swipe: number | null } = { message: null, swipe: null };
    /** The chat that holds the message a swipe, a regenerate or a continue goes on: the message named may be in another of the user's chats (`getMessage`, `services/chats.service.ts:2356-2360`). */
    let home = chat;
    let excluded: string | null = null;
    let staged: string | null = null;
    /** A swipe or a regenerate: the swipe made for the reply. */
    let swipeAt: number | null = null;
    /** A continue: the message it goes on, the text that message held, and what joins the new text to it. */
    let goesOn: ChatMessage | null = null;
    let original: string | null = null;
    let postfix = "";
    const stop = live?.stop ?? new AbortController();
    if (type === "continue") {
      // The message named, else the chat's last non-user message by its place, hidden ones included (`services/generate.service.ts:1809-1813`,
      // `services/chats.service.ts:2066-2072`); a generation never goes on a user's (`:1814`), where a dry run does not ask (`:3150-3155`). A
      // message named from another of the user's chats is found as well (`getMessage`), and continued in the chat that holds it, with nothing moved in this one's history.
      const last = chat.messages.at(-1);
      const named = input.message ?? (last !== undefined && last.role !== "user" ? last.id : undefined);
      const found = named === undefined ? this.lastNonUser(chat) : this.holding(chat.user, named);
      goesOn = found === undefined || (found.message.role === "user" && !dryRun) ? null : found.message;
      if (found !== undefined && goesOn !== null) home = found.chat;
      if (goesOn !== null) {
        original = goesOn.content;
        // The preset's postfix, none where it has none, and none where the text already ends with it (`:1969-1978`,
        // `prompt-assembly.service.ts:662-670`): the same one goes on the message in the prompt and into the saved join.
        const configured = preset.continuePostfix ?? "";
        postfix = configured === "" || original.endsWith(configured) ? "" : configured;
      }
    }
    // The speaker (`services/generate.service.ts:1795-1860`; a dry run `:3100-3112`): a group chat's generation names the member it is for; a regenerate, a swipe or a
    // continue is for the one who spoke the message it is on, else the one named; any other, the one named, else the one of the message; none of them, the chat's own
    // character. Only a member of the group is named, and only in a group chat. A dry run asks no message.
    const groupMetadata = this.metadataOf(chat);
    const members = groupMetadata.group === true && Array.isArray(groupMetadata.character_ids) ? (groupMetadata.character_ids as string[]) : [];
    // The message a swipe or a regenerate is for: the one named, found among the user's own whichever chat holds it, else this chat's last assistant message (`:1597-1599`, `:1700-1702`); never a user's.
    const swipeFound = input.message === undefined ? this.lastNonUser(chat) : this.holding(chat.user, input.message);
    const swipeTarget = swipeFound !== undefined && swipeFound.message.role !== "user" ? swipeFound.message : undefined;
    if ((type === "swipe" || type === "regenerate") && swipeTarget !== undefined && swipeFound !== undefined) home = swipeFound.chat;
    const requested = input.targetCharacter !== undefined && members.includes(input.targetCharacter) ? input.targetCharacter : undefined;
    const spoke = dryRun ? undefined : type === "continue" ? goesOn?.characterId : type === "swipe" || type === "regenerate" ? swipeTarget?.characterId : undefined;
    const inferred = spoke !== undefined && members.includes(spoke) ? spoke : undefined;
    // The member the generation is aimed at, before the chat's own character stands in (`pipelineTargetCharId`, `:1853`): what the nudges read.
    const aimedAt = (type === "swipe" || type === "regenerate" || type === "continue" ? inferred || requested : requested || inferred) || undefined;
    const speakerId = aimedAt ?? chat.character.id;
    const speakerCard = this.library.charactersByIds(chat.user, [speakerId]).get(speakerId);
    const speakerName = speakerCard === undefined ? "Assistant" : effectiveName(speakerCard);
    if (!dryRun) {
      if (type === "normal") {
        // A new reply's message is made empty before the prompt, and left out of it (`:1988-2006`).
        staged = crypto.randomUUID();
        const m: ChatMessage = { id: staged, role: "assistant", content: "", characterId: speakerId };
        chat.messages.push(m);
        this.createRow(chat, m, speakerName);
        // The staged reply is told as a message sent, before the generation is announced (`services/chats.service.ts:2675`; `services/generate.service.ts:1988-2002`).
        this.emit("MESSAGE_SENT", { chatId: chat.id, message: this.messageRow(staged) ?? m }, chat.user);
        target = { message: staged, swipe: 0 };
        excluded = staged;
      } else if (type === "swipe" || type === "regenerate") {
        // The reply being replaced gets a new empty swipe, shown, and is left out of the prompt (`:1699-1720`, `prompt-assembly.service.ts:1900-1904`).
        const last = swipeTarget;
        if (last) {
          // A background swipe leaves the swipe the reader has selected (`:1716`, `:1936`; `chats.service.ts:3301-3344`).
          swipeAt = this.addSwipeRow(home, last.id, "", !backgroundSwipe) ?? (last.swipeId ?? 0) + 1;
          if (!backgroundSwipe) last.swipeId = swipeAt;
          target = { message: last.id, swipe: swipeAt };
          excluded = last.id;
        }
      } else if (type === "continue" && goesOn !== null) {
        target = { message: goesOn.id, swipe: goesOn.swipeId ?? 0 };
      }
      // Registered by `takeChat`, before anything was staged.
      // Announced before the prompt is assembled (`:2036-2055`), and the assembly starts on a later task (`:2068-2073`, `:1059`). A continue
      // names the swipe it goes on, the one its message shows, and no message (`:1962-1968`): only a swipe, a regenerate and a new reply's
      // staged message set `targetMessageId` (`:1928-1938`, `:1988-2006`). What none set, an impersonation's both, is left unset.
      this.emit("GENERATION_STARTED", { generationId, chatId: chat.id, model: connection.model, targetMessageId: type === "continue" ? undefined : (target.message ?? undefined), targetSwipeId: target.swipe ?? undefined, backgroundSwipe, characterId: speakerId, characterName: speakerName, generationType: type, frontendSessionId }, chat.user);
    }
    started?.(generationId);
    // Setup stops where Lumiverse's own checks are (`checkAborted`, `services/generate.service.ts:1721-1731`, `:2309`, `:2960`): a stop that comes while it waits
    // ends the generation there, as a stop, before the provider is called.
    const checkAborted = (): void => {
      if (stop.signal.aborted) throw stop.signal.reason ?? new DOMException("Aborted", "AbortError");
    };
    // Two later tasks, as the continuation and the pipeline each wait for one.
    for (let i = 0; i < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const messages = chat.messages.filter((m) => m.id !== excluded);
    // The persona the generation is made for, none for a temporary chat (`:1923-1937`); his name is the one `namesBehavior` writes for his lines and `{{user}}` stands for, else Lumiverse's own
    // (`services/prompt-assembly.service.ts:7186-7189`); the character's is the speaker's, its alternate name where its card gives one (`:7192-7195`).
    const persona = this.metadataOf(chat).temporary === true ? null : this.library.persona(chat.user, input.persona);
    const names = { user: persona?.name ?? "User", character: speakerName };
    let sent: LlmMessage[] = [];
    let body: Record<string, unknown> | null = null;
    let worldInfo: Outcome["worldInfo"] = { ms: 0, entries: [], activated: [], stats: {} };
    let contextClipStats: ContextClipStats | undefined;
    try {
      checkAborted();
      // ---- the extensions' context handlers, first in the pipeline (`generate.service.ts:1063-1083`): what they give back is the
      // context, the frontend session put back; one that asks to cancel stops the generation.
      let context: Record<string, unknown> = { frontendSessionId, chatId: chat.id, connectionId: connection.id, personaId: input.persona, generationType: type, dryRun, userId: chat.user };
      if (this.contextHandlers.length > 0) {
        const handled = await this.contextHandlerChain(context, chat.user);
        if (handled) context = { ...(handled as Record<string, unknown>), frontendSessionId };
        if (context.cancelGeneration === true) throw new CancelledByExtension();
      }
      checkAborted();
      // The speaker's card is read when the assembly starts (`:1922-1932`), once the context handlers are through.
      if (speakerCard === undefined) throw new Error("Character not found");

      // ---- lore (`prompt-assembly.service.ts:2242-2597`): the books the chat reads, from their places and as their rows stand now
      // (`:2243-2271`); the chain before activation, over entries of every one (`:2282-2326`); then activation over the chat's own counts
      // (`:2272`), which change in place and are saved after the interceptors, and, for an extension that asked for it, over the
      // entries as they stood before the chain (`:2327-2561`).
      const wiStarted = this.clock.now();
      const metadata = this.metadataOf(chat);
      const speaker = speakerCard;
      const globalBooks = (this.library.setting(chat.user, "globalWorldBooks") as string[] | undefined) ?? [];
      const chatBooks = (metadata.chat_world_book_ids as string[] | undefined) ?? [];
      const sources = collectWorldInfoSources(this.library, chat.user, speaker, persona, globalBooks, chatBooks, metadata);
      let wiEntries = sources.entries;
      if (this.peerBooks.size > 0) {
        const peers = this.library.entriesForBooks(null, [...this.peerBooks], new Map());
        for (const id of this.peerBooks) {
          wiEntries = wiEntries.concat(peers.get(id) ?? []);
          sources.bookSourceMap.set(id, "peer");
        }
      }
      const configured = (this.library.setting(chat.user, "worldInfoSettings") as Partial<WorldInfoSettings> | undefined) ?? this.worldInfoSettings;
      const normalized = normalizeWorldInfoSettings(configured);
      const chain = await worldInfoChain(this.worldInfo, wiEntries, worldInfoContext(chat, messages, { userId: chat.user, metadata, characterId: speaker.id, activationSettings: { globalScanDepth: normalized.globalScanDepth, maxRecursionPasses: normalized.maxRecursionPasses } }), chat.user, sources.bookSourceMap, { clock: this.clock, log: this.log });
      for (const [book, source] of chain.additionalBookSources) sources.bookSourceMap.set(book, source);
      const wiMs = this.clock.now() - wiStarted;
      checkAborted();
      const activation = { ...normalized, maxRecursionPasses: chain.activationOverrides.disableRecursion === true ? 0 : normalized.maxRecursionPasses };
      const wiState = structuredClone((metadata.wi_state ?? {}) as WiState);
      // The raw view is activated over a copy of the counts as they were before the real one changes them (`:2331-2332`).
      const hasCaptureRequests = chain.captureRequests.size > 0;
      const captureWiState = [...chain.captureRequests.values()].some((ids) => ids.size > 0) ? structuredClone(wiState) : null;
      const lore = activateLore({ entries: chain.entries, messages, wiState, settings: activation, random: this.random, vector: this.vectorSearch, embedding: this.embeddingSettings, bookSources: sources.bookSourceMap, bookNames: sources.bookNameMap, selection: chain.selectionContentByEntryId, names });
      let captures: Record<string, ActivatedWorldInfoEntry[]> | undefined;
      if (hasCaptureRequests && captureWiState === null) captures = Object.fromEntries([...chain.captureRequests.keys()].map((extension) => [extension, []]));
      else if (captureWiState !== null) {
        // What activation would have made of the entries before the chain touched them: its own draws (`createWorldInfoCaptureRandom`, `:5421-5430`), no selection text.
        const raw = activateLore({ entries: [...wiEntries, ...chain.additionalEntries], messages, wiState: captureWiState, settings: activation, random: captureRandom(), vector: this.vectorSearch, embedding: this.embeddingSettings, bookSources: sources.bookSourceMap, bookNames: sources.bookNameMap, names });
        captures = Object.fromEntries([...chain.captureRequests].map(([extension, ids]) => [extension, raw.told.filter((entry) => ids.has(entry.id))]));
      }
      worldInfo = { ms: wiMs, entries: chain.entries, activated: lore.activated, stats: lore.stats };

      // ---- the prompt (`assembly.ts`), over the history as the user's settings, the context anchor, Memory and the databank mentions shape it
      const bound = connection.metadata?.reasoningBindings?.promptBias;
      const shaped = this.shapeHistory(chat, metadata, speaker, messages);
      const assembled = assemble(preset, lore.entries, shaped.messages, {
        type,
        promptBias: typeof bound === "string" ? bound : this.promptBias,
        names,
        world: { placements: chain.placementByEntryId, insertionOrder: chain.insertionOrderByEntryId },
        targetCharacterId: aimedAt,
        group: groupMetadata.group === true ? members : undefined,
        provider: connection.provider,
        impersonateInput: input.impersonateInput,
        impersonateMode: type === "impersonate" ? (input.impersonateMode ?? "prompts") : undefined,
        regenFeedback: input.regenFeedback,
        ...shaped.ending,
        ...(goesOn !== null ? { continueMessageId: goesOn.id, continuePostfix: postfix } : {}),
      });
      const { prompt, breakdown } = assembled;
      contextClipStats = assembled.contextClipStats;
      sent = prompt;
      // The chat history as Lumiverse counts it beside the reply: the prompt's history messages before the interceptors, blank ones left out
      // (`services/generate.service.ts:1211-1215`, `:1424-1426`).
      const history = dropBlank(prompt.filter((m) => m.__chatHistorySource === true));

      // ---- the interceptors (`generate.service.ts:1217-1247`), each handed the context as its own (`host.ts`). Assembly gives activated lore
      // only when some activated (`services/prompt-assembly.service.ts:4455-4456`): with none, the context keeps what a context handler left.
      if (lore.told.length > 0) context.activatedWorldInfo = lore.told;
      delete context.__spindleWorldInfoCaptures;
      if (captures !== undefined) context.__spindleWorldInfoCaptures = captures;
      // The resolved preset's own metadata is pinned on the context, which each worker is handed only its own namespace of (`generate.service.ts:1226-1231`).
      context.presetId = preset.id;
      delete context.__spindlePresetMetadata;
      if (preset.metadata) context.__spindlePresetMetadata = preset.metadata;
      const intercepted = this.interceptors.length > 0 ? await this.interceptorPipeline(prompt, context, chat.user, stop.signal) : { messages: prompt, parameters: undefined, breakdown: [] };
      // The breakdown is the assembly's and, after it, what each interceptor added (`appendInterceptorBreakdownEntries`, `services/generate.service.ts:565-583`, `:1431-1434`).
      const whole: BreakdownEntry[] = [...breakdown, ...intercepted.breakdown];
      checkAborted();
      // After the interceptors: post-processing, the blank filter, collapse, then the parameters (`:1249-1256`, `:1414-1441`).
      sent = intercepted.messages;
      if (this.postProcessing) applyPostProcessing(sent, this.postProcessing);
      sent = dropBlank(sent);
      if (preset.collapse === true) collapse(sent);
      const parameters: Record<string, unknown> = { ...preset.parameters, ...intercepted.parameters, ...input.parameters };
      if (live === null) return { generationId: null, error: null, stopped: false, prompt: sent, body: null, reply: null, parameters, stored: null, worldInfo, contextClipStats, breakdown: whole.filter((e) => e.type !== "chat_history") };
      // A context anchor's tail that cannot fit ends the generation before the provider is called (`:2814-2826`); a dry run only reports it.
      if (contextClipStats.anchorOverflow === true) throw new Error(`Protected context anchor needs ${(contextClipStats.protectedHistoryTokens ?? 0).toLocaleString()} tokens, but only ${Math.max(0, contextClipStats.remainingHistoryBudget).toLocaleString()} fit after prompt overhead. Increase Context Size or lower Max Response.`);
      // The counts saved into the chat's metadata, then the lore told, before the provider is called (`:2827-2879`); a dry run saves none,
      // and with no lore activated no event is sent (`:2869`).
      this.mergeChatMetadata(chat, { wi_state: wiState });
      if (lore.told.length > 0) this.emit("WORLD_INFO_ACTIVATED", { chatId: chat.id, entries: lore.told, stats: lore.stats }, chat.user);
      if (this.councilBlock !== null) sent.splice(Math.max(0, sent.length - 4), 0, { role: "system", content: this.councilBlock });
      checkAborted();
      // The streaming switch decides the call and is never sent (`generate.service.ts:3725-3726`): a stream,
      // or one whole answer in one call (`:3793-3815`).
      const streaming = parameters._streaming !== false;
      delete parameters._streaming;
      body = buildBody(connection.model, sent, parameters, streaming);
      const base = connection.base.replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/models$/, "");
      // The authored start of the reply, which the model goes on from (`:3702-3722`): streamed to the page first and saved in front of the model's text.
      const prefill = breakdown.find((e) => e.type === "utility" && e.name === "Assistant Prefill")?.content ?? "";
      // The start of the thinking a DeepSeek or Moonshot connection was sent (`:3710-3712`): streamed as thinking before anything, and saved in front of the model's own thinking, which is all the
      // reasoning carrier holds (`nativeReasoningContent`, `:3455-3471`).
      const reasoningPrefill = breakdown.find((e) => e.type === "utility" && e.name === "Reasoning Prefill")?.content ?? "";
      const thinkingSetting = this.library.setting(chat.user, "reasoningSettings") as { autoParse?: unknown; prefix?: unknown; suffix?: unknown } | undefined;
      const text: TextSettings = { cot: { autoParse: thinkingSetting?.autoParse === true, delimiters: resolveReasoningDelimiters(thinkingSetting) }, trim: preset.trimIncompleteWords === true, scripts: this.regexScripts };
      const seen: StreamSeen = { content: prefill, reasoning: reasoningPrefill };
      this.streams.set(live.id, seen);
      const timing: Timing = { streamingStartedAt: this.clock.now(), wasStreaming: streaming };
      const frames = new StreamFrames(() => this.clock, (frame) => this.emit("STREAM_TOKEN_RECEIVED", frame, chat.user, { topic: `stream:${chat.user}:${chat.id}` }), { generationId: live.id, chatId: chat.id });
      frames.push("reasoning", reasoningPrefill);
      if (prefill !== "") {
        // A prefill that opens thinking is thinking from its first word (`:3706-3709`).
        const part = text.cot.autoParse ? extractDelimitedReasoning(prefill, text.cot.delimiters) : { cleaned: prefill, reasoning: "" };
        frames.push("reasoning", part.reasoning);
        frames.push("content", part.cleaned);
      }
      const landing: Landing = { type, staged, swipeAt, original, postfix, target, speakerId, speakerName, names, draft: input.impersonateDraft === true, ...(input.persona !== undefined ? { persona: input.persona } : {}) };
      let reply: StreamedReply | null = null;
      let failure: unknown = null;
      try {
        // The provider call waits for the scheduler to admit it where the scheduler is on, and that wait is not silence (`:3771-3783`); every chunk with text touches the generation
        // (`:3867-3873`) and is framed to the page, and the stop is raced against each read (`:3830-3850`).
        this.registry.waiting(live.id, true);
        let release: () => void;
        try {
          release = await this.inference.acquire(base, stop.signal);
        } finally {
          this.registry.waiting(live.id, false);
        }
        try {
          const res = await this.fetch(`${base}/chat/completions`, { method: "POST", headers: providerHeaders(connection.key), body: JSON.stringify(body), signal: stop.signal });
          const hooks = {
            touch: () => this.registry.touch(live.id),
            text: (chunk: { content: string; reasoning: string }) => {
              const now = this.clock.now();
              if (chunk.reasoning !== "" || chunk.content !== "") timing.firstTokenAt ??= now;
              if (/\S/.test(chunk.content)) timing.firstContentTokenAt ??= now;
              frames.push("reasoning", chunk.reasoning);
              frames.push("content", chunk.content);
            },
            signal: stop.signal,
          };
          const read = streaming ? await readStream(res, seen, hooks) : await readWhole(res, hooks);
          timing.responseStoppedAt = this.clock.now();
          // The reply's own text is the model's; the prefill is in front of what the player sees and what is saved.
          reply = streaming ? { ...read, content: read.content.slice(prefill.length), reasoning: read.reasoning.slice(reasoningPrefill.length) } : read;
          if (!streaming) {
            seen.content = prefill + read.content;
            seen.reasoning = reasoningPrefill + read.reasoning;
          }
        } finally {
          release();
        }
      } catch (error) {
        if (!stop.signal.aborted) failure = error ?? new Error("Unknown error");
      }
      /** The provider's own thinking, which a later prompt may carry back (`storedReasoningCarrier`, `:3447-3470`). */
      const carrierOf = (thinking: string): Record<string, unknown> | undefined => (thinking === "" ? undefined : { type: "reasoning_content", content: thinking });
      if (reply === null) {
        // Stopped by the user or failed while the provider was called or read (`:4502-4579`): whatever came is kept, a staged message that got nothing removed (`persistPartialContent`, `:3565-3680`).
        const kept = this.land(home, landing, false, partialText({ content: seen.content, reasoning: seen.reasoning, prefill, streamed: streaming }, text), carrierOf(seen.reasoning.slice(reasoningPrefill.length)));
        const how = seen.finishReason !== undefined ? { finish_reason: seen.finishReason } : null;
        const swipe = target.swipe ?? undefined;
        if (kept.messageId !== undefined && type !== "impersonate") this.setSwipeScopedExtra(home, kept.messageId, swipe, { generationOutcome: how });
        const heard = { content: seen.content.slice(prefill.length), reasoning: seen.reasoning.slice(reasoningPrefill.length), finishReason: seen.finishReason ?? "", usage: null };
        if (failure === null) {
          frames.flush();
          this.emit("GENERATION_STOPPED", { generationId, chatId: chat.id, content: kept.content }, chat.user);
          return { generationId, ...(kept.messageId !== undefined ? { messageId: kept.messageId } : {}), error: null, stopped: true, prompt: sent, body, reply: heard, parameters, stored: null, worldInfo, contextClipStats };
        }
        const failed = failureOf(failure, connection);
        if (kept.messageId !== undefined) this.setSwipeScopedExtra(home, kept.messageId, swipe, { generationOutcome: { ...(how ?? {}), error: failed.error } });
        frames.flush();
        this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, messageId: kept.messageId, content: kept.content, ...failed, ...(how ?? {}), usage: undefined, generationType: type, frontendSessionId }, chat.user);
        return { generationId, ...(kept.messageId !== undefined ? { messageId: kept.messageId } : {}), error: failed.error, stopped: false, prompt: sent, body, reply: null, parameters, stored: null, worldInfo, contextClipStats };
      }
      // A reply that ended well (`:4065-4310`): its text finished, saved where it goes, its macros resolved, what belongs to its swipe written, then told.
      const finished = finishedText({ content: prefill + reply.content, reasoning: reasoningPrefill + reply.reasoning, prefill, streamed: streaming }, text);
      const carrier = carrierOf(reply.reasoning);
      const landed = this.land(home, landing, true, finished, carrier);
      const messageId = landed.messageId;
      let savedText = landed.content;
      if (messageId !== undefined) {
        savedText = this.resolveSaved(home, messageId, target.swipe ?? undefined, savedText, names);
        this.setSwipeScopedExtra(home, messageId, target.swipe ?? undefined, {
          generationOutcome: { finish_reason: reply.finishReason },
          ...(finished.reasoning !== "" ? { reasoning: finished.reasoning } : {}),
          ...(type !== "impersonate" && carrier !== undefined ? { reasoningCarrier: carrier } : {}),
          ...(reply.usage !== null ? { usage: reply.usage } : {}),
        });
      }
      frames.flush();
      timing.completedAt = this.clock.now();
      this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, messageId, content: savedText, usage: reply.usage ?? undefined, finish_reason: reply.finishReason, generationType: type, frontendSessionId, impersonateDraft: landing.draft && type === "impersonate" ? true : undefined }, chat.user);
      // What follows comes on a later task, after the terminal event (`:4305-4310`): the token count and the timings, then the breakdown stored where a message was saved and the tokenizer counted
      // (`:4432-4497`); `stored` waits for it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (messageId !== undefined) {
        const counted = (value: string): number | undefined => (this.tokenizedModels.has(connection.model) ? Math.ceil(value.length / 4) : undefined);
        const options = { hasReasoning: finished.reasoning !== "" || carrier !== undefined, hasDelimitedReasoning: finished.delimited };
        const provided = resolveGenerationTokenCounts(reply.usage?.completion_tokens, {}, options);
        const calculatedMessage = provided.messageTokenCount === undefined && savedText.length > 0 ? counted(savedText) : undefined;
        const calculatedResponse = streaming && provided.responseTokenCount === undefined && /\S/.test(reply.content) ? (provided.messageTokenCount === undefined && reply.content === savedText ? calculatedMessage : counted(reply.content)) : undefined;
        const resolved = resolveGenerationTokenCounts(reply.usage?.completion_tokens, { messageTokenCount: calculatedMessage, responseTokenCount: calculatedResponse }, options);
        const generationMetrics = { ...timingMetrics(timing, resolved.responseTokenCount, this.clock.now()), model: connection.model, provider: "custom", presetId: preset.id, presetName: preset.name };
        const metrics = { ...(resolved.messageTokenCount ? { tokenCount: resolved.messageTokenCount } : {}), generationMetrics };
        // The swipe the reply was made for, not the one on show (`:4400-4426`).
        this.setSwipeScopedExtra(home, messageId, target.swipe ?? undefined, metrics);
        this.emit("GENERATION_METRICS_READY", { generationId, chatId: chat.id, messageId, swipeId: target.swipe ?? undefined, ...metrics }, chat.user);
      }
      if (messageId === undefined || this.tokenizerFails || whole.length === 0) return { generationId, ...(messageId !== undefined ? { messageId } : {}), error: null, stopped: false, prompt: sent, body, reply, parameters, stored: null, worldInfo, contextClipStats };
      // Token counts are the stand-in's own.
      const tokens = (value: string): number => Math.ceil(value.length / 4);
      const historyTokens = history.reduce((n, m) => n + tokens(textOf(m)), 0);
      const entriesStored = whole.map((e) => ({ name: e.name, type: e.type, tokens: e.type === "chat_history" ? historyTokens : tokens(e.tokenCountContent ?? e.content ?? ""), ...(e.role ? { role: e.role } : {}), ...(e.blockId ? { blockId: e.blockId } : {}), ...(e.extensionId !== undefined ? { extensionId: e.extensionId, extensionName: e.extensionName } : {}), content: e.content }));
      const stored: Stored & { tokenizer_name: string } = {
        entries: entriesStored.filter((e) => e.type !== "chat_history"),
        chatHistoryTokens: historyTokens,
        messages: sent.map((m) => ({ role: m.role, content: textOf(m) })),
        // An entry whose text a block already holds is not counted twice (`services/tokenizer.service.ts:550-552`).
        totalTokens: entriesStored.reduce((n, e, i) => (whole[i]!.excludeFromTotal === true ? n : n + e.tokens), 0),
        maxContext: 0,
        model: connection.model,
        provider: "custom",
        parameters,
        usage: reply.usage,
        presetName: preset.name,
        presetId: preset.id,
        tokenizer_name: "approximate",
      };
      this.storeBreakdown(chat, messageId, stored);
      // Pushed without its `messages`, the largest field (`:4487-4496`).
      const { messages: _messages, ...forClient } = stored;
      this.emit("GENERATION_BREAKDOWN_READY", { generationId, chatId: chat.id, messageId, breakdown: forClient }, chat.user);
      return { generationId, messageId, error: null, stopped: false, prompt: sent, body, reply, parameters, stored, worldInfo, contextClipStats };
    } catch (error) {
      if ((error instanceof CancelledByExtension || stop.signal.aborted) && generationId !== null) {
        // A context handler's cancel, and a stop that came while the setup was still going, end it as a stop does, its empty message removed and nothing saved (`:3003-3022`).
        if (staged !== null) this.deleteMessage(chat.id, staged);
        this.emit("GENERATION_STOPPED", { generationId, chatId: chat.id, content: "" }, chat.user);
        return { generationId, error: null, stopped: true, prompt: sent, body, reply: null, parameters: null, stored: null, worldInfo, contextClipStats };
      }
      // A failed setup ends the generation with its error, its empty message removed (`:2987-3048`).
      const failed = failureOf(error, connection);
      if (staged !== null) this.deleteMessage(chat.id, staged);
      if (!dryRun) this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, ...failed, generationType: type, frontendSessionId }, chat.user);
      return { generationId, error: failed.error, stopped: false, prompt: sent, body, reply: null, parameters: null, stored: null, worldInfo, contextClipStats };
    }
  }

  /**
   * `POST /api/v1/generate` (`routes/generate.routes.ts`): the answer comes as soon as the generation has begun (its id, once `GENERATION_STARTED` has been told; none for a dry run),
   * and `done` is the generation's end, which is what `generate` gives. A generation that fails before it has begun fails here.
   */
  async start(input: GenerateInput): Promise<{ generationId: string | null; done: Promise<Outcome> }> {
    const begun = Promise.withResolvers<string | null>();
    const done = this.generate(input, begun.resolve);
    done.then(undefined, begun.reject);
    return { generationId: await begun.promise, done };
  }

  /**
   * What shapes the history before the prompt is sent, and the databank mentions in it (`services/prompt-assembly.service.ts:2796-2826`, `:2905-2985`): the context
   * anchor (`context_history_anchor_message_id`, `:1904-1917`, a hidden message is none), the Summary tab's message limit (`summarization`), Memory's replacements where
   * its config and the chat allow them, the user's image settings, and each valid `#mention` in the player's lines taken out of them and the mentioned documents'
   * text put at the end of the last of them. The messages given back are copies; the chat's own are not touched.
   */
  private shapeHistory(chat: Chat, metadata: Record<string, unknown>, speaker: Character, messages: readonly ChatMessage[]): { messages: ChatMessage[]; ending: Pick<Ending, "anchorIndex" | "messageLimit" | "memory" | "mention" | "recycledImageLimit" | "carriers" | "reasoning"> } {
    const user = chat.user;
    const anchorId = typeof metadata.context_history_anchor_message_id === "string" ? metadata.context_history_anchor_message_id : null;
    const anchor = anchorId === null ? undefined : chat.messages.find((m) => m.id === anchorId && m.hidden !== true);
    const config = cortexConfigOf(this.library.setting(user, "memoryCortexConfig"));
    const replaces = cortexEnabledForChat(config, metadata) && (config.replaceConsolidatedMessagesInContext || config.replaceArcSummariesInContext);
    const images = this.library.setting(user, "imageGeneration") as { recycleGeneratedImages?: unknown; recycledImageLimit?: unknown } | undefined;
    const rawLimit = Number(images?.recycledImageLimit ?? 1);
    const copies = messages.map((m) => ({ ...m }));
    const mention = this.mentionsIn(chat, metadata, speaker, copies);
    // The thinking Lumiverse kept with each assistant reply, as its row holds it for the swipe on show (`getStoredReasoningCarrier`, `:282-329`), and the user's `keepInHistory` (`:3466-3474`).
    const carriers = new Map<string, string>();
    for (const m of copies) {
      if (m.role !== "assistant") continue;
      const row = this.messageRow(m.id);
      const stored = row === null ? undefined : (row.extra as Record<string, unknown>);
      const list = stored?.reasoningCarrierBySwipe;
      const carrier = Array.isArray(list) ? list[Number(row?.swipe_id ?? 0)] : stored?.reasoningCarrier;
      if (typeof carrier === "object" && carrier !== null && "type" in carrier && carrier.type === "reasoning_content" && "content" in carrier && typeof carrier.content === "string" && carrier.content !== "") carriers.set(m.id, carrier.content);
    }
    const reasoningSetting = this.library.setting(user, "reasoningSettings") as { keepInHistory?: unknown; prefix?: unknown; suffix?: unknown } | undefined;
    return {
      messages: copies,
      ending: {
        anchorIndex: anchor === undefined ? null : indexInChat(anchor),
        messageLimit: this.library.setting(user, "summarization") as MessageLimit | undefined,
        ...(replaces ? { memory: { config, of: { consolidations: this.memory.consolidations(chat.id), chunks: this.memory.chunks(chat.id) } } } : {}),
        mention,
        carriers,
        reasoning: { keepInHistory: typeof reasoningSetting?.keepInHistory === "number" ? reasoningSetting.keepInHistory : -1, delimiters: resolveReasoningDelimiters(reasoningSetting) },
        recycledImageLimit: images?.recycleGeneratedImages === true ? Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 1)) : 0,
      },
    };
  }

  /**
   * The mentions of databank documents in the player's lines (`services/databank/mention-resolver.service.ts:21-60`, `:67-95`, `:171-212`; `services/prompt-assembly.service.ts:2905-2985`):
   * a `#slug` after whitespace or at a line's start, in a user message, names a ready document of the user's in a databank active for the chat (global, the chat's, the speaker's
   * unless the chat is isolated from memory, or in the user's `globalDatabanks`); every one that does is taken out of every user message it is in, in `copies`, and the text of the
   * documents the last user message names, in the order it names them, is given back as the appendix Lumiverse puts at its end (`formatMentionsAsAppendix`, `:217-238`).
   */
  private mentionsIn(chat: Chat, metadata: Record<string, unknown>, speaker: Character, copies: ChatMessage[]): string {
    const perMessage = copies.map((m): Set<string> | null => {
      if (m.role !== "user" || !m.content.includes("#")) return null;
      const slugs = new Set([...m.content.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)].map((found) => found[1]!.toLowerCase()));
      return slugs.size === 0 ? null : slugs;
    });
    const all = new Set(perMessage.flatMap((s) => (s === null ? [] : [...s])));
    if (all.size === 0) return "";
    const global = this.library.setting(chat.user, "globalDatabanks");
    const active = new Set(this.databanks.activeBanks(chat.user, chat.id, metadata.memory_isolation === true ? [] : [speaker.id], { global: Array.isArray(global) ? (global as string[]) : [], character: [], chat: [] }));
    const documents = new Map<string, { id: string; name: string }>();
    for (const slug of all) {
      const found = this.databanks.documentBySlug(chat.user, slug);
      if (found !== null && active.has(found.databank)) documents.set(slug, found);
    }
    if (documents.size === 0) return "";
    copies.forEach((m, i) => {
      if (perMessage[i] === null) return;
      let out = m.content;
      for (const slug of documents.keys()) out = out.replace(new RegExp(`(^|\\s)#${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "$1");
      copies[i] = { ...m, content: out.replace(/\s{2,}/g, " ").trim() };
    });
    const named = perMessage[copies.findLastIndex((m) => m.role === "user")];
    if (named === null || named === undefined) return "";
    const resolved = [...named].filter((slug) => documents.has(slug)).flatMap((slug) => {
      const text = this.databanks.fullText(chat.user, documents.get(slug)!.id);
      return text === null || text === "" ? [] : [`## ${documents.get(slug)!.name}\n${text}`];
    });
    return resolved.length === 0 ? "" : ["", "---", "", "# Additional Context", "The user has attached the following reference material for you to consider when responding.", "", resolved.join("\n\n---\n\n")].join("\n");
  }

  /** The chat's metadata as its row holds it now; the chat held in memory where there is no database. */
  private metadataOf(chat: Chat): Record<string, unknown> {
    const row = this.db?.rows("SELECT metadata FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    return row === undefined ? (chat.metadata ?? {}) : (JSON.parse(String(row.metadata)) as Record<string, unknown>);
  }

  /**
   * `mergeChatMetadataAsync` (`services/chats.service.ts:5241-5244`; `db/chat-operations.ts:22-33`, `:57-80`): each key given replaces
   * the chat's own, a key given as undefined is removed (`:68`), the row's stamp is raised, and the change is told as `CHAT_CHANGED` with the keys that differ
   * (`services/chats.service.ts:1466-1500`, `:5198-5204`).
   */
  mergeChatMetadata(chat: Chat, partial: Record<string, unknown>): void {
    const before = this.metadataOf(chat);
    const metadata = { ...before, ...partial };
    for (const [key, value] of Object.entries(partial)) if (value === undefined) delete metadata[key];
    const changedFields = Object.keys(partial).filter((key) => (partial[key] === undefined ? key in before : !(key in before) || JSON.stringify(before[key]) !== JSON.stringify(partial[key]))).map((key) => `metadata.${key}`);
    this.db?.run("UPDATE chats SET metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?", JSON.stringify(metadata), Math.floor(this.now() / 1000), chat.id, chat.user);
    chat.metadata = metadata;
    const row = this.db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    const shown = row === undefined ? { id: chat.id, user_id: chat.user, character_id: chat.character.id, name: chat.name ?? "", metadata } : { ...row, metadata };
    this.emit("CHAT_CHANGED", { chat: shown, changedFields }, chat.user);
  }

  /**
   * Where a reply goes and what is written there, by the kind of generation: a swipe's blank swipe filled in, a continue's text joined to what the message held, a staged
   * message filled in, any other reply made a message of its own (`services/generate.service.ts:4120-4195`). A reply that ended well always fills its place; one stopped or
   * failed (`persistPartialContent`, `:3565-3680`) writes only what came, a staged message that got nothing removed, and a continue or a new message made only for something.
   * The thinking goes into the message's `extra` with the text for a staged message and a new one, and by the swipe's own write for the others (`setSwipeScopedExtra`).
   */
  private land(chat: Chat, at: Landing, done: boolean, saved: { content: string; reasoning: string }, carrier: Record<string, unknown> | undefined): { messageId?: string; content: string } {
    const impersonation = at.type === "impersonate";
    const nothing = saved.content === "" && saved.reasoning === "" && carrier === undefined;
    const thinking: Record<string, unknown> = { ...(saved.reasoning !== "" ? { reasoning: saved.reasoning } : {}), ...(carrier !== undefined && !impersonation ? { reasoningCarrier: carrier } : {}) };
    const shown = (id: string): ChatMessage | undefined => chat.messages.find((m) => m.id === id);
    if (at.swipeAt !== null && at.target.message !== null) {
      const m = shown(at.target.message);
      if (m && (m.swipeId ?? 0) === at.swipeAt) m.content = saved.content;
      this.saveSwipe(chat, at.target.message, at.swipeAt, saved.content);
      if (!done && Object.keys(thinking).length > 0) this.setSwipeScopedExtra(chat, at.target.message, at.swipeAt, thinking);
      return { messageId: at.target.message, content: saved.content };
    }
    if (at.original !== null && at.target.message !== null) {
      if (!done && nothing) return { content: saved.content };
      // The text the message held, the preset's postfix, then the new text (`:4129-4147`), into the swipe it continued, which the player may have flipped away from (`contentSwipeId`).
      const joined = at.original + at.postfix + saved.content;
      const m = shown(at.target.message);
      if (m && (m.swipeId ?? 0) === at.target.swipe) m.content = joined;
      this.saveText(chat, at.target.message, joined, at.target.swipe ?? undefined);
      if (!done && Object.keys(thinking).length > 0) this.setSwipeScopedExtra(chat, at.target.message, at.target.swipe ?? undefined, thinking);
      return { messageId: at.target.message, content: joined };
    }
    if (at.staged !== null) {
      if (!done && nothing) {
        this.deleteMessage(chat.id, at.staged);
        return { content: saved.content };
      }
      const m = shown(at.staged);
      if (m) m.content = saved.content;
      this.updateRow(chat, at.staged, { content: saved.content, extra: done ? (saved.reasoning !== "" ? { reasoning: saved.reasoning } : {}) : thinking });
      return { messageId: at.staged, content: saved.content };
    }
    if (at.draft && impersonation) return { content: saved.content };
    if (!done && nothing) return { content: saved.content };
    // Anything else makes a message: an impersonation the user's, under the persona's name, anything else the speaker's (`:4172-4194`).
    const m: ChatMessage = { id: crypto.randomUUID(), role: impersonation ? "user" : "assistant", content: saved.content, ...(impersonation ? {} : { characterId: at.speakerId }) };
    chat.messages.push(m);
    const extra = { ...(impersonation && at.persona !== undefined ? { persona_id: at.persona } : {}), ...(done ? (saved.reasoning !== "" ? { reasoning: saved.reasoning } : {}) : thinking) };
    this.createRow(chat, m, impersonation ? at.names.user : at.speakerName, normalizeStoredExtra(extra, 1, 0));
    this.emit("MESSAGE_SENT", { chatId: chat.id, message: this.messageRow(m.id) ?? m }, chat.user);
    return { messageId: m.id, content: saved.content };
  }

  /** `updateMessage` with text and a patch of `extra` (`services/chats.service.ts:2922-3033`): the text into the swipe on show, the patch folded into the swipe-scoped fields, the revision raised, then told. */
  private updateRow(chat: Chat, id: string, patch: { content: string; extra: Record<string, unknown> }): void {
    const row = this.messageRow(id);
    if (this.db === null || row === null) return;
    const swipes = [...(row.swipes as string[])];
    const shown = Number(row.swipe_id);
    swipes[shown] = patch.content;
    const extra = normalizeStoredExtra({ ...(row.extra as Record<string, unknown>), ...patch.extra }, swipes.length, shown);
    this.db.run("UPDATE messages SET content = ?, swipes = ?, extra = ?, revision = revision + 1 WHERE id = ? AND chat_id = ?", patch.content, JSON.stringify(swipes), JSON.stringify(extra), id, chat.id);
    this.emit("MESSAGE_EDITED", { chatId: chat.id, message: this.messageRow(id) }, chat.user);
  }

  /**
   * `setSwipeScopedExtra` (`services/chats.service.ts:2888-2920`): the fields given written to one swipe's own entries, whichever swipe the message shows; the swipe shown when the one named
   * is out of range. It tells nothing and raises no revision.
   */
  protected setSwipeScopedExtra(chat: Chat, id: string, swipe: number | undefined, fields: Record<string, unknown>): void {
    const row = this.messageRow(id);
    if (this.db === null || row === null) return;
    const count = (row.swipes as string[]).length;
    const at = typeof swipe === "number" && Number.isInteger(swipe) && swipe >= 0 && swipe < count ? swipe : Number(row.swipe_id);
    const base: Record<string, unknown> = { ...(row.extra as Record<string, unknown>) };
    for (const key of SWIPE_SCOPED_EXTRA_KEYS) delete base[key];
    Object.assign(base, fields);
    this.db.run("UPDATE messages SET extra = ? WHERE id = ? AND chat_id = ?", JSON.stringify(normalizeStoredExtra(base, count, at)), id, chat.id);
  }

  /** The macros of the saved reply resolved and the message written again where they changed it (`services/generate.service.ts:4207-4249`); the text it holds now. */
  private resolveSaved(chat: Chat, id: string, swipe: number | undefined, held: string, names: { user: string; character: string }): string {
    const row = this.messageRow(id);
    const swipes = row === null ? null : (row.swipes as string[]);
    const at = swipe !== undefined && swipes !== null && swipe >= 0 && swipe < swipes.length ? swipe : Number(row?.swipe_id ?? 0);
    const base = swipes?.[at] ?? held;
    const resolved = resolveMacros(base, { user: names.user, char: names.character });
    if (resolved === base) return base;
    const m = chat.messages.find((x) => x.id === id);
    if (m && (m.swipeId ?? 0) === at) m.content = resolved;
    this.saveText(chat, id, resolved, at);
    return resolved;
  }
}

/** `getEffectiveCharacterName` (`types/character.ts:86-88`): the alternate name the card gives, trimmed, else its name. */
function effectiveName(character: Character): string {
  const alternate = character.extensions?.alternate_character_name;
  return (typeof alternate === "string" ? alternate.trim() : "") || character.name;
}

/** What a generation's end event says of a failure (`generationFailurePayload`, `services/generate.service.ts:630-647`; `generationErrorCode`, `:612-627`): the message, a code, the connection's name. */
function failureOf(error: unknown, connection: Connection): { error: string; errorCode: string; errorMessage: string; connectionName?: string } {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const status = /^Provider error (\d+)/.exec(message)?.[1];
  const name = connection.name?.trim();
  return {
    error: message,
    errorCode: typeof code === "string" && code.trim() !== "" ? code.trim().slice(0, 120) : typeof code === "number" && Number.isFinite(code) ? String(code) : status !== undefined ? `http_${status}` : "generation_failed",
    errorMessage: message,
    ...(name ? { connectionName: name } : {}),
  };
}

/** Where a generation's reply goes, and what the save needs of the generation (`land`). */
interface Landing {
  type: GenerationType;
  /** The empty message made at the start for a new reply. */
  staged: string | null;
  /** A swipe's or a regenerate's blank swipe. */
  swipeAt: number | null;
  /** A continue: the text the message held and what joins the new text to it. */
  original: string | null;
  postfix: string;
  target: { message: string | null; swipe: number | null };
  speakerId: string;
  speakerName: string;
  names: { user: string; character: string };
  /** An impersonation kept as a draft for the input box, saving no message. */
  draft: boolean;
  persona?: string;
}

/** `GenerationCancelledByExtensionError` (`services/generate.service.ts:525-530`). */
class CancelledByExtension extends Error {
  constructor() {
    super("Generation cancelled by extension context handler");
    this.name = "GenerationCancelledByExtension";
  }
}

/** `createWorldInfoCaptureRandom` (`services/prompt-assembly.service.ts:5421-5430`): a draw of its own, seeded from the system, so a capture never takes a draw the generation's own would have had. */
function captureRandom(): () => number {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  let state = seed[0] || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
