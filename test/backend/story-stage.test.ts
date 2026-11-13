// The narrator, the check and the release gate (DEPTH2-PLAN §3.3): the narrator is handed only what
// reached the point-of-view character, never a beat's truth beyond it, and goes on from the reply as
// told so far; only the author names other eyes; only the checker the settings name checks, within
// the drafts they allow; the gate lets out only the author's release, naming each passage by its
// number, and of those only a passage that passed its check (or whose drafts are spent), joined in
// the order named with a few words of the author's own; the two reads come back whole, what their
// reader acts on first; a refusal from a limit names its setting; the settings read with their defaults.

import { describe, expect, test } from "bun:test";
import { harnessTools } from "../../src/backend/agents/tools/harness";
import { renderPrompt } from "../../src/backend/prompts";
import { defaultSettings } from "../../src/backend/settings-store";
import { releaseGate, releaseNoted, StageBook } from "../../src/backend/story/narration";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { STAGE_NOTE, STAGE_TOOL } from "../../src/shared/harness-texts-stage";
import type { Beat } from "../../src/shared/ledger";
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
  return { rig, chatId, book, settings, as };
}

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** What the author's release of `args` lets out of `book`. */
const released = (book: StageBook, settings: UserSettings, args: Record<string, unknown>, role: string = HARNESS_AGENT.author) => releaseGate(book, settings, { role, args });

/** Text `n` characters long that JSON has to escape in places: quote marks and line breaks, as prose has. */
const prose = (n: number): string => 'She said "not tonight".\nThe harbor lamps went out one by one. '.repeat(Math.ceil(n / 60) + 1).slice(0, n);

/** What the harness states `tool` gives whole in `chatId` under `settings`; absent, it states nothing. */
async function wholeOf(rig: Rig, chatId: string, settings: UserSettings, tool: string): Promise<number | undefined> {
  const { world } = await stateOf(rig, chatId);
  return harnessTools({ world, registry: rig.rt.registry, settings }).find((t) => t.name === tool)?.wholeChars;
}

/** As many beats as a turn's record holds, each at the longest the record's limits let one be, every one said where Jordan heard it whole. */
const longBeats = (settings: UserSettings): Beat[] => {
  const { limits } = settings.story;
  return Array.from({ length: limits.beatsPerTurn }, (_, i) => beat(`long_${i}`, { by: MARA, kind: "say", what: prose(limits.beatChars), surface: prose(limits.beatChars), quotes: Array.from({ length: limits.quotes }, () => prose(limits.quoteChars)), exposure: [{ who: "player", reach: "whole" }] }));
};

describe("what the narrator is handed (narration_read)", () => {
  test("only what reached the point-of-view character, as it reached them: never another's beat's truth, nor a beat that reached them not at all", async () => {
    const { as } = await stage();
    const got = await answer(await as(HARNESS_AGENT.narrator, false), STAGE_TOOL.narrationRead);
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
    expect(await refusal(await own.as(HARNESS_AGENT.narrator, false), STAGE_TOOL.narrationRead, { pov: JOSS })).toBe(note(STAGE_NOTE.povAuthor));
    const joss = await answer(await own.as(HARNESS_AGENT.narrator, false, JOSS), STAGE_TOOL.narrationRead);
    expect(joss.pov).toBe("Joss");
    // Joss saw Ilse go into the hall and did his own deed: neither reached Jordan.
    expect(JSON.stringify(joss)).toContain("Ilse steps out into the hall.");
    expect(JSON.stringify(joss)).toContain("Joss slips a sedative into the kettle.");
    const author = await answer(await (await stage()).as(HARNESS_AGENT.author, true), STAGE_TOOL.narrationRead, { pov: JOSS });
    expect({ pov: author.pov, passage: author.passage }).toEqual({ pov: "Joss", passage: undefined });
    expect(await refusal(await own.as(HARNESS_AGENT.gm, false), STAGE_TOOL.narrationRead)).toBe(note(STAGE_NOTE.narratorOnly, { tool: STAGE_TOOL.narrationRead }));
  });
});

