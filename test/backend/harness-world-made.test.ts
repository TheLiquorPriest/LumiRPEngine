// The world's document as it ships on the harness engine: the author decides and the user reviews
// after. A commit lands when the author commits, with nothing waiting for the user, and the reply
// lists what it changed with Undo (`harness/card.ts`); a draft that also holds the user's own Build
// edits never lands by itself; Undo puts the world and the chat back whole, or says why it can't.
// The review card names whoever staged a change as the harness names its agents.

import { describe, expect, test } from "bun:test";
import { worldBuild, type WorldBuild } from "../../src/backend/agents/tools/harness-ports";
import { stagedBy } from "../../src/backend/harness/card";
import { renderPrompt } from "../../src/backend/prompts";
import { sourceWords } from "../../src/frontend/review-card";
import { WORLD_NOTE } from "../../src/shared/harness-texts-world";
import type { ReviewCardView } from "../../src/shared/protocol";
import type { Chip } from "../../src/shared/state-view";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { AUTHOR, beginTurn, harnessChat, noModelCalls, stateOf } from "./harness-driver";

type Committed = { landed: string[][]; review: string[][]; refused: { lines: string[]; reason: string }[] };

const PIER = { title: "The old pier", content: "The old pier burned in the year of the long fog.", keys: ["pier"], links: [] };
const THEIRS = "The world's draft also holds your own edits from Build, so this waits for you.";

/** A harness chat, the way to its world's document, and the world's head before anything. */
async function made(): Promise<{ rig: Rig; chatId: string; build: WorldBuild; first: string }> {
  const { rig, chatId } = await harnessChat();
  const build = await worldBuild(rig.rt, chatId, rig.host.userId);
  if (!build) throw new Error("the harness chat plays no world");
  return { rig, chatId, build, first: await build.head() };
}

/** One turn whose author lays a place and a path to it, then asks for the commit and the move to it, and commits: what the commit answered. */
async function layPath(rig: Rig, chatId: string, between?: () => Promise<void>): Promise<Committed> {
  const turn = await beginTurn(rig, chatId, "I ask Mara whether the old mill past the creek still stands.");
  await turn.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: HOME, in: "document" });
  await between?.();
  await turn.answer(AUTHOR, "world_path", { from: HOME, to: "The Old Mill", minutes: 25, km: 2, in: "document" });
  await turn.answer(AUTHOR, "world_commit", { note: "The old mill and the way to it" });
  await turn.answer(AUTHOR, "world_upgrade");
  const committed = (await turn.answer(AUTHOR, "commit")).committed as Committed;
  await turn.finish("It still stands, Mara says, a half hour's walk past the creek.");
  return committed;
}

/** The user writes to Build's draft, as Build's own editor does. */
async function buildEdit(rig: Rig, worldId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "old_pier", value: PIER }));
}

const madeChips = async (rig: Rig, chatId: string): Promise<Chip[]> => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "world_made");
const cardsOf = async (rig: Rig, chatId: string): Promise<ReviewCardView[]> => rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];

/** Presses a chip's action, as the page does: the answer, or the refusal's words. */
async function press(rig: Rig, chatId: string, chip: string, choice: string): Promise<{ refused: string } | { done: true }> {
  const answer = await rig.send({ type: "lre.chip", chatId, chip, choice });
  return answer.type === "lre.error" ? { refused: answer.message } : { done: true };
}

describe("the world's document as it ships", () => {
  test("a commit lands when the author commits, with nothing waiting for the user: the world has a new revision, the chat plays it after the turn, and the reply lists the change, which undoing the turn leaves", async () => {
    const { rig, chatId, build, first } = await made();
    const committed = await layPath(rig, chatId);
    expect(committed).toMatchObject({ review: [], refused: [] });
    const second = await build.head();
    expect(second).not.toBe(first);
    expect((await stateOf(rig, chatId)).revision).toBe(second);
    expect((await build.revision(second)).routes).toHaveProperty(`rt_${HOME}_the_old_mill`);
    expect(await cardsOf(rig, chatId)).toEqual([]);
    // On the reply, marked as made: what the commit changed, in the lines its card would have listed.
    const [chip] = await madeChips(rig, chatId);
    expect(chip?.messageId).toBe(rig.host.head(chatId)?.id ?? "");
    expect(chip?.actions.map((a) => a.id)).toEqual(["build"]);
    expect(chip?.detail).toContain("The author made this the world's newest revision (The old mill and the way to it). This chat plays it from the next turn. Undoing this turn leaves the world's document as it is");
    expect(chip?.detail).toContain("places: added The Old Mill (the_old_mill)");
    expect(chip?.detail).toContain("routes: added");
    noModelCalls(rig);
  });

  test("a commit's chip stored with an Undo of its own, before a turn was undone whole, shows none", async () => {
    const { rig, chatId } = await made();
    await layPath(rig, chatId);
    const [chip] = await madeChips(rig, chatId);
    const stored = (await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.id === chip?.id);
    if (!stored) throw new Error("no stored chip");
    await rig.rt.chips.add(chatId, rig.host.userId, [{ ...stored, actions: [{ id: "undo", label: "Undo", style: "danger" }, ...stored.actions] }]);
    const [shown] = await madeChips(rig, chatId);
    expect(shown?.actions.map((a) => a.id)).toEqual(["build"]);
    noModelCalls(rig);
  });
});

