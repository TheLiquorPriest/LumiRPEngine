// The Build page, as the shells' page switch shows it, drawn by Preact in a page of its own (dom.ts)
// against RPE's own Build route run in this process (bed.ts): it lists the worlds RPE keeps, opens one,
// sends an edit as today's `lre.editor` message and commits it, all through today's Build mode. On the
// world's home, RPE's word on Build's background tools, which this build of RPE does not serve, is said
// there, once, and not asked again. Leaving the page leaves nothing behind: no handler on the window or
// the document, no timer, no stylesheet, and nobody hearing the transport.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { act } from "preact/test-utils";
import { createStore } from "../../../src/ui/store";
import { AppContext, type Route, type UiApp } from "../../../src/ui/app";
import type { RpeClient } from "../../../src/ui/client";
import { PageFor } from "../../../src/ui/frame";
import { createGate } from "../../../src/ui/gate";
import { webHost } from "../../../src/ui/kept/host";
import { mountBuild } from "../../../src/ui/kept/page";
import { buildTransport } from "../../../src/ui/kept/transport";
import { counted, handTimers, type HandTimers, type RouteClient, routeClient, words as rpeWords } from "./bed";
import { openPage, type Page, PageElement, PageEvent } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

/**
 * Lets the page draw and RPE answer until `check` holds, as a person waits for the page. The waits are
 * real: RPE's write queue under the route takes its writes in slices of real time (test/build-mode/bed.ts).
 */
async function until(what: string, check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 400; tries++) {
    await act(() => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5);
      return promise;
    });
    if (check()) return;
  }
  throw new Error(`The page never showed ${what}.`);
}

const words = (el: PageElement): string => el.textContent.replace(/\s+/g, " ").trim();

/** The one enabled button that says `text`. */
function button(root: PageElement, text: string): PageElement {
  const found = root.querySelectorAll("button").filter((b) => words(b) === text && !b.disabled);
  const [only] = found;
  if (found.length !== 1 || only === undefined) throw new Error(`${found.length} buttons say “${text}”`);
  return only;
}

/** The messages the page sent RPE of one type and op, in order. */
function sent(rpe: RouteClient, type: string, op: string): Record<string, unknown>[] {
  return rpe.asked.flatMap(({ body }) => (body !== null && typeof body === "object" && "type" in body && "op" in body && body.type === type && body.op === op ? [body as Record<string, unknown>] : []));
}

/** Two worlds RPE keeps already, made from its starter templates; each one's id and head revision, by name. */
async function twoWorlds(rpe: RouteClient): Promise<Map<string, { worldId: string; head: string }>> {
  const made = new Map<string, { worldId: string; head: string }>();
  for (const name of ["Fernwick", "Mossbank"]) {
    const { result } = await rpe.client.call("POST /api/v1/build", {}, { body: { lre: 1, type: "lre.world", reqId: `made-${name}`, op: "create", name, template: "fantasy_town" } });
    if (result.type !== "lre.result" || result.request !== "lre.world" || !result.body.world || !result.body.revision) throw new Error(`RPE made no ${name}`);
    made.set(name, { worldId: result.body.world.id, head: result.body.revision });
  }
  return made;
}

function webApp(rpe: RouteClient, timers: HandTimers): UiApp {
  const route = createStore<Route>({ page: "build" });
  // The page calls only `call` of the client, the road to RPE's Build route.
  const client = rpe.client as RpeClient;
  return { shell: "web", client, gate: createGate(), route, timers, keptHost: webHost, go: (next) => route.set(next) };
}

