// RPE's prompt parts, row by row of the plan's E.6 (D.2, "Prompt parts ask for no behaviour of a turn"): each
// file is there, is laid out as its row says when it is filled in as RPH fills it, and asks for nothing unless
// D.2 makes it a home (`compaction.md` and `continue-after-rule.md`, each tested by edit; `reply-contract.md`
// says how things are marked; `judge.md` is sent to another model than the agents'). They are read as RPH's
// loader reads them, from the set as RPE lays it (`set.ts`). A later texts package adds the rows of the lines it
// words (`NOTICES`, `REPLY_ERRORS`). Every name is invented.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Guidance, LinesPart, TemplatePart } from "rp-harness";
import type { JsonValue } from "rp-harness/contract";
import { openSet, type OpenSet, shippedTexts, split } from "./set";

const SHIPPED = shippedTexts();

/** Words that ask an agent to do something: a part that lays things out holds none of them. */
const ASKS = /\b(must|should|always|never|please|make sure|remember to)\b/i;

/** The names the briefing's template may put in or test at its top level: what RPH fills (`harness/turn.ts` `#briefing`), and the blocks RPE's turn hands it by name (`BLOCKS`, `-` as `_`). */
const BRIEFING_FILLED = ["turn", "turn_facts", "asked", "prefill", "since", "files_changed", "files_added", "rules_due", "world_state", "on_stage", "lore_map", "prompt_notices", "prompt_cut", "not_given", "story_so_far", "story_brief", "turn_files", "intent_path"];

/** The notices of `notices.md`, by name, and the fields a use of each fills. Each is a fact; none asks. */
const NOTICES: Record<string, Record<string, unknown>> = {
  file_changed: { path: "WRITING.md" },
  file_off: { path: "WRITING.md" },
  skills_changed: { listed: true },
  migrated_chat: { carried: "Its cast came over whole." },
  unplayed: { range: "12 to 14" },
  edited: { message: 12, old: "Hello.", new: "Hello there." },
  edited_more: { count: 5, messages: "3, 4, 5, 6, 7" },
  player_edited: { message: 9, old: "I wave.", new: "I wave twice." },
  deleted: { count: 2 },
  swipe_flipped: { message: 8, dropped: "Two turns were dropped." },
  swipe_shown: { message: 8 },
  job_finished: { job: "j-1", agent: "mapper", brief: "Map the harbour.", report: "Two quays." },
  job_failed: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_cancelled: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_interrupted: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_off_path: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  panel_request: { what: "Add a quay", on: "the harbour" },
  settle_asked: {},
  previous_run_stopped: {},
  saved_differs: { message: 4, released: "Wren waved.", saved: "Wren waved twice." },
  cut_short: { message: 4 },
  progress_missing: { time: 540000 },
  pictures_not_taken: { count: 2, messages: "3, 5" },
  parts_not_carried: { count: 1, messages: "4" },
  world_state_failed: { error: "The fold broke." },
  on_stage_failed: { error: "The cast could not be read." },
  cut_unmatched: { missing: 2 },
  cut_pictures: { dropped: 1 },
  cut_uncut: { history: 3 },
  cut_joining_unread: { why: "the preset could not be read" },
  cut_clipped_memory: { count: 4 },
  cut_clipped_message_limit: { count: 2 },
  cut_clipped_context_size: { count: 6 },
};

/** The lines of `reply-errors.md` for a request passed on to a model, by name: each is said with and without the provider's or the layer's own words. */
const PASS_ERRORS = ["pass-no-connection", "pass-not-carried", "pass-provider", "pass-stopped"];

let set: OpenSet;
let guidance: Guidance;
beforeAll(async () => {
  set = await openSet(SHIPPED);
  guidance = set.guidance();
});
afterAll(() => set.close());

async function template(name: string): Promise<TemplatePart> {
  const part = await guidance.part(name);
  if (part?.format !== "template") throw new Error(`.prompts/${name}.md is not a template that loads`);
  return part;
}

