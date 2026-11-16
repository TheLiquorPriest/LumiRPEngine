// The words of the Author's own files (plan §10.3, E.2, E.7): `TURN.md` asks for intent first, then a
// look, then a decision on how deep to go, in that order; each behaviour is asked for once, in the one
// home D.2 gives it; the Author's stack is no larger than the plan's figure. The one-home check reads
// D.2's rows (`homes.ts`) and, for each row whose home a texts package has worded, finds the marker
// phrases of its ask in its home on one line and in no other shipped file, but on a line that names the
// home. Each later texts package adds the rows of the files it words (`WORDED`, `LATER`); each row's check
// is shown to fail on a scratch copy of the set that repeats the ask elsewhere.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { changed, openSet, type OpenSet, shippedTexts } from "./set";
import { HOMES, type Row } from "./homes";

const SHIPPED = shippedTexts();

/** E.7: the Author's stack as the loader builds it from the set as shipped at the start of the build, in characters. */
const STACK_CEILING = 23_300;

/** A text as the checks compare it: lower case, every run of white space one space. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The lines of a text, flattened, none empty. */
const linesOf = (text: string): string[] => text.split("\n").map(flat).filter((line) => line !== "");

/** What a home is called in a line that names it, so that the line may repeat what the home asks. */
const NAMES: Record<string, string[]> = {
  "TURN.md": ["turn.md"],
  "WRITING.md": ["writing.md"],
  "SIMULATION.md": ["simulation.md"],
  "ALL-AGENTS.md": ["all-agents.md", "file for every agent"],
  ".agents/author.md": ["author.md", "author's definition"],
  ".agents/narrator.md": ["narrator.md"],
};

/**
 * The rows this wave words: each by the start of its D.2 behaviour, with the phrases of its ask, as the
 * home says them. A row that has more than one ask has a phrase for each.
 */
const WORDED: { row: string; markers: string[] }[] = [
  { row: "The intent record, first", markers: ["write your intent record"] },
  { row: "Looking where the message points, then", markers: ["zoom there with `world_query`", "say so in the `depth:` line of your intent record"] },
  { row: "A look-up turn aims for 5 calls", markers: ["five calls or fewer on the reply's path"] },
  { row: "Settling the engine lane each turn", markers: ["settle the engine lane yourself"] },
  { row: "Asking the GM to set the map", markers: ["set the map when a scene opens on a mapped place"] },
  { row: "Reading its own reply for what it established", markers: ["read your reply as it went out"] },
  { row: "An overlay when a turn leaves", markers: ["write an overlay for it"] },
  { row: "An intention and a whereabouts", markers: ["give it an intention and a whereabouts"] },
  { row: "Adding to the player model", markers: ["add it to the player model"] },
  { row: "The horizon for the next turn", markers: ["set the horizon for the next turn"] },
  { row: "Keeping the record ahead of the window", markers: ["record the beats of every turn fully enough"] },
  { row: "When a scene ends, and when a chapter turns", markers: ["a scene ends when", "a chapter turns when"] },
  { row: "Starting the mapping, indexing and summarizing jobs", markers: ["mapping the prompt, with the agent `mapper`", "indexing lore, with the agent `indexer`", "summarizing a stretch of the past that has beats"] },
  { row: "Writing a turn's steps down with `todo`", markers: ["write the steps down with `todo`"] },
  { row: "Marking the last calls of a turn as closing", markers: ["mark the last calls you need as closing"] },
  { row: "Before the reply, only what the reply depends on", markers: ["do only what the reply depends on"] },
  { row: "The Author's record of the turn", markers: ["write your record of the turn"] },
  { row: "What the reply established that nobody decided", markers: ["record it as canon, or mark it proposed"] },
  { row: "Touching the threads the turn moved", markers: ["touch the threads the turn moved"] },
  { row: "Settling both lanes against an edited reply", markers: ["saved differently from what you released"] },
  { row: "After the player edits an earlier message", markers: ["an earlier reply now shows another swipe"] },
  { row: "A stretch played without the Author", markers: ["a stretch was played without you"] },
  { row: "A past nobody has read closely", markers: ["a past nobody has read closely"] },
  { row: "Handing the prose to the narrator", markers: ["the narrator writes the prose when either of these is true"] },
  { row: "Reading a narrator's draft before release", markers: ["read the draft before you release it"] },
  { row: "The narrator's brief", markers: ["the beats in order, the outcomes, what must and must not be said, the point of view"] },
  { row: "The narrator writing live only", markers: ["only when the brief leaves nothing to add"] },
  { row: "What leads when story, lore and rules disagree", markers: ["when the story as told and the recorded game state disagree", "apply it anyway and let the report stand"] },
  { row: "When the GM rolls", markers: ["the gm rolls when an outcome is uncertain"] },
  { row: "What is tracked closely and what loosely", markers: ["what is tracked closely"] },
  { row: "Saying where a recorded thing comes from", markers: ["say where it comes from"] },
  { row: "Never deciding for the player's character", markers: ["never decide what the player's character does"] },
  { row: "Notes are notes", markers: ["your notes are notes"] },
  { row: "Keeping working text short", markers: ["keep it short and plain"] },
  { row: "What the narrator may add", markers: ["add texture freely"] },
  { row: "That the Author decides", markers: ["they are not yours to set aside"] },
];

