// The depth views rendered with no DOM (DEPTH-PLAN §7, §8; D-9: nothing hidden): GM → Minds on a
// depth chat (the list with the player's point of view, a character's files, writes, beliefs, points
// of view, effort and Interview), GM → Depth → Notebook, Archive, Bootstrap, Drafts (every draft on
// the chain with its state, each opening as its page with Settle now, Drop and Re-draft while open)
// and Treatments (the asks waiting on the player answered as their chips are, the log, the meter, the
// ceilings and allowances), and GM → This chat → Depth's opt-in with the bootstrap's estimate. Each
// body is walked as a tree, its own components rendered in place and the host's controls kept as
// they are, then pressed through their props.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import type { BootstrapEstimate, BootstrapView, SpotCheckCard } from "../../src/shared/bootstrap";
import { NO_COUNTS } from "../../src/shared/bootstrap";
import type { DepthArchiveResult, DepthDraft, DepthDraftsView, DepthMindsView, DepthMindView, DepthNotebookView, DepthTreatmentsView } from "../../src/shared/depth-views";
import { Button, HostModelPicker, HostSelect, HostSlider, HostSwitch, IconButton, IdText, ListRow, Meter, NumberStepper, Seg, Tabs } from "../../src/frontend/components";
import { ArchiveBody, archiveAsks } from "../../src/frontend/depth/archive";
import { BootstrapBody, type BootstrapControls, capUsed, EXPORT_NOTE } from "../../src/frontend/depth/bootstrap";
import { DepthChatBody, type DepthChatControls } from "../../src/frontend/depth/chat-depth";
import { DraftsBody, type DraftsControls } from "../../src/frontend/depth/drafts";
import { type MindControls, MindPage, MindsList, type MindTab } from "../../src/frontend/depth/minds";
import { NotebookBody, type NotebookControls, notebookFileLabel, type NotebookTab } from "../../src/frontend/depth/notebook";
import { DEPTH_TABS } from "../../src/frontend/depth/section";
import { TreatmentsBody, type TreatmentsControls, type TreatmentsTab } from "../../src/frontend/depth/treatments";
import { propsOf, type Props } from "../support/tree";

/** The host's controls (they hold hooks) stay as elements; every other component renders in place, its element kept with what it rendered as its children. */
const OPAQUE = new Set<unknown>([HostModelPicker, HostSelect, HostSlider, HostSwitch, IdText, NumberStepper, Tabs]);

