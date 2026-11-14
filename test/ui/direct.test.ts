// The direct road against RPE's own server, in this process on a free loopback port: the client's
// calls and its live socket speak what the app's route table, auth and live hub answer. A stand-in for
// the turn lane's list of turns is mounted as an area, so that the server can be tested without a turn
// lane. What the pages expect of each route they call is checked against the route itself, below.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionStatus as SentExtensionStatus } from "../../src/adapter/lumiverse/pipe-wire";
import { type App, dataPaths, lineLog, openApp, route, type RouteBody, type RouteReply } from "../../src/app";
import { configOf } from "../../src/app/config";
import { connectionRoutes } from "../../src/app/connections";
import { settingsRoutes } from "../../src/app/settings-routes";
import { migrateRoutes } from "../../src/migrate/routes";
import { turnRoutes } from "../../src/turn/routes";
import { type TreeFileDiff as SentFileDiff, type TreeFileEntry as SentFileEntry, type TreeFileText as SentFileText, treeRoutes } from "../../src/tree";
import type { LiveEvent, Routes, TurnList } from "../../src/ui/api";
import { createClient, type RpeClient, RpeError, webConnector } from "../../src/ui/client";
import { applyLive, EMPTY_LIVE } from "../../src/ui/live-model";
import { browserDeps, probeDirect } from "../../src/ui/roads";
import { CHAT, RECORDED, RECORDS, turnListAt, USER } from "./recorded";

/** True when each of A and B is assignable to the other: a field one has and the other lacks parts them. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The turn lane's route at a path pattern (one method per path there, which the test below holds), and the reply its handler gives. */
type TurnReply<P extends string> = RouteReply<Extract<ReturnType<typeof turnRoutes>[number], { path: P }>>;

// What the pages' route map (`src/ui/api.ts`) expects each route to answer, against what the route's
// own handler gives (plan §4.4). Each line stops compiling when the two part, either way. The test
// below holds each route named here to the method the pages call it by. A raw route (a file of a turn's
// folder) makes its own response, so no type of its reply exists to compare.
const replies: [
  Same<Routes["GET /api/v1/chats"]["reply"], TurnReply<"/api/v1/chats">>,
  Same<Routes["GET /api/v1/chats/:chat/turns"]["reply"], TurnReply<"/api/v1/chats/:chat/turns">>,
  Same<Routes["GET /api/v1/chats/:chat/turns/:turn"]["reply"], TurnReply<"/api/v1/chats/:chat/turns/:turn">>,
  Same<Routes["POST /api/v1/chats/:chat/turns/:turn/stop"]["reply"], TurnReply<"/api/v1/chats/:chat/turns/:turn/stop">>,
  Same<Routes["GET /api/v1/chats/:chat/turns/:turn/files"]["reply"], TurnReply<"/api/v1/chats/:chat/turns/:turn/files">>,
  Same<Routes["GET /api/v1/chats/:chat/world"]["reply"], TurnReply<"/api/v1/chats/:chat/world">>,
  Same<Routes["GET /api/v1/status/extension"]["reply"], SentExtensionStatus>,
] = [true, true, true, true, true, true, true];
/** The routes of the turn lane's the pages call. */
const TURN_KEYS = [
  "GET /api/v1/chats",
  "GET /api/v1/chats/:chat/turns",
  "GET /api/v1/chats/:chat/turns/:turn",
  "POST /api/v1/chats/:chat/turns/:turn/stop",
  "GET /api/v1/chats/:chat/turns/:turn/files",
  "GET /api/v1/chats/:chat/turns/:turn/files/*",
  "GET /api/v1/chats/:chat/world",
] as const satisfies readonly (keyof Routes)[];

/** The connection routes, by their place in their table: two share a path there, so the test below holds each place to its method and path. */
type ConnectionTable = ReturnType<typeof connectionRoutes>;
const CONNECTION_KEYS = ["GET /api/v1/connections", "POST /api/v1/connections", "PUT /api/v1/connections/:id", "DELETE /api/v1/connections/:id", "PUT /api/v1/connections/:id/default", "POST /api/v1/connections/:id/test"] as const satisfies readonly (keyof Routes)[];
const connections: [
  Same<Routes["GET /api/v1/connections"]["reply"], RouteReply<ConnectionTable[0]>>,
  Same<Routes["POST /api/v1/connections"]["reply"], RouteReply<ConnectionTable[1]>>,
  Same<Routes["POST /api/v1/connections"]["body"], RouteBody<ConnectionTable[1]>>,
  Same<Routes["PUT /api/v1/connections/:id"]["reply"], RouteReply<ConnectionTable[2]>>,
  Same<Routes["PUT /api/v1/connections/:id"]["body"], RouteBody<ConnectionTable[2]>>,
  Same<Routes["DELETE /api/v1/connections/:id"]["reply"], RouteReply<ConnectionTable[3]>>,
  Same<Routes["PUT /api/v1/connections/:id/default"]["reply"], RouteReply<ConnectionTable[4]>>,
  Same<Routes["POST /api/v1/connections/:id/test"]["reply"], RouteReply<ConnectionTable[5]>>,
] = [true, true, true, true, true, true, true, true];

