// The narrator, the check and the release gate (DEPTH2-PLAN §3.3): the narrator is handed only what
// reached the point-of-view character, never a beat's truth beyond it, and goes on from each earlier
// passage that passed its check; each passage is numbered in the order told, and a draft lands only
// on the passage it names, whoever else is at work; a draft made before its check spends nothing; only
// the author names other eyes; only the checker the settings name checks, within the drafts they
// allow; the gate lets out only the author's release, naming each passage by its number, and of
// those only a passage that passed its check (or whose drafts are spent), joined in the order named
// with a few words of the author's own; what passed reaches the player even where the author stopped
// short; the two reads come back whole, what their reader acts on first; a refusal from a limit names
// its setting; the settings read with their defaults.

import { describe, expect, test } from "bun:test";
import { WHOLE_READ_MOST } from "../../src/backend/agents/tools/harness-tools/kit";
import { harnessTools } from "../../src/backend/agents/tools/harness";
import { renderPrompt } from "../../src/backend/prompts";
import { defaultSettings } from "../../src/backend/settings-store";
import { releaseGate, releaseNoted, StageBook, unreleasedReply } from "../../src/backend/story/narration";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { STAGE_NOTE, STAGE_TOOL } from "../../src/shared/harness-texts-stage";
import type { Beat } from "../../src/shared/ledger";
import { promptSettingsOf } from "../../src/shared/prompts";
import { NARRATION_DEFAULTS, NARRATION_LABELS, type NarrationSettings, narrationSettingsOf, type UserSettings } from "../../src/shared/settings";
import { stateOf } from "../support/mind-chat";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { answer, call, castChat, castEnv, castTurn, ILSE, JOSS, MARA, memoryStory, refusal } from "./harness-cast-kit";

const beat = (id: string, over: Partial<Beat>): Beat => ({ id, turn: "turn-seed", at: 0, where: HOME, by: MARA, kind: "do", what: "", surface: "", exposure: [], decidedBy: { agent: HARNESS_AGENT.author }, ...over });

/** A moment in the kitchen: what truly happened in each beat, and how far each reached the player's character (Jordan) and Joss. */
const BEATS: readonly Beat[] = [
  beat("b1", { by: MARA, kind: "say", what: "Mara lies: she spent the rent on cards.", surface: "Mara shrugs and waves the question off.", quotes: ["The rent's covered, don't worry."], exposure: [{ who: "player", reach: "whole" }, { who: JOSS, reach: "whole" }] }),
  beat("b2", { by: JOSS, kind: "do", what: "Joss slips a sedative into the kettle.", surface: "Joss fusses with the kettle.", exposure: [{ who: "player", reach: "part", got: "Joss fusses with the kettle, back turned." }] }),
  beat("b3", { by: MARA, kind: "inner", what: "Mara wonders whether to run for it." }),
  beat("b4", { by: ILSE, kind: "do", what: "Ilse pockets the spare key in the hall.", surface: "Ilse steps out into the hall.", exposure: [{ who: JOSS, reach: "whole" }] }),
  beat("b5", { by: "player", kind: "do", what: "Jordan puts the kettle on.", surface: "Jordan fills the kettle." }),
  beat("b6", { by: JOSS, kind: "say", what: "Joss tells Jordan that Ilse borrowed the car.", surface: "Joss mutters something to Jordan.", exposure: [{ who: "player", reach: "told", got: "Ilse borrowed the car last night.", from: JOSS }] }),
];

/** Beats written later in the turn, each reaching Jordan and Joss whole: the next passage's. */
const KETTLE = beat("b7", { by: "world", kind: "happen", what: "The kettle starts to shriek.", surface: "The kettle shrieks.", exposure: [{ who: "player", reach: "whole" }, { who: JOSS, reach: "whole" }] });
const DOOR = beat("b8", { by: "world", kind: "happen", what: "The front door bangs shut.", surface: "The front door bangs.", exposure: [{ who: "player", reach: "whole" }, { who: JOSS, reach: "whole" }] });

const READ = STAGE_TOOL.narrationRead;
const DRAFT = STAGE_TOOL.passageDraft;
const LOOK = STAGE_TOOL.passageRead;
const CHECK = STAGE_TOOL.passageCheck;

