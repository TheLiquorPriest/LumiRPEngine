// LumiAH's real backend and core, mounted in the engine as production mounts them
// (`backend/harness/mount.ts`), over the fake Lumiverse every other test plays on. LumiAH is given
// Lumiverse through its own `BackendHost`: this file is that host, made from the same `FakeHost` the
// engine talks to, so both hear one Lumiverse's events in the order it says them, read one chat and
// write one user storage.
//
// A seat is one extension's place in that Lumiverse: its identifier, its own storage, its own entry
// on a message, its interceptor among the others'. The engine's seat is the one LumiAH is mounted
// in; a test that installs LumiAH itself beside the engine gives it a seat of its own.
//
// Nothing here is a model. An agent's call is made in the runtime the seat's backend links
// (`runtime-bed.ts`), through the runtime's own model layer, which takes each call's answer from the
// seat's `script` (`runtime-models.ts`). A test answers with a cast: each agent has a part, known by
// what its call holds (the tools it offers, what it was told), and its lines in order.

import type { ModelRequest, ModelToolCall } from "lumi-ah/core";
import type { Backend, BackendEnv, BackendHost, GenerationEnded, GenerationStarted, GenerationStopped, HostConnection, HostGenerationType, InterceptorInput, InterceptorVerdict, PromptMessage, SwipeChanged } from "lumi-ah/extension/backend";
import { UI_VERSION } from "lumi-ah/shared";
import { mountHarness } from "../../src/backend/harness/mount";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import { ENGINE_EXTENSION } from "../../src/shared/protocol";
import type { HostEventName } from "../../src/backend/host";
import type { FakeHost, Generation } from "./fake-host";
import { hostChatOf, hostMessageOf, lumiverseRows, rowToChat, rowToMessage } from "./lumiverse-rows";
import type { Rig } from "./rig";

/** What a part answers a call with: text, tool calls, or a failure in the provider's words; with the reasoning the model thought first, where a test gives one. */
export type Answer = string | { content?: string; reasoning?: string; toolCalls?: ModelToolCall[]; error?: string };

/** One line of a part: an answer, or what gives it once the call is in (a test holds a call open by answering it later). */
export type Line = Answer | ((request: ModelRequest) => Answer | Promise<Answer>);

/** One agent's part: its name in the test, how its calls are known, and what it answers, call by call. */
export interface Part {
  name: string;
  is(request: ModelRequest): boolean;
  lines: Line[];
}

export interface Cast {
  script(request: ModelRequest): Promise<Answer>;
  /** The calls a part has taken so far, in order, as the model was sent them. */
  calls(part: string): ModelRequest[];
  /** How many of a part's lines are still unsaid. */
  left(part: string): number;
}

let made = 0;
export const toolCall = (name: string, args: JsonObject, callId = `call_${name}_${++made}`): ModelToolCall => ({ name, args, callId });

/** Every message of a call as one text, to look for what an agent was told. */
export const heard = (request: ModelRequest | undefined): string => (request?.messages ?? []).map((m) => [m.content, ...(m.parts ?? []).map((p) => (p.type === "text" ? p.text : p.type === "tool_result" ? p.content : ""))].join("\n")).join("\n");

/** What its tools answered an agent, as its next call was sent them: the text of each tool result, in order. */
export const results = (request: ModelRequest | undefined): string[] => (request?.messages ?? []).flatMap((m) => (m.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : [])));

/** The call offers this tool: `write_reply` is the main agent's alone, so it tells the main agent from every other. */
export const offers =
  (tool: string) =>
  (request: ModelRequest): boolean =>
    request.tools?.some((t) => t.name === tool) === true;

/** The call holds this text: an agent's own instructions, or the task it was handed. */
export const told =
  (text: string) =>
  (request: ModelRequest): boolean =>
    heard(request).includes(text);

