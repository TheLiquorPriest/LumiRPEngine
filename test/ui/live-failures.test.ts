// A handler's failure told to a chat: the Live page of that chat holds it with its turn and change, whether
// a run goes on or not, and a watch of another chat or of a turn does not.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { LiveEvent, MissingPermissionShown } from "../../src/shared/api";
import type { ClientState, LiveListener, RpeClient } from "../../src/ui/client";
import { LiveView, type LiveViewProps } from "../../src/ui/pages/live";
import { createStore } from "../../src/ui/store";
import { NOTHING_WATCHED, watchChat, watchTurn, type Watched } from "../../src/ui/live-watch";
import { CHAT } from "./recorded";
import { elements, expand, press, textOf } from "./vnodes";

/** A client that answers nothing and whose follower the test speaks to, one per chat followed. */
function quietClient(): RpeClient & { listeners: Map<string, LiveListener> } {
  const listeners = new Map<string, LiveListener>();
  return {
    state: createStore<ClientState>({ phase: "relay", why: "the test" }),
    missing: createStore<readonly MissingPermissionShown[] | null>(null),
    preparing: createStore(new Map()),
    call: () => new Promise<never>(() => undefined),
    follow(chat, listener) {
      listeners.set(chat, listener);
      return () => listeners.delete(chat);
    },
    onReset: () => () => undefined,
    connect: () => undefined,
    reconnect: () => undefined,
    close: () => undefined,
    listeners,
  };
}

/** A clock that holds the one redraw asked for until the test lets it happen. */
const pending: (() => void)[] = [];
const timers = { now: () => 0, setTimeout: (run: () => void) => pending.push(run), clearTimeout: () => pending.splice(0) };
const redraw = (): void => void pending.splice(0).forEach((run) => run());
const limits = () => ({ renderMs: 0, keepRuns: 4, keepFailures: 2 });

const failure = (seq: number, chat: string): LiveEvent => ({ chat, seq, kind: "handler_failed", at: 1_700_000_000_000 + seq, data: { op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 } });

function viewOf(failures: Watched["failures"], over: Partial<LiveViewProps> = {}) {
  const props: LiveViewProps = { chat: CHAT, runs: [], letGo: [], behind: 0, loading: false, problem: null, now: 0, gateOpen: false, stops: [], failures, onStop: () => undefined, onOpenGate: () => undefined, onCloseGate: () => undefined, onOpenTurn: () => undefined, ...over };
  return expand(h(LiveView, props));
}

describe("a handler's failure on the Live page", () => {
  test("it is held by the chat it was told to alone, with its turn and change, no run going on; only the newest are kept", () => {
    const client = quietClient();
    const seenA: Watched[] = [];
    const seenB: Watched[] = [];
    const stopA = watchChat(client, "chat-a", timers, (w) => seenA.push(w), limits);
    client.listeners.get("chat-a")?.events([failure(1, "chat-a")], null);
    redraw();
    const stopB = watchChat(client, "chat-b", timers, (w) => seenB.push(w), limits);
    // Chat B's follower was told nothing: it holds nothing, and A's holds the one failure.
    expect(seenB.at(-1)?.failures ?? NOTHING_WATCHED.failures).toEqual([]);
    expect(seenA.at(-1)?.failures).toEqual([{ seq: 1, at: 1_700_000_000_001, op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 }]);
    client.listeners.get("chat-a")?.events([failure(2, "chat-a"), failure(3, "chat-a")], null);
    redraw();
    expect(seenA.at(-1)?.failures.map((f) => f.seq)).toEqual([2, 3]);
    stopA();
    stopB();
  });

  test("a Turn page's watch holds none", () => {
    const client = quietClient();
    const seen: Watched[] = [];
    const stop = watchTurn(client, "chat-a", "turn-harbor", timers, (w) => seen.push(w), limits);
    client.listeners.get("chat-a")?.events([failure(1, "chat-a")], null);
    redraw();
    expect(seen.at(-1)?.failures ?? []).toEqual([]);
    stop();
  });

  test("it shows as a line of its own with no run going on, links its turn's page, and is dismissed on request", () => {
    const opened: string[] = [];
    const dismissed: number[] = [];
    const tree = viewOf([{ seq: 4, at: 1_700_000_000_004, op: "pay", error: "The purse named holds no coin.", turn: "turn-harbor", change: 7 }], { onOpenTurn: (turn) => opened.push(turn), onDismiss: (seq) => dismissed.push(seq) });
    const text = textOf(tree);
    expect(text).toContain("A handler failed at");
    expect(text).toContain("pay, change 7 on turn turn-harbor: The purse named holds no coin.");
    expect(elements(tree).some((e) => e.props["data-failure"] === 4)).toBe(true);
    press(tree, "Its turn's page");
    press(tree, "Dismiss");
    expect({ opened, dismissed }).toEqual({ opened: ["turn-harbor"], dismissed: [4] });
    expect(textOf(viewOf([]))).not.toContain("A handler failed");
  });
});
