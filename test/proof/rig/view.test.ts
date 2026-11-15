// The act by which a check brings a part into the saved image, and the one way text is taken
// (PlanScenarios-2 item 10; `scripts/proof/route/host.ts`, `Browser` and `Shot`), in a real browser on
// pages made up for it (`local.ts`): at 390 px, words below the fold are not seen until `show` brings
// them into the window, and are seen after; "it scrolls" is seen after `scroll`, and a page that cannot
// scroll says so; `read()` and a screen's `Shot.text` are the one function, so they are equal for one
// page state, and a word hidden by style is in neither; words clipped or covered are in what a check
// reads and not in what a screen shows, as the contract says.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Chrome, launchChrome } from "../../../scripts/proof/browser/chrome";
import { BrowserDriver } from "../../../scripts/proof/browser/driver";
import { lookAt } from "../../../scripts/proof/route/evidence";
import type { Sighting } from "../../../scripts/proof/route/form";
import { serveSite, sitePages } from "./local";

let chrome: Chrome;
let site: { base: string; stop(): void };

beforeAll(async () => {
  site = serveSite();
  chrome = await launchChrome();
});

afterAll(async () => {
  await chrome?.close();
  site?.stop();
});

async function driver(limitMs = 1500): Promise<BrowserDriver> {
  return await BrowserDriver.create({ chrome, pages: sitePages(site.base), limitMs });
}

test("the browser says what it is, and a page's name on a screen is the page's own", async () => {
  expect(chrome.name).toMatch(/chrome|chromium/i);
  expect(chrome.version).toMatch(/^\d+\./);
  const tab = await driver();
  await tab.open("Live", 390);
  const shot = await tab.screen();
  expect(shot.page).toBe("Live");
  expect(shot.width).toBe(390);
  expect(shot.format).toBe("png");
  expect(shot.image.length).toBeGreaterThan(1000);
  await tab.close();
});

test("at 390 px, words below the fold are not seen until the act brings them into view, and are seen after", async () => {
  const tab = await driver();
  await tab.open("Live", 390);
  // The check reads the page and finds the words; the window does not show them.
  expect(await tab.read()).toContain("belowfold words: the bell rings at dusk");
  expect((await tab.screen()).text).not.toContain("belowfold words");

  const sighting: Sighting = { page: "Live", check: async (look) => ((await look.read()).includes("belowfold words") ? { found: true, shows: ["belowfold words: the bell rings at dusk"] } : { found: false, what: "no bell" }) };
  // A check that names the words and does not bring them into view: found, and no screen shows it.
  const saved: string[] = [];
  const unseen = await lookAt(tab, sighting, 390, (shot) => (saved.push(shot.text), `play-01/live-390-bell.png`));
  expect(unseen.found).toBe(true);
  expect(unseen.unshown).toContain('the screen does not show "belowfold words: the bell rings at dusk"');

  // The same check, bringing them into the window first: the screen shows them.
  const brought: Sighting = {
    page: "Live",
    check: async (look) => {
      await look.show({ text: "belowfold words: the bell rings at dusk" });
      return await sighting.check(look);
    },
  };
  const seen = await lookAt(tab, brought, 390, () => "play-01/live-390-bell.png");
  expect(seen.found).toBe(true);
  expect(seen.unshown).toBeNull();
  expect(seen.shotText).toContain("belowfold words: the bell rings at dusk");

  // Words that never show: the act rejects, naming them.
  await expect(tab.show({ text: "no such words anywhere" })).rejects.toThrow("never showed: no such words anywhere");
  await tab.close();
});

test("it scrolls: a page that holds more than the window comes into view by one window, a list by its label, and what cannot scroll says so", async () => {
  const tab = await driver();
  await tab.open("Live", 390);
  expect((await tab.screen()).text).not.toContain("Further down");
  await tab.scroll();
  await tab.scroll();
  expect((await tab.screen()).text).toContain("Further down");

  // A list named by its label scrolls within itself.
  await tab.show({ control: { label: "Perceptions" } });
  expect((await tab.screen()).text).not.toContain("perception 30");
  for (let i = 0; i < 12; i++) if (!(await tab.scroll({ label: "Perceptions" }).then(() => true, () => false))) break;
  expect((await tab.screen()).text).toContain("perception 30");
  // At its end it does not scroll further, and says which.
  await expect(tab.scroll({ label: "Perceptions" })).rejects.toThrow("Perceptions does not scroll further");

  const short = await driver();
  await short.open("Short", 390);
  await expect(short.scroll()).rejects.toThrow("the page does not scroll");
  await short.close();
  await tab.close();
});

test("read() and the Shot.text of the same page state are the one text; a word hidden by style is in neither", async () => {
  const tab = await driver();
  await tab.open("Short", 1440);
  const read = await tab.read();
  const shot = await tab.screen();
  expect(shot.text).toBe(read);
  expect(read).not.toContain("hiddenword");
  // Each block on a line of its own; the words of one line, and a run of spaces within it, one space.
  expect(read).toBe(["Short", "Short", "Nothing here runs past the window.", "Notes", "The lamp is lit.", "Save Cancel", "first", "second", "one bold two"].join("\n"));
  // A section is read as its own words.
  expect(await tab.read("Notes")).toBe("Notes\nThe lamp is lit.");

  // On the long page, a check reads what lies below the fold, hidden-by-style words in neither, clipped and covered words only in what is read.
  await tab.open("Live", 390);
  const page = await tab.read();
  const window = (await tab.screen()).text;
  for (const hidden of ["hiddenword", "invisibleword", "faintword"]) {
    expect(page).not.toContain(hidden);
    expect(window).not.toContain(hidden);
  }
  expect(page).toContain("clippedword");
  expect(window).toContain("visiblefirst");
  expect(window).not.toContain("clippedword");
  expect(page).toContain("coveredwords");
  expect(window).not.toContain("coveredwords");
  expect(window).toContain("overlaywords");
  // A control's own words: an input's placeholder while it is empty, an icon's label, a chosen option.
  expect(window).toContain("Say something");
  expect(window).toContain("Send");
  expect(window).toContain("Plain");
  await tab.close();
});

test("a control is found by its label or role as a person reads the page; a missing one fails with its label", async () => {
  const tab = await driver();
  await tab.open("Live", 390);
  await tab.find({ label: "Message" });
  await tab.find({ label: "Stop", role: "button" });
  await tab.find({ role: "combobox" });
  await expect(tab.find({ label: "Resume" })).rejects.toThrow("no control labelled Resume");
  await expect(tab.press({ label: "Resume" })).rejects.toThrow("no control labelled Resume");
  // Typed into the field it labels, shown where a person would see it.
  await tab.type({ label: "Message" }, "the lamp is lit");
  expect((await tab.screen()).text).toContain("the lamp is lit");
  await tab.close();
});

test("a chooser takes a typed name, confirmed, and the wait is until the chosen name shows; a menu takes its option by name", async () => {
  const tab = await driver();
  await tab.open("Chooser", 1440);
  await tab.choose({ label: "Composer connection" }, "RPE");
  expect(await tab.read()).toContain("Chosen: RPE");
  await tab.open("Live", 390);
  await tab.choose({ label: "Connection" }, "RPE");
  expect((await tab.screen()).text).toContain("RPE");
  await expect(tab.choose({ label: "Connection" }, "Elsewhere")).rejects.toThrow("has no option Elsewhere");
  await tab.close();
});

test("a page that never names itself, or a page that is not there, is an error naming it", async () => {
  const tab = await driver(600);
  await expect(tab.open("Nowhere", 390)).rejects.toThrow("no page named Nowhere");
  await tab.close();
});
