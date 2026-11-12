// The story engine's pages (src/frontend/story/): what Cast, Record, Notebook, the prepared start
// and Settings → Story → Models say of what the backend answers, and what the pickers of an agent's
// connection say of the runtime's own connections, read without a DOM.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { NARRATION_BOUNDS, NARRATION_DEFAULTS, STORY_DEFAULTS, type StoryModels } from "../../src/shared/settings";
import type { BeatView, CastRowView, DraftView, PrepareAsk, PrepareView } from "../../src/shared/story-pages";
import { Banner, Button, Seg } from "../../src/frontend/components";
import { NoConnectionNotice } from "../../src/frontend/gm/engine";
import { modelsNotices, narrationChanged, narrationSummary, StorySubPage } from "../../src/frontend/settings/story";
import { agentConnections, type KnownConnections, NO_CONNECTION, notTheRuntimes, notTheRuntimesMark, notTheRuntimesText, unsetText } from "../../src/frontend/story/connections";
import { savedWords } from "../../src/frontend/story/editor";
import { lastReflected, mindEntries, notebookFiles, type StoryFile } from "../../src/frontend/story/files";
import { ModelPickRows, runsOnText, RuntimeModelField } from "../../src/frontend/story/model-pick";
import { agoText, beatHead, capOf, castGroups, castLine, characterAsk, draftsInOrder, exposureLine, pickedBy, prepareBusy, prepareShown, reachedLine, reachedText, stretchText, tokensText } from "../../src/frontend/story/model";
import { PrepareBody, PrepareLine, PrepareQuiet, prepareSlot, type PrepareTyped } from "../../src/frontend/story/prepare";
import { replyLabel } from "../../src/frontend/story/record";
import { expand, propsOf, type Props } from "../support/tree";

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The runtime's connections as LumiAH's pages know them: DeepSeek, copied from Lumiverse under its own id and the default, and Claude, signed in. */
const KNOWN: KnownConnections = {
  list: [
    { id: "c1", name: "DeepSeek", label: "DeepSeek · DeepSeek · v4", model: "v4" },
    { id: "rc-claude", name: "Claude", label: "Claude · Anthropic · claude-sonnet-4-5", model: "claude-sonnet-4-5" },
  ],
  default: "c1",
  runtime: { id: "rt-home", name: "home-pc" },
  linked: true,
  runtimes: 1,
  chat: true,
  failed: null,
};
/** Lumiverse's own connections: DeepSeek, which the runtime has under the same id, and Deepseek Pro, chosen before the runtime kept connections and never copied into it. */
const LUMIVERSE = [
  { id: "c1", name: "DeepSeek", model: "v4" },
  { id: "c-pro", name: "Deepseek Pro", model: "v4-pro" },
];
const CONNECTIONS = agentConnections(KNOWN, LUMIVERSE);

const names = { player: "Sam", npc_rosie: "Rosie", npc_dev: "Dev", diner: "Rosie's Diner" };
const time = (at: number) => ({ at, text: `t${at}` });
const row = (entity: string, standing: CastRowView["standing"], extra: Partial<CastRowView> = {}): CastRowView => ({ entity, standing, why: null, pinned: false, mind: null, digested: null, waiting: 0, ...extra });
const beat = (over: Partial<BeatView>): BeatView => ({ id: "b", kind: "say", time: time(10), where: "diner", by: "npc_rosie", what: "w", surface: "s", quotes: [], to: [], exposure: [], decidedBy: { agent: "author", as: null }, settles: null, struck: null, past: false, ...over });

