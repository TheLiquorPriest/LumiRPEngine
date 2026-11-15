// The Live page, drawn as a browser would draw it, on a turn whose run has an id of its own (RPH names each run of a turn so, the
// turn in its records' scope): Stop stops that run's turn, and the link to its page opens that turn, each named by the turn's id.

import { describe, expect, test } from "bun:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { type Route, AppContext, type UiApp } from "../../src/ui/app";
import type { LiveListener, RpeClient } from "../../src/ui/client";
import { createGate } from "../../src/ui/gate";
import { LivePage } from "../../src/ui/pages/live";
import { PAGE_DEFAULTS } from "../../src/shared/page-settings";
import type { Timers } from "../../src/ui/roads";
import { settle } from "./asking";
import { openPage, type PageElement } from "./kept/dom";
import { CHAT, RECORDED, RUN, underRun } from "./recorded";

describe("the Live page on a run with an id of its own", () => {
  test("Stop is sent for the run's turn, and its page is opened by the turn", async () => {
    const page = openPage();
    try {
      const asked: { key: string; params: Readonly<Record<string, string>> }[] = [];
      let listener: LiveListener | null = null;
      const client = {
        call: ((key: string, params: Readonly<Record<string, string>>) => {
          asked.push({ key, params });
          if (key === "GET /api/v1/chats/:chat/turns") return Promise.resolve({ turns: [], more: false });
          if (key === "POST /api/v1/chats/:chat/turns/:turn/stop") return Promise.resolve({ stopped: true });
          return Promise.reject(new Error(`not asked here: ${key}`));
        }) as RpeClient["call"],
        follow: ((_chat: string, l: LiveListener) => {
          listener = l;
          return () => undefined;
        }) as RpeClient["follow"],
      };
      let now = 0;
      const due: (() => void)[] = [];
      const timers: Timers = {
        now: () => now,
        setTimeout: (run: () => void) => due.push(run),
        clearTimeout: () => undefined,
      };
      const gone: Route[] = [];
      const app = { client, gate: createGate(), timers, go: (route: Route) => gone.push(route) } as unknown as UiApp;
      const events = underRun(RECORDED, "run-31a");
      const hear = async (from: number, to?: number): Promise<void> => {
        await act(() => {
          listener?.events(events.slice(from, to), null);
          now += PAGE_DEFAULTS.redrawMs;
          for (const run of due.splice(0)) run();
        });
      };
      const button = (root: PageElement, words: string): PageElement => root.querySelectorAll("button").find((b) => b.textContent.trim() === words) as PageElement;

      const root = page.document.createElement("div") as PageElement;
      await act(() => {
        render(h(AppContext.Provider, { value: app }, h(LivePage, { chat: CHAT })), root as unknown as HTMLElement);
      });
      await act(() => settle());
      // Midway through the run, Stop.
      await hear(0, 54);
      expect(root.textContent).toContain("Running now");
      await act(() => button(root, "Stop").click());
      expect(asked.filter((a) => a.key.startsWith("POST"))).toEqual([{ key: "POST /api/v1/chats/:chat/turns/:turn/stop", params: { chat: CHAT, turn: RUN } }]);
      // Once it has ended, its page.
      await hear(54);
      await act(() => button(root, "Its page").click());
      expect(gone).toEqual([{ page: "turns", chat: CHAT, at: [RUN] }]);
      await act(() => render(null, root as unknown as HTMLElement));
    } finally {
      page.close();
    }
  });
});
