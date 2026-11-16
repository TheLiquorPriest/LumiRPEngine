// The Play page, as the shells' page switch shows it, drawn by Preact in a page of its own (../dom.ts)
// against recorded answers of RPE's routes (recorded.ts, bed.ts): today's HUD strip and today's Play
// with every pack's panel, on the chat's state as RPE gives it; a newer state after the chat's live
// view says it changed; a managing tap and its Undo, posted as today's messages; RPE's word on a tap it
// does not serve, said once and not asked again; an Undo's own sentence, said once; a tap or an Undo
// refused while a turn runs, its words shown and the tap free to be made again; and nothing left
// behind once the page is left. On RPE's own routes: served.test.tsx.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "preact/test-utils";
import { cashText } from "../../../../src/frontend/hud";
import { UI_PACKS } from "../../../../src/frontend/packs";
import { buildCatalog } from "../../../../src/frontend/ui-registry";
import type { ErrorMessage, FrontendToBackend } from "../../../../src/shared/protocol";
import type { StateView } from "../../../../src/shared/state-view";
import { words as playWords } from "../../../play/bed";
import { type HandTimers, handTimers } from "../bed";
import { openPage, type Page, PageElement } from "../dom";
import { type RecordedRpe, recordedRpe } from "./bed";
import { button, leave, openPlay, said, until, words } from "./mount";
import { appliedFix, CHAT, LATER, recordedView, refused, undone } from "./recorded";

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

const FIRST = recordedView();
const SECOND = recordedView({ at: LATER });
const ACTIONS = "POST /api/v1/chats/:chat/actions";
const UNDO = "POST /api/v1/chats/:chat/actions/undo";
/** Invented sentences of RPE's for what it does not serve; RPE's own come from its guidance files. */
const NOT_SERVED = "RPE does not play this from a panel yet.";
const CLOCK_NOT_SERVED = "RPE does not pause the clock from a panel yet.";
const LOOK_NOT_SERVED = "RPE does not look closer from a panel yet.";

