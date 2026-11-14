// The App kept for Build, as today's setup makes it but over RPE's Build route: Build is where its UI
// starts, a request gives its result's body, and RPE's refusal shows as today's toast for as long as
// today's. A tool RPE does not serve (the background tools, lore, secrecy) is said once, on the Build
// page that asked for it, in RPE's own words, never as a toast, and not asked of RPE again; a road
// that failed is not RPE's word, and is asked again. Stopping it leaves nothing behind.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { BuildRoute } from "../../../src/frontend/app";
import type { RequestBody } from "../../../src/frontend/registry";
import type { RpeClient } from "../../../src/ui/client";
import { RpeError } from "../../../src/ui/client";
import { keptApp } from "../../../src/ui/kept/app";
import { webHost } from "../../../src/ui/kept/host";
import { buildTransport } from "../../../src/ui/kept/transport";
import { counted, handTimers, routeClient, words } from "./bed";
import { openPage, type Page } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

describe("the App kept for Build", () => {
  test("its UI starts in Build; a request gives its result's body, and RPE's refusal is today's toast, for as long as today's", async () => {
    const timers = handTimers();
    const host = webHost();
    const kept = keptApp({ transport: buildTransport(routeClient().client), host, timers });
    expect({ mode: kept.app.ui.get().mode, build: kept.app.ui.get().build }).toEqual({ mode: "build", build: { view: "worlds" } });

    const templates = await kept.app.request({ type: "lre.world", op: "templates" });
    expect(templates?.templates?.map((t) => t.id)).toContain("fantasy_town");
    const missing: RequestBody = { type: "lre.world", op: "get", worldId: "w-nowhere" };
    const refusal = await kept.app.send(missing);
    expect(refusal).toMatchObject({ type: "lre.error", code: "not_found" });
    expect(kept.app.toasts.get()).toEqual([]);
    expect(await kept.app.request({ type: "lre.world", op: "get", worldId: "w-nowhere" })).toBeNull();
    expect(kept.app.toasts.get()).toEqual([{ id: 1, text: refusal.type === "lre.error" ? refusal.message : "", tone: "error" }]);
    timers.advance(5999);
    expect(kept.app.toasts.get()).toHaveLength(1);
    timers.advance(1);
    expect(kept.app.toasts.get()).toEqual([]);
    kept.stop();
    host.dispose();
  });

  test("a tool RPE does not serve is said once on the page that asked, in RPE's words, never as a toast, and is not asked of RPE again", async () => {
    const rpe = routeClient();
    const host = webHost();
    const kept = keptApp({ transport: buildTransport(rpe.client), host, timers: handTimers() });
    const go = (build: BuildRoute): void => kept.app.ui.update((ui) => ({ ...ui, build }));
    const said = (): string[] => kept.said.get().map((answer) => answer.message);
    const asked = (type: string): number => rpe.asked.filter(({ body }) => body !== null && typeof body === "object" && "type" in body && body.type === type).length;
    const worldId = "w-fernwick";

    go({ view: "world", worldId });
    expect(await kept.app.request({ type: "lre.job", op: "list", worldId })).toBeNull();
    expect(await kept.app.request({ type: "lre.job", op: "list", worldId })).toBeNull();
    expect(said()).toEqual([words("job")]);

    go({ view: "secrecy", worldId });
    expect(said()).toEqual([]);
    expect(await kept.app.request({ type: "lre.secrecy", op: "books" })).toBeNull();
    expect(await kept.app.request({ type: "lre.lore", op: "books" })).toBeNull();
    expect(said()).toEqual([words("secrecy"), words("lore")]);

    go({ view: "world", worldId });
    expect(await kept.app.request({ type: "lre.job", op: "list", worldId })).toBeNull();
    expect(said()).toEqual([words("job")]);
    expect({ job: asked("lre.job"), secrecy: asked("lre.secrecy"), lore: asked("lre.lore"), toasts: kept.app.toasts.get() }).toEqual({ job: 1, secrecy: 1, lore: 1, toasts: [] });
    kept.stop();
    host.dispose();
  });

  test("a road that failed under a tool is not RPE's word: it is today's toast, and the tool is asked of RPE again", async () => {
    const reason = "RPE did not answer: the connection was refused.";
    let calls = 0;
    const call = async (): Promise<unknown> => {
      calls += 1;
      throw new RpeError(0, reason);
    };
    const host = webHost();
    const kept = keptApp({ transport: buildTransport({ call: call as RpeClient["call"] }), host, timers: handTimers() });
    expect(await kept.app.request({ type: "lre.job", op: "list", worldId: "w-fernwick" })).toBeNull();
    expect(await kept.app.request({ type: "lre.job", op: "list", worldId: "w-fernwick" })).toBeNull();
    expect({ calls, said: kept.said.get(), toasts: kept.app.toasts.get().map((t) => t.text) }).toEqual({ calls: 2, said: [], toasts: [reason, reason] });
    kept.stop();
    host.dispose();
  });

  test("stopping it leaves nothing behind: nobody hears the transport, no timer waits, and a request still out is answered", async () => {
    const timers = handTimers();
    const road = counted(buildTransport({ call: () => Promise.withResolvers<never>().promise }));
    const host = webHost();
    const kept = keptApp({ transport: road.transport, host, timers });
    const out = kept.app.send({ type: "lre.world", op: "list" });
    kept.app.toast("Committed a new revision.");
    expect({ hearers: road.hearers(), waiting: timers.waiting() > 0 }).toEqual({ hearers: 1, waiting: true });

    kept.stop();
    host.dispose();
    expect({ hearers: road.hearers(), waiting: timers.waiting(), listening: page.listening() }).toEqual({ hearers: 0, waiting: 0, listening: 0 });
    expect(await out).toMatchObject({ type: "lre.error", code: "unavailable" });
  });
});
