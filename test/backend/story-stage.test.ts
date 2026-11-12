// The narrator, the check and the release gate (DEPTH2-PLAN §3.3): the narrator is handed only what
// reached the point-of-view character, never a beat's truth beyond it; only the author names other
// eyes; only the checker the settings name checks, within the drafts they allow; the gate lets out
// only the author's releases, and of those only a passage that passed its check (or whose drafts
// are spent) or a few words of the author's own; the settings read with their defaults.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { defaultSettings } from "../../src/backend/settings-store";
import { releaseGate, releaseNoted, StageBook } from "../../src/backend/story/narration";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { STAGE_NOTE, STAGE_TOOL } from "../../src/shared/harness-texts-stage";
import type { Beat } from "../../src/shared/ledger";
import { NARRATION_DEFAULTS, type NarrationSettings, narrationSettingsOf, type UserSettings } from "../../src/shared/settings";
import { HOME } from "../support/tools";
import { answer, castChat, castEnv, castTurn, ILSE, JOSS, MARA, memoryStory, refusal } from "./harness-cast-kit";

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

/** A chat with the moment written by its turn, one stage book for the turn's narration, and an env for each caller of that turn. */
async function stage(narration: Partial<NarrationSettings> = {}) {
  const { rig, chatId } = await castChat();
  const story = memoryStory();
  await story.write({ beats: [...BEATS] });
  const book = new StageBook();
  const base = await rig.rt.settings.get(rig.host.userId);
  const settings: UserSettings = { ...base, narration: { ...base.narration, ...narration } };
  const as = async (role: string, main: boolean, who?: string) => castEnv(rig, chatId, await castTurn(rig, chatId, { main, settings, stageBook: book, story }), role, null, who);
  return { book, settings, as };
}

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

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
  test("a passage goes out once it passed its check, once; never unchecked, at fault, as an earlier draft or from anyone but the author", async () => {
    const { book, settings, as } = await stage();
    const narrator = await as(HARNESS_AGENT.narrator, false);
    const gm = await as(HARNESS_AGENT.gm, false);
    const author = { role: HARNESS_AGENT.author };
    await answer(narrator, STAGE_TOOL.narrationRead);
    await answer(narrator, STAGE_TOOL.passageDraft, { text: "“The rent's covered,” Mara says." });
    expect(releaseGate(book, settings, { ...author, text: "“The rent's covered,” Mara says." })).toEqual({ refused: note(STAGE_NOTE.gateUnchecked, { n: "1" }) });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: false, changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    expect(releaseGate(book, settings, { ...author, text: "“The rent's covered,” Mara says." })).toEqual({ refused: note(STAGE_NOTE.gateFault, { n: "1", left: "2" }) });
    // Revising, the narrator is handed its draft and the changes, and a straight-quoted copy of a draft counts as the draft.
    const again = await answer(narrator, STAGE_TOOL.narrationRead);
    expect(again.revise).toEqual({ draft: "“The rent's covered,” Mara says.", changes: ["Quote her whole: “The rent's covered, don't worry.”"] });
    const passage = "Mara shrugs. “The rent's covered, don't worry.”";
    await answer(narrator, STAGE_TOOL.passageDraft, { text: passage });
    expect(releaseGate(book, settings, { ...author, text: "“The rent's covered,” Mara says." })).toEqual({ refused: note(STAGE_NOTE.gateEarlier, { n: "1", draft: "2" }) });
    await answer(gm, STAGE_TOOL.passageCheck, { passage: 1, holds: true });
    expect(releaseGate(book, settings, { role: HARNESS_AGENT.character, text: passage })).toEqual({ refused: note(STAGE_NOTE.gateAuthor) });
    expect(releaseGate(book, settings, { ...author, text: 'Mara shrugs. "The rent\'s covered, don\'t worry."' })).toBeNull();
    releaseNoted(book, { ...author, text: passage });
    expect(book.reply()).toBe(passage);
    expect(releaseGate(book, settings, { ...author, text: passage })).toEqual({ refused: note(STAGE_NOTE.gateTwice, { n: "1" }) });
    // A line of the author's own goes out up to its length, and nothing longer that is no passage.
    expect(releaseGate(book, settings, { ...author, text: "(Out of character: done, the car stays put.)" })).toBeNull();
    expect(releaseGate(book, settings, { ...author, text: "x ".repeat(400) })).toEqual({ refused: note(STAGE_NOTE.gateUnknown, { chars: String(NARRATION_DEFAULTS.ownChars) }) });
  });

  test("only the checker the settings name checks, a passage has the drafts they allow, and with no one checking anything of the author's goes out", async () => {
    const byAuthor = await stage({ check: "author", revisions: 0 });
    const narrator = await byAuthor.as(HARNESS_AGENT.narrator, false);
    await answer(narrator, STAGE_TOOL.narrationRead);
    await answer(narrator, STAGE_TOOL.passageDraft, { text: "Mara shrugs." });
    expect(await refusal(await byAuthor.as(HARNESS_AGENT.gm, false), STAGE_TOOL.passageCheck, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkWho));
    expect(await refusal(await byAuthor.as(HARNESS_AGENT.author, true), STAGE_TOOL.passageCheck, { passage: 1, holds: false })).toBe(note(STAGE_NOTE.checkChanges, { most: "12", chars: "400" }));
    const checked = await answer(await byAuthor.as(HARNESS_AGENT.author, true), STAGE_TOOL.passageCheck, { passage: 1, holds: false, changes: ["Give her words."] });
    expect(checked.next).toBe(note(STAGE_NOTE.checkedSpent, { n: "1" }));
    expect(await refusal(narrator, STAGE_TOOL.passageDraft, { text: "Mara shrugs again." })).toBe(note(STAGE_NOTE.draftSpent, { n: "1", made: "1" }));
    // A spent passage is the author's to release or leave out: a new narrator for the same eyes doesn't take it over, and nothing new reached them.
    const second = { ...narrator, agent: { ...narrator.agent, id: "agent_narrator_2" } };
    expect(await refusal(second, STAGE_TOOL.narrationRead)).toBe(note(STAGE_NOTE.nothing, { pov: "Jordan Ellis" }));
    // Its drafts spent, the last one goes out as it stands, if the author lets it.
    expect(releaseGate(byAuthor.book, byAuthor.settings, { role: HARNESS_AGENT.author, text: "Mara shrugs." })).toBeNull();

    const open = await stage({ check: "none" });
    const free = await open.as(HARNESS_AGENT.narrator, false);
    await answer(free, STAGE_TOOL.narrationRead);
    await answer(free, STAGE_TOOL.passageDraft, { text: "Mara shrugs." });
    expect(await refusal(await open.as(HARNESS_AGENT.gm, false), STAGE_TOOL.passageCheck, { passage: 1, holds: true })).toBe(note(STAGE_NOTE.checkNone));
    expect(releaseGate(open.book, open.settings, { role: HARNESS_AGENT.author, text: "Mara shrugs." })).toBeNull();
    expect(releaseGate(open.book, open.settings, { role: HARNESS_AGENT.author, text: "x ".repeat(400) })).toBeNull();
  });
});

describe("the narration settings", () => {
  test("read with their defaults: a file without them, or with values out of their bounds, reads as shipped", () => {
    expect(narrationSettingsOf(undefined)).toEqual({ ...NARRATION_DEFAULTS });
    expect(defaultSettings().narration).toEqual({ ...NARRATION_DEFAULTS });
    expect(NARRATION_DEFAULTS).toEqual({ check: "gm", revisions: 2, replyChars: 1500, recentChars: 4000, passageChars: 12_000, changes: 12, changeChars: 400, ownChars: 600, directLine: "own" });
    expect(narrationSettingsOf({ check: "everyone", revisions: 99, replyChars: -1, directLine: "sung", ownChars: 2.5 })).toEqual({ ...NARRATION_DEFAULTS });
    expect(narrationSettingsOf({ check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 })).toEqual({ ...NARRATION_DEFAULTS, check: "author", revisions: 0, recentChars: 0, directLine: "narrated", ownChars: 0 });
  });
});
