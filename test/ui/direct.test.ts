// The direct road against RPE's own server, in this process on a free loopback port: the client's
// calls and its live socket speak what the app's route table, auth and live hub answer. A stand-in for
// the turn lane's list of turns is mounted as an area, so that the server can be tested without a turn
// lane. What the pages expect of each route they call is checked against the route itself, below.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AnyShape, type App, dataPaths, LIVE_TOKEN_ENDED as SENT_TOKEN_ENDED, lineLog, type LivePublish, openApp, problemsOf, route, SESSION_PATH as SENT_SESSION_PATH, shape } from "../../src/app";
import { configOf } from "../../src/app/config";
import { connectionRoutes } from "../../src/app/connections";
import type { LevelFile } from "../../src/app/config-read";
import type { Setting } from "../../src/app/setting-list";
import { settingsRoutes } from "../../src/app/settings-routes";
import { type LiveEvent, LIVE_TOKEN_ENDED, type SettingsReply } from "../../src/shared/api";
import { SESSION_PATH } from "../../src/ui/roads";
import { createClient, isJoined, KEY_LET_GO, replyOf, type RpeClient, RpeError, walk, webConnector } from "../../src/ui/client";
import type { JsonValue } from "../../src/shared/json";
import { applyLive, EMPTY_LIVE } from "../../src/ui/live-model";
import { readSession } from "../../src/ui/pages/builds";
import { signinDeps, signinRoutes } from "../../src/app/signin-routes";
import { browserDeps, probeDirect } from "../../src/ui/roads";
import { testModelLayer } from "../app/helpers";
import { CHAT, RECORDED, RECORDS, turnListAt, USER } from "./recorded";
import { askOf, keyOf } from "../app/asking";
import { replyProblems } from "../app/call";
import { CHAT as BED_CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, USER as BED_USER } from "../turn/bed";

/** A stand-in for the turn lane's list of turns, at the real route's path: it answers a recorded list, and what it was asked. */
const ROOT = resolve(import.meta.dir, "../..");

const turnsRoute = route({
  method: "GET",
  path: "/api/v1/chats/:chat/turns",
  access: "page",
  group: "turns",
  does: "A stand-in for the turn lane's list of a chat's turns.",
  query: { limit: shape.optional(shape.whole({ least: 1 })) },
  reply: shape.json(),
  handle: ({ params, query }) => ({ ...turnListAt(), asked: { chat: params.chat, limit: query.limit === undefined ? null : String(query.limit) } }) as unknown as JsonValue,
});

/** The harbor's places as the fixture's list starts, in the list's own order: by name, which is each one's place in it. */
const HARBOR = ["the chandlery", "the customs house", "the fish market", "the lighthouse", "the quay", "the ropewalk", "the tide pool"];
const PLACES = "GET /api/v1/probe/places";
let harbor: readonly string[] = HARBOR;
let pagesRead = 0;
/** What becomes of the list before the `page`th page is read: nothing, unless a test changes it between pages. */
let beforePage: (page: number) => void = () => undefined;

/** A route of the fixture's own that pages by place: the harbor's places, 3 a page unless the caller asks, and at most 4. */
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
    beforePage(pagesRead);
    const list = [...harbor].sort();
    const after = query.after;
    const from = after === undefined ? 0 : list.filter((name) => name <= after).length;
    const items = list.slice(from, from + query.limit);
    return { items, next: from + query.limit < list.length ? (items.at(-1) ?? null) : null };
  },
});

/** A limit of the settings the Settings page shows, with a most. */
const CALLS: Setting = { key: "limits.turn.calls", default: 40, takes: { type: "whole", least: 1, most: 500 }, perConnection: false, name: "Calls in a turn", about: "Model calls all the agents of one turn may make between them.", effect: "turn" };

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
      { name: "settings", mount: (at) => at.routes.add("settings", settingsRoutes({ settings: [CALLS], levels: async () => [global], connections: async () => [], facts: () => [] })) },
      { name: "connections", mount: (at) => at.routes.add("connections", connectionRoutes(testModelLayer(at.models), () => at.config.lumiverse.user ?? "", at.log)) },
      { name: "probe", mount: (at) => at.routes.add("probe", [places]) },
      // The proof a page asks for before it sends its token is the sign-in routes', which the app's own area mounts.
      { name: "signin", mount: (at) => at.routes.add("signin", signinRoutes(signinDeps(at, null))) },
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

