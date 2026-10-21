// HostPort over the `spindle` global (ARCHITECTURE §7). The only backend file besides the entry
// that touches the host API: it decodes host payloads into the port's shapes (DESIGN §3:
// event payloads carry no userId; handlers receive it as the second argument) and maps the port's
// calls onto `lumiverse-spindle-types` 0.6.49 plus the local augmentation.

import type { GenerationReasoningOverrideDTO, PromptBlockDTO, PromptBlockSnapshotDTO, WorldBookEntryCreateDTO, WorldBookEntryDTO } from "lumiverse-spindle-types";
import type { HostSpindleAPI, RegexScriptInput } from "../spindle-augment";
import type { HostPresetBlockInput } from "./host";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { ChatId, UserId } from "../shared/ids";
import type { ReasoningChoice } from "../shared/settings";
import { TimeoutFired, timerMs } from "../shared/timeouts";
import type { Answer, Answers } from "../engine/decide";
import type {
  ActivatedEntry,
  ContextHandlerInput,
  HostBookEntry,
  HostBookEntryInput,
  HostChat,
  HostEventMap,
  HostEventName,
  HostGenerationType,
  HostMessage,
  HostPort,
  HostCapabilities,
  HostRegexScript,
  QuietToolCall,
  SwipeAction,
} from "./host";

declare const spindle: HostSpindleAPI;

// ---------------------------------------------------------------- decoding

/** A deep copy of host data as JSON (dropping functions, undefined and non-finite numbers). */
export function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) return toJsonObject(value);
  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  const out: JsonObject = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") out[k] = toJson(v);
  return out;
}

function str(o: unknown, key: string): string | undefined {
  if (!isRecord(o)) return undefined;
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function num(o: unknown, key: string): number | undefined {
  if (!isRecord(o)) return undefined;
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const GENERATION_TYPES: Record<string, HostGenerationType> = { normal: "normal", regenerate: "regenerate", swipe: "swipe", continue: "continue", impersonate: "impersonate" };

function generationType(o: unknown): HostGenerationType {
  return GENERATION_TYPES[str(o, "generationType") ?? "normal"] ?? "normal";
}

/** A generation context's type; one the engine doesn't play (the host's `quiet`) is `other`. */
function contextType(o: unknown): HostGenerationType | "other" {
  const type = str(o, "generationType");
  return type === undefined ? "normal" : (GENERATION_TYPES[type] ?? "other");
}

/**
 * What this Lumiverse does with the guard's answer: `cancelGeneration` under the
 * `preAssemblyGenerationContext` contract (worker-runtime.ts:4201-4203 on staging 7524546f), and
 * `required` under the `required-context-handlers-v1` capability (worker-host.ts:1328).
 */
function hostCapabilities(): HostCapabilities {
  const contracts: Readonly<Record<string, number>> = spindle.contracts ?? {};
  const capabilities: Readonly<Record<string, number>> = spindle.host?.capabilities ?? {};
  return { cancel: (contracts.preAssemblyGenerationContext ?? 0) >= 1, required: (capabilities["required-context-handlers-v1"] ?? 0) >= 1, sessions: (capabilities["frontend-session-routing-v1"] ?? 0) >= 1 };
}

/** A World Info entry as the port reads it. */
function bookEntryOf(e: WorldBookEntryDTO): HostBookEntry {
  return { id: e.id, bookId: e.world_book_id, comment: e.comment, content: e.content, keys: [...e.key], disabled: e.disabled, constant: e.constant, position: e.position, depth: e.depth, role: e.role, order: e.order_value, extensions: toJsonObject(e.extensions) };
}

/** A host message (`getMessages` row or event DTO). `spindle_metadata` arrives as `metadata` or inside `extra`. */
export function decodeMessage(raw: unknown, chatId: ChatId): HostMessage | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, "id");
  if (!id) return null;
  const swipes = Array.isArray(raw.swipes) ? raw.swipes.map((s) => (typeof s === "string" ? s : "")) : [];
  const content = str(raw, "content") ?? "";
  const swipeId = num(raw, "swipe_id") ?? 0;
  if (swipes.length === 0) swipes.push(content);
  const extra = isRecord(raw.extra) ? raw.extra : {};
  const metadata = isRecord(raw.metadata) ? raw.metadata : isRecord(extra.spindle_metadata) ? extra.spindle_metadata : {};
  const role = str(raw, "role");
  return {
    id,
    chatId: str(raw, "chat_id") ?? chatId,
    index: num(raw, "index_in_chat") ?? 0,
    isUser: raw.is_user === true || role === "user",
    name: str(raw, "name") ?? "",
    content,
    swipeId,
    swipes,
    metadata: toJsonObject(metadata),
  };
}