describe("Cast", () => {
  test("the player's character first, then each standing's group in the story's order, empty groups left out", () => {
    const { you, groups } = castGroups([row("npc_teo", "extra"), row("player", "principal"), row("npc_rosie", "principal"), row("npc_mara", "principal")]);
    expect(you?.entity).toBe("player");
    expect(groups.map((g) => [g.standing, g.rows.map((r) => r.entity)])).toEqual([
      ["principal", ["npc_rosie", "npc_mara"]],
      ["extra", ["npc_teo"]],
    ]);
  });

  test("a row says the standing, the pin, and what waits for their mind", () => {
    expect(castLine(row("npc_rosie", "principal", { pinned: true, waiting: 2 }))).toBe("Principal · pinned by you · 2 beats not taken in yet");
    expect(castLine(row("player", "principal", { waiting: 1 }))).toBe("Your character · 1 beat not taken in yet");
  });

  test("what reached someone says how: their own, all of it, part of it, or told by whom", () => {
    expect(reachedText({ beat: "b1", time: time(1), where: "diner", digested: true, reach: "whole", by: "world", surface: "Water seeps in." }, names).head).toBe("From the world, all of it · Rosie's Diner");
    expect(reachedText({ beat: "b2", time: time(2), where: null, digested: false, reach: "told", got: "The storeroom floods.", from: "npc_rosie" }, names)).toEqual({ head: "Told by Rosie", text: "The storeroom floods.", quotes: [] });
    expect(reachedText({ beat: "b3", time: time(3), where: null, digested: false, reach: "own", kind: "inner", what: "Will Mara pay?" }, names).head).toBe("Their own: they thought");
  });

  test("what a character runs on follows the ladder, each member from the level that picks it", () => {
    const models: StoryModels = { ...STORY_DEFAULTS.models, default: { effort: "high" }, characters: { npc_rosie: { connectionId: "c1" } } };
    const scene = pickedBy(models, characterAsk("npc_rosie", "scene"));
    expect(scene).toEqual({ connection: "character", model: null, effort: "default", pick: { connectionId: "c1", effort: "high" } });
    expect(runsOnText(scene, CONNECTIONS)).toEqual({ line: "DeepSeek · effort high", note: "Set by this character and the default." });
    expect(pickedBy({ ...models, runs: { digest: { effort: "low" } } }, characterAsk("npc_rosie", "digest")).effort).toBe("run");
    expect(runsOnText(pickedBy(STORY_DEFAULTS.models, characterAsk("npc_dev", "scene")), CONNECTIONS)).toEqual({ line: "Nothing set", note: "With no connection set, an agent runs on the runtime's default connection (now DeepSeek)." });
    const old = runsOnText(pickedBy({ ...STORY_DEFAULTS.models, default: { connectionId: "c-pro" } }, characterAsk("npc_dev", "scene")), CONNECTIONS);
    expect(old.line).toBe("Deepseek Pro");
    expect(old.note).toBe("Its connection, set by the default: Deepseek Pro is one of Lumiverse's connections, not one of the runtime's, so it runs on the runtime's default, DeepSeek. Pick another below, or in Settings → Story → Models, or copy it into the runtime (Harness → System → Runtime → Connections → Copy from Lumiverse): the copy keeps its id, so this choice works again.");
  });
});

