// The direct road against RPE's own server, in this process on a free loopback port: the client's
// calls and its live socket speak what the app's route table, auth and live hub answer. A stand-in for
// the turn lane's list of turns is mounted as an area, so that the server can be tested without a turn
// lane. What the pages expect of each route they call is checked against the route itself, below.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionStatus as SentExtensionStatus } from "../../src/adapter/lumiverse/pipe-wire";
import { type AnyShape, type App, dataPaths, LIVE_TOKEN_ENDED as SENT_TOKEN_ENDED, lineLog, type LivePublish, openApp, problemsOf, route, type RouteBody, type RouteReply, SESSION_PATH as SENT_SESSION_PATH, shape } from "../../src/app";
import { configOf } from "../../src/app/config";
import { connectionRoutes } from "../../src/app/connections";
import type { SettingDef } from "../../src/app/setting-list";
import { type LevelFile, settingsRoutes } from "../../src/app/settings-routes";
import { buildRoutes } from "../../src/build/routes";
import { castRoutes } from "../../src/cast";
import { migrateRoutes } from "../../src/migrate/routes";
import { playRoutes } from "../../src/play/routes";
import { storyRoutes } from "../../src/story";
import { type BootstrapChat, type BootstrapStart, bootstrapRoutes } from "../../src/turn/bootstrap";
import { turnRoutes } from "../../src/turn/routes";
import { type TreeFileDiff as SentFileDiff, type TreeFileEntry as SentFileEntry, type TreeFileText as SentFileText, treeRoutes } from "../../src/tree";
import type { SettingsReply } from "../../src/shared/api";
import { type LiveEvent, LIVE_TOKEN_ENDED, type Routes, SESSION_PATH, type TurnList } from "../../src/ui/api";
import { createClient, KEY_LET_GO, type RpeClient, RpeError, walk, webConnector } from "../../src/ui/client";
import { applyLive, EMPTY_LIVE } from "../../src/ui/live-model";
import { readSession } from "../../src/ui/pages/builds";
import { browserDeps, probeDirect } from "../../src/ui/roads";
import { testModelLayer } from "../app/helpers";
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
  Same<Routes["GET /api/v1/jobs"]["reply"], TurnReply<"/api/v1/jobs">>,
  Same<Routes["GET /api/v1/chats/:chat/jobs"]["reply"], TurnReply<"/api/v1/chats/:chat/jobs">>,
  Same<Routes["POST /api/v1/jobs/:job/cancel"]["reply"], TurnReply<"/api/v1/jobs/:job/cancel">>,
] = [true, true, true, true, true, true, true, true, true, true];
/** The routes of the turn lane's the pages call. */
const TURN_KEYS = [
  "GET /api/v1/chats",
  "GET /api/v1/chats/:chat/turns",
  "GET /api/v1/chats/:chat/turns/:turn",
  "POST /api/v1/chats/:chat/turns/:turn/stop",
  "GET /api/v1/chats/:chat/turns/:turn/files",
  "GET /api/v1/chats/:chat/turns/:turn/files/*",
  "GET /api/v1/chats/:chat/world",
  "GET /api/v1/jobs",
  "GET /api/v1/chats/:chat/jobs",
  "POST /api/v1/jobs/:job/cancel",
] as const satisfies readonly (keyof Routes)[];

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

/** The migration's route, and what the page reads of its reply: all of it but the rest of the report (shown as its printed text) beside what became of each world in Build, what today's build put in Lumiverse, and what was carried of each chat. */
type SentMigration = RouteReply<ReturnType<typeof migrateRoutes>[0]>;
const migration: [
  Same<Routes["GET /api/v1/migration"]["reply"], Omit<SentMigration, "report" | "lumiverse" | "chats"> & { report: Pick<NonNullable<SentMigration["report"]>, "worldsInBuild"> | null; chats: Omit<SentMigration["chats"][number], "carried">[] }>,
] = [true];