/** Rows whose home a later texts package words, with the package that does (their behaviour needs code that comes with it). */
const LATER: { row: string; by: string }[] = [
  { row: "On a chat with no premise yet", by: "PlanTexts-13" },
  { row: "A place the turn changed", by: "PlanTexts-17" },
  { row: "A depth the player asked for on the composer", by: "PlanTexts-11" },
  { row: "Redrawing the part of a principal's base", by: "PlanTexts-11" },
  { row: "What the story is, by the chat's own choice", by: "PlanTexts-11" },
];

/** The files this wave words: their rows are held to the check. */
const THIS_WAVE = Object.keys(NAMES);

const rowOf = (start: string): Row => {
  const found = HOMES.filter((row) => row.behaviour.startsWith(start));
  if (found.length !== 1 || found[0] === undefined) throw new Error(`D.2 has ${found.length} rows that start "${start}"`);
  return found[0];
};

/** Where a marker stands wrongly: not once in its home, or on a line of another file that does not name the home. */
function misplaced(texts: ReadonlyMap<string, string>, home: string, marker: string): string[] {
  const out: string[] = [];
  const inHome = linesOf(texts.get(home) ?? "").filter((line) => line.includes(marker)).length;
  if (inHome !== 1) out.push(`${home}: "${marker}" is on ${inHome} lines, not one`);
  for (const [path, text] of texts) {
    if (path === home || !path.endsWith(".md")) continue;
    for (const line of linesOf(text)) if (line.includes(marker) && !(NAMES[home] ?? []).some((name) => line.includes(name))) out.push(`${path}: repeats "${marker}"`);
  }
  return out;
}

/** Every row of this wave's homes against the set. */
function repeats(texts: ReadonlyMap<string, string>): string[] {
  return WORDED.flatMap((worded) => {
    const row = rowOf(worded.row);
    return worded.markers.flatMap((marker) => misplaced(texts, row.home, marker));
  });
}

let set: OpenSet;
beforeAll(async () => {
  set = await openSet(SHIPPED);
});
afterAll(() => set.close());

