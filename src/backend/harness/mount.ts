// LumiAH's backend, built into the engine (HARNESS-SLICE3 "Boundary with LumiAH"; LumiAH's DESIGN
// §21, §25). LumiAH's own `createBackend` runs here, in the engine's Spindle worker, over the same
// Lumiverse: its prompt interceptor, its core where a chat runs built in, its link to a runtime, its
// pages' requests. The engine is the extension it is built into: it gives LumiAH its definitions,
// its claim on a chat, the writer's request, its hooks around a run and its tools (`HarnessEngine`),
// and it takes back what it needs of LumiAH (the switch for a chat, what LumiAH lacks, the
// workspace, side sessions).
//
// LumiAH is given Lumiverse through a host that differs from Lumiverse's own in four places, each
// because the two extensions are one extension here:
// - **Storage.** LumiAH's files and the engine's sit in one user storage, and both keep a
//   `settings.json`: LumiAH's are all under one folder of it.
// - **The record on a message.** A reply holds one record, the engine's, and LumiAH's record of the
//   turn rides inside it (`Rec.harness`). LumiAH reads its records from the chat's ledger and
//   writes them to it; it never reads or writes the message's entry itself, which is the ledger's.
// - **Lore.** In a chat the engine plays, World Info is the engine's to read, under its secrets
//   rule, through its own lore tools. LumiAH is shown no book.
// - **The switch for a chat.** This LumiAH answers the chats that play a world on the harness
//   engine, and no other: its switch for a chat and the chat's engine are one choice
//   (`HarnessEngine.choose`), whichever page it is made on.

import type { AnchorCodec, Backend, BackendEnv, BackendHost, HostMessage } from "lumi-ah/extension/backend";
import { createBackend, createSpindleHost, UiRefused } from "lumi-ah/extension/backend";
import type { ChatView, UiState } from "lumi-ah/shared";
import { UI_VERSION, uiMessageOf, uiRequestOf } from "lumi-ah/shared";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import { ENGINE_EXTENSION } from "../../shared/protocol";
import type { HarnessFile, HarnessFiles } from "../agents/tools/harness-ports";
import { OPEN_CHATS_CAP } from "../ledger-io";
import type { Runtime } from "../runtime";
import { EngineRefused } from "./extension";

/** The engine as LumiAH's pages, its messages and its runtime's words name it. */
const NAME = "LumiRPEngine";

/** The folder of the user's storage LumiAH's files are under. */
const STORAGE = "harness";

/** The build this bundle came from, as LumiAH's own entry reads it: `bun run build` defines it into every bundle; "dev" run from source. */
const BUILD: string = process.env.LAH_BUILD_ID ?? "dev";

/**
 * How often LumiAH's backend looks at what waits on time alone. Every such timing is a setting of
 * its user's; this is only the grain they are checked at, one timer for every user, as in LumiAH's
 * own entry, so it is none.
 */
const TICK_MS = 1_000;

/**
 * The session the mount's own requests to LumiAH's page contract are answered to. No page has it:
 * an answer addressed to it is taken here and goes to no browser.
 */
const MOUNT_SESSION = "lre-harness-mount";

/**
 * How many chats' owners, and how many chats' records, are kept in memory: what the ledger keeps
 * open, times the same factor its own per-chat notes are held to (`ledger-io.ts`). What falls out
 * is read again, so the numbers change how often that happens and never an answer.
 */
const OWNERS_KEPT = OPEN_CHATS_CAP * 8;
const RECORDS_KEPT = OPEN_CHATS_CAP;

/** What the switch is refused with for a chat that plays no world. */
const NOT_A_WORLD_CHAT = `${NAME}'s harness answers the chats that play one of its worlds. This chat plays none: give it a world first (the ${NAME} drawer → Worlds), or use LumiAH itself for a chat without one.`;

function keep<K, V>(map: Map<K, V>, key: K, value: V, most: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > most) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

const under = (path: string): string => (path === "" ? STORAGE : `${STORAGE}/${path.replace(/^\/+/, "")}`);

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Where LumiAH's record sits in what it is shown of a message. It is shown the records the ledger
 * holds for the message's swipes (`{ v: 1, swipes }`, as its own entry would be), and a record it
 * writes comes back as the one swipe it is for, which the host below hands to the ledger. A deleted
 * swipe moves nothing here: the ledger moves its own records, and LumiAH's with them.
 */
