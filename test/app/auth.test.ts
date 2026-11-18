// Who may call RPE: the provider endpoint takes the provider key and nothing else; a page token works
// for the user this RPE belongs to until it expires, and is never made for, nor taken from, another
// user; the web UI's token stands for that user too. Each test starts the server in-process on a
// free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, RunningServer } from "../../src/app";
import { Auth, AuthRefused, rawRoute, route, shape } from "../../src/app";
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
        group: "provider",
        does: "A test's provider endpoint: answers whoever the server lets through.",
        answers: "a chat completion",
        raw: async (request) => {
          const body: unknown = await request.json();
          return Response.json({ object: "chat.completion", asked: isRecord(body) ? (body.model ?? null) : null });
        },
      }),
      rawRoute({ method: "GET", path: "/v1/models", access: "provider", group: "provider", does: "A test's model list.", answers: "a model list", raw: () => Response.json({ object: "list", data: [] }) }),
      route({ method: "GET", path: "/api/v1/probe/me", access: "page", group: "service", does: "Says whose the caller is.", reply: shape.object({ user: shape.text() }), handle: ({ user }) => ({ user }) }),
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
    const stored = app.db.query<{ hash: string }, []>("SELECT hash FROM provider_key").all();
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
    // The same database, as an RPE that belongs to another user sees it: such an RPE opens no other user's database at all.
    const next = new Auth({ db: app.db, writes: app.writes, owner: "user-next", now: app.now, pageTokenMs: 60_000, sessionMs: 1_800_000, webKeyMs: null });
    expect(next.pageUser(token)).toBeNull();
    expect(app.auth.pageUser(token)).toBe(OWNER);
  });

  test("the web UI's token stands for the user this RPE belongs to; nothing else opens a page route", async () => {
    const web = await makeKey(app, "web");
    expect(await (await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(web) })).json()).toEqual({ user: OWNER });
    expect((await fetch(`${server.url}/api/v1/probe/me`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(await makeKey(app, "provider")) })).status).toBe(401);
    expect((await fetch(`${server.url}/api/v1/probe/me`, { headers: bearer(await makeKey(app, "extension")) })).status).toBe(401);
  });

  test("the web UI's key has no end as shipped; with auth.webKeyDays it opens page routes until that many days after it was made; the session route tells the page when its credential ends", async () => {
    const session = async (token: string) => (await fetch(`${server.url}/api/v1/status/session`, { headers: bearer(token) })).json();
    const forever = await makeKey(app, "web");
    expect(await session(forever)).toMatchObject({ user: OWNER, holds: "web key", ends: null, webKey: { ends: null } });
    const page = await app.auth.mintPageToken(OWNER, "extension");
    expect(await session(page.token)).toMatchObject({ user: OWNER, holds: "session", ends: page.expires, webKey: { ends: null } });
    const days = await bed.open({ areas: [probe], config: { port: 0, auth: { webKeyDays: 2 } } });
    const other = await days.start();
    const made = bed.clock.now;
    const web = await makeKey(days, "web");
    expect(await (await fetch(`${other.url}/api/v1/status/session`, { headers: bearer(web) })).json()).toMatchObject({ user: OWNER, holds: "web key", ends: made + 2 * 86_400_000, webKey: { ends: made + 2 * 86_400_000 } });
    bed.clock.now = made + 2 * 86_400_000 - 1;
    expect((await fetch(`${other.url}/api/v1/probe/me`, { headers: bearer(web) })).status).toBe(200);
    bed.clock.now = made + 2 * 86_400_000;
    expect((await fetch(`${other.url}/api/v1/probe/me`, { headers: bearer(web) })).status).toBe(401);
  });

  test("a page cannot open the live socket without a token", async () => {
    const refused = await fetch(`${server.url}/api/v1/live`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
    expect(refused.status).toBe(401);
  });

  test("a key made under one user does not open RPE once it belongs to another", async () => {
    const provider = await makeKey(app, "provider");
    const web = await makeKey(app, "web");
    expect(app.auth.holds("provider", provider)).toBe(true);
    expect(app.auth.pageUser(web)).toBe(OWNER);
    // The same database, as an RPE that belongs to another user sees it.
    const other = new Auth({ db: app.db, writes: app.writes, owner: "user-other", now: app.now, pageTokenMs: 60_000, sessionMs: 1_800_000, webKeyMs: null });
    expect(other.holds("provider", provider)).toBe(false);
    expect(other.pageUser(web)).toBeNull();
    const rows = app.db.query<{ user: string }, []>("SELECT user FROM provider_key UNION ALL SELECT user FROM page_token WHERE kind = 'web'").all();
    expect(rows.map((r) => r.user)).toEqual([OWNER, OWNER]);
  });
});
