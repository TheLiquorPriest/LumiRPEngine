// The Play page on RPE's own handlers (served.ts): Build's route and the play routes over one store,
// and the application's live hub. A chat with no world is given one from the page, with today's own
// picker; a turn whose run ends before it joins the chat shows once it joins; and the buttons of
// today's overlays, which this build does not have, each do what the page can or say so once.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "preact/test-utils";
import type { StateView } from "../../../../src/shared/state-view";
import { replyOf } from "../../../../src/ui/client";
import { attachedWords, NOT_HERE } from "../../../../src/ui/kept/play/app";
import { handTimers } from "../bed";
import { openPage, type Page, PageElement } from "../dom";
import { button, leave, openPlay, said, until, words } from "./mount";
import { type ServedRpe, servedRpe, USER } from "./served";

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

const NO_WORLD = "chat-tea-room";
const PLAYED = "chat-larkspur";

/** The chat's state as RPE's state route answers it now. */
async function stateOf(rpe: ServedRpe, chat: string): Promise<StateView> {
  return replyOf(await rpe.client.call("GET /api/v1/chats/:chat/state", { chat }));
}

/** The HUD's time as the state holds it. */
function timeOf(view: StateView): string {
  if (view.hud === null) throw new Error("The state has no HUD");
  return view.hud.clock.label;
}

const hud = (root: PageElement): string => words(root.querySelector(".rpe-play-hud .lre-hud"));

/** RPE with the world "Fernwick" made in Build and `chat` playing it. */
async function playing(chat: string): Promise<ServedRpe> {
  const rpe = servedRpe();
  const world = await rpe.world("Fernwick");
  await rpe.build({ op: "attach", worldId: world.id, chatId: chat });
  return rpe;
}