function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const v = node as VNode<Props>;
  if (typeof v.type === "function" && !OPAQUE.has(v.type)) return { ...v, props: { ...v.props, children: render((v.type as (p: Props) => unknown)(v.props)) } };
  return { ...v, props: { ...v.props, children: render(v.props.children) } };
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The button whose own text is `text`. */
function button(tree: unknown, text: string): Props {
  const found = propsOf(tree, Button).filter((p) => textOf(p.children).trim() === text || p.label === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons "${text}"`);
  return found[0] ?? {};
}

function tap(props: Props): void {
  if (typeof props.onClick !== "function") throw new Error("not a button");
  (props.onClick as () => void)();
}

// ---------------------------------------------------------------- GM → Minds

const MINDS: DepthMindsView = {
  on: true,
  pov: { id: "you", name: "Sam Reyes" },
  characters: [
    { id: "npc_rosie", name: "Rosie Alvarez", files: 7, last: { path: "minds/npc_rosie/memories/0007-the-diner.md", at: "Tuesday 14 May, 08:40" }, pending: 2, effort: "agent", review: false },
    { id: "npc_dev", name: "Dev Patel", files: 1, last: null, pending: 0, effort: null, review: true },
  ],
};

const MIND: DepthMindView = {
  id: "npc_rosie",
  name: "Rosie Alvarez",
  files: [
    { path: "minds/npc_rosie/memories/0007-the-diner.md", text: "Sam came in soaked and wouldn't say why.", pinned: false, revisions: 1, at: "Tuesday 14 May, 08:40" },
    { path: "minds/npc_rosie/beliefs.md", text: "- Sam is hiding something: a hunch.", pinned: true, revisions: 3, at: "Tuesday 14 May, 09:00" },
    { path: "minds/npc_rosie/core.md", text: "Runs the diner. Notices everything, says little.", pinned: false, revisions: 1, at: null },
  ],
  writes: [
    { id: "w2", path: "minds/npc_rosie/beliefs.md", at: "Tuesday 14 May, 09:00", mode: "reflect", reasoning: "He dodged the question twice.", text: "- Sam is hiding something: a hunch.", before: "- Sam is fine.", lived: [{ id: "beat_12", label: "Sam shrugs off the question", messageId: "m12" }] },
    { id: "w1", path: "minds/npc_rosie/memories/0007-the-diner.md", at: "Tuesday 14 May, 08:40", mode: "catch-up", reasoning: "", text: "Sam came in soaked and wouldn't say why.", before: null, lived: [], superseded: true },
  ],
  beliefs: [
    { belief: "Sam is hiding something", truth: "Sam lost the shop's deposit", verdict: "true", why: "His dodge is about the deposit." },
    { belief: "The weather turned this morning", truth: null, verdict: "unlinked", why: "" },
  ],
  povs: [
    { beat: { id: "beat_10", label: "Sam orders coffee", messageId: "m10" }, at: "08:35", reach: "whole", text: "Sam orders coffee.", pending: false },
    { beat: { id: "beat_14", label: "Sam takes a call outside", messageId: "m14" }, at: "08:50", reach: "part", text: "Through the window: Sam on the phone, upset.", pending: true },
  ],
  efforts: [{ scene: "Morning rush at the diner", at: "Tuesday 14 May", effort: "agent", why: "She is the scene's other half." }],
  takes: [{ at: "Tuesday 14 May, 08:52", text: "He's lying about the call. Let him think I bought it.", beat: { id: "beat_15", label: "Rosie refills his cup without a word", messageId: "m15" }, lived: [{ id: "beat_14", label: "Sam takes a call outside", messageId: "m14" }] }],
  interviews: [{ at: "Tuesday 14 May, 10:00", by: "gm", question: "What would make you close the diner?", answer: "Nothing short of the bank.", neutral: false }],
};

function mindControls(over: Partial<MindControls> = {}): MindControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return {
    calls,
    busy: false,
    tab: "files",
    onTab: log("tab"),
    draft: null,
    onDraft: log("draft"),
    onSave: log("save"),
    question: "",
    neutral: false,
    answer: null,
    onQuestion: log("question"),
    onNeutral: log("neutral"),
    onAsk: log("ask"),
    onJump: log("jump"),
    onCatchUp: log("catchUp"),
    onReflect: log("reflect"),
    onBack: log("back"),
    ...over,
  };
}

describe("GM → Minds on a depth chat", () => {
  test("the list says whose point of view the player drives, offers no Play as (switching isn't supported yet), and lists every mind with what waits", () => {
    const opened: string[] = [];
    const tree = render(MindsList({ view: MINDS, onOpen: (id) => void opened.push(id) }));
    const text = textOf(tree);
    expect(text).toContain("You play Sam Reyes");
    expect(text).toContain("Minds (2)");
    expect(propsOf(tree, HostSelect).find((p) => p.label === "Play as")).toBeUndefined();
    const rows = propsOf(tree, ListRow);
    expect(rows.map((r) => r.title)).toEqual(["Rosie Alvarez", "Dev Patel"]);
    expect(String(rows[0]?.subtitle)).toContain("Memory: 0007 the diner");
    expect(rows[1]?.subtitle).toBe("No writes yet");
    expect(textOf(rows[0]?.badge)).toContain("2 to live");
    expect(textOf(rows[1]?.badge)).toContain("Core to review");
    (rows[1]?.onClick as () => void)();
    expect(opened).toEqual(["npc_dev"]);
  });

  test("a mind's files read core first; the pinned one says it's yours; Edit drafts it and Save sends only a changed draft", () => {
    const c = mindControls();
    const tree = render(MindPage({ mind: MIND, c, panelId: "p" }));
    const tabs = propsOf(tree, Tabs)[0];
    expect((tabs?.tabs as { id: MindTab; dot?: boolean }[]).map((t) => t.id)).toEqual(["files", "writes", "takes", "beliefs", "povs", "effort", "interview"]);
    // A point of view waits to be lived: its tab carries a dot.
    expect((tabs?.tabs as { id: MindTab; dot?: boolean }[]).find((t) => t.id === "povs")?.dot).toBe(true);
    const files = propsOf(tree, "div").filter((p) => typeof p["data-lre-depth-file"] === "string").map((p) => p["data-lre-depth-file"]);
    expect(files).toEqual(["minds/npc_rosie/core.md", "minds/npc_rosie/beliefs.md", "minds/npc_rosie/memories/0007-the-diner.md"]);
    const text = textOf(tree);
    expect(text).toContain("Your edit, pinned");
    expect(text).toContain("never rewritten by their agent");
    tap(propsOf(tree, Button).filter((p) => textOf(p.children).trim() === "Edit")[1] ?? {});
    expect(c.calls).toEqual([["draft", { path: "minds/npc_rosie/beliefs.md", text: "- Sam is hiding something: a hunch." }]]);

    const same = mindControls({ draft: { path: "minds/npc_rosie/beliefs.md", text: "- Sam is hiding something: a hunch." } });
    expect(button(render(MindPage({ mind: MIND, c: same, panelId: "p" })), "Save").disabled).toBe(true);
    const edited = mindControls({ draft: { path: "minds/npc_rosie/beliefs.md", text: "- Sam lost the deposit: I'd swear to it." } });
    const editing = render(MindPage({ mind: MIND, c: edited, panelId: "p" }));
    expect(textOf(editing)).toContain("Your edit is a directive");
    tap(button(editing, "Save"));
    expect(edited.calls).toEqual([["save", { path: "minds/npc_rosie/beliefs.md", text: "- Sam lost the deposit: I'd swear to it." }]]);
  });

  test("a file a correction put out of mind says so, and one a reflection wrote is flagged apart", () => {
    const files = [
      { path: "minds/npc_rosie/beliefs.md", text: "- Sam is hiding something.", pinned: false, revisions: 2, at: null, out: true as const },
      { path: "minds/npc_rosie/self.md", text: "I see through people.", pinned: false, revisions: 1, at: null, out: true as const, reflection: true as const },
    ];
    const text = textOf(render(MindPage({ mind: { ...MIND, files }, c: mindControls(), panelId: "p" })));
    expect(text).toContain("A reflection, out of mind");
    expect(text.split("Out of mind").length - 1).toBe(1);
  });

  test("every write shows its reasoning, the beats it lived with a jump to each, what it changed, and when an amended beat replaced it", () => {
    const c = mindControls({ tab: "writes" });
    const tree = render(MindPage({ mind: MIND, c, panelId: "p" }));
    const text = textOf(tree);
    expect(text).toContain("Reflecting · Beliefs");
    expect(text).toContain("He dodged the question twice.");
    expect(text).toContain("Catching up · Memory: 0007 the diner");
    expect(text).toContain("No reasoning was given.");
    expect(text).toContain("Replaced by an amended beat");
    // The reflection's diff against the file before it.
    expect(propsOf(tree, "div").some((p) => p["data-lre-diff"] === "1-1")).toBe(true);
    tap(button(tree, "Go to the message of: Sam shrugs off the question"));
    expect(c.calls).toEqual([["jump", "m12"]]);
  });

  test("beliefs sit beside the truth with the GM's verdict, and points of view still waiting come first", () => {
    const beliefs = textOf(render(MindPage({ mind: MIND, c: mindControls({ tab: "beliefs" }), panelId: "p" })));
    expect(beliefs).toContain("Sam is hiding something");
    expect(beliefs).toContain("The truth: Sam lost the shop's deposit");
    expect(beliefs).toContain("True");
    expect(beliefs).toContain("Not linked yet");
    const acting = mindControls({ tab: "povs" });
    const povs = render(MindPage({ mind: MIND, c: acting, panelId: "p" }));
    // One point of view waits: Catch up lives it now; Reflect asks for a reflection now.
    tap(button(povs, "Catch up (1)"));
    tap(button(povs, "Reflect now"));
    expect(acting.calls).toEqual([["catchUp"], ["reflect"]]);
    const caught = render(MindPage({ mind: { ...MIND, povs: MIND.povs.map((p) => ({ ...p, pending: false })) }, c: mindControls(), panelId: "p" }));
    expect(button(caught, "Caught up").disabled).toBe(true);
    const order = propsOf(povs, "div").filter((p) => typeof p["data-lre-depth-pov"] === "string").map((p) => p["data-lre-depth-pov"]);
    expect(order).toEqual(["beat_14", "beat_10"]);
    const text = textOf(povs);
    expect(text).toContain("Waiting to be lived");
    expect(text).toContain("In part: their own view of it");
    expect(textOf(render(MindPage({ mind: MIND, c: mindControls({ tab: "effort" }), panelId: "p" })))).toContain("Its own agent");
  });

  test("Interview asks only a question, marks it neutral on request, says whether the answer joined the mind, and lists every interview kept", () => {
    const empty = mindControls({ tab: "interview" });
    expect(button(render(MindPage({ mind: MIND, c: empty, panelId: "p" })), "Ask").disabled).toBe(true);
    const asking = mindControls({ tab: "interview", question: "What do you make of Sam lately?", answer: { answer: "He's carrying something heavy, and it isn't groceries.", folded: false } });
    const tree = render(MindPage({ mind: MIND, c: asking, panelId: "p" }));
    tap(button(tree, "Ask"));
    (propsOf(tree, HostSwitch).find((p) => p.label === "Neutral to the world")?.onChange as (v: boolean) => void)(true);
    expect(asking.calls).toEqual([["ask"], ["neutral", true]]);
    const text = textOf(tree);
    expect(text).toContain("He's carrying something heavy");
    expect(text).toContain("Kept as a probe");
    // Earlier interviews stay readable on the tab, whatever tab the answer was read on.
    expect(text).toContain("Every interview (1)");
    expect(text).toContain("What would make you close the diner?");
    expect(text).toContain("Nothing short of the bank.");
    expect(text).toContain("Asked in GM mode");
  });

  test("Working memory shows each take not yet remembered, what it played and lived, with a jump to each", () => {
    const c = mindControls({ tab: "takes" });
    const tree = render(MindPage({ mind: MIND, c, panelId: "p" }));
    const text = textOf(tree);
    expect(text).toContain("He's lying about the call. Let him think I bought it.");
    expect(text).toContain("Played: Rosie refills his cup without a word");
    expect(text).toContain("Lived: Sam takes a call outside");
    tap(button(tree, "Go to the message of: Lived: Sam takes a call outside"));
    expect(c.calls).toEqual([["jump", "m14"]]);
    const none = textOf(render(MindPage({ mind: { ...MIND, takes: [] }, c: mindControls({ tab: "takes" }), panelId: "p" })));
    expect(none).toContain("they have remembered every scene they played");
  });
});

// ---------------------------------------------------------------- GM → Depth → Notebook

const NOTEBOOK: DepthNotebookView = {
  on: true,
  files: [
    { path: "notebook/player.md", text: "He wants the diner to survive the winter.", pinned: false, revisions: 2 },
    { path: "notebook/arcs/rosie-alvarez.md", text: "Rosie learns to ask for help.", pinned: true, revisions: 1 },
  ],
  revisions: [
    { id: "r2", path: "notebook/player.md", at: "after message 14", kind: "scene", reasoning: "He kept every swipe where the diner stays open.", before: "He wants a quiet life.", after: "He wants the diner to survive the winter." },
    { id: "r1", path: "notebook/arcs/rosie-alvarez.md", at: "after message 9", kind: "user", reasoning: "", before: "", after: "Rosie learns to ask for help." },
  ],
  poll: [
    {
      at: "after message 14",
      considered: [{ what: "Dev catches up on the phone call", raised: true, why: "He meets Sam tomorrow." }],
      jobs: [
        { kind: "catchup", subject: "Dev Okafor", why: "He meets Sam tomorrow." },
        { kind: "settle", subject: "Dale sells the boat", why: "Sam reaches the marina next." },
      ],
      note: "",
      reasoning: "Sam heads to the marina next; Dale's sale has to be settled first.",
    },
  ],
  predictions: [{ at: "after message 9", text: "Sam tells Rosie by Friday", outcome: "pending", note: "" }],
  drift: [{ at: "after message 14", who: "Rosie Alvarez", drift: "some", note: "Warier of Sam than her arc says." }],
};

function notebookControls(over: Partial<NotebookControls> = {}): NotebookControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return { calls, busy: false, tab: "files", onTab: log("tab"), open: null, onOpen: log("open"), draft: null, onDraft: log("draft"), onSave: log("save"), ...over };
}

describe("GM → Depth → Notebook", () => {
  test("lists the author's files, each opening as a page with its text, Edit and its own revisions with their reasoning", () => {
    const c = notebookControls();
    const tree = render(NotebookBody({ view: NOTEBOOK, c }));
    const rows = propsOf(tree, ListRow);
    expect(rows.map((r) => r.title)).toEqual(["Player", "Arcs › Rosie alvarez"]);
    expect(notebookFileLabel("notebook/arcs/rosie-alvarez.md")).toBe("Arcs › Rosie alvarez");
    (rows[0]?.onClick as () => void)();
    expect(c.calls).toEqual([["open", "notebook/player.md"]]);
    const page = render(NotebookBody({ view: NOTEBOOK, c: notebookControls({ open: "notebook/player.md" }) }));
    const text = textOf(page);
    expect(text).toContain("He wants the diner to survive the winter.");
    expect(text).toContain("Scene's end");
    expect(text).toContain("He kept every swipe where the diner stays open.");
    expect(text).not.toContain("Rosie learns to ask for help.");
    const editing = notebookControls({ open: "notebook/player.md", draft: { path: "notebook/player.md", text: "He wants Rosie to stay." } });
    const edit = render(NotebookBody({ view: NOTEBOOK, c: editing }));
    expect(textOf(edit)).toContain("the author is told what changed");
    tap(button(edit, "Save"));
    expect(editing.calls).toEqual([["save", { path: "notebook/player.md", text: "He wants Rosie to stay." }]]);
  });

  test("the revisions, the poll's log and the predictions each have a tab; a chat off depth says how to opt in", () => {
    const tabs: NotebookTab[] = ["revisions", "poll", "predictions"];
    const [revisions, poll, predictions] = tabs.map((tab) => textOf(render(NotebookBody({ view: NOTEBOOK, c: notebookControls({ tab }) }))));
    expect(revisions).toContain("Player · Scene's end");
    expect(revisions).toContain("Arcs › Rosie alvarez · Your edit");
    expect(poll).toContain("Dev catches up on the phone call");
    expect(poll).toContain("Raised");
    // Its jobs by name, and the author's thinking.
    expect(poll).toContain("Dev Okafor");
    expect(poll).toContain("Catches up");
    expect(poll).toContain("Dale sells the boat");
    expect(poll).toContain("Settle");
    expect(poll).toContain("Sam heads to the marina next; Dale's sale has to be settled first.");
    expect(predictions).toContain("Sam tells Rosie by Friday");
    expect(predictions).toContain("Open");
    const off = textOf(render(NotebookBody({ view: { on: false, files: [], revisions: [], poll: [], predictions: [], drift: [] }, c: notebookControls() })));
    expect(off).toContain("GM → This chat → Depth");
  });

  test("the drift checks have their own tab: whose arc, how far they drifted and the author's note", () => {
    const drift = textOf(render(NotebookBody({ view: NOTEBOOK, c: notebookControls({ tab: "drift" }) })));
    expect(drift).toContain("Rosie Alvarez");
    expect(drift).toContain("Some drift");
    expect(drift).toContain("Warier of Sam than her arc says.");
    const none = textOf(render(NotebookBody({ view: { ...NOTEBOOK, drift: [] }, c: notebookControls({ tab: "drift" }) })));
    expect(none).toContain("No drift checks yet");
  });
});

// ---------------------------------------------------------------- GM → Depth → Archive

const PEOPLE = [{ id: "npc_rosie", name: "Rosie Alvarez" }];
const PLACES = [{ id: "bluebird", name: "Bluebird Coffee" }];
const HITS: DepthArchiveResult = {
  hits: [{ messageId: "m12", index: 12, isUser: false, swipeId: 0, at: "Tuesday 14 May, 08:40", places: ["Bluebird Coffee"], people: ["Rosie Alvarez", "Sam Reyes"], reached: ["Sam Reyes (sight, hearing)"], snippet: "Rosie set the mug down harder than she meant to.", beats: 3 }],
  next: 8,
  unread: ["the day after the storm"],
};

describe("GM → Depth → Archive", () => {
  test("searches by words, person, place or story time; each hit says where it sits and jumps to its message; More pages on", () => {
    const calls: unknown[][] = [];
    const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
    const blank = render(ArchiveBody({ query: {}, people: PEOPLE, places: PLACES, result: null, busy: false, onQuery: log("query"), onSearch: log("search"), onMore: log("more"), onJump: log("jump") }));
    expect(button(blank, "Search the chat").disabled).toBe(true);
    expect(archiveAsks({ from: "3 May" })).toBe(true);
    expect(archiveAsks({ text: "  " })).toBe(false);
    const person = propsOf(blank, HostSelect).find((p) => p.label === "Person");
    expect((person?.options as { label: string }[]).map((o) => o.label)).toEqual(["Anyone", "Rosie Alvarez"]);
    (person?.onChange as (v: string) => void)("npc_rosie");
    expect(calls).toEqual([["query", { who: "npc_rosie", offset: 0 }]]);

    calls.length = 0;
    const found = render(ArchiveBody({ query: { text: "mug" }, people: PEOPLE, places: PLACES, result: HITS, busy: false, onQuery: log("query"), onSearch: log("search"), onMore: log("more"), onJump: log("jump") }));
    const text = textOf(found);
    expect(text).toContain("Message 12");
    expect(text).toContain("Tuesday 14 May, 08:40 · Bluebird Coffee · Rosie Alvarez, Sam Reyes");
    expect(text).toContain("3 beats");
    expect(text).toContain("Reached Sam Reyes (sight, hearing)");
    expect(text).toContain('couldn\'t read "the day after the storm"');
    tap(button(found, "Go to the message"));
    tap(button(found, "More"));
    expect(calls).toEqual([["jump", "m12"], ["more"]]);
    expect(textOf(render(ArchiveBody({ query: { text: "x" }, people: [], places: [], result: { hits: [], next: null, unread: [] }, busy: false, onQuery: log("q"), onSearch: log("s"), onMore: log("m"), onJump: log("j") })))).toContain("Nothing in the chat matches.");
  });
});

// ---------------------------------------------------------------- GM → Depth → Bootstrap

const ESTIMATE: BootstrapEstimate = {
  chatId: "c1",
  messages: 820,
  words: 1_640_000,
  tokens: 2_200_000,
  chunks: 74,
  minds: 9,
  stages: [
    { stage: "historian", calls: 74, tokensIn: 2_400_000, tokensOut: 400_000, cost: 18.5, ms: 7_200_000, connection: "Gateway", model: "big-model", measured: false },
    { stage: "minds", calls: 660, tokensIn: 5_000_000, tokensOut: 900_000, cost: null, ms: 9_000_000, connection: null, model: null, measured: true },
  ],
  total: { calls: 734, tokensIn: 7_400_000, tokensOut: 1_300_000, cost: 18.5, ms: 16_200_000 },
  notes: ["Minds assume the world's 9 characters until the author picks."],
  rss: null,
};

const CARD: SpotCheckCard = {
  id: "card1",
  // The run's chapter indices count from 0 (run.ts); the tab says them from 1, as the run's own lines do.
  chapter: 1,
  createdAt: 1,
  items: [
    { id: "i1", kind: "beat", mark: null, flagged: true, beat: "beat_40", what: "Rosie pockets the letter", quotes: "\"Not now.\"", message: "m40", index: 40, prose: "She slid the envelope into her apron." },
    { id: "i2", kind: "memory", mark: { right: true, note: "", at: 2 }, flagged: false, who: "npc_rosie", name: "Rosie Alvarez", path: "memories/0040.md", text: "I hid it before he saw.", lived: [{ beat: "beat_40", text: "She pockets the letter." }] },
  ],
};

function view(over: Partial<BootstrapView> = {}): BootstrapView {
  return {
    chatId: "c1",
    optedIn: true,
    status: "running",
    reason: null,
    startedAt: 1,
    updatedAt: 2,
    elapsedMs: 3_600_000,
    chunks: { done: 20, total: 74 },
    progress: [
      { stage: "historian", done: 20, total: 74, spent: { calls: 20, tokensIn: 600_000, tokensOut: 100_000, cost: 5, ms: 1_800_000 }, rss: 300 * 1_048_576 },
      { stage: "minds", done: 150, total: 660, spent: { ...NO_COUNTS, calls: 150 }, rss: null },
    ],
    chapters: [
      { n: 0, chunks: [0, 8], ended: true, spot: "reviewed" },
      { n: 1, chunks: [9, 19], ended: false, spot: "waiting" },
    ],
    spent: { calls: 170, tokensIn: 1_500_000, tokensOut: 300_000, cost: 5, ms: 3_600_000 },
    cap: { unit: "tokens", value: 20_000_000 },
    remaining: ESTIMATE,
    imported: [
      { source: "world_info", entries: 31, unreadable: null },
      { source: "cortex", entries: 0, unreadable: "Memory Cortex isn't readable by extensions on this host." },
    ],
    spot: [CARD],
    redoFrom: null,
    advice: [
      { system: "summary", found: true, text: "This chat has a summary. Depth holds its memory now: you may turn the summary off for it." },
      { system: "cortex", found: false, text: "Not used." },
    ],
    log: ["chunk 20: historian done"],
    ...over,
  };
}

function bootControls(over: Partial<BootstrapControls> = {}): BootstrapControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return { calls, busy: false, cap: { unit: "tokens", value: 20_000_000 }, onCap: log("cap"), onEstimate: log("estimate"), onStart: log("start"), onPause: log("pause"), onResume: log("resume"), notes: {}, onNote: log("note"), onMark: log("mark"), onRedo: log("redo"), onJump: log("jump"), ...over };
}

describe("GM → Depth → Bootstrap", () => {
  test("a running run shows progress per stage and chapter, spend against its cap, what the import read, the advice and its log, with Pause", () => {
    const c = bootControls();
    const tree = render(BootstrapBody({ view: view(), c }));
    const text = textOf(tree);
    expect(text).toContain("Running");
    expect(text).toContain("20 of 74 chunks · 1 h running");
    expect(text).toContain("Canon beats");
    // Resident memory per stage, where the stage has run (§8.5).
    expect(text).toContain("peak 300 MB");
    expect(text).not.toContain("Peak memory so far");
    expect(text).toContain("Chapter 2");
    expect(text).toContain("Chunks 10–20 · still open");
    expect(text).not.toContain("Chapter 0");
    expect(text).toContain("Spot check waiting");
    expect(text).toContain("Spent so far: 170 calls · 1.8M tokens · $5.00 · 1 h");
    expect(text).toContain("World Info");
    expect(text).toContain("Memory Cortex isn't readable");
    expect(text).toContain("you may turn the summary off");
    expect(text).not.toContain("Not used.");
    expect(text).toContain("The run's log (1)");
    expect(capUsed(view())).toBeCloseTo(0.09);
    expect(capUsed(view({ cap: { unit: "money", value: 10 }, spent: { ...NO_COUNTS } }))).toBeNull();
    tap(button(tree, "Pause"));
    expect(c.calls).toEqual([["pause"]]);
    expect(propsOf(tree, Button).some((p) => textOf(p.children).trim() === "Start")).toBe(false);
  });

  test("a spot check shows what it made beside its source; Wrong waits for a word on what's wrong, and each mark names its card and item", () => {
    const c = bootControls();
    const tree = render(BootstrapBody({ view: view(), c }));
    const text = textOf(tree);
    expect(text).toContain("Chapter 2: spot check");
    expect(text).toContain("1 of 2 marked");
    expect(text).toContain("Rosie pockets the letter");
    expect(text).toContain("She slid the envelope into her apron.");
    expect(text).toContain("Flagged as uncertain");
    expect(text).toContain("I hid it before he saw.");
    const wrong = propsOf(tree, Button).filter((p) => textOf(p.children).trim() === "Wrong");
    expect(wrong[0]?.disabled).toBe(true);
    tap(propsOf(tree, Button).filter((p) => textOf(p.children).trim() === "Right")[0] ?? {});
    tap(propsOf(tree, Button).filter((p) => textOf(p.children).trim() === "Go to the message")[0] ?? {});
    const noted = bootControls({ notes: { i1: "She burned it, she didn't pocket it" } });
    const withNote = render(BootstrapBody({ view: view(), c: noted }));
    tap(propsOf(withNote, Button).filter((p) => textOf(p.children).trim() === "Wrong")[0] ?? {});
    expect(c.calls).toEqual([["mark", "card1", "i1", true, ""], ["jump", "m40"]]);
    expect(noted.calls).toEqual([["mark", "card1", "i1", false, "She burned it, she didn't pocket it"]]);
  });

  test("paused after a run of wrong marks it offers Redo from that chapter and Resume under the cap; a chat off depth says where to opt in", () => {
    const c = bootControls({ cap: "none" });
    const tree = render(BootstrapBody({ view: view({ status: "paused", reason: "Three wrong marks in a row.", redoFrom: 1 }), c }));
    const text = textOf(tree);
    expect(text).toContain("Three wrong marks in a row.");
    expect(propsOf(tree, HostSwitch).find((p) => p.label === "No cap")?.checked).toBe(true);
    tap(button(tree, "Redo from chapter 2"));
    tap(button(tree, "Resume"));
    expect(c.calls).toEqual([["redo", 1], ["resume"]]);
    expect(textOf(render(BootstrapBody({ view: view({ optedIn: false }), c })))).toContain("GM → This chat → Depth");
  });
});

// ---------------------------------------------------------------- GM → This chat → Depth

function chatControls(): DepthChatControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return { calls, busy: false, cap: { unit: "tokens", value: 20_000_000 }, onCap: log("cap"), onEstimate: log("estimate"), onOptIn: log("in"), onOptOut: log("out"), onOpenBootstrap: log("open"), onOpenLoopback: log("loopback"), onHistory: log("history") };
}

describe("GM → This chat → Depth", () => {
  test("off, it offers the bootstrap with its estimate per stage on the chosen models, its cap, and both ways in", () => {
    const off = view({ optedIn: false, status: "idle", remaining: null });
    const none = chatControls();
    const bare = render(DepthChatBody({ view: off, estimate: null, c: none }));
    expect(textOf(bare)).toContain("Not surveyed yet");
    expect(button(bare, "Turn on depth and start the bootstrap").disabled).toBe(true);
    tap(button(bare, "Survey and estimate"));
    expect(none.calls).toEqual([["estimate"]]);

    const c = chatControls();
    const tree = render(DepthChatBody({ view: { ...off, status: "estimated" }, estimate: { ...ESTIMATE, rss: 412 * 1_048_576 }, c }));
    expect(textOf(tree)).toContain("Peak memory so far: 412 MB");
    const text = textOf(tree);
    expect(text).toContain("820 messages · 1,640,000 words · 2.2M tokens · 74 chunks · 9 minds");
    expect(text).toContain("Canon beats");
    expect(text).toContain("Gateway · big-model · first guess");
    expect(text).toContain("The helper model's connection · measured on this chat");
    expect(text).toContain("74 calls · 2.8M tokens · $18.50 · 2 h");
    expect(text).toContain("price unknown");
    expect(text).toContain("In all");
    expect(text).toContain("Minds assume the world's 9 characters");
    expect(text).toContain("20M tokens");
    expect(propsOf(tree, Seg).find((p) => p.label === "Cap in")?.value).toBe("tokens");
    tap(button(tree, "Turn on depth and start the bootstrap"));
    tap(button(tree, "Turn on depth without the bootstrap"));
    expect(c.calls).toEqual([["in", true], ["in", false]]);
    // One of each says it as one, as the live run's single greeting showed.
    const one = textOf(render(DepthChatBody({ view: { ...off, status: "estimated" }, estimate: { ...ESTIMATE, messages: 1, words: 1, chunks: 1, minds: 1 }, c: chatControls() })));
    expect(one).toContain("1 message · 1 word · 2.2M tokens · 1 chunk · 1 mind");
  });

  test("on, it says how the bootstrap stands, opens it, and turns depth off", () => {
    const c = chatControls();
    const tree = render(DepthChatBody({ view: view(), estimate: null, c }));
    const text = textOf(tree);
    expect(text).toContain("Depth is on");
    expect(text).toContain("Bootstrap: running · 20 of 74 chunks");
    tap(button(tree, "Open the bootstrap"));
    tap(button(tree, "Turn depth off"));
    expect(c.calls).toEqual([["open"], ["out"]]);
    expect(text).toContain(EXPORT_NOTE);
    expect(textOf(render(BootstrapBody({ view: view(), c: bootControls() })))).toContain(EXPORT_NOTE);
    expect(textOf(render(DepthChatBody({ view: view({ optedIn: false }), estimate: null, c: chatControls() })))).not.toContain(EXPORT_NOTE);
  });

  test("on, History says what a turn's request carries, and sets the chat's cutoff", () => {
    const c = chatControls();
    const tree = render(DepthChatBody({ view: view({ history: { keep: "last", count: 12 } }), estimate: null, c }));
    expect(textOf(tree)).toContain("A turn's request carries only the latest 12 messages of this chat");
    const [seg] = propsOf(tree, Seg);
    (seg?.onChange as (keep: string) => void)("from");
    const [stepper] = propsOf(tree, NumberStepper);
    expect(stepper?.label).toBe("Messages kept");
    (stepper?.onChange as (n: number) => void)(30);
    expect(c.calls).toEqual([
      ["history", { keep: "from", index: 0 }],
      ["history", { keep: "last", count: 30 }],
    ]);
    // A chat that never set one shows the default.
    expect(textOf(render(DepthChatBody({ view: view(), estimate: null, c: chatControls() })))).toContain("only the latest 40 messages");
  });

  test("a refused opt-in says why, with Settings → Loopback; none shown, no banner", () => {
    const off = view({ optedIn: false, status: "estimated" });
    const c = chatControls();
    const why = "Depth can't start on this chat yet. No relay carries your replies yet: start one with the line in Settings → Loopback.";
    const tree = render(DepthChatBody({ view: off, estimate: ESTIMATE, unready: why, c }));
    expect(textOf(tree)).toContain(why);
    tap(button(tree, "Settings → Loopback"));
    expect(c.calls).toEqual([["loopback"]]);
    expect(textOf(render(DepthChatBody({ view: off, estimate: ESTIMATE, unready: null, c: chatControls() })))).not.toContain("Depth needs the loopback");
  });
});

// ---------------------------------------------------------------- GM → Depth → Drafts

const SALE: DepthDraft = {
  id: "d2",
  state: "open",
  changed: ["Dev Patel's mind"],
  summary: "Dev sells his boat to a buyer from the next town.",
  at: "Tuesday 14 May 2026, 9:00 PM",
  span: "Tuesday 14 May 2026, 9:00 PM, for 45 min",
  places: ["The marina"],
  people: ["Dev Patel"],
  why: "The bank calls in Dev's loan on Friday.",
  parts: [
    { subject: "Dev Patel", treatment: "live", rationale: "his choice decides what he owes" },
    { subject: "the buyer", treatment: "written", rationale: "a walk-on" },
  ],
  beats: [
    { at: "Tuesday 14 May 2026, 9:00 PM", what: "A buyer from the next town walks down the dock.", surface: "A stranger in a rain jacket walks down the dock.", perceived: ["Dev Patel"] },
    { at: "Tuesday 14 May 2026, 9:20 PM", what: "Dev sells the boat for ten thousand.", surface: "Cash changes hands; the keys go with it.", quotes: "Ten thousand, and she's yours.", perceived: ["Dev Patel", "Rosie Alvarez (in part)"] },
  ],
  effects: ["boat_sold is now yes"],
  holds: ["Dev Patel from Tuesday 14 May 2026, 9:00 PM", "The marina from Tuesday 14 May 2026, 9:00 PM"],
  basis: { messageId: "m12", index: 12 },
  reasoning: "The author: the loan leaves him no other way.",
  pins: 2,
};

const DRAFTS: DepthDraftsView = {
  on: true,
  drafts: [
    SALE,
    { ...SALE, id: "d1", state: "settled", changed: [], summary: "Rosie closes the cafe early.", pins: 4, settle: { messageId: "m10", index: 10, why: "Nothing Sam saw says otherwise.", reasoning: "It fits the evening.", beats: 3 } },
    { ...SALE, id: "d0", state: "dropped", changed: ["the author's notebook"], summary: "Sam's sister visits.", drop: { messageId: "m9", index: 9, why: "The story overtook it.", reasoning: "" } },
  ],
};

function draftsControls(over: Partial<DraftsControls> = {}): DraftsControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return { calls, busy: false, open: null, onOpen: log("open"), onSettle: log("settle"), onDrop: log("drop"), onRedraft: log("redraft"), onJump: log("jump"), ...over };
}

describe("GM → Depth → Drafts", () => {
  test("lists every draft on the chain newest first with its state, an open one stale where what it read changed; each opens as its page", () => {
    expect(DEPTH_TABS).toContain("drafts");
    const c = draftsControls();
    const tree = render(DraftsBody({ view: DRAFTS, c }));
    const rows = propsOf(tree, ListRow);
    expect(rows.map((r) => r.title)).toEqual(["Dev sells his boat to a buyer from the next town.", "Rosie closes the cafe early.", "Sam's sister visits."]);
    expect(rows.map((r) => textOf(render(r.badge)))).toEqual(["Open Stale", "Settled ", "Dropped "]);
    expect(textOf(tree)).toContain("Drafts (3, 1 open)");
    (rows[0]?.onClick as () => void)();
    expect(c.calls).toEqual([["open", "d2"]]);
  });

  test("an open draft's page shows its episode, each part's treatment with the author's grade, its beats, holds and thinking, and takes Settle now, Re-draft and Drop", () => {
    const c = draftsControls({ open: "d2" });
    const page = render(DraftsBody({ view: DRAFTS, c }));
    const text = textOf(page);
    for (const part of [
      "Drafted at message 12",
      "What it read has changed since it was drafted: Dev Patel's mind",
      "2 beats so far",
      "Tuesday 14 May 2026, 9:00 PM, for 45 min",
      "The marina",
      "The bank calls in Dev's loan on Friday.",
      "Live",
      "his choice decides what he owes",
      "Written",
      "a walk-on",
      "Beats (2)",
      "perceived by Dev Patel, Rosie Alvarez (in part)",
      "What there was to sense: Cash changes hands; the keys go with it.",
      "“Ten thousand, and she's yours.”",
      "boat_sold is now yes",
      "The marina from Tuesday 14 May 2026, 9:00 PM",
      "no one plays or catches up past it",
      "The author: the loan leaves him no other way.",
    ])
      expect(text).toContain(part);
    tap(button(page, "Settle now"));
    tap(button(page, "Re-draft"));
    tap(button(page, "Drop"));
    tap(button(page, "Go to message 12"));
    tap(propsOf(page, IconButton).find((p) => p.label === "Back to Drafts") ?? {});
    expect(c.calls).toEqual([["settle", "d2"], ["redraft", "d2"], ["drop", "d2"], ["jump", "m12"], ["open", null]]);
    expect(button(render(DraftsBody({ view: DRAFTS, c: draftsControls({ open: "d2", busy: true }) })), "Drop").disabled).toBe(true);
  });

  test("a settled or dropped draft shows the author's verdict and takes no press; a chat off depth says how to opt in", () => {
    const settled = render(DraftsBody({ view: DRAFTS, c: draftsControls({ open: "d1" }) }));
    const text = textOf(settled);
    expect(text).toContain("Settled at message 10");
    expect(text).toContain("3 beats made canon, read against 4 pins");
    expect(text).toContain("Nothing Sam saw says otherwise.");
    expect(text).toContain("It fits the evening.");
    expect(propsOf(settled, Button).filter((p) => ["Settle now", "Re-draft", "Drop"].includes(textOf(p.children).trim()))).toEqual([]);
    const dropped = textOf(render(DraftsBody({ view: DRAFTS, c: draftsControls({ open: "d0" }) })));
    expect(dropped).toContain("Dropped at message 9");
    expect(dropped).toContain("The story overtook it.");
    expect(dropped).toContain("No thinking was kept.");
    // Stale only says so while open.
    expect(dropped).not.toContain("What it read has changed");
    expect(textOf(render(DraftsBody({ view: DRAFTS, c: draftsControls({ open: "gone" }) })))).toContain("no longer on this chat's chain");
    expect(textOf(render(DraftsBody({ view: { on: true, drafts: [] }, c: draftsControls() })))).toContain("No drafts yet");
    expect(textOf(render(DraftsBody({ view: { on: false, drafts: [] }, c: draftsControls() })))).toContain("GM → This chat → Depth");
  });
});

// ---------------------------------------------------------------- GM → Depth → Treatments

const PUT_OFF = "The author's poll: who catches up and reflects, and what happens off screen: this turn has spent 610K tokens, at its ceiling of 600K (Settings → Depth → Budget → Per turn)";

const TREATMENTS: DepthTreatmentsView = {
  on: true,
  asks: [
    {
      chip: "allowance:m14:0:e1",
      label: "Dev Patel's part wants a live treatment; this story week's 2 are spent. Spend one more?",
      detail: "The bank calls in Dev's loan on Friday. · Dev Patel's part: his choice decides what he owes · Keep to the allowance drafts it a step down the ladder.",
      at: { messageId: "m14", index: 14 },
      actions: [
        { id: "spend", label: "Spend one more", primary: true },
        { id: "keep", label: "Keep to the allowance" },
      ],
    },
  ],
  log: [
    { kind: "episode", title: "Dev sells his boat to a buyer from the next town.", when: "Tuesday 14 May 2026, 9:00 PM", at: { messageId: "m12", index: 12 }, lines: [{ subject: "Dev Patel", depth: "Live", why: "his choice decides what he owes" }, { subject: "the buyer", depth: "Written", why: "a walk-on" }], cost: { calls: 6, tokens: 41_000, reasoning: 12_000, money: 0.42 }, put: [], state: "settled" },
    { kind: "after", title: "After the reply", when: null, at: { messageId: "m12", index: 12 }, lines: [], cost: { calls: 1, tokens: 1200 }, put: [PUT_OFF] },
    { kind: "ask", title: "The storm wants a room treatment; this story week's allowance is none.", when: null, at: { messageId: "m10", index: 10 }, lines: [{ subject: "the storm", depth: "Room", why: "the town will talk of nothing else (judged major)" }], put: [], state: "kept" },
    { kind: "scene", title: "Scene at Bluebird Coffee", when: "Tuesday 14 May 2026, 8:40 AM", at: { messageId: "m10", index: 10 }, lines: [{ subject: "Rosie Alvarez", depth: "Its own agent", why: "the warning is hers" }, { subject: "Sam's sister visits.", depth: "Walk-on", why: "Settled before the scene played past it" }], cost: { calls: 9, tokens: 88_000 }, put: [] },
  ],
  meter: [
    {
      label: "Story week: Monday 13 May 2026 – Sunday 19 May 2026",
      now: true,
      total: { calls: 16, tokens: 130_200, money: 0.42 },
      lanes: [
        { lane: "scene", cost: { calls: 9, tokens: 88_000 } },
        { lane: "after", cost: { calls: 1, tokens: 1200 } },
        { lane: "offscreen", cost: { calls: 6, tokens: 41_000, money: 0.42 } },
      ],
      treatments: [{ treatment: "live", episodes: 1, cost: { calls: 6, tokens: 41_000, money: 0.42 } }],
      roles: [
        { role: "author", cost: { calls: 5, tokens: 60_000 } },
        { role: "character", cost: { calls: 11, tokens: 70_200 } },
      ],
      grades: [{ episode: "Dale sells the boat", subject: "Dale", depth: "Live", why: "It changes what Dev owes him." }],
    },
    { label: "Story week: Monday 6 May 2026 – Sunday 12 May 2026", now: false, total: { calls: 2, tokens: 900 }, lanes: [], treatments: [], roles: [], grades: [] },
  ],
  interval: "Story week: Monday 13 May 2026 – Sunday 19 May 2026",
  allowances: [
    { treatment: "live", allowance: 2, spent: 2 },
    { treatment: "campfire", allowance: 4, spent: 1 },
    { treatment: "room", allowance: 0, spent: 0 },
    { treatment: "written", allowance: null, spent: 3 },
  ],
  ceilings: [
    { which: "turn", limit: 600_000, spent: 130_200, of: "The latest turn, at message 14: its scene, the step after its reply and the work off screen that step started", reached: false },
    { which: "day", limit: 30_000_000, spent: 30_000_000, of: "Today, 2026-11-07, a UTC day (it starts again at midnight UTC): depth's work in every chat, the bootstrap apart", reached: true },
  ],
  ask: true,
  threshold: "Anything that changes what someone owes or loves.",
  level: "balanced",
};

function treatmentsControls(over: Partial<TreatmentsControls> = {}): TreatmentsControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return { calls, busy: false, tab: "log", onTab: log("tab"), onAnswer: log("answer"), onJump: log("jump"), ...over };
}

describe("GM → Depth → Treatments", () => {
  test("the asks waiting on you answer as their chips do; the log shows each piece of work newest first, with each part's depth and the author's reason, its cost and what a ceiling put off", () => {
    expect(DEPTH_TABS).toEqual(["notebook", "drafts", "treatments", "turn", "archive", "bootstrap"]);
    const c = treatmentsControls();
    const tree = render(TreatmentsBody({ view: TREATMENTS, c }));
    const text = textOf(tree);
    for (const part of [
      "Waiting on you (1)",
      "Dev Patel's part wants a live treatment; this story week's 2 are spent. Spend one more?",
      "Keep to the allowance drafts it a step down the ladder.",
      "At message 14",
      "Dev sells his boat to a buyer from the next town.",
      "Tuesday 14 May 2026, 9:00 PM · message 12",
      "Off screen",
      "Settled",
      "his choice decides what he owes",
      "6 calls · 41K tokens, 12K of them reasoning · $0.42",
      "After the reply",
      "1 call · 1K tokens",
      "Put off by a ceiling",
      PUT_OFF,
      "Ask me",
      "Kept to the allowance",
      "the town will talk of nothing else (judged major)",
      "Scene at Bluebird Coffee",
      "On screen",
      "Its own agent",
      "the warning is hers",
      "Walk-on",
      "Settled before the scene played past it",
    ])
      expect(text).toContain(part);
    // Newest first, as the backend ordered them.
    expect(text.indexOf("Dev sells his boat")).toBeLessThan(text.indexOf("Scene at Bluebird Coffee"));
    tap(button(tree, "Spend one more"));
    tap(propsOf(tree, Button).find((p) => textOf(p.children).trim() === "Keep to the allowance") ?? {});
    tap(button(tree, "Go to message 14"));
    tap(propsOf(tree, Button).filter((p) => p.label === "Go to message 12")[0] ?? {});
    (propsOf(tree, Seg).find((p) => p.label === "Treatments")?.onChange as (t: TreatmentsTab) => void)("meter");
    expect(c.calls).toEqual([["answer", "allowance:m14:0:e1", "spend"], ["answer", "allowance:m14:0:e1", "keep"], ["jump", "m14"], ["jump", "m12"], ["tab", "meter"]]);
    expect(propsOf(render(TreatmentsBody({ view: TREATMENTS, c: treatmentsControls({ busy: true }) })), Button).filter((p) => p.disabled === true).map((p) => textOf(p.children).trim())).toEqual(["Spend one more", "Keep to the allowance"]);
  });

  test("the meter shows each story interval per lane, per treatment and per role; the budget its ceilings, this interval's allowances, Ask me and the threshold", () => {
    const meter = textOf(render(TreatmentsBody({ view: TREATMENTS, c: treatmentsControls({ tab: "meter" }) })));
    for (const part of ["Story week: Monday 13 May 2026 – Sunday 19 May 2026", "Now", "16 calls · 130K tokens · $0.42", "On screen", "9 calls · 88K tokens", "Off screen, per treatment", "Live", "1 episode", "Per role", "Author", "Character agents", "11 calls · 70K tokens", "Story week: Monday 6 May 2026 – Sunday 12 May 2026", "a swipe that discarded a turn gives back what it spent here"]) expect(meter).toContain(part);
    const budget = render(TreatmentsBody({ view: TREATMENTS, c: treatmentsControls({ tab: "budget" }) }));
    expect(propsOf(budget, Meter).map((p) => [p.label, p.value, p.max, p.tone])).toEqual([
      ["Per turn", 130_200, 600_000, "accent"],
      ["Per day", 30_000_000, 30_000_000, "warn"],
      ["Live", 2, 2, "warn"],
      ["Campfire", 1, 4, "accent"],
      ["Room", 0, 0, "warn"],
    ]);
    const text = textOf(budget);
    for (const part of ["130K of 600K tokens", "The latest turn, at message 14", "30M of 30M tokens", "a UTC day (it starts again at midnight UTC)", "Reached: the author's own work waits for the next UTC day", "Your own presses always run, and are counted.", "Story week: Monday 13 May 2026 – Sunday 19 May 2026", "2 of 2 spent", "1 of 4 spent", "0 of 0 spent", "Written", "3 spent · no limit", "Ask me is on", "Anything that changes what someone owes or loves."]) expect(text).toContain(part);
    expect(text).not.toContain("Reached: the turn spent no more");
    expect(textOf(render(TreatmentsBody({ view: { ...TREATMENTS, ask: false }, c: treatmentsControls({ tab: "budget" }) })))).toContain("Ask me is off");
  });

  test("a chat off depth says how to opt in; nothing yet says so", () => {
    const none: DepthTreatmentsView = { ...TREATMENTS, on: true, asks: [], log: [], meter: [] };
    expect(textOf(render(TreatmentsBody({ view: { ...none, on: false }, c: treatmentsControls() })))).toContain("GM → This chat → Depth");
    const log = textOf(render(TreatmentsBody({ view: none, c: treatmentsControls() })));
    expect(log).toContain("Nothing yet");
    expect(log).not.toContain("Waiting on you");
    expect(textOf(render(TreatmentsBody({ view: none, c: treatmentsControls({ tab: "meter" }) })))).toContain("Nothing spent on this chat's chain yet.");
  });
});