/** A part's line held behind a switch: its call waits until `open()` is called. */
export function gate(): { held(answer: Answer): () => Promise<Answer>; open(): void; readonly waiting: number } {
  const { promise, resolve } = Promise.withResolvers<void>();
  let waiting = 0;
  return {
    held: (answer) => async () => {
      waiting++;
      await promise;
      waiting--;
      return answer;
    },
    open: () => resolve(),
    get waiting() {
      return waiting;
    },
  };
}

/** The parts of one test, the first whose `is` holds taking a call: name the narrower part first. */
export function cast(...parts: Part[]): Cast {
  const taken = new Map<string, ModelRequest[]>(parts.map((part) => [part.name, []]));
  return {
    async script(request) {
      const part = parts.find((p) => p.is(request));
      if (part === undefined) throw new Error(`no part takes this call (it starts: ${JSON.stringify((request.messages[0]?.content ?? "").slice(0, 120))}; it offers ${(request.tools ?? []).length} tools)`);
      const calls = taken.get(part.name) ?? [];
      const line = part.lines[calls.length];
      calls.push(request);
      taken.set(part.name, calls);
      if (line === undefined) throw new Error(`${part.name} has no line for its call ${calls.length}`);
      return typeof line === "function" ? line(request) : line;
    },
    calls: (part) => [...(taken.get(part) ?? [])],
    left: (part) => (parts.find((p) => p.name === part)?.lines.length ?? 0) - (taken.get(part)?.length ?? 0),
  };
}

/** A request of LumiAH's page contract that was refused, with the contract's code, the words the page shows, and what it found wrong with a value where it says. */
export class PageRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly problems: unknown = undefined,
  ) {
    super(problems === undefined ? message : `${message} ${JSON.stringify(problems)}`);
    this.name = "PageRefused";
  }
}

/** The connection every chat of the bed generates on: Lumiverse's own, and no loopback. */
const CONNECTION: HostConnection = { id: "conn-main", name: "Main", provider: "openai", url: "https://models.example.invalid/v1", model: "test-model", isDefault: true, metadata: {} };

/** The permissions a manifest asks for and a user has granted, unless a test takes one away. Not `cors_proxy`, which only Lumiverse's owner or an admin grants: a test that wants it grants it. */
const GRANTED = ["interceptor", "chats", "chat_mutation", "generation", "generation_parameters", "world_books", "presets", "connection_profiles", "mcp_servers", "embeddings", "memories", "databanks", "web_search"];

/** The fake Lumiverse's events about a chat that an extension may hear by name (`events.onLumiverse`), each in the form Lumiverse sends it (`lumiverse-rows.ts`). Besides them, an extension hears the ones the engine's port hears nothing of. */
const LUMIVERSE_EVENTS: readonly HostEventName[] = ["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_SWIPED", "MESSAGE_DELETED", "CHAT_CHANGED", "CHAT_DELETED"];

const TYPES: Readonly<Record<string, HostGenerationType>> = { normal: "normal", regenerate: "regenerate", swipe: "swipe", continue: "continue", impersonate: "impersonate" };

/** How long a wait for something a backend does by itself may take before the test fails, in milliseconds. */
const PATIENCE_MS = 5_000;

type Sent = { role: string; text: string }[];
type Interceptor = (input: InterceptorInput) => Promise<InterceptorVerdict>;

/** What every seat of one fake Lumiverse shares: the user's connections, which are the user's and no one extension's; the interceptors it runs on a prompt, in the order they registered, what it then sends its model and the parameters they set on the request, and its wait for them. */
interface Shared {
  connections: HostConnection[];
  interceptors: { handler: Interceptor; logs: string[] }[];
  sent: Map<string, Sent>;
  params: Map<string, Record<string, unknown>>;
  waits: Map<string, { stop: AbortController; lost: PromiseWithResolvers<"lost"> }>;
}

const SHARED = new WeakMap<FakeHost, Shared>();

