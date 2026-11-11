// The engine's sections in a harness turn's prompt (HARNESS-SLICE3: "Sections where the preset
// places them"). The author works after Lumiverse assembled the prompt, so the guard writes each
// section into its entry as the chat's head has it, between marker lines, and the writer's request
// swaps each marked span whole for the turn's own section. A reply is never written from marker
// text: the prompt as assembled, with nothing replaced, is one a reply can be written from.

import { describe, expect, test } from "bun:test";
import type { HostPresetBlock } from "../../src/backend/host";
import { markedText, markerNonce } from "../../src/backend/harness/markers";
import { recHarnessOf } from "../../src/backend/harness/record";
import type { ModelMessage } from "../../src/backend/harness/shapes";
import { isRecord } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { AUTHOR, beginTurn, harnessChat, MARKER, noModelCalls, recordOn, type Run } from "./harness-driver";

const block = (name: string, content: string): HostPresetBlock => ({ id: `b_${name}`, name, content, enabled: true, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null });

interface Preview {
  slot: string;
  label: string;
  content: string | null;
}

/** Each section as the chat's head has it now, as GM → This chat → Sections previews it. */
async function headSections(rig: Rig, chatId: string): Promise<Preview[]> {
  return rig.body(await rig.send({ type: "lre.sections", chatId })).sections as Preview[];
}

/** The world's engine entries that hold text or are on, as the host stores them. */
async function liveEntries(rig: Rig, chatId: string): Promise<string[]> {
  const run = await rig.rt.runOf(chatId, rig.host.userId);
  const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
  return (await rig.host.books.entries(bookId, rig.host.userId)).filter((e) => isRecord(e.extensions[LEDGER_NAMESPACE]) && (!e.disabled || e.content !== "")).map((e) => e.comment);
}

/** The message that holds a section, by the label it starts with, among `messages`. */
const holding = (messages: readonly ModelMessage[], label: string): ModelMessage[] => messages.filter((m) => m.content.includes(`[${label}]\n`));

/** A first turn that leaves the head something to tell: Okoro arrives, ten minutes pass. */
async function firstTurn(rig: Rig, chatId: string): Promise<void> {
  const run = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
  await run.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
  await run.answer(AUTHOR, "time_pass", { minutes: 10 });
  await run.finish("Okoro is on the step before anyone answers.");
}

/** What the author does in the second turn, which the head doesn't hold: Brann arrives, twenty minutes pass. */
async function secondTurn(run: Run): Promise<void> {
  await run.answer(AUTHOR, "gm_move", { entity: "Brann", to: HOME });
  await run.answer(AUTHOR, "time_pass", { minutes: 20 });
  await run.answer(AUTHOR, "commit", {});
}