describe("the check and the release gate", () => {
  test("a passage goes out by its number, as its latest draft, once it passed its check: never undrafted, unchecked, at fault, named twice, out already, unknown to the turn, nor from anyone but the author", async () => {
    const { book, settings, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateUndrafted, { n: "1" }) });
    // The narrator is told which passage it drafted and how long it is: all its one-line answer needs, with no need to write the passage out again.
    const first = "“The rent's covered,” Mara says.";
    const drafted = await answer(narrator, STAGE_TOOL.passageDraft, { text: first });
    expect(drafted.drafted).toContain(note(STAGE_NOTE.drafted, { n: "1", draft: "1", of: "3", chars: String(first.length) }));
    expect(drafted.drafted).toContain(String(first.length));
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateUnchecked, { n: "1" }) });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: false, changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    expect(released(book, settings, { pieces: [1] })).toEqual({ refused: note(STAGE_NOTE.gateFault, { n: "1", left: "2" }) });
    // Revising, the narrator is handed its draft and the changes.
    const again = await answer(narrator, STAGE_TOOL.narrationRead);
    expect(again.revise).toEqual({ draft: "“The rent's covered,” Mara says.", changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    const passage = "Mara shrugs. “The rent's covered, don't worry.”";
    await answer(narrator, STAGE_TOOL.passageDraft, { text: passage });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: true });
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

  test("one release names several pieces: their latest drafts go out in the order named, a blank line between them, the author's own words where it puts them, and each is marked out; a later narrator goes on from those told before it", async () => {
    const { book, settings, as } = await stage();
    const jordan = await as(HARNESS_AGENT.narrator, false);
    const seen = await as(HARNESS_AGENT.narrator, false, JOSS);
    const joss = { ...seen, agent: { ...seen.agent, id: "agent_narrator_joss" } };
    const gm = await as(HARNESS_AGENT.gm, false);
    const first = "Mara shrugs. “The rent's covered, don't worry.”";
    const second = "In the hall, Ilse slips out of sight.";
    await answer(jordan, STAGE_TOOL.narrationRead);
    await answer(jordan, STAGE_TOOL.passageDraft, { text: first });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: true });
    // Nothing is out yet, and the second narrator is handed the first passage as the reply so far.
    const read = await answer(joss, STAGE_TOOL.narrationRead);
    expect({ passage: read.passage, reply: read.reply }).toEqual({ passage: 2, reply: first });
    await answer(joss, STAGE_TOOL.passageDraft, { text: second });
    expect(released(book, settings, { pieces: [1, 2] })).toEqual({ refused: note(STAGE_NOTE.gateUnchecked, { n: "2" }) });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 2, holds: true });
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
    await answer(await other.as(HARNESS_AGENT.narrator, false), STAGE_TOOL.narrationRead);
    releaseNoted(other.book, {});
    expect(other.book.passage(1)?.released).toBe(false);
  });

  test("only the checker the settings name checks, a passage has the drafts they allow, and with no one checking anything drafted goes out", async () => {
    const byAuthor = await stage({ check: "author", revisions: 0 });
    const narrator = await byAuthor.as(HARNESS_AGENT.narrator, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    await answer(narrator, STAGE_TOOL.passageDraft, { text: "Mara shrugs." });
    expect(await refusal(await byAuthor.as(HARNESS_AGENT.gm, false), STAGE_TOOL.passageCheck, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkWho));
    const changes = await refusal(await byAuthor.as(HARNESS_AGENT.author, true), STAGE_TOOL.passageCheck, { passage: 1, holds: false });
    expect(changes).toBe(note(STAGE_NOTE.checkChanges, { most: "12", chars: "400" }));
    for (const label of [NARRATION_LABELS.changes, NARRATION_LABELS.changeChars]) expect(changes).toContain(label);
    const checked = await answer(await byAuthor.as(HARNESS_AGENT.author, true), STAGE_TOOL.passageCheck, { passage: 1, holds: false, changes: ["Give her words."] });
    expect(checked.next).toBe(note(STAGE_NOTE.checkedSpent, { n: "1" }));
    const spent = await refusal(narrator, STAGE_TOOL.passageDraft, { text: "Mara shrugs again." });
    expect(spent).toBe(note(STAGE_NOTE.draftSpent, { n: "1", made: "1" }));
    expect(spent).toContain(NARRATION_LABELS.revisions);
    // A spent passage is the author's to release or leave out: a new narrator for the same eyes doesn't take it over, and nothing new reached them.
    const second = { ...narrator, agent: { ...narrator.agent, id: "agent_narrator_2" } };
    expect(await refusal(second, STAGE_TOOL.narrationRead)).toBe(note(STAGE_NOTE.nothing, { pov: "Jordan Ellis" }));
    // Its drafts spent, the last one goes out as it stands, if the author lets it.
    expect(released(byAuthor.book, byAuthor.settings, { pieces: [1] })).toEqual({ text: "Mara shrugs." });

    const open = await stage({ check: "none" });
    const free = await open.as(HARNESS_AGENT.narrator, false);
    await answer(free, STAGE_TOOL.narrationRead);
    await answer(free, STAGE_TOOL.passageDraft, { text: "Mara shrugs." });
    expect(await refusal(await open.as(HARNESS_AGENT.gm, false), STAGE_TOOL.passageCheck, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkNone));
    expect(released(open.book, open.settings, { pieces: [1] })).toEqual({ text: "Mara shrugs." });
    expect(released(open.book, open.settings, { words: "x ".repeat(400) })).toEqual({ text: "x ".repeat(400).trim() });
  });

  test("a draft longer than a passage may be is refused, naming the setting", async () => {
    const { settings, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    const long = await refusal(narrator, STAGE_TOOL.passageDraft, { text: "x".repeat(settings.narration.passageChars + 1) });
    expect(long).toBe(note(STAGE_NOTE.draftLong, { chars: String(settings.narration.passageChars) }));
    expect(long).toContain(NARRATION_LABELS.passageChars);
  });
});

