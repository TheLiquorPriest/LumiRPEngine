// The composer's two controls (src/ui/chat/surfaces/composer.tsx): they offer what the shipped files list
// (none of it in code), choosing a depth sends one ask and it shows as set until RPE says the turn took it,
// and a swipe's mode and feedback go in one ask.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { LiveEvent, RequestShown } from "../../../src/shared/api";
import { choicesOf } from "../../../src/ui/chat/choices";
import { chatOfScope, Composer } from "../../../src/ui/chat/surfaces/composer";
import type { FrameEnv } from "../../../src/ui/chat/surface";
import type { LiveListener, RpeClient } from "../../../src/ui/client";
import { createStore } from "../../../src/ui/store";
import { createUiSettings } from "../../../src/ui/ui-settings";
import { openPage, type Page, type PageElement, PageEvent } from "../kept/dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const TURN = "---\ndepths:\n  direct: no look-up, ruling or invention\n  assisted: one look-up, then write\n  deep: several minds\n---\n# How a turn is run\n";
const SWIPE = "---\nmodes:\n  another-telling: the same outcomes, told differently\n  afresh: the turn run again\n---\n# Swipe\n";

function recorded(): { env: FrameEnv; posted: unknown[]; deleted: string[]; publish(events: Pick<LiveEvent, "kind">[]): void } {
  const posted: unknown[] = [];
  const deleted: string[] = [];
  let waiting: RequestShown[] = [];
  const listeners = new Set<LiveListener>();
  const call = async (key: string, params: Record<string, string>, options?: { body?: unknown }): Promise<unknown> => {
    if (key === "GET /api/v1/files/*") return { text: params["*"] === "TURN.md" ? TURN : SWIPE };
    if (key === "GET /api/v1/chats/:chat/requests") return { requests: waiting };
    if (key === "POST /api/v1/chats/:chat/requests") {
      posted.push(options?.body);
      const body = options?.body as { kind: "depth" | "swipe"; choice: string; words?: string };
      const request = { id: `q${posted.length}`, chat: "c1", kind: body.kind, asked: { choice: body.choice, words: body.words ?? null }, played: false, message: null, turn: null, at: 1 } as RequestShown;
      waiting = [...waiting.filter((r) => r.kind !== body.kind), request];
      return { request };
    }
    if (key === "DELETE /api/v1/chats/:chat/requests/:request") {
      deleted.push(params.request as string);
      waiting = waiting.filter((r) => r.id !== params.request);
      return { withdrawn: true };
    }
    throw new Error(`No route ${key}.`);
  };
  const client = {
    call,
    follow(_chat: string, listener: LiveListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RpeClient;
  const env: FrameEnv = { client, chat: createStore<string | null>("c1"), open: () => undefined, settings: createUiSettings(null), timers: { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined }, host: {} as FrameEnv["host"] };
  return {
    env,
    posted,
    deleted,
    publish(events) {
      waiting = [];
      for (const listener of listeners) listener.events(events.map((event, at) => ({ chat: "c1", seq: at + 1, at, data: {}, ...event }) as LiveEvent), null);
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((done) => setTimeout(done, 1));
  });
}

const words = (el: PageElement | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the composer's controls", () => {
  test("the choices are what the files list, in their order; the chat is the anchor's own", () => {
    expect(choicesOf(TURN, "depths").map((c) => c.name)).toEqual(["direct", "assisted", "deep"]);
    expect(choicesOf(SWIPE, "modes")).toEqual([
      { name: "another-telling", about: "the same outcomes, told differently" },
      { name: "afresh", about: "the turn run again" },
    ]);
    expect(choicesOf("# no front matter", "depths")).toEqual([]);
    expect(chatOfScope("chat:c-9:input-tools-right")).toBe("c-9");
    expect(chatOfScope("message:m1:bubble:body-after")).toBeNull();
  });

  test("choosing a depth sends one ask and shows it set, until RPE says the turn took it; a depth the file adds is offered; a swipe's mode and feedback go in one ask", async () => {
    const rpe = recorded();
    const root = page.document.createElement("div");
    page.document.body.append(root);
    await act(() => render(<Composer env={rpe.env} chat="c1" />, root as unknown as HTMLElement));
    await settle();
    const press = async (el: PageElement | undefined): Promise<void> => {
      if (el === undefined) throw new Error("no such control");
      await act(() => el.click());
      await settle();
    };
    const button = (label: string): PageElement | undefined => root.querySelectorAll("button").find((b) => words(b) === label || b.getAttribute("aria-label") === label);
    const option = (name: string): PageElement | undefined => root.querySelectorAll('[role="radio"]').find((b) => words(b.querySelector(".rpe-chat-opt-name")) === name);

    await press(button("Depth for the next message"));
    expect(root.querySelectorAll('[role="radio"]').map((b) => words(b.querySelector(".rpe-chat-opt-name")))).toEqual(["None", "direct", "assisted", "deep"]);
    await press(option("assisted"));
    expect(rpe.posted).toEqual([{ kind: "depth", choice: "assisted" }]);
    expect(button("Depth for the next message: assisted")).toBeDefined();

    rpe.publish([{ kind: "requests" }]);
    await settle();
    expect(button("Depth for the next message")).toBeDefined();

    await press(button("How the next swipe is played"));
    await press(option("afresh"));
    const feedback = root.querySelectorAll("textarea")[0];
    if (feedback === undefined) throw new Error("no feedback field");
    feedback.value = "Too slow to start.";
    await act(() => {
      feedback.dispatchEvent(new PageEvent("input"));
    });
    await press(button("Set for the next swipe"));
    expect(rpe.posted.at(-1)).toEqual({ kind: "swipe", choice: "afresh", words: "Too slow to start." });
    expect(rpe.posted).toHaveLength(2);
    await act(() => render(null, root as unknown as HTMLElement));
  });
});
