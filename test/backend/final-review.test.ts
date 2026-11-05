// The final review (DESIGN §4.6): before every reply of an agent chat, once the engine has made the
// turn's sections and before the guard writes them, the main agent reviews the narrator's prompt and
// may revise it a line, or a block of lines, at a time. Its edits reach the reply's prompt (what
// Lumiverse's Prompt Breakdown shows), land on the turn's record outside every hash, and are told
// again by a Re-narrate and by a kept turn's retry; it works on the fixed pipeline (the main agent
// alone) and with a main agent deciding (its stage 6); a review that fails sends the prompt
// unrevised with a Diagnostics record, or stops the turn under Stop; turned off, nothing runs. And
// the ways a long chat's reviews failed: a block taken out a line at a time, the same line number
// each call, which the loop detector stopped; a review out of its time, each still sending the
// reply; a first call that read nothing of the session's cache, being offered other tools than the
// stages before it; and edits each answered with their whole section. The models are scripted on
// Port Alder, every role prompt-only.

import { describe, expect, test } from "bun:test";
import { commitReview, reviewTools } from "../../src/backend/agents/final-review";
import type { ToolCtx } from "../../src/backend/agents/runtime";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { cacheBreakpoints } from "../../src/backend/spindle-host";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import { defaultAgentSettings } from "../../src/shared/agent-settings";
import { applyFinalEdits, changedScope, type FinalEdit, finalPartsOf, partHash, partOf, partText, ReviewDraft, RULES_PART } from "../../src/shared/final-review";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
/** What the review's message says, as shipped, in either pipeline. */
const REVIEW_MARK = "review the prompt it gets";
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));
/** The line the scripted review adds to the Scene. */
const LINE = "- REVIEWED: a gull lands on the railing beside you.";

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");
/** What the tools gave back to the call that sends their results. */
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
/** The message a main agent's call works on: its latest that isn't its tools' results, a stage's or the review's. */
const workedOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && !(m.parts ?? []).some((p) => p.type === "tool_result"))?.content ?? "";
/** The review's call, in either pipeline: with a main agent deciding, it is offered every tool its stages are. */
const isReview = (req: QuietRequest): boolean => workedOf(req).includes(REVIEW_MARK);
/** A main agent's stage: it is offered run_role. */
const isMain = (req: QuietRequest): boolean => !isReview(req) && (req.tools ?? []).some((t) => t.name === "run_role");

/** Part `id`'s lines as the latest part shown in `req` numbers them, from 1. */
function shownLines(req: QuietRequest, id: string): string[] {
  const sent = sentOf(req);
  const lines: string[] = [];
  for (const row of sent.slice(sent.lastIndexOf(`Part ${id}: `)).split("\n").slice(1)) {
    const numbered = /^(\d+): (.*)$/.exec(row);
    if (!numbered || Number(numbered[1]) !== lines.length + 1) break;
    lines.push(numbered[2] ?? "");
  }
  return lines;
}

/** Adds LINE to the Scene and commits, in one answer. */
const appendLine = (): QuietScript => ({ content: "", toolCalls: [call("review_append", { part: "scene", text: LINE }, "edit"), call("commit", {}, "done")] });

/**
 * The scripted models: the review answers `review`; a main agent's stage answers `stage` where it
 * answers the call (its `n`th), else runs every role its stage asks for and commits; the roles'
 * classic calls read no action and propose nothing. Each review call, in order.
 */
function models(rig: Rig, review: (req: QuietRequest) => QuietScript | Promise<QuietScript> = appendLine, stage?: (req: QuietRequest, n: number) => QuietScript | undefined): QuietRequest[] {
  const reviews: QuietRequest[] = [];
  let stages = 0;
  rig.host.quietReply = (req) => {
    if (isReview(req)) {
      reviews.push(req);
      return review(req);
    }
    if (isMain(req)) {
      const n = stages++;
      const own = stage?.(req, n);
      if (own !== undefined) return own;
      const message = workedOf(req);
      const roles = [...new Set([...message.slice(message.lastIndexOf("Stage ")).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      return { content: "", toolCalls: [...roles.map((role) => call("run_role", { role, task: `task for ${role}` }, `c${n}_${role}`)), call("commit", {}, `c${n}_commit`)] };
    }
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
  return reviews;
}

/** A Port Alder chat on agents, every role prompt-only; `patch` joins the settings. */
async function agentsChat(rig: Rig, patch: JsonObject = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: PROMPT_ONLY } } }));
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  return chatId;
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Plays `text` as the next turn with `reply`: the Scene its prompt held, and its record. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<{ scene: string; rec: Rec }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  const scene = rig.host.section("Scene");
  await rig.host.finish(g, reply);
  return { scene, rec: await lastRecord(rig, chatId) };
}