const SWIPE_ACTIONS: Record<string, SwipeAction> = { added: "added", navigated: "navigated", updated: "updated", deleted: "deleted" };

/** A host event's payload as the engine reads it; null when it isn't one (the fake host replays Lumiverse's raw payloads through it). */
export function decodeEvent<K extends HostEventName>(event: K, p: unknown): HostEventMap[K] | null;
export function decodeEvent(event: HostEventName, p: unknown): HostEventMap[HostEventName] | null {
  // A preset or a setting written, or a page closed, belongs to no chat (`{ id, preset }`, `{ key, value }`, `{ frontendSessionId }`).
  if (event === "PRESET_CHANGED") return { presetId: str(p, "id") ?? null };
  if (event === "SETTINGS_UPDATED") {
    // A batch write (`settings.putMany`, how Lumiverse's pages save) names its keys in `keys`.
    const key = str(p, "key");
    const keys = isRecord(p) && Array.isArray(p.keys) ? p.keys.filter((k): k is string => typeof k === "string") : null;
    return { keys: key !== undefined ? [key] : keys };
  }
  if (event === "FRONTEND_SESSION_CLOSED") {
    const frontendSessionId = str(p, "frontendSessionId");
    return frontendSessionId ? { frontendSessionId } : null;
  }
  // CHAT_DELETED names its chat `id`; every other event, `chatId`.
  const chatId = str(p, event === "CHAT_DELETED" ? "id" : "chatId");
  if (!chatId) return null;
  switch (event) {
    case "GENERATION_STARTED":
    case "GENERATION_IN_PROGRESS": {
      const generationId = str(p, "generationId");
      if (!generationId) return null;
      const base = {
        generationId,
        chatId,
        model: str(p, "model") ?? "",
        targetMessageId: str(p, "targetMessageId") ?? null,
        targetSwipeId: num(p, "targetSwipeId") ?? null,
        characterId: str(p, "characterId") ?? null,
        characterName: str(p, "characterName") ?? null,
      };
      if (event === "GENERATION_IN_PROGRESS") return base;
      const frontendSessionId = str(p, "frontendSessionId");
      return { ...base, generationType: generationType(p), ...(frontendSessionId ? { frontendSessionId } : {}) };
    }
    case "GENERATION_ENDED": {
      const generationId = str(p, "generationId");
      if (!generationId) return null;
      const messageId = str(p, "messageId");
      const error = str(p, "error");
      const finish = str(p, "finish_reason");
      const draft = str(p, "impersonateDraft");
      return {
        generationId,
        chatId,
        content: str(p, "content") ?? "",
        generationType: generationType(p),
        ...(messageId ? { messageId } : {}),
        ...(error ? { error } : {}),
        ...(finish ? { finish_reason: finish } : {}),
        ...(draft !== undefined ? { impersonateDraft: draft } : {}),
        ...(isRecord(p) && isRecord(p.usage) ? { usage: toJsonObject(p.usage) } : {}),
      };
    }
    case "GENERATION_STOPPED": {
      const generationId = str(p, "generationId");
      return generationId ? { generationId, chatId, content: str(p, "content") ?? "" } : null;
    }
    case "MESSAGE_SENT":
    case "MESSAGE_EDITED": {
      const message = decodeMessage(isRecord(p) ? p.message : null, chatId);
      return message ? { chatId, message } : null;
    }
    case "MESSAGE_SWIPED": {
      const message = decodeMessage(isRecord(p) ? p.message : null, chatId);
      const action = SWIPE_ACTIONS[str(p, "action") ?? ""];
      if (!message || !action) return null;
      const previousSwipeId = num(p, "previousSwipeId");
      return { chatId, message, action, swipeId: num(p, "swipeId") ?? message.swipeId, ...(previousSwipeId !== undefined ? { previousSwipeId } : {}) };
    }
    case "CHAT_DELETED":
      return { chatId };
    case "MESSAGE_DELETED": {
      const messageId = str(p, "messageId");
      return messageId ? { chatId, messageId } : null;
    }
    case "WORLD_INFO_ACTIVATED": {
      const entries: ActivatedEntry[] = [];
      if (isRecord(p) && Array.isArray(p.entries)) {
        for (const e of p.entries) {
          const id = str(e, "id");
          if (id) entries.push({ id, comment: str(e, "comment") ?? "", source: str(e, "source") ?? "", bookId: str(e, "bookId") ?? "" });
        }
      }
      return { chatId, entries, stats: isRecord(p) && isRecord(p.stats) ? toJsonObject(p.stats) : {} };
    }
  }
}