describe("TURN.md reads intent, then a look, then a decision on how deep to go", () => {
  const turn = SHIPPED.get("TURN.md") ?? "";
  const part = (n: number): string => {
    const at = turn.indexOf(`## ${n}. `);
    const next = turn.indexOf(`\n## ${n + 1}. `, at);
    return turn.slice(at, next < 0 ? undefined : next);
  };

  test("holds E.2's eleven parts, in order", () => {
    const heads = [...turn.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]);
    expect(heads).toEqual([
      [1, "Intent first"],
      [2, "Look where the message points"],
      [3, "Decide how to run it"],
      [4, "Both lanes, every turn"],
      [5, "Before the reply"],
      [6, "The reply"],
      [7, "Right after the reply, in the same run"],
      [8, "Keep the record ahead of the window"],
      [9, "What can wait"],
      [10, "Scenes and chapters"],
      [11, "When the turn is not an ordinary one"],
    ]);
  });

  test("the record's lines are §10.3's five, then the depth and the calls after the reply, and no more", () => {
    const block = /```\n([\s\S]*?)```/.exec(part(1))?.[1] ?? "";
    expect(block.split("\n").filter((line) => line !== "").map((line) => line.split(":")[0])).toEqual(["Wants", "Scope", "Story lane", "Engine lane", "Needs", "Depth", "After"]);
  });

  test("the depth is said in the record's `Depth:` line, and the parts stand in order", () => {
    expect(flat(part(1))).toContain("depth: how deep you go and why");
    expect(flat(part(3))).toContain("say so in the `depth:` line of your intent record");
    expect(flat(turn)).not.toContain("same call as your intent record");
    expect(turn.indexOf("## 3. ")).toBeGreaterThan(turn.indexOf("## 2. "));
    expect(turn.indexOf("## 2. ")).toBeGreaterThan(turn.indexOf("## 1. "));
  });

  test("Assisted asks one thing: five calls or fewer, worded on the reply's path", () => {
    const assisted = linesOf(part(3)).find((line) => line.startsWith("- **assisted.**")) ?? "";
    expect(assisted).toContain("five calls or fewer on the reply's path");
    expect(assisted).not.toContain("in the same call");
  });

  test("a stretch played without the Author is read and recorded, in passing or as a job, and rules on neither consent nor sources", () => {
    const stretch = linesOf(turn).find((line) => line.startsWith("- **a stretch was played without you.**")) ?? "";
    expect(stretch).toContain("record what matters after the reply, or as a job");
    for (const word of ["gap check", "consent", "source", "invent"]) expect(stretch).not.toContain(word);
  });

  test("closing a scene and summarizing a stretch are each asked once", () => {
    expect(linesOf(turn).filter((line) => line.includes("close it and load the skill `scene-end`"))).toHaveLength(1);
    expect(linesOf(turn).filter((line) => line.includes("a stretch of the past that has beats and no summary"))).toHaveLength(1);
  });

  test("the map line stands in the fourth part, once, with its reason", () => {
    expect(flat(part(4))).toContain("nobody is placed until someone asks");
    expect(flat(turn).split("set the map").length - 1).toBe(1);
  });

  test("`todo`, the record of the turn and the chapter's turn each have a reason", () => {
    const lines = linesOf(turn);
    expect(lines.find((line) => line.includes("write the steps down with `todo`"))).toContain(", so that");
    expect(lines.find((line) => line.includes("write your record of the turn"))).toContain(", so that");
    expect(lines.find((line) => line.includes("a chapter turns when"))).toContain("so that no chapter outgrows");
  });
});

