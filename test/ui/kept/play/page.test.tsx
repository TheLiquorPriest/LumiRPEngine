// The Play page, as the shells' page switch shows it, drawn by Preact in a page of its own (../dom.ts)
// against recorded answers of RPE's routes (recorded.ts, bed.ts): today's HUD strip and today's Play
// with every pack's panel, on the chat's state as RPE gives it; a newer state after the chat's live
// view says it changed; and nothing left behind once the page is left. On RPE's own routes: served.test.tsx.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "preact/test-utils";
import { cashText } from "../../../../src/frontend/hud";
import { UI_PACKS } from "../../../../src/frontend/packs";
import { buildCatalog } from "../../../../src/frontend/ui-registry";
import type { StateView } from "../../../../src/shared/state-view";
import { type HandTimers, handTimers } from "../bed";
import { openPage, type Page, PageElement } from "../dom";
import { type RecordedRpe, recordedRpe } from "./bed";
import { button, leave, openPlay, until, words } from "./mount";
import { CHAT, LATER, recordedView, refused } from "./recorded";

let page: Page;
beforeAll(() => {
  page = openPage();
  // A browser whose canvas draws nothing: the map panel paints on a 2D canvas, which this page has not.
  Object.assign(PageElement.prototype, { getContext: () => null });
});
afterAll(() => {
  Reflect.deleteProperty(PageElement.prototype, "getContext");
  page.close();
});

/** The Play page for `chat` in a fresh root, as the page switch shows it. */
async function open(rpe: RecordedRpe, timers: HandTimers, chat = CHAT): Promise<PageElement> {
  return (await openPlay(page.document, rpe.client, timers, chat)).root;
}

/** Goes to a destination of Play's bar, and to one of its tabs where it has several. */
async function goTo(root: PageElement, dest: string, tab?: string): Promise<void> {
  await act(() => button(root.querySelector(".lre-play .lre-bottomnav") as PageElement, dest).click());
  if (tab !== undefined) await act(() => button(root.querySelector(".lre-play-tabs") as PageElement, tab).click());
  await until(`${tab ?? dest}`, () => root.querySelector(".lre-play-host") !== null);
}

/** The HUD's values as the state holds them: the time, the place, the weather and the cash. */
function hudValues(view: StateView): string[] {
  const hud = view.hud;
  if (hud === null) throw new Error("The recorded state has no HUD");
  return [hud.clock.label, hud.place?.name ?? "", hud.weather ?? "", cashText(hud.cash) ?? ""];
}

const FIRST = await recordedView();
const SECOND = await recordedView({ at: LATER });
/** Invented sentence of RPE's for what it does not serve; RPE's own come from its guidance files. */
const NOT_SERVED = "RPE does not play this from a panel yet.";

describe("the Play page", () => {
  test("mounts on the chat's state: today's HUD with its values on top, and a panel for every pack the state holds, each through its pack's own component", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    rpe.answer = (_route, message) => refused(message.reqId, NOT_SERVED);
    const root = await open(rpe, handTimers());
    await until("the HUD", () => root.querySelector(".rpe-play-hud .lre-hud") !== null);
    const hud = words(root.querySelector(".lre-hud"));
    for (const value of hudValues(FIRST)) expect(hud).toContain(value);

    const shown = new Set<string>();
    const look = (): void => {
      for (const host of root.querySelectorAll(".lre-play-host")) {
        // Each panel draws something of its own in its host.
        if (host.children.length > 0) shown.add(host.getAttribute("data-lre-panel-host") ?? "");
      }
    };
    look();
    const dests = root.querySelectorAll(".lre-play .lre-bottomnav button").map(words);
    for (const dest of dests) {
      await goTo(root, dest);
      look();
      for (const tab of (root.querySelector(".lre-play-tabs")?.querySelectorAll("button") ?? []).map(words)) {
        await goTo(root, dest, tab);
        look();
      }
    }
    const catalog = buildCatalog(UI_PACKS);
    const held = catalog.panels.filter((panel) => !panel.id.startsWith("core.") && FIRST.panels[panel.id] !== undefined && FIRST.panels[panel.id] !== null).map((panel) => panel.id);
    expect(held.length).toBeGreaterThan(0);
    expect([...shown].filter((id) => !id.startsWith("core.")).sort()).toEqual([...held].sort());
    // Every pack whose panel the state holds and today's frontend draws: the weather's is shown in the HUD alone, and with the tabletop rules on in the recorded chat, You is d20's sheet, not the sheets pack's.
    expect(new Set(held.map((id) => id.split(".")[0]))).toEqual(new Set(["calendar", "space", "economy", "gear", "vehicles", "castlife", "d20", "story", "minds", "orgs"]));
    expect(shown.has("core.scene") && shown.has("core.journal")).toBe(true);
    await leave(root);
  });

  test("a newer state, read once the chat's live view says the state changed, replaces the first", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    rpe.answer = (_route, message) => refused(message.reqId, NOT_SERVED);
    const root = await open(rpe, handTimers());
    const [time] = hudValues(FIRST);
    const [later] = hudValues(SECOND);
    await until("the first state's time", () => words(root.querySelector(".lre-hud")).includes(time as string));
    rpe.state = SECOND;
    rpe.publish([{ kind: "state", data: {} }]);
    await until("the newer state's time", () => words(root.querySelector(".lre-hud")).includes(later as string));
    expect(words(root.querySelector(".lre-hud"))).not.toContain(time as string);
    await leave(root);
  });

  test("leaving the page leaves nothing behind: no follower, no handler, no timer, no stylesheet, and nothing more asked", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    rpe.answer = (_route, message) => refused(message.reqId, NOT_SERVED);
    const timers = handTimers();
    const root = await open(rpe, timers);
    await until("the HUD", () => root.querySelector(".lre-hud") !== null);
    expect({ followers: rpe.followers(), styles: page.document.head.querySelectorAll("style").length }).toEqual({ followers: 1, styles: 1 });
    await leave(root);
    const asked = rpe.asked.length;
    rpe.publish([{ kind: "state", data: {} }]);
    timers.advance(60_000);
    await until("nothing more", () => true);
    expect({ followers: rpe.followers(), asked: rpe.asked.length, waiting: timers.waiting(), listening: page.listening(), styles: page.document.head.querySelectorAll("style").length, drawn: root.childNodes.length }).toEqual({ followers: 0, asked, waiting: 0, listening: 0, styles: 0, drawn: 0 });
  });
});
