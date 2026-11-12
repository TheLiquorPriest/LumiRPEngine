// The story engine's pages (src/frontend/story/): what Cast, Record, Notebook, the prepared start
// and Settings → Story → Models say of what the backend answers, read without a DOM.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { NARRATION_BOUNDS, NARRATION_DEFAULTS, STORY_DEFAULTS, type StoryModels } from "../../src/shared/settings";
import type { BeatView, CastRowView, DraftView, PrepareView } from "../../src/shared/story-pages";
import { HostModelPicker, Seg } from "../../src/frontend/components";
import { narrationChanged, narrationSummary, StorySubPage } from "../../src/frontend/settings/story";
import { agentConnections, LOOPBACK_PROBLEM, UNSET_CONNECTION } from "../../src/frontend/story/connections";
import { savedWords } from "../../src/frontend/story/editor";
import { lastReflected, mindEntries, notebookFiles, type StoryFile } from "../../src/frontend/story/files";
import { ModelPickRows, runsOnText } from "../../src/frontend/story/model-pick";
import { agoText, beatHead, capOf, castGroups, castLine, characterAsk, draftsInOrder, exposureLine, pickedBy, prepareBusy, prepareProgress, prepareShown, reachedLine, reachedText, stretchText } from "../../src/frontend/story/model";
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

/** Lumiverse's connections, one of them the runtime's own loopback as LumiAH marks it. */
const ALL = [
  { id: "c1", name: "DeepSeek", model: "v4" },
  { id: "loop", name: "LumiRPEngine", model: "lumiah" },
];
const CONNECTIONS = agentConnections(ALL, ["loop"], false);

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
    expect(runsOnText(pickedBy(STORY_DEFAULTS.models, characterAsk("npc_dev", "scene")), CONNECTIONS)).toEqual({ line: "Nothing set", note: UNSET_CONNECTION });
    expect(runsOnText(pickedBy({ ...STORY_DEFAULTS.models, default: { connectionId: "loop" } }, characterAsk("npc_dev", "scene")), CONNECTIONS).note).toContain("set by the default, is the runtime's own");
  });
});

describe("the connections an agent may run on", () => {
  test("every loopback LumiAH marks is left out, and none is offered until LumiAH has said which those are", () => {
    expect(CONNECTIONS.choices?.map((c) => c.id)).toEqual(["c1"]);
    expect(agentConnections(ALL, null, false)).toMatchObject({ choices: null, waiting: "Reading which connections are the runtime's own…" });
    expect(agentConnections(ALL, null, true).waiting).toContain("Reload the page");
  });

  test("a level saved on a loopback shows it, marked, with what to do, and offers no model from it", () => {
    const tree = ModelPickRows({ id: "agent-author", owner: "The author", pick: { connectionId: "loop", effort: "high" }, fallsTo: "the default", connections: CONNECTIONS, busy: false, set: () => undefined });
    expect(propsOf(tree, "option").slice(0, 3).map((o) => [o.value, o.disabled === true])).toEqual([
      ["", false],
      ["loop", true],
      ["c1", false],
    ]);
    expect(textOf(tree)).toContain("LumiRPEngine (the runtime's own)");
    expect(textOf(tree)).toContain(LOOPBACK_PROBLEM);
    expect(propsOf(tree, HostModelPicker)).toEqual([]);
  });

  test("the default, with no connection set, says in a line what an agent then runs on", () => {
    const tree = ModelPickRows({ id: "default", owner: "Every agent", pick: undefined, unset: UNSET_CONNECTION, connections: CONNECTIONS, busy: false, set: () => undefined });
    expect(textOf(tree)).toContain("an agent runs on the connection its chat was on before it moved to the runtime, or on Lumiverse's default connection");
    expect(textOf(tree)).not.toContain("LumiAH's settings");
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
  test("Now shows it while it's offered, under way, waiting, held or stopped; not once done", () => {
    expect(prepareShown(null)).toBe(false);
    expect(prepareShown(view({ offer: "A chat with history." }))).toBe(true);
    for (const state of ["planning", "waiting", "running", "paused", "failed"] as const) expect(prepareShown(view({ state }))).toBe(true);
    expect(prepareShown(view({ state: "done" }))).toBe(false);
    expect(prepareShown(view({ state: "cancelled" }))).toBe(false);
    expect(prepareBusy("running")).toBe(true);
    expect(prepareBusy("waiting")).toBe(false);
  });

  test("progress counts stretches relived or filled from summaries", () => {
    const stretch = (state: "planned" | "open" | "recorded" | "dropped") => ({ id: state, from: 1, to: 2, why: "", who: [], state, beats: 0 });
    const plan = { story: "", principals: [], stretches: [stretch("recorded"), stretch("dropped"), stretch("open"), stretch("planned")], summaries: null, authorEstimate: 0, reckoned: 0, call: null, ceiling: 0 };
    expect(prepareProgress(view({ plan }))).toEqual({ done: 2, total: 4 });
    expect(prepareProgress(view({}))).toBeNull();
  });

  test("the cap as typed: a whole number, none when empty, else a plain problem", () => {
    expect(capOf("250,000")).toEqual({ tokens: 250_000 });
    expect(capOf(" ")).toEqual({ tokens: null });
    expect("problem" in capOf("lots")).toBe(true);
    expect("problem" in capOf("0")).toBe(true);
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