function decodeAnswer(raw: unknown): Answer | null {
  const type = str(raw, "type");
  if (!isRecord(raw)) return null;
  const probabilities: Record<string, number> = {};
  if (isRecord(raw.probabilities)) for (const [k, v] of Object.entries(raw.probabilities)) if (typeof v === "number") probabilities[k] = v;
  if (type === "choice") return { type, choice: str(raw, "choice") ?? "", probabilities, confidence: num(raw, "confidence") ?? 0 };
  if (type === "score") return { type, score: num(raw, "score") ?? 0, probabilities, confidence: num(raw, "confidence") ?? 0 };
  if (type === "noul") return { type, noul: num(raw, "noul") ?? 0.5 };
  return null;
}

function usageTokens(raw: unknown): number {
  if (!isRecord(raw) || !isRecord(raw.usage)) return 0;
  const u = raw.usage;
  const total = num(u, "total_tokens");
  if (total !== undefined) return total;
  return (num(u, "input_tokens") ?? num(u, "prompt_tokens") ?? 0) + (num(u, "output_tokens") ?? num(u, "completion_tokens") ?? 0);
}

/** An entry as the host creates it; its outlet goes into `extensions.outlet_name`, where the host reads it. */
export function entryInput(entry: HostBookEntryInput): WorldBookEntryCreateDTO {
  return {
    comment: entry.comment,
    content: entry.content,
    key: entry.keys,
    disabled: entry.disabled,
    constant: entry.constant,
    position: entry.position,
    depth: entry.depth,
    ...(entry.role !== null ? { role: entry.role } : {}),
    order_value: entry.order,
    extensions: entry.outlet ? { ...entry.extensions, outlet_name: entry.outlet } : entry.extensions,
  };
}

/** Extension storage file mirroring system log lines (Settings → diagnostics; integration checks). */
export const DIAGNOSTICS_LOG = "diagnostics/backend.log";
/** Each user's own diagnostics, in their user storage: lines about their chats. */
export const USER_DIAGNOSTICS_LOG = "diagnostics.log";

/**
 * Providers whose APIs take OpenAI's JSON mode (`response_format`). Lumiverse passes the field
 * through as is, and Anthropic's and Google's APIs reject it, so any other provider gets the
 * prompt's "Output JSON only" (and the read's repair) alone.
 */
const JSON_MODE_PROVIDERS: ReadonlySet<string> = new Set(["openai", "deepseek", "openrouter", "mistral", "xai", "groq", "fireworks", "moonshot", "zai", "siliconflow"]);

/** Whether the call's connection (the user's default when it names none) takes JSON mode. */
async function takesJsonMode(connectionId: string | null | undefined, userId: string): Promise<boolean> {
  const list = await spindle.connections.list(userId);
  const c = connectionId ? list.find((x) => x.id === connectionId) : list.find((x) => x.is_default);
  return c !== undefined && JSON_MODE_PROVIDERS.has(c.provider);
}

/**
 * A call's effort as the host's per-request reasoning override: none for `inherit` (the
 * connection's reasoning binding, else the user's setting, stands), the off-switch for `off`, else
 * that effort, which the host maps to the provider's own field.
 */