/** A chat with `beats` written by its turn, one stage book for the turn's narration, and an env for each caller of that turn; the chat's greeting is the prose before the turn. */
async function stage(narration: Partial<NarrationSettings> = {}, beats: (settings: UserSettings) => readonly Beat[] = () => BEATS) {
  const { rig, chatId } = await castChat();
  const story = memoryStory();
  const book = new StageBook();
  const base = await rig.rt.settings.get(rig.host.userId);
  const settings: UserSettings = { ...base, narration: { ...base.narration, ...narration } };
  await story.write({ beats: [...beats(settings)] });
  const said = { messageId: null, user: "I put the kettle on and ask who is in today.", before: "Morning." };
  const as = async (role: string, main: boolean, who?: string) => castEnv(rig, chatId, await castTurn(rig, chatId, { main, settings, stageBook: book, story, said }), role, null, who);
  /** Another narrator of the same eyes as `env`: a second instance at work at once. */
  const another = <T extends { agent: { id: string } }>(env: T, id: string): T => ({ ...env, agent: { ...env.agent, id } });
  return { rig, chatId, book, settings, story, as, another };
}

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** What the author's release of `args` lets out of `book`. */
const released = (book: StageBook, settings: UserSettings, args: Record<string, unknown>, role: string = HARNESS_AGENT.author) => releaseGate(book, settings, { role, args });

/** Each passage of `book` by its number, with the text of each of its drafts. */
const drafts = (book: StageBook): [number, string[]][] => book.opened.map((p) => [p.n, p.drafts.map((d) => d.text)]);

/** Text `n` characters long that JSON has to escape in places: quote marks and line breaks, as prose has. */
const prose = (n: number): string => 'She said "not tonight".\nThe harbor lamps went out one by one. '.repeat(Math.ceil(n / 60) + 1).slice(0, n);

/** What the harness states `tool` gives whole in `chatId` under `settings`; absent, it states nothing. */
async function wholeOf(rig: Rig, chatId: string, settings: UserSettings, tool: string): Promise<number | undefined> {
  const { world } = await stateOf(rig, chatId);
  return harnessTools({ world, registry: rig.rt.registry, settings }).find((t) => t.name === tool)?.wholeChars;
}

/** Four beats, each at the longest the record's limits let one be, every one said where Jordan heard it whole: a long scene's. */
const longBeats = (settings: UserSettings): Beat[] => {
  const { limits } = settings.story;
  return Array.from({ length: 4 }, (_, i) => beat(`long_${i}`, { by: MARA, kind: "say", what: prose(limits.beatChars), surface: prose(limits.beatChars), quotes: Array.from({ length: limits.quotes }, () => prose(limits.quoteChars)), exposure: [{ who: "player", reach: "whole" }] }));
};

describe("what the narrator is handed (narration_read)", () => {
  test("only what reached the point-of-view character, as it reached them: never another's beat's truth, nor a beat that reached them not at all", async () => {
    const { as } = await stage();
    const got = await answer(await as(HARNESS_AGENT.narrator, false), READ);
    const said = JSON.stringify(got);
    expect(got.passage).toBe(1);
    expect(got.happened).toEqual([
      { reach: "whole", by: "Mara", sensed: "Mara shrugs and waves the question off.", words: ["The rent's covered, don't worry."], at: expect.any(String) },
      { reach: "part", got: "Joss fusses with the kettle, back turned." },
      { reach: "own", kind: "do", what: "Jordan puts the kettle on." },
      { reach: "told", got: "Ilse borrowed the car last night.", from: "Joss" },
    ]);
    for (const truth of ["spent the rent", "sedative", "wonders whether to run", "spare key", "steps out into the hall"]) expect({ truth, leaked: said.includes(truth) }).toEqual({ truth, leaked: false });
  });

  test("another point of view is the author's to name: a narrator started as someone sees through their eyes, and one that names eyes itself is refused", async () => {
    const own = await stage();
    expect(await refusal(await own.as(HARNESS_AGENT.narrator, false), READ, { pov: JOSS })).toBe(note(STAGE_NOTE.povAuthor));
    const joss = await answer(await own.as(HARNESS_AGENT.narrator, false, JOSS), READ);
    expect(joss.pov).toBe("Joss");
    // Joss saw Ilse go into the hall and did his own deed: neither reached Jordan.
    expect(JSON.stringify(joss)).toContain("Ilse steps out into the hall.");
    expect(JSON.stringify(joss)).toContain("Joss slips a sedative into the kettle.");
    const author = await answer(await (await stage()).as(HARNESS_AGENT.author, true), READ, { pov: JOSS });
    expect({ pov: author.pov, passage: author.passage }).toEqual({ pov: "Joss", passage: undefined });
    expect(await refusal(await own.as(HARNESS_AGENT.gm, false), READ)).toBe(note(STAGE_NOTE.narratorOnly, { tool: READ }));
  });
});