describe("the user's own Build edits in the draft", () => {
  test("held there before the turn: the author's commit, and the move that follows it, wait on the review card with why, and nothing of theirs is published until Apply", async () => {
    const { rig, chatId, build, first } = await made();
    await buildEdit(rig, build.worldId);
    const committed = await layPath(rig, chatId);
    expect(committed.landed.flat().join("\n")).not.toContain("revision");
    expect(committed.review).toHaveLength(2);
    expect(committed.review[0]?.at(-1)).toBe(renderPrompt(WORLD_NOTE.theirEdits, {}, {}));
    expect(committed.review[1]?.at(-1)).toBe(renderPrompt(WORLD_NOTE.followsCommit, {}, {}));
    expect(await build.head()).toBe(first);
    expect(await madeChips(rig, chatId)).toEqual([]);
    const [card] = await cardsOf(rig, chatId);
    expect(card?.items.map((i) => [i.changeType, i.lines[1], i.by])).toEqual([
      ["world_document", THEIRS, "Author"],
      ["world_document", "It waits with the commit before it, whose draft holds your own edits from Build.", "Author"],
    ]);
    // The user's Apply publishes it, their edits with it, and brings the chat to it.
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: card?.turn ?? "" }));
    const second = await build.head();
    expect(second).not.toBe(first);
    expect((await build.revision(second)).lore).toHaveProperty("old_pier");
    expect((await stateOf(rig, chatId)).revision).toBe(second);
    noModelCalls(rig);
  });

  test("written while the turn runs, between the author's writes: the commit waits on the review card", async () => {
    const { rig, chatId, build, first } = await made();
    const committed = await layPath(rig, chatId, () => buildEdit(rig, build.worldId));
    expect(committed.review[0]?.at(-1)).toBe(renderPrompt(WORLD_NOTE.theirEdits, {}, {}));
    expect(await build.head()).toBe(first);
    noModelCalls(rig);
  });
});

describe("a user's saved Confirm", () => {
  test("still asks first: the commit and the move wait on the review card, and the reply lists nothing as made", async () => {
    const { rig, chatId, build, first } = await made();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode: "confirm" } } } }));
    const committed = await layPath(rig, chatId);
    expect(committed.review).toHaveLength(2);
    expect(committed.review.flat()).not.toContain(renderPrompt(WORLD_NOTE.theirEdits, {}, {}));
    expect(await build.head()).toBe(first);
    expect(await madeChips(rig, chatId)).toEqual([]);
    noModelCalls(rig);
  });
});

describe("who staged a change, on a harness chat's review card", () => {
  test("the agent, by its harness name: the author's own change of its turn is the author's, never read from the reply", async () => {
    const { rig, chatId } = await made();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { time_advance: { mode: "confirm" } } } }));
    const turn = await beginTurn(rig, chatId, "I wait for the rain to stop.");
    await turn.answer(AUTHOR, "time_pass", { minutes: 30 });
    await turn.answer(AUTHOR, "commit");
    await turn.finish("The rain eases after half an hour.");
    const [card] = await cardsOf(rig, chatId);
    expect(card?.items.map((i) => [i.source, i.by])).toEqual([["read", "Author"]]);
    noModelCalls(rig);
  });

  test("named in the user's own texts, after the reply said as such; a definition that isn't the engine's by its id; the other engines' cards as before", () => {
    expect(stagedBy({ "harness.agent.game_master.name": "Referee" }, "game_master", true)).toBe("Referee, after the reply");
    expect(stagedBy({}, "author", false)).toBe("Author");
    expect(stagedBy({}, "my_scout", false)).toBe("my_scout");
    const item = { key: "k", changeType: "learn", lines: [], status: "open" as const };
    expect(sourceWords({ ...item, source: "read", role: "read", by: "Game master, after the reply" })).toBe("Game master, after the reply");
    expect(sourceWords({ ...item, source: "read", role: "read" })).toBe("From reading the reply");
    expect(sourceWords({ ...item, source: "agent", role: "director" })).not.toBe("director");
  });
});
