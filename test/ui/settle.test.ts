// Settle now, on the Turns page and on the Turn page of the chat's newest turn: the button posts to the
// settle route, is disabled while a run of the chat goes on, says RPE's refusal in its own words, and
// tells of the run it began; a settle run is named as one, and its ending with no reply is shown as how
// it is meant to end. And a chat a migration carried turns of says so where it has no run of RPE's.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { TurnReply } from "../../src/shared/api";
import { applyRead, EMPTY_LIVE, runsOf } from "../../src/ui/live-model";
import { RpeError } from "../../src/ui/client";
import { NO_FOLDER, NO_SETTLE, newestOnPath, type SettleShown, settleNow, TurnsView, type TurnsViewProps, TurnView, type TurnViewProps } from "../../src/ui/pages/turns";
import { askingClient, settle } from "./asking";
import { CHAT, EARLIER, turnAt } from "./recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

const REFUSED = "A run of this chat is going on: settle it once that ends.";


function turns(over: Partial<TurnsViewProps>) {
  const pressed: unknown[] = [];
  const props: TurnsViewProps = { turns: EARLIER, more: false, loading: false, problem: null, settle: { shown: NO_SETTLE, onSettle: () => pressed.push("settle") }, onOpen: (turn) => pressed.push(["open", turn]), onMore: () => undefined, ...over };
  const tree = expand(h(TurnsView, props));
  return { tree, text: textOf(tree), pressed };
}

function turnPage(turn: TurnReply, over: Partial<TurnViewProps> = {}) {
  const pressed: unknown[] = [];
  const props: TurnViewProps = {
    turn,
    runs: runsOf(applyRead(EMPTY_LIVE, turn), turn.id),
    problem: null,
    now: turn.timings.ended ?? 0,
    gateOpen: false,
    folder: NO_FOLDER,
    onOpenGate: () => undefined,
    onCloseGate: () => undefined,
    onBack: () => undefined,
    onLive: () => undefined,
    onRead: () => undefined,
    onOpenFile: () => undefined,
    onOpenRequest: () => undefined,
    onCloseFile: () => undefined,
    ...over,
  };
  const tree = expand(h(TurnView, props));
  return { tree, text: textOf(tree), pressed };
}

const button = (tree: unknown, words: string) => elements(tree).find((e) => e.type === "button" && textOf(e.props.children) === words);

/** The recorded turn, its latest run a settle run that ended, as such runs do, with no reply. */
function settledTurn(): TurnReply {
  const turn = turnAt();
  const error = { code: "no-reply" as const, detail: "The lead's run wrote nothing to the chat." };
  const runs = turn.runs.map((run, i) => (i === turn.runs.length - 1 ? { ...run, kind: "settle" as const, status: "no-reply" as const, error } : run));
  return { ...turn, kind: "settle", status: "no-reply", error, runs };
}