describe("each passage by its number", () => {
  test("several narrators at work at once each keep to their own: a number past the next is refused naming the next, a draft lands only on the passage it names, and two revisions at once each revise their own", async () => {
    const { book, story, as, another } = await stage();
    const first = await as(HARNESS_AGENT.narrator, false);
    const second = another(first, "agent_narrator_2");
    const third = another(first, "agent_narrator_3");
    const gm = await as(HARNESS_AGENT.gm, false);
    // Asked at once for the passage numbered 1, 2 and 3, the second and third read first: neither opens out of turn.
    expect(await refusal(third, READ, { passage: 3 })).toBe(note(STAGE_NOTE.passageNext, { n: "3", next: "1" }));
    expect(await refusal(second, READ, { passage: 2 })).toBe(note(STAGE_NOTE.passageNext, { n: "2", next: "1" }));
    expect((await answer(first, READ, { passage: 1 })).passage).toBe(1);
    // Every beat that had reached Jordan is passage 1's: passage 2 is told so, naming passage 1, and 3 is still past the next.
    expect(await refusal(second, READ, { passage: 2 })).toBe(note(STAGE_NOTE.toldAlready, { pov: "Jordan Ellis", n: "2", told: "1" }));
    expect(await refusal(third, READ, { passage: 3 })).toBe(note(STAGE_NOTE.passageNext, { n: "3", next: "2" }));
    expect(await refusal(third, DRAFT, { passage: 3, text: "The kettle shrieks." })).toBe(note(STAGE_NOTE.readFirst, { n: "3" }));
    expect(await refusal(second, DRAFT, { passage: 2, text: "The kettle shrieks." })).toBe(note(STAGE_NOTE.readFirst, { n: "2" }));
    expect(await refusal(second, DRAFT, { text: "The kettle shrieks." })).toBe(note(STAGE_NOTE.passageNeeded));
    await answer(first, DRAFT, { passage: 1, text: "Mara shrugs." });
    await story.write({ beats: [KETTLE] });
    expect((await answer(second, READ, { passage: 2 })).passage).toBe(2);
    await answer(second, DRAFT, { passage: 2, text: "The kettle shrieks." });
    expect(drafts(book)).toEqual([
      [1, ["Mara shrugs."]],
      [2, ["The kettle shrieks."]],
    ]);
    // Both found at fault, then revised at once by two new narrators: each revision lands on the passage it names.
    await answer(gm, CHECK, { passage: 1, holds: false, changes: ["Give her words."] });
    await answer(gm, CHECK, { passage: 2, holds: false, changes: ["Say it shrieks on the stove."] });
    const reviseOne = another(first, "agent_narrator_4");
    const reviseTwo = another(first, "agent_narrator_5");
    expect((await answer(reviseTwo, READ, { passage: 2 })).revise).toEqual({ draft: "The kettle shrieks.", changes: ["Say it shrieks on the stove."] });
    expect((await answer(reviseOne, READ, { passage: 1 })).revise).toEqual({ draft: "Mara shrugs.", changes: ["Give her words."] });
    await answer(reviseTwo, DRAFT, { passage: 2, text: "The kettle shrieks on the stove." });
    await answer(reviseOne, DRAFT, { passage: 1, text: "Mara shrugs. “The rent's covered, don't worry.”" });
    expect(drafts(book)).toEqual([
      [1, ["Mara shrugs.", "Mara shrugs. “The rent's covered, don't worry.”"]],
      [2, ["The kettle shrieks.", "The kettle shrieks on the stove."]],
    ]);
    // A narrator started as someone else is never handed a passage seen through Jordan's eyes, so it has none to draft.
    const joss = another(await as(HARNESS_AGENT.narrator, false, JOSS), "agent_narrator_joss");
    expect(await refusal(joss, READ, { passage: 1 })).toBe(note(STAGE_NOTE.passageEyes, { n: "1" }));
    expect(await refusal(joss, DRAFT, { passage: 2, text: "The kettle." })).toBe(note(STAGE_NOTE.readFirst, { n: "2" }));
  });

  test("a narrator sent on to tell more opens the next passage with only what is new, whether its passage passed, waits for its check, or no one checks; it drafts only the passage it last read, and never writes over the telling it gave", async () => {
    // Its passage passed: the follow-up opens passage 2 with the new beat alone, and a draft under its old number is refused, naming the passage it read.
    const passed = await stage();
    const narrator = await passed.as(HARNESS_AGENT.narrator, false);
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs." });
    await answer(await passed.as(HARNESS_AGENT.gm, false), CHECK, { passage: 1, holds: true });
    await passed.story.write({ beats: [KETTLE] });
    const more = await answer(narrator, READ);
    expect({ passage: more.passage, happened: more.happened }).toEqual({ passage: 2, happened: [expect.objectContaining({ reach: "whole", sensed: "The kettle shrieks." })] });
    expect(await refusal(narrator, DRAFT, { passage: 1, text: "The kettle shrieks." })).toBe(note(STAGE_NOTE.draftNotRead, { n: "1", read: "2" }));
    await answer(narrator, DRAFT, { passage: 2, text: "The kettle shrieks." });
    expect(drafts(passed.book)).toEqual([
      [1, ["Mara shrugs."]],
      [2, ["The kettle shrieks."]],
    ]);
    // Its passage waits for its check, or no one checks: a draft of passage 1 telling the new beat, unread, is refused; read as passage 2, a draft under the old number is too; passage 1's telling stands.
    for (const check of ["gm", "none"] as const) {
      const waiting = await stage({ check });
      const told = await waiting.as(HARNESS_AGENT.narrator, false);
      await answer(told, READ);
      await answer(told, DRAFT, { passage: 1, text: "Mara shrugs." });
      await waiting.story.write({ beats: [KETTLE] });
      expect({ check, refused: await refusal(told, DRAFT, { passage: 1, text: "The kettle shrieks." }) }).toEqual({ check, refused: note(STAGE_NOTE.draftWaits, { n: "1" }) });
      expect({ check, passage: (await answer(told, READ)).passage }).toEqual({ check, passage: 2 });
      expect({ check, refused: await refusal(told, DRAFT, { passage: 1, text: "The kettle shrieks." }) }).toEqual({ check, refused: note(STAGE_NOTE.draftNotRead, { n: "1", read: "2" }) });
      await answer(told, DRAFT, { passage: 2, text: "The kettle shrieks." });
      expect({ check, drafts: drafts(waiting.book) }).toEqual({
        check,
        drafts: [
          [1, ["Mara shrugs."]],
          [2, ["The kettle shrieks."]],
        ],
      });
    }
  });

  test("a draft made before its check takes the place of the last and spends nothing: every revision the settings allow is left for what a check asks", async () => {
    const { book, as } = await stage({ revisions: 1 });
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs." });
    const again = await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs and looks away." });
    expect(again.drafted).toContain(note(STAGE_NOTE.drafted, { n: "1", draft: "1", of: "2", chars: String("Mara shrugs and looks away.".length) }));
    expect(drafts(book)).toEqual([[1, ["Mara shrugs and looks away."]]]);
    // The check still has its revision to ask for; only after that one is the passage spent.
    expect((await answer(gm, CHECK, { passage: 1, holds: false, changes: ["Give her words."] })).next).toBe(note(STAGE_NOTE.checkedRevise, { n: "1", left: "1" }));
    await answer(narrator, READ, { passage: 1 });
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs. “The rent's covered, don't worry.”" });
    expect((await answer(gm, CHECK, { passage: 1, holds: false, changes: ["Keep her shrug."] })).next).toBe(note(STAGE_NOTE.checkedSpent, { n: "1" }));
  });

  test("a change to a waiting draft goes through where what no passage tells yet had reached its eyes before the narrator read it", async () => {
    const { book, story, as, another } = await stage();
    const first = await as(HARNESS_AGENT.narrator, false);
    await answer(first, READ);
    await answer(first, DRAFT, { passage: 1, text: "Mara shrugs." });
    await answer(await as(HARNESS_AGENT.gm, false), CHECK, { passage: 1, holds: false, changes: ["Give her words."] });
    // The next passage's beat is recorded, then a reviser reads passage 1 and drafts, and fixes its own draft before the check.
    await story.write({ beats: [KETTLE] });
    const reviser = another(first, "agent_narrator_2");
    await answer(reviser, READ, { passage: 1 });
    await answer(reviser, DRAFT, { passage: 1, text: "Mara shrugs. “The rent's covered.”" });
    await answer(reviser, DRAFT, { passage: 1, text: "Mara shrugs. “The rent's covered, don't worry.”" });
    expect(drafts(book)).toEqual([[1, ["Mara shrugs.", "Mara shrugs. “The rent's covered, don't worry.”"]]]);
  });
});

