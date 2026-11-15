// Signing in to the web app (plan §4.4, §16; READINGS R-8, R-57): the printed token traded for a session,
// a Lumiverse account accepted for the user RPE belongs to and for no other, and the proof RPE gives a
// page before the page sends it a token.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, RunningServer } from "../../src/app";
import { AccountRefused, type AccountSignedIn, type LumiverseAccounts } from "../../src/app/accounts";
import { secretHash } from "../../src/app/auth";
import { route, shape } from "../../src/app/routes";
import { LUMIVERSE_SIGNIN_PATH, SIGNIN_SESSION_PATH, SIGNOUT_PATH, signinDeps, signinRoutes } from "../../src/app/signin-routes";
import { KEY_ID_LENGTH, PROOF_PATH, proofOf } from "../../src/shared/page-proof";
import { bearer, type Bed, makeBed, makeKey, OWNER } from "./helpers";

/** Lumiverse's accounts, as the door gives them: who may sign in with what, and every call made. */
function accountsStandIn(): LumiverseAccounts & { calls: string[]; live: Set<string> } {
  const users = new Map([
    ["owner", { id: OWNER, password: "invented owner password" }],
    ["someone", { id: "user-someone", password: "invented someone password" }],
  ]);
  const calls: string[] = [];
  const live = new Set<string>();
  let made = 0;
  const known = (token: string): AccountSignedIn | null => {
    const [name] = token.split(":");
    const user = users.get(name ?? "");
    return user === undefined || !live.has(token) ? null : { user: user.id, username: name ?? "", token };
  };
  return {
    calls,
    live,
    async signIn(username, password) {
      calls.push(`signIn ${username}`);
      const user = users.get(username);
      if (user === undefined || user.password !== password) throw new AccountRefused("wrong", "Invalid username or password");
      const token = `${username}:${++made}`;
      live.add(token);
      return { user: user.id, username, token };
    },
    async check(token) {
      calls.push("check");
      const found = known(token);
      if (found === null) throw new AccountRefused("wrong", "Lumiverse has no such session.");
      return found;
    },
    async signOut(token) {
      calls.push(`signOut ${token}`);
      live.delete(token);
    },
  };
}

