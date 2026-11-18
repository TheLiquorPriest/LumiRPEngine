// What the play panels' tests share: a temporary database with RPE's store behind the application's
// write queue, the application's live hub, a chat playing one of the three starter worlds, turns
// played the way the turn lane drives the store (begun, what they record recorded by the engine's own
// tools, tied to a reply), and a page of the owner's calling the play routes through each route's own
// reader and handler. Every chat, message and user here is invented.

import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HostTool, JsonObject, JsonValue, ToolCtx, ToolResult } from "rp-harness/contract";
import { type LiveEvent, LiveHub, WriteQueue } from "../../src/app";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { engineTools, gridMoves, mapView, mapWording, shippedTexts, stateScan } from "../../src/iface/index";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { type PlayDeps, playRoutes, PlayService } from "../../src/play";
import { TAP_DEFAULTS } from "../../src/play/settings";
import { hashJson } from "../../src/shared/hash";
import type { ErrorMessage, ResultBodies, ResultMessage } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import type { WorldDoc } from "../../src/shared/world";
import { migrateStore, openStore, readPart, type Store, storedWorlds, timeDue, type TurnRow } from "../../src/store";
import { Requests } from "../../src/turn/requests";
import { HARNESS_MIGRATIONS } from "../../src/turn/tables";
import { asHarnessPasses } from "../story/rig";
import { callRoute } from "../app/call";

export const USER = "user-quill";
export const OTHER = "user-sedge";
export const CHAT = "chat-larkspur";

/** The repository's shipped guidance, where the play panels' words are. */
export const GUIDANCE = resolve(import.meta.dir, "../../guidance");

let shared: Registry | null = null;
/** The shipped packs' registry, built once per test file. */
export function registry(): Registry {
  shared ??= createRegistry(ALL_PACKS);
  return shared;
}

/** A line of the play panels' words as the shipped file has it, filled with `fields`. */
export function words(name: string, fields: Record<string, unknown> = {}): string {
  const part = readPart(readFileSync(join(GUIDANCE, ".prompts", "play-answers.md"), "utf8"));
  const template = part.lines.get(name);
  if (template === undefined) throw new Error(`no line ${name}`);
  return template.render(part.header, fields);
}

/** The words the play panels' file gives a code an answer names (`keys`), as the shipped file has them. */
export function keyed(code: string): string {
  const said = readPart(readFileSync(join(GUIDANCE, ".prompts", "play-answers.md"), "utf8")).keys[code];
  if (said === undefined) throw new Error(`no key ${code}`);
  return said;
}

export interface Bed {
  store: Store;
  /** The play panels' service the routes stand on, and the turn lane's requests it holds a press in. */
  service: PlayService;
  requests: Requests;
  writes: WriteQueue;
  live: LiveHub;
  /** Chats a turn runs in now, as the turn lane would say. */
  running: Set<string>;
  /** Every event published on a chat the bed listens to (`listen`), in order. */
  heard: LiveEvent[];
  logged: string[];
  listen(chat?: string): void;
  /** The chat plays the starter world `template` from before its first turn; its revision. */
  plays(template: string, chat?: string, user?: string): Promise<{ doc: WorldDoc; revision: string }>;
  /** A turn of the chat, begun after its newest, with what `during` records through the engine's tools, tied to a reply. */
  turn(during?: (apply: (operations: JsonObject[]) => Promise<ToolResult>) => Promise<void>, chat?: string, user?: string): Promise<TurnRow>;
  /** The chat's state view, as the page reads it. */
  state(query?: Record<string, string>, user?: string, chat?: string): Promise<StateView>;
  /** Sends one of today's messages (its `lre`, `reqId` and `chatId` added) to the actions route. */
  send(message: Record<string, unknown>, user?: string, chat?: string): Promise<ResultMessage | ErrorMessage>;
  /** Sends today's Undo chip to the undo route. */
  undo(chip: string, user?: string, chat?: string): Promise<ResultMessage | ErrorMessage>;
}

let replies = 0;
let asked = 0;

/** The bed's Lumiverse where a test gives none: there is no chat to put a message in. */
function noLumiverse(): never {
  throw new Error("The play bed has no Lumiverse to put a message in.");
}

