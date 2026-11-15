// Lumiverse's chat page as the rig has it (PlanScenarios-2 items 7 and 8), over the network door, in a real browser, played
// with the bed's own steps: it signs in as a person does, shows the chat and is ready once its socket is let in; the
// composer's connection, the persona and the preset are chosen by name and carried to the generation; the reply's moments are
// the page's own, in order, and follow the delays of the reply it was told; Stop stops it. What stands behind the door here is
// a Lumiverse made up for the test (`backend.ts`), because the stand-in does not yet serve the routes the page calls
// (`standInGaps`); the page, the door, the driver and the steps are the real ones. `floor-acts.test.ts` plays the same page on
// the stand-in itself as soon as the stand-in serves them.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Chrome, launchChrome } from "../../../scripts/proof/browser/chrome";
import { BrowserDriver } from "../../../scripts/proof/browser/driver";
import { LIVE_NAME_OF, LUMIVERSE_CHAT, type Shared } from "../../../scripts/proof/live/pages";
import { ChatSteps } from "../../../scripts/proof/live/steps";
import { rigPages } from "../../../scripts/proof/rig/chat-page";
import { type Door, openDoor } from "../../../scripts/proof/rig/door";
import { openRigPage } from "../../../scripts/proof/rig/host";
import { madeLumiverse, type Made, MADE_CHAT, REPLY } from "./backend";

let chrome: Chrome;
let made: Made;
let door: Door;

beforeAll(async () => {
  chrome = await launchChrome();
  made = madeLumiverse();
  door = openDoor(made, rigPages);
});

afterAll(async () => {
  made.stop();
  await door?.stop();
  await chrome?.close();
});

/** A window on Lumiverse's chat page, signed in as the player signs in. */
async function player(): Promise<{ page: BrowserDriver; steps: ChatSteps }> {
  const shared: Shared = { cookies: null };
  const pages = { open: (name: string, tab: Parameters<typeof openRigPage>[1]) => openRigPage(name, tab, { door: door.base, account: { username: "marlow", password: "brass and lamp oil" }, rpe: { base: "http://127.0.0.1:1", token: "none" }, chat: () => MADE_CHAT, turn: () => null, shared, limitMs: 15_000 }), nameOf: LIVE_NAME_OF };
  const page = await BrowserDriver.create({ chrome, pages, limitMs: 15_000 });
  await page.open(LUMIVERSE_CHAT, 1440);
  return { page, steps: new ChatSteps(page) };
}

test("the page signs in as a person does, shows the chat's messages, and is ready once its event socket says it shows this chat", async () => {
  made.focused.length = 0;
  const { page } = await player();
  expect(await page.read()).toContain("The lamp turns above you; the sea is loud tonight.");
  expect(await page.evaluate<string[]>("window.__rig.frames")).toContain("CONNECTED");
  // Signing in sends the page on and back, so the chat page loads more than once: each time it says it shows this chat, and no other.
  expect(made.focused.length).toBeGreaterThan(0);
  expect(made.focused.every((chat) => chat === MADE_CHAT)).toBe(true);
  await page.close();
}, 60_000);

test("the connection, persona and preset chosen by name are carried to the generation, and the reply's moments come back from the page in order", async () => {
  made.started.length = 0;
  made.appended.length = 0;
  made.reply = REPLY;
  const { page, steps } = await player();
  await steps.choosePreset("Lamp");
  await steps.choosePersona("The traveller");
  await steps.chooseConnection("RPE lamp");
  const moments = await steps.send("I climb to the lamp room.", 15_000);
  expect(made.appended).toEqual([{ name: "The traveller", content: "I climb to the lamp room." }]);
  expect(made.started).toEqual([{ chat_id: MADE_CHAT, connection_id: "conn-rpe", persona_id: "pers-traveller", preset_id: "pre-lamp" }]);
  expect(moments.firstThinking).not.toBeNull();
  expect(moments.firstWord).not.toBeNull();
  expect(moments.lastWord).not.toBeNull();
  expect(moments.ended).not.toBeNull();
  expect(moments.sent).toBeLessThan(moments.firstThinking ?? 0);
  expect(moments.firstThinking ?? 0).toBeLessThan(moments.firstWord ?? 0);
  expect(moments.firstWord ?? 0).toBeLessThan(moments.lastWord ?? 0);
  expect(moments.lastWord ?? 0).toBeLessThanOrEqual(moments.ended ?? 0);
  // The page showed the reply as the tokens told it, and counted them.
  expect(await page.evaluate<number>("window.__rig.tokens")).toBe(REPLY.words.length);
  expect(await page.evaluate<number>("window.__rig.reasoningTokens")).toBe(1);
  expect(await page.read()).toContain("The lamp turns above you.");
  await page.close();
}, 60_000);

test("a reply's delays come back from the page's own clock between its moments, within what the page and the network add", async () => {
  const delays = { firstThinking: 120, firstWord: 340, between: 70, end: 50, words: ["One", "two", "three", "four", "five"] };
  made.reply = delays;
  const { page, steps } = await player();
  await steps.chooseConnection("RPE lamp");
  const moments = await steps.send("Go on.", 15_000);
  const slack = 70 + 3 * moments.resolution;
  const between = (to: number | null, from: number | null): number => (to ?? NaN) - (from ?? NaN);
  expect(Math.abs(between(moments.firstWord, moments.firstThinking) - (delays.firstWord - delays.firstThinking))).toBeLessThan(slack);
  expect(Math.abs(between(moments.lastWord, moments.firstWord) - 4 * delays.between)).toBeLessThan(slack);
  // Send to the first word is the delay and the two requests the page makes before it.
  expect(between(moments.firstWord, moments.sent)).toBeGreaterThanOrEqual(delays.firstWord);
  expect(between(moments.firstWord, moments.sent)).toBeLessThan(delays.firstWord + 4 * slack);
  expect(moments.resolution).toBeGreaterThan(0);
  await page.close();
}, 60_000);

test("while a reply streams the composer's button is Stop, and pressing it stops the generation and gives Send back", async () => {
  made.stopped = 0;
  made.reply = { firstThinking: null, firstWord: 100, between: 120, end: 20, words: Array.from({ length: 30 }, (_, i) => `w${i}`) };
  const { page } = await player();
  await page.type({ label: "Message" }, "Hold on.");
  await page.press({ role: "button", label: "Send message" });
  await page.waitFor({ control: { label: "Stop generation" } });
  await page.press({ role: "button", label: "Stop generation" });
  await page.waitFor({ control: { label: "Send message" } });
  expect(made.stopped).toBe(1);
  await page.close();
}, 60_000);