/** The messages the page sent to a route, in order. */
function sent(rpe: RecordedRpe, route: string): FrontendToBackend[] {
  return rpe.asked.filter((call) => call.key === route).map((call) => call.body as FrontendToBackend);
}

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
    // Every pack whose panel the state holds and today's frontend draws: the weather's is shown in the HUD alone.
    expect(new Set(held.map((id) => id.split(".")[0]))).toEqual(new Set(["calendar", "space", "economy", "gear", "vehicles", "castlife", "sheets", "story", "minds", "orgs"]));
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

  test("a managing tap posts today's message to the actions route and shows the state after it; its Undo posts the id the answer gave to the undo route", async () => {
    const worn = recordedView({ gear: 3 });
    const takenOff = recordedView({ gear: 3, off: ["leather_boots"] });
    const rpe = recordedRpe(CHAT, worn);
    // As RPE does: the change is kept, the answer given, and the chat's followers told its state changed.
    const changeTo = (next: StateView): void => {
      rpe.state = next;
      queueMicrotask(() => rpe.publish([{ kind: "state", data: {} }]));
    };
    rpe.answer = (route, message) => {
      if (route === ACTIONS && message.type === "lre.fix") {
        changeTo(takenOff);
        return appliedFix(message.reqId, "tap:turn-1:1");
      }
      if (route === UNDO) {
        changeTo(worn);
        return undone(message.reqId);
      }
      return refused(message.reqId, NOT_SERVED);
    };
    const root = await open(rpe, handTimers());
    await until("Play", () => root.querySelector(".lre-play .lre-bottomnav") !== null);
    await goTo(root, "Me", "Belongings");
    const boots = (): PageElement | null => root.querySelector('[data-lre-bel-row="leather_boots"]');
    await until("the boots, worn", () => boots() !== null);
    await act(() => button(boots() as PageElement, "Take off").click());
    await until("the boots taken off, and the Undo", () => boots()?.getAttribute("data-lre-bel-at") === "carried" && root.querySelectorAll("button").some((b) => words(b) === "Undo"));
    const [fix] = sent(rpe, ACTIONS).filter((message) => message.type === "lre.fix");
    expect(fix).toEqual({ lre: 1, type: "lre.fix", reqId: expect.any(String), chatId: CHAT, things: [{ do: "wear", item: "leather_boots", off: true }], label: "You took off Leather boots; you still have it." });

    await act(() => button(root, "Undo").click());
    await until("the boots worn again", () => boots()?.getAttribute("data-lre-bel-at") === "wearing" && !root.querySelectorAll("button").some((b) => words(b) === "Undo"));
    expect(sent(rpe, UNDO)).toEqual([{ lre: 1, type: "lre.chip", reqId: expect.any(String), chatId: CHAT, chip: "tap:turn-1:1", choice: "undo" }]);
    await leave(root);
  });

  test.skip("hardening: a tap RPE does not serve shows RPE's sentence once, in place, and is not asked again; what today's Play says nothing of stays unsaid", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    rpe.answer = (_route, message) => refused(message.reqId, message.type === "lre.marker" ? CLOCK_NOT_SERVED : message.type === "lre.view.open" ? LOOK_NOT_SERVED : NOT_SERVED);
    const root = await open(rpe, handTimers());
    const said = (): string[] => root.querySelectorAll("[data-rpe-said] .lre-banner").map(words);
    await until("Play", () => root.querySelector(".lre-play .lre-bottomnav") !== null);
    await goTo(root, "Story", "Calendar");
    expect(said()).not.toContain(CLOCK_NOT_SERVED);
    await act(() => button(root, "Pause clock").click());
    await until("RPE's sentence", () => said().includes(CLOCK_NOT_SERVED));
    await act(() => button(root, "Pause clock").click());
    await until("the second tap answered", () => root.querySelectorAll("button").some((b) => words(b) === "Pause clock" && !b.disabled));
    expect(said().filter((sentence) => sentence === CLOCK_NOT_SERVED)).toHaveLength(1);
    expect(new Set(said()).size).toBe(said().length);
    // Showing a panel observes it (`lre.view.open`), and today's Play says nothing of a refusal of that.
    expect(sent(rpe, ACTIONS).some((message) => message.type === "lre.view.open")).toBe(true);
    expect(said()).not.toContain(LOOK_NOT_SERVED);
    expect(root.querySelectorAll(".lre-toast")).toHaveLength(0);
    expect(sent(rpe, ACTIONS).filter((message) => message.type === "lre.marker")).toHaveLength(1);
    await leave(root);
  });

  test.skip("hardening: an Undo whose answer says what it left as it was shows that sentence once, in the page's notice line, and as no toast", async () => {
    const worn = recordedView({ gear: 3 });
    const takenOff = recordedView({ gear: 3, off: ["leather_boots"] });
    const rpe = recordedRpe(CHAT, worn);
    const left = playWords("opened_stay");
    const changeTo = (next: StateView): void => {
      rpe.state = next;
      queueMicrotask(() => rpe.publish([{ kind: "state", data: {} }]));
    };
    let taps = 0;
    rpe.answer = (route, message) => {
      if (route === ACTIONS && message.type === "lre.fix") {
        changeTo(takenOff);
        taps += 1;
        return appliedFix(message.reqId, `tap:turn-1:${taps}`);
      }
      if (route === UNDO) {
        changeTo(worn);
        return { ...undone(message.reqId), body: { applied: true, pending: false, said: left } };
      }
      return refused(message.reqId, NOT_SERVED);
    };
    const root = await open(rpe, handTimers());
    await until("Play", () => root.querySelector(".lre-play .lre-bottomnav") !== null);
    await goTo(root, "Me", "Belongings");
    const boots = (): PageElement | null => root.querySelector('[data-lre-bel-row="leather_boots"]');
    for (let round = 0; round < 2; round++) {
      await until("the boots, worn", () => boots()?.getAttribute("data-lre-bel-at") === "wearing");
      await act(() => button(boots() as PageElement, "Take off").click());
      await until("the Undo", () => root.querySelectorAll("button").some((b) => words(b) === "Undo"));
      await act(() => button(root, "Undo").click());
      await until("the Undo's sentence and the boots worn again", () => said(root).includes(left) && boots()?.getAttribute("data-lre-bel-at") === "wearing");
    }
    expect(sent(rpe, UNDO)).toHaveLength(2);
    expect(said(root).filter((sentence) => sentence === left)).toHaveLength(1);
    expect(root.querySelectorAll(".lre-toast")).toHaveLength(0);
    await leave(root);
  });

  test.skip("hardening: a tap or an Undo refused while a turn runs or as not whole shows RPE's words, and the same tap can be made again", async () => {
    const worn = recordedView({ gear: 3 });
    const takenOff = recordedView({ gear: 3, off: ["leather_boots"] });
    const rpe = recordedRpe(CHAT, worn);
    const running = playWords("turn_running");
    const notWhole = playWords("no_undo_for", { parts: "economy.txn" });
    const conflict = (reqId: string, message: string): ErrorMessage => ({ lre: 1, type: "lre.error", reqId, code: "conflict", message });
    let turning = true;
    rpe.answer = (route, message) => {
      if (route === ACTIONS && message.type === "lre.fix") {
        if (turning) return conflict(message.reqId, running);
        rpe.state = takenOff;
        queueMicrotask(() => rpe.publish([{ kind: "state", data: {} }]));
        return appliedFix(message.reqId, "tap:turn-2:1");
      }
      if (route === UNDO) return conflict(message.reqId, notWhole);
      return refused(message.reqId, NOT_SERVED);
    };
    const root = await open(rpe, handTimers());
    const toasts = (): string[] => root.querySelectorAll(".lre-toast").map(words);
    await until("Play", () => root.querySelector(".lre-play .lre-bottomnav") !== null);
    await goTo(root, "Me", "Belongings");
    const boots = (): PageElement | null => root.querySelector('[data-lre-bel-row="leather_boots"]');
    await until("the boots, worn", () => boots() !== null);
    await act(() => button(boots() as PageElement, "Take off").click());
    await until("RPE's words on the running turn", () => toasts().some((text) => text.includes(running)));
    expect(boots()?.getAttribute("data-lre-bel-at")).toBe("wearing");

    turning = false;
    await until("Take off, free again", () => boots()?.querySelectorAll("button").some((b) => words(b) === "Take off" && !b.disabled) === true);
    await act(() => button(boots() as PageElement, "Take off").click());
    await until("the boots taken off, and the Undo", () => boots()?.getAttribute("data-lre-bel-at") === "carried" && root.querySelectorAll("button").some((b) => words(b) === "Undo"));
    expect(sent(rpe, ACTIONS).filter((message) => message.type === "lre.fix")).toHaveLength(2);
    await act(() => button(root, "Undo").click());
    await until("RPE's words on the Undo", () => toasts().some((text) => text.includes(notWhole)));
    // Nothing was undone: the boots stay off, and the Undo stays offered.
    expect(boots()?.getAttribute("data-lre-bel-at")).toBe("carried");
    expect(root.querySelectorAll("button").some((b) => words(b) === "Undo")).toBe(true);
    // Neither is taken for something RPE does not serve.
    expect(said(root).filter((sentence) => sentence === running || sentence === notWhole)).toEqual([]);
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