const LEDGER_ANCHORS: AnchorCodec = {
  read: (own, swipe) => (isRecord(own) && isRecord(own.swipes) ? ((own.swipes[String(swipe)] as JsonValue | undefined) ?? null) : null),
  write: (_own, swipe, record) => ({ put: { swipe, record } }),
  swipeDeleted: () => null,
};

/** LumiAH mounted in the engine: its backend, and the host it was given. */
export interface Mounted {
  backend: Backend;
  host: BackendHost;
}

/**
 * Builds LumiAH's backend into the engine, over `base` (Lumiverse as LumiAH's own host gives it:
 * `createSpindleHost`, or a test's), and connects the two: the engine's side of a turn to LumiAH's
 * extension points, and LumiAH's switch, workspace and side sessions to the engine's ports.
 */
export function mountHarness(rt: Runtime, base: BackendHost, env: BackendEnv): Mounted {
  const engine = rt.harness;
  const owners = new Map<ChatId, UserId>();
  const records = new Map<ChatId, Promise<Map<MessageId, Record<string, JsonObject>>>>();
  const touched: ((chatId: string, gone: boolean, userId: string | null) => void)[] = [];
  const waiting = new Map<string, PromiseWithResolvers<unknown>>();
  let asked = 0;

  const ownerOf = (chatId: ChatId): UserId | null => owners.get(chatId) ?? rt.ledger.ownerOf(chatId);

  /** LumiAH's records on each reply of a chat, by message, from the chat's ledger: read once and kept until the chat or a record of it changes. */
  const recordsOf = (chatId: ChatId, userId: UserId): Promise<Map<MessageId, Record<string, JsonObject>>> => {
    const held = records.get(chatId);
    if (held) return held;
    const read = engine.anchors(chatId, userId).then((rows) => new Map(rows.map((row) => [row.messageId, row.swipes])));
    keep(records, chatId, read, RECORDS_KEPT);
    // A read that failed is asked again, not kept as the answer.
    read.catch(() => {
      if (records.get(chatId) === read) records.delete(chatId);
    });
    return read;
  };

  /** Whether a chat plays a world of the engine's: the chats this LumiAH may answer. */
  const worldChat = async (chatId: ChatId, userId: UserId): Promise<boolean> => (await rt.runOf(chatId, userId)) !== null;

  const refuse = (reqId: string, code: "unavailable" | "conflict", message: string, userId: string, session: string | undefined): void => {
    base.frontend.send({ lah: UI_VERSION, type: "lah.error", reqId, code, message }, userId, session);
  };

  /**
   * LumiAH's switch for a chat, pressed on one of its pages. For a chat that plays a world it is the
   * chat's engine: on is the harness, and off, for a chat the harness plays, is the classic steps
   * (GM → This chat → Engine has the third). The choice is made through the engine's one door,
   * then LumiAH answers its page itself, with the chat as it now stands and where the page asked
   * its turns to run. Any other chat can't be switched on here.
   */
  const switched = async (set: { reqId: string; chatId: string; on: boolean }, userId: string, session: string | undefined, pass: () => void): Promise<void> => {
    if (!(await worldChat(set.chatId, userId))) {
      if (set.on) refuse(set.reqId, "unavailable", NOT_A_WORLD_CHAT, userId, session);
      else pass();
      return;
    }
    const plays = (await rt.chatKnowledge.engine(set.chatId, userId)) === "harness";
    if (set.on !== plays) {
      try {
        await engine.choose(set.chatId, userId, set.on ? "harness" : "classic");
      } catch (error) {
        if (!(error instanceof EngineRefused)) throw error;
        refuse(set.reqId, error.code, error.message, userId, session);
        return;
      }
    }
    pass();
  };

  const host: BackendHost = {
    ...base,

    // LumiAH says no turn's record can be kept on a Lumiverse that can't write an extension's own entry on a message. Here no record is kept there: each goes to the chat's ledger, which every Lumiverse the engine runs on can hold.
    capability: (name) => name === "chat-lean-messages-v1" || base.capability(name),

    frontend: {
      send(message, userId, sessionId) {
        if (sessionId !== MOUNT_SESSION) return base.frontend.send(message, userId, sessionId);
        const answer = uiMessageOf(message);
        if (answer === null || (answer.type !== "lah.result" && answer.type !== "lah.error")) return;
        const asker = waiting.get(answer.reqId);
        waiting.delete(answer.reqId);
        if (answer.type === "lah.result") asker?.resolve(answer.body);
        else asker?.reject(new Error(answer.message));
      },
      onMessage(handler) {
        base.frontend.onMessage((payload, userId, session) => {
          const read = uiRequestOf(payload);
          const request = read !== null && "request" in read ? read.request : null;
          if (request === null || request.type !== "lah.chat.set") return handler(payload, userId, session);
          void switched(request, userId, session, () => handler(payload, userId, session)).catch((error: unknown) => {
            base.log("error", `[${NAME}] the harness's switch for chat ${request.chatId} failed: ${words(error)}`);
            base.frontend.send({ lah: UI_VERSION, type: "lah.error", reqId: request.reqId, code: "internal", message: `${NAME} couldn't switch the chat (${words(error)}).` }, userId, session);
          });
        });
      },
      onClosed: (handler) => base.frontend.onClosed(handler),
    },

    events: {
      ...base.events,
      onChatTouched(handler) {
        touched.push(handler);
        base.events.onChatTouched(handler);
      },
    },

    registerInterceptor(handler, options) {
      base.registerInterceptor((input) => {
        keep(owners, input.chatId, input.userId, OWNERS_KEPT);
        return handler(input);
      }, options);
    },

    storage: {
      read: (path, userId) => base.storage.read(under(path), userId),
      write: (path, text, userId) => base.storage.write(under(path), text, userId),
      remove: (path, userId) => base.storage.remove(under(path), userId),
      stat: (path, userId) => base.storage.stat(under(path), userId),
      list: (dir, userId) => base.storage.list(under(dir), userId),
    },

    chats: {
      ...base.chats,
      async get(chatId, userId) {
        const chat = await base.chats.get(chatId, userId);
        if (chat !== null) keep(owners, chatId, userId, OWNERS_KEPT);
        return chat;
      },
      async list(userId, offset, limit) {
        const page = await base.chats.list(userId, offset, limit);
        for (const chat of page.chats) keep(owners, chat.id, userId, OWNERS_KEPT);
        return page;
      },
      async messages(chatId, range) {
        const rows = await base.chats.messages(chatId, range);
        const userId = ownerOf(chatId);
        // A chat that plays no world has no ledger, and this LumiAH no record in it.
        const held = userId !== null && (await worldChat(chatId, userId)) ? await recordsOf(chatId, userId) : null;
        return rows.map((message): HostMessage => {
          const swipes = held?.get(message.id);
          return { ...message, own: swipes !== undefined && Object.keys(swipes).length > 0 ? { v: 1, swipes } : null };
        });
      },
      async setOwn(chatId, messageId, value) {
        const put = isRecord(value) && isRecord(value.put) ? value.put : null;
        if (put === null || typeof put.swipe !== "number" || !isRecord(put.record)) throw new Error(`${NAME} keeps LumiAH's record of a turn in the chat's ledger, and this isn't one record for one swipe.`);
        const userId = ownerOf(chatId);
        if (userId === null) throw new Error(`${NAME} doesn't know whose chat ${chatId} is, so the turn's record wasn't kept.`);
        records.delete(chatId);
        // No record of a harness turn on that swipe, and no turn about to write one (a reply no turn was played for): there is nothing for LumiAH's record to ride in. Said once, here; LumiAH is answered so it doesn't try again.
        if (!(await engine.anchor(chatId, userId, messageId, put.swipe, put.record as JsonObject))) base.log("warn", `[${NAME}] chat ${chatId}: LumiAH's record for swipe ${put.swipe} of message ${messageId} wasn't kept (the engine recorded no harness turn there)`);
      },
    },

    lore: {
      book: () => Promise.resolve(null),
      entries: () => Promise.resolve([]),
      entry: () => Promise.resolve(null),
      record: () => Promise.resolve(null),
      records: () => Promise.resolve([]),
      global: () => Promise.resolve([]),
      ofCharacter: () => Promise.resolve([]),
      ofPersona: () => Promise.resolve(null),
    },
  };

  // The chat's records are read again when Lumiverse says the chat changed.
  base.events.onChatTouched((chatId) => void records.delete(chatId));

  const extension = engine.extension;
  const backend = createBackend(host, env, {
    identity: { identifier: base.identifier, name: NAME, connectionName: NAME },
    extension: {
      name: extension.name,
      definitions: (userId, chatId) => extension.definitions?.({ userId, chatId }) ?? Promise.resolve({}),
      claim: (chat, userId) => extension.claim?.({ userId, chatId: chat.id, chat }) ?? Promise.resolve(null),
      writerRequest: (request, userId) => extension.writerRequest?.({ ...request, userId }) ?? Promise.resolve(null),
      runBegan: (run, userId) => extension.runBegan?.({ ...run, userId }) ?? Promise.resolve(),
      replyWritten: (reply, userId) => extension.replyWritten?.({ ...reply, userId }) ?? Promise.resolve(),
      runEnded: (run, userId) => extension.runEnded?.({ ...run, userId }) ?? Promise.resolve(),
    },
    tools: {
      list: (chatId, userId) => engine.tools.list(chatId, userId),
      call: (call, signal, userId) => engine.tools.call(call, signal, userId),
    },
    anchor: LEDGER_ANCHORS,
    // The manifest asks for neither: the engine reads no character card and no persona, and LumiAH's tools that rest on them are absent here.
    declined: ["characters", "personas"],
  });

  /** One request of LumiAH's page contract, made by the mount itself: its answer's body, or a rejection in LumiAH's own words. */
  const ask = <T>(userId: UserId, request: { type: string } & JsonObject): Promise<T> => {
    const reqId = `${MOUNT_SESSION}-${++asked}`;
    const asker = Promise.withResolvers<unknown>();
    waiting.set(reqId, asker);
    backend.ui
      .message({ lah: UI_VERSION, reqId, ...request }, userId, MOUNT_SESSION)
      .then((known) => {
        if (!known) asker.reject(new Error(`LumiAH has no request ${request.type}`));
      })
      .catch((error: unknown) => asker.reject(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        // Answered, or it never will be.
        waiting.delete(reqId);
        asker.reject(new Error(`LumiAH didn't answer ${request.type}`));
      });
    return asker.promise as Promise<T>;
  };

  // LumiAH's switch for a chat follows the chat's engine. A chat it is already as asked for is left as it is: its place (built in, or a runtime the user chose for it) is the user's.
  engine.pin = async (chatId, userId, harness) => {
    const { chat } = await ask<{ chat: ChatView }>(userId, { type: "lah.chat.get", chatId });
    if (chat.on !== harness) await ask(userId, { type: "lah.chat.set", chatId, on: harness });
  };

  // What keeps LumiAH from answering this user's chats where they run built in, as LumiAH itself reports it to its pages: a permission it can't do without. LumiAH's page names the permission beside its words ("needs it to …"); here it is one sentence, so the name leads. What LumiAH reports of a runtime (a Lumiverse no runtime can link to) keeps no chat from the harness: a runtime is an option, and its own page says what it lacks.
  engine.ready = async (userId) => {
    const state = await ask<UiState>(userId, { type: "lah.hello" });
    const lacks = state.permissions.filter((need) => need.needed).map((need) => `The permission "${need.id}" isn't granted: ${need.what} ${need.todo}`);
    return lacks.length > 0 ? lacks.join(" ") : null;
  };

  engine.owner = (chatId) => Promise.resolve(owners.get(chatId) ?? null);

  // Lumiverse tells nobody of a write that isn't a message's own: LumiAH hears of its record in the ledger here, and reads the chat's records again.
  engine.recorded = (chatId) => {
    records.delete(chatId);
    // The chat's user as Lumiverse's own events named them; null where none has, and LumiAH then finds whose chat it is.
    for (const handler of touched) handler(chatId, false, owners.get(chatId) ?? null);
  };

  const core = (userId: UserId, op: string, args: JsonObject, where: { chat?: ChatId | null; side?: string; job?: string } = {}): Promise<JsonValue> => backend.asks.ask(userId, op, args, where) as Promise<JsonValue>;

  engine.core = {
    ask: core,
    stop(userId, run, why) {
      if (backend.builtin.stop(userId, run, why)) return true;
      // A run in the user's runtime isn't stopped from here: the runtime is told, as LumiAH's own live view tells it, and says how the run ended when it has.
      const stream = backend.live.streamOf(userId, run);
      if (stream !== null) void ask(userId, { type: "lah.turn.stop", stream, turn: run }).catch((error: unknown) => base.log("warn", `[${NAME}] run ${run.slice(0, 8)} couldn't be stopped in its runtime: ${words(error)}`));
      return false;
    },
    running: (userId) => backend.builtin.runs(userId),
  };

  engine.files = ({ chatId, userId }) => chatFiles((op, args) => core(userId, op, { chatId, area: "chat", ...args }, { chat: chatId }));

  // A job's writes are tied to the turn it belongs to: the engine is told of each as LumiAH lists it.
  backend.jobs.onChange((userId) => {
    for (const job of backend.jobs.state(userId, false, false).active) engine.jobKnown(job);
  });

  return { backend, host };
}