describe("what a later passage goes on from", () => {
  test("only each earlier passage that passed its check: one unchecked, at fault, or spent at fault is named, never handed, and handed once it passes", async () => {
    const { as, another } = await stage();
    const jordan = await as(HARNESS_AGENT.narrator, false);
    const joss = another(await as(HARNESS_AGENT.narrator, false, JOSS), "agent_narrator_joss");
    const gm = await as(HARNESS_AGENT.gm, false);
    const invented = "Mara shrugs and pours a glass of wine.";
    await answer(jordan, READ);
    await answer(jordan, DRAFT, { passage: 1, text: invented });
    const open = note(STAGE_NOTE.replyOpen, { n: "1" });
    // Unchecked: what Joss's passage goes on from holds nothing of it.
    const unchecked = await answer(joss, READ);
    expect({ passage: unchecked.passage, reply: unchecked.reply, open: unchecked.open }).toEqual({ passage: 2, reply: undefined, open });
    // At fault: still not handed.
    await answer(gm, CHECK, { passage: 1, holds: false, changes: ["She pours nothing: drop the wine."] });
    const fault = await answer(joss, READ, { passage: 2 });
    expect({ reply: fault.reply, open: fault.open }).toEqual({ reply: undefined, open });
    // Revised and passed: handed, and named no more.
    await answer(jordan, READ, { passage: 1 });
    await answer(jordan, DRAFT, { passage: 1, text: "Mara shrugs." });
    await answer(gm, CHECK, { passage: 1, holds: true });
    const passed = await answer(joss, READ, { passage: 2 });
    expect({ reply: passed.reply, open: passed.open }).toEqual({ reply: "Mara shrugs.", open: undefined });

    // Its drafts spent at fault, a passage may still be left out: the next one isn't handed it either.
    const spent = await stage({ revisions: 0 });
    const narrator = await spent.as(HARNESS_AGENT.narrator, false);
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: invented });
    await answer(await spent.as(HARNESS_AGENT.gm, false), CHECK, { passage: 1, holds: false, changes: ["She pours nothing: drop the wine."] });
    await spent.story.write({ beats: [KETTLE] });
    const next = await answer(spent.another(narrator, "agent_narrator_2"), READ);
    expect({ passage: next.passage, reply: next.reply, open: next.open }).toEqual({ passage: 2, reply: undefined, open });
  });
});

