// The evidence bundle (PlanScenarios-1 item 4; plan §17.0 l.1751, "only what can be seen on screen
// counts"): a part whose check found its text and saved no screen is "not seen", as is one whose
// screen shows another page or nothing, or whose words lie outside the saved image; a check that
// names an empty text as what shows the part is refused; a bundle without run.json is refused; a
// screen named in result.json and gone from the folder leaves its part not seen.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bundle, BundleRefused, lookAt, readBundle, runRecord, SUPPORTING, unshownBy } from "../../../scripts/proof/route/evidence";
import type { Sighting } from "../../../scripts/proof/route/form";
import { outcomeOf, verdictOf, type FormRecord, type PartRecord } from "../../../scripts/proof/route/results";
import { FakeBrowser, fakeFacts } from "./fake";

let out = "";

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-evidence-"));
});

afterAll(() => {
  if (out !== "") rmSync(out, { recursive: true, force: true });
});

const coin: Sighting = {
  page: "World",
  check: async (look) => {
    const text = await look.read();
    return text.includes("40 silver") ? { found: true, shows: ["40 silver", "spent most of it"] } : { found: false, what: "no exact amount beside the vague fact" };
  },
};

const PAGES = { World: "Coin: 40 silver (exact, turn 12); since then 'spent most of it' (vague, turn 15)", Play: "Coin 40 silver" };

/** One part looked at once, both widths, in a live play. */
async function lookOnce(browser: FakeBrowser, save: () => string = () => "play-01/world-1440-coin.png"): Promise<PartRecord> {
  const glances = [await lookAt(browser, coin, 1440, save), await lookAt(browser, coin, 390, save)];
  const { outcome, why } = outcomeOf(glances, "code", "live");
  return { id: "coin", words: "A vague fact on the World page beside the last exact amount; a later exact amount settles it", mark: "code", pages: ["World"], measured: null, wants: null, instances: [{ play: 1, at: 1, outcome, why, page: null, glances }] };
}

test("a part whose check found its text and saved no screen is not seen, never a pass", async () => {
  const part = await lookOnce(new FakeBrowser({ pages: PAGES, noScreens: true }));
  expect(part.instances[0]?.outcome).toBe("unseen");
  expect(part.instances[0]?.why).toBe("seen on the World page at 1440, and no screen was saved: the browser saved nothing");
  expect(verdictOf(part, "live")).toMatchObject({ kind: "code", result: "not seen" });
});

test("a screen of another page, a blank one, or one not at the width looked at does not show what the check saw", async () => {
  const wrongTab = await lookOnce(new FakeBrowser({ pages: PAGES, showsAs: { World: "Play" } }));
  expect(wrongTab.instances[0]?.why).toBe("seen on the World page at 1440, and the screen shows the Play page, not the World page");
  const blank = await lookOnce(new FakeBrowser({ pages: PAGES, blank: true }));
  expect(blank.instances[0]?.why).toBe("seen on the World page at 1440, and the screen is blank");
  const wide = await lookOnce(new FakeBrowser({ pages: PAGES, width: 1280 }));
  expect(wide.instances[0]?.why).toBe("seen on the World page at 1440, and the screen is 1280 wide, and it was looked at 1440 wide");
  const shown = await lookOnce(new FakeBrowser({ pages: PAGES }));
  expect(shown.instances[0]?.outcome).toBe("shown");
});

test("text the page holds outside the saved image does not count: a word below the fold is not seen", async () => {
  // The check reads the whole page, as a driver may; the screen holds only what was in the window.
  const below: Sighting = {
    page: "World",
    check: async (look) => ((await look.read()).includes("12 gold") ? { found: true, shows: ["12 gold"] } : { found: false, what: "no gold" }),
  };
  const browser = new FakeBrowser({ pages: PAGES, fold: { World: "Purse: 12 gold (exact, turn 16)" } });
  const glance = await lookAt(browser, below, 390, () => "play-01/world-390-coin.png");
  expect(glance.found).toBe(true);
  expect(glance.unshown).toBe(`the screen does not show "12 gold"`);
  expect(outcomeOf([glance], "code", "live").outcome).toBe("unseen");
});

test("a check that names no words, or an empty or blank text, as what shows the part is refused as a fault of its script", async () => {
  for (const shows of [[""], ["   "], [], ["40 silver", ""]]) {
    const empty: Sighting = { page: "World", check: async () => ({ found: true, shows }) };
    const glance = await lookAt(new FakeBrowser({ pages: PAGES }), empty, 1440, () => "play-01/world-1440-coin.png");
    expect(glance.found).toBeNull();
    expect(glance.what).toBe("the check said it saw the part and named no words, or an empty text, as what shows it: a check names the words the page shows");
    expect(outcomeOf([glance], "code", "live").outcome).toBe("broken");
  }
  // Read back, a recorded look that names an empty text shows nothing.
  expect(unshownBy({ page: "World", shows: [""], shotPage: "World", shotText: PAGES.World })).toBe("the check named an empty text as what shows it");
});

