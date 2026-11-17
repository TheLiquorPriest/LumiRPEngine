// RPE as the Play page reaches it, served by RPE's own handlers in this process: Build's typed routes and the
// three play routes over one store and write queue (test/build-mode/bed.ts), with the application's
// live hub, which the page follows as it follows RPE's live socket. Every body goes and comes back as
// JSON, as over a road, and a route's refusal reaches the page as the client's error does. Turns are
// played as the turn lane drives the store (test/play/bed.ts): begun, what they record recorded by the
// engine's own `world_apply`, tied to a reply; what the turn lane publishes on the hub, the test does.
// Every chat, world and user here is invented.

import { expect } from "bun:test";
import type { HostTool, JsonObject, ToolCtx } from "rp-harness/contract";
import { LiveHub, RouteError } from "../../../../src/app";
import { chatsRoutes, jobsRoutes, worldsRoutes } from "../../../../src/build";
import { engineTools, shippedTexts, stateScan } from "../../../../src/iface/index";
import { PORTS } from "../../../iface/rig";
import { playRoutes, PlayService } from "../../../../src/play";
import { TAP_DEFAULTS } from "../../../../src/play/settings";
import { MAP_DEFAULTS } from "../../../../src/shared/map-config";
import { HARNESS_MIGRATIONS } from "../../../../src/turn/tables";
import { migrateStore } from "../../../../src/store";
import { Database } from "bun:sqlite";
import type { Store } from "../../../../src/store";
import type { WriteQueue } from "../../../../src/app";
import { type LiveListener, type RpeClient, RpeError } from "../../../../src/ui/client";
import { GUIDANCE, jobHomeOn, makeBed, USER, worldsOn } from "../../../build-mode/bed";
import { asHarnessPasses } from "../../../story/rig";
import { callRoute } from "../../../app/call";

export { USER };

export interface ServedRpe {
  client: Pick<RpeClient, "call" | "follow">;
  store: Store;
  writes: WriteQueue;
  live: LiveHub;
  /** Chats a turn runs in now, as the turn lane would say. */
  running: Set<string>;
  /** Each call the page made: its route key and the body it sent. */
  asked: { key: string; body: unknown }[];
  /** Attaches `world` to `chat` through the world service, as Build's Attach does: the chat plays its newest revision from its next turn. */
  attach(world: string, chat: string): Promise<void>;
  /** A world made in Build from a starter template: its id and name. */
  world(name: string, template?: string): Promise<{ id: string; name: string }>;
  /** A turn of `chat` begun after its newest; its id. */
  begin(chat: string): Promise<string>;
  /** Records `operations` in the turn through the engine's own `world_apply`. */
  apply(chat: string, turn: string, operations: JsonObject[]): Promise<void>;
  /** Ties the turn to a reply, as Lumiverse's end of the generation does. */
  tie(turn: string): Promise<void>;
}

let asked = 0;

export function servedRpe(): ServedRpe {
  const bed = makeBed();
  const live = new LiveHub({ queueEvents: 64, now: () => 0 });
  const running = new Set<string>();
  const service = worldsOn(bed);
  const worlds = [...worldsRoutes(service, 4 * 1024 * 1024), ...chatsRoutes(service), ...jobsRoutes(jobHomeOn(bed, service))];
  // This bed holds no asks for the next message and has no Lumiverse to put a message in.
  const noLumiverse = (): never => {
    throw new Error("This bed has no Lumiverse to put a message in.");
  };
  // The turn lane's own tables, which the panels read beside the store (runs' usage, questions, carried chips), in a database of their own here.
  const lane = new Database(":memory:");
  migrateStore(lane);
  for (const step of HARNESS_MIGRATIONS) lane.run(step.sql);
  const play = playRoutes(new PlayService({ store: bed.store, writes: bed.writes, live, db: lane, guidance: GUIDANCE, turning: (_user, chat) => running.has(chat), settings: async () => ({ dueItems: 50, editOps: 64, taps: TAP_DEFAULTS, map: MAP_DEFAULTS }), requests: undefined as never, lumiverse: noLumiverse, writeChatSetting: async () => {}, log: bed.log }));
  worlds.push(...(play as unknown as typeof worlds));

  const serve = async (key: string, params: Record<string, string>, body: unknown, query: Record<string, string>): Promise<unknown> => {
    const found = worlds.find((r) => `${r.method} ${r.path}` === key);
    if (found === undefined) throw new RpeError(404, `No route ${key}.`);
    return await callRoute(found, { params, query, body, user: USER });
  };

  const rpe: ServedRpe = {
    client: {
      call: (async (key: string, params: Record<string, string>, options?: { body?: unknown; query?: Record<string, string> }) => {
        rpe.asked.push({ key, body: options?.body });
        try {
          return JSON.parse(JSON.stringify(await serve(key, params, options?.body, options?.query ?? {})));
        } catch (error) {
          if (error instanceof RouteError) throw new RpeError(error.status, error.message);
          throw error;
        }
      }) as RpeClient["call"],
      follow(chat: string, listener: LiveListener) {
        const following = live.follow(chat, {
          take: (batch) => {
            // The hub's events, as the socket would carry them to the page.
            listener.events(batch.events as unknown as Parameters<LiveListener["events"]>[0], batch.missed ?? null);
            return true;
          },
        });
        // As the client does once following has begun: read afresh.
        let on = true;
        queueMicrotask(() => {
          if (on) listener.reset();
        });
        return () => {
          on = false;
          following.stop();
        };
      },
    },
    store: bed.store,
    writes: bed.writes,
    live,
    running,
    asked: [],
    async attach(world, chat) {
      await service.chats.attach(USER, world, chat);
    },
    async world(name, template = "fantasy_town") {
      const made = (await service.create(USER, name, template)).world;
      return { id: made.id, name: made.name };
    },
    async begin(chat) {
      const s = bed.store.user(USER);
      return (await bed.writes.run(() => s.beginTurn({ chat, kind: "normal" }), "a turn")).id;
    },
    async apply(chat, turn, operations) {
      const s = bed.store.user(USER);
      const tools = new Map((await engineTools({ store: s, env: bed.store.env, writes: bed.writes, files: shippedTexts(), search: stateScan, ...PORTS })).map((t) => [t.name, t]));
      const tool = tools.get("world_apply") as HostTool;
      const call: ToolCtx = { scope: { user: USER, chat, session: "session-1", turn }, agent: { id: "author-1", definition: "author" }, run: turn, callId: `call-${++asked}`, signal: new AbortController().signal, onUpdate: () => undefined };
      const out = await tool.run(asHarnessPasses(tool, { operations }), call);
      expect(out.error).toBeUndefined();
    },
    async tie(turn) {
      const s = bed.store.user(USER);
      const message = `msg-reply-${++asked}`;
      await bed.writes.run(() => s.tieTurn(turn, { message, hash: `hash-${message}` }), "tying the turn");
    },
  };
  return rpe;
}
