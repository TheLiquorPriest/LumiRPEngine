// RPE's door to Lumiverse, put together and mounted in the app (STANDALONE-PLAN §4.2, §4.3, §4.4): the
// session as RPE's user, the reads (the database file where RPE runs beside Lumiverse, its HTTP routes
// otherwise), the chat port, the event socket and the changes it hears, the relay socket and the relay,
// and the routes: the provider endpoint and its model list, which the app holds to the provider key;
// the routes only the extension calls (its question, a page's start-up facts, a page's follows), which
// the app holds to the extension's registration key, and which serve only the Lumiverse user RPE
// belongs to; and the page route that says how the extension stands with RPE.
//
// The app (`src/app/`) mounts it as an area. Its sockets open, and it registers with the extension,
// only once the server listens (the area's `started`): the registration carries RPE's address on this
// machine's loopback, where the server listens whatever address pages reach it by, and a new
// registration key, made then and handed to the extension at once, the app keeping only its hash.
// What the extension says back (it took the registration, or refused it and why, and what it is
// missing) is logged once each time it changes, and kept for RPE's pages.

import type { Clock, HistoryRange } from "rp-harness/contract";
import { AuthRefused, bearerOf, LIVE_USER, rawRoute, route, type App, type Area } from "../../app";
import type { LumiverseAccounts } from "../../app/accounts";
import type { SettingsReader } from "../../app/config-read";
import { PAGE_SETTINGS } from "../../app/page-settings";
import { isRecord } from "../../shared/json";
import { lumiverseAccounts } from "./accounts";
import { KeptAnswers, questionRoute, type HistoryWindow, type SecrecyRules, type TurnStarts } from "./answer";
import { promptReads, type ModelRooms } from "./receipt";
import { createChatReads, type ChatReads } from "./chat";
import { createDbReader, type DbReader } from "./db";
import { followChanges, type ChatChanges } from "./events";
import { HeardGenerations } from "./heard";
import { blocksHint } from "./hint";
import { createHttpReads } from "./http-reads";
import { CONFIRM_PATH, EXTENSION_IDENTIFIER, EXTENSION_STATUS_PATH, LIVE_PATH, readCheckStopped, readConfirmAsk, readLiveAsk, START_PATH, STOPPED_PATH, USER_HEADER, type Confirmed, type ExtensionStatus, type Registration, type StartFacts } from "./pipe-wire";
import { type EndpointCall, modelsEndpoint, type OwnerPass, providerEndpoint, type TurnPlayer } from "./provider";
import { preferDatabase, type LumiverseReads } from "./reads";
import { Relay } from "./relay";
import { LumiverseSession, type Fetch, type StoredSignIn } from "./session";
import { LumiverseSocket, newFrontendSession, type OpenSocket } from "./socket";
import { LUMIVERSE_DEFAULTS, type LumiverseSettings, lumiverseSettings } from "./settings";
import { EXTENSION_KIND, extensionStatusReply } from "./shapes";
import { QUESTION_PATH } from "./wire";

/** What other lanes answer for the adapter. */
export interface AdapterLanes {
  /** The turn lane (`src/turn/`): a tagged reply played. */
  turns: TurnPlayer;
  /** The turn lane: Lumiverse's changes to the user's chats. */
  changes: ChatChanges;
  /** The history window: the first history message to keep. */
  window: HistoryWindow;
  /** The turn lane: where a turn not yet begun will start on the path a question carries, from RPE's own state alone (R-5). */
  start: TurnStarts;
  /** The turn lane: the Author's model's room for a chat's prompt, as RPH's model port reports its window and counts a prompt, and whether the story record covers messages. */
  room: ModelRooms;
  /** The lore lane: what each secret reads as in this prompt. */
  secrecy: SecrecyRules;
  /** A chat's setting: agents may read the messages the user hid. */
  hiddenReadable(chat: string): Promise<boolean>;
  /** The story lane: the stretches a chat names (`scene`, since the scene opened). */
  ranges(chat: string): Promise<Record<string, HistoryRange>>;
  /** The turn lane: the messages Lumiverse's memory stands in for with a summary in the chat's prompt, from the tag's `summary` marks. */
  summarized(chat: string): Promise<ReadonlySet<string>>;
  /** RPH's model layer, for requests passed through: its pass, given the user this RPE belongs to. */
  models: OwnerPass;
  /** The connection a request with no tag goes on; null for RPH's default (a user's choice, kept with RPE's global settings). */
  passConnection(): string | null;
  /** The turn lane, which reads the shipped files: a passed request's failure in `guidance/.prompts/reply-errors.md`'s words (key `pass-<code>`), its key alone where the file has no line for it. */
  passWords(key: string, fields: { detail?: string }): Promise<string>;
}