/** Starts a swipe of the head reply as a Re-narrate. */
async function renarrate(rig: Rig, chatId: string) {
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "renarrate" }));
  return rig.host.start(chatId, { type: "swipe" });
}

const reviewRecords = async (rig: Rig, chatId: string) => (await rig.rt.diag.records(chatId, rig.host.userId)).filter((r) => r.step === "final review");

describe("the review's draft", () => {
  test("edits a line by its number, adds at the end, takes a line out, each saying where it now stands, and tells its edits again where the lines still stand", () => {
    const scene = partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the harbor.\n- It rains.");
    expect(scene).toEqual({ id: "scene", label: "Scene", header: "[Scene]", lines: ["Where you are.", "- At the harbor.", "- It rains."] });
    const draft = new ReviewDraft([scene], 2000);
    expect(draft.replace("scene", 3, "- It drizzles {{char}}.")).toMatchObject({ part: { lines: ["Where you are.", "- At the harbor.", "- It drizzles ｛｛char｝｝."] }, at: 2, count: 1 });
    expect(draft.append("scene", "- A gull.\n- Another gull.")).toMatchObject({ part: { lines: ["Where you are.", "- At the harbor.", "- It drizzles ｛｛char｝｝.", "- A gull.", "- Another gull."] }, at: 3, count: 2 });
    expect(draft.drop("scene", 1)).toMatchObject({ part: { lines: ["- At the harbor.", "- It drizzles ｛｛char｝｝.", "- A gull.", "- Another gull."] }, at: 0, count: 0 });
    expect(draft.replace("scene", 9, "x")).toMatchObject({ refused: "line", line: 9 });
    expect(draft.append("people", "x")).toEqual({ refused: "part" });
    expect(draft.append("scene", "  \n ")).toEqual({ refused: "text" });
    // Told again on the same prompt, every edit finds its line; on one whose line is gone, that edit changes nothing.
    const again = applyFinalEdits([scene], draft.edits);
    expect(again.missed).toEqual([]);
    expect(partText(again.parts[0] ?? scene)).toBe(partText(draft.parts[0] ?? scene));
    const moved = applyFinalEdits([partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the harbor.")], draft.edits);
    expect(moved.missed.map((e) => e.op)).toEqual(["replace"]);
  });

  test("a block, from one line through another in either order, is rewritten or taken out in one edit, recorded line by line so it is told again as any edit is", () => {
    const scene = partOf("scene", "Scene", "[Scene]\nWhere you are.\n- [LOC] The boatyard: the harbor's own.\n\n### Boats\n- A dinghy.\n- It rains.");
    const draft = new ReviewDraft([scene], 2000);
    // A lore entry the Scene tells whole, lines 2 to 5, becomes two lines: the rest of the block goes from after them.
    expect(draft.replace("scene", 2, "- The boatyard is the harbor's.\n- None of it is yours.", 5)).toMatchObject({ part: { lines: ["Where you are.", "- The boatyard is the harbor's.", "- None of it is yours.", "- It rains."] }, at: 1, count: 2 });
    expect(draft.drop("scene", 3, 2)).toMatchObject({ part: { lines: ["Where you are.", "- It rains."] }, at: 1, count: 0 });
    // A block past the part's end is refused, naming the number it doesn't have, and changes nothing.
    expect(draft.drop("scene", 1, 3)).toMatchObject({ refused: "line", line: 3 });
    expect(draft.replace("scene", 0, "x", 1)).toMatchObject({ refused: "line", line: 0 });
    expect(draft.edits).toEqual([
      { op: "replace", part: "scene", at: 1, line: "- [LOC] The boatyard: the harbor's own.", text: "- The boatyard is the harbor's.\n- None of it is yours." },
      { op: "drop", part: "scene", at: 3, line: "" },
      { op: "drop", part: "scene", at: 3, line: "### Boats" },
      { op: "drop", part: "scene", at: 3, line: "- A dinghy." },
      { op: "drop", part: "scene", at: 1, line: "- The boatyard is the harbor's." },
      { op: "drop", part: "scene", at: 1, line: "- None of it is yours." },
    ]);
    const again = applyFinalEdits([scene], draft.edits);
    expect([again.missed, partText(again.parts[0] ?? scene)]).toEqual([[], partText(draft.parts[0] ?? scene)]);
  });

  test("scoped to what changed (`changedScope`): a part that reads as the last review saw it gets that review's edits made again; only the parts that changed are sent; nothing changed sends nothing", () => {
    const rules = partOf(RULES_PART, "Narrator rules", "[Narrator rules]\n- Write in the second person.");
    const scene = partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the harbor.");
    const before = partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the pier.");
    const edits: FinalEdit[] = [
      { op: "append", part: RULES_PART, text: "- Keep it brief." },
      { op: "append", part: "scene", text: "- A gull." },
    ];
    const last = { parts: { [RULES_PART]: partHash(rules), scene: partHash(before) }, edits };
    const scoped = changedScope([rules, scene], last);
    expect(scoped.kept.map((p) => [p.id, p.lines])).toEqual([[RULES_PART, ["- Write in the second person.", "- Keep it brief."]]]);
    expect(scoped.applied).toEqual([edits[0]]);
    expect(scoped.changed).toEqual([scene]);
    // The parts given are left as they were.
    expect(rules.lines).toEqual(["- Write in the second person."]);
    // Nothing changed: nothing to send, and every edit made again.
    const same = changedScope([rules, before], last);
    expect([same.changed, same.applied]).toEqual([[], edits]);
    // A part the last review never saw is sent.
    expect(changedScope([rules, scene], { parts: {}, edits }).changed.map((p) => p.id)).toEqual([RULES_PART, "scene"]);
    // A record's parts read leniently: anything but fingerprints by part reads as none of them.
    expect([finalPartsOf(null), finalPartsOf(["x"]), finalPartsOf({ scene: "h1", rules: 3 })]).toEqual([{}, {}, { scene: "h1" }]);
  });
});

describe("the review's tools", () => {
  const ctx: ToolCtx = { signal: new AbortController().signal, agentId: "agent_test", role: "main", callId: "call" };
  /** Port Alder's Scene as long as a long chat's: twelve lines. */
  const twelve = (): ReviewDraft => new ReviewDraft([partOf("scene", "Scene", ["[Scene]", ...Array.from({ length: 12 }, (_, i) => `- Line ${i + 1}.`)].join("\n"))], 2000);

  test("regression: an edit answers with the lines it made and two either side, each numbered as the part reads after it, never the whole part; review_read shows it whole", async () => {
    const work = { draft: twelve(), done: { committed: false } };
    const tools = new Map(reviewTools({}, work).map((t) => [t.name, t]));
    const answer = async (name: string, args: JsonObject): Promise<string> => (await tools.get(name)?.run(args, ctx))?.text ?? "";
    // Line 6 becomes two: lines 4 to 9 of the 13 it now has.
    expect(await answer("review_replace", { part: "scene", line: 6, text: "- New six.\n- New seven." })).toBe(["Done. Part scene now has 13 lines; around your edit it reads:", "4: - Line 4.", "5: - Line 5.", "6: - New six.", "7: - New seven.", "8: - Line 7.", "9: - Line 8."].join("\n"));
    // A block out at the start: the two lines after the cut, numbered afresh.
    expect(await answer("review_drop", { part: "scene", line: 1, to: 3 })).toBe(["Done. Part scene now has 10 lines; around the cut it reads:", "1: - Line 4.", "2: - Line 5."].join("\n"));
    // A line out in the middle: two either side of the cut.
    expect(await answer("review_drop", { part: "scene", line: 5 })).toBe(["Done. Part scene now has 9 lines; around the cut it reads:", "3: - New six.", "4: - New seven.", "5: - Line 8.", "6: - Line 9."].join("\n"));
    // Lines added at the end: they and the two before them.
    expect(await answer("review_append", { part: "scene", text: "- Last." })).toBe(["Done. Part scene now has 10 lines; around your edit it reads:", "8: - Line 11.", "9: - Line 12.", "10: - Last."].join("\n"));
    // The whole part only on demand.
    const read = await answer("review_read", { part: "scene" });
    expect(read).toBe(["Part scene: [Scene]", ...["- Line 4.", "- Line 5.", "- New six.", "- New seven.", "- Line 8.", "- Line 9.", "- Line 10.", "- Line 11.", "- Line 12.", "- Last."].map((line, i) => `${i + 1}: ${line}`)].join("\n"));
    expect(await tools.get("review_read")?.run({ part: "people" }, ctx)).toEqual({ text: "No part of the narrator's prompt has the id people. Its parts are scene.", error: true });
    // Taken out to its last line, a part says it has none.
    expect(await answer("review_drop", { part: "scene", line: 1, to: 10 })).toBe("Done. Part scene now has 0 lines; around the cut it reads:\n(no lines)");
    // Committed, every call is refused: the narrator has the prompt.
    expect(commitReview({}, work)).toMatchObject({ end: true });
    expect(await tools.get("review_read")?.run({ part: "scene" }, ctx)).toMatchObject({ error: true, text: expect.stringContaining("is committed") });
  });

  test("out of the review (a main agent's other stages, which are offered them too), each review tool is refused and changes nothing", async () => {
    const tools = reviewTools({}, null);
    expect(tools.map((t) => t.name)).toEqual(["review_replace", "review_append", "review_drop", "review_read"]);
    // The same tools, word for word, as the review's own: only what they work on differs.
    expect(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).toEqual(reviewTools({}, { draft: twelve(), done: { committed: false } }).map(({ name, description, parameters }) => ({ name, description, parameters })));
    for (const tool of tools) expect(await tool.run({ part: "scene", line: 1, text: LINE }, ctx)).toEqual({ text: `${tool.name} edits the narrator's prompt, and works only in the final review that opens stage 6, once the engine has made the prompt. In this stage, run the roles you want, then call commit.`, error: true });
  });
});

describe("the final review", () => {
  test("on the fixed pipeline the main agent works it alone, and its edit reaches the reply's prompt, the record and GM → Live", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const reviews = models(rig);
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews).toHaveLength(1);
    const sent = sentOf(reviews[0] as QuietRequest);
    // Its own system prompt, the turn task and the prompt part by part, the narrator rules among them.
    expect(sent).toContain("you do one job in it");
    expect(sent).toContain("The player's message:\nI look out over the harbor.");
    expect(sent).toContain("Part scene: [Scene]");
    expect(sent).toContain("Part narrator_rules: [Narrator rules]");
    // Alone, it is offered the review's tools beside its read tools, none of a stage's.
    const names = (reviews[0]?.tools ?? []).map((t) => t.name);
    expect([names.slice(0, 5), names.includes("run_role")]).toEqual([["review_replace", "review_append", "review_drop", "review_read", "commit"], false]);
    expect(scene).toContain(LINE);
    expect(rec.finalEdits).toEqual([{ op: "append", part: "scene", text: LINE }]);
    const live = rig.rt.live.view(chatId, rig.host.userId);
    expect(live?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "revised", edits: [{ part: "scene", label: "Scene", op: "append", text: LINE }] });
    expect(live?.entries.some((e) => e.kind === "agent" && e.role === "main" && e.stage === "The final review")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with a main agent deciding, it opens stage 6 from the turn's session, and its rewrite reaches the prompt", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { pipeline: { mode: "main" } } });
    let original = "";
    const reviews = models(rig, (req) => {
      original = /Part scene: \[Scene\]\n1: (.*)/.exec(sentOf(req))?.[1] ?? "";
      return { content: "", toolCalls: [call("review_replace", { part: "scene", line: 1, text: "Where you are, as the main agent put it." }, "edit"), call("commit", {}, "done")] };
    });
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews).toHaveLength(1);
    const req = reviews[0] as QuietRequest;
    expect(req.messages[0]?.content).toContain("Each turn, the engine opens its stages");
    expect(req.messages.at(-1)?.content).toContain("Stage 6 of 8: the narrator's reply.");
    // Its history holds the turn's earlier stages.
    expect(sentOf(req)).toContain("Stage 1 of 8");
    expect(original).not.toBe("");
    expect(scene).toContain("Where you are, as the main agent put it.");
    expect(scene).not.toContain(original);
    expect(rec.finalEdits).toEqual([{ op: "replace", part: "scene", at: 0, line: original, text: "Where you are, as the main agent put it." }]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("it may fix, rewrite or take out an Outcome or Montage line: the narrator gets the edit and the record keeps it, while the ledger keeps what the engine did", async () => {
    const FIXED = "- An hour passes quietly at the harbor.";
    const skip = JSON.stringify({ action: "timelapse", params: { span: "over the next hour" }, confidence: 0.9 });
    const turn = async (review: (req: QuietRequest) => QuietScript): Promise<{ outcome: string; montage: string; rec: Rec; shown: { outcome: string[]; montage: string[] } }> => {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig);
      const shown = { outcome: [] as string[], montage: [] as string[] };
      models(rig, (req) => {
        shown.outcome = shownLines(req, "outcome");
        shown.montage = shownLines(req, "montage");
        return review(req);
      });
      const base = rig.host.quietReply;
      rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? skip : base ? base(req) : "{}");
      rig.host.sendUser(chatId, "OOC: skip ahead an hour.");
      await rig.host.settle();
      const g = await rig.host.start(chatId, { type: "normal" });
      expect(g.halted).toBeUndefined();
      const outcome = rig.host.section("Outcome") ?? "";
      const montage = rig.host.section("Montage") ?? "";
      await rig.host.finish(g, "An hour goes by.");
      expect(rig.rt.ledger.errors).toEqual([]);
      return { outcome, montage, rec: await lastRecord(rig, chatId), shown };
    };
    // The review rewrites the Outcome's first line, and takes the Montage's first out where it has one.
    const edited = await turn((req) => ({ content: "", toolCalls: [call("review_replace", { part: "outcome", line: 1, text: FIXED }, "fix"), ...(shownLines(req, "montage").length > 0 ? [call("review_drop", { part: "montage", line: 1 }, "drop")] : []), call("commit", {}, "done")] }));
    const [first = ""] = edited.shown.outcome;
    expect(first).not.toBe("");
    expect([edited.outcome.includes(FIXED), edited.outcome.includes(first)]).toEqual([true, false]);
    expect(edited.rec.finalEdits?.[0]).toEqual({ op: "replace", part: "outcome", at: 0, line: first, text: FIXED });
    const [gone] = edited.shown.montage;
    if (gone !== undefined) expect([edited.rec.finalEdits?.[1], edited.montage.includes(gone)]).toEqual([{ op: "drop", part: "montage", at: 0, line: gone }, false]);
    // The same turn with nothing edited: the engine's events are the same, edit or none.
    const plain = await turn(() => ({ content: "", toolCalls: [call("commit", {}, "done")] }));
    expect(plain.outcome).toContain(first);
    expect(JSON.stringify(edited.rec.events)).toBe(JSON.stringify(plain.rec.events));
  });

  test("regression: with a main agent deciding, every call of its turn is offered the same tools and system prompt, so the review's first call opens with the prompt its last stage's call cached", async () => {
    const rig = new Rig({ shipped: true });
    // An Anthropic connection that caches: its cache keys on the tools, then the system prompt, then the messages up to a breakpoint.
    rig.host.connectionProfiles.push({ id: "conn_cached", name: "Cached", models: ["claude-opus"], provider: "anthropic", cache: cacheBreakpoints("anthropic", { prompt_caching: true }) });
    const chatId = await agentsChat(rig, { agents: { pipeline: { mode: "main" }, main: { connectionId: "conn_cached" } } });
    const reviews = models(rig);
    const { rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect([reviews.length, rec.finalEdits]).toEqual([1, [{ op: "append", part: "scene", text: LINE }]]);
    // Every call of the main agent's turn, the review's among its stages': each is offered run_role.
    const calls = rig.host.quietCalls.filter((req) => (req.tools ?? []).some((t) => t.name === "run_role"));
    const at = calls.indexOf(reviews[0] as QuietRequest);
    expect([at > 0, calls.slice(at + 1).some(isMain)]).toEqual([true, true]);
    // What the cache keys on, beside the messages: the tools, the system prompt, and the model and its thinking, which go with the effort and the call's tokens.
    expect(new Set(calls.map((req) => JSON.stringify({ tools: req.tools, system: req.messages[0], connectionId: req.connectionId, model: req.model, effort: req.effort, maxTokens: req.maxTokens }))).size).toBe(1);
    expect((calls[0]?.tools ?? []).map((t) => t.name)).toEqual(expect.arrayContaining(["run_role", "revise", "commit", "condense", "review_replace", "review_append", "review_drop", "review_read"]));
    // The stage before it sent one call, a breakpoint after its message; the review's first call opens with that call's prompt word for word.
    const review = reviews[0] as QuietRequest;
    const last = calls[at - 1] as QuietRequest;
    expect(last.messages.at(-1)?.parts?.at(-1)?.cache).toBe(true);
    const turns = (req: QuietRequest): string[][] => req.messages.map((m) => [m.role, m.content]);
    expect(turns(review).slice(0, last.messages.length)).toEqual(turns(last));
    expect(review.messages.length).toBeGreaterThan(last.messages.length);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with a main agent deciding, a review tool called in a stage and a stage's tool called in the review are refused, and change nothing", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { pipeline: { mode: "main" } } });
    // Its first stage edits the narrator's prompt before the engine has made it; its review runs a role, then adds LINE and commits.
    const reviews = models(
      rig,
      (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("run_role", { role: "scene", task: "Look again." }, "late")] } : appendLine()),
      (_req, n) => (n === 0 ? { content: "", toolCalls: [call("review_append", { part: "scene", text: LINE }, "early")] } : undefined),
    );
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const answered = (req: QuietRequest | undefined) => (req?.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [{ text: p.content, error: p.isError === true }] : []));
    expect(answered(rig.host.quietCalls.find((req) => isMain(req) && resultsOf(req).length > 0))).toEqual([{ text: "review_append edits the narrator's prompt, and works only in the final review that opens stage 6, once the engine has made the prompt. In this stage, run the roles you want, then call commit.", error: true }]);
    expect(reviews).toHaveLength(2);
    expect(answered(reviews[1])).toEqual([{ text: "run_role works in the turn's other stages, not in its final review. Here, edit the narrator's prompt with review_replace, review_append and review_drop, read a part whole with review_read, then call commit.", error: true }]);
    // No role ran between the review's calls, and the prompt has the review's line once.
    expect(rig.host.quietCalls.indexOf(reviews[1] as QuietRequest)).toBe(rig.host.quietCalls.indexOf(reviews[0] as QuietRequest) + 1);
    expect([scene.split(LINE).length - 1, rec.finalEdits]).toEqual([1, [{ op: "append", part: "scene", text: LINE }]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Re-narrate tells the revised prompt again, with no review call", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const reviews = models(rig);
    const first = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const g = await renarrate(rig, chatId);
    expect(g.halted).toBeUndefined();
    expect(rig.host.section("Scene")).toBe(first.scene);
    expect(reviews).toHaveLength(1);
    await rig.host.finish(g, "The gulls wheel on.");
    expect((await lastRecord(rig, chatId)).finalEdits).toEqual(first.rec.finalEdits);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("scoped to what changed, with Smart persistence on: a part that reads as the last turn's review saw it gets that review's edits again and isn't sent; scoped to every part, each turn's review is sent all", async () => {
    const RULE = "- RULE-MARK: keep it brief.";
    const turns = async (scope: "all" | "changed") => {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig, { agents: { persist: { on: true }, finalReview: { scope } } });
      // The first review adds a rule; the next adds nothing.
      const reviews = models(rig, (req) => (reviews.length === 1 ? { content: "", toolCalls: [call("review_append", { part: RULES_PART, text: RULE }, "edit"), call("commit", {}, "done")] } : { content: "", toolCalls: [call("commit", {}, "done")] }));
      const first = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
      const second = await played(rig, chatId, "I watch the boats come in.", "The boats come in.");
      return { reviews, first, second, rules: rig.host.section("Narrator rules"), errors: rig.rt.ledger.errors };
    };
    const changed = await turns("changed");
    // Each turn's record keeps the parts its review saw.
    expect(Object.keys(changed.first.rec.finalParts ?? {})).toContain(RULES_PART);
    expect(changed.first.rec.finalParts).toEqual(expect.objectContaining({ [RULES_PART]: expect.any(String) }));
    expect(changed.reviews).toHaveLength(2);
    expect(sentOf(changed.reviews[0] as QuietRequest)).toContain(`Part ${RULES_PART}: [Narrator rules]`);
    // The rules read as they did: not sent again, the rule made again, on the prompt and the record.
    expect(sentOf(changed.reviews[1] as QuietRequest)).not.toContain(`Part ${RULES_PART}: [Narrator rules]`);
    expect(sentOf(changed.reviews[1] as QuietRequest)).toContain("Part scene: [Scene]");
    expect(changed.rules).toContain(RULE);
    expect(changed.second.rec.finalEdits).toEqual([{ op: "append", part: RULES_PART, text: RULE }]);
    expect(changed.errors).toEqual([]);
    // Every part: the second review is sent the rules again, and no edit is made for it.
    const all = await turns("all");
    expect(all.reviews).toHaveLength(2);
    expect(sentOf(all.reviews[1] as QuietRequest)).toContain(`Part ${RULES_PART}: [Narrator rules]`);
    expect(all.rules).not.toContain(RULE);
    expect(all.second.rec.finalEdits).toBeUndefined();
    expect(all.errors).toEqual([]);
  });

  test("regression: scoped to what changed, a review that fails keeps on its record only the parts an earlier review saw as they read, so the next turn's review is sent the rest", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { persist: { on: true }, finalReview: { scope: "changed" } } });
    // The provider is down for the first turn's review and the third's.
    let down = true;
    const reviews = models(rig, () => {
      if (down) throw new Error("the provider is down");
      return { content: "", toolCalls: [call("commit", {}, "done")] };
    });
    const first = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(first.rec.finalParts).toBeUndefined();
    // The rules read as they did, but no review saw them: this one is sent them, and keeps every part.
    down = false;
    const sent = reviews.length;
    const second = await played(rig, chatId, "I watch the boats come in.", "The boats come in.");
    expect(reviews.length).toBeGreaterThan(sent);
    expect(sentOf(reviews.at(-1) as QuietRequest)).toContain(`Part ${RULES_PART}: [Narrator rules]`);
    expect(Object.keys(second.rec.finalParts ?? {})).toEqual(expect.arrayContaining([RULES_PART, "scene"]));
    // Failing again, it keeps the rules as the second review saw them, and not the Scene, which changed.
    down = true;
    const third = await played(rig, chatId, "I wave to the harbormaster.", "He waves back.");
    expect(third.rec.finalParts?.[RULES_PART]).toBe(second.rec.finalParts?.[RULES_PART]);
    expect(Object.keys(third.rec.finalParts ?? {})).not.toContain("scene");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Continue gets a fresh review of its own sections, in either pipeline, and its edit reaches the Continue's prompt", async () => {
    for (const mode of ["fixed", "main"] as const) {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig, { agents: { pipeline: { mode } } });
      const reviews = models(rig);
      await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
      expect(reviews).toHaveLength(1);
      const g = await rig.host.start(chatId, { type: "continue" });
      expect(g.halted).toBeUndefined();
      // A review of its own, alone, of the sections made for the Continue.
      expect([mode, reviews.length]).toEqual([mode, 2]);
      const sent = sentOf(reviews[1] as QuietRequest);
      expect(sent).toContain("you do one job in it");
      expect(sent).toContain("Part scene: [Scene]");
      expect(rig.host.section("Scene")).toContain(LINE);
      await rig.host.finish(g, " The gulls settle.");
      const live = rig.rt.live.view(chatId, rig.host.userId);
      expect(live?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "revised" });
      expect((await reviewRecords(rig, chatId)).length).toBeGreaterThan(0);
      expect(rig.rt.ledger.errors).toEqual([]);
    }
  });

  test("replay: a failed reply's retry takes the revised prompt again with no call, and after a restart the record still tells it", async () => {
    const rig = new Rig({ shipped: true });
    // A swipe re-runs the turn here (it re-narrates by default).
    const chatId = await agentsChat(rig, { swipeDefault: "rerun" });
    const reviews = models(rig);
    const first = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    // A Re-run swipe is reviewed afresh; its reply fails, and the swipe after it takes the kept turn.
    const failed = await rig.host.start(chatId, { type: "swipe" });
    const prompt = structuredClone(rig.host.assembled);
    expect(reviews).toHaveLength(2);
    await rig.host.finish(failed, "", { error: "provider timeout" });
    const retry = await rig.host.begin(chatId, { type: "swipe" });
    expect(retry.halted).toBeUndefined();
    expect(rig.host.assembled).toEqual(prompt);
    expect(reviews).toHaveLength(2);
    await rig.host.finish(retry, "The gulls go quiet.");
    const kept = await lastRecord(rig, chatId);
    expect(kept.finalEdits).toEqual(first.rec.finalEdits);
    // A restart reads the record back from the chat: it folds to the same path and still carries the edits.
    const again = rig.restart();
    models(again);
    const read = await lastRecord(again, chatId);
    expect(read.path).toBe(kept.path);
    expect(read.finalEdits).toEqual(kept.finalEdits);
    const g = await renarrate(again, chatId);
    expect(g.halted).toBeUndefined();
    expect(again.host.section("Scene")).toContain(LINE);
    await again.host.finish(g, "The gulls settle.");
    expect(again.rt.ledger.errors).toEqual([]);
  });

  test("a review that fails sends the prompt unrevised, with a Diagnostics record", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const reviews = models(rig, () => {
      throw new Error("the provider is down");
    });
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews.length).toBeGreaterThan(0);
    expect(scene).toContain("[Scene]");
    expect(scene).not.toContain("REVIEWED");
    expect(rec.finalEdits).toBeUndefined();
    expect(rec.status).toBe("ok");
    const failed = (await reviewRecords(rig, chatId)).find((r) => r.status === "failed");
    expect(failed?.reason).toContain("the narrator gets the prompt as the engine made it");
    expect(failed?.fatal).toBeUndefined();
    expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "unrevised" });
  });

  test("under Stop the turn, a review that fails stops the turn before its reply", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { finalReview: { onFail: "stop" } } });
    models(rig, () => {
      throw new Error("the provider is down");
    });
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect((await reviewRecords(rig, chatId)).some((r) => r.fatal === true)).toBe(true);
    expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "stopped" });
  });

  test("turned off, nothing runs: no review call, no record of one, and the prompt as the engine made it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { agents: { finalReview: { on: false } } });
    const reviews = models(rig);
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews).toHaveLength(0);
    expect(scene).toContain("[Scene]");
    expect(scene).not.toContain(LINE);
    expect(rec.finalEdits).toBeUndefined();
    expect(await reviewRecords(rig, chatId)).toEqual([]);
    expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.some((e) => e.kind === "review")).toBe(false);
  });

  test("regression: a review that takes a block out one call at a time, each the same line number, past the loop detector's count, commits every edit", async () => {
    for (const mode of ["fixed", "main"] as const) {
      const rig = new Rig({ shipped: true });
      const chatId = await agentsChat(rig, { agents: { pipeline: { mode } } });
      const loop = defaultAgentSettings().loopRepeats;
      // As a long chat's main agent did: the Scene's line 1 taken out, one call a round, a call more than the loop detector counts, then commit.
      let original: string[] = [];
      let calls = 0;
      const reviews = models(rig, (req) => {
        calls += 1;
        if (calls === 1) original = shownLines(req, "scene");
        return { content: "", toolCalls: [calls <= loop + 1 ? call("review_drop", { part: "scene", line: 1 }, `drop_${calls}`) : call("commit", {}, "done")] };
      });
      const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
      expect([mode, reviews.length, original.length > loop + 1]).toEqual([mode, loop + 2, true]);
      const dropped = original.slice(0, loop + 1);
      expect(scene.split("\n")).toEqual(["[Scene]", ...original.slice(loop + 1)]);
      expect(rec.finalEdits).toEqual(dropped.map((line) => ({ op: "drop", part: "scene", at: 0, line })));
      expect((await reviewRecords(rig, chatId)).filter((r) => r.status === "failed")).toEqual([]);
      expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "revised", edits: dropped.map((line) => ({ part: "scene", op: "drop", line })) });
      expect(rig.rt.ledger.errors).toEqual([]);
    }
  });

  test("a block goes in one call: review_replace and review_drop take to, its last line, and the record keeps each line's edit", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    let original: string[] = [];
    const reviews = models(rig, (req) => {
      original = shownLines(req, "scene");
      // Lines 2 and 3 become LINE; then lines 3 and 4 as they read after it (the first's 4 and 5) go, given last first.
      return { content: "", toolCalls: [call("review_replace", { part: "scene", line: 2, to: 3, text: LINE }, "edit"), call("review_drop", { part: "scene", line: 4, to: 3 }, "drop"), call("commit", {}, "done")] };
    });
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews).toHaveLength(1);
    for (const name of ["review_replace", "review_drop"]) expect(reviews[0]?.tools?.find((t) => t.name === name)?.parameters).toMatchObject({ properties: { to: { type: "integer", minimum: 1 } } });
    expect(original.length).toBeGreaterThan(5);
    expect(scene.split("\n")).toEqual(["[Scene]", original[0], LINE, ...original.slice(5)]);
    expect(rec.finalEdits).toEqual([
      { op: "replace", part: "scene", at: 1, line: original[1], text: LINE },
      { op: "drop", part: "scene", at: 2, line: original[2] },
      { op: "drop", part: "scene", at: 2, line: original[3] },
      { op: "drop", part: "scene", at: 2, line: original[4] },
    ]);
  });

  test("a review stuck on an edit its draft refuses still trips the loop detector: the reply goes out unrevised, and Diagnostics and GM → Live say why", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const loop = defaultAgentSettings().loopRepeats;
    const reviews = models(rig, () => ({ content: "", toolCalls: [call("review_drop", { part: "scene", line: 999 }, "drop")] }));
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    // Each refusal changes nothing, so the same call again is a repeat: the last isn't run.
    expect(reviews).toHaveLength(loop);
    expect(scene).toContain("[Scene]");
    expect(rec.finalEdits).toBeUndefined();
    expect(rec.status).toBe("ok");
    const why = `the agent called review_drop with the same arguments ${loop} times in a row (Loop detector)`;
    const failed = (await reviewRecords(rig, chatId)).find((r) => r.status === "failed");
    expect([failed?.reason, failed?.fatal]).toEqual([`${why}; the narrator gets the prompt as the engine made it`, undefined]);
    expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "unrevised", reason: why });
  });

  test("regression: a review that runs out of its time sends the reply with the prompt unrevised, naming the setting and how to raise it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, { timeouts: { finalReviewMs: 1_000 } });
    // The model is still thinking when the time runs out, as a large model's first answer on a long session was.
    const reviews = models(rig, () => new Promise<QuietScript>(() => undefined));
    const { scene, rec } = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(reviews).toHaveLength(1);
    expect(scene).toContain("[Scene]");
    expect(scene).not.toContain("REVIEWED");
    expect(rec.finalEdits).toBeUndefined();
    expect(rec.status).toBe("ok");
    const why = "Final review ran out after 1 s (Settings → Timeouts → Final review)";
    const failed = (await reviewRecords(rig, chatId)).find((r) => r.status === "failed");
    expect([failed?.reason, failed?.fix, failed?.fatal]).toEqual([`${why}; the narrator gets the prompt as the engine made it`, "Raise Final review in Settings → Timeouts, or set it to No limit.", undefined]);
    expect(rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "review")).toMatchObject({ outcome: "unrevised", reason: why });
  });
});