describe("the Build page", () => {
  test("lists RPE's worlds, opens one, sends an edit as today's lre.editor message and commits it; leaving it leaves nothing behind", async () => {
    const rpe = routeClient();
    const fernwick = (await twoWorlds(rpe)).get("Fernwick");
    const timers = handTimers();
    const root = page.document.createElement("div");
    page.document.body.append(root);
    await act(() => {
      render(
        <AppContext.Provider value={webApp(rpe, timers)}>
          <PageFor route={{ page: "build" }} />
        </AppContext.Provider>,
        root as unknown as HTMLElement,
      );
    });
    const names = (): string[] => root.querySelectorAll(".lre-build-world-name").map(words);
    await until("the worlds", () => names().length === 2);
    expect(names().sort()).toEqual(["Fernwick", "Mossbank"]);
    expect(page.document.head.querySelectorAll("style")).toHaveLength(1);

    root
      .querySelectorAll(".lre-build-world-open")
      .find((b) => b.textContent.includes("Fernwick"))
      ?.click();
    await until("Fernwick's world bar", () => root.querySelector(".lre-build-bar-name")?.textContent === "Fernwick");
    const toolsWord = rpeWords("job");
    await until("RPE's word on the background tools", () => root.querySelector("[data-rpe-said]") !== null);
    expect(root.querySelectorAll("[data-rpe-said] .lre-banner").map(words)).toEqual([toolsWord]);
    expect(root.querySelectorAll(".lre-toast").map(words)).toEqual([]);

    const world = root.querySelectorAll("button.lre-listrow-hit").find((b) => b.querySelector(".lre-listrow-title")?.textContent === "World");
    world?.click();
    await until("the World part's form", () => root.querySelector('[data-lre-editor="part:meta"]') !== null);
    expect(root.querySelector("[data-rpe-said]")).toBeNull();
    const name = root.querySelectorAll('[data-lre-editor="part:meta"] input').find((input) => input.value === "Fernwick");
    if (name === undefined) throw new Error("no field holds the world's name");
    name.value = "Fernwick Vale";
    await act(() => {
      name.dispatchEvent(new PageEvent("input"));
    });
    await act(() => button(root, "Save to draft").click());
    await until("the draft's change", () => root.querySelector("[data-lre-draft]")?.getAttribute("data-lre-draft") === "changed");
    const [set] = sent(rpe, "lre.editor", "set");
    expect(set).toMatchObject({ lre: 1, type: "lre.editor", reqId: expect.any(String), worldId: fernwick?.worldId, base: fernwick?.head, version: 0, op: "set", part: "meta", value: { name: "Fernwick Vale" } });

    await act(() => button(root, "Commit").click());
    await until("the commit's toast", () => root.querySelectorAll(".lre-toast").some((t) => words(t) === "Committed a new revision."));
    expect(sent(rpe, "lre.world", "commit")).toEqual([{ lre: 1, type: "lre.world", reqId: expect.any(String), op: "commit", worldId: fernwick?.worldId, base: fernwick?.head, version: 1 }]);
    expect(root.querySelector("[data-lre-draft]")?.getAttribute("data-lre-draft")).toBe("committed");

    root
      .querySelectorAll("button")
      .find((b) => b.getAttribute("aria-label") === "Back to Fernwick Vale")
      ?.click();
    await until("the world's home again, with RPE's word on its tools", () => root.querySelector("[data-lre-world-home]") !== null && root.querySelector("[data-rpe-said]") !== null);
    expect({ said: root.querySelectorAll("[data-rpe-said] .lre-banner").map(words), asked: sent(rpe, "lre.job", "list").length }).toEqual({ said: [toolsWord], asked: 1 });

    await act(() => render(null, root as unknown as HTMLElement));
    const calls = rpe.asked.length;
    timers.advance(60_000);
    await until("nothing more", () => true);
    expect({ calls: rpe.asked.length, waiting: timers.waiting(), listening: page.listening(), styles: page.document.head.querySelectorAll("style").length, drawn: root.childNodes.length }).toEqual({ calls, waiting: 0, listening: 0, styles: 0, drawn: 0 });
  });

  test("while it shows, today's client hears the transport; once it is left, nobody does", async () => {
    const road = counted(buildTransport(routeClient().client));
    const root = page.document.createElement("div");
    let leave = (): void => undefined;
    await act(() => {
      leave = mountBuild(root as unknown as HTMLElement, { transport: road.transport, host: webHost(), timers: handTimers() });
    });
    await until("the worlds", () => root.querySelector("[data-lre-section=build]") !== null);
    expect(road.hearers()).toBe(1);
    await act(() => leave());
    expect({ hearers: road.hearers(), listening: page.listening() }).toEqual({ hearers: 0, listening: 0 });
  });
});
