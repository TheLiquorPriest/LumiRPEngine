// What the Play page's page tests share: the page as the shells' page switch shows it, in a fresh root
// of the test's own page (../dom.ts), on whatever RPE the test gives; the shell's route, so a test can
// see where the page sent it; and the ways a test waits for, reads and presses what the page shows.

import { render } from "preact";
import { act } from "preact/test-utils";
import { createStore } from "../../../../src/ui/store";
import { AppContext, type Route, type UiApp } from "../../../../src/ui/app";
import type { RpeClient } from "../../../../src/ui/client";
import { PageFor } from "../../../../src/ui/frame";
import { createGate } from "../../../../src/ui/gate";
import { webHost } from "../../../../src/ui/kept/host";
import type { HandTimers } from "../bed";
import type { PageDocument, PageElement } from "../dom";

/**
 * Lets the page draw and RPE answer until `check` holds. RPE's own handlers write through the write queue, whose slices wait on a real
 * timer, so each try also lets a moment pass.
 */
export async function until(what: string, check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((done) => setTimeout(done, 1));
    });
    if (check()) return;
  }
  throw new Error(`The page never showed ${what}.`);
}

export const words = (el: PageElement | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The one enabled button in `root` that says `text`. */
export function button(root: PageElement, text: string): PageElement {
  const found = root.querySelectorAll("button").filter((b) => words(b) === text && !b.disabled);
  const [only] = found;
  if (found.length !== 1 || only === undefined) throw new Error(`${found.length} buttons say “${text}”`);
  return only;
}

/** What the page says once, above the panels. */
export function said(root: PageElement): string[] {
  return root.querySelectorAll("[data-rpe-said] .lre-banner").map(words);
}

export interface Opened {
  root: PageElement;
  /** Where the shell is now: the Play page's own route, until the page sends it elsewhere. */
  route: () => Route;
}

/** The Play page for `chat` in a fresh root of `document`, as the web shell's page switch shows it, over `client` (the page calls only `call` and `follow`). */
export async function openPlay(document: PageDocument, client: Pick<RpeClient, "call" | "follow">, timers: HandTimers, chat: string): Promise<Opened> {
  const root = document.createElement("div");
  document.body.append(root);
  const route = createStore<Route>({ page: "play", chat });
  const app: UiApp = { shell: "web", client: client as RpeClient, gate: createGate(), route, timers, keptHost: () => webHost({ revokeMs: () => 1000 }), go: (next) => route.set(next) };
  await act(() => {
    render(
      <AppContext.Provider value={app}>
        <PageFor route={{ page: "play", chat }} />
      </AppContext.Provider>,
      root as unknown as HTMLElement,
    );
  });
  return { root, route: () => route.get() };
}

export async function leave(root: PageElement): Promise<void> {
  await act(() => render(null, root as unknown as HTMLElement));
  root.remove();
}