/** The Cast and Story pages' routes, by their place in their tables; the strike routes read their bodies in the handler, so only the replies compare. */
type CastTable = ReturnType<typeof castRoutes>;
type StoryTable = ReturnType<typeof storyRoutes>;
const CAST_KEYS = ["GET /api/v1/chats/:chat/cast", "GET /api/v1/chats/:chat/cast/:character", "POST /api/v1/chats/:chat/cast/:character/strike"] as const satisfies readonly (keyof Routes)[];
const STORY_KEYS = ["GET /api/v1/chats/:chat/story", "POST /api/v1/chats/:chat/story/strike"] as const satisfies readonly (keyof Routes)[];
const records: [
  Same<Routes["GET /api/v1/chats/:chat/cast"]["reply"], RouteReply<CastTable[0]>>,
  Same<Routes["GET /api/v1/chats/:chat/cast/:character"]["reply"], RouteReply<CastTable[1]>>,
  Same<Routes["POST /api/v1/chats/:chat/cast/:character/strike"]["reply"], RouteReply<CastTable[2]>>,
  Same<Routes["GET /api/v1/chats/:chat/story"]["reply"], RouteReply<StoryTable[0]>>,
  Same<Routes["POST /api/v1/chats/:chat/story/strike"]["reply"], RouteReply<StoryTable[1]>>,
  Same<Routes["POST /api/v1/chats/:chat/settle"]["reply"], TurnReply<"/api/v1/chats/:chat/settle">>,
] = [true, true, true, true, true, true];

/** The bootstrap's routes: its table is not a tuple and its route's method is not kept as a literal, so they are found by path; two share one, and each of those is held to the jobs' own type as well. */
type BootstrapReply<P extends string> = RouteReply<Extract<ReturnType<typeof bootstrapRoutes>[number], { path: P }>>;
const BOOTSTRAP_KEYS = ["POST /api/v1/chats/:chat/bootstrap", "GET /api/v1/chats/:chat/bootstrap", "POST /api/v1/bootstrap"] as const satisfies readonly (keyof Routes)[];
const bootstrap: [
  Same<Routes["POST /api/v1/chats/:chat/bootstrap"]["reply"] | Routes["GET /api/v1/chats/:chat/bootstrap"]["reply"], BootstrapReply<"/api/v1/chats/:chat/bootstrap">>,
  Same<Routes["POST /api/v1/chats/:chat/bootstrap"]["reply"], Extract<BootstrapStart, { started: unknown }>["started"]>,
  Same<Routes["GET /api/v1/chats/:chat/bootstrap"]["reply"], BootstrapChat>,
  Same<Routes["POST /api/v1/bootstrap"]["reply"], BootstrapReply<"/api/v1/bootstrap">>,
] = [true, true, true, true];

/** Build's route and the Play page's three, by their place in their tables: the kept pages send today's messages whole and take today's answers, so the pages' types are held to what the routes take and give. */
type BuildTable = ReturnType<typeof buildRoutes>;
type PlayTable = ReturnType<typeof playRoutes>;
const BUILD_KEYS = ["POST /api/v1/build"] as const satisfies readonly (keyof Routes)[];
const PLAY_KEYS = ["GET /api/v1/chats/:chat/state", "POST /api/v1/chats/:chat/actions", "POST /api/v1/chats/:chat/actions/undo"] as const satisfies readonly (keyof Routes)[];
const kept: [
  Same<Routes["POST /api/v1/build"]["reply"], RouteReply<BuildTable[0]>>,
  Same<Routes["POST /api/v1/build"]["body"], RouteBody<BuildTable[0]>>,
  Same<Routes["GET /api/v1/chats/:chat/state"]["reply"], RouteReply<PlayTable[0]>>,
  Same<Routes["POST /api/v1/chats/:chat/actions"]["reply"], RouteReply<PlayTable[1]>>,
  Same<Routes["POST /api/v1/chats/:chat/actions"]["body"], RouteBody<PlayTable[1]>>,
  Same<Routes["POST /api/v1/chats/:chat/actions/undo"]["reply"], RouteReply<PlayTable[2]>>,
  Same<Routes["POST /api/v1/chats/:chat/actions/undo"]["body"], RouteBody<PlayTable[2]>>,
] = [true, true, true, true, true, true, true];

const turnsRoute = route({
  method: "GET",
  path: "/api/v1/chats/:chat/turns",
  access: "page",
  handle: ({ params, query }): TurnList & { asked: { chat: string; limit: string | null } } => ({ ...turnListAt(), asked: { chat: params.chat, limit: query.get("limit") } }),
});

const HARBOR = ["the quay", "the lighthouse", "the chandlery", "the ropewalk", "the fish market", "the customs house", "the tide pool"];
const PLACES = "GET /api/v1/probe/places";
let pagesRead = 0;

