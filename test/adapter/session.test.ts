// RPE signed in to Lumiverse as its user, through the stand-in's routes (`test/standin/http.ts`, each
// modelled on Lumiverse's own): the sign-in keeps the session's token and never the password; a session
// Lumiverse has ended is said in plain words and not asked about again until a new sign-in, which
// recovers it; keeping the session renews it past Lumiverse's seven days; a wrong password is refused
// once and never tried again by RPE itself. Every account and chat is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { LumiverseError, LumiverseSession, type StoredSignIn } from "../../src/adapter/lumiverse/session";
import { FakeClock } from "../standin/clock";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";

const USER = "user-tamsin";
const PASSWORD = "salt and lantern";
const DAY = 24 * 60 * 60 * 1000;

const open: { db: StandInDb; server: LumiverseServer }[] = [];
afterEach(() => {
  for (const { db, server } of open.splice(0)) {
    server.stop();
    db.close();
  }
});

function bed(signIn: StoredSignIn | null = null, clientAddress?: string) {
  const clock = new FakeClock();
  const db = new StandInDb();
  db.write({
    user: [{ id: USER, name: "Tamsin", email: "tamsin@example.invalid", username: "tamsin" }, { id: "user-wren", name: "Wren", email: "wren@example.invalid", username: "wren" }],
    characters: [],
    chats: [{ id: "chat-a", user_id: USER, name: "The lighthouse", metadata: "{}" }],
    messages: [],
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  const server = new LumiverseServer({ clock, db, accounts: [{ id: USER, username: "tamsin", password: PASSWORD }, { id: "user-wren", username: "wren", password: "another" }], ...(clientAddress !== undefined ? { clientAddress } : {}) });
  open.push({ db, server });
  const saved: (StoredSignIn | null)[] = [];
  const logs: string[] = [];
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn, save: async (s) => void saved.push(s), owner: () => USER, clock, log: (m) => logs.push(m) });
  const read = (): Promise<unknown> => session.json("GET", "/api/v1/chats/chat-a?messages=false");
  return { clock, server, session, saved, logs, read };
}

/** What a call throws, as RPE's error. */
async function failure(call: Promise<unknown>): Promise<LumiverseError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof LumiverseError) return error;
    throw error;
  }
  throw new Error("the call did not fail");
}

describe("signing in", () => {
  test("keeps the session's token and the account, never the password, and reads as the user", async () => {
    const { session, saved, read } = bed();
    const before = await failure(read());
    expect(before.problem).toBe("signed-out");
    expect(before.message).toContain("not signed in to Lumiverse");

    const kept = await session.signIn("Tamsin", PASSWORD);
    expect(kept).toMatchObject({ username: "Tamsin", user: USER });
    expect(saved).toEqual([kept]);
    expect(JSON.stringify(saved)).not.toContain(PASSWORD);
    expect(session.state()).toMatchObject({ state: "signed-in", user: USER });
    expect(await read()).toMatchObject({ id: "chat-a", name: "The lighthouse" });
  });

  test("a wrong password is refused in plain words, tried once, and leaves the sign-in it had", async () => {
    const { clock, server, session, saved, read } = bed();
    await session.signIn("tamsin", PASSWORD);
    session.keep();
    const refused = await failure(session.signIn("tamsin", "wrong"));
    expect(refused.problem).toBe("refused");
    expect(refused.message).toContain("refused that username or password: Invalid username or password");
    // RPE holds no password, so nothing of it asks again: a day of keeping the session makes no other sign-in.
    await clock.advance(DAY);
    expect(server.signIns).toEqual([
      { username: "tamsin", ok: true },
      { username: "tamsin", ok: false },
    ]);
    expect(saved).toHaveLength(1);
    expect(await read()).toMatchObject({ id: "chat-a" });
    session.stop();
  });

  test("another account is refused, and Lumiverse's own limit on sign-ins is said with its wait", async () => {
    const { server, session, saved } = bed();
    expect((await failure(session.signIn("wren", "another"))).problem).toBe("owner");
    expect(saved).toEqual([]);
    for (let i = 0; i < 7; i++) await failure(session.signIn("tamsin", "wrong"));
    const locked = await failure(session.signIn("tamsin", PASSWORD));
    expect(locked.problem).toBe("locked");
    expect(locked.message).toContain("for about 5 minutes");
    expect(server.signIns).toHaveLength(8);
    expect(session.state().state).toBe("signed-out");
  });

  test("five wrong passwords from another machine lock its address out: RPE says so with the wait, and so does every call after, a held session's read too, until it lifts", async () => {
    const { clock, server, session, read } = bed(null, "192.0.2.40");
    await session.signIn("tamsin", PASSWORD);
    for (let i = 0; i < 4; i++) expect((await failure(session.signIn("tamsin", "wrong"))).problem).toBe("refused");
    const locked = await failure(session.signIn("tamsin", "wrong"));
    expect(locked.problem).toBe("locked");
    expect(locked.status).toBe(429);
    expect(locked.message).toContain("for about 15 minutes");
    expect(locked.message).toContain("Too many failed sign-in attempts. Try again later.");
    expect(locked.message).toContain("It does this after repeated failed sign-ins.");
    expect(server.lockoutState()).toMatchObject({ level: 1 });
    expect((await failure(read())).problem).toBe("locked");
    await clock.advance(15 * 60 * 1000);
    expect(await read()).toMatchObject({ id: "chat-a" });
  });
});

