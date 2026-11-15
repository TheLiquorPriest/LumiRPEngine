// Where the Play page is in the shells: an entry of both shells' navigation for the chat in view, an
// address of its own in the web shell, and the way there from each chat the web shell's Chats page lists
// that the list does not say has no world.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ChatSummary } from "../../../../src/ui/api";
import { routeFor } from "../../../../src/ui/frame";
import { PAGES } from "../../../../src/ui/page-list";
import { ChatsView } from "../../../../src/ui/pages/chats";
import { hashOf, routeOfHash } from "../../../../src/ui/web";
import { openPage, type Page, type PageElement } from "../dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const words = (el: PageElement): string => el.textContent.replace(/\s+/g, " ").trim();

describe("the Play page in the shells", () => {
  test("is in both shells' navigation, for the chat in view, under an address of its own in the web shell", () => {
    expect(PAGES.find((item) => item.id === "play")).toMatchObject({ title: "Play", shells: ["web", "drawer"], needsChat: true });
    expect(routeFor("play", "chat-fernwick")).toEqual({ page: "play", chat: "chat-fernwick" });
    expect(hashOf({ page: "play", chat: "chat fernwick" })).toBe("#/chats/chat%20fernwick/play");
    expect(routeOfHash(hashOf({ page: "play", chat: "chat fernwick" }))).toEqual({ page: "play", chat: "chat fernwick" });
  });

  test("the Chats page offers Play beside each chat the list does not say has no world, and Play goes to that chat", async () => {
    const chats: ChatSummary[] = [
      { id: "chat-fernwick", name: "Fernwick", lastTurnAt: 1_700_000_000_000, running: false, played: true, world: true },
      { id: "chat-tea-room", name: "The tea room", lastTurnAt: 1_700_000_000_000, running: false, played: true, world: false },
      { id: "chat-old-road", name: "The old road", lastTurnAt: null, running: false, played: false, world: true },
    ];
    const played: string[] = [];
    const root = page.document.createElement("div");
    await act(() => {
      render(<ChatsView chats={chats} problem={null} onOpen={() => undefined} onPlay={(chat) => played.push(chat)} onRead={() => undefined} />, root as unknown as HTMLElement);
    });
    const rows = root.querySelectorAll("li");
    const plays = rows.map((row) => row.querySelectorAll("button").filter((b) => words(b) === "Play"));
    expect(plays.map((buttons) => buttons.length)).toEqual([1, 0, 1]);
    await act(() => plays[0]?.[0]?.click());
    await act(() => plays[2]?.[0]?.click());
    expect(played).toEqual(["chat-fernwick", "chat-old-road"]);
    await act(() => render(null, root as unknown as HTMLElement));
  });
});
