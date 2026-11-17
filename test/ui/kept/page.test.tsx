// The Build page, as the shells' page switch shows it, drawn by Preact in a page of its own (dom.ts)
// against RPE's own Build route run in this process (bed.ts): it lists the worlds RPE keeps, opens one,
// sends an edit as today's `lre.editor` message and commits it, all through today's Build mode. On the
// world's home, Build's background tools list their jobs from RPE's job routes and no banner shows. Leaving the page leaves nothing behind: no handler on the window or
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
import { createStore as storeOf } from "../../../src/ui/store";
import { counted, handTimers, type HandTimers, type RouteClient, routeClient } from "./bed";
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

/** Two worlds RPE keeps already, made from its starter templates; each one's id and head revision, by name. */
async function twoWorlds(rpe: RouteClient): Promise<Map<string, { worldId: string; head: string }>> {
  const made = new Map<string, { worldId: string; head: string }>();
  for (const name of ["Fernwick", "Mossbank"]) {
    const created = await rpe.client.call("POST /api/v1/worlds", {}, { body: { name, template: "fantasy_town" } });
    made.set(name, { worldId: (created.world as { id: string }).id, head: created.revision });
  }
  return made;
}

function webApp(rpe: RouteClient, timers: HandTimers): UiApp {
  const route = createStore<Route>({ page: "build" });
  // The page asks `call` of the client, the road to RPE's Build route, and follows the user's own channel, which says nothing here.
  const client = { ...rpe.client, follow: () => () => undefined } as unknown as RpeClient;
  return { shell: "web", client, gate: createGate(), route, timers, keptHost: () => webHost({ revokeMs: () => 1000 }), go: (next) => route.set(next) };
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
    await until("the Tools list's jobs asked of RPE", () => rpe.asked.some((a) => a.key === "GET /api/v1/build/jobs"));
    expect(root.querySelector("[data-rpe-said]")).toBeNull();
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
    const set = rpe.asked.find((a) => a.key === "PUT /api/v1/worlds/:world/draft/parts/:part")?.body;
    expect(set).toMatchObject({ base: fernwick?.head, version: 0, value: { name: "Fernwick Vale" } });

    await act(() => button(root, "Commit").click());
    await until("the commit's toast", () => root.querySelectorAll(".lre-toast").some((t) => words(t) === "Committed a new revision."));
    expect(rpe.asked.filter((a) => a.key === "POST /api/v1/worlds/:world/commit").map((a) => a.body)).toEqual([{ base: fernwick?.head, version: 1 }]);
    expect(root.querySelector("[data-lre-draft]")?.getAttribute("data-lre-draft")).toBe("committed");

    root
      .querySelectorAll("button")
      .find((b) => b.getAttribute("aria-label") === "Back to Fernwick Vale")
      ?.click();
    await until("the world's home again", () => root.querySelector("[data-lre-world-home]") !== null);
    expect({ said: root.querySelectorAll("[data-rpe-said]").length, asked: rpe.asked.filter((a) => a.key === "GET /api/v1/build/jobs").length >= 2 }).toEqual({ said: 0, asked: true });

    await act(() => render(null, root as unknown as HTMLElement));
    const calls = rpe.asked.length;
    timers.advance(60_000);
    await until("nothing more", () => true);
    expect({ calls: rpe.asked.length, waiting: timers.waiting(), listening: page.listening(), styles: page.document.head.querySelectorAll("style").length, drawn: root.childNodes.length }).toEqual({ calls, waiting: 0, listening: 0, styles: 0, drawn: 0 });
  });

  test("while it shows, today's client hears the page's client; once it is left, nobody does", async () => {
    const root = page.document.createElement("div");
    let leave = (): void => undefined;
    await act(() => {
      leave = mountBuild(root as unknown as HTMLElement, { client: { ...routeClient().client, follow: () => () => undefined }, chat: storeOf<string | null>(null), host: webHost({ revokeMs: () => 1000 }), timers: handTimers(), settings: () => ({ toastsShown: 3, errorToastMs: 6000, toastMs: 3500 }), open: () => undefined });
    });
    await until("the worlds", () => root.querySelector("[data-lre-section=build]") !== null);
    await act(() => leave());
    expect({ listening: page.listening() }).toEqual({ listening: 0 });
  });
});
