// The harness's own pages in the drawer (LumiAH's, under the Harness tab), and what Settings says to a
// chat that plays on the harness. Each is walked as a rendered tree, with no DOM: the view the
// backend pushes says which engine plays the chat; the tab is on the mode bar only for a chat on the
// harness, and the drawer falls back to Play when the open chat changes to one another engine plays;
// the pages offered and their order, which is LumiAH's own, held here to the order declared;
// LumiAH's per-chat switch is offered nowhere; the pages wait behind a spoiler curtain; the two
// stylesheets name nothing alike; and the pages that set up the classic and agents engines open with
// one note while the open chat is on the harness, and never otherwise.

import { describe, expect, test } from "bun:test";
import { CSS as LUMIAH_CSS, GROUPS, Shell } from "lumi-ah/extension/frontend";
import type { VNode } from "preact";
import type { ChatKnowledgePrefs } from "../../src/backend/chat-knowledge-prefs";
import { buildView, notWorldView, ViewMemo } from "../../src/backend/view";
import { resolveFix } from "../../src/engine/edits";
import { enginePack } from "../../src/engine/engine-pack";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { emptyJournal, LedgerCore } from "../../src/engine/ledger/journal";
import { createRegistry } from "../../src/engine/registry-impl";
import type { Mode, SettingsPage, SettingsRoute } from "../../src/frontend/app";
import { Banner, Button, Section } from "../../src/frontend/components";
import { drawerModes, ModeBar, ModeBody } from "../../src/frontend/drawer";
import { HARNESS_MODE, harnessChat, harnessOffered, shownMode } from "../../src/frontend/harness/mode";
import { HARNESS_PAGES, HARNESS_PAGES_CSS, HarnessCurtain, type HarnessPages, HarnessView, waitingOf } from "../../src/frontend/harness/pages";
import { HARNESS_TABS, StoryFrame } from "../../src/frontend/story/tab";
import { Play } from "../../src/frontend/play/play";
import { AGENTS_SUB, ENGINE_NOTE_PAGES, engineNote, OLD_ENGINE_TIMEOUTS, TURN_TIMEOUTS_TITLE } from "../../src/frontend/settings/labels";
import { KEPT_DEFS, LOOP_DEFS } from "../../src/shared/agent-settings";
import { EngineNote, HOME_GROUPS, Settings } from "../../src/frontend/settings/settings";
import { TimeoutsSection } from "../../src/frontend/settings/timeouts";
import { CSS } from "../../src/frontend/styles";
import { HARNESS_CSS } from "../../src/frontend/styles/harness";
import { hashJson } from "../../src/shared/hash";
import type { ChatRun } from "../../src/shared/ledger";
import { OFFSTAGE_DEFAULTS } from "../../src/shared/offstage";
import { NARRATOR_DEFAULTS } from "../../src/shared/settings";
import type { StateView } from "../../src/shared/state-view";
import { defaultTimeouts, TIMEOUT_KEYS, TIMEOUTS } from "../../src/shared/timeouts";
import { testModel, testPack, testWorld, tieStubPack } from "../support/test-pack";
import { propsOf, type Props } from "../support/tree";

type Engine = NonNullable<StateView["engine"]>;

/** A world chat's view as the page holds it, on `engine`; with none, a chat that plays no world. */
function viewOf(chatId: string, engine?: Engine): StateView {
  return { v: 1, chatId, worldId: engine ? "world-mara" : null, revision: null, status: engine ? "idle" : "not_world", ...(engine ? { engine } : {}), hud: null, scene: null, chips: [], replyClocks: {}, journal: [], keepReport: [], pending: [], panels: {}, palette: null, controls: null, meter: null, packs: {}, currency: null };
}

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The bar's tabs as rendered: each mode's id, its label, and whether it is the one selected. */
function tabs(tree: unknown): { id: unknown; label: string; selected: unknown }[] {
  return propsOf(tree, "button").map((p) => ({ id: p["data-mode"], label: textOf(p.children), selected: p["aria-selected"] }));
}