describe("a harness turn's sections", () => {
  test("the prompt as Lumiverse assembles it holds every section as the chat's head has it, between marker lines that read as comments", async () => {
    const { rig, chatId } = await harnessChat();
    await firstTurn(rig, chatId);
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    const head = await headSections(rig, chatId);
    const run = await beginTurn(rig, chatId, null);
    const nonce = markerNonce(run.turn);
    // Each section's entry holds the section as the head has it, between this turn's start and end markers for it: nothing else is in the engine's entries but the narrator rules.
    const entries = run.assembled.map((e) => e.content);
    const rules = entries.filter((content) => content.startsWith("[Narrator rules]"));
    expect(rules.length).toBe(1);
    expect(new Set(entries.filter((content) => !rules.includes(content)))).toEqual(new Set(head.map((s) => markedText(s.slot, nonce, s.content ?? ""))));
    // The head has something to tell, and it is told: who is here, what time it is, what the player character has.
    const told = head.filter((s) => s.content !== null);
    expect(told.map((s) => s.label)).toEqual(expect.arrayContaining(["Scene", "People", "Money", "Place"]));
    expect(told.find((s) => s.label === "People")?.content).toContain("Okoro");
    // A marker is one line of its own that reads as a comment, with no braces or angle brackets for a macro or an HTML pass to take.
    const lines = entries.flatMap((content) => content.split("\n")).filter((line) => MARKER.test(line));
    expect(lines.length).toBe(head.length * 2);
    for (const line of lines) expect(line).toMatch(/^\/\/ lre:[0-9a-f]{8}:[0-9a-f]{8}(:end)?$/);

    // The author works, and then the harness has no part in the reply after all (it failed, or ran out of time): Lumiverse sends the prompt as it was.
    await secondTurn(run);
    const asItWas = run.request(null);
    // With nothing replaced, that prompt holds every section's head-state text, whole and once, and nothing of the turn the harness never finished.
    for (const section of told) expect(asItWas.filter((m) => m.content.includes(section.content ?? "")).length).toBe(1);
    expect(holding(asItWas, "People")[0]?.content).not.toContain("Brann");
    expect(asItWas.some((m) => m.content.includes("[Outline]"))).toBe(false);
    // A reply written from it is written from the chat as it stood: it stands, with no record of a turn.
    await run.end("failed", { reason: "out of time" });
    if (!run.generation) throw new Error("no generation");
    await rig.host.finish(run.generation, "The step is quiet.");
    const reply = rig.host.head(chatId);
    expect(recHarnessOf(reply ? await recordOn(rig, chatId, reply.id) : null)).toBeNull();
    noModelCalls(rig);
  });

  test("the writer's request swaps each marked span whole for the turn's own section, where the preset placed it", async () => {
    const { rig, chatId } = await harnessChat();
    // The preset places Scene and Outcome itself, inside one block; every other section goes where its Position says.
    rig.host.presetBlocks = [block("Story", "Story so far.\n{{outlet::lre_scene}}\n{{outlet::lre_outcome}}\nEnd of story.")];
    rig.host.presetPlacesOutlets = true;
    rig.host.emitPresetChanged("preset-1");
    await rig.host.settle();
    await firstTurn(rig, chatId);
    const run = await beginTurn(rig, chatId, "I ask who else is expected.");
    // Once the prompt is assembled the book holds nothing of it, as after any turn's prompt.
    expect(await liveEntries(rig, chatId)).toEqual([]);
    await secondTurn(run);
    const brief = "- Brann leans in the doorway.\n- Okoro makes room.";
    const built = run.request(brief);
    const sent = await run.writer(brief, built);
    // No marker reaches the writer, and no section is told twice: each span went whole, head text and all.
    expect(sent.some((m) => MARKER.test(m.content))).toBe(false);
    for (const label of ["Scene", "People", "Money", "Place", "Outline"]) expect(holding(sent, label).length).toBe(1);
    // The Scene stands where the preset's outlet stood, inside the preset's own block; Outcome, with nothing to tell, leaves nothing there.
    const story = sent[0]?.content ?? "";
    expect(story.startsWith("Story so far.\n[Scene]\n")).toBe(true);
    expect(story.endsWith("\n\nEnd of story.")).toBe(true);
    expect(story).not.toContain("[Outcome]");
    // Every other section stands where its entry stood: the same messages, in the same order, each with the turn's section in place of the head's.
    const marked = built.map((m, i) => ({ i, marked: MARKER.test(m.content) })).filter((m) => m.marked && m.i > 0);
    const people = built.findIndex((m) => m.content.includes("[People]\n"));
    expect(marked.some((m) => m.i === people)).toBe(true);
    expect(sent.findIndex((m) => m.content.includes("[People]\n"))).toBeLessThanOrEqual(people);
    expect(sent.filter((m) => m.role !== "system").map((m) => m.content)).toEqual(built.filter((m) => m.role !== "system").map((m) => m.content));
    // What they tell is the turn as the author committed it, which the chat's ledger doesn't hold yet: Brann is here, and it is twenty minutes later.
    expect(holding(built, "People")[0]?.content).not.toContain("Brann");
    expect(holding(sent, "People")[0]?.content).toContain("Brann");
    expect(holding(sent, "Scene")[0]?.content).toContain("6:45 AM");
    expect(holding(built, "Scene")[0]?.content).toContain("6:25 AM");
    // The author's brief is the Outline, a line each, and the message the core put it in is gone with it.
    expect(holding(sent, "Outline")[0]?.content.endsWith("\n- Brann leans in the doorway.\n- Okoro makes room.")).toBe(true);
    expect(sent.some((m) => m.content.includes("The author's brief for this reply:"))).toBe(false);
    expect(sent.at(-1)).toEqual({ role: "user", content: "I ask who else is expected." });
    await run.written("Brann leans in the doorway.");
    if (!run.generation) throw new Error("no generation");
    await rig.host.finish(run.generation, "Brann leans in the doorway.");
    await run.end();
    expect(await liveEntries(rig, chatId)).toEqual([]);
    noModelCalls(rig);
  });

  test("a section the prompt holds no span for goes before the player's last message, with the others like it, in the sections' order", async () => {
    const { rig, chatId } = await harnessChat();
    const run = await beginTurn(rig, chatId, "I ask who else is expected.");
    await secondTurn(run);
    // The host left two entries out of this prompt, and another turn's stale section is still in it.
    const stale = markedText("scene", markerNonce("another-generation"), "[Scene]\nSTALE-MARK a turn long over.");
    const built = [...run.request(null).filter((m) => !m.content.includes("[People]\n") && !m.content.includes("[Money]\n")), { role: "system" as const, content: stale }];
    const sent = await run.writer(null, built);
    expect(sent.some((m) => MARKER.test(m.content))).toBe(false);
    expect(sent.some((m) => m.content.includes("STALE-MARK"))).toBe(false);
    const last = sent.findLastIndex((m) => m.role === "user");
    const loose = sent[last - 1];
    expect(loose?.role).toBe("system");
    expect(loose?.content.startsWith("[People]\n")).toBe(true);
    expect(loose?.content).toContain("\n\n[Money]\n");
    for (const label of ["Scene", "People", "Money"]) expect(holding(sent, label).length).toBe(1);
    await run.finish("Brann leans in the doorway.");
    noModelCalls(rig);
  });

  test("a prompt no turn is open for keeps the chat's head sections and loses only its marker lines", async () => {
    const { rig, chatId } = await harnessChat();
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    const head = await headSections(rig, chatId);
    const run = await beginTurn(rig, chatId, null);
    // The run failed before it asked for the writer's request, and the request is made all the same.
    await run.end("failed", { reason: "the connection dropped" });
    const sent = await run.writer(null);
    expect(sent.some((m) => MARKER.test(m.content))).toBe(false);
    for (const section of head.filter((s) => s.content !== null)) expect(sent.filter((m) => m.content === section.content).length).toBe(1);
    // A request with nothing of the engine's in it is left as the core built it.
    const plain: ModelMessage[] = [{ role: "user", content: "I wait." }];
    expect(await rig.rt.harness.extension.writerRequest?.({ userId: rig.host.userId, chatId, generationId: "no-such-generation", kind: "new", brief: null, messages: plain })).toBeNull();
    if (!run.generation) throw new Error("no generation");
    await rig.host.finish(run.generation, "Nothing moves.");
    noModelCalls(rig);
  });
});
