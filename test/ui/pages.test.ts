// What the Turn and Live pages show, read from their views as drawn: the intent record and the agents'
// work stay behind the spoiler gate until the player opens it; the timings, the token counts and what
// went to the chat do not; Stop is there while a turn runs. And the web shell's addresses.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { Route } from "../../src/ui/app";
import { applyLive, EMPTY_LIVE, latestRun, type RunNode, runOf } from "../../src/ui/live-model";
import { LiveView, type LiveViewProps } from "../../src/ui/pages/live";
import { TURN_SECTIONS, TurnView, type TurnViewProps } from "../../src/ui/pages/turns";
import { hashOf, routeOfHash, tokenInHash } from "../../src/ui/web";
import { CHAT, INTENT, RECORDED, REPLY, turnAt } from "./recorded";
import { elements, expand, press, textOf } from "./vnodes";

const RULING = "Ruling: her story does not hold.";
const THINKING = "She lied to the harbourmaster";

function turnView(over: Partial<TurnViewProps> = {}): { text: string; tree: unknown; pressed: string[] } {
  const pressed: string[] = [];
  const turn = turnAt();
  const props: TurnViewProps = {
    turn,
    run: runOf(turn),
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

  test("an address that brings the web UI's token gives it up", () => {
    expect(tokenInHash("#token=rpw_abc")).toBe("rpw_abc");
    expect(tokenInHash("#/chats")).toBeNull();
  });
});