/** The mode bar as the drawer draws it for what it knows of the open chat's engine and the mode chosen. */
function barFor(harness: boolean | null, chosen: Mode, waiting = 0): unknown {
  const offered = harnessOffered(harness, chosen);
  return ModeBar({ modes: drawerModes(offered), mode: shownMode(chosen, offered), bodyId: "drawer", waiting, onSelect: () => undefined });
}

/** LumiAH's pages as the tab is handed them; walking a tree reads nothing of them. */
const PAGES: HarnessPages = { app: {} as HarnessPages["app"], start: () => undefined, files: { list: async () => [], read: async () => ({ failed: "none", code: "missing" }), write: async () => ({ failed: "none", code: "other" }) }, connections: { state: { get: () => null, subscribe: () => () => undefined }, failed: { get: () => false, subscribe: () => () => undefined }, start: () => undefined }, dispose: () => undefined };

/** Where the tab stands, as UI state keeps it: on LumiAH's pages, where it opens. */
const AT = { chatId: "chat-1", route: { page: "agents" as const }, go: () => undefined };

const ALL_PAGES: readonly SettingsPage[] = HOME_GROUPS.flatMap((group) => group.pages);

describe("the view the backend pushes", () => {
  const registry = createRegistry([enginePack, testPack, tieStubPack]);
  const world = testWorld();
  const revision = hashJson(world);
  const run: ChatRun = { v: 1, worldId: world.id, revision, runSeed: "harness-pages", startedAt: 0 };
  const observed: ChainMessage[] = [{ id: "m0", isUser: false, swipeId: 0, swipes: ["Morning, Mara."], ledger: null }];
  const core = new LedgerCore(emptyJournal("chat-mara"), { types: registry, worlds: (r) => (r === revision ? world : undefined), run, model: testModel, startMarkers: () => [], newSeed: () => "fresh", resolveFix: (doc, state, entry) => resolveFix(registry, doc, state, entry, run.runSeed) }, new LedgerFold(registry));
  const viewOn = (chat: ChatKnowledgePrefs): StateView => buildView({ chatId: "chat-mara", run, core, observed, registry, world: (r) => core.worldAt(r), stored: [], meter: null, knowledge: { chat, tracking: false, narrator: NARRATOR_DEFAULTS }, offstage: OFFSTAGE_DEFAULTS, memo: new ViewMemo() });

  test("says which engine plays the chat, so the page follows the Engine switch without asking; a chat with no choice plays classic", () => {
    expect(viewOn({}).engine).toBe("classic");
    expect(viewOn({ engine: "agents" }).engine).toBe("agents");
    expect(viewOn({ engine: "harness" }).engine).toBe("harness");
    expect(harnessChat({ view: viewOn({ engine: "harness" }), status: "live" })).toBe(true);
    expect(harnessChat({ view: viewOn({}), status: "live" })).toBe(false);
    // A chat that plays no world has no engine to say.
    expect("engine" in notWorldView("chat-joss")).toBe(false);
  });
});

