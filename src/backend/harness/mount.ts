// LumiAH's backend, built into the engine (HARNESS-SLICE3 "Boundary with LumiAH"; LumiAH's DESIGN
// §21, §25). LumiAH's own `createBackend` runs here, in the engine's Spindle worker, over the same
// Lumiverse: its prompt interceptor, which tags each reply for the runtime, its link to a runtime, its
// pages' requests. The engine is the extension it is built into: it gives LumiAH its definitions,
// its claim on a chat, the model each agent runs on, its hooks around a run and its tools
// (`HarnessEngine`), and it takes back what it needs of LumiAH (the switch for a chat, where the
// user's runtime stands, the workspace, side sessions). Every turn runs in the user's runtime, which
// calls its agents' models itself on its own connections: no turn and no model call runs here.
//
// LumiAH is given Lumiverse through a host that differs from Lumiverse's own in four places, each
// because the two extensions are one extension here:
// - **Storage.** LumiAH's files and the engine's sit in one user storage, and both keep a
//   `settings.json`: LumiAH's are all under one folder of it.
// - **The record on a message.** A reply holds one record, the engine's, and LumiAH's record of the
//   turn rides inside it (`Rec.harness`). LumiAH reads its records from the chat's ledger and
//   writes them to it; it never reads or writes the message's entry itself, which is the ledger's.
//   LumiAH is told so (`ownElsewhere`), so the runtime's copy of a chat reads the records from here
//   and is told when they change.
// - **Lore.** In a chat the engine plays, World Info is the engine's to read, under its secrets
//   rule, through its own lore tools. LumiAH is shown no book, and is told so (`declinesLore`).
// - **The switch for a chat.** This LumiAH answers the chats that play a world on the harness
//   engine, and no other: its switch for a chat and the chat's engine are one choice
//   (`HarnessEngine.choose`), whichever page it is made on (`ownSwitch`).

import { settingsOf } from "lumi-ah/core";
import type { AnchorCodec, Backend, BackendEnv, BackendHost, HostMessage } from "lumi-ah/extension/backend";
import { CORE_KEY, createBackend, createSpindleHost, UiRefused } from "lumi-ah/extension/backend";
import type { ChatView } from "lumi-ah/shared";
import { UI_VERSION, uiMessageOf, uiRequestOf } from "lumi-ah/shared";
import { hashJson } from "../../shared/hash";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import { ENGINE_EXTENSION } from "../../shared/protocol";
import type { HarnessFile, HarnessFiles } from "../agents/tools/harness-ports";
import { OPEN_CHATS_CAP } from "../ledger-io";
import type { Runtime } from "../runtime";
import { EngineRefused } from "./extension";

/** The engine as LumiAH's pages, its messages and its runtime's words name it. */
const NAME = "LumiRPEngine";

/**
 * Where LumiAH's Settings, its Timeouts page among them, are shown here: the drawer's Harness tab,
 * LumiAH's System group, its Settings page. A timeout's words name it in place of "LumiRPEngine's
 * Settings", the engine's own tab, which doesn't hold them: "Runtime wait (LumiRPEngine's Harness
 * tab → System → Settings → Timeouts → Waiting for the runtime)". The runtime is told it too, so its
 * own timeouts say the same.
 */
const SETTINGS_AT = `${NAME}'s Harness tab → System → Settings`;

/** The folder of the user's storage LumiAH's files are under. */
const STORAGE = "harness";

/** The build this bundle came from, as LumiAH's own entry reads it: `bun run build` defines it into every bundle; "dev" run from source. */
const BUILD: string = process.env.LAH_BUILD_ID ?? "dev";

/**
 * The runtime this build ships beside its backend (`dist/lumiah.js`): its sha256 and its size, which
 * `bun run build` defines into this bundle beside the build id, as LumiAH's own entry reads them. A
 * runtime that says hello on another build is offered it, and updates itself from it. Run from
 * source (no build), there are none, and no runtime is offered an update.
 */
const RUNTIME_SHA256: string = process.env.LAH_RUNTIME_SHA256 ?? "";
const RUNTIME_SIZE: string = process.env.LAH_RUNTIME_SIZE ?? "";

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

