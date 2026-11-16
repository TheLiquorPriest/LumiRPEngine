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

/** The names the briefing's template may put in or test at its top level: what RPH fills (`harness/turn.ts` `#briefing`), the blocks RPE's turn hands it by name (`BLOCKS`, `-` as `_`) and the facts it names (`story`, `previous`, `lore`, `cast` and `history`, read by their dotted names); `path`, `id`, `title`, `who`, `kind`, `gone` and `defines` are the fields of the items of the cache's lists and of a base's older sources. */
const BRIEFING_FILLED = ["turn", "turn_facts", "asked", "prefill", "since", "files_changed", "files_added", "rules_due", "hooks", "world_state", "on_stage", "lore_map", "prompt_notices", "prompt_cut", "not_given", "story_so_far", "story_brief", "turn_files", "intent_path", "reply_contract", "cache", "session_unreadable", "reason", "lines", "path", "id", "title", "story", "previous", "lore", "cast", "history", "who", "kind", "gone", "defines"];

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
  deleted: { count: 2, turns: [{ message: 4, words: "Wren waved" }], more: "7, 9" },
  swipe_flipped: { message: 8, range: "9-11", stopped: [{ op: "pay", value: "3", message: 9, why: "a later turn had already set that value" }], more: 2 },
  swipe_shown: { message: 8 },
  job_finished: { job: "j-1", agent: "mapper", brief: "Map the harbour.", report: "Two quays." },
  job_failed: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_cancelled: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_interrupted: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  job_off_path: { job: "j-1", agent: "mapper", brief: "Map the harbour." },
  panel_request: { what: "Add a quay", on: "the harbour", from: "palette", values: "name: Quay", action: "add-place" },
  player_edit: { what: "Wren's coin, from 3 to 5", request: "{\"edit\":\"coin\"}", changes: ["set coin 5"], not_applied: ["fact seal: it is older than the turn"] },
  player_inserted: { message: 7, new: "Wren walks in." },
  depth_asked: { depth: "full" },
  swipe_asked: { mode: "afresh" },
  change_awaiting: { what: "Wren's purse goes to the harbour master" },
  settle_asked: {},
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
  cut_room_unknown: { why: "the model's window is not known" },
  cut_clipped_memory: { count: 4 },
  cut_clipped_message_limit: { count: 2 },
  cut_clipped_context_size: { count: 6 },
  notice_unmapped: {},
  notice_incomplete: {},
  notice_changed: { marker: "style" },
  notice_gone: { marker: "style" },
  notice_unclaimed: { message: 3, length: 120 },
  notice_order: { markers: "style, rules" },
  notice_preset: { was: { name: "Harbour", revision: "2" }, now: { name: "Harbour", revision: "3" } },
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
    expect(part.render().text.trim()).toBe("What follows is the prompt the chat application assembled for this reply, exactly as it was sent and in its own order. Its instructions are the contract for whatever is shown to the player. Its user and assistant messages, this conversation's turns, are the chat's latest messages: the player's and the replies, as the chat saved them.");
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
      hooks: "HOOKS",
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
    expect(text).toContain("## From the player's hooks\n\nHOOKS");
    expect(part.render({ ...full, hooks: undefined }).text).not.toContain("player's hooks");
    expect(part.render({ ...full, prompt_cut: undefined }).text).not.toContain("as it arrived");
    expect(part.render({ ...full, not_given: undefined }).text).not.toContain("Not given to you");
    expect(text).toContain("The same material is on disk for agents you delegate to: sessions/s-1/turns/t-1/");
    expect(text).toContain("This turn's intent file: `sessions/s-1/turns/t-1/scratch/intent.md`");
    expect(text).toContain("## How the reply is marked\n\nCONTRACT TEXT");
    expect(text).not.toContain("COUNT LINE");
    expect(text).not.toContain("How what you write now is marked");
    expect(text).not.toContain("Counts");
    // What the scene has already looked up and where it is kept, only when the session's cache holds something.
    const cached = part.render({ ...full, cache: { folder: "sessions/s-1/cache/", carried: [{ path: "sessions/s-1/turns/t-3/scratch/scene.md" }], lore: [{ id: "e-12", title: "The Gilded Hart", path: "sessions/s-1/cache/lore/e-12.md" }], prompt_map: "sessions/s-1/cache/prompt-map.md", host: [{ path: "sessions/s-1/cache/base/wren.md" }] } }).text;
    expect(cached).toContain("## What this scene has already looked up\n\nIt is kept in the session's cache folder, sessions/s-1/cache/, to be read from there; nothing writes in it.");
    expect(cached).toContain("- Carried into this turn as it stood: sessions/s-1/turns/t-3/scratch/scene.md");
    expect(cached).toContain("- Lore entry [e-12] The Gilded Hart, read in full: sessions/s-1/cache/lore/e-12.md");
    expect(cached).toContain("- The prompt map as this scene has it: sessions/s-1/cache/prompt-map.md");
    expect(cached).toContain("- From the host: sessions/s-1/cache/base/wren.md");
    expect(text).not.toContain("already looked up");
    // A session file that could not be read, whole or in lines, is told with what is so, and only then.
    const whole = part.render({ ...full, session_unreadable: { reason: "The host refused it." } }).text;
    expect(whole).toContain("## This session's file\n\nIt could not be read: The host refused it. You hold nothing of this scene's earlier turns this turn.");
    const partly = part.render({ ...full, session_unreadable: { lines: [4, 9] } }).text;
    expect(partly).toContain("Some lines of it could not be read and were passed over");
    expect(partly).toContain("- 4\n- 9");
    expect(text).not.toContain("This session's file");
    // In the tags form there is no intent file to name.
    const tagged = part.render({ ...full, intent_path: undefined }).text;
    expect(tagged).not.toContain("intent file");
    expect(tagged).toContain("sessions/s-1/turns/t-1/");
    expect(written(part)).not.toMatch(ASKS);
  });

  test("briefing.md shows the facts it names, each only when it is not 0: the chat's story choice, a stopped previous run, lore not indexed, a base older than its source, growth proposed and messages with no summary", async () => {
    const part = await template("briefing");
    const facts = {
      turn: { kind: "reply" },
      story: { from: { ".": 1, names: ["replies"] }, newest: { ".": 1, names: ["leave_out"] } },
      previous: { run: { stopped: { ".": 1 } } },
      lore: { unindexed: { ".": 4 } },
      cast: { base: { older: { ".": 1, names: ["Wren"], sources: [{ who: "Wren", kind: "lore", id: "e-12", title: "Wren the ferrywoman", defines: "background" }, { who: "Wren", kind: "card", id: "c-1", gone: true }] } }, growth: { proposed: { ".": 2 } } },
      history: { unsummarized: { ".": 3, range: { ".": [4, 9], from: 4, to: 9 } } },
    };
    const text = part.render(facts as never).text;
    expect(text).toContain("- The chat's story choice: story.from is replies, story.newest is leave_out.");
    expect(text).toContain("- The last turn's work was still going when this one began, and was stopped where it stood. What it had recorded is kept.");
    expect(text).toContain("- Lore entries no indexing run has written lines for yet: 4.");
    expect(text).toContain("- A principal's base is older than a source bound to it:\n  - Wren: lore e-12 (\"Wren the ferrywoman\"), which defines their background\n  - Wren: card c-1, gone");
    expect(text).toContain("- 2 character(s) have growth a reflection proposed that you have not accepted.");
    expect(text).toContain("- 3 message(s), 4 to 9, are out of the prompt with beats recorded and lie in no scene with a summary.");
    const none = part.render({ turn: { kind: "reply" }, story: facts.story, previous: { run: { stopped: { ".": 0 } } }, lore: { unindexed: { ".": 0 } }, cast: { growth: { proposed: { ".": 0 } } } } as never).text;
    expect(none).toContain("story.from is replies");
    for (const gone of ["last turn's work", "no indexing run", "older than a source", "growth a reflection", "no scene with a summary"]) expect(none).not.toContain(gone);
  });

  test("world-state.md and lore-map.md are the layouts of §6.9 and §9.2: each part of them appears only when there is something in it", async () => {
    const lore = await template("lore-map");
    const text = lore.render({ in_prompt: { lines: ["[e-1] The harbour"] }, changed: { lines: ["[e-2] The quay, as the story left it"] } }).text;
    expect(text).toContain("### In the prompt");
    expect(text).toContain("- [e-1] The harbour");
    expect(text).toContain("### Changed by the story\n\n- [e-2] The quay, as the story left it");
    expect(text).not.toContain("From the world's own lore");
    expect(lore.render({}).text.trim()).toBe("");
    const world = await template("world-state");
    expect(world.header["lines"]).toEqual(expect.objectContaining({ level_world: expect.any(String), level_place: expect.any(String) }));
    for (const part of [lore, world]) expect(written(part)).not.toMatch(ASKS);
  });

  test("lore-answers.md says how an entry came into the prompt and that it changed since it was indexed, and lore-map.md lays an entry out itself where those lines are off", async () => {
    const answers = await lines("lore-answers");
    expect(answers.line("fault", { tool: "lore_index_write" })).toBe("lore_index_write failed by a fault of RPE's own, not by anything in your call. It is logged.");
    const entry = { id: "e-1", title: "Harbour", kind: "place", line: "The quay.", how_keyword: true, stale: true, extras: ["tide: high"] };
    const said = answers.line("map_in_prompt", entry as never) ?? "";
    expect(said).toBe("[e-1] Harbour (place): The quay. tide: high. (by a key) (changed since it was indexed)");
    expect(answers.line("map_in_prompt", { id: "e-2", title: "Wharf", keys: "wharf, quay" } as never)).toBe("[e-2] Wharf (not indexed yet; keys: wharf, quay)");
    expect(answers.line("index_file_entry", { id: "e-1", title: "Harbour", source: "Book", size: 90, indexed: true, extras: ["tide: high"] } as never)).toContain("tide: high.");
    const lore = await template("lore-map");
    const text = lore.render({ in_prompt: { entries: [{ ...entry, notes: [{ note: "The roof is gone.", turn: 5 }] }] }, changed: { entries: [{ id: "e-3", title: "Quay", notes: [{ note: "Burnt down.", turn: 4 }] }] }, bound: { entries: [{ id: "e-4", title: "Tide table", bound: "Wren" }] } }).text;
    expect(text).toContain("- [e-1] Harbour (place): The quay. tide: high. The roof is gone. (on turn 5). (by a key) (changed since it was indexed)");
    expect(text).toContain("- [e-3] Quay: Burnt down. (on turn 4)");
    expect(text).toContain("- [e-4] Tide table Bound to Wren.");
    expect(answers.line("read_note", { note: "The inn burned.", turn: 7 } as never)).toBe("The inn burned. (on turn 7)");
    expect(answers.line("joined", { turn: 6, joined: 5 } as never)).toBe("Turn 6 was joined to turn 5; use that turn.");
    expect(answers.line("batch_head", { count: 5, left: 9, held: 4 } as never)).toBe("Entries to index: 5 of the 9 not indexed yet. 4 more are with another indexing job.");
    expect(answers.line("batch_held", { held: 4 } as never)).toBe("4 entries are with another indexing job just now; none is left for you to index yet.");
    expect(answers.line("batch_unreadable", { reason: "the store is closed" } as never)).toBe("The entries to index could not be read: the store is closed");
    expect(answers.line("job_brief", {})?.trim()).toBe("Index this chat's lore.");
    for (const cause of ["off", "day_count", "day_tokens", "limit", "agent"]) {
      const said = answers.line(`job_refused_${cause}`, { refused: cause, max: 5, value: 5, limit: "calls", agent: "indexer" } as never) ?? "";
      expect({ cause, said: said.startsWith("The indexing job was not started"), unfilled: said.includes("{{"), asks: ASKS.test(said) }).toEqual({ cause, said: true, unfilled: false, asks: false });
    }
    expect(answers.line("secret_mark", { text: "The vault is empty.", id: "e-112#2", holders: "Wren, Bram" } as never)).toBe("The vault is empty. [secret e-112#2; held by Wren, Bram]");
    expect(answers.line("secret_mark", { text: "The vault is empty.", id: "w-31" } as never)).toBe("The vault is empty. [secret w-31; held by no one yet]");
    expect(answers.line("map_in_prompt", { id: "e-2", title: "Wharf", secrets: [{ id: "e-2#1", holders: "Wren" }, { id: "e-2#2" }] } as never)).toBe("[e-2] Wharf Secret e-2#1, held by Wren. Secret e-2#2.");
    const secretLore = (await template("lore-map")).render({ world: { entries: [{ id: "w-4", title: "Tide table", secrets: [{ id: "w-4#1", holders: "Bram" }] }] } }).text;
    expect(secretLore).toContain("- [w-4] Tide table Secret w-4#1, held by Bram.");
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
    expect(question.render({ agent: "mapper", question: "Which quay?", searched: "Two quays." }).text.trim()).toBe("mapper stopped to ask before going on:\n\nWhich quay?\n\nWhat it looked up before asking:\n\nTwo quays.");
    expect(question.render({ agent: "mapper", question: "Which quay?" }).text).not.toContain("What it looked up");
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
    const work: JsonValue = [{ items: [{ said: "I looked at the quay.", heard: "The player waved." }, { call: { tool: "world_query", args: "{}", result: "Nothing." } }] }];
    const inRun = part.render({ run: true, compacting: true, summary: "Earlier, it looked.", turns: work }).text;
    expect(inRun).toContain("# This agent's earlier work in this run, to be summarized");
    expect(inRun).toContain("The agent wrote:\n\nI looked at the quay.");
    expect(inRun).toContain("The agent was told:\n\nThe player waved.");
    expect(inRun).toContain("The agent called `world_query` with {}.");
    expect(inRun).not.toContain("## Turn");
    expect(part.render({ run: true, summary: "Earlier, it looked.", turns: work }).text).toContain("# Your earlier work in this run, in short\n\nEarlier, it looked.");
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
    expect(part.line("untagged-awaited", {})?.trim()).toBe("A request with no tag arrived while a reply was waiting for its tag. It was not passed on, because the setting lumiverse.untagged.whileAwaited says to fail it.");
    for (const name of PASS_ERRORS) {
      for (const fields of [{ detail: "The key is missing." }, {}]) {
        const said = part.line(name, fields as never) ?? "";
        expect({ name, said: said.trim().length > 0, unfilled: said.includes("{{"), asks: ASKS.test(said) }).toEqual({ name, said: true, unfilled: false, asks: false });
      }
      expect(part.line(name, { detail: "The key is missing." })).toContain(name === "pass-stopped" ? "stopped" : "The key is missing.");
    }
  });

  test("tag-check.md has the ask that wants an intent record and a reply, and simple messages of the player's to play", async () => {
    const part = await lines("tag-check");
    const ask = part.line("ask", {}) ?? "";
    expect(ask).toMatch(/intent record/);
    expect(ask).toMatch(/reply/);
    expect({ asks: ASKS.test(ask), unfilled: ask.includes("{{"), tag: /<\/?(reply|intent)>/.test(ask) }).toEqual({ asks: false, unfilled: false, tag: false });
    const turns = [...part.names].filter((name) => name !== "ask");
    expect(turns.length).toBeGreaterThanOrEqual(5);
    for (const name of turns) expect({ name, said: (part.line(name, {}) ?? "").trim().length > 0 }).toEqual({ name, said: true });
  });

  test("request-answers.md words why a request from a panel cannot be kept or withdrawn, and a panel's request is told with what was pressed, on what, from where and with which values", async () => {
    const part = await lines("request-answers");
    expect([...part.names].sort()).toEqual(["kept", "no_chat", "not_found", "too_long"]);
    for (const [name, fields] of Object.entries({ too_long: { length: 9000, most: 4000 }, kept: { turn: "t-3" }, not_found: { request: "r-9" }, no_chat: { chat: "c-4" } })) {
      const said = part.line(name, fields as never) ?? "";
      expect({ name, said: said.trim().length > 0, unfilled: said.includes("{{"), asks: ASKS.test(said) }).toEqual({ name, said: true, unfilled: false, asks: false });
    }
    const notices = await lines("notices");
    expect(notices.line("panel_request", { what: "Walk here", on: "the quay", from: "map", values: "square: 4,7", action: "walk" } as never)).toBe("From a panel (map): Walk here, on the quay, with square: 4,7 (action walk)");
    expect(notices.line("panel_request", { what: "Add a quay" } as never)).toBe("From a panel: Add a quay");
  });

  test("notices.md tells an edit the player made before the turn with what took effect and what did not, and the undoing of one", async () => {
    const notices = await lines("notices");
    expect(notices.line("player_edit", { what: "Wren's coin, from 3 to 5", request: "{\"edit\":\"coin\"}", changes: ["set coin 5"], not_applied: ["fact seal"] } as never)).toBe("The player made an edit to the record before this turn: Wren's coin, from 3 to 5. Recorded: set coin 5. Not applied: fact seal. What was pressed: {\"edit\":\"coin\"}");
    expect(notices.line("player_edit", { undo: true, of: "Wren's coin, from 3 to 5", request: "{\"undo\":\"u-1\"}", changes: [], not_applied: [] } as never)).toBe("The player undid an earlier edit: Wren's coin, from 3 to 5. What was pressed: {\"undo\":\"u-1\"}");
  });

  test("notices.md tells a message the player inserted before a played turn with its number and, where agents may read it, its text", async () => {
    const notices = await lines("notices");
    expect(notices.line("player_inserted", { message: 7, new: "Wren walks in." } as never)).toBe("The player inserted a message before a turn already played. It is message 7, counting the chat's first message as 0, and the messages after it are numbered one higher than they were. It reads: Wren walks in.");
    expect(notices.line("player_inserted", { message: 7 } as never)).not.toContain("It reads");
  });

  test("notices.md tells the turns a deletion took with the first words of each reply, and a swipe flipped earlier with what did not apply again and why, the reasons worded under keys", async () => {
    const part = await lines("notices");
    expect(part.line("deleted", { count: 3, turns: [{ message: 4, words: "Wren waved" }, { message: 6, words: "The quay" }], more: "9" } as never)).toBe('3 turn(s) were deleted since the last one. Messages are numbered as the chat stood before, counting its first message as 0. Message 4, "Wren waved…". Message 6, "The quay…". Also messages 9.');
    expect(part.line("deleted", { count: 1 } as never)).toBe("1 turn(s) were deleted since the last one. Messages are numbered as the chat stood before, counting its first message as 0.");
    const flipped = part.line("swipe_flipped", { message: 8, range: "9-11", stopped: [{ op: "pay", value: "3", message: 9, why: "a later turn had already set that value" }], more: 2 } as never) ?? "";
    expect(flipped).toBe("An earlier reply (8) was changed to another of its swipes. The turns after it were applied again on it (messages 9-11). Not applied, pay 3 from message 9, because a later turn had already set that value. 2 more are not listed.");
    expect(part.line("swipe_flipped", { message: 8 } as never)).toBe("An earlier reply (8) was changed to another of its swipes. The turns after it were applied again on it.");
    const keys = split(SHIPPED.get(".prompts/notices.md") ?? "").header?.["keys"] as Record<string, unknown>;
    expect(Object.entries(keys).filter(([, said]) => typeof said !== "string" || said === "" || ASKS.test(said))).toEqual([]);
    expect(typeof keys["changed_since"]).toBe("string");
  });

  test("secret-marks.md words a secret's mark in its five forms, each keeping the names RPE fills in", async () => {
    const part = await lines("secret-marks");
    expect([...part.names].sort()).toEqual(["both", "everyone", "kept", "known", "rule"]);
    expect(part.line("known", { text: "The vault is empty.", known: "Wren" } as never)).toBe("The vault is empty. [secret; known to Wren]");
    expect(part.line("kept", { text: "The vault is empty.", kept: "Bram" } as never)).toBe("The vault is empty. [secret; kept from Bram]");
    expect(part.line("both", { text: "The vault is empty.", known: "Wren", kept: "Bram" } as never)).toBe("The vault is empty. [secret; known to Wren; kept from Bram]");
    expect(part.line("everyone", {})?.trim()).toBe("everyone");
    const rule = part.line("rule", { forms: "as [secret; known to X]", everyone: "everyone" } as never) ?? "";
    expect(rule).toStartWith("A fact marked as a secret, written as [secret; known to X], is known to the people its mark says it is known to");
    expect({ asks: ASKS.test(rule), unfilled: rule.includes("{{") }).toEqual({ asks: false, unfilled: false });
  });

  test("play-answers.md says case by case why a tap's pick is refused, that a tap the world's rules advise against is applied with their reports, and what an edit of the world cannot do", () => {
    const said = (split(SHIPPED.get(".prompts/play-answers.md") ?? "").header?.["lines"] ?? {}) as Record<string, string>;
    const keys = ["needs_someone", "needs_place", "needs_something", "names_no_one", "names_no_place", "names_nothing", "not_known_someone", "not_known_place", "not_known_something", "not_kind", "not_payee", "pays_no_one", "applied_advised", "edit_at", "fact_remove", "edit_ops_count", "things_count"];
    expect(keys.filter((key) => typeof said[key] !== "string" || said[key] === "")).toEqual([]);
    expect(keys.filter((key) => ASKS.test(said[key] ?? ""))).toEqual([]);
    expect(["not_known", "not_payable"].filter((key) => key in said)).toEqual([]);
    expect(said["applied_advised"]).toBe("Done, though the world's rules say: {{reports}}");
  });

  test("the composer's choices are the depths of TURN.md's header and the modes of SWIPE.md's, each described, and a swipe, a depth and a change awaiting the player are told as asked", async () => {
    const depths = split(SHIPPED.get("TURN.md") ?? "").header?.["depths"] as Record<string, unknown>;
    const modes = split(SHIPPED.get("SWIPE.md") ?? "").header?.["modes"] as Record<string, unknown>;
    expect(Object.keys(depths)).toEqual(["direct", "assisted", "full"]);
    expect(Object.keys(modes)).toEqual(["another-telling", "afresh"]);
    for (const said of [...Object.values(depths), ...Object.values(modes)]) expect(typeof said === "string" && said.length > 0).toBe(true);
    // Each depth the header names is the one section 3 describes, by name.
    for (const depth of Object.keys(depths)) expect((SHIPPED.get("TURN.md") ?? "").toLowerCase()).toContain(`**${depth}.**`);
    const attempt = await template("turn-attempt");
    expect(attempt.render({ n: 1, turn: "t-2", reply: "Wren waved.", feedback: "Less talk, more quay." }).text).toContain("## What the player said about it\n\nLess talk, more quay.");
    expect(attempt.render({ n: 1, turn: "t-2", reply: "Wren waved." }).text).not.toContain("What the player said");
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
