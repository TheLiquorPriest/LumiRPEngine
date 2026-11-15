// The server holds every request to its Host, its Origin and its body limit before any route's code
// runs, answers a page from an allowed origin with what CORS needs, and keeps routes where their
// access allows. A route in the form is held to its declaration: what it does not take is refused,
// when it is added and when it is asked. Each test starts the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, QueryFields, Route, RunningServer } from "../../src/app";
import { appRoutes, connectionRoutes, isDeclared, lineLog, RouteTable, rawRoute, route, shape } from "../../src/app";
import { startServer } from "../../src/app/server";
import { Builds } from "../../src/app/update";
import { bearer, type Bed, LUMIVERSE, makeBed, makeKey, testModelLayer } from "./helpers";

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

/** The harbor's places, in the list's own order: by name, which is each one's place in it. */
const HARBOR = ["the chandlery", "the customs house", "the fish market", "the lighthouse", "the quay", "the ropewalk", "the tide pool"];
/** The boats moored at each harbor, by name. */
const MOORED: Readonly<Record<string, readonly string[]>> = { north: ["the Gannet", "the Heron", "the Kittiwake", "the Puffin", "the Tern"], south: ["the Albatross", "the Curlew", "the Petrel", "the Skua"] };

/** How many pages the paged probes read: a cursor refused before its handler runs leaves this as it was. */
let pagesRead = 0;

/** A page of a list kept in order by name: the names after the place `after` (from the start without one), and as `next` the place of its last, or null at the end. */
function pageAfter(list: readonly string[], after: string | undefined, limit: number): { items: string[]; next: string | null } {
  pagesRead++;
  const from = after === undefined ? 0 : list.filter((name) => name <= after).length;
  const items = list.slice(from, from + limit);
  return { items, next: from + limit < list.length ? (items.at(-1) ?? null) : null };
}

/** The harbor's places, a page at a time: 3 a page unless the caller asks, and at most 4. */
const places = route({
  method: "GET",
  path: "/api/v1/probe/places",
  access: "page",
  group: "places",
  does: "The harbor's places, a page at a time.",
  paged: { sizes: () => ({ default: 3, most: 4 }) },
  reply: shape.page(shape.text()),
  handle: ({ query }) => pageAfter(HARBOR, query.after, query.limit),
});

/** The boats moored at a harbor, a page at a time: each harbor's list is a list of its own. */
const moored = route({
  method: "GET",
  path: "/api/v1/probe/harbors/:harbor/boats",
  access: "page",
  group: "places",
  does: "The boats moored at a harbor, a page at a time.",
  paged: { sizes: () => ({ default: 2, most: 4 }) },
  reply: shape.page(shape.text()),
  handle: ({ params, query }) => pageAfter(MOORED[params.harbor] ?? [], query.after, query.limit),
});

/** The harbor's lights, a page at a time: a list of another route, at no params, as the places are. */
const lights = route({
  method: "GET",
  path: "/api/v1/probe/lights",
  access: "page",
  group: "places",
  does: "The harbor's lights, a page at a time.",
  paged: {},
  reply: shape.page(shape.text()),
  handle: ({ query }) => pageAfter(["the breakwater light", "the harbor light", "the point light"], query.after, query.limit ?? 2),
});

