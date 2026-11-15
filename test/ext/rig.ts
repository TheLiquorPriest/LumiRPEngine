// The rig the end-to-end tests run on: a stand-in Lumiverse (`test/standin`) with the light extension
// started on it, and RPE's side of the road answering on the stand-in's loopback address: the
// question's route and the provider endpoint, given scripted secrecy rules, a scripted history window
// and a scripted turn. Every name, chat and lore line is invented.

import { questionRoute, type HistoryWindow, type SecrecyAsk, type TurnStarts, type WindowStep } from "../../src/adapter/lumiverse/answer";
import { changeOf } from "../../src/adapter/lumiverse/events";
import { readBlocksHint } from "../../src/adapter/lumiverse/layout";
import { joiningOf } from "../../src/adapter/lumiverse/overlay";
import { CONFIRM_PATH, EXTENSION_IDENTIFIER, readConfirmAsk, USER_HEADER, type Registration } from "../../src/adapter/lumiverse/pipe-wire";
import { EXTENSION_LOG_CHARS, QUESTION_WAIT_MS } from "../../src/adapter/lumiverse/settings";
import { providerEndpoint, type TaggedTurn } from "../../src/adapter/lumiverse/provider";
import { streamedReply, wholeReply } from "../../src/adapter/lumiverse/stream";
import { QUESTION_PATH, readQuestion, type Question, type SecrecyVerdict } from "../../src/adapter/lumiverse/wire";
import { NEEDS } from "../../src/ext/permissions";
import { NOTICE_ID, startExtension, type RunningExtension } from "../../src/ext/start";
import { textOf as textKey } from "../../src/secrecy/lore-secrets";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { FakeClock, settle } from "../standin/clock";
import type { StandInDb } from "../standin/db";
import { ADMIN, installRpe } from "../standin/install";
import { StandIn, type Chat, type ChatMessage, type Installed, type Outcome, type Preset } from "../standin/lumiverse";
import type { Book } from "../standin/books";
import { historyWindow, WINDOW_DEFAULTS } from "../../src/story/window";

export const USER = "user-harbor";
export const RPE = "http://127.0.0.1:7860";
export const OTHER = "http://127.0.0.1:7861";
const PROVIDER_KEY = "rpe-provider-key";
const EXTENSION_KEY = "rpe-extension-key";
export const ALL = ["interceptor", "generation_parameters", "generation", "cors_proxy", "ui_panels"];

export const FERRY_SECRET = "FERRY-SECRET the ferryman smuggles salt";
export const VAULT_SECRET = "VAULT-SECRET the vault key hides under the third stair";
export const INDEXED_SECRET = "INDEXED-SECRET the mayor was born across the sea";
export const PUBLIC_LORE = "PUBLIC-LORE the bay is calm in summer";
/** How RPE words the ferry's mark when it lets it in. */
export const FERRY_SHOWN = `[A secret Ilsa holds: ${FERRY_SECRET}]`;

/** The chat's messages: the fifth is hidden, and the last two are both the player's. */
export function harborMessages(): ChatMessage[] {
  const lines: [ChatMessage["role"], string, boolean?][] = [
    ["assistant", "HIST-00 Welcome to the harbor."],
    ["user", "HIST-01 I walk to the ferry."],
    ["assistant", "HIST-02 The ferry waits at the pier."],
    ["user", "HIST-03 I ask about the vault."],
    ["assistant", "HIST-04 Nobody answers."],
    ["user", "HIST-05 (a note to myself)", true],
    ["user", "HIST-06 I look at the bay."],
    ["assistant", "HIST-07 The water is still."],
    ["user", "HIST-08 I board."],
    ["assistant", "HIST-09 The ferry leaves the pier."],
    ["user", "HIST-10 I watch the shore."],
    ["user", "HIST-11 And I wait."],
  ];
  return lines.map(([role, content, hidden], i) => ({ id: `m${i}`, role, content, ...(hidden ? { hidden } : {}) }));
}

/**
 * The harbor's two books, of one user (a book is one user's): the card's own, and the world's the chat attaches. A `suffix` gives them, and
 * their entries, ids of their own, for a second user of the same Lumiverse.
 */