/**
 * The prompt Lumiverse assembled for a generation, as an interceptor reads it: each enabled preset
 * block, with the World Info of each outlet it holds where the outlet stands; the World Info placed
 * by position; then the chat's messages that have text, each naming the message it came from.
 */
function promptOf(host: FakeHost, g: Generation): PromptMessage[] {
  const outlet = (name: string): string =>
    host.assembled
      .filter((e) => e.position === 8 && (e.outlet ?? "").toLowerCase() === name)
      .map((e) => e.content)
      .join("\n");
  const blocks = host.presetBlocks.filter((b) => host.blockStates[b.id] ?? b.enabled).map((b): PromptMessage => ({ role: "system", text: b.content.replace(/\{\{outlet::([^}]*)\}\}/gi, (_whole, name: string) => outlet(name.trim().toLowerCase())), history: false }));
  const lore = host.assembled.filter((e) => e.position !== 8).map((e): PromptMessage => ({ role: "system", text: e.content, history: false, lore: true }));
  const chat = host
    .chat(g.chatId)
    .messages.filter((m) => m.isUser || (m.swipes[m.swipeId] ?? "") !== "")
    .map((m): PromptMessage => ({ role: m.isUser ? "user" : "assistant", text: m.swipes[m.swipeId] ?? "", history: true, sourceId: m.id, sourceIndex: m.index }));
  return [...blocks, ...lore, ...chat];
}

/** The fake Lumiverse's own part in a prompt: every extension's interceptor in turn, each on the prompt as the one before left it, for no longer than Lumiverse waits. */
function sharedOf(host: FakeHost): Shared {
  const known = SHARED.get(host);
  if (known) return known;
  const shared: Shared = { connections: [CONNECTION], interceptors: [], sent: new Map(), params: new Map(), waits: new Map() };
  SHARED.set(host, shared);
  host.promptInterceptor = async (g) => {
    let prompt = promptOf(host, g);
    let parameters: Record<string, unknown> = {};
    const wait = { stop: new AbortController(), lost: Promise.withResolvers<"lost">() };
    shared.waits.set(g.id, wait);
    const gaveUp = new Promise<"gave up">((resolve) => wait.stop.signal.addEventListener("abort", () => resolve("gave up"), { once: true }));
    // The interceptors Lumiverse had when the prompt was assembled: one registered while it waits (a backend that started again) has no part in this prompt.
    for (const { handler, logs } of [...shared.interceptors]) {
      const input: InterceptorInput = { chatId: g.chatId, userId: host.userId, generationId: g.id, type: TYPES[g.type] ?? "other", dryRun: false, connectionId: null, presetId: null, personaId: null, activated: [], messages: prompt, signal: wait.stop.signal };
      let verdict: InterceptorVerdict = {};
      try {
        // Lumiverse waits for an interceptor no longer than it said it would, and not at all for one whose extension is gone: the prompt goes on as it stood.
        const answered = await Promise.race([handler(input), gaveUp, wait.lost.promise]);
        if (answered !== "gave up" && answered !== "lost") verdict = answered;
      } catch (error) {
        logs.push(`error: the interceptor threw: ${error instanceof Error ? error.message : String(error)}`);
      }
      const came = prompt;
      const left = new Set(verdict.omit ?? []);
      prompt =
        verdict.messages !== undefined
          ? verdict.messages.flatMap((slot): PromptMessage[] => {
              if (!("keep" in slot)) return [{ role: slot.role, text: slot.text, history: false }];
              const kept = came[slot.keep];
              return kept ? [kept] : [];
            })
          : came.filter((_, i) => !left.has(i));
      // A later interceptor's parameters go over an earlier one's, as Lumiverse merges them into the request.
      parameters = { ...parameters, ...verdict.parameters };
    }
    shared.waits.delete(g.id);
    shared.sent.set(
      g.id,
      prompt.map((m) => ({ role: m.role, text: m.text })),
    );
    shared.params.set(g.id, parameters);
  };
  return shared;
}