/** The tree's route at a path pattern, and the reply its handler gives. A raw route (a file, its difference, a write, a switch) makes its own response; its page type is held to the types the route builds it from. */
type TreeReply<P extends string> = RouteReply<Extract<ReturnType<typeof treeRoutes>[number], { path: P }>>;
const TREE_KEYS = [
  "GET /api/v1/files",
  "GET /api/v1/files/*",
  "PUT /api/v1/files/*",
  "DELETE /api/v1/files/*",
  "PUT /api/v1/files-off/*",
  "GET /api/v1/files-diff/*",
  "GET /api/v1/suggestions",
  "POST /api/v1/suggestions/:id/accept",
  "POST /api/v1/suggestions/:id/dismiss",
  "GET /api/v1/storage",
  "GET /api/v1/storage/notes",
  "POST /api/v1/files-prune",
  "GET /api/v1/files-stack",
] as const satisfies readonly (keyof Routes)[];
/** The prune's route, whose body the page sends as the route takes it. */
type PruneRoute = Extract<ReturnType<typeof treeRoutes>[number], { path: "/api/v1/files-prune" }>;
const tree: [
  Same<Routes["GET /api/v1/files"]["reply"], TreeReply<"/api/v1/files">>,
  Same<Routes["GET /api/v1/files/*"]["reply"], SentFileText>,
  Same<Routes["PUT /api/v1/files/*"]["reply"], { file: SentFileEntry | null }>,
  Same<Routes["PUT /api/v1/files-off/*"]["reply"], { file: SentFileEntry | null }>,
  Same<Routes["GET /api/v1/files-diff/*"]["reply"], SentFileDiff>,
  Same<Routes["GET /api/v1/suggestions"]["reply"], TreeReply<"/api/v1/suggestions">>,
  Same<Routes["POST /api/v1/suggestions/:id/accept"]["reply"], TreeReply<"/api/v1/suggestions/:id/accept">>,
  Same<Routes["POST /api/v1/suggestions/:id/dismiss"]["reply"], TreeReply<"/api/v1/suggestions/:id/dismiss">>,
  Same<Routes["GET /api/v1/storage"]["reply"], TreeReply<"/api/v1/storage">>,
  Same<Routes["GET /api/v1/storage/notes"]["reply"], TreeReply<"/api/v1/storage/notes">>,
  Same<Routes["POST /api/v1/files-prune"]["reply"], RouteReply<PruneRoute>>,
  Same<Routes["POST /api/v1/files-prune"]["body"], RouteBody<PruneRoute>>,
  Same<Routes["GET /api/v1/files-stack"]["reply"], TreeReply<"/api/v1/files-stack">>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true];

/** The settings routes, by their place in their table: both are at one path. */
type SettingsTable = ReturnType<typeof settingsRoutes>;
const SETTINGS_KEYS = ["GET /api/v1/settings", "PUT /api/v1/settings"] as const satisfies readonly (keyof Routes)[];
const settings: [
  Same<Routes["GET /api/v1/settings"]["reply"], RouteReply<SettingsTable[0]>>,
  Same<Routes["PUT /api/v1/settings"]["reply"], RouteReply<SettingsTable[1]>>,
  Same<Routes["PUT /api/v1/settings"]["body"], RouteBody<SettingsTable[1]>>,
] = [true, true, true];

/** The migration's route, and what the page reads of its reply: all of it but the report whole (shown as its printed text), what today's build put in Lumiverse, and what was carried of each chat. */
type SentMigration = RouteReply<ReturnType<typeof migrateRoutes>[0]>;
const migration: [Same<Routes["GET /api/v1/migration"]["reply"], Omit<SentMigration, "report" | "lumiverse" | "chats"> & { chats: Omit<SentMigration["chats"][number], "carried">[] }>] = [true];

const turnsRoute = route({
  method: "GET",
  path: "/api/v1/chats/:chat/turns",
  access: "page",
  handle: ({ params, query }): TurnList & { asked: { chat: string; limit: string | null } } => ({ ...turnListAt(), asked: { chat: params.chat, limit: query.get("limit") } }),
});

let root = "";
let app: App;
let base = "";
let token = "";
const clients: RpeClient[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rpe-ui-"));
  app = await openApp({
    paths: dataPaths(join(root, "data")),
    config: configOf({ port: 0, lumiverse: { url: "http://127.0.0.1:7860", user: USER } }, {}, "the test's config"),
    version: "1.0.0",
    areas: [{ name: "turns", mount: (at) => at.routes.add("turns", [turnsRoute]) }],
    log: lineLog(() => undefined),
  });
  base = (await app.start()).url;
  token = (await app.auth.mintPageToken(USER, "extension")).token;
});

afterAll(async () => {
  for (const client of clients) client.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
});