describe("the connections an agent may run on", () => {
  test("are the runtime's own, each in LumiAH's words, with its default; none is offered while they aren't known, and the page says why", () => {
    expect(CONNECTIONS.choices?.map((c) => [c.id, c.label])).toEqual([
      ["c1", "DeepSeek · DeepSeek · v4"],
      ["rc-claude", "Claude · Anthropic · claude-sonnet-4-5"],
    ]);
    expect([CONNECTIONS.fallback?.name, CONNECTIONS.runtime, CONNECTIONS.waiting, CONNECTIONS.whose, CONNECTIONS.none]).toEqual(["DeepSeek", "rt-home", null, null, false]);
    const unread = { ...KNOWN, list: null, default: null, runtime: null };
    expect(agentConnections({ ...unread, linked: false }, LUMIVERSE).waiting).toBe("The agents' connections are kept in the runtime, so they show once it is linked. Harness → System → Runtime shows how to start it.");
    expect(agentConnections(unread, LUMIVERSE).waiting).toBe("Reading the runtime's connections…");
    expect(agentConnections({ ...unread, failed: "it didn't answer" }, LUMIVERSE).waiting).toBe("The runtime's connections couldn't be read: it didn't answer");
    expect(agentConnections(null, LUMIVERSE)).toMatchObject({ choices: null, waiting: "The harness's pages aren't loaded in this LumiRPEngine, so the runtime's connections can't be read. Reload the page to try again." });
    // Each runtime keeps its own: where several are linked, the picker says whose these are.
    expect(agentConnections({ ...KNOWN, runtimes: 2 }, LUMIVERSE).whose).toBe("These are the connections of home-pc, the runtime that plays this chat. Each runtime keeps its own, and an agent runs on those of the runtime its chat runs in.");
  });

  test("a level saved on one of Lumiverse's connections, from before the runtime kept its own, keeps it, says what runs instead and how to choose again, and offers the default's models", () => {
    const set: unknown[] = [];
    const pick = { connectionId: "c-pro", effort: "high" as const };
    expect(notTheRuntimes(pick, CONNECTIONS)).toBe(true);
    const tree = ModelPickRows({ id: "agent-narrator", owner: "The narrator", pick, fallsTo: "the default", connections: CONNECTIONS, busy: false, set: (fields) => set.push(fields) });
    expect(propsOf(tree, "option").slice(0, 4).map((o) => [o.value, textOf(o.children)])).toEqual([
      ["", "Not set: the default"],
      ["c-pro", "Deepseek Pro (not one of the runtime's connections: runs on its default)"],
      ["c1", "DeepSeek · DeepSeek · v4"],
      ["rc-claude", "Claude · Anthropic · claude-sonnet-4-5"],
    ]);
    expect(notTheRuntimesMark(CONNECTIONS)).toBe("not one of the runtime's connections: runs on its default");
    expect(textOf(tree)).toContain(notTheRuntimesText("c-pro", CONNECTIONS));
    // Nothing is dropped: the choice stays as saved until one is picked.
    expect(propsOf(tree, "select")[0]?.value).toBe("c-pro");
    expect(set).toEqual([]);
    // It runs on the default now, so the model field lists the default's models (null: the default).
    expect(propsOf(tree, RuntimeModelField).map((p) => [p.runtime, p.connection])).toEqual([["rt-home", null]]);
    // Picking again sends the new connection, and the model goes with the old one.
    const select = propsOf(tree, "select")[0];
    if (typeof select?.onChange !== "function") throw new Error("no connection select");
    select.onChange({ currentTarget: { value: "rc-claude" } });
    expect(set).toEqual([{ connectionId: "rc-claude", model: null }]);
  });

  test("a level on one of the runtime's connections offers that connection's models; one with no connection lists none", () => {
    const on = ModelPickRows({ id: "agent-author", owner: "The author", pick: { connectionId: "rc-claude" }, fallsTo: "the default", connections: CONNECTIONS, busy: false, set: () => undefined });
    expect(propsOf(on, RuntimeModelField).map((p) => [p.runtime, p.connection])).toEqual([["rt-home", "rc-claude"]]);
    expect(textOf(on)).not.toContain(notTheRuntimesMark(CONNECTIONS));
    const off = ModelPickRows({ id: "agent-gm", owner: "The game master", pick: { effort: "low" }, fallsTo: "the default", connections: CONNECTIONS, busy: false, set: () => undefined });
    expect(propsOf(off, RuntimeModelField).map((p) => "connection" in p)).toEqual([false]);
  });

  test("the default, with no connection set, says in a line that the runtime's default runs it, by name", () => {
    const tree = ModelPickRows({ id: "default", owner: "Every agent", pick: undefined, connections: CONNECTIONS, busy: false, set: () => undefined });
    expect(textOf(tree)).toContain("With no connection set, an agent runs on the runtime's default connection (now DeepSeek).");
    expect(textOf(tree)).not.toContain("Lumiverse's default connection");
    expect(unsetText({ choices: CONNECTIONS.choices, fallback: null })).toContain("the runtime has none now, so its calls are refused");
  });

  test("a level saved on a connection the runtime doesn't have, where the runtime has no default, says its calls are refused, never that it runs on a default", () => {
    const none = agentConnections({ ...KNOWN, list: [], default: null }, LUMIVERSE);
    const tree = ModelPickRows({ id: "agent-narrator", owner: "The narrator", pick: { connectionId: "c-pro" }, fallsTo: "the default", connections: none, busy: false, set: () => undefined });
    expect(propsOf(tree, "option").slice(0, 2).map((o) => [o.value, textOf(o.children)])).toEqual([
      ["", "Not set: the default"],
      ["c-pro", "Deepseek Pro (not one of the runtime's connections, and the runtime has no default: refused)"],
    ]);
    expect(textOf(tree)).toContain("Deepseek Pro is one of Lumiverse's connections, not one of the runtime's, and the runtime has no default connection, so its calls are refused.");
    expect(textOf(tree)).not.toContain("runs on its default");
    // Models counts it, in the same words.
    expect(modelsNotices({ ...STORY_DEFAULTS.models, agents: { narrator: { connectionId: "c-pro" } } }, none).map((n) => [n.id, n.text])).toEqual([
      ["none", NO_CONNECTION.text],
      ["not-runtimes", "It was made before the runtime kept connections of its own, or its connection was removed since. Until you choose again, its agents' calls are refused, since the runtime has no default connection: each is marked below. Copy from Lumiverse, in Harness → System → Runtime → Connections, copies a connection of yours into the runtime under its own id, so a choice of it works again."],
    ]);
  });

  test("with no connection made yet, the picker, Models and Play say so, and how: add one or Copy from Lumiverse, in Harness → System → Runtime → Connections", () => {
    const none = agentConnections({ ...KNOWN, list: [], default: null }, LUMIVERSE);
    expect(none.none).toBe(true);
    const tree = ModelPickRows({ id: "default", owner: "Every agent", pick: undefined, connections: none, busy: false, set: () => undefined });
    expect(textOf(tree)).toContain(NO_CONNECTION.line);
    expect(NO_CONNECTION.line).toContain("Harness → System → Runtime → Connections");
    expect(NO_CONNECTION.text).toContain("Copy from Lumiverse");
    expect(modelsNotices(STORY_DEFAULTS.models, none).map((n) => [n.id, n.title])).toEqual([["none", "Your runtime has no connection yet"]]);
    // Play: the notice, with the way there where the drawer can open it.
    let opened = 0;
    const notice = NoConnectionNotice({ engine: "harness", none: true, onOpen: () => (opened += 1) });
    const [banner] = propsOf(notice, Banner);
    expect([banner?.title, textOf(banner?.children)]).toEqual([NO_CONNECTION.title, NO_CONNECTION.text]);
    const [open] = propsOf(banner?.actions, Button);
    expect(textOf(open?.children)).toBe("Open Connections");
    if (typeof open?.onClick !== "function") throw new Error("nothing to press");
    open.onClick();
    expect(opened).toBe(1);
    expect(propsOf(NoConnectionNotice({ engine: "harness", none: true, onOpen: null }), Banner)[0]?.actions).toBeUndefined();
    // Nothing while the runtime has one, or for a chat on another engine.
    expect(NoConnectionNotice({ engine: "harness", none: false, onOpen: null })).toBeNull();
    expect(NoConnectionNotice({ engine: "classic", none: true, onOpen: null })).toBeNull();
    // While the runtime's list isn't known, nothing is said to be missing.
    expect(agentConnections({ ...KNOWN, list: null, default: null, linked: false }, LUMIVERSE).none).toBe(false);
  });

  test("Models counts the choices that name a connection the runtime doesn't have, with what their agents run on until they are chosen again", () => {
    const models: StoryModels = { ...STORY_DEFAULTS.models, default: { connectionId: "c1" }, agents: { narrator: { connectionId: "c-pro" } }, characters: { npc_rosie: { connectionId: "gone" } } };
    expect(modelsNotices(models, CONNECTIONS)).toEqual([
      {
        id: "not-runtimes",
        title: "2 choices name connections the runtime doesn't have",
        text: "They were made before the runtime kept connections of its own, or their connections were removed since. Until you choose again, their agents run on the runtime's default, DeepSeek: each is marked below. Copy from Lumiverse, in Harness → System → Runtime → Connections, copies a connection of yours into the runtime under its own id, so a choice of it works again.",
      },
    ]);
    // While the list is read, nothing is counted against a choice.
    expect(modelsNotices(models, agentConnections({ ...KNOWN, list: null }, LUMIVERSE))).toEqual([]);
  });
});

