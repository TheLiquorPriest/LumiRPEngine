// The rig the end-to-end tests run on: a stand-in Lumiverse (`test/standin`) with the light extension
// started on it, and RPE's side of the road answering on the stand-in's loopback address: the
// question's route and the provider endpoint, given scripted secrecy rules, a scripted history window
// and a scripted turn. Every name, chat and lore line is invented.

import { questionRoute, type HistoryWindow, type SecrecyAsk } from "../../src/adapter/lumiverse/answer";
import { readBlocksHint } from "../../src/adapter/lumiverse/layout";
import { providerEndpoint, type TaggedTurn } from "../../src/adapter/lumiverse/provider";
import { streamedReply } from "../../src/adapter/lumiverse/stream";
import { QUESTION_PATH, readQuestion, type Question, type SecrecyVerdict } from "../../src/adapter/lumiverse/wire";
import type { Need } from "../../src/ext/permissions";
import { startExtension, type RunningExtension } from "../../src/ext/start";
import { textOf as textKey } from "../../src/backend/lore-secrets";
import type { JsonObject } from "../../src/shared/json";
import { StandIn, type Chat, type ChatMessage, type Installed, type Outcome, type Preset } from "../standin/lumiverse";

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

export const PRESET: Preset = {
  id: "preset-harbor",
  name: "Harbor preset",
  blocks: [
    { id: "b-main", name: "Main", role: "system", content: "MAIN-BLOCK You narrate a harbor town, one scene at a time." },
    { id: "b-style", name: "Style", role: "system", content: "STYLE-BLOCK Write in the present tense." },
    { id: "b-blank", name: "Spacer", role: "system", content: "   " },
    { id: "b-depth", name: "Depth note", role: "system", content: "DEPTH-NOTE Keep the scene brief.", depth: 2 },
  ],
  parameters: { temperature: 0.8 },
};

export interface RigOptions {
  granted?: readonly string[];
  /** The history window: the latest this many visible messages. */
  window?: number;
  /** RPE takes this long to answer the question. */
  questionDelayMs?: number;
  /** RPE cannot work out the window when asked the question (it can on receipt). */
  windowFailsAtQuestion?: boolean;
  deadlineMs?: number;
  postProcessing?: string;
  collapse?: boolean;
  prefill?: string;
  /** A picture on the player's last message but one. */
  picture?: boolean;
}

/** RPE's scripted secrecy rules: the ferry's mark shown as RPE words it; the vault (a whole-entry secret), its unmarked copy and the entry a world secret was indexed from kept out. */
function harborSecrecy(ask: SecrecyAsk): SecrecyVerdict {
  const vaultKey = textKey(VAULT_SECRET);
  const disabled = ask.entries.filter((e) => e.id === "e-vault" || e.id === "e-indexed" || e.key === vaultKey).map((e) => e.id);
  const ferry = ask.entries.find((e) => e.id === "e-ferry");
  const mutated = ferry?.content !== undefined ? [{ id: "e-ferry", content: `The ferry crosses the bay at dawn.\n${FERRY_SHOWN}` }] : [];
  return { disabled, enabled: [], mutated };
}

export class Rig {
  readonly lv = new StandIn();
  ext!: Installed;
  running!: RunningExtension;
  readonly questions: Question[] = [];
  readonly turns: TaggedTurn[] = [];
  readonly passed: JsonObject[] = [];
  readonly notices: Need[][] = [];
  readonly otherBodies: Record<string, unknown>[] = [];
  readonly chat: Chat;
  private readonly rpe: (request: Request) => Promise<Response>;

