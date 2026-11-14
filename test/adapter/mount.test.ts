// RPE's door to Lumiverse mounted in a real app (`openApp` from `src/app`, listening on a free loopback
// port), against the stand-in Lumiverse with the light extension running in it (`door.ts`). The provider
// endpoint and its model list answer behind the provider key; the extension's routes (the question, a
// page's start-up facts, a page's follows) behind the registration key RPE hands the extension over its
// relay socket; a wrong key is refused on each. End to end: a page's start-up facts reach it through the
// extension and its token is one RPE takes, and a reply Lumiverse asks for on RPE's connection reaches
// the mounted endpoint asked, tagged and answered. And Lumiverse's Stop, as the door offers it to the
// turn lane. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { LIVE_PATH, START_PATH, USER_HEADER } from "../../src/adapter/lumiverse/pipe-wire";
import { QUESTION_PATH, type Question } from "../../src/adapter/lumiverse/wire";
import { pageRoad } from "../../src/ext/page";
import { isRecord } from "../../src/shared/json";
import { REAL_CLOCK } from "../ext/rig";
import type { Outcome } from "../standin/lumiverse";
import { openDoor, USER, type DoorBed } from "./door";

const PAGE = "aaaaaaaabbbbbbbbccccccccdddddddd";

const beds: DoorBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(): Promise<DoorBed> {
  const b = await openDoor({ clock: REAL_CLOCK });
  beds.push(b);
  return b;
}

const bearer = (key: string, extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${key}`, "content-type": "application/json", ...extra });

describe("the door, mounted in the app", () => {
  test("RPE registers with the extension on loopback, with a key of its own and the build, and is told nothing is missing", async () => {
    const b = await bed();
    expect(b.registration).toMatchObject({ v: 1, base: `http://127.0.0.1:${b.listening.port}`, connection: "conn-rpe", build: "build-7" });
    expect(b.registration.key.startsWith("rpx_")).toBe(true);
    // The extension answers the registration, and its notice tells RPE again: each time, nothing.
    expect(b.heard.permissions.length).toBeGreaterThan(0);
    expect(b.heard.permissions.every((missing) => missing.length === 0)).toBe(true);
    await b.until("the event socket to open", () => b.door.lumiverse()?.events.open);
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

  test("the extension's routes answer behind the key RPE registered with, for RPE's own user only; another key, or the provider's, is refused", async () => {
    const b = await bed();
    const question: Question = { v: 1, user: USER, chat: "chat-harbor", purpose: "prompt", generation: null, path: [{ id: "m0", index: 0, swipe: 0 }], entries: [] };
    const ask = (key: string, user = USER): Promise<Response> => fetch(`${b.listening.url}${QUESTION_PATH}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: user }), body: JSON.stringify(question) });
    expect(await (await ask(b.registration.key)).json()).toEqual({ v: 1, secrecy: { disabled: [], enabled: [], mutated: [] }, cut: { keep: null } });
    expect(b.heard.questions).toHaveLength(1);
    expect((await ask(b.registration.key, "user-wren")).status).toBe(401);

    const start = (key: string, user = USER): Promise<Response> => fetch(`${b.listening.url}${START_PATH}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: user }), body: "{}" });
    expect(await (await start(b.registration.key)).json()).toMatchObject({ addresses: [`http://127.0.0.1:${b.listening.port}`], build: "build-7" });
    expect((await start(b.registration.key, "user-wren")).status).toBe(403);

    for (const key of ["rpx_not-the-key", b.providerKey]) {
      for (const path of [QUESTION_PATH, START_PATH, LIVE_PATH]) {
        const refused = await fetch(`${b.listening.url}${path}`, { method: "POST", headers: bearer(key, { [USER_HEADER]: USER }), body: JSON.stringify(question) });
        expect({ path, status: refused.status }).toEqual({ path, status: 401 });
        expect(await refused.json()).toEqual({ error: "This needs the extension's registration with this RPE." });
      }
    }
    expect(b.heard.questions).toHaveLength(1);
  });

  test("a page's start-up facts reach it through the extension, and the page token in them opens RPE's page routes", async () => {
    const b = await bed();
    const page = b.server.page(USER, PAGE, b.extension);
    const road = pageRoad(page.channel, { timers: REAL_CLOCK });
    try {
      const started = await road.start();
      expect(started.missing).toEqual([]);
      expect(started.facts).toMatchObject({ addresses: [`http://127.0.0.1:${b.listening.port}`], build: "build-7" });
      // The live socket is a page route: the token is taken (and the request asked to be a socket); another is refused.
      expect((await fetch(`${b.listening.url}/api/v1/live`, { headers: { authorization: `Bearer ${started.facts?.token ?? ""}` } })).status).toBe(426);
      expect((await fetch(`${b.listening.url}/api/v1/live`, { headers: { authorization: "Bearer rpp_not-a-token" } })).status).toBe(401);
    } finally {
      road.stop();
    }
  });

  test("a reply Lumiverse asks for on RPE's connection: the question is asked, and the request reaches the mounted endpoint tagged and is answered", async () => {
    const b = await bed();
    b.host.connections.set("conn-rpe", { id: "conn-rpe", base: `${b.listening.url}/v1`, key: b.providerKey, model: "rpe" });
    b.host.presets.set("preset-coast", { id: "preset-coast", name: "Coast", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a harbor town." }] });
    b.host.chats.set("chat-harbor", {
      id: "chat-harbor",
      user: USER,
      character: { id: "char-ilsa", name: "Ilsa" },
      messages: [
        { id: "m0", role: "assistant", content: "Welcome to the harbor." },
        { id: "m1", role: "user", content: "I walk to the ferry." },
      ],
      books: [],
    });
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
    b.host.presets.set("preset-coast", { id: "preset-coast", name: "Coast", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a harbor town." }] });
    for (const chat of ["chat-harbor", "chat-cove"]) b.host.chats.set(chat, { id: chat, user: USER, character: { id: "char-ilsa", name: "Ilsa" }, messages: [{ id: `${chat}-m0`, role: "user", content: "I wait for the ferry." }], books: [] });
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