function webClient(held: string | null): RpeClient {
  let current = held;
  const client = createClient(webConnector(base, { get: () => current, set: (next) => (current = next) }, browserDeps()));
  clients.push(client);
  return client;
}

describe("the pages' route map, against the routes themselves", () => {
  test("each route the type checks above compare is in the turn lane's table under the method the pages call it by, the only route at its path", () => {
    // The handlers reach the turn lane only when a request comes, so the table can be made without one.
    const table = turnRoutes({ turns: undefined as never, chatName: async () => null }).map((r) => `${r.method} ${r.path}`);
    for (const key of TURN_KEYS) expect(table.filter((at) => at.split(" ")[1] === key.split(" ")[1])).toEqual([key]);
    expect(replies.every((same) => same)).toBe(true);
  });

  test("each connection route the type checks above compare sits at its place in its table, with the method and path the pages call it by", () => {
    const layer = { list: async () => ({ connections: [], default: null, providers: [] }), save: async () => undefined as never, remove: async () => undefined, setDefault: async () => undefined, test: async () => undefined as never, limits: async () => undefined as never };
    const table = connectionRoutes(layer, async () => null).map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual([...CONNECTION_KEYS]);
    expect(connections.every((same) => same)).toBe(true);
  });

  test("each route of the tree's the type checks above compare is in its table, with the method and path the pages call it by", () => {
    // The handlers reach the tree, its database and the harness only when a request comes.
    const table = treeRoutes({ files: "", chats: undefined as never, db: undefined as never, suggestions: undefined as never, turning: () => false, stack: async () => [] }).map((r) => `${r.method} ${r.path}`);
    for (const key of TREE_KEYS) expect(table).toContain(key);
    expect(tree.every((same) => same)).toBe(true);
  });

  test("both settings routes sit at their places in their table, with the method and path the pages call them by", () => {
    const table = settingsRoutes({ settings: [], levels: async () => [], connections: async () => [] }).map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual([...SETTINGS_KEYS]);
    expect(settings.every((same) => same)).toBe(true);
  });

  test("the migration's route is in its table, with the method and path the page calls it by", () => {
    const table = migrateRoutes({ db: undefined as never, identifier: "lumi_rp_engine" }).map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(["GET /api/v1/migration"]);
    expect(migration.every((same) => same)).toBe(true);
  });
});

describe("the direct road, against RPE's own server", () => {
  test("RPE answers the page at its address; nothing answers at a closed one, and the page is told why", async () => {
    expect(await probeDirect(base, token, browserDeps(), 3000)).toEqual({ ok: true });
    const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    const port = closed.port;
    await closed.stop(true);
    const probe = await probeDirect(`http://127.0.0.1:${port}`, token, browserDeps(), 3000);
    expect(probe.ok).toBe(false);
    expect(probe.ok ? "" : probe.why).toContain("did not let this page call it");
  });

  test("a call with the page's token gets what the route answers, its params and query as the client gave them", async () => {
    const client = webClient(token);
    const list = await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }, { query: { limit: 5 } });
    expect(list.turns.map((t) => t.id)).toEqual(turnListAt().turns.map((t) => t.id));
    expect((list as TurnList & { asked: unknown }).asked).toEqual({ chat: CHAT, limit: "5" });
    expect(client.state.get()).toEqual({ phase: "direct", address: base });
  });

  test("a token RPE does not take signs the web shell out, in RPE's words", async () => {
    const client = webClient("rpw_not-a-key");
    const error = await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpeError);
    expect((error as RpeError).status).toBe(401);
    expect(client.state.get()).toEqual({ phase: "signed-out", error: "This needs a page token or the web UI's token." });
  });

  test("with no token the web shell asks for one before it calls", async () => {
    const client = webClient(null);
    await client.call("GET /api/v1/chats", {}).catch(() => undefined);
    expect(client.state.get()).toEqual({ phase: "signed-out", error: null });
  });

  test("a chat followed on the live socket: following begins, then the chat's events come in order, and no other chat's", async () => {
    const client = webClient(token);
    const got: LiveEvent[] = [];
    const began = Promise.withResolvers<void>();
    const all = Promise.withResolvers<void>();
    const off = client.follow(CHAT, {
      events(events) {
        got.push(...events);
        if (got.length >= RECORDED.length) all.resolve();
      },
      reset: () => began.resolve(),
      refused: (words) => began.reject(new Error(words)),
    });
    await began.promise;
    app.live.publish("chat-other", { kind: "trace", data: { not: "this chat's" } });
    for (const event of RECORDED) app.live.publish(CHAT, { kind: event.kind, data: event.data });
    await all.promise;
    off();
    expect(got.map((e) => e.seq)).toEqual(RECORDED.map((_, i) => i + 1));
    expect(got.map((e) => e.data)).toEqual(RECORDED.map((e) => e.data));
    const run = got.reduce(applyLive, EMPTY_LIVE).runs[0];
    expect(run?.seq).toBe(RECORDS.length);
  });
});