describe("the drawer's Harness tab", () => {
  test("the open chat plays on the harness only when its view says so; while a chat's view is read it can't be said yet", () => {
    expect(harnessChat({ view: viewOf("chat-mara", "harness"), status: "live" })).toBe(true);
    expect(harnessChat({ view: viewOf("chat-mara", "classic"), status: "live" })).toBe(false);
    expect(harnessChat({ view: viewOf("chat-mara", "agents"), status: "live" })).toBe(false);
    // A chat that plays no world has no engine.
    expect(harnessChat({ view: viewOf("chat-joss"), status: "live" })).toBe(false);
    expect(harnessChat({ view: null, status: "syncing" })).toBeNull();
    // No chat open, or one whose read failed: nothing the tab could show pages for.
    expect(harnessChat({ view: null, status: "closed" })).toBe(false);
  });

  test("the bar holds the tab, last, only for a chat on the harness", () => {
    expect(tabs(barFor(true, "play"))).toEqual([
      { id: "play", label: "Play", selected: true },
      { id: "gm", label: "GM", selected: false },
      { id: "build", label: "Build", selected: false },
      { id: "settings", label: "Settings", selected: false },
      { id: "harness", label: "Harness", selected: false },
    ]);
    expect(HARNESS_MODE.label).toBe("Harness");
    for (const chosen of ["play", "gm", "build", "settings"] as const) {
      expect(tabs(barFor(false, chosen)).map((t) => t.id)).toEqual(["play", "gm", "build", "settings"]);
      // Nor for a chat nothing is known of yet.
      expect(tabs(barFor(null, chosen)).map((t) => t.id)).toEqual(["play", "gm", "build", "settings"]);
    }
    // Chosen, it is the tab selected, and its body is the tab's own.
    expect(tabs(barFor(true, "harness")).find((t) => t.selected === true)?.id).toBe("harness");
    const body = ModeBody({ mode: shownMode("harness", harnessOffered(true, "harness")), harness: "the harness's pages" });
    expect(textOf(body)).toBe("the harness's pages");
  });

  test("pressing the tab chooses it, and the bar says how many tabs it holds, for the layout that fits five on a phone", () => {
    const chosen: Mode[] = [];
    const bar = ModeBar({ modes: drawerModes(true), mode: "play", bodyId: "drawer", waiting: 0, onSelect: (mode) => chosen.push(mode) });
    const harness = propsOf(bar, "button").find((p) => p["data-mode"] === "harness");
    if (typeof harness?.onClick !== "function") throw new Error("the Harness tab can't be pressed");
    harness.onClick();
    expect(chosen).toEqual(["harness"]);
    expect((bar as VNode<Props>).props["data-lre-modes"]).toBe(5);
    expect((barFor(false, "play") as VNode<Props>).props["data-lre-modes"]).toBe(4);
    expect(HARNESS_CSS).toContain('.lre-modeseg[data-lre-modes="5"]>button{position:relative;min-height:var(--lre-tap-lg)}');
    expect(HARNESS_CSS).toContain('@container (max-width:420px){.lre-modeseg[data-lre-modes="5"]>button{flex-basis:0;flex-direction:column;');
  });

  test("when the open chat changes to one another engine plays, the drawer falls back to Play", () => {
    // The tab was open on a harness chat; the next chat plays classic.
    const offered = harnessOffered(false, "harness");
    expect(offered).toBe(false);
    expect(shownMode("harness", offered)).toBe("play");
    expect(tabs(barFor(false, "harness"))).toEqual([
      { id: "play", label: "Play", selected: true },
      { id: "gm", label: "GM", selected: false },
      { id: "build", label: "Build", selected: false },
      { id: "settings", label: "Settings", selected: false },
    ]);
    const body = ModeBody({ mode: shownMode("harness", offered), harness: "the harness's pages" }) as VNode<Props>;
    expect(body.type).toBe(Play);
    // No other mode is moved by it.
    for (const mode of ["play", "gm", "build", "settings"] as const) expect(shownMode(mode, false)).toBe(mode);
    expect((ModeBody({ mode: "settings" }) as VNode<Props>).type).toBe(Settings);
  });

  test("going from one harness chat to the next keeps the tab while the next one's view is read", () => {
    expect(harnessOffered(null, "harness")).toBe(true);
    expect(shownMode("harness", harnessOffered(null, "harness"))).toBe("harness");
    expect(tabs(barFor(null, "harness")).find((t) => t.selected === true)?.id).toBe("harness");
    // Once that view says another engine plays it, Play.
    expect(shownMode("harness", harnessOffered(harnessChat({ view: viewOf("chat-joss", "agents"), status: "live" }), "harness"))).toBe("play");
  });

  test("the tab is marked while something of the harness's waits for the user, and only then", () => {
    expect(waitingOf(null)).toBe(0);
    expect(waitingOf({ approvals: [], notices: [] })).toBe(0);
    // A job that only finished is news; a held tool call and a job that failed, was cut off or needs the user wait for them.
    expect(waitingOf({ approvals: [], notices: [{ kind: "job_done" }] })).toBe(0);
    expect(waitingOf({ approvals: [{ id: "held-brann" }], notices: [{ kind: "job_done" }, { kind: "job_failed" }, { kind: "job_interrupted" }, { kind: "job_needs_user" }] })).toBe(4);
    const marks = (tree: unknown) => propsOf(tree, "span").filter((p) => p.class === "lre-dot").map((p) => p["aria-label"]);
    expect(marks(barFor(true, "play", 0))).toEqual([]);
    expect(marks(barFor(true, "play", 1))).toEqual(["1 thing needs you"]);
    expect(marks(barFor(true, "gm", 3))).toEqual(["3 things need you"]);
    // The mark is the tab's: without the tab, nothing is marked.
    expect(marks(barFor(false, "play", 3))).toEqual([]);
  });
});