/** One extension's place in the fake Lumiverse, and the test's hands on it. */
export interface Seat {
  /** Lumiverse as a LumiAH backend is given it. */
  base: BackendHost;
  /** The clock and the build a backend is made with. */
  env: BackendEnv;
  /** The agents' model: each call the runtime linked to this seat's backend makes (`runtime-models.ts`) is answered by this. A test sets it (`cast(...).script`). */
  script: (request: ModelRequest) => Answer | Promise<Answer>;
  /** Every agent's call, in the order the runtime made them. */
  calls: ModelRequest[];
  /** The backend's own log lines. */
  logs: string[];
  /** Grants or takes away a permission, as the user does in Lumiverse while the extension runs. */
  permit(permission: string, on: boolean): void;
  /** What Lumiverse sends its own model for a generation, once every interceptor answered: the messages in order. */
  prompt(generationId: string): Sent;
  /** The parameters the interceptors set on a generation's request, a later one's over an earlier one's. */
  parameters(generationId: string): Record<string, unknown>;
  /** The user's connections as Lumiverse lists them: Lumiverse's own, and any a runtime adds (its loopback). The agents run on none of them: a runtime calls its providers on its own connections. */
  connections: HostConnection[];
  /** A server on Lumiverse's machine that its proxy reaches at `base` (`spindle.cors`, with `cors_proxy` granted): a runtime's loopback server. */
  serve(base: string, handler: (request: Request) => Promise<Response>): void;
  /** A session of Lumiverse's event socket that isn't a page (a runtime's link): what the backend sends to it reaches `receive`, and none of it is a page's. */
  outlet(session: string, receive: (message: unknown) => void): void;
  /** Something that session sends the backend, as Lumiverse hands it on. */
  deliver(payload: unknown, session: string): void;
  /** That session is gone: the backend is told, as Lumiverse tells it of a closed socket. */
  closeSession(session: string): void;
  /** Lumiverse stops waiting for the interceptors of a generation under way, and says so: its time ran out (`timed out`), or the user pressed Stop. */
  giveUp(generationId: string, why: "timed out" | "stopped"): void;
  /** The extension's backend is gone while a generation waits on its interceptor: Lumiverse goes on with the prompt as it stood, and nothing is told to a backend that isn't there. */
  lose(generationId: string): void;
  /** The generations whose prompt is waiting on the interceptors now. */
  waiting(): string[];
  /** The extension's backend is gone (it restarted, or crashed): its interceptor is Lumiverse's no longer, its timers end, and nothing it sends reaches a page. */
  gone(): void;
  /** One request of LumiAH's page contract, from a page of the user's. */
  page<T = Record<string, unknown>>(type: string, body?: JsonObject): Promise<T>;
  /** Everything the backend sent the user's pages. */
  pushed: { message: unknown; session: string | undefined }[];
  /** Waits until `done` holds, delivering Lumiverse's events meanwhile (`quiet`: without, for a wait inside a generation's own start); fails with `what` when it never does. */
  until(done: () => boolean | Promise<boolean>, what: string, quiet?: boolean): Promise<void>;
  /** The fake Lumiverse waits for this backend's writes and pushes between two events, as it waits for the engine's. */
  follow(backend: Backend): void;
  /** Ends the seat's timers. */
  close(): void;
}

/**
 * A seat in a rig's fake Lumiverse for the extension `identifier`. The engine's own seat shares the
 * engine's user storage, as one extension's backend has one storage; any other extension has its own.
 */
