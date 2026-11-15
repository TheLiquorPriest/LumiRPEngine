// What an extension's messages to a page, the page's sessions and the extension's modals do on the stand-in Lumiverse, held to Lumiverse's own code (staging at a70f4ed2; paths are
// Lumiverse's `src/`): a message to a session that is gone told to the sending extension alone (`spindle/worker-host.ts:2129-2160`); a user-scoped extension reaching only its installer, an
// operator's reaching the user it names or, naming none, every user (`:2130-2140`); a widget's socket never the session a generation names (`ws/handler.ts:196-205`;
// `spindle/frontend-session.ts:36-42`; `services/generate.service.ts:1550`); a modal that resolves when it is dismissed, with who dismissed it (`spindle/worker-host-presentation-api.ts:486-554`). The
// extensions are installed, granted and enabled as an admin does it. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { LumiverseSession } from "../../../src/adapter/lumiverse/session";
import { LumiverseSocket } from "../../../src/adapter/lumiverse/socket";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import { FakeClock } from "../../standin/clock";
import type { Installed } from "../../standin/host";
import { LumiverseServer } from "../../standin/http";
import { ADMIN } from "../../standin/install";
import { StandIn } from "../../standin/lumiverse";

const QUAY = "user-quay";
const PIER = "user-pier";
const PASSWORD = "salt and lantern";
const GONE = "f".repeat(32);
const BROWSER = "a".repeat(32);
const LATER_BROWSER = "b".repeat(32);
const PIER_BROWSER = "d".repeat(32);
const RELAY = "c".repeat(32);
const MODEL = "http://127.0.0.1:7887";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0).reverse()) close();
});

interface Bed {
  clock: FakeClock;
  lv: StandIn;
  server: LumiverseServer;
  /** Installs and enables an extension for every user (or for one), with `heard` taking each session it is told is gone. */
  extension(identifier: string, user?: string): Promise<{ id: string; api: Installed; closed: { user: string | undefined; session: unknown }[] }>;
  /** A browser page of `user` on `session`: what the extension `id` sent it. */
  page(user: string, session: string, id: string): { heard: unknown[]; socket: { fromClient(text: string): void }; close(): void };
}

function bed(): Bed {
  const clock = new FakeClock();
  const lv = new StandIn();
  const server = new LumiverseServer({
    clock,
    host: lv,
    accounts: [
      { id: QUAY, username: "quay", password: PASSWORD },
      { id: PIER, username: "pier", password: PASSWORD },
    ],
  });
  closing.push(() => server.stop());
  return {
    clock,
    lv,
    server,
    async extension(identifier, user) {
      let api: Installed | undefined;
      const closed: { user: string | undefined; session: unknown }[] = [];
      const info = await lv.spindle.setUp(ADMIN, {
        url: `https://example.invalid/${identifier}`,
        manifest: { identifier, permissions: [] },
        granted: [],
        ...(user === undefined ? {} : { scope: "user" as const, userId: user }),
        code: (worker) => {
          api = worker;
          worker.on("FRONTEND_SESSION_CLOSED", (payload, who) => closed.push({ user: who, session: (payload as { frontendSessionId?: unknown }).frontendSessionId }));
        },
      });
      return { id: info.id, api: api!, closed };
    },
    page(user, session, id) {
      const opened = server.page(user, session, id);
      closing.push(() => opened.close());
      const heard: unknown[] = [];
      opened.channel.onBackendMessage((payload) => heard.push(payload));
      return { heard, socket: opened.socket, close: opened.close };
    },
  };
}

