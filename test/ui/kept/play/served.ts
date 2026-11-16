// RPE as the Play page reaches it, served by RPE's own handlers in this process: Build's route and the
// three play routes over one store and write queue (test/build-mode/bed.ts), with the application's
// live hub, which the page follows as it follows RPE's live socket. Every body goes and comes back as
// JSON, as over a road, and a route's refusal reaches the page as the client's error does. Turns are
// played as the turn lane drives the store (test/play/bed.ts): begun, what they record recorded by the
// engine's own `world_apply`, tied to a reply; what the turn lane publishes on the hub, the test does.
// Every chat, world and user here is invented.

import { expect } from "bun:test";
import type { HostTool, JsonObject, ToolCtx } from "rp-harness/contract";
import { LiveHub, RouteError } from "../../../../src/app";
import { buildRoutes, BuildService } from "../../../../src/build";
import { engineTools, shippedTexts, stateScan } from "../../../../src/iface/index";
import { PORTS } from "../../../iface/rig";
import { playRoutes, PlayService } from "../../../../src/play";
import { TAP_DEFAULTS } from "../../../../src/play/settings";
import type { ResultBodies } from "../../../../src/shared/protocol";
import type { Store } from "../../../../src/store";
import type { WriteQueue } from "../../../../src/app";
import { type LiveListener, type RpeClient, RpeError } from "../../../../src/ui/client";
import { GUIDANCE, makeBed, USER } from "../../../build-mode/bed";
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
  /** One of today's world messages (its `lre` and `reqId` added) to Build's route, as a page of the owner's would send it; its result. */
  build(message: Record<string, unknown>): Promise<ResultBodies["lre.world"]>;
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
  const [post] = buildRoutes(new BuildService({ db: bed.db, writes: bed.writes, store: bed.store, log: bed.log, guidance: GUIDANCE }));
  const [stateRoute, actionsRoute, undoRoute] = playRoutes(new PlayService({ store: bed.store, writes: bed.writes, live, guidance: GUIDANCE, turning: (_user, chat) => running.has(chat), settings: async () => ({ dueItems: 50, editOps: 64, taps: TAP_DEFAULTS }), log: bed.log }));

  const serve = async (key: string, chat: string, body: unknown, query: Record<string, string>): Promise<unknown> => {
    switch (key) {
      case "POST /api/v1/build":
        return await callRoute(post, { body, user: USER });
      case "GET /api/v1/chats/:chat/state":
        return await callRoute(stateRoute, { params: { chat }, query, user: USER });
      case "POST /api/v1/chats/:chat/actions":
        return await callRoute(actionsRoute, { params: { chat }, body, user: USER });
      case "POST /api/v1/chats/:chat/actions/undo":
        return await callRoute(undoRoute, { params: { chat }, body, user: USER });
      default:
        throw new RpeError(404, `No route ${key}.`);
    }
  };

  const rpe: ServedRpe = {
    client: {
      call: (async (key: string, params: { chat?: string }, options?: { body?: unknown; query?: Record<string, string> }) => {
        rpe.asked.push({ key, body: options?.body });
        try {
          return JSON.parse(JSON.stringify(await serve(key, params.chat ?? "", options?.body, options?.query ?? {})));
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
    async build(message) {
      const answer = await callRoute(post, { body: { lre: 1, reqId: `setup-${++asked}`, type: "lre.world", ...message }, user: USER });
      if (answer.result.type !== "lre.result" || answer.result.request !== "lre.world") throw new Error(`Build refused: ${JSON.stringify(answer.result)}`);
      return answer.result.body;
    },
    async world(name, template = "fantasy_town") {
      const made = (await rpe.build({ op: "create", name, template })).world;
      if (made === undefined) throw new Error("Build made no world");
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
