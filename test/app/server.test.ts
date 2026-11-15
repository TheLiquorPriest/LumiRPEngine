// The server holds every request to its Host, its Origin and its body limit before any route's code
// runs, answers a page from an allowed origin with what CORS needs, and keeps routes where their
// access allows. A route in the form is held to its declaration: what it does not take is refused,
// when it is added and when it is asked. Each test starts the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, QueryFields, Route, RunningServer } from "../../src/app";
import { RouteTable, rawRoute, route, shape } from "../../src/app";
import { bearer, type Bed, LUMIVERSE, makeBed, makeKey } from "./helpers";

/** A page route that says how much it was sent, held to 1 KiB. */
const echo = route({
  method: "POST",
  path: "/api/v1/probe/echo",
  access: "page",
  group: "service",
  does: "Says how long the text it was sent is.",
  maxBody: 1024,
  body: shape.object({ text: shape.text() }),
  reply: shape.object({ length: shape.whole() }),
  handle: ({ body }) => ({ length: body.text.length }),
});

/** How many times a probe's handler ran: a request refused before it runs leaves this as it was. */
let ran = 0;

/** A harbor's notes, by tag and how many; one is written with a body that says what it takes. */
const notes = [
  route({
    method: "GET",
    path: "/api/v1/probe/notes",
    access: "page",
    group: "service",
    does: "The harbor's notes, by tag.",
    query: { tag: shape.optional(shape.oneOf("harbor", "market")), most: shape.optional(shape.whole({ least: 1, most: 20 })) },
    reply: shape.object({ tag: shape.nullable(shape.text()), most: shape.nullable(shape.whole()) }),
    handle: ({ query }) => {
      ran++;
      return { tag: query.tag ?? null, most: query.most ?? null };
    },
  }),
  route({
    method: "PUT",
    path: "/api/v1/probe/notes",
    access: "page",
    group: "service",
    does: "Writes a note.",
    body: shape.object({ text: shape.text({ blank: false }), pinned: shape.optional(shape.yesNo()) }),
    reply: shape.nothing(),
    handle: () => {
      ran++;
    },
  }),
  route({
    method: "POST",
    path: "/api/v1/probe/notes/tidy",
    access: "page",
    group: "service",
    does: "Tidies the notes.",
    reply: shape.nothing(),
    handle: () => {
      ran++;
    },
  }),
];

const HARBOR = ["the quay", "the lighthouse", "the chandlery", "the ropewalk", "the fish market", "the customs house", "the tide pool"];

/** The harbor's places, a page at a time: 3 a page unless the caller asks, and at most 4. */
const places = route({
  method: "GET",
  path: "/api/v1/probe/places",
  access: "page",
  group: "places",
  does: "The harbor's places, a page at a time.",
  paged: { sizes: () => ({ default: 3, most: 4 }) },
  reply: shape.page(shape.text()),
  handle: ({ query }) => {
    const from = query.cursor === undefined ? 0 : Number(query.cursor);
    const to = from + query.limit;
    return { items: HARBOR.slice(from, to), next: to < HARBOR.length ? String(to) : null };
  },
});

