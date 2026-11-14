// What the Turn and Live pages show, read from their views as drawn: the intent record and the agents'
// work stay behind the spoiler gate until the player opens it; the timings, the token counts and what
// went to the chat do not; Stop is there while a turn runs. And the web shell's addresses.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { Route } from "../../src/ui/app";
import { applyLive, applyRead, EMPTY_LIVE, lastRunOf, latestRun, type RunNode, runsOf } from "../../src/ui/live-model";
import { LiveView, type LiveViewProps } from "../../src/ui/pages/live";
import { TURN_SECTIONS, TurnView, type TurnViewProps } from "../../src/ui/pages/turns";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { liveTurn } from "../../src/ui/turn-model";
import { CHAT, CONTINUED_REPLY, continuedTurn, earlierTurn, INTENT, LORE, RECORDED, RECORDS, REPLY, RUN, TOTAL, turnAt } from "./recorded";
import { elements, expand, press, textOf } from "./vnodes";

const RULING = "Ruling: her story does not hold.";
const THINKING = "She lied to the harbourmaster";

function turnView(over: Partial<TurnViewProps> = {}): { text: string; tree: unknown; pressed: string[] } {
  const pressed: string[] = [];
  const turn = over.turn ?? turnAt();
  const props: TurnViewProps = {
    turn,
    runs: runsOf(applyRead(EMPTY_LIVE, turn), turn.id),
    problem: null,
    now: turn.timings.ended ?? 0,
    gateOpen: false,
    onOpenGate: () => pressed.push("open"),
    onCloseGate: () => pressed.push("close"),
    onBack: () => pressed.push("back"),
    onLive: () => pressed.push("live"),
    onRead: () => pressed.push("read"),
    ...over,
  };
  const tree = expand(h(TurnView, props));
  return { text: textOf(tree), tree, pressed };
}

describe("the Turn page", () => {
  test("the intent record is hidden until the gate is opened", () => {
    const shut = turnView({ gateOpen: false });
    for (const line of INTENT.split("\n")) expect(shut.text).not.toContain(line);
    expect(shut.text).not.toContain(RULING);
    expect(shut.text).not.toContain(THINKING);
    expect(shut.text).toContain("Spoilers are hidden");
    press(shut.tree, "Show them for this chat");
    expect(shut.pressed).toEqual(["open"]);

    const open = turnView({ gateOpen: true });
    expect(open.text).toContain("Intent record");
    for (const line of INTENT.split("\n")) expect(open.text).toContain(line);
    expect(open.text).toContain(RULING);
    press(open.tree, "Hide them");
    expect(open.pressed).toEqual(["close"]);
  });

  test("its timings, token counts and what went to the chat show with the gate shut", () => {
    const { text } = turnView({ gateOpen: false });
    for (const label of ["Reached RPE", "The lead began", "First words to the chat", "Reply released", "The run ended", "Before the first words"]) expect(text).toContain(label);
    expect(text).toContain("35,690");
    expect(text).toContain("857");
    expect(text).toContain(REPLY.split("\n")[0] as string);
  });

  test("behind the gate: what the Author was given by name, its prompt's lore by id, and the turn's folder named as not available, with no route to open it", () => {
    const shut = turnView({ gateOpen: false });
    expect(shut.text).not.toContain("prompt:all");
    expect(shut.text).not.toContain(LORE.map[1]);
    expect(shut.text).not.toContain("world-state.md");
    const open = turnView({ gateOpen: true });
    expect(open.text).toContain("What the Author was given");
    expect(open.text).toContain("author was given: prompt:all, story:brief, world:scene.");
    expect(open.text).toContain(`Lumiverse activated for its prompt: ${LORE.activated.join(", ")}`);
    expect(open.text).toContain(`Its lore map showed the Author: ${LORE.map.join(", ")}`);
    expect(open.text).toContain("Not available here yet: RPE has no route that lists a turn's folder or opens its files");
    for (const name of ["briefing.md", "world-state.md", "active-wi-content.md", "transcripts/"]) expect(open.text).toContain(name);
    // Each agent's model calls with their tools and results are drawn too.
    expect(open.text).toContain("2d6 = 4 + 1 = 5 against 8: it does not hold.");
    // A turn whose prompt had no lore says so.
    const earlier = earlierTurn("turn-30");
    if (earlier === null) throw new Error("the fixture has no turn-30");
    const bare = turnView({ turn: earlier, gateOpen: true }).text;
    expect(bare).toContain("Lumiverse activated for its prompt: no entry.");
    expect(bare).toContain("Its lore map showed the Author: no entry.");
  });

  test("with the gate open, every agent of the run is drawn, with its tokens", () => {
    const { text, tree } = turnView({ gateOpen: true });
    const agents = elements(tree).filter((e) => e.type === "details" && typeof e.props["data-agent"] === "string").map((e) => e.props["data-agent"]);
    expect(agents).toEqual(["a1", "a2", "a3"]);
    expect(text).toContain("Tokens by agent");
    expect(text).toContain("character, playing char-moira");
    expect(text).toContain("Rule rolls-say-why fired");
  });

  test("a section a later lane adds as a spoiler stays behind the gate", () => {
    const sections = [...TURN_SECTIONS, { id: "lanes", title: "Changes in each lane", spoiler: true, body: () => "The lamp room's door: shut to open." }];
    expect(turnView({ sections, gateOpen: false }).text).not.toContain("The lamp room's door");
    expect(turnView({ sections, gateOpen: true }).text).toContain("The lamp room's door");
  });

  test("a turn a continue ran again shows each of its runs, what the latest sent, and each run's agents behind the gate", () => {
    const turn = continuedTurn();
    const shut = turnView({ turn, gateOpen: false });
    expect(shut.text).toContain("Its runs");
    expect(shut.text).toContain("Run 1 of 2: New reply, led by author");
    expect(shut.text).toContain("Run 2 of 2: Continue, led by author");
    expect(shut.text).toContain(`It released ${REPLY.length.toLocaleString("en")} characters.`);
    expect(shut.text).toContain(CONTINUED_REPLY);
    expect(shut.text).not.toContain(REPLY.split("\n")[0] as string);
    const open = turnView({ turn, gateOpen: true });
    const byRun = elements(open.tree)
      .filter((e) => e.props["data-run-nth"] !== undefined && elements(e.props.children).some((c) => c.props["data-agent"] !== undefined))
      .map((e) => [e.props["data-run-nth"], elements(e.props.children).flatMap((c) => (c.type === "details" && typeof c.props["data-agent"] === "string" ? [c.props["data-agent"]] : []))]);
    expect(byRun).toEqual([
      [1, ["a1", "a2", "a3"]],
      [2, ["a1"]],
    ]);
  });

  test("while it runs, the page shows what the live road has said since the turn was read", () => {
    const read = turnAt(20);
    expect(read.status).toBe("running");
    const heard = RECORDED.slice(20).reduce(applyLive, applyRead(EMPTY_LIVE, read));
    const shown = liveTurn(read, lastRunOf(heard, RUN));
    expect(shown.status).toBe("released");
    expect(shown.usage).toEqual(TOTAL);
    expect(shown.timings.released).toBe(RECORDS.find((r) => r.event.kind === "released")?.at as number);
    expect(shown.timings.ended).toBe(RECORDS.at(-1)?.at as number);
    const midway = liveTurn(read, lastRunOf(RECORDED.slice(20, 54).reduce(applyLive, applyRead(EMPTY_LIVE, read)), RUN));
    expect(midway.status).toBe("running");
    expect(midway.usage.calls).toBe(4);
    expect(turnView({ turn: shown, gateOpen: false }).text).toContain("Reply released");
  });
});