describe("a refusal by Lumiverse", () => {
  test("a 403 from a role check is told as a role check", async () => {
    const { session, server } = bed();
    await session.signIn("tamsin", PASSWORD);
    const refused = await failure(session.json("GET", "/api/v1/users"));
    expect(refused).toMatchObject({ problem: "refused", status: 403, refusedBy: "role" });
    expect(refused.message).toContain("a role check refused it");
    expect(refused.message).toContain("a user");
    expect(refused.message).not.toContain("trusted hosts");
    expect(server.requests.map((r) => `${r.path} ${r.status}`).slice(-2)).toEqual(["/api/v1/users 403", "/api/auth/get-session 200"]);
  });

  test("a 403 from Lumiverse's trusted-host check is told as that, at the sign-in and at any later call", async () => {
    const { session, server } = bed();
    await session.signIn("tamsin", PASSWORD);
    server.untrustedHost = true;
    const read = await failure(session.json("GET", "/api/v1/users"));
    expect(read).toMatchObject({ problem: "refused", status: 403, refusedBy: "host" });
    expect(read.message).toContain("not one of its trusted hosts");
    const signIn = await failure(session.signIn("tamsin", PASSWORD));
    expect(signIn).toMatchObject({ problem: "refused", refusedBy: "host" });
  });
});

describe("a session Lumiverse ended", () => {
  test("is said plainly at the next read, forgotten, and not asked about again until a new sign-in recovers it", async () => {
    const { server, session, saved, logs, read } = bed();
    await session.signIn("tamsin", PASSWORD);
    const changes: string[] = [];
    session.onChange((s) => changes.push(s.state));
    server.endSessions(USER);

    const lost = await failure(read());
    expect(lost.problem).toBe("lost");
    expect(lost.status).toBe(401);
    expect(lost.message).toBe(`RPE's sign-in to Lumiverse at ${server.base} has ended: it expired, or was signed out in Lumiverse. RPE cannot read your chats or hear your replies until it is signed in again (rpe up).`);
    expect(session.state()).toMatchObject({ state: "lost", username: "tamsin", why: lost.message });
    expect(saved.at(-1)).toBeNull();
    expect(logs).toEqual([lost.message]);

    // Every read says the same, and none goes to Lumiverse.
    const asked = server.requests.length;
    expect((await failure(read())).message).toBe(lost.message);
    expect(server.requests).toHaveLength(asked);
    expect(logs).toHaveLength(1);

    await session.signIn("tamsin", PASSWORD);
    expect(await read()).toMatchObject({ id: "chat-a" });
    expect(changes).toEqual(["lost", "signed-in"]);
  });

  test("a sign-in kept from before is checked on use: dead, it is said the same way", async () => {
    const first = bed();
    const kept = await first.session.signIn("tamsin", PASSWORD);
    first.server.endSessions(USER);
    const again = new LumiverseSession({ base: first.server.base, fetch: first.server.fetch, signIn: kept, save: async () => undefined, owner: () => USER, clock: first.clock, log: () => undefined });
    expect(again.state()).toMatchObject({ state: "signed-in", checkedAt: null });
    expect((await failure(again.check())).problem).toBe("lost");
    expect(again.state().state).toBe("lost");
  });
});

describe("keeping the session", () => {
  test("asks after it twice a day, so Lumiverse renews it past its seven days; a session not kept runs out", async () => {
    const kept = bed();
    await kept.session.signIn("tamsin", PASSWORD);
    kept.session.keep();
    const idle = bed();
    await idle.session.signIn("tamsin", PASSWORD);
    for (let day = 0; day < 9; day++) {
      await kept.clock.advance(DAY);
      await idle.clock.advance(DAY);
    }
    expect(await kept.read()).toMatchObject({ id: "chat-a" });
    // Asked every twelve hours: the last ask was at the ninth day's end.
    expect(kept.session.state()).toMatchObject({ state: "signed-in", checkedAt: kept.clock.now() });
    expect((await failure(idle.read())).problem).toBe("lost");

    // Ended in Lumiverse meanwhile: the next ask finds it, and says so.
    kept.server.endSessions(USER);
    await kept.clock.advance(DAY / 2);
    expect(kept.session.state().state).toBe("lost");
    expect(kept.logs.at(-1)).toContain("has ended");
    kept.session.stop();
  });
});