describe("a message to a session of a page", () => {
  test("with two extensions installed, only the sender hears that a session went", async () => {
    const b = bed();
    const first = await b.extension("ext_first");
    const second = await b.extension("ext_second");
    const there = b.page(QUAY, BROWSER, first.id);
    // A session that is there is sent to, and nobody is told anything.
    first.api.sendToFrontend({ hello: 1 }, QUAY, { frontendSessionId: BROWSER });
    await b.clock.advance(0);
    expect(there.heard).toEqual([{ hello: 1 }]);
    expect(first.closed).toEqual([]);
    // One that is gone is told to the sender alone, with the user it named, on a later task.
    first.api.sendToFrontend({ hello: 2 }, QUAY, { frontendSessionId: GONE });
    expect(first.closed).toEqual([]);
    await b.clock.advance(0);
    expect(first.closed).toEqual([{ user: QUAY, session: GONE }]);
    expect(second.closed).toEqual([]);
    expect(there.heard).toEqual([{ hello: 1 }]);
    // An operator's extension naming no user has no one to tell.
    second.api.sendToFrontend({ hello: 3 }, undefined, { frontendSessionId: GONE });
    await b.clock.advance(0);
    expect(second.closed).toEqual([]);
  });

  test("a user's extension reaches its installer alone whoever it names, and an operator's the user it names, or every user's pages where it names none", async () => {
    const b = bed();
    const mine = await b.extension("ext_mine", QUAY);
    const everyone = await b.extension("ext_every");
    const quayPage = { mine: b.page(QUAY, BROWSER, mine.id), every: b.page(QUAY, LATER_BROWSER, everyone.id) };
    const pierPage = { mine: b.page(PIER, PIER_BROWSER, mine.id), every: b.page(PIER, "e".repeat(32), everyone.id) };
    // The user's extension names Pier, and the message goes to Quay: the user it names is ignored.
    mine.api.sendToFrontend({ to: "pier?" }, PIER);
    mine.api.sendToFrontend({ to: "session" }, PIER, { frontendSessionId: BROWSER });
    await b.clock.advance(0);
    expect(quayPage.mine.heard).toEqual([{ to: "pier?" }, { to: "session" }]);
    expect(pierPage.mine.heard).toEqual([]);
    // Pier's session is not one of Quay's: the message to it is told to the sender as gone, for Quay.
    mine.api.sendToFrontend({ to: "pier's session" }, PIER, { frontendSessionId: PIER_BROWSER });
    await b.clock.advance(0);
    expect(pierPage.mine.heard).toEqual([]);
    expect(mine.closed).toEqual([{ user: QUAY, session: PIER_BROWSER }]);
    // An operator's extension names the user: only that user's pages; names none: every user's.
    everyone.api.sendToFrontend({ to: "pier" }, PIER);
    await b.clock.advance(0);
    expect(pierPage.every.heard).toEqual([{ to: "pier" }]);
    expect(quayPage.every.heard).toEqual([]);
    everyone.api.sendToFrontend({ to: "all" });
    await b.clock.advance(0);
    expect(quayPage.every.heard).toEqual([{ to: "all" }]);
    expect(pierPage.every.heard).toEqual([{ to: "pier" }, { to: "all" }]);
  });
});

describe("the session a generation names", () => {
  /** A stand-in with a chat and a scripted model, an extension that keeps the context each interceptor call is given, and the generation's events. */
  async function generating(): Promise<{ b: Bed; context: () => Record<string, unknown> | undefined; started: () => Record<string, unknown> | undefined; run: (dryRun?: boolean) => Promise<void> }> {
    const b = bed();
    b.lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("A line."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
    b.lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "k", model: "model" });
    b.lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
    b.lv.addChat({ id: "chat-quay", user: QUAY, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "m0", role: "user", content: "USER-1 I walk the quay." }] });
    let last: Record<string, unknown> | undefined;
    const url = "https://example.invalid/ext_context";
    await b.lv.spindle.setUp(ADMIN, {
      url,
      manifest: { identifier: "ext_context", permissions: ["interceptor"] },
      granted: ["interceptor"],
      code: (worker) => {
        worker.registerInterceptor(async (messages, context) => {
          last = context as Record<string, unknown>;
          return messages;
        }, {});
      },
    });
    const run = async (dryRun = false): Promise<void> => {
      const done = b.lv.generate({ chat: "chat-quay", connection: "conn-model", preset: "preset-quay", ...(dryRun ? { dryRun: true } : {}) });
      for (let i = 0; i < 200; i++) {
        await b.clock.advance(5);
        await Bun.sleep(1);
      }
      const out = await done;
      expect(out.error).toBeNull();
    };
    return { b, context: () => last, started: () => b.lv.events.findLast((e) => e.event === "GENERATION_STARTED")?.payload as Record<string, unknown> | undefined, run };
  }

  test("RPE's sockets never take the browser's place: a socket opened as a widget is not the session, the newest browser's is, and with none there is none", async () => {
    const g = await generating();
    const { b } = g;
    const session = new LumiverseSession({ base: b.server.base, fetch: b.server.fetch, signIn: null, save: async () => undefined, owner: () => QUAY, clock: b.clock, log: () => undefined });
    await session.signIn("quay", PASSWORD);
    // RPE's relay socket opens as Lumiverse's own widgets do, and is the user's only session: no generation names it.
    const relay = new LumiverseSocket({ session, open: b.server.open, clock: b.clock, log: () => undefined, frontendSession: RELAY });
    closing.push(() => relay.stop());
    relay.start();
    await b.clock.advance(0);
    expect(relay.state().state).toBe("open");
    expect(b.server.socketsOf(QUAY)).toHaveLength(1);
    expect(b.server.socketsOf(QUAY)[0]!.session).toBe(RELAY);
    await g.run();
    expect(g.started()).toMatchObject({ chatId: "chat-quay", frontendSessionId: undefined });
    expect(g.context()).toMatchObject({ chatId: "chat-quay", frontendSessionId: undefined });
    // A browser page opens after it: it is the session, though RPE's socket was there first and reopens.
    const page = b.page(QUAY, BROWSER, "ext-1");
    await g.run();
    expect(g.started()).toMatchObject({ frontendSessionId: BROWSER });
    expect(g.context()).toMatchObject({ frontendSessionId: BROWSER });
    expect(b.lv.events.filter((e) => e.event === "GENERATION_ENDED").map((e) => (e.payload as { frontendSessionId?: string }).frontendSessionId)).toEqual([undefined, BROWSER]);
    // A dry run names it too. RPE's socket opened again (a fresh ticket) is still no one's choice, and the newest browser page is the session.
    await g.run(true);
    expect(g.context()).toMatchObject({ dryRun: true, frontendSessionId: BROWSER });
    const later = b.page(QUAY, LATER_BROWSER, "ext-1");
    relay.stop();
    relay.start();
    await b.clock.advance(0);
    await g.run();
    expect(g.started()).toMatchObject({ frontendSessionId: LATER_BROWSER });
    // Another user's page is the session of no generation of this user's; the page that went leaves the older one, and the last gone leaves none.
    b.page(PIER, PIER_BROWSER, "ext-1");
    await g.run();
    expect(g.started()).toMatchObject({ frontendSessionId: LATER_BROWSER });
    later.close();
    await g.run();
    expect(g.started()).toMatchObject({ frontendSessionId: BROWSER });
    page.close();
    await g.run();
    expect(g.started()).toMatchObject({ frontendSessionId: undefined });
  });
});

