// RPE's door to Lumiverse mounted in a real app (`openApp` from `src/app`, listening on a free loopback
// port), against the stand-in Lumiverse with the light extension running in it (`door.ts`). The provider
// endpoint and its model list answer behind the provider key; the extension's routes (the question, a
// page's start-up facts, a page's follows) behind the registration key RPE hands the extension over its
// relay socket; a wrong key is refused on each. End to end: a page's start-up facts reach it through the
// extension and its token is one RPE takes, and a reply Lumiverse asks for on RPE's connection reaches
// the mounted endpoint asked, tagged and answered. And Lumiverse's Stop, as the door offers it to the
// turn lane. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { CONFIRM_PATH, EXTENSION_STATUS_PATH, LIVE_PATH, START_PATH, USER_HEADER } from "../../src/adapter/lumiverse/pipe-wire";
import { QUESTION_PATH, type Question } from "../../src/adapter/lumiverse/wire";
import { pageRoad } from "../../src/ext/page";
import { NOTICE_ID } from "../../src/ext/start";
import { isRecord } from "../../src/shared/json";
import { ALL, REAL_CLOCK } from "../ext/rig";
import type { Outcome } from "../standin/lumiverse";
import { openDoor, USER, type DoorBed, type DoorOptions } from "./door";

const PAGE = "aaaaaaaabbbbbbbbccccccccdddddddd";

const beds: DoorBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: Omit<DoorOptions, "clock"> = {}): Promise<DoorBed> {
  const b = await openDoor({ clock: REAL_CLOCK, ...options });
  beds.push(b);
  return b;
}