/** A route of the fixture's own that pages: the harbor's places, 3 a page unless the caller asks, and at most 4. */
const places = route({
  method: "GET",
  path: "/api/v1/probe/places",
  access: "page",
  group: "places",
  does: "The harbor's places, a page at a time.",
  paged: { sizes: () => ({ default: 3, most: 4 }) },
  reply: shape.page(shape.text()),
  handle: ({ query }) => {
    pagesRead++;
    const from = query.cursor === undefined ? 0 : Number(query.cursor);
    const to = from + query.limit;
    return { items: HARBOR.slice(from, to), next: to < HARBOR.length ? String(to) : null };
  },
});

/** A limit of the settings the Settings page shows, with a most. */
const CALLS: SettingDef = { key: "limits.turn.calls", default: 40, takes: { type: "whole", least: 1, most: 500 }, perConnection: false };

let root = "";
let app: App;
let base = "";
let token = "";
const clients: RpeClient[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rpe-ui-"));
  const global: LevelFile = { level: "global", file: "@global/RPE-global.yml", disk: join(root, "RPE-global.yml") };
  app = await openApp({
    paths: dataPaths(join(root, "data")),
    config: configOf({ port: 0, lumiverse: { url: "http://127.0.0.1:7860", user: USER } }, {}, "the test's config"),
    version: "1.0.0",
    areas: [
      { name: "turns", mount: (at) => at.routes.add("turns", [turnsRoute]) },
      { name: "settings", mount: (at) => at.routes.add("settings", settingsRoutes({ settings: [CALLS], levels: async () => [global], connections: async () => [] })) },
      { name: "connections", mount: (at) => at.routes.add("connections", connectionRoutes(testModelLayer(at.models), async () => null)) },
      { name: "probe", mount: (at) => at.routes.add("probe", [places]) },
    ],
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

  test("each route of the tree's the type checks above compare is in its table, with the method and path the pages call it by", () => {
    // The handlers reach the tree, its database and the harness only when a request comes.
    const table = treeRoutes({ files: "", chats: undefined as never, db: undefined as never, suggestions: undefined as never, turning: () => false, stack: async () => [] }).map((r) => `${r.method} ${r.path}`);
    for (const key of TREE_KEYS) expect(table).toContain(key);
    expect(tree.every((same) => same)).toBe(true);
  });

  test("the migration's route is in its table, with the method and path the page calls it by", () => {
    const table = migrateRoutes({ db: undefined as never, identifier: "lumi_rp_engine" }).map((r) => `${r.method} ${r.path}`);
    expect(table).toEqual(["GET /api/v1/migration"]);
    expect(migration.every((same) => same)).toBe(true);
  });

  test("the Cast, Story, Settle now and bootstrap routes sit at their places in their tables, with the methods and paths the pages call them by", () => {
    // The handlers reach the store, the turn lane and the jobs only when a request comes.
    expect(castRoutes(undefined as never).map((r) => `${r.method} ${r.path}`)).toEqual([...CAST_KEYS]);
    expect(storyRoutes(undefined as never).map((r) => `${r.method} ${r.path}`)).toEqual([...STORY_KEYS]);
    const turns = turnRoutes({ turns: undefined as never, chatName: async () => null }).map((r) => `${r.method} ${r.path}`);
    expect(turns.filter((at) => at.endsWith(" /api/v1/chats/:chat/settle"))).toEqual(["POST /api/v1/chats/:chat/settle"]);
    expect(bootstrapRoutes(undefined as never).map((r) => `${r.method} ${r.path}`)).toEqual([...BOOTSTRAP_KEYS]);
    expect(records.every((same) => same) && bootstrap.every((same) => same)).toBe(true);
  });

  test("Build's route and the Play page's three sit at their places in their tables, with the methods and paths the kept pages call them by", () => {
    // The handlers reach Build's service and the play service only when a request comes.
    expect(buildRoutes(undefined as never).map((r) => `${r.method} ${r.path}`)).toEqual([...BUILD_KEYS]);
    expect(playRoutes(undefined as never).map((r) => `${r.method} ${r.path}`)).toEqual([...PLAY_KEYS]);
    expect(kept.every((same) => same)).toBe(true);
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

  test("a key RPE does not take signs the web shell out, in RPE's words and with why, and this browser lets it go", async () => {
    let held: string | null = "rpw_not-a-key";
    const client = createClient(webConnector(base, { get: () => held, set: (next) => (held = next) }, browserDeps()));
    clients.push(client);
    const error = await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpeError);
    expect((error as RpeError).status).toBe(401);
    expect(client.state.get()).toEqual({ phase: "signed-out", error: `This needs a page token or the web UI's token. ${KEY_LET_GO}` });
    expect(held).toBeNull();
  });

  test("the page's session says whose its credential is and when it ends, and the pages' copies of the live socket's close code and the session's path are the app's", async () => {
    const client = webClient(token);
    const session = await client.call("GET /api/v1/status/session", {});
    expect(session).toEqual({ user: USER, ends: expect.any(Number) });
    // Settings' line reads the end the route gives.
    const heard = Promise.withResolvers<number | null>();
    readSession(client, heard.resolve);
    expect(await heard.promise).toBe(session.ends);
    expect([LIVE_TOKEN_ENDED, SESSION_PATH]).toEqual([SENT_TOKEN_ENDED, SENT_SESSION_PATH]);
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
    app.live.publish("chat-other", { kind: "delta", data: { run: "turn-other", agent: "author-1", call: 1, text: "not this chat's", at: 0 } });
    // The recorded events are RPH's records and replies as the turn lane published them, each of a kind the live socket carries.
    for (const event of RECORDED as unknown as LivePublish[]) app.live.publish(CHAT, { kind: event.kind, data: event.data });
    await all.promise;
    off();
    expect(got.map((e) => e.seq)).toEqual(RECORDED.map((_, i) => i + 1));
    expect(got.map((e) => e.data)).toEqual(RECORDED.map((e) => e.data));
    const run = got.reduce(applyLive, EMPTY_LIVE).runs[0];
    expect(run?.seq).toBe(RECORDS.length);
  });

  test("each of these routes answers, through the client on a running app, a reply its declaration takes", async () => {
    const client = webClient(token);
    const declared = new Map(app.routes.list().map((r) => [`${r.method} ${r.path}`, r.declared]));
    const created = await client.call("POST /api/v1/connections", {}, { body: { connection: { name: "Harbor watch", provider: "deepseek", auth: "none", model: "deepseek-chat" } } });
    const id = { id: created.id };
    const answers: [string, unknown][] = [
      ["GET /api/v1/status", await client.call("GET /api/v1/status", {})],
      ["GET /api/v1/status/builds", await client.call("GET /api/v1/status/builds", {})],
      ["GET /api/v1/status/session", await client.call("GET /api/v1/status/session", {})],
      ["POST /api/v1/update", await client.call("POST /api/v1/update", {})],
      ["PUT /api/v1/settings", await client.call("PUT /api/v1/settings", {}, { body: { level: "global", key: "limits.turn.calls", value: 75 } })],
      ["GET /api/v1/settings", await client.call("GET /api/v1/settings", {}, { query: { chat: CHAT } })],
      ["POST /api/v1/connections", created],
      ["GET /api/v1/connections", await client.call("GET /api/v1/connections", {})],
      ["PUT /api/v1/connections/:id", await client.call("PUT /api/v1/connections/:id", id, { body: { connection: { name: "Harbor watch", provider: "deepseek", auth: "none", effort: "low" } } })],
      ["POST /api/v1/connections/:id/test", await client.call("POST /api/v1/connections/:id/test", id)],
      ["PUT /api/v1/connections/:id/default", await client.call("PUT /api/v1/connections/:id/default", id)],
      ["DELETE /api/v1/connections/:id", await client.call("DELETE /api/v1/connections/:id", id)],
    ];
    for (const [key, reply] of answers) {
      const d = declared.get(key);
      const replyShape: AnyShape | null = d !== undefined && d !== null && "reply" in d ? d.reply : null;
      expect({ key, problems: replyShape === null ? [`${key} is not a route in the form`] : problemsOf(replyShape, reply, "reply") }).toEqual({ key, problems: [] });
    }
    // The setting's limits reach the page as the server's own type holds them, its most among them.
    const settings = answers.find(([key]) => key === "GET /api/v1/settings")?.[1] as SettingsReply;
    expect(settings.settings[0]).toMatchObject({ key: "limits.turn.calls", value: 75, from: "global", takes: { type: "whole", least: 1, most: 500 } });
  });

  test("the client walks a paged route to its end", async () => {
    const client = webClient(token);
    pagesRead = 0;
    // No route of RPE's own pages yet, so the fixture's paged route is in this app's table and in no generated type: its key is given as a paged one's would be.
    const items = await walk(client, PLACES as never, {} as never, { query: { limit: 2 } as never });
    expect(items).toEqual(HARBOR);
    expect(pagesRead).toBe(4);
  });
});