describe("the record", () => {
  test("a beat's head names who and what kind; the world's reads as the world's", () => {
    expect(beatHead(beat({ kind: "say" }), names)).toEqual({ who: "Rosie", kind: "said", where: "Rosie's Diner", when: "t10" });
    expect(beatHead(beat({ by: "world", kind: "happen" }), names).who).toBe("In the world");
  });

  test("whom it reached: all of it, part of it with what they got, told by someone; a thought reaches no one", () => {
    expect(exposureLine({ who: "npc_dev", reach: "part", got: "a low voice", from: null }, names)).toEqual({ who: "Dev", how: "part of it", got: "a low voice" });
    expect(exposureLine({ who: "player", reach: "told", got: "the news", from: "npc_rosie" }, names).how).toBe("told by Rosie");
    expect(reachedLine(beat({ kind: "inner" }), names)).toBe("Reached no one: a thought of Rosie's own");
    expect(reachedLine(beat({ exposure: [{ who: "player", reach: "whole", got: null, from: null }, { who: "npc_dev", reach: "part", got: "x", from: null }] }), names)).toBe("Reached Sam and Dev");
  });

  test("drafts: waiting ones first, soonest first; the rest latest first", () => {
    const d = (id: string, state: DraftView["state"], at: number): DraftView => ({ id, what: id, tier: 2, who: [], where: [], time: time(at), state, notes: null, basis: { messageId: "m", swipeId: 0 } });
    expect(draftsInOrder([d("a", "settled", 5), d("b", "open", 30), d("c", "open", 20), d("e", "stale", 9)]).map((x) => x.id)).toEqual(["c", "b", "e", "a"]);
  });

  test("the picker names the latest reply as such, an earlier one by when", () => {
    expect(replyLabel({ messageId: "m4", swipeId: 0, beats: 6, time: time(1), latest: true })).toBe("The latest reply (6 beats)");
    expect(replyLabel({ messageId: "m2", swipeId: 0, beats: 1, time: time(1), latest: false })).toBe("t1 (1 beat)");
  });
});

