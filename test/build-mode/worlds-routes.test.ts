// Build's editor on the worlds routes: a draft write on a version the draft has left is answered with the draft as it now stands, and a
// commit made over the command line's socket is the agent's in the world's history.

import { describe, expect, test } from "bun:test";
import { worldsRoutes } from "../../src/build";
import { callRoute, type Given } from "../app/call";
import { makeBed, USER, worldsOn } from "./bed";

describe("the worlds routes", () => {
  test("a stale write gets the current draft and writes nothing; a commit over the command socket is the agent's", async () => {
    const routes = worldsRoutes(worldsOn(makeBed()), 4 * 1024 * 1024);
    const found = (method: string, path: string) => {
      const route = routes.find((r) => r.method === method && r.path === path);
      if (route === undefined) throw new Error(`no route ${method} ${path}`);
      return route;
    };
    const ask = async <T>(method: string, path: string, given: Omit<Given, "user">): Promise<T> => (await callRoute(found(method, path) as never, { ...given, user: USER })) as T;
    const made = await ask<{ world: { id: string }; revision: string }>("POST", "/api/v1/worlds", { body: { name: "Fernwick", template: "fantasy_town" } });
    const world = made.world.id;
    const put = (name: string, version: number) => ask<{ moved: boolean; version: number; stored: boolean }>("PUT", "/api/v1/worlds/:world/draft/parts/:part", { params: { world, part: "meta" }, body: { value: { name }, base: made.revision, version } });
    expect(await put("Fernwick One", 0)).toMatchObject({ moved: false, version: 1 });
    expect(await put("Fernwick Two", 0)).toMatchObject({ moved: true, version: 1, stored: true });

    const commit = found("POST", "/api/v1/worlds/:world/commit").handle as (call: unknown) => Promise<{ revision: string | null }>;
    const done = await commit({ params: { world }, query: {}, body: { base: made.revision, version: 1, note: "by the line" }, user: USER, auth: { user: USER, access: "page", listener: "command", credential: null }, signal: new AbortController().signal });
    expect(done.revision).not.toBeNull();
    const read = await ask<{ history: { source: string }[] }>("GET", "/api/v1/worlds/:world", { params: { world } });
    expect(read.history.map((h) => h.source)).toEqual(["create", "agent"]);
  });
});