export function reasoningOverride(effort: ReasoningChoice | undefined): GenerationReasoningOverrideDTO | undefined {
  if (effort === undefined || effort === "inherit") return undefined;
  return effort === "off" ? { source: "off" } : { source: "custom", apiReasoning: true, effort };
}

/** Keeps the last log lines and writes them, debounced: system lines to extension storage, user lines to that user's storage. */
class DiagnosticsLog {
  private readonly lines: string[] = [];
  private readonly users = new Map<UserId, string[]>();
  private readonly dirty = new Set<UserId | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  add(level: string, message: string, userId?: UserId, turn?: string): void {
    // Fixed-width level and the turn's short id, so a turn's lines can be picked out of the file.
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${turn ? `[turn ${turn.slice(0, 8)}] ` : ""}${message}`;
    const list = userId ? (this.users.get(userId) ?? []) : this.lines;
    list.push(line);
    if (list.length > 1000) list.splice(0, list.length - 1000);
    if (userId) {
      this.users.set(userId, list);
      if (this.users.size > 256) this.users.delete(this.users.keys().next().value ?? "");
    }
    this.dirty.add(userId ?? null);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const who of this.dirty) {
        if (who === null) void spindle.storage.write(DIAGNOSTICS_LOG, `${this.lines.join("\n")}\n`).catch(() => undefined);
        else void spindle.userStorage.write(USER_DIAGNOSTICS_LOG, `${(this.users.get(who) ?? []).join("\n")}\n`, who).catch(() => undefined);
      }
      this.dirty.clear();
    }, 1000);
  }
}

/** The user's regex scripts on one scope (with `chat` and no `scopeId`, every chat's), paged through. */
async function listScripts(options: { scope: "chat" | "global"; scopeId?: string }, userId: string): Promise<HostRegexScript[]> {
  const out: HostRegexScript[] = [];
  for (let offset = 0; offset < 100_000; offset += 200) {
    const page = await spindle.regex_scripts.list({ ...options, limit: 200, offset, userId });
    for (const s of page.data) {
      const chatId = s.scope === "chat" ? s.scope_id : null;
      if (s.scope !== options.scope || (s.scope === "chat" && !chatId)) continue;
      out.push({ id: s.id, chatId, mine: s.can_mutate, findRegex: s.find_regex, replaceString: s.replace_string, flags: s.flags, placement: [...s.placement], targets: Array.isArray(s.target) ? [...s.target] : [s.target], runOnEdit: s.run_on_edit, sortOrder: s.sort_order, metadata: toJsonObject(s.metadata) });
    }
    if (page.data.length < 200 || offset + page.data.length >= page.total) break;
  }
  return out;
}

// ---------------------------------------------------------------- the port

export function createSpindleHost(): HostPort {
  const diagnostics = new DiagnosticsLog();
  return {
    chats: {
      async messages(chatId) {
        const rows = await spindle.chat.getMessages(chatId);
        const out: HostMessage[] = [];
        for (const row of rows) {
          const m = decodeMessage(row, chatId);
          if (m) out.push(m);
        }
        return out.sort((a, b) => a.index - b.index);
      },
      async writeMetadata(chatId, messageId, bag) {
        await spindle.chat.updateMessage(chatId, messageId, { metadata: bag });
      },
      async chatMetadata(chatId, userId) {
        const chat = await spindle.chats.get(chatId, userId);
        return toJsonObject(chat?.metadata);
      },
      async mergeChatMetadata(chatId, patch, userId) {
        const chat = await spindle.chats.get(chatId, userId);
        if (!chat) throw new Error(`chat ${chatId} not found`);
        await spindle.chats.update(chatId, { metadata: { ...toJsonObject(chat.metadata), ...patch } }, userId);
      },
      async appendUserMessage(chatId, content, metadata, triggerGeneration) {
        const result = await spindle.chat.appendMessage(chatId, { role: "user", content, metadata }, { triggerGeneration });
        return result.id;
      },
      async active(userId) {
        return (await spindle.chats.getActive(userId))?.id ?? null;
      },
      async setSwipes(chatId, messageId, swipes, swipeId) {
        await spindle.chat.updateMessage(chatId, messageId, { swipes: [...swipes], swipe_id: swipeId });
      },
      // The host lists the newest first by offset, so the list shifts while it is read: a chat
      // updated or made meanwhile moves to the front, and one deleted moves the rest up. The pages
      // overlap, so a few shifts between two reads skip nothing, and the front is read again until
      // it shows nothing new, which takes in the chats that moved there.
      async list(userId) {
        const out = new Map<ChatId, HostChat>();
        const read = async (offset: number): Promise<{ size: number; total: number; fresh: number }> => {
          const page = await spindle.chats.list({ limit: 200, offset, userId });
          let fresh = 0;
          for (const chat of page.data) {
            if (out.has(chat.id)) continue;
            out.set(chat.id, { id: chat.id, name: chat.name, metadata: toJsonObject(chat.metadata) });
            fresh++;
          }
          return { size: page.data.length, total: page.total, fresh };
        };
        for (let offset = 0; offset < 100_000; offset += 180) {
          const page = await read(offset);
          if (page.size < 200 || offset + 200 >= page.total) break;
        }
        for (let pass = 0; pass < 5 && (await read(0)).fresh > 0; pass++);
        return [...out.values()];
      },
    },
    storage: {
      async read(path, userId) {
        if (!(await spindle.userStorage.exists(path, userId))) return null;
        return spindle.userStorage.read(path, userId);
      },
      write: (path, data, userId) => spindle.userStorage.write(path, data, userId),
      move: (from, to, userId) => spindle.userStorage.move(from, to, userId),
      remove: (path, userId) => spindle.userStorage.delete(path, userId),
      // The host lists files recursively under the prefix directory, relative to it (seen on a real
      // host: "w_x/index.json" for "worlds/"); the port promises full storage paths.
      async list(prefix, userId) {
        const base = prefix.replace(/\/+$/, "");
        return (await spindle.userStorage.list(prefix, userId)).map((entry) => {
          const rel = entry.split("\\").join("/");
          return base === "" ? rel : `${base}/${rel}`;
        });
      },
    },
    extensionStorage: {
      async read(path) {
        if (!(await spindle.storage.exists(path))) return null;
        return spindle.storage.read(path);
      },
      write: (path, data) => spindle.storage.write(path, data),
    },
    on(event, handler) {
      return spindle.on(event, (payload: unknown, userId?: string) => {
        const decoded = decodeEvent(event, payload);
        if (decoded) handler(decoded, userId ?? null);
      });
    },
    capabilities: hostCapabilities(),
    registerContextHandler(handler, options) {
      spindle.registerContextHandler(
        async (context: unknown, signal?: AbortSignal) => {
          const chatId = str(context, "chatId");
          const userId = str(context, "userId");
          if (!chatId || !userId) return context;
          const input: ContextHandlerInput = {
            chatId,
            userId,
            generationType: contextType(context),
            dryRun: isRecord(context) && context.dryRun === true,
            connectionId: str(context, "connectionId") ?? null,
            personaId: str(context, "personaId") ?? null,
          };
          const session = str(context, "frontendSessionId");
          if (session) input.frontendSessionId = session;
          const verdict = await handler(input, signal ?? new AbortController().signal);
          return verdict === "cancel" && isRecord(context) ? { ...context, cancelGeneration: true } : context;
        },
        100,
        { timeoutMs: options.timeoutMs, required: options.required },
      );
    },
    models: {
      async quiet(request, userId, signal) {
        // The host merges these over the connection's preset parameters, so one left out stays the connection's own.
        const parameters: Record<string, unknown> = { ...request.params, max_tokens: request.maxTokens };
        if (request.json && (await takesJsonMode(request.connectionId, userId))) parameters.response_format = { type: "json_object" };
        // The host reads `parameters.model` as a per-request model override.
        if (request.model) parameters.model = request.model;
        const reasoning = reasoningOverride(request.effort);
        const raw = await spindle.generate.quiet({
          type: "quiet",
          messages: request.messages,
          parameters,
          ...(request.connectionId ? { connection_id: request.connectionId } : {}),
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) } : {}),
          ...(reasoning ? { reasoning } : {}),
          userId,
          signal,
        });
        // `tool_calls` (`ToolCallDTO[]`): a call without a name is dropped; arguments that aren't an object read as none.
        const calls = isRecord(raw) && Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
        const toolCalls: QuietToolCall[] = calls.flatMap((c, i) => (isRecord(c) && typeof c.name === "string" ? [{ name: c.name, args: toJsonObject(c.args), callId: str(c, "call_id") ?? `call_${i}` }] : []));
        const usage = isRecord(raw) && isRecord(raw.usage) ? raw.usage : null;
        const tokensIn = usage ? (num(usage, "input_tokens") ?? num(usage, "prompt_tokens")) : undefined;
        const tokensOut = usage ? (num(usage, "output_tokens") ?? num(usage, "completion_tokens")) : undefined;
        const model = str(raw, "model");
        return { content: str(raw, "content") ?? "", finishReason: str(raw, "finish_reason") ?? "", tokens: usageTokens(raw), ...(tokensIn !== undefined ? { tokensIn } : {}), ...(tokensOut !== undefined ? { tokensOut } : {}), ...(model ? { model } : {}), ...(toolCalls.length > 0 ? { toolCalls } : {}) };
      },
      async decide(request, userId, signal) {
        // The Decision API takes text, a list or an object as state; scalars go as their text.
        const s = request.state;
        const state = s === null || typeof s === "number" || typeof s === "boolean" ? String(s) : s;
        const raw = await spindle.decisions.evaluate(
          { state, questions: request.questions, ...(request.connectionId ? { connection_id: request.connectionId } : {}), ...(request.model ? { model: request.model } : {}), userId },
          { signal },
        );
        const answers: Answers = {};
        for (const [key, value] of Object.entries(raw.answers)) {
          const answer = decodeAnswer(value);
          if (answer) answers[key] = answer;
        }
        return { answers, model: raw.model, tokens: usageTokens(raw) };
      },
    },
    tokens: {
      // One countText per text, in parallel: the host counts with the user's main model, as its prompt
      // breakdown does (operator scope needs the userId). A tokenizer still loading can take seconds,
      // so a count slower than the user's limit rejects with its TimeoutFired; a limit of 0 asks for
      // none, and a failed or malformed count is no count.
      async count(texts, userId, limit) {
        if (limit === 0) return null;
        const counted = Promise.all(texts.map((text) => spindle.tokens.countText(text, { userId }))).then((rows) => rows.map((r) => r.total_tokens));
        const ms = timerMs(limit);
        const late =
          ms === null
            ? null
            : new Promise<never>((_resolve, reject) => {
                const timer = setTimeout(() => reject(new TimeoutFired("tokenCountMs", ms)), ms);
                void counted.finally(() => clearTimeout(timer)).catch(() => undefined);
              });
        let counts: number[];
        try {
          counts = await (late ? Promise.race([counted, late]) : counted);
        } catch (error) {
          if (error instanceof TimeoutFired) throw error;
          return null;
        }
        return counts.every((n) => Number.isInteger(n) && n >= 0) ? counts : null;
      },
    },
    frontend: {
      send(message, userId, frontendSessionId) {
        spindle.sendToFrontend(message, userId ?? undefined, frontendSessionId ? { frontendSessionId } : undefined);
      },
      onMessage(handler) {
        return spindle.onFrontendMessage(handler);
      },
      closeDrawer: (userId: UserId) => spindle.ui.closeDrawer({ userId }),
    },
    toast: (message, userId) => spindle.toast.info(message, { title: "LumiRPEngine", userId }),
    books: {
      async create(name, description, userId) {
        const book = await spindle.world_books.create({ name, description, metadata: { lumi_rp_engine: true } }, userId);
        return book.id;
      },
      async exists(bookId, userId) {
        return (await spindle.world_books.get(bookId, userId)) !== null;
      },
      async list(userId) {
        const out: { id: string; name: string; engine: boolean }[] = [];
        for (let offset = 0; offset < 100_000; offset += 200) {
          const page = await spindle.world_books.list({ limit: 200, offset, userId });
          for (const b of page.data) out.push({ id: b.id, name: b.name, engine: isRecord(b.metadata) && b.metadata.lumi_rp_engine === true });
          if (page.data.length < 200 || out.length >= page.total) break;
        }
        return out;
      },
      async entries(bookId, userId) {
        const out: HostBookEntry[] = [];
        for (let offset = 0; offset < 100_000; offset += 200) {
          const page = await spindle.world_books.entries.list(bookId, { limit: 200, offset, userId });
          for (const e of page.data) out.push(bookEntryOf(e));
          if (page.data.length < 200 || out.length >= page.total) break;
        }
        return out;
      },
      async entry(entryId, userId) {
        const e = await spindle.world_books.entries.get(entryId, userId);
        return e ? bookEntryOf(e) : null;
      },
      async createEntry(bookId, entry, userId) {
        const created = await spindle.world_books.entries.create(bookId, entryInput(entry), userId);
        return created.id;
      },
      async place(entryId, placement, extensions, userId) {
        // The outlet goes beside the other fields: an update keeps the entry's old one otherwise.
        await spindle.world_books.entries.update(entryId, { position: placement.position, depth: placement.depth, role: placement.role, outlet_name: placement.outlet, extensions }, userId);
      },
      async fill(entryId, content, userId) {
        // Only these three fields: where the entry sits, its outlet and its extension data stay.
        await spindle.world_books.entries.update(entryId, content === null ? { content: "", disabled: true, constant: false } : { content, disabled: false, constant: true }, userId);
      },
      async deleteEntry(entryId, userId) {
        await spindle.world_books.entries.delete(entryId, userId);
      },
    },
    async dryRun(chatId, userId) {
      const result = await spindle.generate.dryRun({ chatId }, userId);
      const p = result.parameters;
      const max = [p.max_tokens, p.maxTokens, p.max_new_tokens, p.max_output_tokens].find((v): v is number => typeof v === "number" && Number.isFinite(v));
      return {
        messages: result.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
        blocks: result.breakdown.filter((b) => b.type === "block").map((b) => ({ id: b.blockId ?? null, name: b.name, content: b.content ?? "" })),
        maxTokens: max ?? null,
        model: result.model,
      };
    },
    presets: {
      async get(presetId, userId) {
        const preset = await spindle.presets.get(presetId, userId);
        return preset ? { id: preset.id, name: preset.name, revision: preset.cache_revision } : null;
      },
      async active(chatId, userId) {
        // `presets.getActive` (staging 7524546f, worker-runtime.ts:2940) is newer than the published types.
        const presets: unknown = spindle.presets;
        const getActive = isRecord(presets) ? presets.getActive : undefined;
        if (typeof getActive !== "function") throw new Error("this Lumiverse can't say which preset a chat generates with");
        const call = getActive as unknown as (this: unknown, chatId?: string, userId?: string) => Promise<unknown>;
        const raw = await call.call(presets, chatId ?? undefined, userId);
        const states = isRecord(raw) && isRecord(raw.block_states) ? raw.block_states : {};
        const blockStates: Record<string, boolean> = {};
        for (const [id, on] of Object.entries(states)) if (typeof on === "boolean") blockStates[id] = on;
        return { presetId: str(raw, "preset_id") ?? null, blockStates };
      },
      async blocks(presetId, userId) {
        return (await spindle.presets.blocks.list(presetId, userId)).map((b) => ({
          id: b.id,
          name: b.name,
          content: b.content,
          enabled: b.enabled,
          marker: b.marker,
          injectionTrigger: [...(b.injectionTrigger ?? [])],
          // The host keeps a block's character tag trigger beside the published fields.
          characterTagTrigger: "characterTagTrigger" in b && Array.isArray(b.characterTagTrigger) ? b.characterTagTrigger.filter((t): t is string => typeof t === "string") : [],
          categoryMode: b.categoryMode === "radio" || b.categoryMode === "checkbox" ? b.categoryMode : null,
        }));
      },
      async insertBlocks(presetId, revision, at, blocks, userId) {
        // One write of the stored blocks as they are (`spliceBlocks`), at the revision they were read at.
        const preset = await spindle.presets.get(presetId, userId);
        if (!preset) throw new Error("the preset is gone");
        if (preset.cache_revision !== revision) throw new Error("the preset changed while the blocks were being added; try again");
        await spindle.presets.update(presetId, { prompt_order: spliceBlocks(preset.prompt_order, at, blocks, () => crypto.randomUUID()), expected_cache_revision: revision }, userId);
      },
    },
    connections: {
      async active(userId) {
        const c = (await spindle.connections.list(userId)).find((x) => x.is_default);
        return c ? { id: c.id, name: c.name } : null;
      },
    },
    regex: {
      async chatScripts(chatId, userId) {
        return listScripts({ scope: "chat", ...(chatId ? { scopeId: chatId } : {}) }, userId);
      },
      async globalScripts(userId) {
        return listScripts({ scope: "global" }, userId);
      },
      async write(id, script, userId) {
        const input: RegexScriptInput = {
          name: script.name,
          script_id: script.scriptId,
          find_regex: script.findRegex,
          replace_string: script.replaceString,
          flags: script.flags,
          placement: [...script.placement],
          target: [...script.targets],
          scope: script.chatId === null ? "global" : "chat",
          scope_id: script.chatId,
          run_on_edit: script.runOnEdit,
          sort_order: script.sortOrder,
          substitute_macros: "none",
          description: script.description,
          folder: script.folder,
          metadata: script.metadata,
        };
        return (id === null ? await spindle.regex_scripts.create(input, userId) : await spindle.regex_scripts.update(id, input, userId)).id;
      },
      async remove(id, userId) {
        await spindle.regex_scripts.delete(id, userId);
      },
    },
    processes: {
      async spawn(options) {
        const handle = await spindle.backendProcesses.spawn({ entry: options.entry, kind: options.kind, key: options.key, payload: options.payload, userId: options.userId, startupTimeoutMs: options.startupMs, heartbeatTimeoutMs: options.heartbeatMs, replaceExisting: true });
        return { processId: handle.processId, send: (payload: unknown) => handle.send(payload), stop: () => handle.stop() };
      },
      onMessage(handler) {
        return spindle.backendProcesses.onMessage((e) => handler({ processId: e.processId, key: "", payload: e.payload }));
      },
      onLifecycle(handler) {
        return spindle.backendProcesses.onLifecycle((e) => handler({ processId: e.processId, key: e.key ?? "", state: e.state, ...(e.error ? { error: e.error } : {}) }));
      },
    },
    rpc: {
      handle(channel, requires, handler) {
        spindle.rpcPool.handle(channel, ({ requesterExtensionId }) => handler(requesterExtensionId), { requires: [...requires] });
      },
      unregister: (channel) => spindle.rpcPool.unregister(channel),
      read: (endpoint) => spindle.rpcPool.read(endpoint),
    },
    log(level, message, userId, turn) {
      if (level === "error") spindle.log.error(message);
      else if (level === "warn") spindle.log.warn(message);
      else if (level === "info") spindle.log.info(message);
      diagnostics.add(level, message, userId, turn);
    },
  };
}

/**
 * The preset's stored blocks with `blocks` inserted at `at` (null: the end). Each stored block is kept
 * exactly as stored: written through the host's block API instead, every block goes through its
 * normalizer, which drops what it doesn't know, a sealed block's protection among it. The new ones are
 * complete, as that normalizer would make them, and a guidance block stays switched off: the engine
 * reads it, the narrator never does.
 */
export function spliceBlocks(stored: readonly PromptBlockSnapshotDTO[], at: number | null, blocks: readonly HostPresetBlockInput[], newId: () => string): PromptBlockSnapshotDTO[] {
  const added = blocks.map((b): PromptBlockDTO => ({ id: newId(), name: b.name, content: b.kind === "text" ? b.content : "", role: "system", enabled: b.kind === "category", position: "pre_history", depth: 0, marker: b.kind === "category" ? "category" : null, isLocked: false, color: null, injectionTrigger: [], group: null, categoryMode: b.kind === "category" ? "checkbox" : null }));
  const index = at === null ? stored.length : Math.max(0, Math.min(stored.length, at));
  return [...stored.slice(0, index), ...added, ...stored.slice(index)];
}