export interface AdapterDeps {
  fetch: Fetch;
  open: OpenSocket;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  sleep(ms: number): Promise<void>;
  /** The settings reader the composition hands every area (PlanApp-4): the door reads its limits (`settings.ts`) from the levels every chat shares, at each use; their defaults when not given. */
  settings?: SettingsReader;
}

/** RPE's door to Lumiverse, once mounted. */
export interface Lumiverse {
  session: LumiverseSession;
  reads: LumiverseReads;
  chat: ChatReads;
  /** The event socket: Lumiverse's events about the user's chats. */
  events: LumiverseSocket;
  /** The relay socket, and the relay on it. */
  relaySocket: LumiverseSocket;
  relay: Relay;
  /** The database reader, where RPE reads Lumiverse's file. */
  database: DbReader | null;
  /**
   * Lumiverse's Stop (`routes/generate.routes.ts:45-65`) as RPE's user, for the generation named alone:
   * true when Lumiverse stopped it, false when it was not going (it ended, or it is another user's,
   * `generation/active-generation-registry.ts:91-97`). No chat is named, so Lumiverse never stops
   * whatever else goes on in the chat in its place (`:53-55`); and an empty id is refused before it
   * is sent, since Lumiverse reads a request naming nothing as "stop every generation of this user"
   * (`:48`, `:63-64`).
   */
  stopGeneration(generation: string): Promise<boolean>;
}

export interface LumiverseDoor {
  /**
   * The app's area: the adapter's routes and its parts, made from the app's config and secrets when
   * mounted; its sockets open, the session is kept and RPE registers with the extension once the
   * server listens (`started`), and all of it stops when the app closes (`stopping`).
   */
  readonly area: Area;
  /** The parts, once the area is mounted in an app set up for a Lumiverse user; null before. */
  lumiverse(): Lumiverse | null;
  /** How the extension stands with RPE now, as `EXTENSION_STATUS_PATH` gives it. */
  extension(): ExtensionStatus;
  /** What RPE tells the extension of itself; null until the server listens. */
  registration(): Registration | null;
  /** The question's answers, kept by generation until its request arrives, for the check on receipt. */
  readonly answers: KeptAnswers;
  /** Lumiverse's accounts, for RPE's web app's sign-in with a Lumiverse account (`accounts.ts`): asked at Lumiverse's address in RPE's config at each call. */
  readonly accounts: LumiverseAccounts;
}

const NOT_SET_UP = "RPE is not set up for a Lumiverse yet: give it Lumiverse's address and your Lumiverse user (rpe up).";
const NOT_HEARD = "RPE has not heard from its extension in Lumiverse since it started.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** A sign-in as RPE's secrets keep it, or null. */
function storedSignIn(value: unknown): StoredSignIn | null {
  if (!isRecord(value) || typeof value.username !== "string" || typeof value.token !== "string" || typeof value.user !== "string" || typeof value.savedAt !== "number") return null;
  return { username: value.username, token: value.token, user: value.user, savedAt: value.savedAt };
}

