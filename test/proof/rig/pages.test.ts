// RPE's real pages in the rig (PlanScenarios-2 item 1): the rig's footing serves the web shell built from
// today's sources, and in a real browser the shell, signed in as a person signs in (the web UI's token
// typed into its field), lists the stand-in's chat by its name once a turn was played in it, and shows
// that chat's Live page at both widths.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { scriptedModel } from "rp-harness/testing/rig";
import { type Chrome, launchChrome } from "../../../scripts/proof/browser/chrome";
import { BrowserDriver } from "../../../scripts/proof/browser/driver";
import { openRigBed, RIG_CHAT, RIG_CHAT_NAME, RIG_PRESET, RIG_RPE_CONNECTION, type RigBed } from "../../../scripts/proof/rig/bed";
import { openWebPage, WEB_NAME_OF } from "../../../scripts/proof/browser/web-shell";
import { builtUi } from "../../../scripts/proof/rig/ui";

let chrome: Chrome;
let bed: RigBed;

beforeAll(async () => {
  chrome = await launchChrome();
  const model = scriptedModel([{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>Wren looks up from the brass.</reply>" }] }], { contextWindow: 64_000, maxTokens: 4_000 });
  bed = await openRigBed({ models: { agentModel: async () => model.agentModel("off") }, ui: await builtUi() });
  bed.host.send(RIG_CHAT, "I climb to the lamp room.");
  const out = await bed.host.generate({ chat: RIG_CHAT, connection: RIG_RPE_CONNECTION, preset: RIG_PRESET });
  if (out.error !== null) throw new Error(`the rig's scripted turn failed: ${out.error}`);
  await bed.until("the turn's run to be over", () => bed.turns.runs.ofChat("user-marlow", RIG_CHAT).length === 0);
}, 60_000);

afterAll(async () => {
  await bed?.close();
  await chrome?.close();
});

async function driver(): Promise<BrowserDriver> {
  const options = { base: bed.listening.url, token: bed.webToken, chat: () => RIG_CHAT, turn: () => null, limitMs: 15_000 };
  return await BrowserDriver.create({ chrome, pages: { open: (page, tab) => openWebPage(page, tab, options), nameOf: WEB_NAME_OF }, limitMs: 15_000 });
}

test("the web shell the rig serves lists the stand-in's chat by its name", async () => {
  const tab = await driver();
  await tab.open("Chats", 1440);
  await tab.waitFor({ text: RIG_CHAT_NAME });
  const shot = await tab.screen();
  expect(shot.page).toBe("Chats");
  expect(shot.text).toContain(RIG_CHAT_NAME);
  await tab.close();
});

test("the chat's Live page shows at 390 and at 1440, each named by its own heading", async () => {
  const tab = await driver();
  for (const width of [390, 1440]) {
    await tab.open("Live", width);
    const shot = await tab.screen();
    expect(shot.page).toBe("Live");
    expect(shot.width).toBe(width);
    expect(shot.image.length).toBeGreaterThan(1000);
  }
  await tab.close();
});

test("a page the shell does not have is refused naming it", async () => {
  const tab = await driver();
  await expect(tab.open("Nowhere", 390)).rejects.toThrow("the web shell has no page named Nowhere");
  await tab.close();
});
