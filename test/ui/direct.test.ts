// The direct road against RPE's own server, in this process on a free loopback port: the client's
// calls and its live socket speak what the app's route table, auth and live hub answer. A stand-in for
// the turn lane's list of turns is mounted as an area, typed from the route as the turn lane's own
// route will be.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, dataPaths, lineLog, openApp, route, type RouteReply } from "../../src/app";
import { configOf } from "../../src/app/config";
import type { LiveEvent, Routes, TurnList } from "../../src/ui/api";
import { createClient, type RpeClient, RpeError, webConnector } from "../../src/ui/client";
import { applyLive, EMPTY_LIVE } from "../../src/ui/live-model";
import { browserDeps, probeDirect } from "../../src/ui/roads";
import { CHAT, RECORDED, RECORDS, turnListAt, USER } from "./recorded";

const turnsRoute = route({
  method: "GET",
  path: "/api/v1/chats/:chat/turns",
  access: "page",
  handle: ({ params, query }): TurnList & { asked: { chat: string; limit: string | null } } => ({ ...turnListAt(), asked: { chat: params.chat, limit: query.get("limit") } }),
});
// The client's shape of the route's reply is what the route gives: this line does not compile when they part.
const sameReply: Routes["GET /api/v1/chats/:chat/turns"]["reply"] = null as unknown as RouteReply<typeof turnsRoute>;

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
    expect((list as typeof sameReply & { asked: unknown }).asked).toEqual({ chat: CHAT, limit: "5" });
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