describe("the harness's pages", () => {
  /** LumiAH's pages in the order its bar shows them: its groups in order, each group's pages in order. */
  const inBarOrder = GROUPS.flatMap((group) => group.pages.map((page) => page.id));

  test("what the agents are doing comes first, then what they keep and how they are set up, and a runtime last", () => {
    expect([...HARNESS_PAGES]).toEqual(["live", "sessions", "jobs", "talk", "workspace", "guidance", "agents", "skills", "tools", "settings", "spend", "upkeep", "runtime"]);
    // LumiAH's bar keeps its own order and takes only which pages: the order declared is the order shown.
    expect(inBarOrder.filter((id) => HARNESS_PAGES.includes(id))).toEqual([...HARNESS_PAGES]);
    expect(HARNESS_PAGES[0]).toBe("live");
    expect(HARNESS_PAGES.at(-1)).toBe("runtime");
    const shown = GROUPS.map((group) => ({ group: group.label, pages: group.pages.filter((page) => HARNESS_PAGES.includes(page.id)).map((page) => page.label) })).filter((group) => group.pages.length > 0);
    expect(shown).toEqual([
      { group: "Now", pages: ["Live", "Past replies", "Jobs", "Talk"] },
      { group: "Story", pages: ["Workspace", "Guidance"] },
      { group: "Agents", pages: ["Agents", "Skills", "Tools"] },
      { group: "System", pages: ["Settings", "Spend", "Storage", "Runtime"] },
    ]);
    // Runtime says of itself that it is optional.
    expect(GROUPS.flatMap((group) => group.pages).find((page) => page.id === "runtime")?.about).toStartWith("Optional.");
  });

  test("every page of LumiAH's is either offered or left out on purpose: a page it adds is a choice to make here", () => {
    expect(inBarOrder.filter((id) => !HARNESS_PAGES.includes(id))).toEqual(["home", "lore", "chronicle"]);
    // A held tool call is answered where its run shows (a reply's on Live, a job's on Jobs, a conversation's on Talk): none of the three may go.
    for (const page of ["live", "jobs", "talk"] as const) expect(HARNESS_PAGES.includes(page)).toBe(true);
  });

  test("the tab opens behind a curtain: nothing of the pages is drawn until it is opened, and it says what the harness is", () => {
    let opened = 0;
    const closed = HarnessView({ pages: PAGES, revealed: false, onReveal: () => (opened += 1), ...AT });
    expect(propsOf(closed, Shell)).toEqual([]);
    const [curtain] = propsOf(closed, HarnessCurtain);
    if (!curtain) throw new Error("no curtain in front of the pages");
    const gate = HarnessCurtain({ onReveal: curtain.onReveal as () => void });
    expect(textOf(gate)).toContain("Spoilers ahead");
    expect(textOf(gate)).toContain("The harness is the AI author that plays this chat's turns, with the agents it starts.");
    expect(textOf(gate)).toContain("everything they read of the world and everything they think");
    const [show] = propsOf(gate, Button);
    expect(textOf(show?.children)).toBe("Show the story and the agents");
    if (typeof show?.onClick !== "function") throw new Error("the curtain has nothing to press");
    show.onClick();
    expect(opened).toBe(1);
  });

  test("opened, it shows LumiAH's shell with exactly the pages offered, under the bar that goes to the story's pages", () => {
    const open = HarnessView({ pages: PAGES, revealed: true, onReveal: () => undefined, ...AT });
    expect(propsOf(open, HarnessCurtain)).toEqual([]);
    expect(propsOf(open, Shell)).toEqual([{ pages: HARNESS_PAGES }]);
    const [frame] = propsOf(open, StoryFrame);
    expect(frame?.route).toEqual({ page: "agents" });
    expect(HARNESS_TABS.map((t) => t.id)).toEqual(["agents", "cast", "record", "notebook"]);
  });
});