describe("Settle now", () => {
  test("on the Turns page it is offered, presses through, and is disabled while a run of the chat goes on", () => {
    const idle = turns({});
    press(idle.tree, "Settle now");
    expect(idle.pressed).toEqual(["settle"]);
    const running = turns({ turns: [{ ...(EARLIER[0] as TurnsViewProps["turns"][number]), status: "running" }, ...EARLIER.slice(1)] });
    expect(button(running.tree, "Settle now")?.props.disabled).toBe(true);
  });

  test("what came of a press: RPE's refusal in its own words, or the run it began with the way to watch it", () => {
    const refused = turns({ settle: { shown: { busy: false, started: null, problem: REFUSED }, onSettle: () => undefined } });
    expect(banners(refused.tree)).toEqual([{ title: "Not settled", text: `Not settled${REFUSED}` }]);
    const begun = turns({ settle: { shown: { busy: false, started: { turn: "turn-30", run: "run-30b" }, problem: null }, onSettle: () => undefined } });
    expect(banners(begun.tree)[0]).toEqual({ title: "A settle run began", text: "A settle run beganRun run-30b on turn turn-30. It writes nothing to the chat.Watch it" });
    press(begun.tree, "Watch it");
    expect(begun.pressed).toEqual([["open", "turn-30"]]);
  });

  test("it posts to the settle route with nothing else; the answer and a refusal are told", async () => {
    const { client, asked } = askingClient();
    const heard: SettleShown[] = [];
    settleNow(client, CHAT, (s) => heard.push(s));
    expect(asked[0]).toMatchObject({ key: "POST /api/v1/chats/:chat/settle", params: { chat: CHAT }, body: undefined });
    asked[0]?.answer({ turn: "turn-31", run: "run-31b" });
    await settle();
    settleNow(client, CHAT, (s) => heard.push(s));
    asked[1]?.fail(new Error(REFUSED));
    await settle();
    expect(heard).toEqual([
      { busy: true, started: null, problem: null },
      { busy: false, started: { turn: "turn-31", run: "run-31b" }, problem: null },
      { busy: true, started: null, problem: null },
      { busy: false, started: null, problem: REFUSED },
    ]);
  });

  test("on the Turn page it is there only for the newest turn, disabled while a run of the chat goes on", () => {
    expect(button(turnPage(turnAt()).tree, "Settle now")).toBeUndefined();
    const newest = turnPage(turnAt(), { settle: { shown: NO_SETTLE, running: false, onSettle: () => undefined } });
    expect(button(newest.tree, "Settle now")?.props.disabled).toBe(false);
    expect(button(turnPage(turnAt(), { settle: { shown: NO_SETTLE, running: true, onSettle: () => undefined } }).tree, "Settle now")?.props.disabled).toBe(true);
  });

  test("a settle run is named as one, and its ending with no reply is shown as normal, not as a failure", () => {
    const page = turnPage(settledTurn());
    expect(page.text).toContain("Settled; nothing written to the chat");
    expect(banners(page.tree).map((b) => b.title)).not.toContain("Why it ended");
    expect(page.text).toContain("Settle run");
    const row = EARLIER[0] as TurnsViewProps["turns"][number];
    const list = turns({ turns: [{ ...row, kind: "settle", status: "no-reply", runs: [{ ...(row.runs[0] as TurnsViewProps["turns"][number]["runs"][number]), kind: "settle", status: "no-reply" }] }] });
    expect(list.text).toContain("Settle run");
    expect(list.text).toContain("Settled; nothing written to the chat");
    expect(elements(list.tree).some((e) => e.props.class === "lre-badge neg")).toBe(false);
  });

  test("a swipe that released its reply and then failed stays a swipe on the list, and the settle run after it is told beside it in its own words", () => {
    const row = EARLIER[0] as TurnsViewProps["turns"][number];
    const swipe = { ...(row.runs[0] as TurnsViewProps["turns"][number]["runs"][number]), kind: "swipe" as const, status: "failed" as const, error: { code: "provider" as const, detail: "The connection closed." } };
    const settle = { ...swipe, nth: 2, kind: "settle" as const, status: "no-reply" as const, error: null, usage: { ...swipe.usage, calls: 22 } };
    const list = turns({ turns: [{ ...row, kind: "swipe", status: "no-reply", runs: [swipe, settle] }] });
    expect(list.text).toContain("Swipe");
    expect(list.text).toContain("Reply released, then its run failed");
    expect(list.text).toContain("Then a settle run (it ran because you pressed Settle now, and it writes nothing to the chat)");
    expect(list.text).toContain("22 calls");
    expect(list.text).not.toContain("Settle an edit");
  });

  test("a chat with no run of RPE's that a migration carried turns of says so, and still offers Settle now", () => {
    const carried = turns({ turns: [], carried: 5 });
    expect(carried.text).toContain("No turn played on RPE yet");
    expect(carried.text).toContain("The migration carried 5 turns of it from the previous build");
    expect(button(carried.tree, "Settle now")).toBeDefined();
    const none = turns({ turns: [], carried: null });
    expect(none.text).not.toContain("migration carried");
    expect(button(none.tree, "Settle now")).toBeUndefined();
  });

  test("the Turn page's Settle now goes with the newest turn on the chat's path, read at once, however far back it was swiped; a chat with none has none", async () => {
    const { client, asked } = askingClient();
    const one = newestOnPath(client, CHAT);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/chats/:chat/newest", params: { chat: CHAT } });
    asked[0]?.answer({ ...turnAt(), id: "turn-29", status: "released" });
    expect(await one).toEqual({ id: "turn-29", status: "released" });

    const none = newestOnPath(client, CHAT);
    asked[1]?.fail(new RpeError(404, "Chat chat-calder has no turn of its own on its path."));
    expect(await none).toBeNull();
    // Any other refusal is not a chat with none.
    const refused = newestOnPath(client, CHAT);
    asked[2]?.fail(new RpeError(500, "RPE could not read it."));
    await expect(refused).rejects.toThrow("RPE could not read it.");
  });
});
