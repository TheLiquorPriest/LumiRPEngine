// The agent turn's own surfaces (INC2-SPEC lane T4): GM → This chat's Engine switch, GM → Workspace's
// compaction rollback, the review card in the chat's chips area, and the drawer's live trace. Each is
// walked as a rendered tree (no DOM), with a recording request in place of the backend: the Engine
// switch sends `lre.chat.knowledge` with the engine picked and says a switch drops a prepared turn;
// Roll back sends `lre.workspace rollback` and shows the session after it; the review card's Apply
// all, a pick and No send `lre.review` as C13 has them; the trace shows each agent's label and tokens,
// nothing else, and its Cancel sends `lre.cancel`.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button, Seg } from "../../src/frontend/components";
import { AgentTrace, agentTokensText, cancelTurn } from "../../src/frontend/diagnostics";
import { engineRequest, EngineSwitch, readEngine, type ChatEngine } from "../../src/frontend/gm/engine";
import { SessionPanel, workspaceControls, type WorkspaceBody, type WorkspaceResult } from "../../src/frontend/gm/workspace";
import { followReview, type ReviewBody, ReviewCard, reviewHandlers, ReviewUnread } from "../../src/frontend/review-card";
import type { ActivityAgent } from "../../src/shared/diagnostics";
import type { GenerateAs, ReviewCardView, SessionView } from "../../src/shared/protocol";
import { press, propsOf, type Props } from "../support/tree";