describe("signing in to the web app", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let accounts: ReturnType<typeof accountsStandIn>;

  beforeEach(async () => {
    bed = await makeBed();
    accounts = accountsStandIn();
    app = await bed.open({
      areas: [
        {
          name: "signin",
          mount: (a) => {
            a.routes.add("signin", signinRoutes(signinDeps(a, accounts)));
            // A route that says which client made the session its call came with.
            a.routes.add("who", [route({ method: "GET", path: "/api/v1/signin/who", access: "page", group: "service", does: "Says which client made the session the call came with.", reply: shape.object({ by: shape.nullable(shape.text()) }), handle: ({ auth }) => ({ by: auth.credential?.madeBy ?? null }) })]);
          },
        },
      ],
    });
    server = await app.start();
  });

  afterEach(async () => {
    await bed.remove();
  });

  const post = (path: string, body: unknown, token?: string): Promise<Response> => fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : bearer(token)) }, body: JSON.stringify(body) });
  const trade = (token: string, body: unknown = {}): Promise<Response> => post(SIGNIN_SESSION_PATH, body, token);
  const who = async (token: string): Promise<unknown> => (await (await fetch(`${server.url}/api/v1/signin/who`, { headers: bearer(token) })).json()).by;

  test("the printed token opens a session; the session ends at its time unless an open page renews it; a retired token opens none", async () => {
    const printed = await makeKey(app, "web");
    const first = await trade(printed);
    expect(first.status).toBe(200);
    const session = await first.json();
    expect(session.session).not.toBe(printed);
    expect(session.session.startsWith("rpp_")).toBe(true);
    expect(session.ends - bed.clock.now).toBe(app.config.auth.webSessionMinutes * 60_000);
    expect(await who(session.session)).toBe("web shell");
    // An open page renews before the end: the session it had is traded for a new one, which holds from then.
    bed.clock.now += 25 * 60_000;
    const renewed = await (await trade(session.session)).json();
    expect(renewed.ends).toBeGreaterThan(session.ends);
    bed.clock.now += 10 * 60_000;
    expect((await trade(session.session)).status).toBe(401);
    expect(await who(renewed.session)).toBe("web shell");
    // A key a new one replaced opens no session; the sessions it opened are theirs to end.
    const newer = await makeKey(app, "web");
    expect((await trade(printed)).status).toBe(401);
    expect((await trade(newer)).status).toBe(200);
    // The extension's page token is no session's to trade.
    const page = await app.auth.mintPageToken(OWNER, "extension");
    expect((await trade(page.token)).status).toBe(403);
    // Signing out ends the session it came with.
    expect((await post(SIGNOUT_PATH, {}, renewed.session)).status).toBe(204);
    expect((await trade(renewed.session)).status).toBe(401);
  });

  test("a Lumiverse sign-in for this RPE's user opens a session; another user of the same Lumiverse, a wrong password, or a Lumiverse that does not answer opens none; the password is kept nowhere; a fifth wrong password is never sent to Lumiverse", async () => {
    const ok = await post(LUMIVERSE_SIGNIN_PATH, { username: "owner", password: "invented owner password" });
    expect(ok.status).toBe(200);
    const opened = await ok.json();
    expect(opened.user).toBe(OWNER);
    expect(opened.lumiverse).toBeUndefined();
    expect(await who(opened.session)).toBe("web shell");
    // The web app's own Lumiverse session is ended as soon as it has been checked: none is kept.
    expect(accounts.live.size).toBe(0);
    expect(JSON.stringify([...app.db.query("SELECT * FROM page_token").all()])).not.toContain("invented owner password");

    // The command line keeps a Lumiverse session of its own, which RPE hands back; a session it holds already is checked as it is.
    const cli = await (await post(LUMIVERSE_SIGNIN_PATH, { client: "command line", username: "owner", password: "invented owner password" })).json();
    expect(cli.lumiverse.token).toMatch(/^owner:/);
    expect(await who(cli.session)).toBe("command line");
    const held = await (await post(LUMIVERSE_SIGNIN_PATH, { client: "mcp server", session: cli.lumiverse.token })).json();
    expect(await who(held.session)).toBe("mcp server");
    expect(held.lumiverse).toBeUndefined();

    // Another user of the same Lumiverse gets none, and the Lumiverse session it made is not kept.
    const other = await post(LUMIVERSE_SIGNIN_PATH, { username: "someone", password: "invented someone password" });
    expect(other.status).toBe(403);
    expect(accounts.calls.at(-1)).toMatch(/^signOut someone:/);

    // Signing out ends the Lumiverse session through the door.
    expect((await post(SIGNOUT_PATH, { lumiverse: cli.lumiverse.token }, cli.session)).status).toBe(204);
    expect(accounts.live.has(cli.lumiverse.token)).toBe(false);

    // Four wrong passwords are sent to Lumiverse; the fifth is not, and neither is a right one while RPE pauses.
    const sent = accounts.calls.filter((c) => c.startsWith("signIn")).length;
    for (let i = 0; i < 4; i++) expect((await post(LUMIVERSE_SIGNIN_PATH, { username: "owner", password: "wrong" })).status).toBe(401);
    expect(accounts.calls.filter((c) => c.startsWith("signIn")).length).toBe(sent + 4);
    expect((await post(LUMIVERSE_SIGNIN_PATH, { username: "owner", password: "wrong" })).status).toBe(429);
    expect((await post(LUMIVERSE_SIGNIN_PATH, { username: "owner", password: "invented owner password" })).status).toBe(429);
    expect(accounts.calls.filter((c) => c.startsWith("signIn")).length).toBe(sent + 4);
    bed.clock.now += app.config.auth.signInPauseMinutes * 60_000 + 1;
    expect((await post(LUMIVERSE_SIGNIN_PATH, { username: "owner", password: "invented owner password" })).status).toBe(200);
  });

  test("a session made for the command line, the MCP server or the web shell says so to the route its call reaches", async () => {
    const printed = await makeKey(app, "web");
    for (const client of ["command line", "mcp server", "web shell"] as const) expect(await who((await (await trade(printed, { client })).json()).session)).toBe(client);
    // One that names none is the web shell's.
    expect(await who((await (await trade(printed)).json()).session)).toBe("web shell");
  });

  const NONCE = "0123456789abcdef0123456789abcdef";
  const ask = (id: string, nonce: string): Promise<Response> => fetch(`${server.url}${PROOF_PATH}?id=${id}&nonce=${nonce}`);

  test("RPE proves it holds a page's token by a keyed answer to the page's nonce, without the token being sent; an answer from anything else fails the check", async () => {
    const { token } = await app.auth.mintPageToken(OWNER, "extension");
    const hash = secretHash(token);
    const id = hash.slice(0, KEY_ID_LENGTH);

    // The page sends the first characters of the token's hash and its nonce: never the token, nor all of its hash.
    const answered = await ask(id, NONCE);
    expect(answered.status).toBe(200);
    const { proof } = await answered.json();
    expect(proof).toBe(await proofOf(hash, NONCE));
    expect(JSON.stringify(proof)).not.toContain(token);
    // The page works the same proof out from its own token, and a proof of another nonce, or from another RPE that holds no such token, is not it.
    expect(proof).not.toBe(await proofOf(hash, "f".repeat(32)));
    expect(proof).not.toBe(await proofOf(secretHash("another-token"), NONCE));
    // The same nonce is not answered twice within its time, and is again after it.
    expect((await ask(id, NONCE)).status).toBe(409);
    bed.clock.now += app.config.auth.nonceSeconds * 1000;
    expect((await ask(id, NONCE)).status).toBe(200);

    // Something that holds no such token answers 404 in RPE's words, whatever the id; nothing of any token is said.
    const unknown = await ask("00000000", NONCE);
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(await unknown.json())).toContain("holds no page token by that id");

    // A bad id or nonce is refused before anything is looked up.
    expect((await ask("xyz", NONCE)).status).toBe(400);
    expect((await ask(hash, NONCE)).status).toBe(400);
    expect((await ask(id, "short")).status).toBe(400);
    expect((await ask(id, "G".repeat(32))).status).toBe(400);
    expect((await fetch(`${server.url}${PROOF_PATH}`)).status).toBe(400);

    // Only a page token is asked after: the web key, the extension's key and the provider key are no page's, and a token past its time holds no more.
    for (const kind of ["web", "extension", "provider"] as const) expect((await ask(secretHash(await makeKey(app, kind)).slice(0, KEY_ID_LENGTH), "1".repeat(32))).status).toBe(404);
    bed.clock.now += 31 * 60_000;
    expect((await ask(id, "2".repeat(32))).status).toBe(404);
  });
});