test("RPH is the pinned commit when both name one commit, short or whole, and not otherwise", () => {
  const fields = { run: "r", mode: "rig" as const, by: "a test", started: "2026-11-15T00:00:00.000Z", ended: null, asked: [], unplayed: [], known: { scenarios: [], gates: [] }, repeats: 10 };
  const whole = "9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3";
  expect(runRecord({ ...fakeFacts(), rph: { commit: "9a8b7c6", pin: whole } }, fields).rph.pinned).toBe(true);
  expect(runRecord({ ...fakeFacts(), rph: { commit: "9a8b7c7", pin: whole } }, fields).rph.pinned).toBe(false);
  expect(runRecord({ ...fakeFacts(), rph: { commit: whole, pin: null } }, fields).rph.pinned).toBe(false);
});

test("a bundle without run.json is refused, and so is one whose run.json lacks RPH's commit", () => {
  const bare = join(out, "bare");
  mkdirSync(join(bare, "22"), { recursive: true });
  expect(() => readBundle(bare)).toThrow(BundleRefused);
  expect(() => readBundle(bare)).toThrow("has no run.json");
  const facts = fakeFacts();
  const partial = join(out, "partial");
  mkdirSync(partial);
  const record = runRecord({ ...facts, rph: { commit: "", pin: null } }, { run: "partial", mode: "rig", by: "a test", started: "2026-11-15T00:00:00.000Z", ended: null, asked: [], unplayed: [], known: { scenarios: [], gates: [] }, repeats: 10 });
  writeFileSync(join(partial, "run.json"), JSON.stringify(record));
  expect(() => readBundle(partial)).toThrow("lacks RPH's commit and the commit RPE pins");
});

test("a bundle keeps screens named for page, width and part, notes naming them, and internal/ marked as supporting; a screen taken away is not seen", async () => {
  const bundle = Bundle.open(out, "live", new Date("2026-11-15T03:15:02.000Z"));
  expect(bundle.run).toBe("live-20261115T031502Z");
  bundle.formDir("04");
  const save = (shot: Parameters<Bundle["saveScreen"]>[4]) => bundle.saveScreen("04", 1, shot.page, "coin", shot);
  const part = await lookOnce(new FakeBrowser({ pages: PAGES }), undefined);
  // Looked at again through the bundle, so the screens are on disk.
  const glances = [await lookAt(new FakeBrowser({ pages: PAGES }), coin, 1440, save), await lookAt(new FakeBrowser({ pages: PAGES }), coin, 390, save)];
  const saved: PartRecord = { ...part, instances: [{ play: 1, at: 1, ...outcomeOf(glances, "code", "live"), page: null, glances }] };
  const record: FormRecord = { id: "04", kind: "scenario", number: 4, waves: [2], line: 1814, mode: "live", plays: 1, parts: [saved], stops: [] };
  bundle.keep("04", 1, "world-route", { coin: 40 });
  bundle.writeResult(record);
  bundle.writeNotes(record);
  bundle.writeRun(runRecord(fakeFacts(), { run: bundle.run, mode: "live", by: "a test", started: "2026-11-15T03:15:02.000Z", ended: "2026-11-15T03:16:00.000Z", asked: ["04"], unplayed: [], known: { scenarios: ["04"], gates: [] }, repeats: 10 }));

  expect(glances.map((g) => g.screen)).toEqual(["play-01/world-1440-coin.png", "play-01/world-390-coin.png"]);
  expect(readFileSync(join(bundle.dir, "04/notes.md"), "utf8")).toContain("- Play 1: seen on screen: seen on the World page at 1440; seen on the World page at 390. Screens: play-01/world-1440-coin.png, play-01/world-390-coin.png");
  expect(readFileSync(join(bundle.dir, "04/internal", SUPPORTING), "utf8")).toContain("Nothing here counts as proof");
  expect(existsSync(join(bundle.dir, "04/internal/play-01/world-route.json"))).toBe(true);
  const read = readBundle(bundle.dir);
  expect(read.run.rph.pinned).toBe(true);
  expect(read.faults).toEqual([]);
  expect(read.forms[0]?.faults).toEqual([]);
  expect(read.forms[0]?.record?.parts[0]?.instances[0]?.outcome).toBe("shown");
  expect(read.forms[0]?.result).toBe("passed");

  unlinkSync(join(bundle.dir, "04/play-01/world-390-coin.png"));
  const again = readBundle(bundle.dir);
  expect(again.forms[0]?.record?.parts[0]?.instances[0]).toMatchObject({ outcome: "unseen", why: "seen on the World page at 390, and its screen play-01/world-390-coin.png is not in the folder" });
  expect(again.forms[0]?.result).toBe("failed");
  expect(again.forms[0]?.faults).toContain("notes.md names play-01/world-390-coin.png, which the folder lacks");
  expect(again.forms[0]?.faults).toContain("result.json names play-01/world-390-coin.png, which the folder lacks");
});