const bearer = (key: string, extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${key}`, "content-type": "application/json", ...extra });

/** The words of a refusal in OpenAI's shape, as the provider endpoint gives one. */
async function refusalWords(res: Response): Promise<string> {
  const body: unknown = await res.json();
  return isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : "";
}

/** A chat of RPE's user on RPE's connection, which Lumiverse reaches at RPE's address. */
function harbor(b: DoorBed): void {
  b.host.connections.set("conn-rpe", { id: "conn-rpe", base: `${b.listening.url}/v1`, key: b.providerKey, model: "rpe" });
  b.host.presets.set("preset-coast", { id: "preset-coast", name: "Coast", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a harbor town." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
  b.host.addChat({
    id: "chat-harbor",
    user: USER,
    character: { id: "char-ilsa", name: "Ilsa" },
    messages: [
      { id: "m0", role: "assistant", content: "Welcome to the harbor." },
      { id: "m1", role: "user", content: "I walk to the ferry." },
    ],
  });
}

describe("the door, mounted in the app", () => {
  test("RPE registers with the extension on loopback, with a key of its own and the build; the extension keeps just that, and tells RPE nothing is missing", async () => {
    const b = await bed();
    expect(b.registration).toMatchObject({ v: 1, base: `http://127.0.0.1:${b.listening.port}`, connections: ["conn-rpe"], build: "build-7" });
    expect(b.registration.key.startsWith("rpx_")).toBe(true);
    expect(b.kept()).toEqual(b.registration);
    expect(b.door.extension()).toEqual({ registered: true, why: null, missing: [], stopped: null });
    await b.until("the event socket to open", () => b.door.lumiverse()?.events.open);
  });

  test("set to listen on an address other than 127.0.0.1, RPE registers its loopback address, and the extension reaches it there: a reply on its connection is asked about, tagged and played", async () => {
    const b = await bed({ config: { address: "::1" } });
    expect(b.listening.url).toBe(`http://[::1]:${b.listening.port}`);
    expect(b.kept()?.base).toBe(`http://127.0.0.1:${b.listening.port}`);
    harbor(b);
    const out = await b.host.generate({ chat: "chat-harbor", connection: "conn-rpe", preset: "preset-coast" });
    expect(out.error).toBeNull();
    expect(out.reply).toMatchObject({ content: "The tide turns." });
    expect(b.heard.questions.map((q) => q.chat)).toEqual(["chat-harbor"]);
    expect(b.heard.turns.map((t) => t.tag.chat)).toEqual(["chat-harbor"]);
  });

  test("when the extension refuses RPE's registration, RPE says so in its log and on its status route, and still passes a request with no tag on", async () => {
    const b = await bed({ lumiverse: { relay: { retrySeconds: 0.1 } } });
    const page = bearer((await b.app.auth.mintPageToken(USER, "extension")).token);
    const status = async (): Promise<unknown> => await (await fetch(`${b.listening.url}${EXTENSION_STATUS_PATH}`, { headers: page })).json();
    const untitled = { model: "rpe", messages: [{ role: "user", content: "Name this chat." }], stream: false };
    const untagged = (): Promise<Response> => fetch(`${b.listening.url}/v1/chat/completions`, { method: "POST", headers: bearer(b.providerKey), body: JSON.stringify(untitled) });
    expect(await status()).toEqual({ registered: true, why: null, missing: [], stopped: null });

    // The extension refuses one of RPE's registrations, as it does any it cannot confirm.
    b.installed.sendToFrontend({ rpe: "refused", why: "RPE did not confirm it.", missing: [] }, USER, { frontendSessionId: b.registration.relay });
    await b.until("RPE to hear the refusal", () => !b.door.extension().registered);
    // A title asked for meanwhile is passed through and answered: keeping an unplayed reply out is the extension's work.
    expect((await untagged()).status).toBe(200);
    expect(b.heard.passed).toHaveLength(1);
    expect(await status()).toEqual({ registered: false, why: expect.stringContaining("RPE did not confirm it."), missing: [], stopped: null });
    expect(b.logs.filter((line) => line.includes("RPE did not confirm it."))).toHaveLength(1);

    // RPE registers again; the extension holds that very registration, and takes it.
    await b.until("RPE to be registered again", () => b.door.extension().registered);
    expect(b.logs.filter((line) => line.includes("took its registration again"))).toHaveLength(1);
    expect((await untagged()).status).toBe(200);
    expect(b.heard.passed).toHaveLength(2);
  });

  test("the provider endpoint and the model list answer behind the provider key; another key, or the extension's, is refused", async () => {
    const b = await bed();
    const models = await fetch(`${b.listening.url}/v1/models`, { headers: bearer(b.providerKey) });
    expect(((await models.json()) as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(["rpe"]);
    const asked = { model: "rpe", messages: [{ role: "user", content: "Name this chat." }], stream: false };
    const passed = await fetch(`${b.listening.url}/v1/chat/completions`, { method: "POST", headers: bearer(b.providerKey), body: JSON.stringify(asked) });
    expect(((await passed.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe("A title for the chat.");
    expect(b.heard.passed).toEqual([{ connection: "conn-author", body: asked }]);

    for (const key of ["rpe_not-the-key", b.registration.key]) {
      const list = await fetch(`${b.listening.url}/v1/models`, { headers: bearer(key) });
      expect(list.status).toBe(401);
      expect(((await list.json()) as { error: { type: string } }).error.type).toBe("authentication_error");
      expect((await fetch(`${b.listening.url}/v1/chat/completions`, { method: "POST", headers: bearer(key), body: JSON.stringify(asked) })).status).toBe(401);
    }
    expect(b.heard.passed).toHaveLength(1);
  });

  test("the extension's routes answer behind the key RPE registered with, for RPE's own user only; another key, the provider's, a page token or the web UI's key is refused, so no page is handed a token but through its start", async () => {
    const b = await bed();
    const question: Question = { v: 1, user: USER, chat: "chat-harbor", purpose: "prompt", generation: null, path: [{ id: "m0", index: 0, swipe: 0, user: false, hash: "0".repeat(32) }], entries: [] };
    const ask = (key: string, user = USER): Promise<Response> => fetch(`${b.listening.url}${QUESTION_PATH}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: user }), body: JSON.stringify(question) });
    expect(await (await ask(b.registration.key)).json()).toEqual({ v: 1, secrecy: { disabled: [], enabled: [], mutated: [] }, cut: { keep: null }, start: { known: true, turn: null } });
    expect(b.heard.questions).toHaveLength(1);
    expect((await ask(b.registration.key, "user-wren")).status).toBe(401);

    const start = (key: string, user = USER): Promise<Response> => fetch(`${b.listening.url}${START_PATH}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: user }), body: "{}" });
    expect(await (await start(b.registration.key)).json()).toMatchObject({ addresses: [`http://127.0.0.1:${b.listening.port}`], build: "build-7" });
    expect((await start(b.registration.key, "user-wren")).status).toBe(403);

    const pageToken = (await b.app.auth.mintPageToken(USER, "extension")).token;
    const webKey = (await b.app.auth.makeKey("web")).key;
    for (const key of ["rpx_not-the-key", b.providerKey, pageToken, webKey]) {
      for (const path of [QUESTION_PATH, START_PATH, LIVE_PATH, CONFIRM_PATH]) {
        const refused = await fetch(`${b.listening.url}${path}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: USER }), body: JSON.stringify(question) });
        expect({ path, status: refused.status }).toEqual({ path, status: 401 });
        expect(await refused.json()).toEqual({ error: "This needs the extension's registration with this RPE." });
      }
    }
    expect(b.heard.questions).toHaveLength(1);
  });

  test("a page's start-up facts reach it through the extension, with how long its token still lives by RPE's own clock, and the page token in them opens RPE's page routes", async () => {
    const b = await bed();
    const page = b.server.page(USER, PAGE, b.extension);
    const road = pageRoad(page.channel, { timers: REAL_CLOCK });
    try {
      const started = await road.start();
      expect(started.missing).toEqual([]);
      expect(started.facts).toMatchObject({ addresses: [`http://127.0.0.1:${b.listening.port}`], build: "build-7" });
      // Measured as RPE answered, so a page schedules its renewal from when the facts reach it, whatever its own clock says.
      const life = started.facts?.expiresInMs ?? 0;
      expect(life).toBeGreaterThan(29 * 60_000);
      expect(life).toBeLessThanOrEqual(30 * 60_000);
      // The live socket is a page route: the token is taken (and the request asked to be a socket); another is refused.
      expect((await fetch(`${b.listening.url}/api/v1/live`, { headers: { authorization: `Bearer ${started.facts?.token ?? ""}` } })).status).toBe(426);
      expect((await fetch(`${b.listening.url}/api/v1/live`, { headers: { authorization: "Bearer rpp_not-a-token" } })).status).toBe(401);
    } finally {
      road.stop();
    }
  });

  test("a reply Lumiverse asks for on RPE's connection: the question is asked, and the request reaches the mounted endpoint tagged and is answered", async () => {
    const b = await bed();
    harbor(b);
    const out = await b.host.generate({ chat: "chat-harbor", connection: "conn-rpe", preset: "preset-coast" });
    expect(out.error).toBeNull();
    expect(out.reply).toMatchObject({ content: "The tide turns.", reasoning: "Reading the harbor." });
    expect(b.heard.questions.map((q) => q.chat)).toEqual(["chat-harbor"]);
    expect(b.heard.turns).toHaveLength(1);
    expect(b.heard.turns[0]?.tag).toMatchObject({ user: USER, chat: "chat-harbor", generation: out.generationId!, kind: "new", connection: "conn-rpe", preset: "preset-coast" });
  });

  test("Lumiverse's Stop, for the generation named alone: that one stops; an id not going stops nothing in its place; an empty id is never sent; a lost sign-in is said", async () => {
    const b = await bed();
    const lumiverse = b.door.lumiverse()!;
    // A model that answers nothing until its request is stopped: each generation on it stays going.
    const SLOW = "http://127.0.0.1:7999";
    b.host.servers.set(SLOW, (request) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      // A request stopped before it was sent fails at once, as `fetch` does with a signal already aborted.
      const stopped = (): void => reject(new Error("The operation was aborted."));
      if (request.signal.aborted) stopped();
      else request.signal.addEventListener("abort", stopped, { once: true });
      return promise;
    });
    b.host.connections.set("conn-slow", { id: "conn-slow", base: `${SLOW}/v1`, key: "slow-key", model: "slow" });
    b.host.presets.set("preset-coast", { id: "preset-coast", name: "Coast", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a harbor town." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
    for (const chat of ["chat-harbor", "chat-cove"]) b.host.addChat({ id: chat, user: USER, character: { id: "char-ilsa", name: "Ilsa" }, messages: [{ id: `${chat}-m0`, role: "user", content: "I wait for the ferry." }] });
    const start = async (chat: string): Promise<{ id: string; outcome: Promise<Outcome> }> => {
      const from = b.host.events.length;
      const outcome = b.host.generate({ chat, connection: "conn-slow", preset: "preset-coast" });
      const id = await b.until(`a generation of ${chat} to start`, () => {
        for (const e of b.host.events.slice(from)) if (e.event === "GENERATION_STARTED" && isRecord(e.payload) && typeof e.payload.generationId === "string") return e.payload.generationId;
        return null;
      });
      return { id, outcome };
    };
    const harbor = await start("chat-harbor");
    const cove = await start("chat-cove");
    const stops = (): number => b.server.requests.filter((r) => r.path === "/api/v1/generate/stop").length;

    // No chat is named with the id, so Lumiverse stops nothing else in its place.
    expect(await lumiverse.stopGeneration("gen-long-gone")).toBe(false);
    // Lumiverse reads a request naming no generation as "stop every one of this user's": RPE never sends one.
    await expect(lumiverse.stopGeneration("")).rejects.toThrow("could not name");
    expect(stops()).toBe(1);

    // Both are still going: each stops when it is named, and only then.
    expect(await lumiverse.stopGeneration(harbor.id)).toBe(true);
    expect((await harbor.outcome).stopped).toBe(true);
    expect(await lumiverse.stopGeneration(harbor.id)).toBe(false);
    expect(await lumiverse.stopGeneration(cove.id)).toBe(true);
    expect((await cove.outcome).stopped).toBe(true);

    b.server.endSessions(USER);
    await expect(lumiverse.stopGeneration(cove.id)).rejects.toThrow("has ended");
  });
});

describe("who the extension takes a registration from", () => {
  const OTHER_PAGE = "eeeeeeeeffffffff0000000011111111";
  const OTHER_USER = "user-wren";

  /** A Lumiverse page's socket: what it sends the extension, and every message the extension sends it. */
  function socketOf(b: DoorBed, user: string, session: string): { send(payload: unknown): void; heard: unknown[] } {
    const page = b.server.page(user, session, b.extension);
    const heard: unknown[] = [];
    page.channel.onBackendMessage((payload) => void heard.push(payload));
    return { send: (payload) => page.channel.sendToBackend(payload), heard };
  }
  const said = (rpe: string) => (m: unknown) => isRecord(m) && m.rpe === rpe;

  test("a page of RPE's own user cannot register in RPE's place: RPE does not confirm a key it did not make, the page is told, and RPE's registration stays", async () => {
    const b = await bed();
    const page = socketOf(b, USER, PAGE);
    page.send({ rpe: "register", registration: { v: 1, base: b.listening.loopback, key: "rpx_made-up", connections: ["conn-other"], relay: PAGE, build: "build-7", values: { questionMs: 3_000, logChars: 200 } } });
    expect(await b.until("the page to be told", () => page.heard.find(said("refused")))).toMatchObject({ why: expect.stringContaining("did not confirm") });
    expect(b.kept()).toEqual(b.registration);
    harbor(b);
    expect((await b.host.generate({ chat: "chat-harbor", connection: "conn-rpe", preset: "preset-coast" })).error).toBeNull();
    expect(b.heard.turns).toHaveLength(1);
  });

  test("a user RPE does not belong to cannot register, even holding RPE's own key: RPE confirms only for its own user, and that user's page reaches nothing of RPE's", async () => {
    const b = await bed();
    const page = socketOf(b, OTHER_USER, OTHER_PAGE);
    page.send({ rpe: "register", registration: { ...b.registration, relay: OTHER_PAGE } });
    expect(await b.until("the page to be told", () => page.heard.find(said("refused")))).toMatchObject({ why: expect.stringContaining("another Lumiverse user") });
    page.send({ rpe: "request", id: "r1", method: "GET", path: "/api/v1/status", headers: {} });
    expect(await b.until("the page's answer", () => page.heard.find(said("response")))).toMatchObject({ id: "r1", status: 403 });
  });

  test("another program on loopback, named by a user RPE does not belong to, is asked to confirm and nothing else: the pipe is no road to it", async () => {
    const b = await bed();
    const asked: string[] = [];
    b.host.servers.set("http://127.0.0.1:11434", async (request) => {
      asked.push(`${request.method} ${new URL(request.url).pathname}`);
      return Response.json({ ok: true });
    });
    const page = socketOf(b, OTHER_USER, OTHER_PAGE);
    page.send({ rpe: "register", registration: { v: 1, base: "http://127.0.0.1:11434", key: "anything", connections: [], relay: OTHER_PAGE, build: "x", values: { questionMs: 3_000, logChars: 200 } } });
    expect(await b.until("the page to be told", () => page.heard.find(said("refused")))).toMatchObject({ why: expect.stringContaining("not RPE") });
    page.send({ rpe: "request", id: "r2", method: "DELETE", path: "/api/v1/models/x", headers: {} });
    expect(await b.until("the page's answer", () => page.heard.find(said("response")))).toMatchObject({ id: "r2", status: 403 });
    expect(asked).toEqual([`POST ${CONFIRM_PATH}`]);
  });

  test("without the proxy permission the extension cannot ask RPE to confirm: RPE says why and what is missing, Lumiverse shows the notice, and once it is granted RPE is registered by itself", async () => {
    const b = await bed({ granted: ALL.filter((p) => p !== "cors_proxy"), lumiverse: { relay: { retrySeconds: 0.1 } } });
    expect(b.door.extension()).toEqual({ registered: false, why: expect.stringContaining("could not reach RPE"), missing: [{ permission: "cors_proxy", why: expect.any(String) }], stopped: null });
    expect(b.kept()).toBeNull();
    expect(b.installed.modals.has(`${USER}\u0000${NOTICE_ID}`)).toBe(true);
    b.grant("cors_proxy");
    await b.until("RPE to be registered", () => b.door.extension().registered);
    expect(b.door.extension()).toEqual({ registered: true, why: null, missing: [], stopped: null });
    expect(b.kept()).toEqual(b.registration);
    await b.until("the notice to close", () => !b.installed.modals.has(`${USER}\u0000${NOTICE_ID}`));
  });
});

describe("what the extension is missing, on RPE's own pages", () => {
  test("RPE keeps what its extension says it is missing, logs it once, and gives it on the status route a page reads; a grant takes it off", async () => {
    const b = await bed({ granted: ALL.filter((p) => p !== "ui_panels") });
    const page = bearer((await b.app.auth.mintPageToken(USER, "extension")).token);
    const status = async (): Promise<unknown> => await (await fetch(`${b.listening.url}${EXTENSION_STATUS_PATH}`, { headers: page })).json();
    expect(await status()).toEqual({ registered: true, why: null, missing: [{ permission: "ui_panels", why: expect.stringContaining("panel") }], stopped: null });
    expect(b.logs.filter((line) => line.includes("missing permissions") && line.includes("ui_panels"))).toHaveLength(1);
    // Nothing else opens it.
    expect((await fetch(`${b.listening.url}${EXTENSION_STATUS_PATH}`)).status).toBe(401);
    b.grant("ui_panels");
    await b.until("RPE to hear the grant", () => b.door.extension().missing?.length === 0);
    expect(await status()).toEqual({ registered: true, why: null, missing: [], stopped: null });
  });

  test("while the extension says it lacks the interceptor permission, a request with no tag is still passed on", async () => {
    const b = await bed({ granted: ALL.filter((p) => p !== "interceptor") });
    const untitled = { model: "rpe", messages: [{ role: "user", content: "Name this chat." }], stream: false };
    const untagged = (): Promise<Response> => fetch(`${b.listening.url}/v1/chat/completions`, { method: "POST", headers: bearer(b.providerKey), body: JSON.stringify(untitled) });
    expect(b.door.extension()).toMatchObject({ registered: true, missing: [{ permission: "interceptor" }] });
    expect((await untagged()).status).toBe(200);
    expect(b.heard.passed).toHaveLength(1);
    b.grant("interceptor");
    await b.until("RPE to hear the grant", () => b.door.extension().missing?.length === 0);
    expect((await untagged()).status).toBe(200);
    expect(b.heard.passed).toHaveLength(2);
  });
});