describe("minds and the notebook", () => {
  const file = (path: string, by: StoryFile["by"], at = 1): StoryFile => ({ path, chars: 10, at, by, version: "v" });
  test("a principal's mind lists every file in order, those not written yet included; a supporting character has a profile", () => {
    const entries = mindEntries("minds/rosie/", [file("minds/rosie/now.md", { who: "agent", agent: "character" }), file("minds/rosie/extra.md", { who: "user" }), file("minds/dev/core.md", { who: "user" })], true);
    expect(entries.map((e) => [e.path, e.file !== null])).toEqual([
      ["minds/rosie/core.md", false],
      ["minds/rosie/now.md", true],
      ["minds/rosie/memory.md", false],
      ["minds/rosie/beliefs.md", false],
      ["minds/rosie/people.md", false],
      ["minds/rosie/plans.md", false],
      ["minds/rosie/outline.md", false],
      ["minds/rosie/extra.md", true],
    ]);
    expect(mindEntries("minds/dev/", [], false).map((e) => e.path)).toEqual(["minds/dev/profile.md"]);
  });

  test("the notebook's pages in the author's order, and when the author last reflected: its own writes only", () => {
    const files = [file("author/zeta.md", { who: "user" }, 90), file("author/threads.md", { who: "agent", agent: "author" }, 50), file("author/notebook.md", { who: "agent", agent: "author" }, 40), file("minds/x/now.md", { who: "agent", agent: "author" }, 99)];
    expect(notebookFiles(files).map((f) => f.path)).toEqual(["author/notebook.md", "author/threads.md", "author/zeta.md"]);
    expect(lastReflected(files)).toBe(50);
    expect(lastReflected([file("author/notebook.md", { who: "user" })])).toBeNull();
  });

  test("a save's answer: saved, a conflict that keeps the typed text, or the workspace's words", () => {
    expect(savedWords({ file: file("a", { who: "user" }) })).toBe("Saved.");
    expect(savedWords({ failed: "x", code: "conflict" })).toContain("Your text is still in the box");
    expect(savedWords({ failed: "The area is full.", code: "other" })).toBe("The area is full.");
  });

  test("times in words", () => {
    expect(agoText(0, 30_000)).toBe("just now");
    expect(agoText(0, 5 * 60_000)).toBe("5 minutes ago");
    expect(agoText(0, 26 * 3_600_000)).toBe("yesterday");
    expect(stretchText(1440)).toBe("1 day");
    expect(stretchText(720)).toBe("12 hours");
  });
});

