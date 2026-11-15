// A stand-in Lumiverse for tests: enough of the host and of Spindle's backend API to run the light
// extension (`src/ext`) against RPE's adapter (`src/adapter`) end to end, with no Lumiverse and no
// server. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; what is
// its own (assembling the prompt, activating lore, counting tokens) says so. Paths are Lumiverse's
// `src/`. It is cut along Lumiverse's own areas: the extension host with its interceptor pipeline, its
// proxy and the network (`host.ts`); the chats, their rows and the events of each write (`rows.ts`);
// the World Info chain and activation (`lore.ts`); the prompt's assembly (`assembly.ts`). This file is
// the generation that runs through them all, and the chat connections and presets it reads.

import { assemble, type BreakdownEntry, type GenerationType, type Preset } from "./assembly";
import { activateLore, DEFAULT_EMBEDDING_SETTINGS, worldInfoChain, worldInfoContext, type Activation, type BookSource, type EmbeddingSettings, type Entry, type VectorSearch, type WiState, type WorldInfoSettings } from "./lore";
import { ChatRows, type Chat, type ChatMessage, type Stored } from "./rows";
import { applyPostProcessing, buildBody, collapse, dropBlank, providerHeaders, readStream, readWhole, textOf, type LlmMessage, type StreamSeen, type StreamedReply } from "./steps";

export type { Chat, ChatMessage } from "./rows";
export type { Installed } from "./host";
export type { Preset } from "./assembly";

export interface Connection {
  id: string;
  /** The connection's address; Lumiverse posts to `<base>/chat/completions`. */
  base: string;
  key: string;
  model: string;
  /** Its own record: a "Start Reply With" bound to it stands in place of the user's, an empty one too (`services/prompt-assembly.service.ts:4130-4137`). */
  metadata?: { reasoningBindings?: { promptBias?: string } };
}

export interface GenerateInput {
  chat: string;
  connection: string;
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
}

export interface Outcome {
  /** Null for a dry run, which announces none. */
  generationId: string | null;
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
  /** The World Info chain: how long it took, and the entries as it left them; and how each entry that activated did, as Lumiverse works it out and does not tell. */
  worldInfo: { ms: number; entries: Entry[]; activated: Activation[] };
  /**
   * A dry run's: the breakdown its assembly made, the chat history's entry left out (`services/generate.service.ts:3255`); its
   * interceptors add none. Absent for a generation, whose breakdown is the one Lumiverse stores beside the reply (`stored`).
   */
  breakdown?: BreakdownEntry[];
}

export class StandIn extends ChatRows {
  readonly connections = new Map<string, Connection>();
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
  /** Each book's name and where it is attached for the chat (`bookNameMap`, `bookSourceMap`, `services/world-info-sources.service.ts`), until the stand-in reads a chat's books from their four places (PlanAdapter-S18). */
  readonly worldBooks = new Map<string, { name: string; source: BookSource }>();
  /** The vector search a test scripts; null, no embeddings connection, as on the test bed, and no entry activates by vector. */
  vectorSearch: VectorSearch | null = null;
  /** The user's embeddings settings the ranking reads. */
  embeddingSettings: EmbeddingSettings = DEFAULT_EMBEDDING_SETTINGS;
  /** The draws of a probability or a group (`Math.random` in Lumiverse); a test may give its own. */
  random: () => number = Math.random;
  /** The generations going on, by id, with what stops each (`services/generation/active-generation-registry.ts`). */
  private readonly going = new Map<string, { user: string; chat: string; stop: AbortController }>();

  /** `POST /api/v1/generate/stop` (`routes/generate.routes.ts:45-65`): the generation named, else every one of the chat, else every one of the user's; whether any was. */
  stop(user: string, ask: { generation?: string; chat?: string }): boolean {
    const named = ask.generation === undefined ? undefined : this.going.get(ask.generation);
    if (named !== undefined && named.user === user) {
      named.stop.abort();
      return true;
    }
    if (ask.generation !== undefined && ask.chat === undefined) return false;
    let stopped = false;
    for (const g of this.going.values()) {
      if (g.user !== user || (ask.chat !== undefined && g.chat !== ask.chat)) continue;
      g.stop.abort();
      stopped = true;
    }
    return ask.chat === undefined ? true : stopped;
  }