/** A file as LumiAH's workspace lists one: its path in the area, its version now, its size. */
function fileOf(raw: unknown): { path: string; hash: string; chars: number } | null {
  return isRecord(raw) && typeof raw.path === "string" && typeof raw.hash === "string" ? { path: raw.path, hash: raw.hash, chars: typeof raw.chars === "number" ? raw.chars : 0 } : null;
}

/**
 * The chat's area of LumiAH's workspace as the engine's tools reach it, through what LumiAH's own
 * Workspace page reads and writes it with: where the chat runs (built in, or in the user's
 * runtime), under the workspace's own limits and its rule that a write names the version it was
 * made on. A refusal of LumiAH's is the tool's answer, in LumiAH's words.
 */
function chatFiles(ask: (op: string, args: JsonObject) => Promise<JsonValue>): HarnessFiles {
  const read = async (path: string): Promise<HarnessFile | null> => {
    try {
      const got = await ask("workspace.read", { path });
      const file = isRecord(got) ? fileOf(got.file) : null;
      return file !== null && isRecord(got) && typeof got.text === "string" ? { path: file.path, text: got.text, version: file.hash } : null;
    } catch (error) {
      if (error instanceof UiRefused && error.code === "not_found") return null;
      throw error;
    }
  };
  return {
    async list(folder) {
      const got = await ask("workspace.list", {});
      const files = isRecord(got) && Array.isArray(got.files) ? got.files : [];
      return files.flatMap((raw) => {
        const file = fileOf(raw);
        return file !== null && file.path.startsWith(folder) ? [{ path: file.path, size: file.chars, version: file.hash }] : [];
      });
    },
    read,
    async write(path, text, base) {
      try {
        const got = await ask("workspace.write", { path, text, base });
        const file = isRecord(got) ? fileOf(got.file) : null;
        if (file === null) throw new Error("LumiAH's workspace answered a write with no file");
        return { version: file.hash };
      } catch (error) {
        if (!(error instanceof UiRefused)) throw error;
        // Written meanwhile by someone else: the version to read and make the change on again.
        const version = error.code === "conflict" ? ((await read(path).catch(() => null))?.version ?? null) : null;
        return { refused: { code: error.code, reason: error.message, version } };
      }
    },
  };
}

/** Starts LumiAH's backend in the engine's worker, over Lumiverse itself. */
export function startHarness(rt: Runtime): Backend {
  const base = createSpindleHost(ENGINE_EXTENSION);
  const { backend } = mountHarness(rt, base, {
    now: () => Date.now(),
    later: (ms, fn) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    build: BUILD,
  });
  setInterval(() => {
    backend.tick().catch((error: unknown) => base.log("warn", `[${NAME}] the harness's tick failed: ${words(error)}`));
  }, TICK_MS);
  base.log("info", `[${NAME}] harness ${BUILD} built in`);
  return backend;
}