describe("the narration reads come back whole, what their reader acts on first", () => {
  test("narration_read on a revision gives the draft and every change at their longest first, before the prose it matches its voice to, within what it states it gives whole", async () => {
    const { rig, chatId, settings, as } = await stage({}, longBeats);
    const s = settings.narration;
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    const draft = prose(s.passageChars).trim();
    await answer(narrator, STAGE_TOOL.passageDraft, { text: draft });
    const changes = Array.from({ length: s.changes }, (_, i) => `${prose(s.changeChars - 4).trim()} #${i}`);
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: false, changes });
    const out = await call(narrator, STAGE_TOOL.narrationRead);
    expect(out.error).toBeUndefined();
    // Far past what LumiAH clips a result at, and within what the harness says reaches the narrator whole.
    expect(out.text.length).toBeGreaterThan(2 * s.passageChars);
    expect(out.text.length).toBeLessThanOrEqual((await wholeOf(rig, chatId, settings, STAGE_TOOL.narrationRead)) ?? 0);
    const read = JSON.parse(out.text) as Record<string, unknown>;
    expect(read.revise).toEqual({ draft, changes });
    expect(read.recent).toBe("Morning.");
    const keys = Object.keys(read);
    expect(keys.indexOf("revise")).toBeLessThan(keys.indexOf("happened"));
    expect(keys.indexOf("revise")).toBeLessThan(keys.indexOf("recent"));
  });

  test("passage_read gives every beat a turn may hold at its longest, then the latest draft at its longest, within what it states it gives whole", async () => {
    const { rig, chatId, settings, as } = await stage({}, longBeats);
    const s = settings.narration;
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    const draft = prose(s.passageChars).trim();
    await answer(narrator, STAGE_TOOL.passageDraft, { text: draft });
    const out = await call(gm, STAGE_TOOL.passageRead, { passage: 1 });
    expect(out.error).toBeUndefined();
    expect(out.text.length).toBeGreaterThan(2 * s.passageChars);
    expect(out.text.length).toBeLessThanOrEqual((await wholeOf(rig, chatId, settings, STAGE_TOOL.passageRead)) ?? 0);
    const read = JSON.parse(out.text) as { beats: { id: string; what: string }[]; draft: { text: string } };
    expect(read.beats.map((b) => b.id)).toEqual(longBeats(settings).map((b) => b.id));
    expect(read.beats.every((b) => b.what === prose(settings.story.limits.beatChars))).toBe(true);
    expect(read.draft.text).toBe(draft);
    const keys = Object.keys(read);
    expect(keys.indexOf("beats")).toBeLessThan(keys.indexOf("draft"));
  });
});

describe("the narration settings", () => {
  test("read with their defaults: a file without them, or with values out of their bounds, reads as shipped", () => {
    expect(narrationSettingsOf(undefined)).toEqual({ ...NARRATION_DEFAULTS });
    expect(defaultSettings().narration).toEqual({ ...NARRATION_DEFAULTS });
    expect(NARRATION_DEFAULTS).toEqual({ check: "gm", revisions: 2, replyChars: 1500, recentChars: 4000, passageChars: 24_000, changes: 12, changeChars: 400, ownChars: 600, directLine: "own" });
    expect(narrationSettingsOf({ check: "everyone", revisions: 99, replyChars: -1, directLine: "sung", ownChars: 2.5 })).toEqual({ ...NARRATION_DEFAULTS });
    expect(narrationSettingsOf({ check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 })).toEqual({ ...NARRATION_DEFAULTS, check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 });
  });
});