describe("a modal an extension opens", () => {
  test("resolves when it is dismissed, with who dismissed it: the user, the user's word, or the extension closing it", async () => {
    const b = bed();
    const ext = await b.extension("ext_modal");
    const page = b.page(QUAY, BROWSER, ext.id);
    const outcome = (promise: Promise<unknown>): (() => unknown) => {
      let result: unknown = "waiting";
      void promise.then((value) => (result = value));
      return () => result;
    };
    const opened = outcome(ext.api.modal.open({ title: "Notice", items: [], userId: QUAY, modalRequestId: "notice", persistent: true }));
    await b.clock.advance(0);
    // The user's page is told, by the id Lumiverse gives it, and the modal is open until it is dismissed.
    const shown = b.lv.events.find((e) => e.event === "SPINDLE_MODAL_OPEN")!.payload as { requestId: string; extensionId: string; title: string; persistent: boolean };
    expect(shown).toMatchObject({ requestId: `spindle-modal:${ext.id}:notice`, extensionId: ext.id, title: "Notice", persistent: true });
    expect(ext.api.modals.has(`${QUAY}\u0000notice`)).toBe(true);
    expect(opened()).toBe("waiting");
    // Another request id dismisses nothing; the answer without a name is the user's.
    page.socket.fromClient(JSON.stringify({ type: "SPINDLE_MODAL_RESULT", requestId: "spindle-modal:other:notice" }));
    await b.clock.advance(0);
    expect(opened()).toBe("waiting");
    page.socket.fromClient(JSON.stringify({ type: "SPINDLE_MODAL_RESULT", requestId: shown.requestId }));
    await b.clock.advance(0);
    expect(opened()).toEqual({ dismissedBy: "user" });
    expect(ext.api.modals.has(`${QUAY}\u0000notice`)).toBe(false);
    // The page may say how: a click outside, say.
    const second = outcome(ext.api.modal.open({ title: "Again", items: [], userId: QUAY, modalRequestId: "again" }));
    await b.clock.advance(0);
    page.socket.fromClient(JSON.stringify({ type: "SPINDLE_MODAL_RESULT", requestId: `spindle-modal:${ext.id}:again`, dismissedBy: "backdrop" }));
    await b.clock.advance(0);
    expect(second()).toEqual({ dismissedBy: "backdrop" });
    // The extension closing it by the id it gave dismisses it as the extension.
    const third = outcome(ext.api.modal.open({ title: "Third", items: [], userId: QUAY, modalRequestId: "third" }));
    await b.clock.advance(0);
    expect(third()).toBe("waiting");
    await ext.api.modal.close("third", QUAY);
    await b.clock.advance(0);
    expect(third()).toEqual({ dismissedBy: "extension" });
    expect(ext.api.modals.has(`${QUAY}\u0000third`)).toBe(false);
  });

  test("an operator's extension that names no user fails, as one installed for a user opens it for its installer whatever it names", async () => {
    const b = bed();
    const everyone = await b.extension("ext_every");
    await expect(everyone.api.modal.open({ title: "Nobody", items: [] })).rejects.toThrow("userId is required for operator-scoped extensions");
    await expect(everyone.api.modal.close("none")).rejects.toThrow("userId is required for operator-scoped extensions");
    const mine = await b.extension("ext_mine", QUAY);
    void mine.api.modal.open({ title: "Mine", items: [], userId: PIER, modalRequestId: "mine" });
    await b.clock.advance(0);
    const shown = b.lv.events.filter((e) => e.event === "SPINDLE_MODAL_OPEN");
    expect(shown).toHaveLength(1);
    expect(mine.api.modals.has(`${QUAY}\u0000mine`)).toBe(true);
    expect(mine.api.modals.has(`${PIER}\u0000mine`)).toBe(false);
  });
});
