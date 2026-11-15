// The web shell's sign-in (plan §4.4; READINGS R-57): the printed token or a Lumiverse account is traded
// for a session, and the browser keeps the session, never the token nor the password; a page that is open
// renews its session before it ends, and a key an earlier build kept is traded and let go.

import { describe, expect, test } from "bun:test";
import { storedTokens, TOKEN_KEY } from "../../src/ui/web";
import { ENDS_KEY, createSessions } from "../../src/ui/web-signin";
import { createUiSettings } from "../../src/ui/ui-settings";
import type { RoadDeps } from "../../src/ui/roads";

const BASE = "http://rpe.invalid";
const PRINTED = "rpw_printed-token-0000";
const PASSWORD = "invented password";

/** A browser: its storage, a clock the test moves, timers it fires by hand, and RPE answering the sign-in routes as `answer` says. */
function browser(answer: (path: string, bearer: string | null, body: unknown) => { status: number; body: unknown }, before: Record<string, string> = {}) {
  const kept = new Map<string, string>(Object.entries(before));
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  const clock = { now: 1_000_000 };
  const timers: { at: number; run: () => void }[] = [];
  const calls: { path: string; bearer: string | null; body: unknown }[] = [];
  const deps: RoadDeps = {
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const bearer = init.headers.authorization?.replace(/^Bearer /, "") ?? null;
      const body: unknown = init.body === undefined ? null : JSON.parse(init.body);
      calls.push({ path, bearer, body });
      const said = answer(path, bearer, body);
      return { status: said.status, text: async () => JSON.stringify(said.body) };
    },
    openSocket: () => {
      throw new Error("no socket here");
    },
    timers: {
      now: () => clock.now,
      setTimeout: (run, ms) => {
        const timer = { at: clock.now + ms, run };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        const at = timers.indexOf(handle as (typeof timers)[number]);
        if (at !== -1) timers.splice(at, 1);
      },
    },
  };
  const tokens = storedTokens(storage);
  let changed = 0;
  const sessions = createSessions(BASE, tokens, storage, deps, createUiSettings(null), () => changed++);
  return { kept, clock, timers, calls, tokens, sessions, changed: () => changed, storage };
}

/** RPE as it answers: a session for the printed token (or a session), and a refusal for anything else. */
function rpe() {
  let made = 0;
  return (path: string, bearer: string | null, body: unknown, now: () => number): { status: number; body: unknown } => {
    if (path.endsWith("/signin/session")) return bearer === PRINTED || bearer?.startsWith("rpp_session-") === true ? { status: 200, body: { session: `rpp_session-${++made}`, ends: now() + 30 * 60_000, user: "user-owner" } } : { status: 401, body: { error: "This needs a page token or the web UI's token." } };
    if (path.endsWith("/signin/lumiverse")) return (body as { password: string }).password === PASSWORD ? { status: 200, body: { session: `rpp_session-${++made}`, ends: now() + 30 * 60_000, user: "user-owner" } } : { status: 401, body: { error: "Invalid username or password" } };
    return { status: 204, body: null };
  };
}

describe("the web shell's sign-in", () => {
  test("after sign-in the browser's storage holds the session and not the token or the password; the session is renewed before it ends while the page is open", async () => {
    const answers = rpe();
    const page = browser((path, bearer, body) => answers(path, bearer, body, () => page.clock.now));
    await page.sessions.withToken(PRINTED);
    expect(page.tokens.get()).toBe("rpp_session-1");
    expect([...page.kept.keys()].sort()).toEqual([ENDS_KEY, TOKEN_KEY]);
    expect(JSON.stringify([...page.kept])).not.toContain(PRINTED);
    // An open page asks for a new session before this one ends, with the session it has, not the token.
    expect(page.timers.length).toBe(1);
    page.clock.now = page.timers[0]?.at ?? 0;
    page.timers[0]?.run();
    await Bun.sleep(0);
    expect(page.calls.at(-1)).toMatchObject({ bearer: "rpp_session-1" });
    expect(page.tokens.get()).toBe("rpp_session-2");
    // A Lumiverse account: the password goes to RPE once, and is in no storage.
    await page.sessions.withAccount("owner", PASSWORD);
    expect(page.tokens.get()).toBe("rpp_session-3");
    expect(JSON.stringify([...page.kept])).not.toContain(PASSWORD);
    // A wrong password is RPE's own words, and the session before it stands.
    await expect(page.sessions.withAccount("owner", "wrong")).rejects.toThrow("Invalid username or password");
    expect(page.tokens.get()).toBe("rpp_session-3");
    await page.sessions.signOut();
    expect(page.calls.at(-1)?.path).toEndWith("/signin/end");
    expect([...page.kept.keys()]).toEqual([]);
    page.sessions.stop();
  });

  test("a key an earlier build kept is traded and let go, a session past its end is let go, and one RPE no longer takes sends the page back to the form", async () => {
    const answers = rpe();
    const reopened = browser((path, bearer, body) => answers(path, bearer, body, () => reopened.clock.now), { [TOKEN_KEY]: PRINTED });
    await reopened.sessions.resume();
    // The key was traded for a session when the page loaded, and is no longer kept.
    expect(reopened.tokens.get()).toBe("rpp_session-1");
    expect(JSON.stringify([...reopened.kept])).not.toContain(PRINTED);

    const ended = browser(() => ({ status: 401, body: { error: "no" } }), { [TOKEN_KEY]: "rpp_session-9", [ENDS_KEY]: String(1_000_000 - 1) });
    await ended.sessions.resume();
    expect([...ended.kept.keys()]).toEqual([]);

    const refused = browser(() => ({ status: 401, body: { error: "no" } }), { [TOKEN_KEY]: "rpp_session-8", [ENDS_KEY]: String(1_000_000 + 30 * 60_000) });
    await refused.sessions.resume();
    expect(refused.tokens.get()).toBe("rpp_session-8");
    refused.clock.now = refused.timers[0]?.at ?? 0;
    refused.timers[0]?.run();
    await Bun.sleep(0);
    expect(refused.tokens.get()).toBeNull();
    expect(refused.changed()).toBe(1);
    for (const page of [reopened, ended, refused]) page.sessions.stop();
  });
});