const CHAT = "chat-port-alder";

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The one Button reading `text`. */
function button(tree: unknown, text: string): Props {
  const found = propsOf(tree, Button).filter((p) => textOf(p.children) === text);
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} buttons reading ${text}`);
  return one;
}

function click(props: Props): void {
  const onClick = props.onClick;
  if (typeof onClick !== "function") throw new Error("not a button");
  onClick();
}

describe("GM → This chat: the Engine switch", () => {
  test("shows the engine and sends lre.chat.knowledge with the one picked, saying a switch drops a prepared turn", () => {
    const picked: string[] = [];
    const tree = EngineSwitch({ engine: "classic", busy: false, onChange: (engine) => picked.push(engine) });
    const seg = propsOf(tree, Seg)[0] ?? {};
    expect(seg.label).toBe("Which engine plays this chat's turns");
    expect(seg.value).toBe("classic");
    expect(seg.options).toEqual([
      { value: "classic", label: "Classic steps" },
      { value: "agents", label: "Agents" },
    ]);
    expect(textOf(tree)).toContain("Switching drops a turn the engine has already prepared for the next reply");
    press(seg, "agents");
    expect(picked).toEqual(["agents"]);
    expect(engineRequest(CHAT, "agents")).toEqual({ type: "lre.chat.knowledge", chatId: CHAT, engine: "agents" });
    expect(engineRequest(CHAT, "classic")).toEqual({ type: "lre.chat.knowledge", chatId: CHAT, engine: "classic" });
    expect(propsOf(EngineSwitch({ engine: "agents", busy: false, onChange: () => undefined }), Seg)[0]?.value).toBe("agents");
    // While it is read, no switch to press.
    expect(propsOf(EngineSwitch({ engine: null, busy: false, onChange: () => undefined }), Seg)).toEqual([]);
  });
});

const SESSION: SessionView = { summary: "Jordan asked about the shop; Helen closed early.", turns: 3, tokens: 4200, rollback: "available" };

describe("GM → Workspace: compaction rollback", () => {
  test("the session and Roll back send lre.workspace session and rollback, and the panel shows the session after", async () => {
    const sent: WorkspaceBody[] = [];
    const controls = workspaceControls(
      CHAT,
      async (body): Promise<WorkspaceResult | null> => {
        sent.push(body);
        return { session: body.op === "rollback" ? { ...SESSION, rollback: "pending" } : SESSION };
      },
      { files: () => undefined, changed: async () => undefined },
    );
    expect(await controls.session()).toEqual(SESSION);
    expect(await controls.rollback()).toEqual({ ...SESSION, rollback: "pending" });
    expect(sent).toEqual([
      { type: "lre.workspace", op: "session", chatId: CHAT },
      { type: "lre.workspace", op: "rollback", chatId: CHAT },
    ]);
    // A refused rollback is said in a toast by the request, and leaves the session as it was.
    const refused = workspaceControls(CHAT, async () => null, { files: () => undefined, changed: async () => undefined });
    expect(await refused.rollback()).toBeNull();
  });

  test("Roll back shows only while a compaction can be rolled back; once asked, it waits for the next agent turn", () => {
    let rolled = 0;
    const available = SessionPanel({ session: SESSION, busy: false, onRollback: () => (rolled += 1) });
    expect(textOf(available)).toContain("It holds 3 turns whole, about 4,200 tokens.");
    click(button(available, "Roll back the latest compaction"));
    expect(rolled).toBe(1);
    const pending = SessionPanel({ session: { ...SESSION, rollback: "pending" }, busy: false, onRollback: () => undefined });
    expect(propsOf(pending, Button)).toEqual([]);
    expect(textOf(pending)).toContain("The next agent turn rolls the latest compaction back and records it.");
    const none = SessionPanel({ session: { summary: null, turns: 0, tokens: 0, rollback: "none" }, busy: false, onRollback: () => undefined });
    expect(propsOf(none, Button)).toEqual([]);
    expect(textOf(none)).toContain("No compaction to roll back.");
    expect(SessionPanel({ session: undefined, busy: false, onRollback: () => undefined })).toBeNull();
  });
});

const CARD: ReviewCardView = {
  turn: "m4:0",
  messageId: "m4",
  swipeId: 0,
  placement: "chips",
  items: [
    { key: "op_ledger_1", source: "agent", role: "director", changeType: "relationship", lines: ["Marcus trusts Jordan a little less."], status: "open" },
    { key: "op_ledger_2", source: "read", role: "read", changeType: "item_transfer", lines: ["Danny gives Jordan the shop key."], status: "open" },
    { key: "op_ledger_3", source: "agent", role: "minds", changeType: "fact", lines: ["Priya learns the ferry is late."], status: "open" },
  ],
};

/** The card's controls over a recording backend; `answer` is what each request answers. */
function reviewRig(card: ReviewCardView, answer: (body: ReviewBody) => { cards: ReviewCardView[]; start?: GenerateAs | null } | null = () => ({ cards: [] })) {
  const sent: ReviewBody[] = [];
  const answered: [ReviewCardView[], GenerateAs | null][] = [];
  const runs: Promise<unknown>[] = [];
  let picked: readonly string[] = [];
  const on = () =>
    reviewHandlers(CHAT, card.turn, {
      ask: async (body) => {
        sent.push(body);
        return answer(body);
      },
      run: (task) => void runs.push(task()),
      picked,
      setPicked: (keys) => void (picked = keys),
      answered: async (cards, start) => void answered.push([cards, start]),
    });
  const render = () => ReviewCard({ card, picked, busy: false, on: on() });
  return { sent, answered, runs, render, picked: () => picked };
}

/** A pick box's change, ticked or not. */
function tick(tree: unknown, line: string, on: boolean): void {
  const box = propsOf(tree, "input").find((p) => p["aria-label"] === `Pick: ${line}`);
  if (!box) throw new Error(`no box for ${line}`);
  press(box, { currentTarget: { checked: on } });
}

describe("the review card", () => {
  test("lists each change in plain words with who proposed it and its change type", () => {
    const tree = reviewRig(CARD).render();
    const text = textOf(tree);
    for (const line of ["Marcus trusts Jordan a little less.", "Danny gives Jordan the shop key.", "Priya learns the ferry is late."]) expect(text).toContain(line);
    expect(text).toContain("Director · Relationship");
    expect(text).toContain("From reading the reply · Item transfer");
    expect(text).toContain("Minds · Fact");
    expect(text).toContain("3 changes ask first");
    expect(propsOf(tree, Button).map((p) => textOf(p.children))).toEqual(["Apply all", "Apply picked", "No"]);
  });

  test("Apply all sends apply with no keys, and its answer goes to the chips area", async () => {
    const r = reviewRig(CARD, () => ({ cards: [{ ...CARD, items: CARD.items.map((i) => ({ ...i, status: "applied" as const })) }], start: null }));
    click(button(r.render(), "Apply all"));
    await Promise.all(r.runs);
    expect(r.sent).toEqual([{ type: "lre.review", op: "apply", chatId: CHAT, turn: "m4:0" }]);
    expect(r.answered.map(([cards, start]) => [cards[0]?.items.map((i) => i.status), start])).toEqual([[["applied", "applied", "applied"], null]]);
  });

  test("a pick applies the ticked changes, in the card's order, and clears the pick", async () => {
    const r = reviewRig(CARD);
    // Nothing ticked: Apply picked waits.
    expect(button(r.render(), "Apply picked").disabled).toBe(true);
    tick(r.render(), "Priya learns the ferry is late.", true);
    tick(r.render(), "Marcus trusts Jordan a little less.", true);
    tick(r.render(), "Danny gives Jordan the shop key.", true);
    tick(r.render(), "Danny gives Jordan the shop key.", false);
    expect(r.picked()).toEqual(["op_ledger_3", "op_ledger_1"]);
    click(button(r.render(), "Apply 2 picked"));
    await Promise.all(r.runs);
    expect(r.sent).toEqual([{ type: "lre.review", op: "apply", chatId: CHAT, turn: "m4:0", keys: ["op_ledger_1", "op_ledger_3"] }]);
    expect(r.picked()).toEqual([]);
  });

  test("No sends reject; at a gate the answer says how the turn starts again", async () => {
    const gate: ReviewCardView = { ...CARD, turn: "m3:gate", messageId: "m3", placement: "gate", resume: "regenerate" };
    const r = reviewRig(gate, () => ({ cards: [], start: "regenerate" }));
    expect(textOf(r.render())).toContain("The turn waits for your answer");
    click(button(r.render(), "No"));
    await Promise.all(r.runs);
    expect(r.sent).toEqual([{ type: "lre.review", op: "reject", chatId: CHAT, turn: "m3:gate" }]);
    expect(r.answered).toEqual([[[], "regenerate"]]);
  });

  test("a refused request changes nothing; one change has no pick; an answered card has no buttons", async () => {
    const refused = reviewRig(CARD, () => null);
    click(button(refused.render(), "Apply all"));
    await Promise.all(refused.runs);
    expect(refused.answered).toEqual([]);
    const one = reviewRig({ ...CARD, items: CARD.items.slice(0, 1) }).render();
    expect(propsOf(one, "input")).toEqual([]);
    expect(propsOf(one, Button).map((p) => textOf(p.children))).toEqual(["Apply all", "No"]);
    const answered = reviewRig({ ...CARD, items: CARD.items.map((i, n) => ({ ...i, status: n === 0 ? ("applied" as const) : n === 1 ? ("rejected" as const) : ("refused" as const), ...(n === 2 ? { refused: { code: "validation", reason: "It no longer applies." } } : {}) })) }).render();
    expect(propsOf(answered, Button)).toEqual([]);
    const text = textOf(answered);
    expect(text).toContain("Applied");
    expect(text).toContain("Turned down");
    expect(text).toContain("It no longer applies.");
  });
});

const ROWS: ActivityAgent[] = [
  { id: "agent_1a2b3c4d", label: "Main agent", tokens: { in: 12_400, out: 310 } },
  { id: "agent_5e6f7a8b", label: "Minds", tokens: { in: 0, out: 0 } },
];

describe("the drawer's live trace", () => {
  test("one row per agent at work: its label and tokens so far, nothing else", () => {
    const tree = AgentTrace({ agents: ROWS, cancellable: true, busy: false, onCancel: () => undefined });
    const rows = propsOf(tree, "li");
    expect(rows.map((r) => r["data-lre-activity-agent"])).toEqual(["agent_1a2b3c4d", "agent_5e6f7a8b"]);
    expect(rows.map((r) => textOf(r.children))).toEqual(["Main agent12,400 tokens in · 310 out so farCancel", "MindsNo tokens spent yetCancel"]);
    expect(agentTokensText({ in: 12_400, out: 310 })).toBe("12,400 tokens in · 310 out so far");
  });

  test("Cancel stops the turn through lre.cancel; with nothing to stop, no Cancel", async () => {
    let cancelled = 0;
    const tree = AgentTrace({ agents: ROWS, cancellable: true, busy: false, onCancel: () => (cancelled += 1) });
    const cancels = propsOf(tree, Button);
    expect(cancels.map((p) => p.label)).toEqual(["Cancel the turn: stops Main agent and every other agent", "Cancel the turn: stops Minds and every other agent"]);
    click(cancels[1] ?? {});
    expect(cancelled).toBe(1);
    const sent: unknown[] = [];
    await cancelTurn(CHAT, async (body) => void sent.push(body));
    expect(sent).toEqual([{ type: "lre.cancel", chatId: CHAT }]);
    expect(propsOf(AgentTrace({ agents: ROWS, cancellable: false, busy: false, onCancel: () => undefined }), Button)).toEqual([]);
  });
});

describe("the review card when its read fails", () => {
  /** A recording `followReview`: the answers its `get` gives, in order, and a way to push. `settle` waits for the last get's answer to be handled. */
  function follow(answers: ({ cards: ReviewCardView[] } | null)[]) {
    const events: unknown[] = [];
    let listener: ((update: { chatId: string; cards: ReviewCardView[] }) => void) | null = null;
    let gets = 0;
    let pending: Promise<unknown> = Promise.resolve();
    const start = () =>
      followReview(
        CHAT,
        {
          onReview: (l) => {
            listener = l;
            return () => void (listener = null);
          },
          get: () => (pending = Promise.resolve(answers[gets++] ?? null)) as Promise<{ cards: ReviewCardView[] } | null>,
        },
        { cards: (cards) => void events.push(["cards", cards.map((c) => c.turn)]), failed: (failed) => void events.push(["failed", failed]) },
      );
    // The follower's handler was registered on the answer first, so it has run once this resolves.
    const settle = () => pending.then(() => undefined);
    return { events, start, settle, push: (chatId: string, cards: ReviewCardView[]) => listener?.({ chatId, cards }), gets: () => gets };
  }

  test("a failed get shows the card as unread; Retry asks again, and its answer shows the card", async () => {
    const f = follow([null, { cards: [CARD] }]);
    const stop = f.start();
    await f.settle();
    expect(f.events).toEqual([
      ["failed", false],
      ["failed", true],
    ]);
    // Retry: the chip asks again, as a new follow.
    stop();
    f.events.length = 0;
    f.start();
    await f.settle();
    expect(f.gets()).toBe(2);
    expect(f.events).toEqual([
      ["failed", false],
      ["cards", ["m4:0"]],
    ]);
  });

  test("a push after a failed get clears it; another chat's push doesn't", async () => {
    const f = follow([null]);
    f.start();
    await f.settle();
    f.push("chat-riverton", [CARD]);
    expect(f.events.at(-1)).toEqual(["failed", true]);
    f.push(CHAT, [CARD]);
    expect(f.events.slice(-2)).toEqual([
      ["failed", false],
      ["cards", ["m4:0"]],
    ]);
  });

  test("the unread card says so and its Retry asks again", () => {
    let retried = 0;
    const tree = ReviewUnread({ onRetry: () => (retried += 1) });
    expect(textOf(tree)).toContain("Couldn't read the changes that ask first");
    click(button(tree, "Retry"));
    expect(retried).toBe(1);
  });
});

describe("the Engine page across chats", () => {
  test("each read starts unknown and not failed, so one chat's failure doesn't stay on the next; a stopped read's answer is dropped", async () => {
    const state: { engine: ChatEngine | null; failed: boolean } = { engine: null, failed: false };
    const out = { engine: (engine: ChatEngine | null) => void (state.engine = engine), failed: (failed: boolean) => void (state.failed = failed) };
    let pending: Promise<unknown> = Promise.resolve();
    const answer = (result: { engine?: "agents" } | null) => () => (pending = Promise.resolve(result)) as Promise<{ engine?: "agents" } | null>;
    const stop = readEngine(answer(null), out);
    await pending.then(() => undefined);
    expect(state).toEqual({ engine: null, failed: true });
    stop();
    // Another chat opened: its read resets the failure at once, then shows its engine.
    const next = readEngine(answer({ engine: "agents" }), out);
    expect(state).toEqual({ engine: null, failed: false });
    await pending.then(() => undefined);
    expect(state).toEqual({ engine: "agents", failed: false });
    next();
    // A read stopped before it answers changes nothing.
    const late = readEngine(answer({}), out);
    late();
    await pending.then(() => undefined);
    expect(state).toEqual({ engine: null, failed: false });
  });
});