export function harborBooks(user: string, suffix = ""): Book[] {
  const card = `book-card${suffix}`;
  const harbor = `book-harbor${suffix}`;
  return [
    { id: card, name: "Ilsa's card", user, entries: [{ id: `e-twin${suffix}`, book: card, comment: "Gossip", constant: true, content: `  ${VAULT_SECRET}\n` }] },
    {
      id: harbor,
      name: "The harbor",
      user,
      entries: [
        { id: `e-ferry${suffix}`, book: harbor, comment: "The ferry", keys: ["ferry"], content: `The ferry crosses the bay at dawn.\n{{// Secret (known to Ilsa): ${FERRY_SECRET}}}` },
        { id: `e-vault${suffix}`, book: harbor, comment: "The vault", constant: true, content: `{{// Secret: ${VAULT_SECRET}}}` },
        { id: `e-indexed${suffix}`, book: harbor, comment: "The mayor", constant: true, content: INDEXED_SECRET },
        { id: `e-public${suffix}`, book: harbor, comment: "The bay", constant: true, content: PUBLIC_LORE },
      ],
    },
  ];
}

export const PRESET: Preset = {
  id: "preset-harbor",
  name: "Harbor preset",
  blocks: [
    { id: "b-main", name: "Main", role: "system", content: "MAIN-BLOCK You narrate a harbor town, one scene at a time." },
    { id: "b-style", name: "Style", role: "system", content: "STYLE-BLOCK Write in the present tense." },
    { id: "b-blank", name: "Spacer", role: "system", content: "   " },
    { id: "b-depth", name: "Depth note", role: "system", content: "DEPTH-NOTE Keep the scene brief.", depth: 2 },
    { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
  ],
  parameters: { temperature: 0.8 },
};

export interface RigOptions {
  granted?: readonly string[];
  /** The history window: the latest this many visible messages. */
  window?: number;
  /** The window's step (R-95): it holds `window` to `window + step` messages. */
  step?: number;
  /** RPE takes this long to answer the question. */
  questionDelayMs?: number;
  /** RPE cannot work out the window when asked the question (it can on receipt). */
  windowFailsAtQuestion?: boolean;
  deadlineMs?: number;
  postProcessing?: string;
  collapse?: boolean;
  /** The preset's prefill (`completionSettings.assistantPrefill`). */
  prefill?: string;
  /** A picture on the player's last message but one (m10, which Lumiverse joins with m11 before the interceptor: its picture follows their joined text). */
  picture?: boolean;
  /** The preset's completion settings, which Lumiverse applies inside its assembly, before any interceptor (`prompt-assembly.service.ts:4210`, `:7129-7231`). */
  completion?: Pick<Preset, "squashSystemMessages" | "useSystemPrompt" | "namesBehavior">;
  /** The preset's streaming switch (`prompt-assembly.service.ts:7743-7745`); on unless said. */
  streaming?: false;
  /** RPE cannot work out the lore's secrets: its secrecy rules fail, as the composition's do until the secrets lane lands. */
  secretsFail?: true;
  /** Lumiverse's council block, which it splices into the prompt after its interceptors (`StandIn.councilBlock`). */
  council?: string;
  /** A clock the test moves by hand, for everything of Lumiverse's that waits (its limits, its later tasks) and for RPE's delay to answer; the process's own where none is given. */
  clock?: FakeClock;
  /** Lumiverse's database file, holding the rig's user: the stand-in keeps its chat there as Lumiverse stores it, for RPE's own reads. */
  db?: StandInDb;
}

/** RPE's scripted secrecy rules: the ferry's mark shown as RPE words it; the vault (a whole-entry secret), its unmarked copy and the entry a world secret was indexed from kept out. */
function harborSecrecy(ask: SecrecyAsk): SecrecyVerdict {
  const vaultKey = textKey(VAULT_SECRET);
  const disabled = ask.entries.filter((e) => e.id === "e-vault" || e.id === "e-indexed" || e.key === vaultKey).map((e) => e.id);
  const ferry = ask.entries.find((e) => e.id === "e-ferry");
  const mutated = ferry?.content !== undefined ? [{ id: "e-ferry", content: `The ferry crosses the bay at dawn.\n${FERRY_SHOWN}` }] : [];
  return { disabled, enabled: [], mutated };
}

/** A clock on the process's own timers, for tests that run in real time. */
export const REAL_CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

/** The frontend session of RPE's relay socket, as RPE's registration names it. */
export const RELAY_SESSION = "0123456789abcdef0123456789abcdef";

export class Rig {
  readonly lv = new StandIn();
  /** The extension's worker as Spindle shows it to the extension, and what the extension started there. */
  ext!: Installed;
  running!: RunningExtension;
  /** Lumiverse's id for the extension. */
  extension!: string;
  /** The interceptor calls Lumiverse made of the extension, and the gate a test holds them at (`holdInterceptor`). */
  interceptorAsked = 0;
  private holding: PromiseWithResolvers<void> | null = null;
  readonly questions: Question[] = [];
  readonly turns: TaggedTurn[] = [];
  readonly passed: JsonObject[] = [];
  /** What RPE's question route said in RPE's log. */
  readonly rpeLog: string[] = [];
  /** What the extension sent RPE's relay socket. */
  readonly toRpe: unknown[] = [];
  readonly otherBodies: Record<string, unknown>[] = [];
  readonly chat: Chat;
  private readonly rpe: (request: Request) => Promise<Response>;

  constructor(readonly options: RigOptions = {}) {
    if (options.clock !== undefined) this.lv.clock = options.clock;
    if (options.db !== undefined) this.lv.db = options.db;
    const hidden = new Set(harborMessages().filter((m) => m.hidden).map((m) => m.id));
    const keep = options.window ?? 4;
    // The window as RPE counts it, the latest `keep`, over the path as the turn lane gives it with its hidden marks (at the question), or
    // over the rows read on receipt, which have left the hidden ones out already.
    const counted = (path: readonly WindowStep[]) => historyWindow(path, { ...WINDOW_DEFAULTS, size: keep, step: options.step ?? null }, new Set()).first;
    const atQuestion: HistoryWindow = async (ask) => {
      if (options.windowFailsAtQuestion) throw new Error("the story record was busy");
      return counted(await ask.path());
    };
    const onReceipt: HistoryWindow = async (ask) => counted(await ask.path());
    // RPE's state of the chat as the turn lane holds it: the fixture's hidden marks, heard; the path up to the question's point.
    const start: TurnStarts = async ({ path, point }) => ({ messages: path.filter((s) => s.id !== point.replaces).map((s) => ({ ...s, hidden: hidden.has(s.id) })), at: null, known: true });
    const secrecy = async (ask: SecrecyAsk): Promise<SecrecyVerdict> => {
      if (options.secretsFail) throw new Error("RPE does not work out its lore's secrets yet");
      return harborSecrecy(ask);
    };
    const question = questionRoute({ secrecy, window: atQuestion, start, allowed: (r) => r.headers.get("authorization") === `Bearer ${EXTENSION_KEY}` && r.headers.get(USER_HEADER) === USER, log: (m) => this.rpeLog.push(m) });
    const provider = providerEndpoint({
      user: USER,
      allowed: (r) => r.headers.get("authorization") === `Bearer ${PROVIDER_KEY}`,
      window: onReceipt,
      // No model's window is known to the rig: nothing is trimmed past the window's cut.
      room: async () => ({ room: null, count: async () => 0, covered: async () => false }),
      reads: {
        // Lumiverse's rows as they stand when the request arrives: the stand-in's chat, each message at its stored number.
        rows: async (chat) => this.lv.rowsOf(chat),
        // How the stand-in joins after its interceptors: its post-processing setting and the preset's collapse, as Lumiverse's settings say.
        joining: async (preset) => joiningOf(this.lv.postProcessing, { advancedSettings: { collapseMessages: preset !== null && this.lv.presets.get(preset)?.collapse === true } }),
        messageLimit: async () => {
          const limit = this.lv.library.setting(USER, "summarization") as { messageLimitEnabled?: boolean; messageLimitCount?: number } | undefined;
          return limit?.messageLimitEnabled === true && (limit.messageLimitCount ?? 0) > 0 ? limit.messageLimitCount! : null;
        },
      },
      blocks: async (tag) => {
        const last = [...this.lv.stored.values()].filter((s) => s.chatId === tag.chat).at(-1);
        return last === undefined ? null : readBlocksHint(last.data, "breakdown");
      },
      models: {
        pass: async (request, sink) => {
          this.passed.push(request.body);
          sink.content("An untagged reply.");
          sink.finish({ content: "An untagged reply.", finishReason: "stop", usage: { calls: 1, input: 3, cacheRead: 0, cacheWrite: 0, output: 4 } });
        },
      },
      passConnection: () => null,
      passWords: async (key) => key,
      holdMs: () => 540_000,
      // Lumiverse's own list of the lore that activated for the chat's running generation, as RPE's event socket hears it.
      heard: {
        tagged: (chat) => {
          const since = this.lv.events.findLastIndex((e) => e.event === "GENERATION_STARTED" && isRecord(e.payload) && e.payload.chatId === chat);
          const said = this.lv.events.slice(Math.max(0, since)).findLast((e) => e.event === "WORLD_INFO_ACTIVATED" && isRecord(e.payload) && e.payload.chatId === chat);
          const change = said === undefined ? null : changeOf(said.event, said.payload);
          return change?.kind === "lore-activated" ? change.lore : [];
        },
        untagged: () => false,
      },
      untaggedWhileAwaited: () => "pass",
      modelNames: () => ["rpe"],
      turns: {
        play: async (turn, out) => {
          this.turns.push(turn);
          out.reasoning("Thinking about the bay.");
          out.content("The tide turns.");
          out.finish({ usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } });
        },
      },
      clock: REAL_CLOCK,
    });
    this.rpe = async (request) => {
      const path = new URL(request.url).pathname;
      if (path === QUESTION_PATH) {
        const asked = readQuestion(await request.clone().json());
        if (asked) this.questions.push(asked);
        if (options.questionDelayMs) {
          // A slow RPE: it answers when the host's clock says so, and a timer of the process's own does not keep the test process alive.
          const slow = Promise.withResolvers<void>();
          this.lv.clock.setTimeout(slow.resolve, options.questionDelayMs);
          await slow.promise;
        }
        return await question(request, () => request.json());
      }
      if (path === "/v1/chat/completions") return await provider(request, { json: () => request.json(), untimed: () => undefined });
      if (path === CONFIRM_PATH) {
        // As RPE's own route: the key it made, for its own user, naming its relay socket and connection.
        if (request.headers.get("authorization") !== `Bearer ${EXTENSION_KEY}`) return Response.json({ error: "This needs the extension's registration with this RPE." }, { status: 401 });
        if (request.headers.get(USER_HEADER) !== USER) return Response.json({ error: "This RPE belongs to another Lumiverse user." }, { status: 403 });
        const asked = readConfirmAsk(await request.json());
        if (asked?.relay !== RELAY_SESSION || JSON.stringify(asked.connections) !== JSON.stringify(["conn-rpe"])) return Response.json({ error: "That is not the registration this RPE made." }, { status: 409 });
        return Response.json({ rpe: "confirmed", user: USER, relay: RELAY_SESSION });
      }
      return new Response("not found", { status: 404 });
    };
    this.lv.servers.set(RPE, this.rpe);
    this.lv.servers.set(OTHER, async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      this.otherBodies.push(body);
      const meta = { id: "other", model: "other", created: 0 };
      const run = async (out: { content(text: string): void }): Promise<void> => out.content("Another model's reply.");
      return body.stream === false ? await wholeReply(run, meta, request.signal) : streamedReply(run, meta, request.signal, { clock: REAL_CLOCK, turn: false });
    });
    this.lv.postProcessing = options.postProcessing ?? "";
    this.lv.councilBlock = options.council ?? null;
    this.lv.connections.set("conn-rpe", { id: "conn-rpe", base: `${RPE}/v1`, key: PROVIDER_KEY, model: "rpe" });
    this.lv.connections.set("conn-other", { id: "conn-other", base: `${OTHER}/v1`, key: "other-key", model: "other" });
    this.lv.presets.set(PRESET.id, { ...PRESET, ...options.completion, ...(options.collapse ? { collapse: true } : {}), ...(options.prefill !== undefined ? { assistantPrefill: options.prefill } : {}), ...(options.streaming === false ? { parameters: { ...PRESET.parameters, _streaming: false } } : {}) });
    const messages = harborMessages();
    if (options.picture) messages[10] = { ...messages[10]!, images: [{ data: "aGFyYm9y", mime_type: "image/png" }] };
    // The books as Lumiverse reads them: the card's own through its character, the world book the chat attaches through its metadata.
    for (const book of harborBooks(USER)) this.lv.library.addBook(book);
    this.chat = { id: "chat-harbor", user: USER, character: { id: "char-ilsa", name: "Ilsa", extensions: { world_book_ids: ["book-card"] } }, messages, metadata: { chat_world_book_ids: ["book-harbor"] } };
    this.lv.addChat(this.chat);
  }

  /**
   * Installs the extension as an admin does and starts it (the worker of a restart remembers only its storage), and RPE registers with it as its relay socket would. What `granted` leaves out of what
   * the extension asks for is withheld, so its notice names it; a grant after the start is `grant`.
   */
  async start(): Promise<this> {
    const code = async (api: Installed): Promise<RunningExtension> => {
      // The interceptor's calls wait for `holdInterceptor`'s release, where a test holds one, as a worker slow to answer would.
      const slow: Installed = {
        ...api,
        registerInterceptor: (handler, priorityOrOptions, options) =>
          api.registerInterceptor(
            async (messages, context) => {
              this.interceptorAsked++;
              await this.holding?.promise;
              return await handler(messages, context);
            },
            priorityOrOptions,
            options,
          ),
      };
      this.running = await startExtension(slow);
      return this.running;
    };
    const installed = await installRpe(this.lv, { granted: this.options.granted ?? ALL, code });
    this.extension = installed.id;
    this.ext = installed.worker;
    return await this.register();
  }

  /** RPE's registration reaches the extension on its relay socket, and the extension takes it or refuses it (as it must where RPE cannot be reached to confirm it). */
  private async register(): Promise<this> {
    const answered = Promise.withResolvers<void>();
    this.lv.frontends = (m) => {
      if (m.session !== RELAY_SESSION) return false;
      this.toRpe.push(m.payload);
      if (typeof m.payload === "object" && m.payload !== null && "rpe" in m.payload && (m.payload.rpe === "registered" || m.payload.rpe === "refused")) answered.resolve();
      return true;
    };
    const registration: Registration = { v: 1, base: RPE, key: EXTENSION_KEY, connections: ["conn-rpe"], relay: RELAY_SESSION, build: "test", values: { questionMs: this.options.deadlineMs ?? QUESTION_WAIT_MS, logChars: EXTENSION_LOG_CHARS } };
    this.ext.fromFrontend({ rpe: "register", registration }, USER, RELAY_SESSION);
    // The worker's later task runs on the host's clock: where the test moves it, it runs now.
    await this.options.clock?.advance(0);
    await answered.promise;
    return this;
  }

  /** An admin grants a permission: the worker hears it on a later task, which runs before this gives. */
  async grant(permission: string): Promise<void> {
    this.lv.spindle.setPermissions(ADMIN, this.extension, { grant: [permission] });
    if (this.options.clock !== undefined) await this.options.clock.advance(0);
    else await Bun.sleep(2);
    await settle();
  }

  /** The extension's interceptor calls wait, from now, until the gate this gives is let go: the generation is in the middle of its interceptor, as when the extension is slow. */
  holdInterceptor(): () => void {
    const gate = Promise.withResolvers<void>();
    this.holding = gate;
    return () => gate.resolve();
  }

  /** The permission notice the extension shows the user now: what it names as missing; null when none is up. */
  notice(): string[] | null {
    const shown = this.ext.modals.get(`${USER}\u0000${NOTICE_ID}`);
    if (shown === undefined) return null;
    return NEEDS.filter((n) => shown.items.some((i) => typeof i === "object" && i !== null && "content" in i && String(i.content).startsWith(`${n.permission}:`))).map((n) => n.permission);
  }

  /** Lumiverse restarts the extension: its worker stops, with every call it was asked and has not answered failed, and starts again. */
  async restart(): Promise<this> {
    await this.lv.spindle.restart(ADMIN, this.extension);
    this.ext = this.lv.spindle.worker(this.extension)!;
    return await this.register();
  }

  /** An admin disables the extension: its worker stops. */
  async stop(): Promise<void> {
    await this.lv.spindle.disable(ADMIN, this.extension);
  }

  rpeDown(): void {
    this.lv.servers.delete(RPE);
  }

  generate(connection: "conn-rpe" | "conn-other", extra: { type?: "normal" | "swipe"; dryRun?: boolean; chat?: string } = {}): Promise<Outcome> {
    const { chat, ...rest } = extra;
    return this.lv.generate({ chat: chat ?? this.chat.id, connection, preset: PRESET.id, ...rest });
  }
}

/** The texts of a prompt's messages, run together. */
export function promptText(messages: readonly { content: unknown }[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p: unknown) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join("") : ""))
    .join("\n");
}