/** The permissions without which a reply can't reach the runtime as a turn: the interceptor tags it, and the tag travels in its parameters. Untagged, the runtime would pass it to a writer with no turn played. */
const RUNTIME_NEEDS: readonly { id: string; what: string }[] = [
  { id: "interceptor", what: "mark each reply of a harness chat for its runtime" },
  { id: "generation_parameters", what: "carry that mark to the runtime with the reply's request" },
];

/** Why the runtime can't answer chats yet where it is linked but not set up: LumiAH's words cover a runtime that isn't linked. */
const NOT_SET_UP = `${NAME}'s runtime is linked, but it isn't set up to answer chats yet: mint its key on the Runtime page of the Harness tab, which also makes the loopback connection that carries the chats' replies to it.`;

/** Why the runtime can't play a turn where it has no connection of its own to call its agents' models on. */
const NO_CONNECTION = `${NAME}'s runtime has no connection to call a model on, so its agents can't play this chat. Add one on the Runtime page of the Harness tab, under Connections.`;

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
 * holds for the message's swipes (`{ v: 1, swipes }`, as its own entry would be: `reads`, so the
 * runtime's copy of the chat reads them the same way), and a record it writes comes back as the one
 * swipe it is for, which the host below hands to the ledger. A deleted swipe moves nothing here: the
 * ledger moves its own records, and LumiAH's with them.
 */
const LEDGER_ANCHORS: AnchorCodec = {
  reads: { under: null },
  read: (own, swipe) => (isRecord(own) && isRecord(own.swipes) ? ((own.swipes[String(swipe)] as JsonValue | undefined) ?? null) : null),
  write: (_own, swipe, record) => ({ put: { swipe, record } }),
  swipeDeleted: () => null,
};

/** LumiAH's records on one message as its entry would hold them (`{ v: 1, swipes }`), and as both the host's `chats.messages` and the runtime's copy are given them; null for a message with none. */
const entryOf = (swipes: Record<string, JsonObject> | undefined): JsonObject | null => (swipes !== undefined && Object.keys(swipes).length > 0 ? { v: 1, swipes } : null);

