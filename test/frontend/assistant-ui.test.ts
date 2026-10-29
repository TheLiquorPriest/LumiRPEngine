// GM → Assistant (INC1-SPEC R6b, C8): what the tab draws in each state of the thread (empty, an
// answer running, answered, a proposal open, applied, turned down), which buttons each state
// offers, and the one request each control sends (Send, Cancel, Apply all, a pick, No, Undo, Clear),
// pressed through the tree the tab renders. The tab is registered after the packs' GM tabs.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Badge, Button, Disclosure, Empty } from "../../src/frontend/components";
import { AssistantThread, assistantHandlers, Composer, MessageView, ProposalCard, RunningRow, Trace, type AssistantHandlers, type AssistantIo } from "../../src/frontend/gm/assistant";
import { GmCard } from "../../src/frontend/gm/ui";
import { UI_PACKS } from "../../src/frontend/packs";
import type { Req } from "../../src/frontend/requests";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { type AssistantMessage, type AssistantProposal, type AssistantRun, type AssistantView, WRITE_REFUSED } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import { propsOf, type Props } from "../support/tree";

const CHAT = "chat-port-alder";
const AT = Date.UTC(2026, 9, 28, 18, 30);

const asked: AssistantMessage = { id: "m1", role: "user", text: "Who knows about the shop's trouble?", at: AT };
const answered: AssistantMessage = {
  id: "m2",
  role: "assistant",
  text: "Marcus Delgado keeps it to himself. Danny Okafor suspects something is wrong at Alder Automotive.",
  at: AT + 9_000,
  trace: [
    { tool: "people_find", summary: "name: Marcus", ms: 42 },
    { tool: "knowledge_who", summary: "about: the shop's debt", ms: 1_250 },
    { tool: "people_where", summary: "name: Sam", error: "no such person here", ms: 8 },
  ],
  usage: { in: 4_120, out: 230, cached: 3_000 },
  status: "answered",
};
const moveAsk: AssistantMessage = { id: "m3", role: "user", text: "Put Danny at Bluebird Coffee and move the Fleet Contract on.", at: AT + 60_000 };
const proposer: AssistantMessage = { id: "m4", role: "assistant", text: "Here is what I'd change.", at: AT + 70_000, usage: { in: 5_000, out: 120, cached: 0 }, status: "answered" };
const RUN: AssistantRun = { agentId: "agent_1", label: "Asking the GM assistant…", tokens: { in: 1_520, out: 64 }, startedAt: AT + 61_000 };
const CHIP = "fix:m4:0:3";

function proposal(status: AssistantProposal["status"], rest: Partial<AssistantProposal> = {}): AssistantProposal {
  return {
    id: "p1",
    messageId: "m4",
    status,
    ops: [
      { key: "k-move", changeType: "gm_edit", lines: ["Danny Okafor is at Bluebird Coffee"], mode: "auto" },
      { key: "k-stage", changeType: "stage", lines: ["The Fleet Contract: Signed"], mode: "confirm" },
    ],
    ...rest,
  };
}

const viewOf = (thread: AssistantMessage[], proposals: AssistantProposal[] = [], running: AssistantRun | null = null): AssistantView => ({ thread, running, proposals });

/** The tab's controls over a recording backend: every request sent, every chip undone, the settings opened, the page's own state as the handlers leave it, and the work they started. */
interface Harness {
  sent: Req<"lre.assistant">[];
  chips: string[];
  undone: string[];
  opened: string[];
  state: { draft: string; picked: Readonly<Record<string, readonly string[]>> };
  on: AssistantHandlers;
  /** Resolves once everything the controls started has finished. */
  settle(): Promise<unknown>;
}

function harness(draft = "", answers: { ask?: boolean; confirm?: boolean } = {}): Harness {
  const sent: Req<"lre.assistant">[] = [];
  const chips: string[] = [];
  const undone: string[] = [];
  const opened: string[] = [];
  const work: Promise<unknown>[] = [];
  const state: Harness["state"] = { draft, picked: {} };
  const io: AssistantIo = {
    ask: async (body) => {
      sent.push(body);
      return answers.ask ?? true;
    },
    undo: async (chip) => {
      chips.push(chip);
      return true;
    },
    run: (task) => void work.push(task()),
    confirmClear: async () => answers.confirm ?? true,
    openSettings: () => opened.push("assistant"),
    get draft() {
      return state.draft;
    },
    setDraft: (text) => {
      state.draft = text;
    },
    get picked() {
      return state.picked;
    },
    setPicked: (next) => {
      state.picked = next;
    },
    undone: (chip) => undone.push(chip),
  };
  return { sent, chips, undone, opened, state, on: assistantHandlers(CHAT, io), settle: () => Promise.all(work) };
}

