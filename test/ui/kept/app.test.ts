// The one App the kept views share (src/ui/kept/app.ts), over the one transport (client.ts): a request a
// call file takes reaches its typed route with no envelope, one no file takes is answered as not served,
// an answer is never remembered, a road failure is the road's and not RPE's refusal, a refusal is held back
// from the toasts by the request it answers, and the toasts' count and times are the page's settings.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type RpeClient, RpeError } from "../../../src/ui/client";
import { CHANGE_MADE, chooseShowIds, type Kept, keptApp, showIdsChosen, type ToastSettings } from "../../../src/ui/kept/app";
import type { CallFile } from "../../../src/ui/kept/client";
import { webHost } from "../../../src/ui/kept/host";
import { createStore } from "../../../src/ui/store";
import { handTimers, routeClient } from "./bed";
import { openPage, type Page } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const SETTINGS: ToastSettings = { toastsShown: 3, errorToastMs: 6000, toastMs: 3500 };
const host = (): ReturnType<typeof webHost> => webHost({ revokeMs: () => 1000 });
const quiet = { follow: () => () => undefined };

/** A call file that serves `lre.world list` from a typed route of its own, and records what it was asked. */
function worldsFile(asked: unknown[], answer: () => Promise<unknown>): CallFile {
  return {
    name: "worlds",
    takes: (request) => request.type === "lre.world" && request.op === "list",
    serve: async (request) => {
      asked.push(request);
      return (await answer()) as never;
    },
  };
}