describe("the check and the release gate", () => {
  test("a passage goes out by its number, as its latest draft, once it passed its check: never undrafted, unchecked, at fault, named twice, out already, unknown to the turn, nor from anyone but the author", async () => {
    const { book, settings, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, READ);
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateUndrafted, { n: "1" }) });
    // The narrator is told which passage it drafted and how long it is: all its one-line answer needs, with no need to write the passage out again.
    const first = "“The rent's covered,” Mara says.";
    const drafted = await answer(narrator, DRAFT, { passage: 1, text: first });
    expect(drafted.drafted).toContain(note(STAGE_NOTE.drafted, { n: "1", draft: "1", of: "3", chars: String(first.length) }));
    expect(drafted.drafted).toContain(String(first.length));
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateUnchecked, { n: "1" }) });
    await answer(gm, CHECK, { passage: 1, holds: false, changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateFault, { n: "1", left: "2" }) });
    // Revising, the narrator is handed its draft and the changes.
    const again = await answer(narrator, READ, { passage: 1 });
    expect(again.revise).toEqual({ draft: first, changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    const passage = "Mara shrugs. “The rent's covered, don't worry.”";
    await answer(narrator, DRAFT, { passage: 1, text: passage });
    await answer(gm, CHECK, { passage: 1, holds: true });
    expect(released(book, settings, { pieces: [1] }, HARNESS_AGENT.character)).toEqual({ refused: note(STAGE_NOTE.gateAuthor) });
    expect(released(book, settings, { pieces: [1, 2] })).toEqual({ refused: note(STAGE_NOTE.noPassage, { n: "2" }) });
    expect(released(book, settings, { pieces: [1, "1"] })).toEqual({ refused: note(STAGE_NOTE.gateRepeated, { n: "1" }) });
    expect(released(book, settings, {})).toEqual({ refused: note(STAGE_NOTE.gateNothing) });
    expect(released(book, settings, { pieces: [1], place: "middle" })).toEqual({ refused: note(STAGE_NOTE.gateArgs, { arg: "place" }) });
    // Its latest draft goes out, as drafted: nothing of it is typed again.
    expect(released(book, settings, { pieces: [1] })).toEqual({ text: passage });
    releaseNoted(book, { pieces: [1] });
    expect(book.passage(1)?.released).toBe(true);
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateTwice, { n: "1" }) });
    // A line of the author's own goes out up to its length, and nothing longer; the refusal names the setting.
    expect(released(book, settings, { words: "  (Out of character: done, the car stays put.)  " })).toEqual({ text: "(Out of character: done, the car stays put.)" });
    const long = released(book, settings, { words: "x ".repeat(400) });
    expect(long).toEqual({ refused: note(STAGE_NOTE.gateWords, { size: "799", chars: String(NARRATION_DEFAULTS.ownChars) }) });
    expect("refused" in long ? long.refused : "").toContain(NARRATION_LABELS.ownChars);
  });

  test("one release names several pieces: their latest drafts go out in the order named, a blank line between them, the author's own words where it puts them, and each is marked out", async () => {
    const { book, settings, as, another } = await stage();
    const jordan = await as(HARNESS_AGENT.narrator, false);
    const joss = another(await as(HARNESS_AGENT.narrator, false, JOSS), "agent_narrator_joss");
    const gm = await as(HARNESS_AGENT.gm, false);
    const first = "Mara shrugs. “The rent's covered, don't worry.”";
    const second = "In the hall, Ilse slips out of sight.";
    await answer(jordan, READ);
    await answer(jordan, DRAFT, { passage: 1, text: first });
    await answer(gm, CHECK, { passage: 1, holds: true });
    // Nothing is out yet, and the second narrator is handed the first passage, which passed, as the reply so far.
    const read = await answer(joss, READ);
    expect({ passage: read.passage, reply: read.reply }).toEqual({ passage: 2, reply: first });
    await answer(joss, DRAFT, { passage: 2, text: second });
    expect(released(book, settings, { pieces: [1, 2] })).toEqual({ refused: note(STAGE_NOTE.gateUnchecked, { n: "2" }) });
    await answer(gm, CHECK, { passage: 2, holds: true });
    expect(released(book, settings, { pieces: [1, 2], words: "(The rent is due on Friday.)" })).toEqual({ text: `${first}\n\n${second}\n\n(The rent is due on Friday.)` });
    const args = { pieces: [2, 1], words: "(The rent is due on Friday.)", place: "before" };
    expect(released(book, settings, args)).toEqual({ text: `(The rent is due on Friday.)\n\n${second}\n\n${first}` });
    releaseNoted(book, args);
    expect(book.opened.map((p) => ({ n: p.n, out: p.released }))).toEqual([
      { n: 1, out: true },
      { n: 2, out: true },
    ]);
    // A character's stream on the direct line names no passage: it marks none.
    const other = await stage();
    await answer(await other.as(HARNESS_AGENT.narrator, false), READ);
    releaseNoted(other.book, {});
    expect(other.book.passage(1)?.released).toBe(false);
  });

  test("only the checker the settings name checks, a passage has the drafts they allow, and with no one checking anything drafted goes out", async () => {
    const byAuthor = await stage({ check: "author", revisions: 0 });
    const narrator = await byAuthor.as(HARNESS_AGENT.narrator, false);
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs." });
    expect(await refusal(await byAuthor.as(HARNESS_AGENT.gm, false), CHECK, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkWho));
    const changes = await refusal(await byAuthor.as(HARNESS_AGENT.author, true), CHECK, { passage: 1, holds: false });
    expect(changes).toBe(note(STAGE_NOTE.checkChanges, { most: "12", chars: "400" }));
    for (const label of [NARRATION_LABELS.changes, NARRATION_LABELS.changeChars]) expect(changes).toContain(label);
    const checked = await answer(await byAuthor.as(HARNESS_AGENT.author, true), CHECK, { passage: 1, holds: false, changes: ["Give her words."] });
    expect(checked.next).toBe(note(STAGE_NOTE.checkedSpent, { n: "1" }));
    const spent = await refusal(narrator, DRAFT, { passage: 1, text: "Mara shrugs again." });
    expect(spent).toBe(note(STAGE_NOTE.draftSpent, { n: "1", made: "1" }));
    expect(spent).toContain(NARRATION_LABELS.revisions);
    // A spent passage is the author's to release or leave out: a new narrator for the same eyes opens nothing, as nothing new reached them.
    expect(await refusal(byAuthor.another(narrator, "agent_narrator_2"), READ)).toBe(note(STAGE_NOTE.toldAlready, { pov: "Jordan Ellis", n: "2", told: "1" }));
    // Its drafts spent, the last one goes out as it stands, if the author lets it.
    expect(released(byAuthor.book, byAuthor.settings, { pieces: [1] })).toEqual({ text: "Mara shrugs." });

    const open = await stage({ check: "none" });
    const free = await open.as(HARNESS_AGENT.narrator, false);
    await answer(free, READ);
    await answer(free, DRAFT, { passage: 1, text: "Mara shrugs." });
    expect(await refusal(await open.as(HARNESS_AGENT.gm, false), CHECK, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkNone));
    expect(released(open.book, open.settings, { pieces: [1] })).toEqual({ text: "Mara shrugs." });
    expect(released(open.book, open.settings, { words: "x ".repeat(400) })).toEqual({ text: "x ".repeat(400).trim() });
  });

  test("a draft longer than a passage may be is refused, naming the setting", async () => {
    const { settings, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    await answer(narrator, READ);
    const long = await refusal(narrator, DRAFT, { passage: 1, text: "x".repeat(settings.narration.passageChars + 1) });
    expect(long).toBe(note(STAGE_NOTE.draftLong, { chars: String(settings.narration.passageChars) }));
    expect(long).toContain(NARRATION_LABELS.passageChars);
  });
});