export function lumiverseDoor(lanes: AdapterLanes, deps: AdapterDeps): LumiverseDoor {
  let app: App | null = null;
  let parts: Lumiverse | null = null;
  let key: string | null = null;
  let offChanges: (() => void) | null = null;
  let offLifecycle: (() => void) | null = null;
  /** Lumiverse's id for RPE's extension, once an event of its own names it: its grant changes name it by id alone. */
  let ownId: string | null = null;
  /**
   * RPE's extension stopped, started again or failing, or its grants changed: Lumiverse's own events on the "system" topic every
   * user's socket joins (`SPINDLE_EXTENSION_UNLOADED`, `_LOADED`, `_ERROR`, `spindle/lifecycle.ts:101-129`, `worker-host.ts:1321-1325`;
   * `SPINDLE_PERMISSION_CHANGED`, `lifecycle.ts:157`), in the words RPE's log keeps; null for any other event.
   */
  const lifecycleOf = (event: string, payload: unknown): string | null => {
    if (!isRecord(payload)) return null;
    if (payload.identifier === EXTENSION_IDENTIFIER && typeof payload.extensionId === "string") ownId = payload.extensionId;
    if (payload.identifier !== EXTENSION_IDENTIFIER && (ownId === null || payload.extensionId !== ownId)) return null;
    if (event === "SPINDLE_EXTENSION_UNLOADED") return "Lumiverse stopped RPE's extension.";
    if (event === "SPINDLE_EXTENSION_LOADED") return "Lumiverse started RPE's extension.";
    if (event === "SPINDLE_EXTENSION_ERROR") return `RPE's extension is failing in Lumiverse: ${typeof payload.error === "string" ? payload.error : "it said no more"}`;
    if (event === "SPINDLE_PERMISSION_CHANGED") return `RPE's extension was ${payload.granted === true ? "granted" : "refused"} the "${String(payload.permission)}" permission in Lumiverse.`;
    return null;
  };
  const relaySession = newFrontendSession();
  const answers = new KeptAnswers();
  const log = (message: string): void => app?.log.warn(`[lumiverse] ${message}`);
  /** Every model name RPE's connections in Lumiverse name (`lumiverse.models`, which the swap fills with each connection it takes, R-109), read at each use. */
  const rpeModels = (): string[] => app?.config.lumiverse.models ?? [];
  /** The generations the event socket hears: their activated lore, and the ones on RPE's connections whose tagged request never came. */
  const heard = new HeardGenerations({
    rpeModel: (model) => rpeModels().includes(model),
    asked: (chat, generation) => answers.answered(chat, generation),
    untaggedEnd: ({ chat, generation, untagged, stopped }) =>
      log(`generation ${generation} of chat ${chat} on RPE's connection ${stopped ? "was stopped" : "ended"} with no tagged request; ${untagged} request${untagged === 1 ? "" : "s"} with no tag came on RPE's connection meanwhile.`),
  });
  /** The door's limits as the shared levels set them now. */
  const settings = (): LumiverseSettings => (deps.settings === undefined ? LUMIVERSE_DEFAULTS : lumiverseSettings(deps.settings.shared()));
  /** How the extension stands with RPE: until it answers, RPE is not registered. */
  const status: ExtensionStatus = { registered: false, why: NOT_HEARD, missing: null, stopped: null };
  /** The status as handed out: a copy, so nobody it is handed to changes RPE's. */
  const extension = (): ExtensionStatus => ({
    registered: status.registered,
    why: status.why,
    missing: status.missing === null ? null : status.missing.map((m) => ({ ...m })),
    stopped: status.stopped === null ? null : { last: { ...status.stopped.last }, count: status.stopped.count },
  });
  /** Tells the user's pages the extension's status, as the status route answers it, at each change. */
  const publish = (): void => {
    if (app !== null) EXTENSION_KIND.publish(app.live, LIVE_USER, extension());
  };

  /** Where a browser may reach RPE directly: this machine's loopback, RPE's own address, then every name RPE is published at. */
  const addresses = (): string[] => {
    const listening = app?.listening() ?? null;
    return [...new Set([...(listening === null ? [] : [listening.loopback, listening.url]), ...(app?.config.hosts ?? []).map((host) => `https://${host}`)])];
  };
  /** What RPE tells the extension of itself: its address for the extension's road, on loopback, where RPE listens whatever its address; null until the server listens. */
  const registration = (): Registration | null => {
    const listening = app?.listening() ?? null;
    if (app === null || listening === null || key === null) return null;
    const { questionMs, logChars } = settings().extension;
    const { connection } = app.config.lumiverse;
    return { v: 1, base: listening.loopback, key, connections: connection === null ? [] : [connection], relay: relaySession, build: app.version, values: { questionMs, logChars } };
  };

  function build(at: App, user: string, url: string, signIn: StoredSignIn | null): Lumiverse {
    const cfg = at.config.lumiverse;
    const session = new LumiverseSession({ base: url.replace(/\/+$/, ""), fetch: deps.fetch, signIn, save: (s) => at.secrets.write("lumiverse", s === null ? null : { ...s }), owner: () => user, clock: deps.clock, log, keepEveryMs: () => settings().sessionCheckMs });
    const http = createHttpReads(session, () => settings().reads);
    const database = cfg.database === null ? null : createDbReader({ path: cfg.database, user, sleep: deps.sleep, log, settings: () => settings().database });
    const reads = database === null ? http : preferDatabase(database, http);
    const chat = createChatReads({ reads, user, hiddenReadable: lanes.hiddenReadable, ranges: lanes.ranges, summarized: lanes.summarized, search: () => settings().search });
    const sockets = (): LumiverseSettings["socket"] => settings().socket;
    const events = new LumiverseSocket({ session, open: deps.open, clock: deps.clock, log: (m) => log(`event socket: ${m}`), settings: sockets });
    const relaySocket = new LumiverseSocket({ session, open: deps.open, clock: deps.clock, log: (m) => log(`relay socket: ${m}`), frontendSession: relaySession, settings: sockets });
    const relay = new Relay({
      socket: relaySocket,
      extension: async () => {
        // `GET /api/v1/spindle` lists the extensions the user may use, each with Lumiverse's id (`routes/spindle.routes.ts:46-59`).
        const body = await session.json("GET", "/api/v1/spindle");
        const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === EXTENSION_IDENTIFIER) : undefined;
        if (!isRecord(found) || typeof found.id !== "string") throw new Error(`RPE's extension (${EXTENSION_IDENTIFIER}) is not installed in Lumiverse for this user`);
        return found.id;
      },
      registration,
      follow: (chatId, take) => at.live.follow(chatId, { take: (_batch, text) => take(text) }),
      clock: deps.clock,
      held: (why) => {
        const was = status.why;
        status.registered = why === null;
        status.why = why;
        if (why !== was) publish();
        if (why !== null && why !== was) log(why);
        // After a refusal the log said, it says the end of it too.
        else if (why === null && was !== null && was !== NOT_HEARD) at.log.info("[lumiverse] RPE's extension in Lumiverse took its registration again.");
      },
      permissions: (missing) => {
        const was = status.missing;
        status.missing = missing;
        if (JSON.stringify(missing) !== JSON.stringify(was)) publish();
        if (missing.length > 0 && JSON.stringify(missing) !== JSON.stringify(was)) at.log.warn("RPE's extension in Lumiverse is missing permissions it needs.", { missing: missing.map((m) => m.permission) });
      },
      // The extension's build, which the builds route shows; an app file run from its own source is read again when the extension is another build (an installed copy takes a build only on the extension's word, `ARRIVED_PATH`).
      extensionBuild: (build) => at.builds.registered(build),
      settings: () => settings().relay,
    });
    const stopGeneration = async (generation: string): Promise<boolean> => {
      if (generation === "") throw new Error("RPE did not ask Lumiverse to stop a generation it could not name: Lumiverse would stop every one of your generations instead.");
      const answer = await session.json("POST", "/api/v1/generate/stop", { generation_id: generation });
      return isRecord(answer) && answer.stopped === true;
    };
    return { session, reads, chat, events, relaySocket, relay, database, stopGeneration };
  }

  /** The adapter's handlers, made once the area is mounted in an app set up for a Lumiverse user. */
  interface Handlers {
    user: string;
    provider(request: Request, call: EndpointCall): Promise<Response>;
    question(request: Request, json: () => Promise<unknown>): Promise<Response>;
  }
  let handlers: Handlers | null = null;
  const notSetUp = (): Response => json(503, { error: NOT_SET_UP });

  /** One of the extension's routes, for RPE's own user alone (the app has checked the key). */
  const forOwner =
    (handler: (body: unknown, user: string, parts: Lumiverse) => Promise<Response>) =>
    async (request: Request, call: { json: () => Promise<unknown> }): Promise<Response> => {
      if (handlers === null || parts === null) return notSetUp();
      if (request.headers.get(USER_HEADER) !== handlers.user) return json(403, { error: "This RPE belongs to another Lumiverse user." });
      let body: unknown;
      try {
        body = await call.json();
      } catch {
        return json(400, { error: "The request is not JSON." });
      }
      return handler(body, handlers.user, parts);
    };

  const area: Area = {
    name: "lumiverse",
    liveKinds: [EXTENSION_KIND],
    async mount(at) {
      app = at;
      // Every connection that is RPE's is let in by its own key (RPE's own, or one taken at the swap) and answered under its own model name (R-109).
      const providerKey = (request: Request): boolean => at.auth.holds("provider", bearerOf(request));
      const { url, user } = at.config.lumiverse;
      if (url !== null && user !== null) {
        const p = build(at, user, url, storedSignIn(await at.secrets.read("lumiverse")));
        parts = p;
        handlers = {
          user,
          provider: providerEndpoint({
            user,
            allowed: providerKey,
            window: lanes.window,
            reads: promptReads(p.reads),
            room: lanes.room,
            blocks: blocksHint({ reads: p.reads, session: p.session, log, dryRunMs: () => settings().dryRunMs }),
            models: lanes.models,
            passConnection: lanes.passConnection,
            passWords: lanes.passWords,
            holdMs: () => settings().wholeHoldMs,
            heard,
            untaggedWhileAwaited: () => settings().untaggedWhileAwaited,
            modelNames: rpeModels,
            turns: lanes.turns,
            clock: deps.clock,
            commentMs: () => settings().commentMs,
            log,
          }),
          question: questionRoute({ secrecy: lanes.secrecy, window: lanes.window, start: lanes.start, waitMs: () => settings().extension.questionMs, clock: deps.clock, kept: answers, allowed: (request) => request.headers.get(USER_HEADER) === user, log }),
        };
      } else status.why = NOT_SET_UP;
      at.routes.add("lumiverse", [
        rawRoute({
          method: "POST",
          path: "/v1/chat/completions",
          access: "provider",
          group: "provider",
          does: "The provider endpoint: Lumiverse's chat completions, answered as the Lumiverse provider API's own (OpenAI's chat completions, streamed or whole); a reply tagged for a turn of RPE is played through the turn lane, any other is passed on.",
          answers: "an OpenAI chat completion, streamed or whole, as OpenAI answers",
          raw: (request, call) => (handlers === null ? notSetUp() : handlers.provider(request, call)),
        }),
        rawRoute({ method: "GET", path: "/v1/models", access: "provider", group: "provider", does: "The models the provider endpoint offers, as the connection in Lumiverse lists them.", answers: "an OpenAI model list", raw: modelsEndpoint({ allowed: providerKey, modelNames: rpeModels }) }),
        route({ method: "GET", path: EXTENSION_STATUS_PATH, access: "page", group: "service", does: "How RPE's extension in Lumiverse last said it stands with RPE.", reply: extensionStatusReply, handle: extension }),
        rawRoute({
          method: "POST",
          path: QUESTION_PATH,
          access: "extension",
          group: "service",
          does: "The extension's question for a prompt it is about to send: which of its lore entries and messages RPE keeps, by its window and its secrecy rules.",
          answers: "JSON, the extension's own message (`src/adapter/lumiverse/wire.ts`)",
          maxBody: settings().questionBytes,
          raw: (request, call) => (handlers === null ? notSetUp() : handlers.question(request, call.json)),
        }),
        rawRoute({
          method: "POST",
          path: CONFIRM_PATH,
          access: "extension",
          group: "service",
          does: "The extension asks whether the registration it holds is the one this RPE made.",
          answers: "JSON: `{ rpe: \"confirmed\", user, relay }`, or 409 for a registration this RPE did not make",
          // The server has held the ask to the key in force and this to RPE's own user: what is left is that it names RPE's own relay socket and connections.
          raw: forOwner(async (body, owner) => {
            const asked = readConfirmAsk(body);
            const own = registration();
            const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
            if (asked === null || own === null || asked.relay !== own.relay || !same(asked.connections, own.connections)) return json(409, { error: "That is not the registration this RPE made." });
            const confirmed: Confirmed = { rpe: "confirmed", user: owner, relay: own.relay };
            return json(200, confirmed);
          }),
        }),
        rawRoute({
          method: "POST",
          path: STOPPED_PATH,
          access: "extension",
          group: "service",
          does: "The extension's record of a generation it stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read.",
          answers: "JSON: `{ kept: true }`, or 400 for a record the extension does not send",
          raw: forOwner(async (body) => {
            const stopped = readCheckStopped(body);
            if (stopped === null) return json(400, { error: "That is not a stopped generation's record." });
            status.stopped = { last: stopped, count: (status.stopped?.count ?? 0) + 1 };
            publish();
            log(`RPE's extension stopped generation ${stopped.generation ?? "(not announced)"} of chat ${stopped.chat} on connection ${stopped.connection}: it could not tell whose chat it was. The registration's read: ${stopped.registration}. The connection's record: ${stopped.mark}.`);
            return json(200, { kept: true });
          }),
        }),
        rawRoute({
          method: "POST",
          path: START_PATH,
          access: "extension",
          group: "service",
          does: "A page's start-up facts, asked for by the extension: a page token for the user this RPE belongs to, its end, RPE's addresses a browser may try, and its build.",
          answers: "JSON: the page's start-up facts (`StartFacts`, `src/adapter/lumiverse/pipe-wire.ts`)",
          raw: forOwner(async (_body, owner) => {
            try {
              const minted = await at.auth.mintPageToken(owner, "extension");
              const { requestMs, renewMs } = settings().extension;
              // The page's settings group whole, as the levels every chat shares set it now.
              const shared = deps.settings?.shared();
              const pageSettings = Object.fromEntries(PAGE_SETTINGS.map((s) => [s.key, Number(shared === undefined ? s.default : shared.value(s))]));
              const facts: StartFacts = { token: minted.token, expiresInMs: Math.max(0, minted.expires - at.now()), addresses: addresses(), build: at.version, road: { requestMs, renewMs }, pageSettings };
              return json(200, facts);
            } catch (error) {
              if (error instanceof AuthRefused) return json(error.status, { error: error.message });
              throw error;
            }
          }),
        }),
        rawRoute({
          method: "POST",
          path: LIVE_PATH,
          access: "extension",
          group: "service",
          does: "A page's follow of a chat's live events, carried by the extension to RPE's relay.",
          answers: "JSON: an empty object, or 400 for a follow RPE does not read",
          raw: forOwner(async (body, _owner, p) => {
            const ask = readLiveAsk(body);
            if (ask === null) return json(400, { error: "That is not a follow RPE reads." });
            p.relay.ask(ask);
            return json(200, {});
          }),
        }),
      ]);
    },
    async started(at) {
      if (parts === null) return;
      // A new key at each start, handed to the extension in the registration: the one before it is retired.
      key = (await at.auth.makeKey("extension")).key;
      offChanges = followChanges(parts.events, {
        changed: (change) => {
          heard.heard(change);
          lanes.changes.changed(change);
        },
        reopened: () => lanes.changes.reopened(),
      });
      offLifecycle = parts.events.onEvent((event, payload) => {
        const said = lifecycleOf(event, payload);
        if (said !== null) log(said);
      });
      parts.relay.start();
      parts.session.keep();
      parts.events.start();
      parts.relaySocket.start();
    },
    stopping() {
      offChanges?.();
      offChanges = null;
      offLifecycle?.();
      offLifecycle = null;
      if (parts === null) return;
      parts.relay.stop();
      parts.events.stop();
      parts.relaySocket.stop();
      parts.session.stop();
      parts.database?.close();
    },
  };

  return { area, lumiverse: () => parts, extension, registration, answers, accounts: lumiverseAccounts({ base: () => app?.config.lumiverse.url ?? null, fetch: deps.fetch, clock: deps.clock }) };
}