describe("the App kept for Build and Play", () => {
  test("requests reach typed routes: a call file takes what it serves with no envelope, and what none takes is not served, with nothing sent", async () => {
    const rpe = routeClient();
    const asked: unknown[] = [];
    const calls = [worldsFile(asked, async () => ({ worlds: [] }))];
    const kept = keptApp({ client: { ...rpe.client, ...quiet }, chat: createStore<string | null>(null), mode: "build", host: host(), timers: handTimers(), settings: () => SETTINGS, calls });
    expect(await kept.app.request({ type: "lre.world", op: "list" })).toEqual({ worlds: [] });
    expect(asked).toEqual([{ type: "lre.world", op: "list" }]);
    expect(await kept.app.send({ type: "lre.world", op: "templates" })).toMatchObject({ type: "lre.error", code: "unavailable" });
    expect(rpe.asked).toEqual([]);
    kept.stop();
  });

  test("asked again: a request refused once and then served is shown served, and nothing remembers the refusal", async () => {
    const answers: (() => Promise<unknown>)[] = [() => Promise.reject(new RpeError(409, "Not yet.")), async () => ({ worlds: [] })];
    const asked: unknown[] = [];
    const kept = keptApp({ client: { call: (() => Promise.reject(new Error("no"))) as RpeClient["call"], ...quiet }, chat: createStore<string | null>(null), mode: "build", host: host(), timers: handTimers(), settings: () => SETTINGS, calls: [worldsFile(asked, () => (answers.shift() as () => Promise<unknown>)())] });
    expect(await kept.app.send({ type: "lre.world", op: "list" })).toMatchObject({ type: "lre.error", code: "conflict", message: "Not yet." });
    expect(await kept.app.send({ type: "lre.world", op: "list" })).toMatchObject({ type: "lre.result", body: { worlds: [] } });
    expect(asked).toHaveLength(2);
    kept.stop();
  });

  test("a road failure is said as the road's, never coded as RPE's refusal, and is toasted; RPE's own refusal is said on the page, not toasted, held back by the request it answers", async () => {
    const reason = "RPE did not answer: the connection was refused.";
    const failing = keptApp({ client: { call: (async () => Promise.reject(new RpeError(0, reason))) as RpeClient["call"], ...quiet }, chat: createStore<string | null>(null), mode: "build", host: host(), timers: handTimers(), settings: () => SETTINGS });
    const failed = await failing.app.send({ type: "lre.job", op: "list", worldId: "w-fernwick" });
    expect(failed).toMatchObject({ type: "lre.error", message: reason });
    expect(failed.type === "lre.error" ? failed.code : "").not.toBe("unavailable");
    expect(await failing.app.request({ type: "lre.job", op: "list", worldId: "w-fernwick" })).toBeNull();
    expect(failing.app.toasts.get().map((t) => t.text)).toEqual([reason]);
    failing.stop();

    // RPE's `unavailable` for a request it does not serve is said on the page; another error with the very same words is toasted.
    const rpe = routeClient();
    const kept = keptApp({ client: { ...rpe.client, ...quiet }, chat: createStore<string | null>("c"), mode: "play", host: host(), timers: handTimers(), settings: () => SETTINGS });
    expect(await kept.app.request({ type: "lre.minds", op: "status", chatId: "c" })).toBeNull();
    const said = kept.said.get();
    expect(said).toHaveLength(1);
    expect(kept.app.toasts.get()).toEqual([]);
    kept.app.toast(said[0] as string, "error");
    expect(kept.app.toasts.get().map((t) => t.text)).toEqual([...said]);
    kept.stop();
  });

  test("the toasts' count and times are the page's settings, read at each toast", () => {
    const timers = handTimers();
    let settings: ToastSettings = SETTINGS;
    const kept = keptApp({ client: { call: (() => Promise.reject(new Error("no"))) as RpeClient["call"], ...quiet }, chat: createStore<string | null>(null), mode: "build", host: host(), timers, settings: () => settings });
    for (const text of ["one", "two", "three", "four"]) kept.app.toast(text);
    expect(kept.app.toasts.get().map((t) => t.text)).toEqual(["two", "three", "four"]);
    settings = { toastsShown: 1, errorToastMs: 100, toastMs: 200 };
    kept.app.toast("five", "error");
    expect(kept.app.toasts.get().map((t) => t.text)).toEqual(["five"]);
    timers.advance(99);
    expect(kept.app.toasts.get()).toHaveLength(1);
    timers.advance(1);
    expect(kept.app.toasts.get()).toEqual([]);
    kept.stop();
  });

  test("in Play, a change made at once is told where it was made, in RPE's words, with its Undo; a press held for the next message is not", async () => {
    const answers: unknown[] = [{ applied: true, pending: false, undo: "edit-1", said: "Done: Pay, on Marcus, $15.00." }, { staged: true }, { applied: true, pending: false, undo: "edit-2" }];
    const actions: CallFile = { name: "actions", takes: (request) => request.type === "lre.action", serve: async () => answers.shift() as never };
    const kept = keptApp({ client: { call: (() => Promise.reject(new Error("no"))) as RpeClient["call"], ...quiet }, chat: createStore<string | null>(null), mode: "play", host: host(), timers: handTimers(), settings: () => SETTINGS, calls: [actions] });
    const press = { type: "lre.action", chatId: "c1", action: "pay", params: {}, source: "palette" } as const;
    await kept.app.request(press);
    await kept.app.request(press);
    await kept.app.request(press);
    expect(kept.app.toasts.get().map((t) => [t.text, t.undo])).toEqual([
      ["Done: Pay, on Marcus, $15.00.", { chat: "c1", edit: "edit-1" }],
      [CHANGE_MADE, { chat: "c1", edit: "edit-2" }],
    ]);
    kept.stop();
  });

  test("the open chat's view follows the chat the page names", async () => {
    const chat = createStore<string | null>("c1");
    const read: string[] = [];
    const call = (async (key: string, params: { chat: string }) => {
      if (key === "GET /api/v1/chats/:chat/state") read.push(params.chat);
      return { status: "not_world" } as unknown;
    }) as RpeClient["call"];
    const kept = keptApp({ client: { call, ...quiet }, chat, mode: "build", host: host(), timers: handTimers(), settings: () => SETTINGS });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(kept.app.sync.get().chatId).toBe("c1");
    chat.set("c2");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect({ chat: kept.app.sync.get().chatId, read }).toEqual({ chat: "c2", read: ["c1", "c2"] });
    chat.set(null);
    expect(kept.app.sync.get()).toMatchObject({ chatId: null, view: null });
    kept.stop();
  });

  test("Show ids chosen on this device reaches every kept App at once, and stays chosen for the next one", () => {
    const kept = new Map<string, string>();
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } });
    try {
      const open = (): Kept => keptApp({ client: { call: (() => Promise.reject(new Error("no"))) as RpeClient["call"], ...quiet }, chat: createStore<string | null>(null), mode: "build", host: host(), timers: handTimers(), settings: () => SETTINGS });
      const first = open();
      expect(first.app.ui.get().showIds).toBe(false);
      expect(chooseShowIds(true)).toBe(true);
      expect(first.app.ui.get().showIds).toBe(true);
      expect(showIdsChosen()).toBe(true);
      const second = open();
      expect(second.app.ui.get().showIds).toBe(true);
      first.stop();
      chooseShowIds(false);
      expect(second.app.ui.get().showIds).toBe(false);
      expect(first.app.ui.get().showIds).toBe(true);
      second.stop();
    } finally {
      if (had === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", had);
    }
  });
});

