// The event socket into Lumiverse as RPE's user, against the stand-in's socket host (`test/standin/
// http.ts`, after Lumiverse's `ws/handler.ts`, `ws/tickets.ts` and `ws/bus.ts`): a ticket, the
// connection, pings that keep Lumiverse's sweep off it, a dropped socket opened again with a fresh
// ticket, a dead connection found by its missing pong, and the two things that stop it, each said in
// words: Lumiverse refusing the socket's sign-in, and a lost session. Every account is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { followChanges } from "../../src/adapter/lumiverse/events";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { LumiverseSocket } from "../../src/adapter/lumiverse/socket";
import { FakeClock } from "../standin/clock";
import { LumiverseServer } from "../standin/http";

const USER = "user-tamsin";
const PASSWORD = "salt and lantern";
const MINUTE = 60_000;

const running: { server: LumiverseServer; socket: LumiverseSocket }[] = [];
afterEach(() => {
  for (const { server, socket } of running.splice(0)) {
    socket.stop();
    server.stop();
  }
});

async function bed() {
  const clock = new FakeClock();
  const server = new LumiverseServer({ clock, accounts: [{ id: USER, username: "tamsin", password: PASSWORD }] });
  const logs: string[] = [];
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock, log: (m) => logs.push(m) });
  await session.signIn("tamsin", PASSWORD);
  const socket = new LumiverseSocket({ session, open: server.open, clock, log: (m) => logs.push(m) });
  running.push({ server, socket });
  const states: string[] = [];
  socket.onState((s) => states.push(s.state));
  return { clock, server, session, socket, logs, states };
}

describe("the event socket", () => {
  test("opens with a single-use ticket and stays open: its pings keep Lumiverse's sweep off it", async () => {
    const { clock, server, socket, states } = await bed();
    socket.start();
    await clock.advance(0);
    expect(socket.state().state).toBe("open");
    expect(states).toEqual(["opening", "open"]);
    expect(server.tickets).toHaveLength(1);
    // Lumiverse's sweep closes a socket silent for two minutes, every minute.
    await clock.advance(30 * MINUTE);
    expect(socket.state().state).toBe("open");
    expect(server.socketsOf(USER)).toHaveLength(1);
    expect(server.tickets).toHaveLength(1);
  });

  test("a socket that sends nothing is closed by Lumiverse's sweep: why the pings are there", async () => {
    const { clock, server, session } = await bed();
    // Pings far apart: the sweep finds the socket silent.
    const quiet = new LumiverseSocket({ session, open: server.open, clock, log: () => undefined, settings: { pingMs: 10 * MINUTE } });
    running.push({ server, socket: quiet });
    quiet.start();
    await clock.advance(0);
    const closes: string[] = [];
    quiet.onState((s) => closes.push(s.state === "waiting" ? s.why : s.state));
    await clock.advance(3 * MINUTE);
    expect(closes[0]).toBe("Lumiverse closed the socket (1001 Timeout)");
  });

  test("a dropped socket is opened again after a wait, with a fresh ticket, and the turn lane hears it opened again", async () => {
    const { clock, server, socket, logs } = await bed();
    const heard = { reopened: 0, changes: 0 };
    followChanges(socket, { changed: () => heard.changes++, reopened: () => heard.reopened++ });
    socket.start();
    await clock.advance(0);
    expect(heard.reopened).toBe(0);

    server.drop(USER);
    await clock.advance(0);
    const waiting = socket.state();
    expect(waiting).toMatchObject({ state: "waiting", why: "Lumiverse closed the socket (1006)", retryAt: clock.now() + 1_000 });
    expect(logs.at(-1)).toBe("Lumiverse closed the socket (1006); RPE opens it again in 1 s.");
    await clock.advance(1_000);
    expect(socket.state().state).toBe("open");
    expect(server.tickets).toHaveLength(2);
    expect(new Set(server.tickets).size).toBe(2);
    expect(heard.reopened).toBe(1);

    // Each failure in a row doubles the wait, up to thirty seconds; opening resets it.
    server.drop(USER);
    await clock.advance(0);
    server.openDelayMs = null;
    await clock.advance(1_000 + 20_000);
    expect(socket.state()).toMatchObject({ state: "waiting", why: "Lumiverse did not let the socket in", retryAt: clock.now() + 2_000 });
    server.openDelayMs = 0;
    await clock.advance(2_000);
    expect(socket.state().state).toBe("open");
    expect(heard.reopened).toBe(2);
  });

  test("a ping with no pong within fifteen seconds is taken for a dead connection, closed, and opened again", async () => {
    const { clock, server, socket } = await bed();
    socket.start();
    await clock.advance(0);
    server.answerPings = false;
    // The ping goes at thirty seconds; its pong is due fifteen seconds later.
    await clock.advance(30_000 + 14_000);
    expect(socket.state().state).toBe("open");
    await clock.advance(1_000);
    expect(socket.state()).toMatchObject({ state: "waiting", why: "Lumiverse stopped answering the socket's pings" });
    server.answerPings = true;
    await clock.advance(1_000);
    expect(socket.state().state).toBe("open");
  });

  test("an authentication error stops it with plain words, it does not try again by itself, and a new sign-in opens it", async () => {
    const { clock, server, session, socket, logs } = await bed();
    server.refuseTickets = true;
    socket.start();
    await clock.advance(0);
    const refused = socket.state();
    expect(refused).toMatchObject({ state: "refused" });
    const words = refused.state === "refused" ? refused.why : "";
    expect(words).toBe("Lumiverse refused this socket's sign-in (Invalid or expired ticket), though RPE's session holds. RPE does not open it again by itself: it does when RPE signs in to Lumiverse again, or restarts. Until then it does not hear your chats' changes as they happen.");
    expect(logs.at(-1)).toBe(words);

    // An hour on, still one ticket and one sign-in: no loop.
    await clock.advance(60 * MINUTE);
    expect(server.tickets).toHaveLength(1);
    expect(server.signIns).toHaveLength(1);
    expect(socket.state().state).toBe("refused");

    server.refuseTickets = false;
    await session.signIn("tamsin", PASSWORD);
    await clock.advance(0);
    expect(socket.state().state).toBe("open");
  });

  test("a lost session stops it until a new sign-in, without asking Lumiverse again meanwhile", async () => {
    const { clock, server, session, socket } = await bed();
    socket.start();
    await clock.advance(0);
    server.endSessions(USER);
    server.drop(USER);
    await clock.advance(1_000);
    const lost = socket.state();
    expect(lost.state === "lost" ? lost.why : "").toContain("has ended");
    const asked = server.requests.length;
    await clock.advance(60 * MINUTE);
    expect(server.requests).toHaveLength(asked);

    await session.signIn("tamsin", PASSWORD);
    await clock.advance(0);
    expect(socket.state().state).toBe("open");
  });
});