export function seatOf(rig: Rig, identifier: string = ENGINE_EXTENSION): Seat {
  const host = rig.host;
  const userId = host.userId;
  const shared = sharedOf(host);
  /** Lumiverse's rows behind the fake's chats: what this host reads of a chat, and the runtime's copy reads over Lumiverse's routes. */
  const rows = lumiverseRows(host);
  const logs: string[] = [];
  const calls: ModelRequest[] = [];
  const granted = new Set(GRANTED);
  const pushed: Seat["pushed"] = [];
  const timers = new Set<() => void>();
  const permission: ((permission: string, granted: boolean) => void)[] = [];
  const pageHandlers: ((payload: unknown, userId: string, sessionId: string | undefined) => void)[] = [];
  const outlets = new Map<string, (message: unknown) => void>();
  const closed: ((userId: string, sessionId: string) => void)[] = [];
  const answers = new Map<string, PromiseWithResolvers<unknown>>();
  const written = new Map<string, number>();
  const servers = new Map<string, (request: Request) => Promise<Response>>();
  const files = identifier === ENGINE_EXTENSION ? host.files : new Map<string, string>();
  const events = {
    started: [] as ((event: GenerationStarted) => void)[],
    ended: [] as ((event: GenerationEnded) => void)[],
    stopped: [] as ((event: GenerationStopped) => void)[],
    swipe: [] as ((event: SwipeChanged) => void)[],
    changed: [] as ((chatId: string, userId: string | null) => void)[],
    touched: [] as ((chatId: string, gone: boolean, userId: string | null) => void)[],
  };
  const file = (path: string, user: string): string => `${user}/${path}`;
  let asked = 0;
  let dead = false;

  const seat: Seat = {
    base: undefined as unknown as BackendHost,
    env: {
      now: () => Date.now(),
      later(ms, fn) {
        const cancel = (): void => {
          clearTimeout(timer);
          timers.delete(cancel);
        };
        const timer = setTimeout(() => {
          timers.delete(cancel);
          fn();
        }, ms);
        timers.add(cancel);
        return cancel;
      },
      build: "test",
    },
    script: () => {
      throw new Error("an agent called a model, and the test gave it no part");
    },
    calls,
    logs,
    permit(name, on) {
      if (on) granted.add(name);
      else granted.delete(name);
      for (const handler of permission) handler(name, on);
    },
    prompt: (generationId) => shared.sent.get(generationId) ?? [],
    parameters: (generationId) => shared.params.get(generationId) ?? {},
    connections: shared.connections,
    serve(base, handler) {
      servers.set(base, handler);
    },
    outlet(session, receive) {
      outlets.set(session, receive);
    },
    deliver(payload, session) {
      for (const handler of pageHandlers) handler(payload, userId, session);
    },
    closeSession(session) {
      if (!outlets.delete(session)) return;
      for (const handler of closed) handler(userId, session);
    },
    giveUp(generationId, why) {
      shared.waits.get(generationId)?.stop.abort(new Error(why === "timed out" ? "The interceptor timed out." : "The generation was stopped."));
    },
    lose(generationId) {
      shared.waits.get(generationId)?.lost.resolve("lost");
    },
    waiting: () => [...shared.waits.keys()],
    gone() {
      dead = true;
      shared.interceptors = shared.interceptors.filter((entry) => entry.logs !== logs);
      for (const cancel of [...timers]) cancel();
    },
    page<T>(type: string, body: JsonObject = {}): Promise<T> {
      const reqId = `page-${identifier}-${++asked}`;
      const answer = Promise.withResolvers<unknown>();
      answers.set(reqId, answer);
      for (const handler of pageHandlers) handler({ lah: UI_VERSION, type, reqId, ...body }, userId, "page-1");
      return answer.promise as Promise<T>;
    },
    pushed,
    async until(done, what, quiet = false) {
      const by = Date.now() + PATIENCE_MS;
      for (;;) {
        if (!quiet) await host.settle();
        if (await done()) return;
        if (Date.now() > by) throw new Error(`waited ${PATIENCE_MS} ms for ${what}; the backend's log:\n${logs.slice(-12).join("\n")}`);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    },
    follow(backend) {
      const before = host.idle;
      host.idle = async () => {
        await before();
        await backend.settle();
        await before();
      };
    },
    close() {
      for (const cancel of [...timers]) cancel();
    },
  };

  seat.base = {
    log: (level, message) => void logs.push(`${level}: ${message}`),
    toast: (user, level, text) => void logs.push(`toast to ${user} (${level}): ${text}`),
    closeDrawer: () => Promise.resolve(false),
    granted: (name) => granted.has(name),
    onPermission: (handler) => void permission.push(handler),
    capability: () => true,
    install: { bun: null, dir: null },
    identifier,
    // Lumiverse's own proxy as an extension sees it: refused without `cors_proxy` and for a path that ends in `.js`, its own User-Agent and the Host the address names added, and the answer brought back whole from the server on this machine that serves the address's origin.
    async cors(url, init) {
      if (!granted.has("cors_proxy")) throw new Error("PERMISSION_DENIED: cors_proxy — CORS proxy permission not granted");
      const target = new URL(url);
      if (/\.(js|mjs|cjs|es)$/i.test(target.pathname)) throw new Error("JavaScript downloads are blocked: URL path identifies a JavaScript file");
      const server = servers.get(target.origin);
      if (server === undefined) throw new Error("Unable to connect. Is the computer able to access the url?");
      const response = await server(new Request(url, { method: init.method, headers: { ...init.headers, "User-Agent": "Lumiverse/test", Host: target.host }, body: init.body }));
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      return { status: response.status, headers, body: await response.text() };
    },
    // The bed's user is no operator of this Lumiverse, and the extension can't tell where Lumiverse's database is: the direct reader can't be switched on here.
    role: () => Promise.resolve("user"),
    database: () => null,

    frontend: {
      send(message, _userId, sessionId) {
        if (dead) return;
        const outlet = sessionId === undefined ? undefined : outlets.get(sessionId);
        if (outlet !== undefined) return outlet(message);
        pushed.push({ message, session: sessionId });
        if (!isRecord(message) || typeof message.reqId !== "string") return;
        const answer = answers.get(message.reqId);
        if (answer === undefined) return;
        answers.delete(message.reqId);
        if (message.type === "lah.error") answer.reject(new PageRefused(String(message.code), String(message.message), message.problems));
        else answer.resolve(message.body);
      },
      onMessage: (handler) => void pageHandlers.push(handler),
      onClosed: (handler) => void closed.push(handler),
      // To every page and runtime of the user's: the bed's one user.
      everyone(message) {
        if (dead) return;
        for (const outlet of [...outlets.values()]) outlet(message);
        pushed.push({ message, session: undefined });
      },
    },

    events: {
      onGenerationStarted: (handler) => void events.started.push(handler),
      onGenerationEnded: (handler) => void events.ended.push(handler),
      onGenerationStopped: (handler) => void events.stopped.push(handler),
      onSwipe: (handler) => void events.swipe.push(handler),
      onChatChanged: (handler) => void events.changed.push(handler),
      onChatTouched: (handler) => void events.touched.push(handler),
      onChatForked: () => undefined,
      onSelectedConnection: () => undefined,
      // Lumiverse's own events of these names, each in its own form, made of its rows as they stood when it was sent (`lumiverse-rows.ts`): the ones the fake host sends the engine as it delivers them, and the ones the engine's port hears nothing of soon after their change.
      onLumiverse(names, handler) {
        for (const name of LUMIVERSE_EVENTS) {
          if (!names.includes(name)) continue;
          host.on(name, (payload) => {
            const told = rows.form(payload);
            if (told !== null) handler(told.name, told.payload, userId);
          });
        }
        rows.hear((name, payload) => {
          if (names.includes(name)) handler(name, payload, userId);
        });
      },
    },

    registerInterceptor: (handler) => void shared.interceptors.push({ handler, logs }),

    connections: {
      list: () => Promise.resolve([...seat.connections]),
      get: (connectionId) => Promise.resolve(seat.connections.find((c) => c.id === connectionId) ?? null),
      active: () => Promise.resolve(CONNECTION.id),
    },

    storage: {
      read: (path, user) => Promise.resolve(files.get(file(path, user)) ?? null),
      write(path, text, user) {
        files.set(file(path, user), text);
        written.set(file(path, user), Date.now());
        return Promise.resolve();
      },
      remove(path, user) {
        files.delete(file(path, user));
        written.delete(file(path, user));
        return Promise.resolve();
      },
      stat(path, user) {
        const text = files.get(file(path, user));
        return Promise.resolve(text === undefined ? null : { bytes: new TextEncoder().encode(text).length, writtenAt: written.get(file(path, user)) ?? 0 });
      },
      list(dir, user) {
        const under = `${file(dir, user).replace(/\/+$/, "")}/`;
        return Promise.resolve([...files.keys()].filter((key) => key.startsWith(under)).map((key) => key.slice(under.length)));
      },
    },

    chats: {
      // The fake Lumiverse, like this one, doesn't tell extensions whether Sovereign Hand is on.
      sovereignHand: () => Promise.resolve(null),
      // The chat's row and its messages as Lumiverse keeps them, as Spindle hands them on: the rows the runtime's copy reads over Lumiverse's routes.
      get(chatId, user) {
        const read = rows.chat(chatId, user);
        return Promise.resolve(read === null ? null : hostChatOf(rowToChat(read.chat)));
      },
      patchMetadata(chatId, patch) {
        const chat = host.chat(chatId);
        const next = { ...chat.metadata };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete next[key];
          else next[key] = structuredClone(value) as JsonValue;
        }
        chat.metadata = next;
        host.chatChanged({ chatId });
        return Promise.resolve();
      },
      messages(chatId, range) {
        host.chat(chatId);
        const all = (rows.chat(chatId, userId)?.messages ?? []).map((row) => hostMessageOf(rowToMessage(row), identifier));
        return Promise.resolve(range === undefined ? all : "tail" in range ? all.slice(-range.tail) : all.slice(range.from, range.from + range.count));
      },
      swipe(chatId, messageId, swipe) {
        host.chat(chatId);
        const row = rows.chat(chatId, userId)?.messages.find((m) => m.id === messageId);
        return Promise.resolve(row === undefined ? null : (rowToMessage(row).swipes[swipe] ?? null));
      },
      async setOwn(chatId, messageId, value) {
        // The entry the engine's own extension keeps on a message is the ledger's: a LumiAH mounted in the engine never writes it.
        if (identifier === ENGINE_EXTENSION) throw new Error("LumiAH wrote a message's own entry: on a chat the engine plays that entry is the ledger's");
        await host.chats.writeMetadata(chatId, messageId, { ...host.message(chatId, messageId).bag, [identifier]: value as JsonValue }, userId);
      },
      deleteMessage(chatId, messageId) {
        host.deleteMessage(chatId, messageId);
        return Promise.resolve();
      },
      list(user, offset, limit) {
        const chats = user === userId ? [...host.chatsById.values()] : [];
        return Promise.resolve({ chats: chats.slice(offset, offset + limit).map((chat) => ({ id: chat.id, name: chat.name, characterId: null, metadata: structuredClone(chat.metadata) })), total: chats.length });
      },
      characterName: () => Promise.resolve(null),
    },

    // No book: the engine's seat must never be asked for one (the mount gives LumiAH none in a chat the engine plays), and a read that reaches here fails the test.
    lore:
      identifier === ENGINE_EXTENSION
        ? {
            book: () => Promise.reject(new Error("LumiAH read a World Info book")),
            entries: () => Promise.reject(new Error("LumiAH read a World Info book's entries")),
            entry: () => Promise.reject(new Error("LumiAH read a World Info entry")),
            record: () => Promise.reject(new Error("LumiAH read a World Info book")),
            records: () => Promise.reject(new Error("LumiAH read a World Info book's entries")),
            global: () => Promise.reject(new Error("LumiAH read the global World Info books")),
            ofCharacter: () => Promise.reject(new Error("LumiAH read a character's World Info books")),
            ofPersona: () => Promise.reject(new Error("LumiAH read a persona's World Info book")),
          }
        : { book: () => Promise.resolve(null), entries: () => Promise.resolve([]), entry: () => Promise.resolve(null), record: () => Promise.resolve(null), records: () => Promise.resolve([]), global: () => Promise.resolve([]), ofCharacter: () => Promise.resolve([]), ofPersona: () => Promise.resolve(null) },

    presets: { blocks: () => Promise.resolve(null), active: () => Promise.resolve(null) },
    mcp: { servers: () => Promise.resolve([]), tools: () => Promise.resolve([]), call: () => Promise.reject(new Error("the bed has no MCP server")) },
    embeddings: { connection: () => Promise.resolve(null), embed: () => Promise.reject(new Error("the bed has no embedding connection")) },
    memory: { enabled: () => Promise.resolve(false), search: () => Promise.resolve([]), entity: () => Promise.resolve(null), entities: () => Promise.resolve([]), arcs: () => Promise.resolve([]) },
    databanks: { list: () => Promise.resolve([]), ofCharacter: () => Promise.resolve([]), documents: () => Promise.resolve([]), content: () => Promise.resolve(null) },
    web: { enabled: () => Promise.resolve(false), search: () => Promise.resolve([]) },
  };

  // Lumiverse's events, to this extension as it hears them: after the engine, whose handlers were registered when the rig started.
  host.on("GENERATION_STARTED", (e) => {
    for (const handler of events.started) handler({ generationId: e.generationId, chatId: e.chatId, userId, type: TYPES[e.generationType ?? ""] ?? "other", targetMessageId: e.targetMessageId ?? null, targetSwipeId: e.targetSwipeId ?? null });
  });
  host.on("GENERATION_ENDED", (e) => {
    // `content` null, as a Lumiverse that doesn't say what the generation wrote: LumiAH then reads the reply's own swipe.
    for (const handler of events.ended) handler({ generationId: e.generationId, chatId: e.chatId, userId, messageId: e.messageId ?? null, content: null, error: e.error ?? null });
  });
  host.on("GENERATION_STOPPED", (e) => {
    for (const handler of events.stopped) handler({ generationId: e.generationId, chatId: e.chatId, userId });
  });
  host.on("MESSAGE_SWIPED", (e) => {
    for (const handler of events.swipe) handler({ chatId: e.chatId, userId, messageId: e.message.id, action: e.action as SwipeChanged["action"], swipeId: e.swipeId });
    for (const handler of events.touched) handler(e.chatId, false, userId);
  });
  for (const name of ["MESSAGE_SENT", "MESSAGE_EDITED"] as const) {
    host.on(name, (e) => {
      for (const handler of events.touched) handler(e.chatId, false, userId);
    });
  }
  host.on("MESSAGE_DELETED", (e) => {
    for (const handler of events.touched) handler(e.chatId, false, userId);
  });
  host.on("CHAT_DELETED", (e) => {
    for (const handler of events.touched) handler(e.chatId, true, userId);
  });
  host.on("CHAT_CHANGED", (e) => {
    const chatId = isRecord(e) && typeof e.chatId === "string" ? e.chatId : null;
    if (chatId === null) return;
    for (const handler of events.changed) handler(chatId, userId);
    for (const handler of events.touched) handler(chatId, false, userId);
  });
  return seat;
}

/** LumiAH mounted in a rig's engine, over the engine's seat in the rig's fake Lumiverse. */
export interface Bed extends Seat {
  rig: Rig;
  backend: Backend;
}

export function lumiahBed(rig: Rig): Bed {
  const seat = seatOf(rig);
  const { backend } = mountHarness(rig.rt, seat.base, seat.env);
  seat.follow(backend);
  // One object, so the script a test sets is the one the seat's model reads.
  return Object.assign(seat, { rig, backend });
}