describe("where the telling stands, and what goes out when the author stops short", () => {
  test("passage_read without a number lists each passage's figures and the next number, and gives no passage's text", async () => {
    const { as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs." });
    const list = await answer(await as(HARNESS_AGENT.author, true), LOOK);
    expect(list).toEqual({ pieces: [{ passage: 1, pov: "Jordan Ellis (player)", draft: 1, of: 3, chars: "Mara shrugs.".length, check: "waits", left: 2, ready: false }], next: 2 });
    expect(JSON.stringify(list)).not.toContain("Mara shrugs");
  });

  test("the author's run ending with nothing released offers the whole telling only where every passage is settled and every beat that reached the player's character is told, marked out only once LumiAH says it went; else nothing", async () => {
    const { book, settings, story, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    /** The beats of the turn that reached Jordan, as the engine finds them when LumiAH asks. */
    const jordans = ["b1", "b2", "b5", "b6"];
    expect(unreleasedReply(book, settings.narration, jordans)).toBeNull();
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 1, text: "Mara shrugs." });
    await answer(gm, CHECK, { passage: 1, holds: true });
    await story.write({ beats: [KETTLE] });
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 2, text: "The kettle shrieks." });
    await answer(gm, CHECK, { passage: 2, holds: true });
    await story.write({ beats: [DOOR] });
    await answer(narrator, READ);
    await answer(narrator, DRAFT, { passage: 3, text: "The front door bangs." });
    const all = [...jordans, KETTLE.id, DOOR.id];
    // Passage 3 waits for its check: nothing goes, not even what passed before it.
    expect(unreleasedReply(book, settings.narration, all)).toBeNull();
    await answer(gm, CHECK, { passage: 3, holds: true });
    // A beat that reached Jordan and no passage tells: nothing goes.
    expect(unreleasedReply(book, settings.narration, [...all, "b9"])).toBeNull();
    expect(unreleasedReply(book, settings.narration, all)).toEqual({ text: "Mara shrugs.\n\nThe kettle shrieks.\n\nThe front door bangs." });
    // Offered, not yet sent: LumiAH may still send nothing (its wait ran out, the player stopped the turn), and then nothing is out.
    expect(book.opened.map((p) => p.released)).toEqual([false, false, false]);
    // LumiAH says it went, with no arguments: what was offered is out.
    releaseNoted(book, {});
    expect(book.opened.map((p) => p.released)).toEqual([true, true, true]);

    // A passage found at fault with no drafts left is one no one named: nothing goes, though the passage after it passed.
    const spent = await stage({ revisions: 0 });
    const told = await spent.as(HARNESS_AGENT.narrator, false);
    const checker = await spent.as(HARNESS_AGENT.gm, false);
    await answer(told, READ);
    await answer(told, DRAFT, { passage: 1, text: "Mara shrugs and pours a glass of wine." });
    await answer(checker, CHECK, { passage: 1, holds: false, changes: ["She pours nothing: drop the wine."] });
    await spent.story.write({ beats: [KETTLE] });
    await answer(told, READ);
    await answer(told, DRAFT, { passage: 2, text: "The kettle shrieks." });
    await answer(checker, CHECK, { passage: 2, holds: true });
    expect(unreleasedReply(spent.book, spent.settings.narration, [...jordans, KETTLE.id])).toBeNull();
    expect(spent.book.opened.map((p) => p.released)).toEqual([false, false]);
  });
});

