// The same act and the same text on the bed's pages (PlanScenarios-3 item 11): the bed's host plays Lumiverse's chat page with the one driver the rig shares, so what
// `show` and `scroll` do and the one way text is taken (`read()` and `Shot.text`) hold on a chat page as they hold on the rig's. A chat made up with the markup Lumiverse's
// source gives (`site.ts`) holds enough messages to run below the window at 390 px: words below the fold are not seen until `show` brings them into view and are seen after;
// "it scrolls" is seen after `scroll`; and `read()` and the screen's text of the same state are one text.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Chrome, launchChrome } from "../../../scripts/proof/browser/chrome";
import { BrowserDriver } from "../../../scripts/proof/browser/driver";
import { LIVE_NAME_OF, LUMIVERSE_CHAT, openLivePage } from "../../../scripts/proof/live/pages";
import { lookAt } from "../../../scripts/proof/route/evidence";
import type { Check, Sighting } from "../../../scripts/proof/route/form";
import { type Site, serveSite } from "./site";

let chrome: Chrome;
const sites: Site[] = [];

beforeAll(async () => {
  chrome = await launchChrome();
});

afterAll(async () => {
  for (const site of sites) site.stop();
  await chrome?.close();
});

/** A chat page of a site whose chat already holds `history`, opened at `width`. */
async function opened(history: string[], width: number): Promise<BrowserDriver> {
  const site = serveSite();
  site.chats.set("chat-1", { id: "chat-1", name: "A chat", character_id: "card-1" });
  site.history = history;
  sites.push(site);
  const options = { lumiverse: site.base, account: { username: "marlow", password: "brass and lamp oil" }, rpe: { base: "http://127.0.0.1:1", token: "none" }, chat: () => "chat-1", turn: () => null, shared: { cookies: null }, limitMs: 3000 };
  const tab = await BrowserDriver.create({ chrome, pages: { open: (page, t) => openLivePage(page, t, options), nameOf: LIVE_NAME_OF }, limitMs: 3000 });
  await tab.open(LUMIVERSE_CHAT, width);
  return tab;
}

/** Forty messages, each long enough to take two lines at 390 px, the last one the words a check looks for. */
const LONG_CHAT = [...Array.from({ length: 39 }, (_, i) => `Message ${i + 1}: the keeper's day goes on at the foot of the tower, and the gulls say nothing new about it.`), "Message 40: the bell rings at dusk, and the boat comes in."];

test("at 390 px the chat's last words, below the fold, are read but not seen until the act brings them into view, and are seen after", async () => {
  const tab = await opened(LONG_CHAT, 390);
  expect(await tab.read()).toContain("Message 40: the bell rings at dusk");
  expect((await tab.screen()).text).not.toContain("Message 40");

  const check: Check = async (look) => ((await look.read()).includes("the bell rings at dusk") ? { found: true, shows: ["Message 40: the bell rings at dusk"] } : { found: false, what: "no bell" });
  const unseen = await lookAt(tab, { page: LUMIVERSE_CHAT, check }, 390, () => "play-01/chat-390-bell.png");
  expect(unseen.found).toBe(true);
  expect(unseen.unshown).toContain('the screen does not show "Message 40: the bell rings at dusk"');

  const brought: Sighting = {
    page: LUMIVERSE_CHAT,
    check: async (look) => {
      await look.show({ text: "Message 40: the bell rings at dusk" });
      return await check(look);
    },
  };
  const seen = await lookAt(tab, brought, 390, () => "play-01/chat-390-bell.png");
  expect(seen.found).toBe(true);
  expect(seen.unshown).toBeNull();
  expect(seen.shotText).toContain("Message 40: the bell rings at dusk");
  expect(seen.shotPage).toBe(LUMIVERSE_CHAT);
  await expect(tab.show({ text: "Message 41: nothing" })).rejects.toThrow("never showed: Message 41: nothing");
  await tab.close();
}, 30_000);

test("it scrolls: a chat that runs past the window comes into view by one window at a time, and a page that holds no more says so", async () => {
  const tab = await opened(LONG_CHAT, 390);
  const before = (await tab.screen()).text;
  expect(before).not.toContain("Message 30");
  for (let flicks = 0; flicks < 12 && !(await tab.screen()).text.includes("Message 40"); flicks++) await tab.scroll();
  const after = (await tab.screen()).text;
  expect(after).toContain("Message 40");
  expect(after).not.toBe(before);
  await tab.close();

  const short = await opened([], 1440);
  await expect(short.scroll()).rejects.toThrow("does not scroll");
  await short.close();
}, 30_000);

test("read() and the Shot.text of the same page state are the one text on a chat page too, and words hidden by style are in neither", async () => {
  const tab = await opened(["Message 1: the keeper lights the lamp."], 1440);
  const read = await tab.read();
  const shot = await tab.screen();
  expect(shot.text).toBe(read);
  expect(read).toContain("Message 1: the keeper lights the lamp.");
  // The popups and the drawer the page keeps hidden are in neither; the composer's own words are in both.
  expect(read).not.toContain("Search connections");
  expect(read).not.toContain("Preset");
  expect(read).toContain("Send");
  await tab.close();
}, 30_000);