async function lines(name: string): Promise<LinesPart> {
  const part = await guidance.part(name);
  if (part?.format !== "lines") throw new Error(`.prompts/${name}.md is not a lines part that loads`);
  return part;
}

/** A part's own words as written, without its header. */
function written(part: TemplatePart | LinesPart): string {
  return part.format === "lines" ? [...part.lines.values()].map((line) => line.text).join("\n") : part.template.text;
}

/** What a part says is its description, which every shipped part carries. */
function described(name: string): string {
  const header = split(SHIPPED.get(`.prompts/${name}.md`) ?? "").header;
  return typeof header?.description === "string" ? header.description : "";
}

describe("a row each of E.6: present, laid out as its row says, asking for nothing", () => {
  test("reply-contract.md marks a reply, an intent record and a closing call, in each form, with the tags' names set here", async () => {
    const part = await template("reply-contract");
    expect(part.header["tags"]).toEqual({ reply: "reply", intent: "intent" });
    const tags = part.render({ form: { tags: true } }).text;
    expect(tags).toContain("`<reply>` and `</reply>`");
    expect(tags).toContain("`<intent>` and `</intent>`");
    expect(tags).not.toContain("scratch/intent.md");
    const files = part.render({ form: { two_step: true } }).text;
    expect(files).toContain("`scratch/intent.md`");
    expect(files).not.toContain("<reply>");
    for (const text of [tags, files]) expect(text).toContain("A call marked `closing: true` is one that needs no answer");
    expect(described("reply-contract")).toContain("Whether to write an intent record, and what goes in it, is in TURN.md");
  });

  test("prompt-frame.md introduces the assembled prompt, as the chat application sent it", async () => {
    const part = await template("prompt-frame");
    expect(part.render().text.trim()).toBe("What follows is the prompt the chat application assembled for this reply, exactly as it was sent and in its own order. Its instructions are the contract for whatever is shown to the player.");
  });

  test("briefing.md names only fields something fills, holds no copy of the reply contract and no block nothing fills, and keeps the turn's folder and intent file", async () => {
    const part = await template("briefing");
    const named = [...new Set(part.template.fields.map((field) => field.split(".")[0] ?? field))].filter((field) => !["on_stage_views"].includes(field));
    expect(named.filter((field) => !BRIEFING_FILLED.includes(field))).toEqual([]);
    const full = {
      turn: { kind: "reply", speaker: "Wren", story_time: "dusk" },
      turn_facts: "FACTS",
      asked: "a short reply",
      prefill: "Wren says",
      since: { items: ["A message was edited."] },
      files_changed: "CHANGED",
      files_added: "ADDED",
      rules_due: "DUE",
      world_state: "WORLD",
      on_stage: "STAGE",
      lore_map: "LORE",
      prompt_notices: "NOTICES",
      prompt_cut: "PROMPT CUT",
      not_given: "NOT GIVEN",
      story_so_far: "SO FAR",
      story_brief: "BRIEF",
      turn_files: "sessions/s-1/turns/t-1/",
      intent_path: "sessions/s-1/turns/t-1/scratch/intent.md",
    };
    const text = part.render({ ...full, reply_contract: "CONTRACT TEXT", facts: { lines: ["COUNT LINE"] } }).text;
    for (const heading of ["Since the last turn", "Files changed since this session opened", "Added for this turn", "From your rules", "World state", "On stage", "Lore map", "The prompt", "The prompt as it arrived", "Not given to you", "The story so far", "Story brief"]) expect(text).toContain(`## ${heading}`);
    expect(text).toContain("## The prompt as it arrived\n\nPROMPT CUT");
    expect(text).toContain("## Not given to you\n\nNOT GIVEN");
    expect(part.render({ ...full, prompt_cut: undefined }).text).not.toContain("as it arrived");
    expect(part.render({ ...full, not_given: undefined }).text).not.toContain("Not given to you");
    expect(text).toContain("The same material is on disk for agents you delegate to: sessions/s-1/turns/t-1/");
    expect(text).toContain("This turn's intent file: `sessions/s-1/turns/t-1/scratch/intent.md`");
    expect(text).not.toContain("CONTRACT TEXT");
    expect(text).not.toContain("COUNT LINE");
    expect(text).not.toContain("How what you write now is marked");
    expect(text).not.toContain("Counts");
    // In the tags form there is no intent file to name.
    const tagged = part.render({ ...full, intent_path: undefined }).text;
    expect(tagged).not.toContain("intent file");
    expect(tagged).toContain("sessions/s-1/turns/t-1/");
    expect(written(part)).not.toMatch(ASKS);
  });

  test("world-state.md and lore-map.md are the layouts of §6.9 and §9.2: each part of them appears only when there is something in it", async () => {
    const lore = await template("lore-map");
    const text = lore.render({ in_prompt: { lines: ["[e-1] The harbour"] }, changed: { lines: ["[e-2] The quay, as the story left it"] } }).text;
    expect(text).toContain("### In the prompt\n\n- [e-1] The harbour");
    expect(text).toContain("### Changed by the story\n\n- [e-2] The quay, as the story left it");
    expect(text).not.toContain("From the world's own lore");
    expect(lore.render({}).text.trim()).toBe("");
    const world = await template("world-state");
    expect(world.header["lines"]).toEqual(expect.objectContaining({ level_world: expect.any(String), level_place: expect.any(String) }));
    for (const part of [lore, world]) expect(written(part)).not.toMatch(ASKS);
  });

  test("delegate-brief.md frames the task, what the sub-agent was given and what to send back; question.md shows an agent's question", async () => {
    const brief = await template("delegate-brief");
    const given = brief.render({ task: "Map the harbour.", attachments: [{ name: "file:plan.md", text: "PLAN" }], returns: "A list of quays." }).text;
    expect(given).toContain("## Your task\n\nMap the harbour.");
    expect(given).toContain("### file:plan.md\n\nPLAN");
    expect(given).toContain("## What to send back\n\nA list of quays.");
    const bare = brief.render({ task: "Map the harbour." }).text;
    expect(bare).toContain("Nothing was attached.");
    expect(bare).not.toContain("What to send back");
    const question = await template("question");
    expect(question.render({ agent: "mapper", question: "Which quay?", found: "Two quays." }).text.trim()).toBe("mapper stopped to ask before going on:\n\nWhich quay?\n\nWhat it found before asking:\n\nTwo quays.");
    expect(question.render({ agent: "mapper", question: "Which quay?" }).text).not.toContain("What it found");
    for (const part of [brief, question]) expect(written(part)).not.toMatch(ASKS);
  });

  test("carried.md lays out what a session carries, for the Author after the prompt and for a compaction's call", async () => {
    const part = await template("carried");
    const turns: JsonValue = [{ n: 3, text: "Wren waved.", items: [{ intent: "Keep it brief." }, { call: { tool: "world_query", args: "{}", result: "Nothing." } }] }];
    const carried = part.render({ continuing: true, summary: "Earlier, Wren arrived.", turns }).text;
    expect(carried).toContain("# Carried from earlier in this scene");
    expect(carried).toContain("## Before that, in short\n\nEarlier, Wren arrived.");
    expect(carried).toContain("## Turn 3\n\nWren waved.");
    expect(carried).toContain("Your intent record:\n\nKeep it brief.");
    expect(carried).toContain("You called `world_query` with {}.");
    const compacting = part.render({ compacting: true, continuing: true, summary: "Earlier, Wren arrived.", turns }).text;
    expect(compacting).toContain("# Earlier turns of this scene, to be summarized");
    expect(compacting).toContain("The Author called `world_query` with {}.");
    expect(written(part)).not.toMatch(ASKS);
  });

  test("progress.md has the line that keeps a long turn alive, among the lines shown in the thinking block", async () => {
    const part = await lines("progress");
    expect(part.line("still", { elapsed: "1:30" })).toBe("Still working (1:30).");
    expect(part.names).toEqual(expect.arrayContaining(["started", "tool", "delegate", "writing", "still"]));
    expect(written(part)).not.toMatch(ASKS);
  });

  test("notices.md words each notice an agent or the player can be shown, as a fact that fills in and asks for nothing", async () => {
    const part = await lines("notices");
    expect([...part.names].sort()).toEqual(Object.keys(NOTICES).sort());
    for (const [name, fields] of Object.entries(NOTICES)) {
      const said = part.line(name, fields as never) ?? "";
      expect({ name, said: said.trim().length > 0, unfilled: said.includes("{{"), asks: ASKS.test(said) }).toEqual({ name, said: true, unfilled: false, asks: false });
    }
    // A file's change is told of the file, not of the agent that reads it.
    expect(part.line("file_changed", { path: "WRITING.md" })).toStartWith("WRITING.md was changed since this session opened.");
    // A chat whose progress file has no still line: what that costs, and the limit the turn was held to.
    expect(part.line("progress_missing", { time: 540000 })).toBe("This chat's progress.md has no still line, so nothing keeps a long turn alive: the chat application ends a generation that shows nothing after ten minutes. The turn's own time limit was held at 540000 milliseconds.");
  });

  test("reply-errors.md words each way a passed request has no answer, with the detail's words where there are some, and nothing is left unfilled without them", async () => {
    const part = await lines("reply-errors");
    expect(part.names).toEqual(expect.arrayContaining(PASS_ERRORS));
    for (const name of PASS_ERRORS) {
      for (const fields of [{ detail: "The key is missing." }, {}]) {
        const said = part.line(name, fields as never) ?? "";
        expect({ name, said: said.trim().length > 0, unfilled: said.includes("{{"), asks: ASKS.test(said) }).toEqual({ name, said: true, unfilled: false, asks: false });
      }
      expect(part.line(name, { detail: "The key is missing." })).toContain(name === "pass-stopped" ? "stopped" : "The key is missing.");
    }
  });

  test("judge.md and engine-answers.md stay, the build's own for the owner's approval: the judge's question and the engine's sentences", async () => {
    const judge = await template("judge");
    expect(judge.header["yes"]).toBe("yes");
    const asked = judge.render({ question: "Did Wren speak for the player?", about: { reply: true }, text: "Wren waved." }).text;
    expect(asked).toContain("Question: Did Wren speak for the player?");
    expect(asked).toContain("The reply the player was shown:\n\nWren waved.");
    const engine = await lines("engine-answers");
    expect(engine.line("no_chat", { id: "c-9" })).toBe("There is no chat c-9 in the engine's records.");
    expect(written(engine)).not.toMatch(ASKS);
  });
});

