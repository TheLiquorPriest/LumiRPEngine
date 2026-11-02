// The final review (DESIGN §4.6): before every reply of an agent chat, once the engine has made the
// turn's sections and before the guard writes them, the main agent reviews the narrator's prompt and
// may revise it a line at a time. Its edits reach the reply's prompt (what Lumiverse's Prompt
// Breakdown shows), land on the turn's record outside every hash, and are told again by a
// Re-narrate and by a kept turn's retry; it works on the fixed pipeline (the main agent alone) and
// with a main agent deciding (its stage 6); a review that fails sends the prompt unrevised with a
// Diagnostics record, or stops the turn under Stop; turned off, nothing runs. The models are
// scripted on Port Alder, every role prompt-only.

import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import { applyFinalEdits, partOf, partText, ReviewDraft } from "../../src/shared/final-review";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));
/** The line the scripted review adds to the Scene. */
const LINE = "- REVIEWED: a gull lands on the railing beside you.";

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const isReview = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "review_replace");
const isMain = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "run_role");
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");

/** Adds LINE to the Scene and commits, in one answer. */
const appendLine = (): QuietScript => ({ content: "", toolCalls: [call("review_append", { part: "scene", text: LINE }, "edit"), call("commit", {}, "done")] });

/**
 * The scripted models: the review answers `review`; a main agent's stage runs every role it asks
 * for and commits; the roles' classic calls read no action and propose nothing. Each review call, in order.
 */
function models(rig: Rig, review: (req: QuietRequest) => QuietScript = appendLine): QuietRequest[] {
  const reviews: QuietRequest[] = [];
  let stage = 0;
  rig.host.quietReply = (req) => {
    if (isReview(req)) {
      reviews.push(req);
      return review(req);
    }
    if (isMain(req)) {
      const n = stage++;
      const message = req.messages.findLast((m) => m.role === "user")?.content ?? "";
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
  test("edits a line by its number, adds at the end, takes a line out, and tells its edits again where the lines still stand", () => {
    const scene = partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the harbor.\n- It rains.");
    expect(scene).toEqual({ id: "scene", label: "Scene", header: "[Scene]", lines: ["Where you are.", "- At the harbor.", "- It rains."] });
    const draft = new ReviewDraft([scene], 2000);
    expect(draft.replace("scene", 3, "- It drizzles {{char}}.")).toMatchObject({ lines: ["Where you are.", "- At the harbor.", "- It drizzles ｛｛char｝｝."] });
    expect(draft.append("scene", "- A gull.\n- Another gull.")).toMatchObject({ lines: ["Where you are.", "- At the harbor.", "- It drizzles ｛｛char｝｝.", "- A gull.", "- Another gull."] });
    expect(draft.drop("scene", 1)).toMatchObject({ lines: ["- At the harbor.", "- It drizzles ｛｛char｝｝.", "- A gull.", "- Another gull."] });
    expect(draft.replace("scene", 9, "x")).toMatchObject({ refused: "line" });
    expect(draft.append("people", "x")).toEqual({ refused: "part" });
    expect(draft.append("scene", "  \n ")).toEqual({ refused: "text" });
    // Told again on the same prompt, every edit finds its line; on one whose line is gone, that edit changes nothing.
    const again = applyFinalEdits([scene], draft.edits);
    expect(again.missed).toEqual([]);
    expect(partText(again.parts[0] ?? scene)).toBe(partText(draft.parts[0] ?? scene));
    const moved = applyFinalEdits([partOf("scene", "Scene", "[Scene]\nWhere you are.\n- At the harbor.")], draft.edits);
    expect(moved.missed.map((e) => e.op)).toEqual(["replace"]);
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
    const chatId = await agentsChat(rig);
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
});