/** The tab's own pieces rendered in place, so every control they lay out can be found and pressed; a proposal's card too, whose badge sits in its head. */
const OURS: readonly unknown[] = [MessageView, ProposalCard, RunningRow, Composer, Trace, GmCard];
function flat(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(flat);
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return node;
  const v = node as VNode<Props>;
  if (OURS.includes(v.type)) return flat((v.type as (p: Props) => unknown)(v.props));
  return { ...v, props: { ...v.props, children: flat(v.props.children) } };
}

function render(v: AssistantView, h: Harness, opts: { edits?: GmView["edits"]; undone?: string[]; busy?: boolean } = {}): unknown {
  return flat(AssistantThread({ view: v, edits: opts.edits ?? [], picked: h.state.picked, undone: opts.undone ?? [], draft: h.state.draft, busy: opts.busy ?? false, on: h.on }));
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Every button a tree offers, by its words, and whether it can be pressed. */
function buttons(tree: unknown): { text: string; enabled: boolean }[] {
  return propsOf(tree, Button).map((p) => ({ text: textOf(p.children), enabled: p.disabled !== true }));
}

function press(tree: unknown, text: string): void {
  const found = propsOf(tree, Button).filter((p) => textOf(p.children) === text);
  const [button] = found;
  if (found.length !== 1 || !button) throw new Error(`${found.length} buttons “${text}”`);
  if (button.disabled === true) throw new Error(`“${text}” can't be pressed`);
  if (typeof button.onClick !== "function") throw new Error(`“${text}” does nothing`);
  button.onClick();
}

/** The element with a `data-…` attribute, by its value. */
function marked(tree: unknown, attribute: string, value?: string): Props {
  const found = propsOf(tree, "div").filter((p) => p[attribute] !== undefined && (value === undefined || p[attribute] === value));
  const [only] = found;
  if (found.length !== 1 || !only) throw new Error(`${found.length} elements with ${attribute}${value === undefined ? "" : `=${value}`}`);
  return only;
}

describe("GM → Assistant: each state and the buttons it offers", () => {
  test("empty: it says what the assistant does, opens its settings, and Send waits for a message", () => {
    const h = harness();
    const tree = render(viewOf([]), h);
    expect(marked(tree, "data-lre-assistant")["data-lre-assistant"]).toBe("empty");
    const [empty] = propsOf(tree, Empty);
    expect(empty?.title).toBe("Ask the GM assistant");
    expect(buttons(empty?.action)).toEqual([{ text: "Assistant settings", enabled: true }]);
    press(empty?.action, "Assistant settings");
    expect(h.opened).toEqual(["assistant"]);
    // No conversation to clear, nothing running to cancel; Send waits for words.
    expect(buttons(tree)).toEqual([{ text: "Send", enabled: false }]);
    const typed = harness("   ");
    expect(buttons(render(viewOf([]), typed))).toEqual([{ text: "Send", enabled: false }]);
    expect(buttons(render(viewOf([]), harness("Where is Danny?")))).toEqual([{ text: "Send", enabled: true }]);
  });

  test("running: a row with the label, the tokens so far and Cancel; Send and Clear wait for it", () => {
    const h = harness("And Priya?");
    const tree = render(viewOf([asked], [], RUN), h);
    expect(marked(tree, "data-lre-assistant")["data-lre-assistant"]).toBe("running");
    const row = marked(tree, "data-lre-assistant-running", "agent_1");
    expect(textOf(row.children)).toContain("Asking the GM assistant…");
    expect(textOf(row.children)).toContain("1,520 tokens in · 64 out so far");
    expect(buttons(tree)).toEqual([
      { text: "Clear", enabled: false },
      { text: "Cancel", enabled: true },
      { text: "Send", enabled: false },
    ]);
    expect(textOf(tree)).toContain("It's still answering");
    // Before its first call is back it has spent nothing.
    const fresh = render(viewOf([asked], [], { ...RUN, tokens: { in: 0, out: 0 } }), h);
    expect(textOf(marked(fresh, "data-lre-assistant-running").children)).toContain("No tokens spent yet");
  });

  test("answered: the answer, what it spent, and what it looked up folded under it", () => {
    const h = harness();
    const tree = render(viewOf([asked, answered]), h);
    expect(marked(tree, "data-lre-assistant")["data-lre-assistant"]).toBe("idle");
    const answer = marked(tree, "data-lre-assistant-message", "m2");
    expect(answer["data-lre-role"]).toBe("assistant");
    expect(textOf(answer.children)).toContain("Danny Okafor suspects something is wrong at Alder Automotive.");
    expect(textOf(answer.children)).toContain("4,120 tokens in (3,000 cached) · 230 out");
    // When its provider says what it wrote to the cache, that shows beside what it read, none included.
    const written = (usage: NonNullable<AssistantMessage["usage"]>) => textOf(marked(render(viewOf([asked, { ...answered, usage }]), h), "data-lre-assistant-message", "m2").children);
    expect(written({ in: 11_606, out: 52, cached: 0, written: 11_592 })).toContain("11,606 tokens in (11,592 written) · 52 out");
    expect(written({ in: 11_700, out: 56, cached: 11_592, written: 0 })).toContain("11,700 tokens in (11,592 cached, 0 written) · 56 out");
    // Its answer reads as Markdown's safe subset; your own message stays as you wrote it, and HTML in either stays text.
    const md = render(viewOf([{ ...asked, text: "Is **Danny** <b>in</b>?" }, { ...answered, text: "## Who knows\n**Danny Okafor** knows:\n\n- the debt\n- `people_where` <script>x</script>\n\n```\n<script>y</script>\n```\n> as he said" }]), h);
    const yours = marked(md, "data-lre-assistant-message", "m1");
    const its = marked(md, "data-lre-assistant-message", "m2");
    expect(propsOf(yours.children, "strong")).toEqual([]);
    expect(textOf(yours.children)).toContain("Is **Danny** <b>in</b>?");
    const [said] = propsOf(its.children, "div").filter((p) => typeof p.class === "string" && p.class.split(" ").includes("lre-md"));
    expect(propsOf(said?.children, "strong").map((p) => textOf(p.children))).toEqual(["Danny Okafor"]);
    expect(propsOf(said?.children, "li").map((p) => textOf(p.children))).toEqual(["the debt", "people_where <script>x</script>"]);
    expect(propsOf(said?.children, "code").map((p) => textOf(p.children))).toEqual(["people_where", "<script>y</script>"]);
    expect(propsOf(said?.children, "p").filter((p) => p.role === "heading").map((p) => textOf(p.children))).toEqual(["Who knows"]);
    expect(propsOf(said?.children, "pre")).toHaveLength(1);
    expect(propsOf(said?.children, "blockquote").map((p) => textOf(p.children))).toEqual(["as he said"]);
    expect(propsOf(its.children, "script")).toEqual([]);
    // Folded: a closed disclosure saying how many tools it called and how many failed.
    const [fold] = propsOf(answer.children, Disclosure);
    expect(fold?.summary).toBe("What it looked up: 3 tool calls, 1 failed");
    expect(fold?.defaultOpen).toBeUndefined();
    const rows = propsOf(fold?.children, "li");
    expect(rows.map((r) => r["data-lre-trace-tool"])).toEqual(["people_find", "knowledge_who", "people_where"]);
    expect(textOf(rows[1]?.children)).toContain("about: the shop's debt");
    expect(textOf(rows[1]?.children)).toContain("1.3 s");
    expect(textOf(rows[2]?.children)).toContain("no such person here");
    expect(rows.map((r) => r["data-lre-trace-failed"] !== undefined)).toEqual([false, false, true]);
    // Your message has no trace, no usage and no ending.
    const mine = marked(tree, "data-lre-assistant-message", "m1");
    expect(propsOf(mine.children, Disclosure)).toEqual([]);
    expect(propsOf(mine.children, Badge)).toEqual([]);
    expect(buttons(tree)).toEqual([
      { text: "Clear", enabled: true },
      { text: "Send", enabled: false },
    ]);
  });

  test("an answer that stopped short says how it ended and why", () => {
    const stopped: AssistantMessage = { id: "m2", role: "assistant", text: "", at: AT, status: "stopped", reason: "people_where was called with the same arguments 3 times in a row" };
    const answer = marked(render(viewOf([asked, stopped]), harness()), "data-lre-assistant-message", "m2");
    expect(propsOf(answer.children, Badge).map((p) => textOf(p.children))).toEqual(["Stopped: it kept repeating a call"]);
    expect(textOf(answer.children)).toContain("It said nothing before it stopped.");
    expect(textOf(answer.children)).toContain("3 times in a row");
    const cancelled = marked(render(viewOf([asked, { ...stopped, status: "cancelled", reason: undefined }]), harness()), "data-lre-assistant-message", "m2");
    expect(propsOf(cancelled.children, Badge).map((p) => textOf(p.children))).toEqual(["Cancelled"]);
  });

  test("a proposal open: each change in plain words under its answer, with Apply all, a pick and No", () => {
    const h = harness();
    const tree = render(viewOf([asked, answered, moveAsk, proposer], [proposal("open")]), h);
    // Under the answer that made it.
    const card = marked(marked(tree, "data-lre-assistant-message", "m4").children, "data-lre-assistant-proposal", "p1");
    expect(card["data-lre-proposal-status"]).toBe("open");
    expect(propsOf(card.children, "div").filter((p) => p["data-lre-op"] !== undefined).map((p) => [p["data-lre-op"], textOf(p.children)])).toEqual([
      ["k-move", "Danny Okafor is at Bluebird Coffee"],
      ["k-stage", "The Fleet Contract: SignedAsks first: it waits for your Apply even when changes apply at once."],
    ]);
    expect(propsOf(card.children, "input").map((p) => [p.type, p.checked, p["aria-label"]])).toEqual([
      ["checkbox", false, "Pick: Danny Okafor is at Bluebird Coffee"],
      ["checkbox", false, "Pick: The Fleet Contract: Signed"],
    ]);
    expect(buttons(card.children)).toEqual([
      { text: "Apply all", enabled: true },
      { text: "Apply picked", enabled: false },
      { text: "No", enabled: true },
    ]);
    // A pick names how many it applies; busy, nothing can be pressed.
    h.state.picked = { p1: ["k-stage"] };
    expect(buttons(marked(render(viewOf([proposer], [proposal("open")]), h), "data-lre-assistant-proposal").children)).toEqual([
      { text: "Apply all", enabled: true },
      { text: "Apply 1 picked", enabled: true },
      { text: "No", enabled: true },
    ]);
    expect(buttons(marked(render(viewOf([proposer], [proposal("open")]), h, { busy: true }), "data-lre-assistant-proposal").children).every((b) => !b.enabled)).toBe(true);
    // One change: nothing to pick from.
    const single = render(viewOf([proposer], [proposal("open", { ops: [{ key: "k-move", changeType: "gm_edit", lines: ["Danny Okafor is at Bluebird Coffee"], mode: "auto" }] })]), harness());
    expect(propsOf(single, "input")).toEqual([]);
    expect(buttons(marked(single, "data-lre-assistant-proposal").children).map((b) => b.text)).toEqual(["Apply all", "No"]);
  });

  test("applied: what landed and what was refused, with Undo only while its chip stands", () => {
    const applied = proposal("applied", {
      chipId: CHIP,
      ops: [
        { key: "k-move", changeType: "gm_edit", lines: ["Danny Okafor is at Bluebird Coffee"], mode: "auto", applied: true },
        { key: "k-stage", changeType: "stage", lines: ["The Fleet Contract: Signed"], mode: "confirm", refused: { code: "bad_stage", reason: "the Fleet Contract can't move to Signed from where it stands" } },
      ],
    });
    const edits: GmView["edits"] = [{ messageId: "m9", seq: 3, lines: ["Danny Okafor is at Bluebird Coffee"], undo: CHIP }];
    const card = (opts: { edits?: GmView["edits"]; undone?: string[] }, p: AssistantProposal = applied) => marked(render(viewOf([proposer], [p]), harness(), opts), "data-lre-assistant-proposal");
    const standing = card({ edits });
    expect(propsOf(standing.children, Badge).map((p) => textOf(p.children))).toEqual(["Applied"]);
    expect(propsOf(standing.children, "span").filter((p) => p["aria-label"] !== undefined).map((p) => p["aria-label"])).toEqual(["Applied", "Refused"]);
    expect(textOf(standing.children)).toContain("Refused: the Fleet Contract can't move to Signed from where it stands");
    expect(propsOf(standing.children, "input")).toEqual([]);
    expect(buttons(standing.children)).toEqual([{ text: "Undo", enabled: true }]);
    // The next reply retired the chip: no Undo, and it says why.
    const passed = card({ edits: [{ ...edits[0], undo: null } as GmView["edits"][number]] });
    expect(buttons(passed.children)).toEqual([]);
    expect(textOf(passed.children)).toContain("Its Undo has passed");
    // Undone here.
    const undone = card({ edits: [], undone: [CHIP] });
    expect(propsOf(undone.children, Badge).map((p) => textOf(p.children))).toEqual(["Undone"]);
    expect(buttons(undone.children)).toEqual([]);
    // Undone elsewhere (the chat, GM → Edits): the backend marks it.
    expect(propsOf(card({ edits }, { ...applied, undone: true }).children, Badge).map((p) => textOf(p.children))).toEqual(["Undone"]);
    expect(textOf(card({ edits }, { ...applied, undone: true }).children)).toContain("Undone: what it changed is back as it was.");
    // A learned note it wrote beside the edit is no Undo's: that change stays applied, and the card says so.
    const learned = { key: "k-note", changeType: "workspace", lines: ["workspace file learned/danny.md written"], mode: "auto", applied: true as const };
    const mixed = card({ edits }, { ...applied, undone: true, ops: [{ ...(applied.ops[0] as AssistantProposal["ops"][number]), undone: true }, learned] });
    expect(propsOf(mixed.children, "span").filter((p) => p["aria-label"] !== undefined).map((p) => p["aria-label"])).toEqual(["Undone", "Applied"]);
    expect(textOf(mixed.children)).toContain("Undone, but for its learned notes: no Undo takes those back.");
    // A change a turn's close refused beside a learned note that landed: Apply again, which sends only what was refused.
    const pin = { key: "k-pin", changeType: "workspace", lines: ["workspace file notes/danny.md pinned"], mode: "auto", refused: { code: WRITE_REFUSED, reason: "no workspace file notes/danny.md" } };
    const partly: AssistantProposal = { ...applied, chipId: undefined, ops: [pin, learned] };
    expect(buttons(card({ edits: [] }, partly).children)).toEqual([{ text: "Apply again", enabled: true }]);
    expect(textOf(card({ edits: [] }, partly).children)).toContain("Sends only what the turn refused");
    // Refused for what it is, not when it came: nothing to apply again.
    expect(buttons(card({ edits: [] }, { ...partly, ops: [{ ...pin, refused: { code: "bad_stage", reason: "no such stage" } }, learned] }).children)).toEqual([]);
    // Applied while a turn ran: it waits for the turn; once it lands, the backend names its chip, and Undo shows as above.
    const held = card({ edits: [] }, { ...applied, chipId: undefined, pending: true });
    expect(held["data-lre-proposal-status"]).toBe("pending");
    expect(propsOf(held.children, Badge).map((p) => textOf(p.children))).toEqual(["Waits for the turn"]);
    expect(buttons(held.children)).toEqual([]);
    expect(textOf(held.children)).toContain("it lands once the reply is in, and its Undo shows here then");
  });

  test("turned down: no buttons, and nothing changed", () => {
    const card = marked(render(viewOf([proposer], [proposal("rejected")]), harness()), "data-lre-assistant-proposal");
    expect(card["data-lre-proposal-status"]).toBe("rejected");
    expect(propsOf(card.children, Badge).map((p) => textOf(p.children))).toEqual(["Turned down"]);
    expect(buttons(card.children)).toEqual([]);
    expect(propsOf(card.children, "input")).toEqual([]);
    expect(textOf(card.children)).toContain("nothing changed");
  });
});

describe("GM → Assistant: the request each control sends", () => {
  test("Send sends your message trimmed and empties the box once accepted; a blank one sends nothing, a refused one stays", async () => {
    const h = harness("  Where is Danny Okafor right now?  ");
    press(render(viewOf([asked, answered]), h), "Send");
    await h.settle();
    expect(h.sent).toEqual([{ type: "lre.assistant", op: "send", chatId: CHAT, text: "Where is Danny Okafor right now?" }]);
    expect(h.state.draft).toBe("");
    const blank = harness("   ");
    blank.on.send();
    await blank.settle();
    expect(blank.sent).toEqual([]);
    const refused = harness("Where is Danny?", { ask: false });
    refused.on.send();
    await refused.settle();
    expect(refused.sent).toHaveLength(1);
    expect(refused.state.draft).toBe("Where is Danny?");
  });

  test("Cancel stops the answer under way, and stays pressable while the page waits on another request (an Apply among them)", async () => {
    const h = harness();
    press(render(viewOf([asked], [], RUN), h), "Cancel");
    await h.settle();
    expect(h.sent).toEqual([{ type: "lre.assistant", op: "cancel", chatId: CHAT }]);
    // While the page is busy, Cancel is still there to press, and its request goes at once.
    const busy = harness();
    press(render(viewOf([asked], [], RUN), busy, { busy: true }), "Cancel");
    await busy.settle();
    expect(busy.sent).toEqual([{ type: "lre.assistant", op: "cancel", chatId: CHAT }]);
  });

  test("Apply all names no change; a pick names those picked, in the proposal's order; No turns it down", async () => {
    const all = harness();
    press(render(viewOf([proposer], [proposal("open")]), all), "Apply all");
    await all.settle();
    expect(all.sent).toEqual([{ type: "lre.assistant", op: "apply", chatId: CHAT, proposalId: "p1" }]);
    expect(all.sent[0] && "keys" in all.sent[0]).toBe(false);
    // Apply again sends the same: the backend sends only what a turn refused.
    const again = harness();
    press(render(viewOf([proposer], [{ ...proposal("applied"), ops: [{ key: "k-pin", changeType: "workspace", lines: ["workspace file notes/danny.md pinned"], mode: "auto", refused: { code: WRITE_REFUSED, reason: "no workspace file notes/danny.md" } }] }]), again), "Apply again");
    await again.settle();
    expect(again.sent).toEqual([{ type: "lre.assistant", op: "apply", chatId: CHAT, proposalId: "p1" }]);

    const pick = harness();
    const tick = (key: string, checked: boolean) => {
      const box = propsOf(render(viewOf([proposer], [proposal("open")]), pick), "input").find((p) => p["aria-label"] === (key === "k-move" ? "Pick: Danny Okafor is at Bluebird Coffee" : "Pick: The Fleet Contract: Signed"));
      if (typeof box?.onChange !== "function") throw new Error(`no box for ${key}`);
      box.onChange({ currentTarget: { checked } });
    };
    // Ticked out of order, and one ticked twice: the request names each once, as the proposal lists them.
    tick("k-stage", true);
    tick("k-move", true);
    tick("k-move", true);
    expect(pick.state.picked).toEqual({ p1: ["k-stage", "k-move"] });
    expect(propsOf(render(viewOf([proposer], [proposal("open")]), pick), "input").map((p) => p.checked)).toEqual([true, true]);
    tick("k-stage", false);
    tick("k-stage", true);
    press(render(viewOf([proposer], [proposal("open")]), pick), "Apply 2 picked");
    await pick.settle();
    expect(pick.sent).toEqual([{ type: "lre.assistant", op: "apply", chatId: CHAT, proposalId: "p1", keys: ["k-move", "k-stage"] }]);
    tick("k-move", false);
    press(render(viewOf([proposer], [proposal("open")]), pick), "Apply 1 picked");
    await pick.settle();
    expect(pick.sent.at(-1)).toEqual({ type: "lre.assistant", op: "apply", chatId: CHAT, proposalId: "p1", keys: ["k-stage"] });

    const no = harness();
    press(render(viewOf([proposer], [proposal("open")]), no), "No");
    await no.settle();
    expect(no.sent).toEqual([{ type: "lre.assistant", op: "reject", chatId: CHAT, proposalId: "p1" }]);
  });

  test("Undo takes the applied changes back by their chip; Clear asks first and sends only on yes", async () => {
    const h = harness();
    press(render(viewOf([proposer], [proposal("applied", { chipId: CHIP })]), h, { edits: [{ messageId: "m9", seq: 3, lines: [], undo: CHIP }] }), "Undo");
    await h.settle();
    expect([h.chips, h.undone, h.sent]).toEqual([[CHIP], [CHIP], []]);
    press(render(viewOf([asked, answered]), h), "Clear");
    await h.settle();
    expect(h.sent).toEqual([{ type: "lre.assistant", op: "clear", chatId: CHAT }]);
    const kept = harness("", { confirm: false });
    press(render(viewOf([asked, answered]), kept), "Clear");
    await kept.settle();
    expect(kept.sent).toEqual([]);
  });
});

describe("GM → Assistant's place in GM mode", () => {
  test("Assistant and Workspace are the last GM tabs, after every pack's, behind This chat", () => {
    const tabs = buildCatalog(UI_PACKS).gmSections.map((def) => [def.id, def.label]);
    expect(tabs.slice(-2)).toEqual([
      ["core.assistant", "Assistant"],
      ["core.workspace", "Workspace"],
    ]);
    expect(tabs.slice(0, -2).every(([id]) => !id?.startsWith("core."))).toBe(true);
  });
});
