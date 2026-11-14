// The server holds every request to its Host, its Origin and its body limit before any route's code
// runs, answers a page from an allowed origin with what CORS needs, and keeps routes where their
// access allows. Each test starts the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, RunningServer } from "../../src/app";
import { RouteError, RouteTable, rawRoute, route } from "../../src/app";
import { isRecord } from "../../src/shared/json";
import { bearer, type Bed, LUMIVERSE, makeBed, makeKey } from "./helpers";

/** A page route that says how much it was sent, held to 1 KiB. */
const echo = route({
  method: "POST",
  path: "/api/v1/probe/echo",
  access: "page",
  maxBody: 1024,
  body: (value: unknown) => {
    if (!isRecord(value) || typeof value.text !== "string") throw new RouteError(400, "Send {text}.");
    return { text: value.text };
  },
  handle: ({ body }) => ({ length: body.text.length }),
});

describe("the server", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let page: Record<string, string>;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({
      config: { hosts: ["rpe.example"], origins: ["https://lumiverse.example"] },
      areas: [{ name: "probe", mount: (a) => a.routes.add("probe", [echo]) }],
    });
    server = app.start();
    page = bearer(await makeKey(app, "web"));
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("answers its status to whoever reaches it", async () => {
    const res = await fetch(`${server.url}/api/v1/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "rpe", version: "1.0.0", belongsToUser: true });
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
});