describe("the server", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let page: Record<string, string>;

  beforeEach(async () => {
    ran = 0;
    bed = await makeBed();
    app = await bed.open({
      config: { hosts: ["rpe.example"], origins: ["https://lumiverse.example"] },
      areas: [{ name: "probe", mount: (a) => a.routes.add("probe", [echo, ...notes, places]) }],
    });
    server = await app.start();
    page = bearer(await makeKey(app, "web"));
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("says to whoever reaches it only that RPE answers and which build; when it started and its builds are a page's", async () => {
    const res = await fetch(`${server.url}/api/v1/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "rpe", version: "1.0.0" });
    expect((await fetch(`${server.url}/api/v1/status/builds`)).status).toBe(401);
    const builds = await fetch(`${server.url}/api/v1/status/builds`, { headers: page });
    expect(await builds.json()).toMatchObject({ name: "rpe", version: "1.0.0", started: bed.clock.now, builds: { running: "1.0.0", agree: true } });
  });

  test("refuses a request addressed to it by a name that is not its own, and takes one its config lists", async () => {
    const rebound = await fetch(`${server.url}/api/v1/status`, { headers: { host: `rebound.example:${server.port}` } });
    expect(rebound.status).toBe(421);
    expect(await rebound.json()).toMatchObject({ error: expect.stringContaining('"hosts"') });
    expect((await fetch(`${server.url}/api/v1/status`, { headers: { host: `localhost:${server.port}` } })).status).toBe(200);
    expect((await fetch(`${server.url}/api/v1/status`, { headers: { host: "rpe.example" } })).status).toBe(200);
    // Its own address on another port is not this server.
    expect((await fetch(`${server.url}/api/v1/status`, { headers: { host: `127.0.0.1:${server.port + 1}` } })).status).toBe(421);
  });

  test("refuses a page from a foreign origin before any route runs, and lets Lumiverse's pages in", async () => {
    const foreign = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: { ...page, origin: "https://elsewhere.example", "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    for (const origin of [new URL(LUMIVERSE).origin, "https://lumiverse.example", server.url]) {
      const res = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: { ...page, origin, "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  test("answers an allowed page's preflight, a loopback call from a public page included", async () => {
    const res = await fetch(`${server.url}/api/v1/probe/echo`, {
      method: "OPTIONS",
      headers: { origin: "https://lumiverse.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type", "access-control-request-private-network": "true" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://lumiverse.example");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
    const refused = await fetch(`${server.url}/api/v1/probe/echo`, { method: "OPTIONS", headers: { origin: "https://elsewhere.example", "access-control-request-method": "POST" } });
    expect(refused.status).toBe(403);
  });

  test("refuses an oversized body, whether its length is declared or it is streamed without one", async () => {
    const fits = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: { ...page, "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(900) }) });
    expect(await fits.json()).toEqual({ length: 900 });
    const declared = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: { ...page, "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(2000) }) });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ error: expect.stringContaining("takes at most 1 KiB") });
    const chunks = [JSON.stringify({ text: "x".repeat(600) }).slice(0, 400), "x".repeat(400), "x".repeat(400)];
    const streamed = await fetch(`${server.url}/api/v1/probe/echo`, {
      method: "POST",
      headers: { ...page, "content-type": "application/json" },
      body: new ReadableStream({
        pull(controller) {
          const next = chunks.shift();
          if (next === undefined) controller.close();
          else controller.enqueue(new TextEncoder().encode(next));
        },
      }),
    });
    expect(streamed.status).toBe(413);
  });

  test("says what it has not got, in the shape each caller reads", async () => {
    const provider = await fetch(`${server.url}/v1/nothing`, { method: "POST" });
    expect(provider.status).toBe(404);
    expect(await provider.json()).toMatchObject({ error: { type: "not_found_error" } });
    const wrongMethod = await fetch(`${server.url}/api/v1/status`, { method: "DELETE" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    const noBody = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: page });
    expect(noBody.status).toBe(400);
    const notJson = await fetch(`${server.url}/api/v1/probe/echo`, { method: "POST", headers: page, body: "{" });
    expect(notJson.status).toBe(400);
  });

  test("takes routes only where their access allows, never twice, and none once it has started", () => {
    const table = new RouteTable();
    const ok = route({ method: "GET", path: "/api/v1/chats/:chat", access: "page", handle: ({ params }) => ({ chat: params.chat }) });
    table.add("chats", [ok]);
    expect(() => table.add("other", [route({ method: "GET", path: "/api/v1/chats/:id", access: "page", handle: () => null })])).toThrow("already answers");
    expect(() => table.add("other", [route({ method: "POST", path: "/api/v1/chats/:id", access: "page", handle: () => null })])).toThrow("name its params as /api/v1/chats/:chat");
    expect(() => table.add("other", [route({ method: "POST", path: "/v1/chat/completions", access: "page", handle: () => null })])).toThrow("for provider");
    expect(() => table.add("other", [route({ method: "POST", path: "/api/v1/ext/ask", access: "page", handle: () => null })])).toThrow("for extension");
    expect(() => table.add("other", [route({ method: "GET", path: "/elsewhere", access: "public", handle: () => null })])).toThrow("routes live under");
    expect(() => table.add("other", [route({ method: "GET", path: "/api/v1/files/*", access: "page", handle: () => null })])).toThrow("only a raw route");
    expect(() => app.routes.add("late", [rawRoute({ method: "GET", path: "/ui/*", access: "public", raw: () => new Response("ui") })])).toThrow("after the server started");
  });

  test("a route that reads a query or a body it does not declare is refused when it is added to the table", () => {
    const table = new RouteTable();
    const reply = shape.object({ chat: shape.text() });
    // A handler is given only what its route declares, typed by it: one that reads more does not compile, so it never reaches the table.
    table.add("chats", [
      route({
        method: "GET",
        path: "/api/v1/chats/:chat/notes",
        access: "page",
        group: "chats",
        does: "A chat's notes, by tag.",
        query: { tag: shape.optional(shape.text()) },
        reply,
        // @ts-expect-error `day` is no name its query declares.
        handle: ({ params, query }) => ({ chat: `${params.chat} ${query.day}` }),
      }),
      route({
        method: "POST",
        path: "/api/v1/chats/:chat/notes",
        access: "page",
        group: "chats",
        does: "Adds a note to a chat.",
        reply,
        // @ts-expect-error It declares no body, so it is given none to read.
        handle: ({ params, body }) => ({ chat: `${params.chat} ${body.text}` }),
      }),
    ]);
    // What the compiler cannot see is refused as the route is added: a body read by a reader of its own (the server could not hold a request to it),
    // a query a query string cannot carry, a name the path already gives, a body on a GET.
    const declared = { access: "page", group: "chats", does: "Reads a chat's marks.", reply, handle: () => ({ chat: "chat-harbor" }) } as const;
    const refused: [Route, string][] = [
      [{ ...declared, method: "PUT", path: "/api/v1/chats/:chat/notes", body: (value: unknown) => value } as unknown as Route, "declares its body as a shape"],
      [{ ...declared, method: "GET", path: "/api/v1/chats/:chat/marks", query: { at: shape.list(shape.text()) } as unknown as QueryFields } as Route, "a query string carries nothing else"],
      [{ ...declared, method: "GET", path: "/api/v1/chats/:chat/marks", query: { chat: shape.text() } } as Route, "chat is a param of its path"],
      [{ ...declared, method: "GET", path: "/api/v1/chats/:chat/marks", body: shape.object({ text: shape.text() }) } as unknown as Route, "a GET takes no body"],
      [{ ...declared, method: "GET", path: "/api/v1/chats/:chat/marks", group: "ui" } as unknown as Route, "not in the ui group"],
    ];
    for (const [r, words] of refused) expect(() => table.add("marks", [r])).toThrow(words);
    // A route in the form may end in *: a turn's file, say, is a typed route.
    table.add("files", [route({ method: "GET", path: "/api/v1/chats/:chat/files/*", access: "page", group: "files", does: "A file of a chat.", reply: shape.object({ name: shape.text() }), handle: ({ params }) => ({ name: params["*"] }) })]);
    expect(table.list().map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/v1/chats/:chat/notes", "POST /api/v1/chats/:chat/notes", "GET /api/v1/chats/:chat/files/*"]);
  });

  test("a request whose query or body its route does not take is refused with 400 before the handler runs", async () => {
    const ask = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
      const res = await fetch(`${server.url}${path}`, { method, headers: { ...page, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
      return { status: res.status, body: res.status === 204 ? null : await res.json() };
    };
    expect(await ask("GET", "/api/v1/probe/notes?tag=harbor&most=5")).toEqual({ status: 200, body: { tag: "harbor", most: 5 } });
    expect(await ask("PUT", "/api/v1/probe/notes", { text: "The ferry runs at dawn.", pinned: true })).toEqual({ status: 204, body: null });
    expect(ran).toBe(2);
    const refusals: [string, string, unknown, string][] = [
      ["GET", "/api/v1/probe/notes?colour=red", undefined, "GET /api/v1/probe/notes takes no colour in its query: it takes tag, most."],
      ["GET", "/api/v1/probe/notes?tag=forest", undefined, 'The query\'s tag is one of "harbor" or "market", not "forest".'],
      ["GET", "/api/v1/probe/notes?most=50", undefined, 'The query\'s most is a whole number from 1 to 20, not "50".'],
      ["GET", "/api/v1/probe/notes?most=two", undefined, 'The query\'s most is a whole number from 1 to 20, not "two".'],
      ["GET", "/api/v1/probe/notes?tag=harbor&tag=market", undefined, "The query gives tag 2 times, and GET /api/v1/probe/notes takes it once."],
      ["PUT", "/api/v1/probe/notes", { text: "The ferry runs at dawn.", colour: "red" }, "body has colour, which it does not take."],
      ["PUT", "/api/v1/probe/notes", { text: "   " }, "body.text must be text that is not blank."],
      ["PUT", "/api/v1/probe/notes", { pinned: "yes" }, "body needs text: text that is not blank. body.pinned must be true or false."],
      ["PUT", "/api/v1/probe/notes", undefined, "PUT /api/v1/probe/notes takes a JSON body: an object of text, pinned."],
      ["PUT", "/api/v1/probe/notes", "{", "The request's body is not JSON."],
      ["POST", "/api/v1/probe/notes/tidy", { all: true }, "POST /api/v1/probe/notes/tidy takes no body."],
    ];
    for (const [method, path, body, words] of refusals) {
      const answer = await ask(method, path, body);
      expect({ method, path, answer }).toEqual({ method, path, answer: { status: 400, body: { error: expect.stringContaining(words) } } });
    }
    expect(ran).toBe(2);
  });

  test("a paged route refuses a limit above its most and answers next until the end", async () => {
    /** What the places route answers: a page, or a refusal. */
    type Answer = { items?: string[]; next?: string | null; error?: string };
    const get = async (query: string): Promise<{ status: number; body: Answer }> => {
      const res = await fetch(`${server.url}/api/v1/probe/places${query}`, { headers: page });
      // The route's own answer, which this test then holds to what it should be.
      const body = (await res.json()) as Answer;
      return { status: res.status, body };
    };
    expect(await get("?limit=5")).toEqual({ status: 400, body: { error: "GET /api/v1/probe/places gives at most 4 a page, and this asks for 5." } });
    expect(await get("")).toEqual({ status: 200, body: { items: ["the quay", "the lighthouse", "the chandlery"], next: "3" } });
    const walked: unknown[] = [];
    let cursor: string | null = null;
    do {
      const at = await get(`?limit=4${cursor === null ? "" : `&cursor=${cursor}`}`);
      expect(at.status).toBe(200);
      walked.push(at.body);
      cursor = at.body.next ?? null;
    } while (cursor !== null);
    expect(walked).toEqual([
      { items: ["the quay", "the lighthouse", "the chandlery", "the ropewalk"], next: "4" },
      { items: ["the fish market", "the customs house", "the tide pool"], next: null },
    ]);
    expect((await get("?cursor=")).status).toBe(400);
  });
});

describe("where the server listens", () => {
  let bed: Bed;

  beforeEach(async () => {
    bed = await makeBed();
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("set to an address other than 127.0.0.1, it answers there and on 127.0.0.1 at the same port, where its extension in Lumiverse reaches it", async () => {
    const server = await (await bed.open({ config: { address: "::1" } })).start();
    expect(server.url).toBe(`http://[::1]:${server.port}`);
    expect(server.loopback).toBe(`http://127.0.0.1:${server.port}`);
    for (const at of [server.url, server.loopback]) expect({ at, status: (await fetch(`${at}/api/v1/status`)).status }).toEqual({ at, status: 200 });
  });

  test("when another program holds 127.0.0.1 at its port, it does not start, and says why in one plain sentence", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("another program") });
    try {
      const app = await bed.open({ config: { address: "::1", port: taken.port } });
      const refused: unknown = await app.start().then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(Error);
      const words = (refused as Error).message;
      expect(words).toMatch(/^[A-Z][^\n]*\.$/);
      expect(words).toContain(`127.0.0.1:${taken.port}`);
      expect(app.listening()).toBeNull();
      // Nothing is left listening on the address it was set to.
      await expect(fetch(`http://[::1]:${taken.port}/api/v1/status`)).rejects.toThrow();
    } finally {
      void taken.stop(true);
    }
  });
});