describe("a new passage with nothing left to tell", () => {
  test("names the passage that told the last of what reached its eyes, so its own beats are recorded after it; with no beat reaching those eyes, says that", async () => {
    const { story, as, another } = await stage();
    const first = await as(HARNESS_AGENT.narrator, false);
    await answer(first, READ);
    await answer(first, DRAFT, { passage: 1, text: "Mara shrugs." });
    const second = another(first, "agent_narrator_2");
    const told = await refusal(second, READ, { passage: 2 });
    expect(told).toBe(note(STAGE_NOTE.toldAlready, { pov: "Jordan Ellis", n: "2", told: "1" }));
    expect(await refusal(second, READ)).toBe(told);
    // Recorded after passage 1, the next passage's beats are its own.
    await story.write({ beats: [KETTLE] });
    const read = await answer(second, READ, { passage: 2 });
    expect({ passage: read.passage, happened: read.happened }).toEqual({ passage: 2, happened: [expect.objectContaining({ sensed: "The kettle shrieks." })] });
    // No beat on the record reached these eyes: nothing is named as told.
    const empty = await stage({}, () => []);
    expect(await refusal(await empty.as(HARNESS_AGENT.narrator, false), READ)).toBe(note(STAGE_NOTE.nothing, { pov: "Jordan Ellis" }));
  });
});