describe("the Author's own files ask for no step and are true", () => {
  const author = SHIPPED.get(".agents/author.md") ?? "";

  test("the Author's definition decides nothing of the turn: no record, no contract, no step", () => {
    const body = flat(author.slice(author.indexOf("\n---\n", 4)));
    expect(body).not.toContain("record of the turn");
    expect(body).not.toContain("say why");
    expect(body).not.toContain("contract");
    expect(flat(SHIPPED.get(".prompts/prompt-frame.md") ?? "")).toContain("contract");
  });

  test("its header names its writer, and the writer is the narrator, whose definition holds no tool and reads only WRITING", async () => {
    expect((await set.guidance().definition("author"))?.writer).toBe("narrator");
    const narrator = await set.guidance().definition("narrator");
    expect(narrator).toMatchObject({ tools: [], reads: ["WRITING"] });
  });

  test("the narrator adds texture and no facts, and never decides for the player's character (E.4)", () => {
    const body = flat(SHIPPED.get(".agents/narrator.md") ?? "");
    expect(body).toContain("add texture freely");
    expect(body).toContain("do not decide what the player's character does, says or feels");
    expect(body).toContain("do not add a name, a place, an object of note, a past event or a fact");
  });

  test("ALL-AGENTS.md says nothing that is false of a sub-agent or of a skill", () => {
    const all = flat(SHIPPED.get("ALL-AGENTS.md") ?? "");
    expect(all).not.toContain("already in front of you");
    expect(all).not.toContain("transcripts");
    expect(all).toContain("the consent rule");
  });

  test("WRITING.md gives an example where `long` and `large enough` stand, and SIMULATION.md gives the dice their reason", () => {
    expect(linesOf(SHIPPED.get("WRITING.md") ?? "").find((line) => line.includes("grown large enough"))).toContain("a thousand words");
    expect(linesOf(SHIPPED.get("SIMULATION.md") ?? "").find((line) => line.startsWith("the gm rolls"))).toContain(", so that");
  });
});

describe("the Author's stack", () => {
  test("as RPH's loader builds it from the shipped set, is no larger than E.7's 21,003 characters", async () => {
    const stack = await set.guidance().stack("author");
    const opening = stack.entries.filter((entry) => entry.where === "opening" && entry.left === undefined);
    const size = opening.reduce((sum, entry) => sum + (entry.text?.length ?? 0), 0);
    expect(size).toBeLessThanOrEqual(STACK_CEILING);
    // The rest of the opening block is measured and reported beside it (the reply contract; the skills' index and the tool guide are built at run time).
    const contract = (SHIPPED.get(".prompts/reply-contract.md") ?? "").length;
    expect(contract).toBeGreaterThan(0);
  });
});

describe("one home for each behaviour", () => {
  test("every row of D.2 whose home this wave words has the phrases of its ask, or is a row a later package words", () => {
    const mine = HOMES.filter((row) => THIS_WAVE.includes(row.home));
    const covered = new Set([...WORDED.map((w) => rowOf(w.row).behaviour), ...LATER.map((l) => rowOf(l.row).behaviour)]);
    expect(mine.filter((row) => !covered.has(row.behaviour)).map((row) => row.behaviour)).toEqual([]);
    expect(WORDED.filter((w) => LATER.some((l) => rowOf(l.row).behaviour === rowOf(w.row).behaviour))).toEqual([]);
    expect(WORDED.filter((w) => !THIS_WAVE.includes(rowOf(w.row).home)).map((w) => w.row)).toEqual([]);
  });

  test("each ask is on one line of its home and in no other shipped file but on a line that names the home", () => {
    expect(repeats(SHIPPED)).toEqual([]);
  });

  for (const worded of WORDED) {
    test(`${rowOf(worded.row).home}: "${worded.row}" is found on a scratch copy that repeats it in another file, and when the home loses it`, () => {
      const row = rowOf(worded.row);
      const elsewhere = ".skills/economy/SKILL.md";
      for (const marker of worded.markers) {
        const repeated = changed(SHIPPED, { [elsewhere]: `${SHIPPED.get(elsewhere)}\n${marker}\n` });
        expect(misplaced(repeated, row.home, marker)).toEqual([`${elsewhere}: repeats "${marker}"`]);
        const lost = changed(SHIPPED, { [row.home]: (SHIPPED.get(row.home) ?? "").replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "xxxx") });
        expect(misplaced(lost, row.home, marker)).toEqual([`${row.home}: "${marker}" is on 0 lines, not one`]);
      }
    });
  }
});