/** LumiAH's records on each message of a chat that holds any, as their entries hold them: what the runtime's copy of the chat reads (`ownElsewhere.read`). */
function entriesOf(held: ReadonlyMap<MessageId, Record<string, JsonObject>>): Record<string, JsonObject> {
  return Object.fromEntries(
    [...held].flatMap(([messageId, swipes]) => {
      const entry = entryOf(swipes);
      return entry === null ? [] : [[messageId, entry]];
    }),
  );
}

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
  /** Who hears that a chat's records changed: LumiAH's backend, which tells its runtimes' copies of the chat (`ownElsewhere.onChanged`). */
  const recordsHeard: ((chatId: string, userId: string | null) => void)[] = [];
  /**
   * What LumiAH was last given of each chat's records, as a hash of their entries (`entriesOf`), for
   * the chats it was given any of: a change of the ledger that leaves them as they were tells it
   * nothing, and one of a chat it holds none of costs nothing (`ledgerHeard`).
   */
  const given = new Map<ChatId, string>();
  /** The chats whose records are being compared with what LumiAH was given now: true where the ledger changed again meanwhile, so they are compared once more after. */
  const comparing = new Map<ChatId, boolean>();
  const waiting = new Map<string, PromiseWithResolvers<unknown>>();
  let asked = 0;

  /** Keeps what LumiAH is given of a chat's records (`given`): nothing where it holds none. */
  const gave = (chatId: ChatId, held: ReadonlyMap<MessageId, Record<string, JsonObject>>): void => {
    const entries = entriesOf(held);
    if (Object.keys(entries).length === 0) given.delete(chatId);
    else keep(given, chatId, hashJson(entries), OWNERS_KEPT);
  };

  const ownerOf = (chatId: ChatId): UserId | null => owners.get(chatId) ?? rt.ledger.ownerOf(chatId);

  /** LumiAH's records on each reply of a chat, by message, from the chat's ledger: read once and kept until the chat or a record of it changes. */
  const recordsOf = (chatId: ChatId, userId: UserId): Promise<Map<MessageId, Record<string, JsonObject>>> => {
    const held = records.get(chatId);
    if (held) return held;
    const read = engine.anchors(chatId, userId).then((rows) => new Map(rows.map((row) => [row.messageId, row.swipes])));
    keep(records, chatId, read, RECORDS_KEPT);
    // What LumiAH is given is kept to compare the ledger with. A read that failed is asked again, not kept as the answer.
    read.then(
      (held) => {
        if (records.get(chatId) === read) gave(chatId, held);
      },
      () => {
        if (records.get(chatId) === read) records.delete(chatId);
      },
    );
    return read;
  };

  /** A chat's records changed, or may have: what is kept of them here is read again, and LumiAH is told, so each runtime's copy of the chat reads them again too. `userId`: whose chat it is, where that is known. */
  const recordsChanged = (chatId: ChatId, userId: UserId | null): void => {
    records.delete(chatId);
    for (const listener of recordsHeard) listener(chatId, userId);
  };

  /** A chat's records changed in its ledger, which Lumiverse tells nobody of: LumiAH reads them again, from `fresh` where the change was read already, and each runtime's copy of the chat with it; LumiAH's own reads of the chat hear it as Lumiverse's own change of the chat. */
  const ledgerWrote = (chatId: ChatId, userId: UserId | null, fresh?: Map<MessageId, Record<string, JsonObject>>): void => {
    if (fresh === undefined) records.delete(chatId);
    else {
      keep(records, chatId, Promise.resolve(fresh), RECORDS_KEPT);
      gave(chatId, fresh);
    }
    for (const listener of recordsHeard) listener(chatId, userId);
    for (const handler of touched) handler(chatId, false, userId);
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
      everyone: (message) => base.frontend.everyone(message),
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
        return rows.map((message): HostMessage => ({ ...message, own: entryOf(held?.get(message.id)) }));
      },
      async setOwn(chatId, messageId, value) {
        const put = isRecord(value) && isRecord(value.put) ? value.put : null;
        if (put === null || typeof put.swipe !== "number" || !isRecord(put.record)) throw new Error(`${NAME} keeps LumiAH's record of a turn in the chat's ledger, and this isn't one record for one swipe.`);
        const userId = ownerOf(chatId);
        if (userId === null) throw new Error(`${NAME} doesn't know whose chat ${chatId} is, so the turn's record wasn't kept.`);
        recordsChanged(chatId, userId);
        // No record of a harness turn on that swipe, and no turn about to write one (a reply no turn was played for): there is nothing for LumiAH's record to ride in. Said once, here; LumiAH is answered so it doesn't try again.
        if (!(await engine.anchor(chatId, userId, messageId, put.swipe, put.record as JsonObject))) base.log("warn", `[${NAME}] chat ${chatId}: LumiAH's record for swipe ${put.swipe} of message ${messageId} wasn't kept (the engine recorded no harness turn there)`);
      },
    },

    // LumiAH is told it is given no lore (`declinesLore`), and shown none.
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

  // The chat's records are read again when Lumiverse says the chat changed (a swipe deleted moves them with it), here and in each runtime's copy of the chat.
  base.events.onChatTouched((chatId, _gone, userId) => recordsChanged(chatId, userId));

  const extension = engine.extension;
  const backend = createBackend(host, env, {
    identity: { identifier: base.identifier, name: NAME, connectionName: NAME, settingsAt: SETTINGS_AT },
    extension: {
      name: extension.name,
      definitions: (userId, chatId) => extension.definitions?.({ userId, chatId }) ?? Promise.resolve({}),
      claim: (ask, userId) => extension.claim?.({ ...ask, userId }) ?? Promise.resolve(null),
      runBegan: (run, userId) => extension.runBegan?.({ ...run, userId }) ?? Promise.resolve(),
      agentModel: (ask, userId) => extension.agentModel?.({ ...ask, userId }) ?? Promise.resolve(null),
      releasing: (release, userId) => extension.releasing?.({ ...release, userId }) ?? Promise.resolve(null),
      released: (release, userId) => extension.released?.({ ...release, userId }) ?? Promise.resolve(),
      replyWritten: (reply, userId) => extension.replyWritten?.({ ...reply, userId }) ?? Promise.resolve(),
      runEnded: (run, userId) => extension.runEnded?.({ ...run, userId }) ?? Promise.resolve(),
    },
    tools: {
      list: (chatId, userId) => engine.tools.list(chatId, userId),
      call: (call, signal, userId) => engine.tools.call(call, signal, userId),
    },
    anchor: LEDGER_ANCHORS,
    // LumiAH's records are the chat's ledger's (see `chats` above): the runtime's copy of a chat reads them from here, and is told when they change.
    ownElsewhere: {
      async read(chatId, userId) {
        // A chat that plays no world has no ledger, and this LumiAH no record in it.
        if (!(await worldChat(chatId, userId))) return {};
        return entriesOf(await recordsOf(chatId, userId));
      },
      onChanged: (listener) => void recordsHeard.push(listener),
    },
    declinesLore: true,
    // The manifest asks for neither: the engine reads no character card and no persona, and LumiAH's tools that rest on them are absent here.
    declined: ["characters", "personas"],
    // The engine's own pages switch a chat on and off (GM → This chat → Engine): LumiAH's pages offer no switch of their own, and say where it is.
    ownSwitch: true,
    // The story record and the author's notebook are this engine's memory: LumiAH's own chronicle would only be a second, unchecked one, so no agent here can start it.
    withoutAgents: ["chronicler", "story-reader"],
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

  const core = (userId: UserId, op: string, args: JsonObject, where: { chat?: ChatId | null; side?: string; job?: string } = {}): Promise<JsonValue> => backend.asks.ask(userId, op, args, where) as Promise<JsonValue>;

  // LumiAH's switch for a chat follows the chat's engine: on, pinned to the runtime's loopback connection, for a chat the harness plays (set again where it isn't on that connection), and off for any other. LumiAH refuses it in its own words where it can't be set now: no runtime was ever set up, another harness answers the chat, a permission isn't granted.
  engine.pin = async (chatId, userId, harness) => {
    const { chat } = await ask<{ chat: ChatView }>(userId, { type: "lah.chat.get", chatId });
    if (harness && (!chat.on || chat.connection?.loopback !== true)) await ask(userId, { type: "lah.chat.set", chatId, on: true });
    else if (!harness && chat.on) await ask(userId, { type: "lah.chat.set", chatId, on: false });
  };

  /**
   * Whether the runtime that plays the chat (about no chat: the user's runtime heard from last) has a
   * connection of its own to call its agents' models on, as its Runtime page lists them. One that
   * can't be asked now isn't held up here: its agents say why if they can't run.
   */
  const connected = async (userId: UserId, chatId: ChatId | null): Promise<boolean> => {
    const listed = await core(userId, "connections.list", {}, chatId === null ? {} : { chat: chatId }).catch(() => null);
    return !(isRecord(listed) && Array.isArray(listed.connections) && listed.connections.length === 0);
  };

  // What keeps the user's runtime from answering a chat now, in words that say what to do: a permission the reply's way there needs, then LumiAH's own word on the runtime the chat's replies reach (not linked, refused, never set up), then a runtime linked but not set up to answer chats, then one with no connection to call a model on.
  engine.runtime = async (userId, chatId) => {
    const lacks = RUNTIME_NEEDS.filter((need) => !base.granted(need.id)).map((need) => `The permission "${need.id}" isn't granted: ${NAME} needs it to ${need.what}. Grant it in Lumiverse (Extensions → ${NAME} → Permissions).`);
    if (lacks.length > 0) return lacks.join(" ");
    const state = await backend.runtimeState(userId, chatId);
    if (!state.linked) return state.words ?? NOT_SET_UP;
    if (!state.ready) return NOT_SET_UP;
    return (await connected(userId, chatId)) ? null : NO_CONNECTION;
  };

  // A reply of a chat goes to the runtime where LumiAH is on for the chat, no other harness answers it, and the reply's connection is the runtime's loopback for the chat.
  engine.seated = async (chatId, userId, connectionId) => {
    const { chat } = await ask<{ chat: ChatView }>(userId, { type: "lah.chat.get", chatId });
    const connection = chat.connection;
    return chat.on && chat.other === undefined && connection !== null && connection.loopback && (connectionId === null || connection.id === connectionId);
  };

  // What each agent that can run in a chat can use there, and what of its tools it can't, with why, asked where the chat runs: a turn of a harness chat starts only once every agent of the engine's can use each tool it is given.
  engine.held = (userId, chatId) => backend.agents.held(userId, chatId);

  // A user's runtime linked, dropped, was refused or got its connection: the harness chats that couldn't be set to it are set now.
  backend.onRuntime((userId) => void engine.runtimeChanged(userId).catch((error: unknown) => base.log("warn", `[${NAME}] the harness chats weren't set to the runtime: ${words(error)}`)));

  engine.owner = (chatId) => Promise.resolve(owners.get(chatId) ?? null);

  // Lumiverse tells nobody of a write that isn't a message's own: LumiAH hears of its record in the ledger here, reads the chat's records again, and tells each runtime's copy of the chat. The chat's user as Lumiverse's own events named them; null where none has, and LumiAH then finds whose chat it is.
  engine.recorded = (chatId) => ledgerWrote(chatId, owners.get(chatId) ?? null);

  // The ledger changed (`HarnessEngine.ledgerChanged`), whoever changed it: an edit Discarded on the engine's own page drops the records after it, and nothing else tells of that. Where LumiAH was given records of the chat they are read once more, one read for each change at most, and LumiAH is told only where they now differ from what it was given; the read is what LumiAH reads next. A chat it was given none of (one the harness doesn't play) costs nothing.
  engine.ledgerHeard = (chatId, userId) => {
    if (!given.has(chatId)) return;
    if (comparing.has(chatId)) return void comparing.set(chatId, true);
    comparing.set(chatId, false);
    void (async () => {
      do {
        comparing.set(chatId, false);
        const fresh = new Map((await engine.anchors(chatId, userId)).map((row) => [row.messageId, row.swipes]));
        const entries = entriesOf(fresh);
        if ((Object.keys(entries).length === 0 ? undefined : hashJson(entries)) !== given.get(chatId)) ledgerWrote(chatId, userId, fresh);
      } while (comparing.get(chatId) === true);
    })()
      .catch((error: unknown) => base.log("warn", `[${NAME}] chat ${chatId}: LumiAH's records weren't compared with the ledger after it changed (${words(error)})`))
      .finally(() => comparing.delete(chatId));
  };

  // How long LumiAH waits for an answer of the engine's, for a user: its own Wait for the extension, as its Settings hold it.
  engine.extensionWait = async (userId) => settingsOf((await backend.settings.values(userId))[CORE_KEY]).extension.waitMs;

  engine.core = {
    ask: core,
    stop(userId, run) {
      // Every run is in the user's runtime: it is told to stop, as LumiAH's own live view tells it, and says how the run ended when it has.
      const stream = backend.live.streamOf(userId, run);
      if (stream !== null) void ask(userId, { type: "lah.turn.stop", stream, turn: run }).catch((error: unknown) => base.log("warn", `[${NAME}] run ${run.slice(0, 8)} couldn't be stopped in its runtime: ${words(error)}`));
    },
    spent(userId, stream) {
      // The latest usage the stream's run traced: what it has spent so far, and what its latest call weighed.
      const usage = backend.live.whole(userId, stream)?.events.findLast((record) => record.event.kind === "usage")?.event;
      return usage?.kind === "usage" ? { in: usage.turn.in, out: usage.turn.out, calls: usage.turn.calls, last: usage.call.in + usage.call.out } : null;
    },
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
 * Workspace page reads and writes it with: in the runtime that plays the chat, under the
 * workspace's own limits and its rule that a write names the version it was made on. A write LumiAH
 * refuses is the tool's answer, in LumiAH's words; a read or a listing it refuses (no runtime
 * linked) fails the call with LumiAH's words, which the agent is told.
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
    runtime: { sha256: RUNTIME_SHA256, size: Number(RUNTIME_SIZE) },
  });
  setInterval(() => {
    backend.tick().catch((error: unknown) => base.log("warn", `[${NAME}] the harness's tick failed: ${words(error)}`));
  }, TICK_MS);
  base.log("info", `[${NAME}] harness ${BUILD} started`);
  return backend;
}
