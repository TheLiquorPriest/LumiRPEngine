// The bed's steps on Lumiverse's chat page, on a site made up with the markup Lumiverse's source gives (`site.ts`):
// sign-in once for a run and carried to each window, the composer's connection chosen by typing its name, the
// persona and the preset chosen as a person chooses them, and the reply's moments noted by the page itself, in
// order, near the delays the site scripts. A step that cannot find its control stops, naming it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Chrome, launchChrome } from "../../../scripts/proof/browser/chrome";
import { BrowserDriver } from "../../../scripts/proof/browser/driver";
import { LIVE_NAME_OF, LUMIVERSE_CHAT, openLivePage, type Shared } from "../../../scripts/proof/live/pages";
import { ChatSteps } from "../../../scripts/proof/live/steps";
import { DEFAULT_SCRIPT, type Site, serveSite } from "./site";

let chrome: Chrome;
const sites: Site[] = [];

beforeAll(async () => {
  chrome = await launchChrome();
});

afterAll(async () => {
  for (const site of sites) site.stop();
  await chrome?.close();
});

async function window(site: Site, shared: Shared, limitMs = 10_000): Promise<BrowserDriver> {
  const options = { lumiverse: site.base, account: { username: "marlow", password: "brass and lamp oil" }, rpe: { base: "http://127.0.0.1:1", token: "none" }, chat: () => "chat-1", turn: () => null, shared, limitMs };
  return await BrowserDriver.create({ chrome, pages: { open: (page, tab) => openLivePage(page, tab, options), nameOf: LIVE_NAME_OF }, limitMs });
}

function site(script = DEFAULT_SCRIPT): Site {
  const made = serveSite(script);
  made.chats.set("chat-1", { id: "chat-1", name: "A chat", character_id: "card-1" });
  sites.push(made);
  return made;
}

test("Lumiverse is signed in to once for a run, as a person signs in, and every later window carries that sign-in", async () => {
  const s = site();
  const shared: Shared = { cookies: null };
  const first = await window(s, shared);
  await first.open(LUMIVERSE_CHAT, 1440);
  expect((await first.screen()).page).toBe(LUMIVERSE_CHAT);
  expect(s.signIns).toBe(1);
  const second = await window(s, shared);
  await second.open(LUMIVERSE_CHAT, 390);
  expect((await second.screen()).page).toBe(LUMIVERSE_CHAT);
  expect(s.signIns).toBe(1);
  await first.close();
  await second.close();
});

test("the connection, the persona and the preset are chosen on the page, and Send carries them with the line typed", async () => {
  const s = site();
  const tab = await window(s, { cookies: null });
  await tab.open(LUMIVERSE_CHAT, 1440);
  const steps = new ChatSteps(tab);
  await steps.chooseConnection("RPE lamp");
  await steps.choosePersona("The traveller");
  await steps.choosePreset("Floor preset");
  await steps.send("I climb the stairs to the lamp room.", 10_000);
  expect(s.sent).toEqual([{ text: "I climb the stairs to the lamp room.", connection: "RPE lamp", persona: "The traveller", preset: "Floor preset" }]);
  // A connection already chosen is not chosen again.
  await steps.chooseConnection("RPE lamp");
  await tab.close();
});

test("the page's own moments come in order, near the delays the page was scripted with", async () => {
  const s = site();
  const tab = await window(s, { cookies: null });
  await tab.open(LUMIVERSE_CHAT, 1440);
  const steps = new ChatSteps(tab);
  const moments = await steps.send("Is the boat in?", 10_000);
  const { begin, firstWord, words, gap } = s.script;
  expect(moments.firstThinking).not.toBeNull();
  expect(moments.firstWord).not.toBeNull();
  expect(moments.lastWord).not.toBeNull();
  expect(moments.ended).not.toBeNull();
  const [thinking, first, last, ended] = [moments.firstThinking ?? 0, moments.firstWord ?? 0, moments.lastWord ?? 0, moments.ended ?? 0];
  expect(moments.sent).toBeLessThan(thinking);
  expect(thinking).toBeLessThan(first);
  expect(first).toBeLessThan(last);
  expect(last).toBeLessThanOrEqual(ended);
  // Timers do not fire early: the first word is no sooner than the page's own delays to it.
  expect(first - moments.sent).toBeGreaterThanOrEqual(begin + firstWord - 15);
  expect(last - first).toBeGreaterThanOrEqual((words.length - 1) * gap - 15);
  expect(ended - last).toBeGreaterThanOrEqual(10);
  expect(moments.resolution).toBeGreaterThan(0);
  expect(moments.resolution).toBeLessThanOrEqual(1);
  await tab.close();
});

test("a reply with no reasoning has no first thinking, and a reply that never begins is an error naming that", async () => {
  const quiet = site({ ...DEFAULT_SCRIPT, thinking: null });
  const tab = await window(quiet, { cookies: null });
  await tab.open(LUMIVERSE_CHAT, 1440);
  const moments = await new ChatSteps(tab).send("Hello?", 10_000);
  expect(moments.firstThinking).toBeNull();
  expect(moments.firstWord).not.toBeNull();
  await tab.close();

  const stalled = site({ ...DEFAULT_SCRIPT, begin: 60_000 });
  const second = await window(stalled, { cookies: null });
  await second.open(LUMIVERSE_CHAT, 1440);
  await expect(new ChatSteps(second).send("Hello?", 600)).rejects.toThrow("never began within 600 ms");
  await second.close();
});

test("a step that cannot find its control stops, naming it", async () => {
  const s = site();
  // A control a person cannot find is waited for as long as the host's limit, which this test keeps short.
  const tab = await window(s, { cookies: null }, 2000);
  await tab.open(LUMIVERSE_CHAT, 1440);
  const steps = new ChatSteps(tab);
  await expect(steps.chooseConnection("No such connection")).rejects.toThrow("No such connection");
  await expect(steps.choosePersona("Nobody")).rejects.toThrow("Nobody");
  await expect(steps.choosePreset("No such preset")).rejects.toThrow("no menu with a preset named No such preset");
  await tab.close();
}, 30_000);