function liveView(run: RunNode | null, over: Partial<LiveViewProps> = {}): { text: string; tree: unknown; pressed: string[] } {
  const pressed: string[] = [];
  const props: LiveViewProps = {
    run,
    loading: false,
    problem: null,
    now: run?.lastAt ?? 0,
    gateOpen: false,
    stopping: false,
    onStop: () => pressed.push("stop"),
    onOpenGate: () => pressed.push("open"),
    onCloseGate: () => pressed.push("close"),
    onOpenTurn: () => pressed.push("turn"),
    ...over,
  };
  const tree = expand(h(LiveView, props));
  return { text: textOf(tree), tree, pressed };
}

describe("the Live page", () => {
  // Midway through the Author's writing: three pieces of the reply have gone to the chat.
  const midway = latestRun(RECORDED.slice(0, 54).reduce(applyLive, EMPTY_LIVE));

  test("while a turn runs: its head, Stop, and the reply as far as it has streamed; the agents behind the gate", () => {
    expect(midway?.outcome).toBeNull();
    const shut = liveView(midway);
    expect(shut.text).toContain("Running now");
    expect(shut.text).toContain(midway?.reply.text.slice(0, 20) ?? "");
    expect(shut.text).not.toContain(INTENT.split("\n")[0] as string);
    press(shut.tree, "Stop");
    expect(shut.pressed).toEqual(["stop"]);
    expect(liveView(midway, { stopping: true }).text).toContain("Stopping…");

    const open = liveView(midway, { gateOpen: true });
    expect(open.text).toContain(INTENT.split("\n")[0] as string);
    expect(elements(open.tree).filter((e) => e.type === "details" && e.props["data-agent"] !== undefined).length).toBe(3);
  });

  test("once it has ended, it shows the last turn, with no Stop", () => {
    const ended = latestRun(RECORDED.reduce(applyLive, EMPTY_LIVE));
    const { text, tree } = liveView(ended);
    expect(text).toContain("The last turn");
    expect(text).toContain("Reply released");
    expect(elements(tree).some((e) => e.type === "button" && textOf(e.props.children) === "Stop")).toBe(false);
  });

  test("a chat with no turn yet says so", () => {
    expect(liveView(null).text).toContain("No turn has run in this chat yet");
    expect(liveView(null, { loading: true }).text).toContain("Reading this chat's turns");
  });
});

describe("the web shell's addresses", () => {
  test("each page's address leads back to it", () => {
    const routes: Route[] = [{ page: "chats" }, { page: "live", chat: CHAT }, { page: "turns", chat: "chat a/b" }, { page: "turn", chat: CHAT, turn: "turn-31" }];
    for (const route of routes) expect(routeOfHash(hashOf(route))).toEqual(route);
    expect(routeOfHash("")).toEqual({ page: "chats" });
    expect(routeOfHash("#/chats/x/nowhere/at/all")).toEqual({ page: "live", chat: "x" });
  });
});