describe("LumiAH's own switch for a chat", () => {
  test("is offered nowhere: Home, which is that switch, is no page of the tab", () => {
    expect(HARNESS_PAGES.includes("home")).toBe(false);
  });

  test("and on Runtime, which lists the chats with it, its control is taken away: the row can't be pressed and shows no switch", () => {
    expect(HARNESS_CSS).toContain(".lre-harness .lah-chatswitch>.lah-switch{pointer-events:none;cursor:default}");
    expect(HARNESS_CSS).toContain(".lre-harness .lah-chatswitch>.lah-switch>input,.lre-harness .lah-chatswitch>.lah-switch>.lah-switch-track{display:none}");
    // A chat LumiAH doesn't answer has nothing else in its row, which reads "switched on, it runs…": the row goes.
    expect(HARNESS_CSS).toContain(".lre-harness .lah-chatrow:has(>.lah-chatswitch[data-on=false]){display:none}");
    expect(LUMIAH_CSS).toContain(".lah-chatrow{");
    // The rule holds only while LumiAH names these parts so: a rename there must fail here.
    for (const part of [".lah-chatswitch{", ".lah-switch>input{", ".lah-switch-track{"]) expect(LUMIAH_CSS).toContain(part);
    // The pages sit inside the element the rule starts from.
    expect((HarnessView({ pages: PAGES, revealed: true, onReveal: () => undefined, ...AT }) as VNode<Props>).props.class).toBe("lre-harness");
  });
});