describe("the prepared start", () => {
  const view = (over: Partial<PrepareView>): PrepareView => ({ offer: null, state: "none", plan: null, estimate: null, spent: 0, cap: null, steered: [], notYet: [], note: null, names: {}, ...over });
  test("Now shows its card while it's offered, under way, revised, waiting, held, stopped or cancelled; once done, a quiet line", () => {
    expect(prepareShown(null)).toBe(false);
    expect(prepareShown(view({ offer: "A chat with history." }))).toBe(true);
    for (const state of ["planning", "revising", "waiting", "running", "paused", "failed", "cancelled"] as const) expect(prepareShown(view({ state }))).toBe(true);
    expect(prepareShown(view({ state: "done" }))).toBe(false);
    expect(prepareBusy("running")).toBe(true);
    expect(prepareBusy("revising")).toBe(true);
    expect(prepareBusy("waiting")).toBe(false);
  });

  test("the cap as typed: a whole number, none when empty, else a plain problem", () => {
    expect(capOf("250,000")).toEqual({ tokens: 250_000 });
    expect(capOf(" ")).toEqual({ tokens: null });
    expect("problem" in capOf("lots")).toBe(true);
    expect("problem" in capOf("0")).toBe(true);
  });

  /** Every element of `type` in a tree, a banner's actions among them. */
  const found = (node: unknown, type: unknown): Props[] => {
    if (Array.isArray(node)) return node.flatMap((n) => found(n, type));
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const v = node as VNode<Props>;
    return [...(v.type === type ? [v.props] : []), ...Object.values(v.props).flatMap((p) => found(p, type))];
  };
  const buttons = (tree: unknown): string[] => found(tree, Button).map((p) => textOf(p.children));
  const press = (tree: unknown, text: string): void => (found(tree, Button).find((p) => textOf(p.children) === text)?.onClick as () => void)();
  /** The card as drawn from `over`, with `typing` in its boxes: what it asks and what it types, kept. */
  const card = (over: Partial<PrepareView>, typing: Partial<PrepareTyped> = {}) => {
    const asked: PrepareAsk[] = [];
    const typed: [string, string][] = [];
    const tree = PrepareBody({ view: view(over), busy: false, typed: { steer: "", cap: null, about: "", depth: "", ...typing }, onType: (part, value) => typed.push([part, value]), ask: (body) => asked.push(body), onLater: () => undefined });
    return { tree, asked, typed };
  };
  const closed = { hidden: false, opened: false, watched: false };

  test("once the player sends words, the card says what is happening to them, and shows the author's answer under them once it gave one", () => {
    const sending = card({ state: "running" }, { steer: "  Joss is who the story turns on.  " });
    press(sending.tree, "Send");
    expect(sending.asked).toEqual([{ op: "steer", text: "Joss is who the story turns on." }]);
    expect(sending.typed).toEqual([["steer", ""]]);
    const revising = textOf(card({ state: "revising", steered: [{ text: "Joss is who the story turns on.", status: "The author is revising the plan with this.", answer: null }] }).tree);
    expect(revising).toContain("Joss is who the story turns on.The author is revising the plan with this.");
    expect(revising).not.toContain("The author's answer");
    const answered = textOf(card({ state: "waiting", note: "The author revised the plan for what you said. It now waits for your word: go ahead with it, or tell the author more.", steered: [{ text: "Joss is who the story turns on.", status: "The author revised the plan for this.", answer: "Joss is the principal now." }] }).tree);
    expect(answered).toContain("The author revised the plan for this.The author's answer: Joss is the principal now.");
    expect(answered).toContain("It now waits for your word");
  });

  test("the first card's box goes with the start, and an empty one sends none", () => {
    const offered = card({ offer: "This chat has a history." }, { about: " The story is Mara's. Joss and Ilse matter most. " });
    expect(found(offered.tree, "textarea").map((p) => p.value)).toEqual([" The story is Mara's. Joss and Ilse matter most. "]);
    press(offered.tree, "Prepare the story");
    expect(offered.asked).toEqual([{ op: "start", about: "The story is Mara's. Joss and Ilse matter most." }]);
    const empty = card({ offer: "This chat has a history." });
    press(empty.tree, "Prepare the story");
    expect(empty.asked).toEqual([{ op: "start" }]);
  });

  test("a finished preparation stays one quiet line on Now that opens its card again; out of reach, one line says so and what to do", () => {
    const done = view({ state: "done" });
    expect(prepareSlot(done, closed)).toBe("quiet");
    expect(prepareSlot(done, { ...closed, watched: true })).toBe("card");
    expect(prepareSlot(done, { ...closed, watched: true, hidden: true })).toBe("quiet");
    expect(prepareSlot(done, { ...closed, opened: true })).toBe("card");
    let opened = false;
    const quiet = PrepareQuiet({ onOpen: () => (opened = true) });
    press(quiet, "See how it went, or tell the author what to change");
    expect(opened).toBe(true);
    expect(buttons(card({ state: "done" }).tree)).toEqual(["Close", "Send"]);
    const linked = "No agent runtime is linked: link one on LumiAH's page, then open this chat again.";
    expect(prepareSlot(view({ state: "unreachable", note: linked }), closed)).toBe("line");
    expect(textOf(PrepareLine({ note: linked }))).toBe(linked);
    expect(prepareSlot(view({ state: "none" }), closed)).toBe("nothing");
  });

  test("a cancelled preparation offers Carry on, Start over and the box that revises it", () => {
    const cancelled = card({ state: "cancelled", note: "Cancelled. What it prepared stays: carry it on from its file, tell the author what to change, or start over." });
    expect(buttons(cancelled.tree)).toEqual(["Carry on", "Start over", "Close", "Send", "Set the cap"]);
    press(cancelled.tree, "Start over");
    press(cancelled.tree, "Carry on");
    expect(cancelled.asked).toEqual([{ op: "restart" }, { op: "resume" }]);
  });

  test("a plan offers each depth with its own cost; going ahead takes the one picked, else the author's recommendation, and a pick once under way changes it at once", () => {
    const stretch = (id: string, key: boolean, chosen: boolean) => ({ id, from: 1, to: 2, why: "", who: [], state: "planned" as const, beats: 0, key, chosen });
    const plan = { story: "", principals: [], stretches: [stretch("s1", true, true), stretch("s2", false, false)], summaries: null, authorEstimate: 0, reckoned: 900_000, call: null, ceiling: 200_000, depths: [{ depth: "outline" as const, tokens: 300_000 }, { depth: "key" as const, tokens: 900_000 }, { depth: "all" as const, tokens: 4_000_000 }], recommended: { depth: "key" as const, why: "Two moments made this story." }, depth: "key" as const };
    const choice = (tree: unknown): Props => found(tree, Seg)[0]!;
    const pick = (tree: unknown, depth: string): void => (choice(tree).onChange as (d: string) => void)(depth);

    const waiting = card({ state: "waiting", plan });
    expect((choice(waiting.tree).options as { value: string; label: string }[]).map((o) => o.label)).toEqual([`Outlines only: ${tokensText(300_000)}`, `Key moments: ${tokensText(900_000)}`, `Everything planned: ${tokensText(4_000_000)}`]);
    expect(choice(waiting.tree).value).toBe("key");
    expect(textOf(waiting.tree)).toContain("The author recommends key moments: Two moments made this story.");
    press(waiting.tree, "Go ahead with the plan");
    expect(waiting.asked).toEqual([{ op: "approve", depth: "key" }]);
    // A pick before going ahead is only typed: nothing is asked until the player goes ahead with it.
    pick(waiting.tree, "outline");
    expect(waiting.typed).toEqual([["depth", "outline"]]);
    expect(waiting.asked).toHaveLength(1);
    const picked = card({ state: "waiting", plan }, { depth: "outline" });
    expect(choice(picked.tree).value).toBe("outline");
    press(picked.tree, "Go ahead with the plan");
    expect(picked.asked).toEqual([{ op: "approve", depth: "outline" }]);

    const running = card({ state: "running", plan });
    pick(running.tree, "all");
    expect(running.asked).toEqual([{ op: "depth", depth: "all" }]);

    // One depth is no choice: nothing to pick, and going ahead names none.
    const single = card({ state: "waiting", plan: { ...plan, stretches: [], depths: [{ depth: "outline" as const, tokens: 300_000 }], recommended: { depth: "outline" as const, why: "" }, depth: "outline" as const } });
    expect(found(single.tree, Seg)).toEqual([]);
    press(single.tree, "Go ahead with the plan");
    expect(single.asked).toEqual([{ op: "approve" }]);
  });
});

