// The live view of the prepared start in Play → Now's card (src/frontend/story/prepare-live.tsx):
// what its compact form and its whole say of one view the backend answered, how a long plan's
// stretches are grouped and kept whole, how a run that failed reads, and when the view stops asking.
// Read without a DOM.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Badge, Disclosure, ListRow, Meter } from "../../src/frontend/components";
import { nextAsk, PrepareLiveBody, runWords, stretchGroups, trailWords, watchPreparation } from "../../src/frontend/story/prepare-live";
import { PREPARE_LIVE_CSS } from "../../src/frontend/story/prepare-live-styles";
import { CSS } from "../../src/frontend/styles";
import type { PrepareLive, PrepareLiveView, PrepareRunLine, PrepareStretchLine, PrepareStretchState } from "../../src/shared/prepare-live";
import type { Props } from "../support/tree";

/** The words a rendered tree shows, in order, through its children. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Every element of `type` in a tree, whatever prop holds it (a row's subtitle, a disclosure's body). */
function found(node: unknown, type: unknown): Props[] {
  if (Array.isArray(node)) return node.flatMap((n) => found(n, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const v = node as VNode<Props>;
  return [...(v.type === type ? [v.props] : []), ...Object.values(v.props).flatMap((p) => found(p, type))];
}

const NOW = Date.UTC(2026, 10, 11, 14, 0);
const ago = (minutes: number): number => NOW - minutes * 60_000;
const names = { mara: "Mara", joss: "Joss" };

const stretch = (id: string, state: PrepareStretchState, over: Partial<PrepareStretchLine> = {}): PrepareStretchLine => ({ id, from: 1, to: 6, state, beats: 0, through: null, key: false, relivers: ["mara"], relived: state === "reliving" || state === "done" ? [] : null, ...over });

const run = (over: Partial<PrepareRunLine> = {}): PrepareRunLine => ({ id: "run-1", role: "author", who: null, agent: "author", state: "running", stretch: null, since: ago(72), endedAt: null, used: { tokens: 1_204_000, calls: 42 }, reason: null, stoppedAt: null, inside: null, ...over });

/** A preparation an hour and more into reliving: the historian records s2 inside the author's run, Joss still relives s1, which Mara is through. */
const live = (over: Partial<PrepareLive> = {}): PrepareLive => ({
  kind: "history",
  depth: { chosen: "key", recommended: "key", picked: false },
  stage: "reliving",
  stages: [
    { id: "reading", state: "done" },
    { id: "planning", state: "done" },
    { id: "waiting", state: "skipped" },
    { id: "reliving", state: "now" },
    { id: "filling", state: "ahead" },
    { id: "scene", state: "ahead" },
    { id: "ready", state: "ahead" },
  ],
  going: "running",
  runs: [run(), run({ role: "historian", agent: "historian", stretch: "s2", since: ago(9), used: null, inside: "run-1" }), run({ id: "run-joss", role: "principal", who: "joss", agent: "character", stretch: "s1", since: ago(20), used: { tokens: 84_000, calls: 7 } })],
  stretches: [stretch("s1", "reliving", { beats: 12, through: 6, relivers: ["mara", "joss"], relived: ["mara"] }), stretch("s2", "reading", { from: 7, to: 12, beats: 4, through: 9, relivers: ["mara", "joss"] })],
  principals: [
    { id: "mara", planned: 2, relived: 1, outline: false, profile: true, atWork: false },
    { id: "joss", planned: 2, relived: 0, outline: false, profile: false, atWork: true },
  ],
  messages: { total: 13, relived: 0, filled: 6, neither: 7 },
  relivedAt: ago(3),
  reach: true,
  scene: false,
  notebook: false,
  startedAt: ago(180),
  endedAt: null,
  workedMs: 150 * 60_000,
  left: { ms: 130 * 60_000, stretches: 1 },
  spent: 1_204_000,
  estimate: 1_800_000,
  cap: 2_000_000,
  trail: [
    { at: ago(9), what: "opened", stretch: "s2" },
    { at: ago(30), what: "recorded", stretch: "s1", count: 12 },
    { at: ago(170), what: "said", text: "Leave out the boat races." },
    { at: ago(175), what: "planned", count: 2 },
  ],
  logged: true,
  names,
  ...over,
});

const viewOf = (prep: PrepareLive | null, running = true): PrepareLiveView => ({ at: NOW, live: running, every: 5, prep });

/** The view as the card draws it, open or not, with what its controls were told. */
function drawn(view: PrepareLiveView, open: boolean) {
  const toggled: boolean[] = [];
  let watched = 0;
  const tree = PrepareLiveBody({ view, now: NOW, open, onToggle: (o) => toggled.push(o), onWatch: () => watched++ });
  return { tree, toggled, watched: () => watched };
}

describe("the live view of the prepared start", () => {
  test("its compact form says the stage, what it does now and how far, in a line and a bar; opened, the whole: stages, who is at work, time and cost, how far along, what happened", () => {
    const view = viewOf(live());
    const closed = drawn(view, false);
    // The compact form: what stands outside the whole.
    const compact = ((closed.tree as VNode<Props>).props.children as unknown[]).filter((child) => (child as VNode | null)?.type !== Disclosure);
    const line = found(compact, "p").find((p) => p.class === "lre-prep-live-now");
    expect(textOf(line?.children)).toBe("Reliving. The historian records s2, messages 7 to 12. Joss relives s1.");
    expect(found(compact, Meter).map((p) => [p.label, p.value, p.max])).toEqual([["1 of 2 stretches recorded", 1, 2]]);
    // The whole opens from the compact form: a native disclosure, closed here, its toggle kept by the card.
    const whole = found(closed.tree, Disclosure)[0] ?? {};
    expect([whole.summary, whole.open]).toEqual(["The whole preparation", false]);
    (whole.onToggle as (open: boolean) => void)(true);
    expect(closed.toggled).toEqual([true]);
    expect(Disclosure(whole as Parameters<typeof Disclosure>[0]).props.children[1]).toBeNull();

    const open = drawn(view, true).tree;
    expect(found(open, "div").flatMap((p) => (typeof p["data-lre-live"] === "string" ? [p["data-lre-live"]] : []))).toEqual(["stages", "runs", "cost", "progress", "trail"]);
    // Where it stands: every stage in order, the current one marked, one not needed saying why.
    expect(found(open, "li").flatMap((p) => (p["data-lre-stage"] ? [[p["data-lre-stage"], p["aria-current"] ?? null, textOf(p.children)]] : []))).toEqual([
      ["reading", null, "Reading the storydone"],
      ["planning", null, "Planningdone"],
      ["waiting", null, "Waiting for your wordnot needed: within your ceiling"],
      ["reliving", "step", "Relivingnow"],
      ["filling", null, "Filling in the restto come"],
      ["scene", null, "Setting the sceneto come"],
      ["ready", null, "Readyto come"],
    ]);
    // Who is at work: the author, the historian inside its run on its stretch, Joss on his.
    const rows = found(open, ListRow).filter((p) => String(p.row).startsWith("run:"));
    expect(rows.map((p) => [p.title, textOf(p.subtitle)])).toEqual([
      ["The author", "Opening stretches and starting who relives them. For 1 h 12 min.1,204,000 tokens in 42 calls."],
      ["The historian", "Recording s2, messages 7 to 12: 4 beats so far. For 9 min, inside the author's run.Its use is counted in the author's run."],
      ["Joss", "Reliving s1, messages 1 to 6. For 20 min.84,000 tokens in 7 calls."],
    ]);
    // Time and cost: spent against the cap as a bar, the reckoning beside it, and a rough time left.
    expect(found(open, Meter).map((p) => p.label)).toContain("Spent 1,204,000 tokens of your 2,000,000 tokens cap");
    expect(textOf(open)).toContain("Reckoned at 1,800,000 tokens in all, the author's own work included. Your cap is 2,000,000 tokens.");
    expect(textOf(open)).toContain("Rough time left: about 2 h 10 min for the 1 stretch not done yet, at the pace so far.");
    // How far along: who has relived what, as last checked; each principal; the chat's messages, adding up.
    expect(textOf(open)).toContain("s1, messages 1 to 6: 12 beats. Being relived by Joss; 1 of 2 through.");
    expect(found(open, ListRow).filter((p) => String(p.row).startsWith("principal:")).map((p) => [p.title, p.subtitle])).toEqual([
      ["Mara", "1 of 2 stretches relived · no outline yet · profile written"],
      ["Joss", "0 of 2 stretches relived · no outline yet · no profile yet"],
    ]);
    expect(textOf(open)).toContain("Of the chat's 13 messages when the plan was written.");
    // What happened, newest first, each with its time.
    expect(found(open, "li").flatMap((p) => (p["data-lre-trail"] ? [textOf(p.children).slice(5)] : []))).toEqual(["s2 opened for the historian.", "s1 recorded: 12 beats.", 'You told the author: "Leave out the boat races."', "The author wrote the plan: 2 stretches."]);
    expect(found(open, "time").map((p) => p.dateTime)).toEqual([new Date(ago(9)).toISOString(), new Date(ago(30)).toISOString(), new Date(ago(170)).toISOString(), new Date(ago(175)).toISOString()]);
  });

  test("no rough time left before a stretch is done, and an older file says what it doesn't keep", () => {
    const early = textOf(drawn(viewOf(live({ left: null })), true).tree);
    expect(early).not.toContain("Rough time left");
    const older = textOf(drawn(viewOf(live({ messages: null, relivedAt: null, reach: false, logged: false, trail: [] })), true).tree);
    expect(older).toContain("This preparation's file is older: it doesn't say whom each stretch reached or who has relived it.");
    expect(older).toContain("This preparation's file is older: it doesn't keep the chat's count, so how much is relived or filled from summaries can't be shown.");
    expect(older).toContain("This preparation's file is older and keeps no trail of its own: only its runs show here.");
  });

  test("a plan of forty stretches is grouped by how far each has come, with its counts, in a box of its own that scrolls; none is left out", () => {
    const states: PrepareStretchState[] = ["reading", ...Array<PrepareStretchState>(3).fill("reliving"), ...Array<PrepareStretchState>(24).fill("waiting"), ...Array<PrepareStretchState>(10).fill("done"), "dropped", "dropped"];
    const stretches = states.map((state, i) => stretch(`s${i + 1}`, state, { from: i * 30 + 1, to: i * 30 + 30, beats: state === "done" ? 12 : 0 }));
    expect(stretchGroups(stretches).map((g) => [g.label, g.stretches.length])).toEqual([
      ["Being read", 1],
      ["Being relived", 3],
      ["Waiting", 24],
      ["Done", 10],
      ["Dropped", 2],
    ]);
    const open = drawn(viewOf(live({ stretches })), true).tree;
    const groups = found(open, Disclosure).filter((p) => /\(\d+\)$/.test(String(p.summary)));
    expect(groups.map((p) => [p.summary, p.defaultOpen])).toEqual([
      ["Being read (1)", true],
      ["Being relived (3)", true],
      ["Waiting (24)", false],
      ["Done (10)", false],
      ["Dropped (2)", false],
    ]);
    // Every stretch is drawn, in its group, closed or not: a closed group says how many it holds.
    const items = found(open, "li").filter((p) => p["data-lre-stretch"] !== undefined);
    expect(items).toHaveLength(40);
    expect(stretches.every((s) => items.filter((p) => textOf(p.children).startsWith(`${s.id}, messages ${s.from} to ${s.to}`)).length === 1)).toBe(true);
    expect(found(open, "div").filter((p) => p.role === "region").map((p) => [p["aria-label"], p.tabIndex])).toEqual([
      ["Stretches", 0],
      ["What happened", 0],
    ]);
    // The box scrolls, and the whole goes to two columns only where the card is wide; the sheet carries it.
    expect(PREPARE_LIVE_CSS).toContain(".lre-prep-live-scroll{max-height:22em;overflow:auto;");
    expect(PREPARE_LIVE_CSS).toContain("@container lre-prep-live (min-width:720px){.lre-prep-live-whole{grid-template-columns:repeat(2,minmax(0,1fr))}}");
    expect(CSS).toContain(PREPARE_LIVE_CSS);
  });

  test("a run that failed says why in LumiAH's words, and what can be done", () => {
    const failed = run({ id: "run-joss", role: "principal", who: "joss", agent: "character", state: "failed", since: ago(40), endedAt: ago(15), used: { tokens: 84_000, calls: 7 }, reason: "The connection refused the call: the model is overloaded." });
    expect(runWords(failed, live(), NOW)).toEqual({ title: "Joss", doing: "Reliving what reached them", when: `Stopped at ${new Date(ago(15)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, used: "84,000 tokens in 7 calls", problem: "The connection refused the call: the model is overloaded. Start it again in the Harness tab: Agents, then Jobs." });
    expect(runWords(run({ state: "interrupted", reason: null, endedAt: ago(5) }), live(), NOW).problem).toBe("A restart cut it off. Carry on starts it again from its file.");
    expect(runWords(run({ role: "principal", who: "mara", agent: "character", state: "spent", stoppedAt: "allowance", reason: "It used its allowance." }), live(), NOW).problem).toBe("It used its allowance. Grant it more in the Harness tab: Agents, then Jobs.");
    const open = drawn(viewOf(live({ runs: [run(), failed] })), true).tree;
    const row = found(open, ListRow).find((p) => p.row === "run:principal:run-joss") ?? {};
    expect(textOf(row.subtitle)).toContain("The connection refused the call: the model is overloaded. Start it again in the Harness tab: Agents, then Jobs.");
    expect(found(row.badge, Badge).map((p) => [p.tone, textOf(p.children)])).toEqual([["neg", "Failed"]]);
    expect(trailWords({ at: ago(15), what: "run_stopped", role: "principal", who: "joss", agent: "character", text: "The connection refused the call." }, names)).toBe("Joss's run stopped: The connection refused the call.");
  });

  test("it asks again while a run is at work, at the pace the setting gives, and stops once the preparation is done", async () => {
    const answers: (PrepareLiveView | null)[] = [viewOf(live()), null, viewOf(live({ stage: "ready", going: "done" }), false)];
    let asked = 0;
    const waits: number[] = [];
    const shown: PrepareLiveView[] = [];
    let next: (() => void) | null = null;
    // A round of asking is over once it set its next ask, or showed a view that sets none.
    let round = Promise.withResolvers<void>();
    const stop = watchPreparation({
      ask: async () => {
        asked++;
        return answers.shift() ?? null;
      },
      later: (ms, then) => {
        waits.push(ms);
        next = then;
        round.resolve();
        return () => {
          next = null;
        };
      },
      show: (view) => {
        shown.push(view);
        if (!view.live) round.resolve();
      },
    });
    const tick = async (): Promise<void> => {
      round = Promise.withResolvers<void>();
      const then = next;
      next = null;
      then?.();
      await round.promise;
    };
    await round.promise;
    expect([asked, waits]).toEqual([1, [5000]]);
    // An ask that failed is made again at the last answer's pace.
    await tick();
    expect([asked, waits, shown.length]).toEqual([2, [5000, 5000], 1]);
    // Done: shown, and no ask after it.
    await tick();
    expect([asked, waits, shown.at(-1)?.prep?.going, next]).toEqual([3, [5000, 5000], "done", null]);
    stop();
    expect(nextAsk(viewOf(live({ going: "waiting" }), false))).toBeNull();
    expect(nextAsk({ at: NOW, live: true, every: 12, prep: live() })).toBe(12_000);
  });
});