/** A request written by hand on a connection of its own, for what `fetch` will not send (a GET with a body), and what came back. */
async function byHand(server: RunningServer, request: { method: string; path: string; headers: Record<string, string>; body: string }): Promise<{ status: number; body: unknown }> {
  const chunks: Buffer[] = [];
  const ended = Promise.withResolvers<void>();
  const socket = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data: (_socket, chunk) => void chunks.push(Buffer.from(chunk)), close: () => ended.resolve(), end: () => ended.resolve() } });
  const head = [`${request.method} ${request.path} HTTP/1.1`, `Host: 127.0.0.1:${server.port}`, "Connection: close", ...Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`), `Content-Length: ${Buffer.byteLength(request.body)}`];
  socket.write(`${head.join("\r\n")}\r\n\r\n${request.body}`);
  await ended.promise;
  const text = Buffer.concat(chunks).toString("utf8");
  const answer = text.slice(text.indexOf("\r\n\r\n") + 4);
  return { status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1] ?? 0), body: answer === "" ? null : JSON.parse(answer) };
}

describe("the server", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let page: Record<string, string>;

  beforeEach(async () => {
    ran = 0;
    pagesRead = 0;
    bed = await makeBed();
    app = await bed.open({
      config: { hosts: ["rpe.example"], origins: ["https://lumiverse.example"] },
      areas: [
        { name: "probe", mount: (a) => a.routes.add("probe", [echo, ...notes, places, moored, lights]) },
        { name: "connections", mount: (a) => a.routes.add("connections", connectionRoutes(testModelLayer(a.models), async () => null)) },
      ],
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

  test("a GET with a body is refused with 400 and its handler does not run", async () => {
    const asked = await byHand(server, { method: "GET", path: "/api/v1/probe/notes?tag=harbor", headers: { ...page, "content-type": "application/json" }, body: JSON.stringify({ tag: "market" }) });
    expect(asked).toEqual({ status: 400, body: { error: "GET /api/v1/probe/notes takes no body." } });
    expect(ran).toBe(0);
    // The same request without its body is answered.
    expect(await byHand(server, { method: "GET", path: "/api/v1/probe/notes?tag=harbor", headers: page, body: "" })).toEqual({ status: 200, body: { tag: "harbor", most: null } });
    expect(ran).toBe(1);
  });

  test("a DELETE with an undeclared body, a malformed one, or one over the limit is refused with 400, 400 and 413, and the connection stays", async () => {
    const json = { ...page, "content-type": "application/json" };
    const made = await fetch(`${server.url}/api/v1/connections`, { method: "POST", headers: json, body: JSON.stringify({ connection: { name: "Harbor watch", provider: "deepseek", auth: "none" } }) });
    const { id } = (await made.json()) as { id: string };
    const remove = async (body: string): Promise<{ status: number; error: unknown }> => {
      const res = await fetch(`${server.url}/api/v1/connections/${id}`, { method: "DELETE", headers: json, body });
      const answered: { error?: unknown } = await res.json();
      return { status: res.status, error: answered.error };
    };
    expect(await remove(JSON.stringify({ zzz: 1 }))).toEqual({ status: 400, error: `DELETE /api/v1/connections/:id takes no body.` });
    expect(await remove("{")).toEqual({ status: 400, error: `DELETE /api/v1/connections/:id takes no body.` });
    expect(await remove("x".repeat(1024 * 1024 + 1))).toEqual({ status: 413, error: "This request's body is 1048577 bytes, and DELETE /api/v1/connections/:id takes at most 1048576 bytes." });
    const listed = (await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).json()) as { connections: { id: string }[] };
    expect(listed.connections.map((c) => c.id)).toEqual([id]);
    // Without a body it goes.
    expect((await fetch(`${server.url}/api/v1/connections/${id}`, { method: "DELETE", headers: page })).status).toBe(204);
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
    // A cursor is a place sealed by the server, not a count: what it says is the server's, and only whether there is one is the page's.
    expect(await get("")).toEqual({ status: 200, body: { items: ["the chandlery", "the customs house", "the fish market"], next: expect.any(String) } });
    const walked: Answer[] = [];
    let cursor: string | null = null;
    do {
      const at = await get(`?limit=4${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
      expect(at.status).toBe(200);
      walked.push(at.body);
      cursor = at.body.next ?? null;
    } while (cursor !== null);
    expect(walked).toEqual([
      { items: ["the chandlery", "the customs house", "the fish market", "the lighthouse"], next: expect.any(String) },
      { items: ["the quay", "the ropewalk", "the tide pool"], next: null },
    ]);
    expect((await get("?cursor=")).status).toBe(400);
  });

  /** A page of a paged probe at `path`, or its refusal. */
  const pageOf = async (path: string, cursor?: string): Promise<{ status: number; body: { items?: string[]; next?: string | null; error?: string } }> => {
    const res = await fetch(`${server.url}${path}${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, { headers: page });
    return { status: res.status, body: (await res.json()) as { items?: string[]; next?: string | null; error?: string } };
  };

  test("a cursor from another route is refused with 400", async () => {
    const from = (await pageOf("/api/v1/probe/places")).body.next ?? "";
    expect(await pageOf("/api/v1/probe/lights", from)).toEqual({ status: 400, body: { error: "This cursor is not one GET /api/v1/probe/lights gave for this list: read the list again from its start, with no cursor." } });
    // Refused before the handler ran; its own route takes it.
    expect(pagesRead).toBe(1);
    expect(await pageOf("/api/v1/probe/places", from)).toEqual({ status: 200, body: { items: ["the lighthouse", "the quay", "the ropewalk"], next: expect.any(String) } });
  });

  test("a cursor this route gave for another list is refused with 400", async () => {
    const north = (await pageOf("/api/v1/probe/harbors/north/boats")).body.next ?? "";
    expect((await pageOf("/api/v1/probe/harbors/south/boats", north)).status).toBe(400);
    expect(pagesRead).toBe(1);
    expect(await pageOf("/api/v1/probe/harbors/north/boats", north)).toEqual({ status: 200, body: { items: ["the Kittiwake", "the Puffin"], next: expect.any(String) } });
  });

  test("a cursor changed by one character is refused with 400", async () => {
    const cursor = (await pageOf("/api/v1/probe/places")).body.next ?? "";
    // Every place in it, the place it names and its seal alike.
    const changed = [...cursor].map((ch, i) => `${cursor.slice(0, i)}${ch === "A" ? "B" : "A"}${cursor.slice(i + 1)}`);
    const answers = await Promise.all(changed.map(async (c) => (await pageOf("/api/v1/probe/places", c)).status));
    expect(answers).toEqual(changed.map(() => 400));
    expect(pagesRead).toBe(1);
    expect((await pageOf("/api/v1/probe/places", cursor)).status).toBe(200);
  });

  test("a cursor another start of the server gave is refused with 400", async () => {
    const cursor = (await pageOf("/api/v1/probe/places")).body.next ?? "";
    const other = await makeBed();
    try {
      const otherApp = await other.open({ areas: [{ name: "probe", mount: (a) => a.routes.add("probe", [places]) }] });
      const again = await otherApp.start();
      const key = bearer(await makeKey(otherApp, "web"));
      const ask = async (cursor?: string): Promise<{ status: number; next: unknown }> => {
        const res = await fetch(`${again.url}/api/v1/probe/places${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, { headers: key });
        const body: unknown = await res.json();
        return { status: res.status, next: typeof body === "object" && body !== null && "next" in body ? body.next : undefined };
      };
      expect((await ask(cursor)).status).toBe(400);
      // The same server's own cursor it takes.
      const own = (await ask()).next;
      expect(typeof own).toBe("string");
      expect((await ask(String(own))).status).toBe(200);
    } finally {
      await other.remove();
    }
  });

  test("a handler whose route does not declare the credential is handed none, the public status route among them, and the session route, which declares it, is handed it", async () => {
    // The app's own routes, each handler watched for what it is handed, on a server of their own over this app's auth and hub.
    const handed = new Map<string, unknown>();
    const watched = appRoutes("1.0.0", 0, app.auth, null, new Builds({ version: "1.0.0", file: null, log: lineLog(() => undefined) })).map((r: Route): Route => {
      if (!isDeclared(r) || "raw" in r) return r;
      const handle = r.handle as (call: Record<string, unknown>) => unknown;
      return { ...r, handle: (call: Record<string, unknown>) => (handed.set(`${r.method} ${r.path}`, "credential" in call ? call.credential : "handed none"), handle(call)) } as Route;
    });
    const table = new RouteTable();
    table.add("app", watched);
    const own = startServer({ config: { ...app.config, port: 0 }, routes: table, auth: app.auth, live: app.live, log: lineLog(() => undefined), now: () => bed.clock.now });
    try {
      const token = await makeKey(app, "web");
      for (const [method, path] of [["GET", "/api/v1/status"], ["GET", "/api/v1/status/builds"], ["POST", "/api/v1/update"], ["GET", "/api/v1/status/session"]] as const) {
        expect({ path, status: (await fetch(`${own.url}${path}`, { method, headers: bearer(token) })).status }).toEqual({ path, status: 200 });
      }
      expect(Object.fromEntries(handed)).toEqual({ "GET /api/v1/status": "handed none", "GET /api/v1/status/builds": "handed none", "POST /api/v1/update": "handed none", "GET /api/v1/status/session": token });
    } finally {
      await own.stop();
    }
    // A route that does not declare it is given none to read: its handler does not compile.
    route({
      method: "GET",
      path: "/api/v1/probe/whose",
      access: "page",
      group: "service",
      does: "Says whose the caller's credential is.",
      reply: shape.object({ whose: shape.nullable(shape.text()) }),
      // @ts-expect-error It declares no credential, so it is handed none to read.
      handle: ({ credential }) => ({ whose: credential }),
    });
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