describe("the two parts D.2 makes a home are tested by edit", () => {
  /** What a part renders to after its file is replaced at the global level, as the owner would replace it. */
  async function afterEdit(file: string, text: string, fields: Record<string, string> = {}): Promise<string | null> {
    const own = await openSet(SHIPPED);
    try {
      own.put("global", `.prompts/${file}.md`, text);
      const part = await own.guidance().part(file);
      return part?.format === "template" ? part.render(fields).text.trim() : null;
    } finally {
      await own.close();
    }
  }

  test("compaction.md is the one home of what a summary keeps: changing it changes the text a summary is written from", async () => {
    const shipped = await template("compaction");
    expect(shipped.render().text).toContain("Write what the Author must still have after the detail is gone, and nothing else:");
    expect(await afterEdit("compaction", "Write only the weather.\n")).toBe("Write only the weather.");
  });

  test("continue-after-rule.md is the one home of the line an agent goes on under: changing it changes the line, and it is there only when some of the reply was shown", async () => {
    const shipped = await template("continue-after-rule");
    expect(shipped.render({ shown: "Wren waved." }).text.trim()).toBe("The player has already been shown the text below. Go on from where it ends, without repeating any of it.\n\nWren waved.");
    expect(shipped.render({}).text.trim()).toBe("");
    expect(await afterEdit("continue-after-rule", "{{#shown}}Carry on after: {{shown}}{{/shown}}\n", { shown: "Wren waved." })).toBe("Carry on after: Wren waved.");
  });
});
