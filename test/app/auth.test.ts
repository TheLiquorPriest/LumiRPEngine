// Who may call RPE: the provider endpoint takes the provider key and nothing else; a page token works
// for the user this RPE belongs to until it expires, and is never made for, nor taken from, another
// user; the web UI's token stands for that user too. Each test starts the server in-process on a
// free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, RunningServer } from "../../src/app";
import { AuthRefused, rawRoute, route } from "../../src/app";
import { isRecord } from "../../src/shared/json";
import { bearer, type Bed, makeBed, makeKey, OWNER } from "./helpers";

/** What a test mounts: a provider endpoint that answers whoever the server lets through, and a page route that says whose it is. */
const probe = {
  name: "probe",
  mount(app: App) {
    app.routes.add("probe", [
      rawRoute({
        method: "POST",
        path: "/v1/chat/completions",
        access: "provider",
        raw: async (request) => {
          const body: unknown = await request.json();
          return Response.json({ object: "chat.completion", asked: isRecord(body) ? (body.model ?? null) : null });
        },
      }),
      rawRoute({ method: "GET", path: "/v1/models", access: "provider", raw: () => Response.json({ object: "list", data: [] }) }),
      route({ method: "GET", path: "/api/v1/probe/me", access: "page", handle: ({ user }) => ({ user }) }),
    ]);
  },
};

describe("auth", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({ areas: [probe] });
    server = await app.start();
  });

  afterEach(async () => {
    await bed.remove();
  });

  const completion = (headers: Record<string, string>) => fetch(`${server.url}/v1/chat/completions`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "rpe", messages: [] }) });

  test("the provider endpoint needs the provider key, and refuses a wrong one, another kind's, and one retired", async () => {
    expect((await completion({})).status).toBe(401);
    const wrong = await completion(bearer(`rpe_${"0".repeat(64)}`));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { type: "authentication_error", message: expect.stringContaining("rpe key") } });
    expect((await completion(bearer(await makeKey(app, "web")))).status).toBe(401);
    const key = await makeKey(app, "provider");
    const answered = await completion(bearer(key));
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ object: "chat.completion", asked: "rpe" });
    expect((await fetch(`${server.url}/v1/models`, { headers: bearer(key) })).status).toBe(200);
    const next = await makeKey(app, "provider");
    expect((await completion(bearer(key))).status).toBe(401);
    expect((await completion(bearer(next))).status).toBe(200);
  });

  test("a key is kept only as its hash", async () => {
    const key = await makeKey(app, "provider");
    await app.writes.settled();
    const stored = app.db.query<{ hash: string }, []>("SELECT hash FROM app_key").all();
    expect(stored.map((r) => r.hash)).not.toContain(key);
    expect(new TextDecoder().decode(await Bun.file(bed.paths.database).bytes())).not.toContain(key.slice(4));
  });

  test("a page token works for its user until it expires, and is refused for another user", async () => {
    const { token, expires } = await app.auth.mintPageToken(OWNER, "extension");
    expect(expires).toBe(bed.clock.now + 30 * 60_000);
    const me = () => fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(token) });
    expect(await (await me()).json()).toEqual({ user: OWNER });
    bed.clock.now += 29 * 60_000;
    expect((await me()).status).toBe(200);
    bed.clock.now += 2 * 60_000;
    expect((await me()).status).toBe(401);
    // Another user of the same Lumiverse gets none.
    const other = app.auth.mintPageToken("user-other", "extension");
    await expect(other).rejects.toBeInstanceOf(AuthRefused);
    await expect(other).rejects.toMatchObject({ status: 403, message: expect.stringContaining("only for the Lumiverse user this RPE belongs to") });
  });

  test("a page token made for one user is refused once this RPE belongs to another", async () => {
    const { token } = await app.auth.mintPageToken(OWNER, "extension");
    await app.close();
    const again = await bed.open({ areas: [probe], config: { lumiverse: { user: "user-next" } } });
    const restarted = await again.start();
    expect((await fetch(`${restarted.url}/api/v1/probe/me`, { headers: bearer(token) })).status).toBe(401);
  });

  test("the web UI's token stands for the user this RPE belongs to; nothing else opens a page route", async () => {
    const web = await makeKey(app, "web");
    expect(await (await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(web) })).json()).toEqual({ user: OWNER });
    expect((await fetch(`${server.url}/api/v1/probe/me`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(await makeKey(app, "provider")) })).status).toBe(401);
    expect((await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(await makeKey(app, "extension")) })).status).toBe(401);
  });

  test("a page cannot open the live socket without a token", async () => {
    const refused = await fetch(`${server.url}/api/v1/live`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
    expect(refused.status).toBe(401);
  });

  test("with no user to belong to, no page route opens and no page token is made", async () => {
    await app.close();
    const unowned = await bed.open({ areas: [probe], config: { lumiverse: { user: null } } });
    const running = await unowned.start();
    const web = await makeKey(unowned, "web");
    const page = await fetch(`${running.url}/api/v1/probe/me`, { headers: bearer(web) });
    expect(page.status).toBe(503);
    expect(await page.json()).toMatchObject({ error: expect.stringContaining("lumiverse.user") });
    await expect(unowned.auth.mintPageToken(OWNER, "extension")).rejects.toMatchObject({ status: 503 });
  });
});