describe("Settings → Story → Narration", () => {
  /** Every row of the page, with its props: the numbers' and the choices'. */
  function rowsOf(node: unknown): Props[] {
    if (Array.isArray(node)) return node.flatMap(rowsOf);
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const p = (node as VNode<Props>).props;
    return [...(typeof p.id === "string" && p.id.startsWith("narration-") ? [p] : []), ...rowsOf(p.children)];
  }
  const sent: unknown[] = [];
  const page = (narration = NARRATION_DEFAULTS) => expand(StorySubPage({ sub: "narration", story: STORY_DEFAULTS, narration, view: null, busy: false, patch: (body) => sent.push(body) }));

  test("a row for every field of the narration, each number in the settings' own bounds with its own default", () => {
    const rows = rowsOf(page());
    expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(NARRATION_DEFAULTS).map((key) => `narration-${key}`).sort());
    for (const [key, bounds] of Object.entries(NARRATION_BOUNDS)) {
      const row = rows.find((r) => r.id === `narration-${key}`);
      expect(row?.bounds).toEqual(bounds);
      expect(row?.standard).toBe(NARRATION_DEFAULTS[key as keyof typeof NARRATION_BOUNDS]);
    }
  });

  test("each choice and each Default sends its own field", () => {
    sent.length = 0;
    const tree = page();
    const [check, directLine] = propsOf(tree, Seg);
    (check?.onChange as (value: string) => void)("author");
    (directLine?.onChange as (value: string) => void)("narrated");
    (rowsOf(tree).find((r) => r.id === "narration-revisions")?.set as (value: number | null) => void)(null);
    expect(sent).toEqual([{ narration: { check: "author" } }, { narration: { directLine: "narrated" } }, { narration: { revisions: null } }]);
  });

  test("who checks says what each choice costs; with no one checking, the page says the rows below aren't used", () => {
    const help = rowsOf(page()).find((r) => r.id === "narration-check")?.help;
    expect(help).toContain("The game master is a separate agent, so it is the slowest.");
    expect(help).toContain("The author checks in its own turn.");
    expect(help).toContain("No one: a passage is released as drafted.");
    expect(textOf(page({ ...NARRATION_DEFAULTS, check: "none" }))).toContain("the three rows below aren't used");
  });

  test("its row on the Story page says what is set, and counts what differs from the defaults", () => {
    expect(narrationSummary(NARRATION_DEFAULTS)).toBe("The game master checks · 2 revisions");
    expect(narrationSummary({ ...NARRATION_DEFAULTS, check: "author", revisions: 1 })).toBe("The author checks · 1 revision");
    expect(narrationSummary({ ...NARRATION_DEFAULTS, check: "none" })).toBe("No check: released as drafted");
    expect(narrationChanged(NARRATION_DEFAULTS)).toBe(0);
    expect(narrationChanged({ ...NARRATION_DEFAULTS, check: "author", ownChars: 0 })).toBe(2);
  });
});
