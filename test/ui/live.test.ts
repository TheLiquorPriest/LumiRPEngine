// What the Live page shows, read from its view as drawn: for each run going on its head, Stop and the reply
// as far as it has streamed, with the intent record and the agents behind the spoiler gate until the player
// opens it; Stop is there while a run goes on, for that run alone, in its chat.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { applyLive, EMPTY_LIVE, type RunNode, shownRuns } from "../../src/ui/live-model";
import { LiveView, type LiveViewProps, type StopPress } from "../../src/ui/pages/live";
import { CHAT, CONTINUED, INTENT, RECORDED, RUN_FIRST, RUN_SECOND } from "./recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function liveView(runs: readonly (RunNode | null)[], over: Partial<LiveViewProps> = {}): { text: string; tree: unknown; pressed: string[] } {
  const pressed: string[] = [];
  const shown = runs.flatMap((run) => (run === null ? [] : [run]));
  const props: LiveViewProps = {
    chat: CHAT,
    runs: shown,
    letGo: [],
    behind: 0,
    loading: false,
    problem: null,
    now: shown[0]?.lastAt ?? 0,
    gateOpen: false,
    stops: [],
    onStop: () => pressed.push("stop"),
    onOpenGate: () => pressed.push("open"),
    onCloseGate: () => pressed.push("close"),
    onOpenTurn: () => pressed.push("turn"),
    ...over,
  };
  const tree = expand(h(LiveView, props));
  return { text: textOf(tree), tree, pressed };
}

/** The run of the model that began last. */
const newest = (events: readonly (typeof RECORDED)[number][]): RunNode | null => shownRuns(events.reduce(applyLive, EMPTY_LIVE))[0] ?? null;

describe("the Live page", () => {
  // Midway through the Author's writing: three pieces of the reply have gone to the chat.
  const midway = newest(RECORDED.slice(0, 54));

  test("while a turn runs: its head, Stop, and the reply as far as it has streamed; the agents behind the gate", () => {
    expect(midway?.outcome).toBeNull();
    const shut = liveView([midway]);
    expect(shut.text).toContain("Running now");
    expect(shut.text).toContain(midway?.reply.text.slice(0, 20) ?? "");
    expect(shut.text).not.toContain(INTENT.split("\n")[0] as string);
    press(shut.tree, "Stop");
    expect(shut.pressed).toEqual(["stop"]);
    expect(liveView([midway], { stops: [{ chat: CHAT, run: RUN_FIRST, problem: null }] }).text).toContain("Stopping…");

    const open = liveView([midway], { gateOpen: true });
    expect(open.text).toContain(INTENT.split("\n")[0] as string);
    expect(elements(open.tree).filter((e) => e.type === "details" && e.props["data-agent"] !== undefined).length).toBe(3);
  });

  test("once it has ended, it shows the run as it ended, with no Stop", () => {
    const { text, tree } = liveView([newest(RECORDED)]);
    expect(text).toContain("Ended");
    expect(text).toContain("Reply released");
    expect(elements(tree).some((e) => e.type === "button" && textOf(e.props.children) === "Stop")).toBe(false);
  });

  test("a chat with no turn on RPE yet says so", () => {
    expect(liveView([]).text).toContain("No turn has run on RPE in this chat yet");
    expect(liveView([], { loading: true }).text).toContain("Reading this chat's turns");
  });

  test("when the chat's turns could not be read, it says so, and not that none has run", () => {
    const { text } = liveView([], { problem: "RPE did not answer: Failed to fetch" });
    expect(text).toContain("RPE did not answer: Failed to fetch");
    expect(text).not.toContain("No turn has run");
  });
});

describe("the Live page's Stop", () => {
  const first = newest(RECORDED.slice(0, 54));
  // The same turn, continued: a second run under an id of its own, going on now.
  const continuing = newest([...RECORDED, ...CONTINUED.slice(0, 4)]);
  const ended = newest(RECORDED);
  const pressed = (over: Partial<StopPress> = {}): StopPress => ({ chat: CHAT, run: RUN_FIRST, problem: null, ...over });
  /** The Stop button's words, and whether it can be pressed. */
  const stopButton = (tree: unknown) =>
    elements(tree)
      .filter((e) => e.type === "button" && ["Stop", "Stopping…"].includes(textOf(e.props.children)))
      .map((e) => ({ words: textOf(e.props.children), disabled: e.props.disabled === true }));

  test("it says Stopping… only for the run it was pressed for, in its chat: a continue of the same turn can be stopped again", () => {
    expect([first?.run, first?.outcome]).toEqual([RUN_FIRST, null]);
    expect([continuing?.run, continuing?.outcome]).toEqual([RUN_SECOND, null]);
    expect(stopButton(liveView([first], { stops: [pressed()] }).tree)).toEqual([{ words: "Stopping…", disabled: true }]);
    expect(stopButton(liveView([continuing], { stops: [pressed()] }).tree)).toEqual([{ words: "Stop", disabled: false }]);
    // A Stop pressed in another chat counts for nothing here.
    expect(stopButton(liveView([first], { stops: [pressed({ chat: "chat-orchard" })] }).tree)).toEqual([{ words: "Stop", disabled: false }]);
  });

  test("a Stop that did not go through says why in RPE's words, under its own title and not as a read problem, and can be pressed again", () => {
    const refusal = "RPE answered 503.";
    const unread = "RPE has no turn turn-31 in this chat.";
    const shown = liveView([first], { stops: [pressed({ problem: refusal })], problem: unread });
    const said = banners(shown.tree).filter((b) => b.title !== "Spoilers are hidden");
    expect(said.map((b) => [b.title, b.text.includes(refusal), b.text.includes(unread)])).toEqual([
      ["Part of this chat could not be read", false, true],
      ["Stop did not go through", true, false],
    ]);
    expect(stopButton(shown.tree)).toEqual([{ words: "Stop", disabled: false }]);
    // It goes with the run it was pressed for: once that run has ended, or the turn runs again, it is not shown.
    expect(liveView([ended], { stops: [pressed({ problem: refusal })] }).text).not.toContain(refusal);
    expect(liveView([continuing], { stops: [pressed({ problem: refusal })] }).text).not.toContain(refusal);
  });
});