/** `lumiverse`: what puts a message in the chat and starts a reply as him; left out, the bed has no Lumiverse and says so. */
export function makeBed(lumiverse: PlayDeps["lumiverse"] = noLumiverse): Bed {
  const db = new Database(":memory:");
  migrateStore(db);
  // The turn lane's own tables (requests, runs and their usage, questions, carried chips), as the application has them.
  for (const step of HARNESS_MIGRATIONS) db.run(step.sql);
  const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
  // Made last: from here on the database takes writes only through the queue, as in the application.
  const writes = new WriteQueue(db, 10);
  const live = new LiveHub({ queueEvents: 64, now: () => 0 });
  const running = new Set<string>();
  const heard: LiveEvent[] = [];
  const logged: string[] = [];
  const log = (level: string) => (message: string) => void logged.push(`${level} ${message}`);
  // The bed's requests tell nobody when what waits changed.
  const requests = new Requests(db, writes, () => undefined);
  const service = new PlayService({ store, writes, live, db, guidance: GUIDANCE, texts: () => shippedTexts(), turning: (_user, chat) => running.has(chat), settings: async () => ({ dueItems: 50, editOps: 64, taps: TAP_DEFAULTS, map: MAP_DEFAULTS }), requests, lumiverse, writeChatSetting: async () => {}, log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") } });
  const [stateRoute] = playRoutes(service);
  const call = { query: new URLSearchParams(), request: new Request("http://rpe.test/"), signal: new AbortController().signal };

  return {
    store,
    service,
    requests,
    writes,
    live,
    running,
    heard,
    logged,
    listen(chat = CHAT) {
      live.follow(chat, {
        take: (batch) => {
          heard.push(...batch.events);
          return true;
        },
      });
    },
    async plays(template, chat = CHAT, user = USER) {
      const make = STARTER_WORLDS[template];
      if (make === undefined) throw new Error(`no starter world ${template}`);
      const doc = make(template, template);
      const revision = hashJson(doc);
      const s = store.user(user);
      await writes.run(() => {
        s.putWorld(revision, doc);
        s.createChat({ id: chat, world: doc.id, revision });
      });
      return { doc, revision };
    },
    async turn(during, chat = CHAT, user = USER) {
      const s = store.user(user);
      const begun = await writes.run(() => s.beginTurn({ chat, kind: "normal" }), "a turn");
      if (during !== undefined) {
        const tools = new Map((await engineTools({ store: s, env: store.env, writes, files: shippedTexts(), search: stateScan, due: timeDue(store), grid: gridMoves(), map: mapView(await mapWording(shippedTexts())) })).map((t) => [t.name, t]));
        const tool = tools.get("world_apply") as HostTool;
        const ctx: ToolCtx = { scope: { user, chat, session: "session-1", turn: begun.id }, agent: { id: "author-1", definition: "author" }, run: begun.id, callId: `call-${++asked}`, signal: new AbortController().signal, onUpdate: () => undefined };
        await during(async (operations) => {
          const out = await tool.run(asHarnessPasses(tool, { operations }), ctx);
          expect(out.error).toBeUndefined();
          return out;
        });
      }
      const message = `msg-reply-${++replies}`;
      return await writes.run(() => s.tieTurn(begun.id, { message, hash: `hash-${message}` }), "tying the turn");
    },
    async state(query = {}, user = USER, chat = CHAT) {
      return await callRoute(stateRoute, { query, params: { chat }, user });
    },
    async send() {
      throw new Error("The chat's old actions route is gone: a tap goes to the taps route.");
    },
    async undo() {
      throw new Error("The chat's old actions route is gone: an Undo goes to the edits' undo route.");
    },
  };
}

/** The body of an `lre.result` answering `request`, checked to be one. */
export function body<K extends keyof ResultBodies>(answer: ResultMessage | ErrorMessage, request: K): ResultBodies[K] {
  if (answer.type !== "lre.result" || answer.request !== request) throw new Error(`not ${request}'s result: ${JSON.stringify(answer)}`);
  // The request checked above names the body's type.
  const out = answer.body as ResultBodies[K];
  return out;
}

/** The `lre.error` an answer is, checked to be one: its code and its words. */
export function refusal(answer: ResultMessage | ErrorMessage): { code: string; message: string } {
  if (answer.type !== "lre.error") throw new Error(`not an error: ${JSON.stringify(answer)}`);
  return { code: answer.code, message: answer.message };
}

/** A panel's view model as data. */
export function panel(view: StateView, id: string): JsonObject {
  const p: JsonValue | undefined = view.panels[id];
  if (p === null || typeof p !== "object" || Array.isArray(p)) throw new Error(`no panel ${id}`);
  return p;
}