describe("the two stylesheets", () => {
  const rules = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = (css: string): Set<string> => new Set([...rules(css).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? ""));
  const names = (css: string, pattern: RegExp): string[] => [...new Set([...rules(css).matchAll(pattern)].map((m) => m[1] ?? ""))];

  test("name nothing alike: every class, variable, animation and container of LumiAH's is lah-named, and none of ours is", () => {
    const theirs = classes(LUMIAH_CSS);
    // Ours without the few rules that reach into LumiAH's pages on purpose (styles/harness.ts).
    const ours = classes(CSS.replace(HARNESS_CSS, ""));
    expect([...theirs].filter((name) => !/^lah(-|$)/.test(name))).toEqual([]);
    expect([...ours].filter((name) => /^lah(-|$)/.test(name))).toEqual([]);
    expect([...theirs].filter((name) => ours.has(name))).toEqual([]);
    expect(names(LUMIAH_CSS, /(--[\w-]+)\s*:/g).filter((name) => !name.startsWith("--lah-"))).toEqual([]);
    expect(names(CSS.replace(HARNESS_CSS, ""), /(--[\w-]+)\s*:/g).filter((name) => !name.startsWith("--lre-"))).toEqual([]);
    expect(names(LUMIAH_CSS, /@keyframes\s+([\w-]+)/g).filter((name) => !name.startsWith("lah-"))).toEqual([]);
    expect(names(CSS, /@keyframes\s+([\w-]+)/g).filter((name) => !name.startsWith("lre-"))).toEqual([]);
    expect(names(LUMIAH_CSS, /container:\s*([\w-]+)\s*\//g)).toEqual(["lah"]);
  });

  test("every rule of LumiAH's starts from one of its own classes, so none reaches our pages", () => {
    const selectors = [...rules(LUMIAH_CSS).matchAll(/(?:^|[{}])\s*([^{}@]+)\{/g)].flatMap((m) => (m[1] ?? "").split(",")).map((s) => s.trim());
    expect(selectors.filter((s) => s !== "" && !/^(from|to|\d+%)$/.test(s) && !/\.lah(-|\b)/.test(s))).toEqual([]);
  });

  test("LumiAH's is added as it ships, apart from ours, which holds our few rules for its pages once", () => {
    expect(HARNESS_PAGES_CSS).toBe(LUMIAH_CSS);
    expect(CSS.split(HARNESS_CSS)).toHaveLength(2);
    expect(CSS.includes(LUMIAH_CSS)).toBe(false);
  });

  test("under our mode bar and above the story's bar, LumiAH's shell is told where its bar sticks, how far it reaches and the height it has", () => {
    for (const measure of ["--lah-stick-top:calc(var(--lre-stick-top,0px) + var(--lre-modebar-h,0px))!important", "--lah-bleed-l:calc(var(--lre-s3) + var(--lre-gutter-l))!important", "--lah-bleed-r:calc(var(--lre-s3) + var(--lre-gutter-r))!important", "--lah-fill-h:calc(var(--lre-fill-h,100vh) - var(--lre-modebar-h,0px) - var(--lre-harness-nav-h,0px))!important"]) expect(HARNESS_CSS).toContain(measure);
    // The shell still reads each of them: a measure it drops or renames must fail here.
    for (const read of ["var(--lah-stick-top", "var(--lah-bleed-l", "var(--lah-bleed-r", "var(--lah-fill-h"]) expect(LUMIAH_CSS).toContain(read);
  });
});

describe("Settings on a chat that plays on the harness", () => {
  const OLD_ENGINE_PAGES: readonly SettingsPage[] = ["helper", "model", "steps", "minds", "timeouts", "agents", "speed", "roles", "context", "main", "assistant", "prompts"];
  const noteOn = (route: SettingsRoute, engine: StateView["engine"], onOpen: () => void = () => undefined): unknown => EngineNote({ route, engine, onOpen });

  test("Settings' list and every page that sets up the classic and agents engines open with the note, and no other page", () => {
    expect(ALL_PAGES.filter((page) => noteOn({ page }, "harness") !== null)).toEqual([...OLD_ENGINE_PAGES]);
    expect(Object.keys(ENGINE_NOTE_PAGES).sort()).toEqual(["home", ...OLD_ENGINE_PAGES].sort());
    expect(propsOf(noteOn({ page: "home" }, "harness"), Banner)[0]?.title).toBe("This chat plays on the harness");
    // A role's page, from Roles or Context, opens with its page's; a section of Agents with none, as the note on Agents names the sections the harness reads.
    expect(noteOn({ page: "roles", sub: "intent" }, "harness")).not.toBeNull();
    expect(noteOn({ page: "context", sub: "read" }, "harness")).not.toBeNull();
    expect(noteOn({ page: "agents", sub: "pipeline" }, "harness")).toBeNull();
    expect(noteOn({ page: "agents", sub: "review" }, "harness")).toBeNull();
  });

  test("on a page part of which the harness reads, the note names that part as the page names it", () => {
    // Minds: the switch and the sections the harness's tools read (`settings.minds.enabled`, `lengths`, `knowledge`, `reads`).
    const minds = engineNote("minds").text;
    for (const part of ["Character minds", "Lengths", "Knowledge", "What a mind reads"]) expect(minds).toContain(part);
    // Agents: the review card's place, and the two limits under Budgets the harness reads (`clipChars`, `kept.runs`), by their labels.
    const agents = engineNote("agents").text;
    for (const part of [AGENTS_SUB.review.title, AGENTS_SUB.budgets.title, LOOP_DEFS.clipChars.label, KEPT_DEFS.runs.label]) expect(agents).toContain(part);
    // Assistant: how its changes land is the engine's on every chat; where it runs is LumiAH's on the harness.
    expect(engineNote("assistant").text).toContain("How its changes land");
    // The helper model runs no harness turn, but Build's jobs as well as the other engines' steps.
    expect(engineNote("helper").text).toContain("Build's jobs");
  });

  test("only while the open chat is on the harness: never on another engine, a chat that plays no world, or no chat", () => {
    for (const engine of ["classic", "agents", undefined] as const) {
      expect(ALL_PAGES.filter((page) => noteOn({ page }, engine) !== null)).toEqual([]);
      expect(noteOn({ page: "roles", sub: "intent" }, engine)).toBeNull();
    }
  });

  test("it says whose the settings are, what the harness is, and where its agents are set up, with the way there", () => {
    let opened = 0;
    const note = noteOn({ page: "steps" }, "harness", () => (opened += 1));
    const [banner] = propsOf(note, Banner);
    expect([banner?.tone, banner?.title]).toEqual(["info", "This chat doesn't use these settings"]);
    expect(textOf(banner?.children)).toBe("They belong to the classic and agents engines, which your other chats may play on. This chat plays on the harness: an AI author plays each turn with agents it starts, and those are set up under Harness.");
    const [open] = propsOf(banner?.actions, Button);
    expect(textOf(open?.children)).toBe("Open Harness");
    if (typeof open?.onClick !== "function") throw new Error("the note has nothing to press");
    open.onClick();
    expect(opened).toBe(1);
    // One note a page, in the same words on every page that is the other engines' whole.
    for (const page of ["model", "speed", "roles", "context", "main"] as const) expect(propsOf(noteOn({ page }, "harness"), Banner).map((b) => textOf(b.children))).toEqual([textOf(banner?.children)]);
    // Every note has the way to the Harness tab.
    for (const page of OLD_ENGINE_PAGES) expect(propsOf(propsOf(noteOn({ page }, "harness"), Banner)[0]?.actions, Button).map((b) => textOf(b.children))).toEqual(["Open Harness"]);
  });

  test("on Timeouts it says which of a turn's timeouts still applies: the rest are the other engines'", () => {
    // A turn's timeouts, all but the generation guard, time steps the harness never runs.
    expect(TIMEOUT_KEYS.filter((id) => TIMEOUTS[id].group === "turn" && !OLD_ENGINE_TIMEOUTS.includes(id))).toEqual(["guardMs"]);
    expect(OLD_ENGINE_TIMEOUTS.every((id) => TIMEOUTS[id].group === "turn")).toBe(true);
    const { title, text } = engineNote("timeouts");
    expect(title).toBe("This chat doesn't use some of these");
    expect(text).toBe("Under Turns, only Generation guard applies to this chat: the rest time a turn's steps on the classic and agents engines. This chat plays on the harness: an AI author plays each turn with agents it starts, and their own limits are set under Harness.");
    expect(textOf(noteOn({ page: "timeouts" }, "harness"))).toContain(text);
    // The note points at the section by the title the page gives it.
    const page = TimeoutsSection({ timeouts: defaultTimeouts(), patch: () => undefined, busy: false });
    const turns = propsOf(page, Section).find((section) => propsOf(section.children, "div").some((rows) => rows["data-lre-timeout-group"] === "turn"));
    expect(turns?.title).toBe(TURN_TIMEOUTS_TITLE);
  });

  test("on Prompts, which holds the harness's own texts too, it says where those are", () => {
    const { title, text } = engineNote("prompts");
    expect(title).toBe("This chat plays on the harness");
    expect(text).toBe("That is, an AI author plays each turn with agents it starts. What they are sent is on the page Harness engine, here in Prompts; each agent's model, tools and limits are set under Harness.");
    expect(textOf(noteOn({ page: "prompts" }, "harness"))).toContain(text);
  });
});