describe("the routes the pages call, against the route table", () => {
  test("every route a page calls through the client is one the composed app's table declares, with the method and path the page writes it by", async () => {
    // The route keys the pages write in their calls, found in the pages' own files, and those asked of the area that owns them and written in src/ui/wanted until they land.
    const { called, wanted } = await pagesKeys();
    const { generateApi } = await import("../../scripts/api/generate");
    const { types } = await generateApi();
    const held = new Set([...types.matchAll(/^ {2}"([A-Z]+ [^"]+)": \{$/gm)].map((m) => m[1] ?? ""));
    expect([...called].filter((key) => !held.has(key) && !wanted.has(key))).toEqual([]);
    // A route that landed leaves src/ui/wanted, and its page calls it through the client.
    expect([...wanted].filter((key) => held.has(key))).toEqual([]);
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
    const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }, { query: { limit: 5 } }));
    expect(list.turns.map((t) => t.id)).toEqual(turnListAt().turns.map((t) => t.id));
    expect((list as unknown as { asked: unknown }).asked).toEqual({ chat: CHAT, limit: "5" });
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

  test("a handler_failed event reaches the page through the client, typed by the generated file", async () => {
    const client = webClient(token);
    const failed = Promise.withResolvers<Extract<LiveEvent, { kind: "handler_failed" }>>();
    const began = Promise.withResolvers<void>();
    const off = client.follow("chat-ledger", {
      events(events) {
        for (const event of events) if (event.kind === "handler_failed") failed.resolve(event);
      },
      reset: () => began.resolve(),
      refused: (words) => began.reject(new Error(words)),
    });
    await began.promise;
    app.live.publish("chat-ledger", { kind: "handler_failed", data: { op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 } });
    const event = await failed.promise;
    off();
    // Its data is typed by its kind in the generated file: the operation, the handler's error, the turn and the change.
    const typed: { op: string; error: string; turn: string; change: number | null } = event.data;
    expect(typed).toEqual({ op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 });
    expect({ chat: event.chat, seq: event.seq, data: event.data }).toEqual({ chat: "chat-ledger", seq: 1, data: { op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 } });
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

  test("with items added and removed between pages, walk returns every item that stayed exactly once", async () => {
    const client = webClient(token);
    pagesRead = 0;
    const gone = ["the customs house", "the ropewalk"];
    // Before the second page: one place gone behind where the walk stands and one ahead of it, two added behind it and one ahead.
    beforePage = (page) => {
      if (page === 2) harbor = [...harbor.filter((place) => !gone.includes(place)), "the anchorage", "the boathouse", "the sail loft"];
    };
    try {
      const items = await walk(client, PLACES as never, {} as never, { query: { limit: 2 } as never });
      const stayed = HARBOR.filter((place) => !gone.includes(place));
      expect(stayed.map((place) => ({ place, times: items.filter((item) => item === place).length }))).toEqual(stayed.map((place) => ({ place, times: 1 })));
      expect(new Set(items).size).toBe(items.length);
      expect(items).not.toContain("the ropewalk");
    } finally {
      beforePage = () => undefined;
      harbor = HARBOR;
    }
  });
});

/** The route keys the pages write in their calls, found in the pages' own files; and, apart, those wanted and not yet in the table (src/ui/wanted). */
async function pagesKeys(): Promise<{ called: Set<string>; wanted: Set<string> }> {
  const called = new Set<string>();
  const wanted = new Set<string>();
  for (const file of new Bun.Glob("src/ui/**/*.{ts,tsx}").scanSync(ROOT)) {
    for (const m of (await Bun.file(join(ROOT, file)).text()).matchAll(/"((?:GET|POST|PUT|DELETE) \/api\/v1\/[^"]*)"/g)) (file.includes("src/ui/wanted/") ? wanted : called).add(m[1] ?? "");
  }
  for (const key of wanted) called.delete(key);
  return { called, wanted };
}

async function pagesCall(): Promise<Set<string>> {
  return (await pagesKeys()).called;
}

describe("every route the pages call, through the client, on RPE as composed", () => {
  test("each answers a reply its declaration takes, or a refusal in RPE's own words, and none fails as the server: reads of a chat that was played, changes of one that is nowhere", async () => {
    const b = await openTurnBed({ answers: [replying("The tide turns.")] });
    const open: RpeClient[] = [];
    try {
      b.host.send(BED_CHAT, "I watch the harbour.");
      const played = await b.host.generate({ chat: BED_CHAT, connection: CONNECTION, preset: PRESET });
      expect(played.error).toBeNull();
      const first = await settledTurn(b, played.generationId ?? "");
      let held: string | null = (await b.app.auth.mintPageToken(BED_USER, "extension")).token;
      const client = createClient(webConnector(b.listening.url, { get: () => held, set: (next) => (held = next) }, browserDeps()));
      open.push(client);

      const table = new Map(b.app.routes.list().map((r) => [keyOf(r), r]));
      const called = [...(await pagesCall())].sort((a, c) => Number(!a.startsWith("GET ")) - Number(!c.startsWith("GET ")));
      const replied: string[] = [];
      const refused: { key: string; status: number; reading: boolean }[] = [];
      const wrong: string[] = [];
      for (const key of called) {
        const info = table.get(key);
        if (info === undefined) {
          wrong.push(`${key} is not in the table`);
          continue;
        }
        // Reads are asked of the chat that was played, at the turn it holds; a change is asked of a chat and a turn that are nowhere, so none is made.
        const reading = info.method === "GET";
        const ask = askOf(info, { chat: reading ? BED_CHAT : "chat-nowhere", turn: reading ? first.id : "turn-nowhere" });
        try {
          const reply: unknown = await client.call(key as never, ask.params as never, { query: ask.query, body: ask.body } as never);
          const problems = isJoined(reply) ? (info.declared.joined ? [] : ["it answers a joined turn, which it does not declare"]) : replyProblems(b.app, key, reply);
          if (problems.length > 0) wrong.push(`${key}: ${problems.slice(0, 3).join(" ")}`);
          else replied.push(key);
        } catch (error) {
          if (error instanceof RpeError && error.status >= 400 && error.status < 500 && error.message.trim() !== "") refused.push({ key, status: error.status, reading });
          else wrong.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      expect(wrong).toEqual([]);
      // A read of what the bed has answers; one is refused only for a character or a file the bed does not hold, named by a param of its path.
      const strangers = refused.filter((r) => r.reading && !(table.get(r.key)?.params ?? []).some((p) => p !== "chat" && p !== "turn"));
      expect(strangers).toEqual([]);
      // The reads that answered are most of what the pages call: a call that is refused each time checks nothing.
      expect(replied.filter((key) => key.startsWith("GET ")).length).toBeGreaterThan(15);
      expect(replied.length + refused.length).toBe(called.length);
    } finally {
      for (const client of open) client.close();
      await b.close();
    }
  });
});