describe("the narration reads come back whole, what their reader acts on first", () => {
  test("narration_read on a revision gives the draft and every change at their longest first, before the prose it matches its voice to, within what it states it gives whole", async () => {
    const { rig, chatId, settings, as } = await stage({}, longBeats);
    const s = settings.narration;
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, READ);
    const draft = prose(s.passageChars).trim();
    await answer(narrator, DRAFT, { passage: 1, text: draft });
    const changes = Array.from({ length: s.changes }, (_, i) => `${prose(s.changeChars - 4).trim()} #${i}`);
    await answer(gm, CHECK, { passage: 1, holds: false, changes });
    const out = await call(narrator, READ, { passage: 1 });
    expect(out.error).toBeUndefined();
    // Past what LumiAH clips a result at, and within what the harness says reaches the narrator whole, which keeps to the ceiling of every whole read.
    const whole = (await wholeOf(rig, chatId, settings, READ)) ?? 0;
    expect(whole).toBeLessThanOrEqual(WHOLE_READ_MOST);
    expect(out.text.length).toBeGreaterThan(s.passageChars);
    expect(out.text.length).toBeLessThanOrEqual(whole);
    const read = JSON.parse(out.text) as Record<string, unknown>;
    expect(read.revise).toEqual({ draft, changes });
    expect(read.recent).toBe("Morning.");
    const keys = Object.keys(read);
    expect(keys.indexOf("revise")).toBeLessThan(keys.indexOf("happened"));
    expect(keys.indexOf("revise")).toBeLessThan(keys.indexOf("recent"));
  });

  test("passage_read gives the passage's beats at their longest, then the latest draft at its longest, within what it states it gives whole", async () => {
    const { rig, chatId, settings, as } = await stage({}, longBeats);
    const s = settings.narration;
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, READ);
    const draft = prose(s.passageChars).trim();
    await answer(narrator, DRAFT, { passage: 1, text: draft });
    const out = await call(gm, LOOK, { passage: 1 });
    expect(out.error).toBeUndefined();
    const whole = (await wholeOf(rig, chatId, settings, LOOK)) ?? 0;
    expect(whole).toBeLessThanOrEqual(WHOLE_READ_MOST);
    expect(out.text.length).toBeGreaterThan(s.passageChars);
    expect(out.text.length).toBeLessThanOrEqual(whole);
    const read = JSON.parse(out.text) as { beats: { id: string; what: string }[]; draft: { text: string } };
    expect(read.beats.map((b) => b.id)).toEqual(longBeats(settings).map((b) => b.id));
    expect(read.beats.every((b) => b.what === prose(settings.story.limits.beatChars))).toBe(true);
    expect(read.draft.text).toBe(draft);
    const keys = Object.keys(read);
    expect(keys.indexOf("beats")).toBeLessThan(keys.indexOf("draft"));
  });
});

describe("the narration settings and texts", () => {
  test("read with their defaults: a file without them, or with values out of their bounds, reads as shipped", () => {
    expect(narrationSettingsOf(undefined)).toEqual({ ...NARRATION_DEFAULTS });
    expect(defaultSettings().narration).toEqual({ ...NARRATION_DEFAULTS });
    expect(NARRATION_DEFAULTS).toEqual({ check: "gm", revisions: 2, replyChars: 1500, recentChars: 4000, passageChars: 24_000, changes: 12, changeChars: 400, ownChars: 600, directLine: "own" });
    expect(narrationSettingsOf({ check: "everyone", revisions: 99, replyChars: -1, directLine: "sung", ownChars: 2.5 })).toEqual({ ...NARRATION_DEFAULTS });
    expect(narrationSettingsOf({ check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 })).toEqual({ ...NARRATION_DEFAULTS, check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 });
  });

  test("a player's own words for a draft's head, saved before it gave the draft's length, are kept and sent", () => {
    const mine = "Passage {{n}}, draft {{draft}} of {{of}}, is in.";
    expect(promptSettingsOf({ texts: { [STAGE_NOTE.drafted]: mine }, maxChars: 20_000 }).texts[STAGE_NOTE.drafted]).toBe(mine);
    expect(renderPrompt(STAGE_NOTE.drafted, { [STAGE_NOTE.drafted]: mine }, { n: "1", draft: "1", of: "3", chars: "12" })).toBe("Passage 1, draft 1 of 3, is in.");
  });
});