  /**
   * One generation, or a dry run: as `startGeneration` (`services/generate.service.ts:1546-3073`) and
   * `dryRunGeneration` (`:3080-3274`) order it. The prompt itself is assembled the stand-in's own way
   * (`assembly.ts`).
   */
  async generate(input: GenerateInput): Promise<Outcome> {
    const chat = this.chats.get(input.chat);
    const connection = this.connections.get(input.connection);
    const preset = this.presets.get(input.preset);
    if (!chat || !connection || !preset) throw new Error("the stand-in has no such chat, connection or preset");
    // Every message the stand-in holds has its stored number from here on (`ChatRows.numbered`).
    this.numbered(chat);
    const type = input.type ?? "normal";
    const dryRun = input.dryRun === true;
    const generationId = dryRun ? null : crypto.randomUUID();
    let target: { message: string | null; swipe: number | null } = { message: null, swipe: null };
    let excluded: string | null = null;
    let staged: string | null = null;
    /** A swipe or a regenerate: the swipe made for the reply. */
    let swipeAt: number | null = null;
    /** A continue: the message it goes on, the text that message held, and what joins the new text to it. */
    let goesOn: ChatMessage | null = null;
    let original: string | null = null;
    let postfix = "";
    const stop = new AbortController();
    if (type === "continue") {
      // The message named, else the chat's last non-user message by its place, hidden ones included (`services/generate.service.ts:1809-1813`,
      // `services/chats.service.ts:2066-2072`); a generation never goes on a user's (`:1814`), where a dry run does not ask (`:3150-3155`). A
      // message named from another of the user's chats, which Lumiverse would also find (`services/chats.service.ts:2130`), is not looked for.
      const last = chat.messages.at(-1);
      const named = input.message ?? (last !== undefined && last.role !== "user" ? last.id : undefined);
      const found = named === undefined ? chat.messages.findLast((m) => m.role !== "user") : chat.messages.find((m) => m.id === named);
      goesOn = found === undefined || (found.role === "user" && !dryRun) ? null : found;
      if (goesOn !== null) {
        original = goesOn.content;
        // The preset's postfix, none where it has none, and none where the text already ends with it (`:1969-1978`,
        // `prompt-assembly.service.ts:662-670`): the same one goes on the message in the prompt and into the saved join.
        const configured = preset.continuePostfix ?? "";
        postfix = configured === "" || original.endsWith(configured) ? "" : configured;
      }
    }
    if (!dryRun) {
      if (type === "normal") {
        // A new reply's message is made empty before the prompt, and left out of it (`:1988-2006`).
        staged = crypto.randomUUID();
        const m: ChatMessage = { id: staged, role: "assistant", content: "" };
        chat.messages.push(m);
        this.createRow(chat, m, chat.character.name, { character_id: chat.character.id });
        target = { message: staged, swipe: 0 };
        excluded = staged;
      } else if (type === "swipe" || type === "regenerate") {
        // The reply being replaced gets a new empty swipe, shown, and is left out of the prompt (`:1699-1720`, `prompt-assembly.service.ts:1900-1904`).
        const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
        if (last) {
          swipeAt = this.addSwipeRow(chat, last.id, "") ?? (last.swipeId ?? 0) + 1;
          last.swipeId = swipeAt;
          target = { message: last.id, swipe: swipeAt };
          excluded = last.id;
        }
      } else if (type === "continue" && goesOn !== null) {
        target = { message: goesOn.id, swipe: goesOn.swipeId ?? 0 };
      }
      this.going.set(generationId!, { user: chat.user, chat: chat.id, stop });
      // Announced before the prompt is assembled (`:2036-2055`), and the assembly starts on a later task (`:2068-2073`, `:1059`). A continue
      // names the swipe it goes on, the one its message shows, and no message (`:1962-1968`): only a swipe, a regenerate and a new reply's
      // staged message set `targetMessageId` (`:1928-1938`, `:1988-2006`). What none set, an impersonation's both, is left unset.
      this.emit("GENERATION_STARTED", { generationId, chatId: chat.id, model: connection.model, targetMessageId: type === "continue" ? undefined : (target.message ?? undefined), targetSwipeId: target.swipe ?? undefined, backgroundSwipe: false, characterId: chat.character.id, characterName: chat.character.name, generationType: type, frontendSessionId: undefined }, chat.user);
    }
    // Two later tasks, as the continuation and the pipeline each wait for one.
    for (let i = 0; i < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const messages = chat.messages.filter((m) => m.id !== excluded);
    // The stand-in keeps no personas, so the name for the user's messages is Lumiverse's own when there is none
    // (`services/prompt-assembly.service.ts:7186-7189`), as the stand-in's rows name them.
    const names = { user: "User", character: chat.character.name };
    // Every entry has a uid of its own from here on, as every entry Lumiverse holds has (`services/world-books.service.ts:842`).
    for (const e of chat.books) e.uid ??= crypto.randomUUID();
    let sent: LlmMessage[] = [];
    let body: Record<string, unknown> | null = null;
    let worldInfo: Outcome["worldInfo"] = { ms: 0, entries: [], activated: [] };
    try {
      // ---- the extensions' context handlers, first in the pipeline (`generate.service.ts:1063-1083`): what they give back is the
      // context, the frontend session put back; one that asks to cancel stops the generation.
      let context: Record<string, unknown> = { frontendSessionId: undefined, chatId: chat.id, connectionId: connection.id, personaId: input.persona, generationType: type, dryRun, userId: chat.user };
      if (this.contextHandlers.length > 0) {
        const handled = await this.contextHandlerChain(context, chat.user);
        if (handled) context = { ...(handled as Record<string, unknown>), frontendSessionId: undefined };
        if (context.cancelGeneration === true) throw new CancelledByExtension();
      }

      // ---- lore (`prompt-assembly.service.ts:2242-2597`): the chain before activation, then activation over the chat's own counts
      // (`:2272`), which change in place and are saved after the interceptors.
      const wiStarted = performance.now();
      const entries = this.worldInfo.length === 0 ? [...chat.books] : await worldInfoChain(this.worldInfo, chat.books, worldInfoContext(chat, messages), chat.user, { timeoutMs: this.worldInfoTimeoutMs, log: this.log });
      const wiMs = performance.now() - wiStarted;
      const wiState = structuredClone((this.metadataOf(chat).wi_state ?? {}) as WiState);
      const lore = activateLore({ entries, messages, wiState, settings: this.worldInfoSettings, random: this.random, vector: this.vectorSearch, embedding: this.embeddingSettings, books: this.worldBooks, names });
      worldInfo = { ms: wiMs, entries, activated: lore.activated };

      // ---- the prompt (`assembly.ts`)
      const bound = connection.metadata?.reasoningBindings?.promptBias;
      const { prompt, breakdown } = assemble(preset, lore.entries, messages, { type, promptBias: typeof bound === "string" ? bound : this.promptBias, names, ...(goesOn !== null ? { continueMessageId: goesOn.id, continuePostfix: postfix } : {}) });
      sent = prompt;
      // The chat history as Lumiverse counts it beside the reply: the prompt's history messages before the interceptors, blank ones left out
      // (`services/generate.service.ts:1211-1215`, `:1424-1426`).
      const history = dropBlank(prompt.filter((m) => m.__chatHistorySource === true));

      // ---- the interceptors (`generate.service.ts:1217-1247`), each handed the context as its own (`host.ts`). Assembly gives activated lore
      // only when some activated (`services/prompt-assembly.service.ts:4455-4456`): with none, the context keeps what a context handler left.
      if (lore.told.length > 0) context.activatedWorldInfo = lore.told;
      delete context.__spindleWorldInfoCaptures;
      context.presetId = preset.id;
      context.presetMetadata = undefined;
      const intercepted = this.interceptors.length > 0 ? await this.interceptorPipeline(prompt, context) : { messages: prompt, parameters: undefined };
      // After the interceptors: post-processing, the blank filter, collapse, then the parameters (`:1249-1256`, `:1414-1441`).
      sent = intercepted.messages;
      if (this.postProcessing) applyPostProcessing(sent, this.postProcessing);
      sent = dropBlank(sent);
      if (preset.collapse === true) collapse(sent);
      const parameters: Record<string, unknown> = { ...preset.parameters, ...intercepted.parameters, ...input.parameters };
      if (dryRun) return { generationId: null, error: null, stopped: false, prompt: sent, body: null, reply: null, parameters, stored: null, worldInfo, breakdown: breakdown.filter((e) => e.type !== "chat_history") };
      // The counts saved into the chat's metadata, then the lore told, before the provider is called (`:2827-2879`); a dry run saves none,
      // and with no lore activated no event is sent (`:2869`).
      this.mergeChatMetadata(chat, { wi_state: wiState });
      if (lore.told.length > 0) this.emit("WORLD_INFO_ACTIVATED", { chatId: chat.id, entries: lore.told, stats: lore.stats }, chat.user);
      if (this.councilBlock !== null) sent.splice(Math.max(0, sent.length - 4), 0, { role: "system", content: this.councilBlock });
      // The streaming switch decides the call and is never sent (`generate.service.ts:3725-3726`): a stream,
      // or one whole answer in one call (`:3793-3815`).
      const streaming = parameters._streaming !== false;
      delete parameters._streaming;
      body = buildBody(connection.model, sent, parameters, streaming);
      const base = connection.base.replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/models$/, "");
      const seen: StreamSeen = { content: "", reasoning: "" };
      this.streams.set(generationId!, seen);
      let reply: StreamedReply;
      try {
        const res = await this.fetch(`${base}/chat/completions`, { method: "POST", headers: providerHeaders(connection.key), body: JSON.stringify(body), signal: stop.signal });
        reply = streaming ? await readStream(res, seen) : await readWhole(res);
      } catch (error) {
        if (!stop.signal.aborted) throw error;
        // Stopped by the user: what was streamed is saved, and the stop told (`:4502-4537`, `persistPartialContent` `:3565-3660`).
        const savedText = this.saveStopped(chat, { staged, swipeAt, original, postfix, target: target.message, swipe: target.swipe }, seen);
        this.going.delete(generationId!);
        this.emit("GENERATION_STOPPED", { generationId, chatId: chat.id, content: savedText }, chat.user);
        return { generationId, error: null, stopped: true, prompt: sent, body, reply: { content: seen.content, reasoning: seen.reasoning, finishReason: "", usage: null }, parameters, stored: null, worldInfo };
      }
      this.going.delete(generationId!);
      let messageId: string | undefined;
      let savedText = reply.content;
      const shown = (id: string): ChatMessage | undefined => chat.messages.find((m) => m.id === id);
      if (swipeAt !== null && target.message !== null) {
        // A swipe or a regenerate: the blank swipe made at the start filled in (`:4120-4128`), whichever swipe the player looks at now.
        const m = shown(target.message);
        if (m && (m.swipeId ?? 0) === swipeAt) m.content = reply.content;
        this.saveSwipe(chat, target.message, swipeAt, reply.content);
        messageId = target.message;
      } else if (original !== null && target.message !== null) {
        // A continue: the text the message held, the preset's postfix, then the new text (`:4129-4147`), into the swipe it continued,
        // which the player may have flipped away from (`contentSwipeId`).
        savedText = original + postfix + reply.content;
        const m = shown(target.message);
        if (m && (m.swipeId ?? 0) === target.swipe) m.content = savedText;
        this.saveText(chat, target.message, savedText, target.swipe ?? undefined);
        messageId = target.message;
      } else if (staged !== null) {
        // The staged message filled in (`:4148-4166`).
        const m = shown(staged);
        if (m) m.content = reply.content;
        this.saveText(chat, staged, reply.content);
        messageId = staged;
      } else if (!(type === "impersonate" && input.impersonateDraft === true)) {
        // Anything else saves a new message: an impersonation as the user's (`:4172-4194`). A draft saves none (`:4167-4171`).
        const m: ChatMessage = { id: crypto.randomUUID(), role: type === "impersonate" ? "user" : "assistant", content: reply.content };
        chat.messages.push(m);
        this.createRow(chat, m, type === "impersonate" ? "User" : chat.character.name);
        this.emit("MESSAGE_SENT", { chatId: chat.id, message: this.messageRow(m.id) ?? m }, chat.user);
        messageId = m.id;
      }
      this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, messageId, content: savedText, usage: reply.usage, generationType: type, ...(input.impersonateDraft === true && type === "impersonate" ? { impersonateDraft: true } : {}) }, chat.user);
      if (messageId === undefined) return { generationId, error: null, stopped: false, prompt: sent, body, reply, parameters, stored: null, worldInfo };
      // Stored after the generation ends, beside the reply (`:4432-4476`; `services/breakdown.service.ts:3-12`); token counts are the stand-in's own.
      const tokens = (text: string): number => Math.ceil(text.length / 4);
      const historyTokens = history.reduce((n, m) => n + tokens(textOf(m)), 0);
      const entriesStored = breakdown.map((e) => ({ name: e.name, type: e.type, tokens: e.type === "chat_history" ? historyTokens : tokens(e.content ?? ""), ...(e.role ? { role: e.role } : {}), ...(e.blockId ? { blockId: e.blockId } : {}), content: e.content }));
      const stored: Stored = {
        entries: entriesStored.filter((e) => e.type !== "chat_history"),
        chatHistoryTokens: historyTokens,
        messages: sent.map((m) => ({ role: m.role, content: textOf(m) })),
        // An entry whose text a block already holds is not counted twice (`services/tokenizer.service.ts:550-552`).
        totalTokens: entriesStored.reduce((n, e, i) => (breakdown[i]!.excludeFromTotal === true ? n : n + e.tokens), 0),
        maxContext: 0,
        model: connection.model,
        provider: "custom",
        parameters,
        usage: reply.usage,
        presetName: preset.name,
        presetId: preset.id,
      };
      this.storeBreakdown(chat, messageId, stored);
      return { generationId, error: null, stopped: false, prompt: sent, body, reply, parameters, stored, worldInfo };
    } catch (error) {
      if (error instanceof CancelledByExtension && generationId !== null) {
        // A context handler's cancel ends it as a stop does, its empty message removed and nothing saved (`:3003-3022`).
        this.going.delete(generationId);
        if (staged !== null) this.deleteMessage(chat.id, staged);
        this.emit("GENERATION_STOPPED", { generationId, chatId: chat.id, content: "" }, chat.user);
        return { generationId, error: null, stopped: true, prompt: sent, body, reply: null, parameters: null, stored: null, worldInfo };
      }
      // A failed setup or call ends the generation with its error, its empty message removed (`:2987-3048`).
      const message = error instanceof Error ? error.message : String(error);
      if (generationId !== null) this.going.delete(generationId);
      if (staged !== null) this.deleteMessage(chat.id, staged);
      if (!dryRun) this.emit("GENERATION_ENDED", { generationId, chatId: chat.id, error: message, generationType: type }, chat.user);
      return { generationId, error: message, stopped: false, prompt: sent, body, reply: null, parameters: null, stored: null, worldInfo };
    }
  }

  /** The chat's metadata as its row holds it now; the chat held in memory where there is no database. */
  private metadataOf(chat: Chat): Record<string, unknown> {
    const row = this.db?.rows("SELECT metadata FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    return row === undefined ? (chat.metadata ?? {}) : (JSON.parse(String(row.metadata)) as Record<string, unknown>);
  }

  /**
   * `mergeChatMetadataAsync` (`services/chats.service.ts:5241-5244`; `db/chat-operations.ts:22-33`, `:57-80`): each key given replaces
   * the chat's own, the row's stamp is raised, and the change is told as `CHAT_CHANGED` with the keys that differ
   * (`services/chats.service.ts:1466-1500`, `:5198-5204`).
   */
  private mergeChatMetadata(chat: Chat, partial: Record<string, unknown>): void {
    const before = this.metadataOf(chat);
    const metadata = { ...before, ...partial };
    chat.metadata = metadata;
    const changedFields = Object.keys(partial).filter((key) => !(key in before) || JSON.stringify(before[key]) !== JSON.stringify(partial[key])).map((key) => `metadata.${key}`);
    this.db?.run("UPDATE chats SET metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?", JSON.stringify(metadata), Math.floor(this.now() / 1000), chat.id, chat.user);
    const row = this.db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    const shown = row === undefined ? { id: chat.id, user_id: chat.user, character_id: chat.character.id, name: chat.name ?? "", metadata } : { ...row, metadata };
    this.emit("CHAT_CHANGED", { chat: shown, changedFields }, chat.user);
  }

  /** What a stopped generation saves (`persistPartialContent`, `services/generate.service.ts:3565-3660`), and the text it saved. */
  private saveStopped(chat: Chat, at: { staged: string | null; swipeAt: number | null; original: string | null; postfix: string; target: string | null; swipe: number | null }, seen: StreamSeen): string {
    const shown = (id: string): ChatMessage | undefined => chat.messages.find((m) => m.id === id);
    if (at.swipeAt !== null && at.target !== null) {
      const m = shown(at.target);
      if (m && (m.swipeId ?? 0) === at.swipeAt) m.content = seen.content;
      this.saveSwipe(chat, at.target, at.swipeAt, seen.content);
    } else if (at.staged !== null) {
      // A staged message with nothing in it is removed.
      if (seen.content === "" && seen.reasoning === "") this.deleteMessage(chat.id, at.staged);
      else {
        const m = shown(at.staged);
        if (m) m.content = seen.content;
        this.saveText(chat, at.staged, seen.content);
      }
    } else if (at.original !== null && at.target !== null && (seen.content !== "" || seen.reasoning !== "")) {
      // As at the end, joined by the preset's postfix (`:3638-3650`).
      const joined = at.original + at.postfix + seen.content;
      const m = shown(at.target);
      if (m && (m.swipeId ?? 0) === at.swipe) m.content = joined;
      this.saveText(chat, at.target, joined, at.swipe ?? undefined);
      return joined;
    }
    return seen.content;
  }
}

/** `GenerationCancelledByExtensionError` (`services/generate.service.ts:525-530`). */
class CancelledByExtension extends Error {
  constructor() {
    super("Generation cancelled by extension context handler");
    this.name = "GenerationCancelledByExtension";
  }
}