  constructor(readonly options: RigOptions = {}) {
    const hidden = new Set(harborMessages().filter((m) => m.hidden).map((m) => m.id));
    const keep = options.window ?? 4;
    const window: HistoryWindow = async (ask) => {
      if (options.windowFailsAtQuestion && ask.path.some((s) => s.swipe !== null)) throw new Error("the story record was busy");
      const visible = ask.path.filter((s) => !hidden.has(s.id));
      const first = visible[visible.length - keep];
      return visible.length <= keep || first === undefined ? null : { id: first.id, index: first.index };
    };
    const question = questionRoute({ secrecy: async (ask) => harborSecrecy(ask), window, allowed: (r) => r.headers.get("x-rpe-extension") === EXTENSION_KEY });
    const provider = providerEndpoint({
      user: USER,
      allowed: (r) => r.headers.get("authorization") === `Bearer ${PROVIDER_KEY}`,
      window,
      blocks: async (_user, chat) => {
        const last = [...this.lv.stored.values()].filter((s) => s.chatId === chat).at(-1);
        return last === undefined ? null : readBlocksHint(last.data, "breakdown");
      },
      passThrough: async (body, signal) => {
        this.passed.push(body);
        return streamedReply(async (out) => out.content("An untagged reply."), { id: "pass", model: "author", created: 0 }, signal);
      },
      play: async (turn, out) => {
        this.turns.push(turn);
        out.reasoning("Thinking about the bay.");
        out.content("The tide turns.");
        out.finish({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
      },
      now: () => Date.now(),
    });
    this.rpe = async (request) => {
      const path = new URL(request.url).pathname;
      if (path === QUESTION_PATH) {
        const asked = readQuestion(await request.clone().json());
        if (asked) this.questions.push(asked);
        if (options.questionDelayMs) {
          // A slow RPE: the timer does not keep the test process alive after the test has moved on.
          const slow = Promise.withResolvers<void>();
          setTimeout(slow.resolve, options.questionDelayMs).unref();
          await slow.promise;
        }
        return await question(request);
      }
      if (path === "/v1/chat/completions") return await provider(request);
      return new Response("not found", { status: 404 });
    };
    this.lv.servers.set(RPE, this.rpe);
    this.lv.servers.set(OTHER, async (request) => {
      this.otherBodies.push((await request.json()) as Record<string, unknown>);
      return streamedReply(async (out) => out.content("Another model's reply."), { id: "other", model: "other", created: 0 }, request.signal);
    });
    this.lv.postProcessing = options.postProcessing ?? "";
    this.lv.connections.set("conn-rpe", { id: "conn-rpe", base: `${RPE}/v1`, key: PROVIDER_KEY, model: "rpe" });
    this.lv.connections.set("conn-other", { id: "conn-other", base: `${OTHER}/v1`, key: "other-key", model: "other" });
    this.lv.presets.set(PRESET.id, { ...PRESET, ...(options.collapse ? { collapse: true } : {}), ...(options.prefill !== undefined ? { prefill: options.prefill } : {}) });
    const messages = harborMessages();
    if (options.picture) messages[10] = { ...messages[10]!, images: [{ data: "aGFyYm9y", mime_type: "image/png" }] };
    this.chat = {
      id: "chat-harbor",
      user: USER,
      character: { id: "char-ilsa", name: "Ilsa" },
      messages,
      books: [
        { id: "e-ferry", book: "book-harbor", comment: "The ferry", keys: ["ferry"], content: `The ferry crosses the bay at dawn.\n{{// Secret (known to Ilsa): ${FERRY_SECRET}}}` },
        { id: "e-vault", book: "book-harbor", comment: "The vault", constant: true, content: `{{// Secret: ${VAULT_SECRET}}}` },
        { id: "e-twin", book: "book-card", comment: "Gossip", constant: true, content: `  ${VAULT_SECRET}\n` },
        { id: "e-indexed", book: "book-harbor", comment: "The mayor", constant: true, content: INDEXED_SECRET },
        { id: "e-public", book: "book-harbor", comment: "The bay", constant: true, content: PUBLIC_LORE },
      ],
    };
    this.lv.chats.set(this.chat.id, this.chat);
  }

  /** Installs and starts the extension (again: a restarted worker remembers nothing). */
  async start(): Promise<this> {
    this.ext = this.lv.install(this.options.granted ?? ALL);
    this.running = await startExtension(this.ext, {
      road: async (user) => (user === USER ? { base: RPE, headers: { "x-rpe-extension": EXTENSION_KEY } } : null),
      isRpe: (connection) => connection === "conn-rpe",
      notice: (missing) => this.notices.push([...missing]),
      ...(this.options.deadlineMs !== undefined ? { deadlineMs: this.options.deadlineMs } : {}),
    });
    return this;
  }

  restart(): Promise<this> {
    this.running.stop();
    this.ext.stop();
    return this.start();
  }

  rpeDown(): void {
    this.lv.servers.delete(RPE);
  }

  generate(connection: "conn-rpe" | "conn-other", extra: { type?: "normal" | "swipe"; dryRun?: boolean } = {}): Promise<Outcome> {
    return this.lv.generate({ chat: this.chat.id, connection, preset: PRESET.id, ...extra });
  }
}

/** The texts of a prompt's messages, run together. */
export function promptText(messages: readonly { content: unknown }[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p: unknown) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join("") : ""))
    .join("\n");
}