describe("the Play page on RPE's own routes", () => {
  test("a chat with no world shows today's picker of the worlds Build holds; Attach gives it the world, and the page then shows that world's HUD and panels", async () => {
    const rpe = servedRpe();
    const world = await rpe.world("Fernwick");
    await rpe.writes.run(() => rpe.store.user(USER).createChat({ id: NO_WORLD }), "a chat RPE has seen, with no world");
    const { root } = await openPlay(page.document, rpe.client, handTimers(), NO_WORLD);
    const picker = (): PageElement | null => root.querySelector('[data-lre-section="play-not-world"]');
    await until("the picker", () => words(picker()).includes("Fernwick") && (picker()?.querySelectorAll("button").some((b) => words(b) === "Attach") ?? false));
    expect(root.querySelector(".rpe-play-hud")).toBeNull();

    await act(() => button(picker() as PageElement, "Attach").click());
    await until("the world's HUD and Play's bar", () => root.querySelector(".rpe-play-hud .lre-hud") !== null && root.querySelector(".lre-play .lre-bottomnav") !== null);
    expect(page.window.confirms.at(-1)).toContain("Fernwick");
    expect(rpe.asked.filter((call) => call.key === "POST /api/v1/build").map((call) => call.body)).toContainEqual(expect.objectContaining({ type: "lre.world", op: "attach", worldId: world.id, chatId: NO_WORLD }));
    expect(rpe.store.user(USER).chat(NO_WORLD)?.world).toBe(world.id);
    expect(hud(root)).toContain(timeOf(await stateOf(rpe, NO_WORLD)));
    expect(picker()).toBeNull();
    // Nothing the page asked on the way was refused; what it says is the attach.
    expect(said(root)).toEqual([attachedWords("Fernwick")]);
    await leave(root);
  });

  test("after Attach the page says once, in its own words, that the world is attached, and no toast speaks of classic steps or a Harness page", async () => {
    const rpe = servedRpe();
    await rpe.world("Fernwick");
    const timers = handTimers();
    const { root } = await openPlay(page.document, rpe.client, timers, NO_WORLD);
    await until("the picker", () => root.querySelectorAll("button").some((b) => words(b) === "Attach"));
    await act(() => button(root, "Attach").click());
    await until("the world's HUD", () => root.querySelector(".rpe-play-hud .lre-hud") !== null);
    // Whatever would have come of today's request has come, and whatever toast it made is still showing.
    await until("nothing more", () => true);
    const toasts = root.querySelectorAll(".lre-toast").map(words);
    expect(toasts.filter((text) => /classic steps|Harness|engine/i.test(text))).toEqual([]);
    expect(said(root).filter((sentence) => sentence === attachedWords("Fernwick"))).toHaveLength(1);
    expect(said(root).join(" ")).toContain("Fernwick");
    // Which engine plays the chat is not asked of RPE; nothing waits on a timer for it.
    expect(rpe.asked.some((call) => (call.body as { type?: string; engines?: boolean } | undefined)?.type === "lre.chat.knowledge" && (call.body as { engines?: boolean }).engines === true)).toBe(false);
    expect(timers.waiting()).toBe(0);
    await leave(root);
  });

  test("the picker's Open Build goes to the shell's Build page", async () => {
    const rpe = servedRpe();
    const { root, route } = await openPlay(page.document, rpe.client, handTimers(), NO_WORLD);
    const none = (): string => words(root.querySelector('[data-lre-section="play-not-world"] .lre-play-none'));
    await until("the picker", () => none() === "No worlds yet. Create one in Build.");
    await act(() => button(root, "Open Build").click());
    expect(route()).toEqual({ page: "build" });
    await leave(root);
  });

  test("a turn whose run ends before it is tied to its reply shows once it is: the page reads at the run's end, and again when the turn joins the chat", async () => {
    const rpe = await playing(PLAYED);
    const { root } = await openPlay(page.document, rpe.client, handTimers(), PLAYED);
    const before = timeOf(await stateOf(rpe, PLAYED));
    await until("the chat's time", () => hud(root).includes(before));

    // The run: begun, the time passed by the Author's tool, and ended at the reply's release, before Lumiverse saved the reply.
    const turn = await rpe.begin(PLAYED);
    rpe.live.publish(PLAYED, { kind: "trace", data: { seq: 1, run: turn, scope: { user: USER, chat: PLAYED, session: "session-larkspur", turn }, at: 0, agent: { id: "author-1", definition: "author" }, event: { kind: "run_started", run: "turn", lead: "author" } } });
    await rpe.apply(PLAYED, turn, [{ op: "pass_time", minutes: 90, source: { from: "prose", message: "msg-reply-later" } }]);
    rpe.live.publish(PLAYED, { kind: "trace", data: { seq: 2, run: turn, scope: { user: USER, chat: PLAYED, session: "session-larkspur", turn }, at: 0, agent: { id: "author-1", definition: "author" }, event: { kind: "run_ended", outcome: { status: "released", released: true, usage: { calls: 1, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } } } } });
    const reads = (): number => rpe.asked.filter((call) => call.key === "GET /api/v1/chats/:chat/state").length;
    const atEnd = reads();
    await until("the read at the run's end", () => reads() > atEnd);
    await until("nothing more", () => true);
    expect(timeOf(await stateOf(rpe, PLAYED))).toBe(before);
    expect(hud(root)).toContain(before);

    // Lumiverse's end of the generation: the turn is tied to its saved reply, and the turn lane says the chat's state changed.
    await rpe.tie(turn);
    rpe.live.publish(PLAYED, { kind: "state", data: {} });
    const after = timeOf(await stateOf(rpe, PLAYED));
    expect(after).not.toBe(before);
    await until("the time after the turn", () => hud(root).includes(after));
    await leave(root);
  });

  test("Act, Timelapse and the HUD's Actions say once that the actions sheet does not open here; the HUD's Map goes to Places, where the map's Full screen says it shows already", async () => {
    const rpe = await playing(PLAYED);
    const { root } = await openPlay(page.document, rpe.client, handTimers(), PLAYED);
    await until("Now", () => root.querySelector('.lre-play-main[data-lre-dest="now"] .lre-play-quick') !== null);
    const before = rpe.asked.length;

    await act(() => button(root, "Act").click());
    await until("the sentence", () => said(root).includes(NOT_HERE.palette));
    if (root.querySelectorAll("button").some((b) => words(b) === "Timelapse")) await act(() => button(root, "Timelapse").click());

    // The HUD's details: Map, then Actions.
    await act(() => (root.querySelector(".rpe-play-hud .lre-hud button") as PageElement).click());
    await until("the HUD's details", () => root.querySelectorAll("button").some((b) => words(b) === "Actions"));
    await act(() => button(root, "Actions").click());
    expect(said(root).filter((sentence) => sentence === NOT_HERE.palette)).toHaveLength(1);
    await act(() => (root.querySelector(".rpe-play-hud .lre-hud button") as PageElement).click());
    await until("the HUD's details", () => root.querySelectorAll("button").some((b) => words(b) === "Map" && b.closest(".lre-chat-worldactions") !== null));
    await act(() => (root.querySelectorAll(".lre-chat-worldactions button").find((b) => words(b) === "Map") as PageElement).click());
    await until("Places", () => root.querySelector('.lre-play-main[data-lre-dest="places"]') !== null);

    const full = (): PageElement | null => root.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Full screen") ?? null;
    await until("the map's Full screen", () => full() !== null);
    await act(() => (full() as PageElement).click());
    await until("the map's sentence", () => said(root).includes(NOT_HERE.map));
    expect(said(root)).toEqual([NOT_HERE.palette, NOT_HERE.map]);
    // None of them asked RPE anything; going to Places shows its panels, which the page observes (`lre.view.open`) and reads.
    const since = rpe.asked.slice(before).filter((call) => call.key !== "GET /api/v1/chats/:chat/state");
    expect(since.map((call) => (call.body as { type: string }).type).filter((type) => type !== "lre.view.open")).toEqual([]);
    await leave(root);
  });
});
