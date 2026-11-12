// The story record's tools (DEPTH2-PLAN §5), each rule and refusal once, on a Port Alder chat whose
// story record is the real one: written on the chat's newest reply (`chatStoryPort`) through the
// ledger, read back along its path. Who may write which beat; a feed never carries what happened as
// true unless the beat is the person's own; a struck beat leaves the feed; the budget refuses.

import { describe, expect, test } from "bun:test";
import { runHarnessTool } from "../../src/backend/agents/tools/harness";
import type { HarnessTurn } from "../../src/backend/agents/tools/harness-turn";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { renderPrompt } from "../../src/backend/prompts";
import { chatStoryPort } from "../../src/backend/story/record";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import { RECORD_NOTE, RECORD_TOOL } from "../../src/shared/harness-texts-record";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { UserSettings } from "../../src/shared/settings";
import type { Rig } from "../support/rig";
import { alderChat, HOME, toolEnv } from "../support/tools";

const person = (id: string, name: string, here: boolean): JsonObject => ({ id, kind: "character", name, tier: "background", fields: here ? { place: HOME } : {}, relations: [] });

/** A Port Alder chat with Mara, Joss and Ilse where the player's character wakes, and Okoro nowhere. */
async function storyChat(): Promise<{ rig: Rig; chatId: string }> {
  return alderChat({ put: { entities: { mara: person("mara", "Mara", true), joss: person("joss", "Joss", true), ilse: person("ilse", "Ilse", true), okoro: person("okoro", "Okoro", false) } } });
}

/** The env a call of an agent of definition `role` runs with, as `as` where given, its turn reaching the chat's story record. */
async function envOf(rig: Rig, chatId: string, role: string, as?: string, settings?: UserSettings): Promise<ToolEnv> {
  const base = { ...toolEnv(rig, chatId, "gm"), marks: true };
  const { state } = await base.reader.view();
  const turn: HarnessTurn = {
    main: role === HARNESS_AGENT.author,
    directed: false,
    grant: () => false,
    knowing: false,
    settings: settings ?? (await rig.rt.settings.get(rig.host.userId)),
    host: rig.host,
    seed: "turn-seed",
    runSeed: "run-seed",
    start: state,
    landed: () => [],
    said: { messageId: null, user: "", before: "" },
    reply: null,
    stage: async () => ({ refused: true, code: "test", reason: "nothing is staged in this test" }),
    commit: async () => ({ refused: true, code: "test", reason: "nothing commits in this test" }),
    story: chatStoryPort(rig.rt, { chatId, userId: rig.host.userId, turn: "turn-test", on: "last" }),
  };
  return { ...base, agent: { role, id: `agent_${role}`, ...(as !== undefined ? { as } : {}) }, turn };
}

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** What an answer holds at `path`, key by key; undefined where it holds nothing there. */
const at = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, key) => (isRecord(v) ? v[key] : undefined), value);

async function answer(env: ToolEnv, name: string, args: JsonObject): Promise<unknown> {
  const out = await runHarnessTool(env, name, args);
  if (out.error) throw new Error(`${name} refused: ${out.text}`);
  return JSON.parse(out.text) as unknown;
}

async function refusal(env: ToolEnv, name: string, args: JsonObject): Promise<string> {
  const out = await runHarnessTool(env, name, args);
  if (!out.error) throw new Error(`${name} answered: ${out.text}`);
  return out.text;
}

const REACHED: JsonObject[] = [
  { who: "mara", reach: "whole" },
  { who: "joss", reach: "part", got: "a thud from upstairs" },
];

describe("the story record's tools", () => {
  test("the author writes any beat; a character's agent only its own acts, as the person it runs as; anyone else none", async () => {
    const { rig, chatId } = await storyChat();
    const author = await envOf(rig, chatId, HARNESS_AGENT.author);
    expect(await answer(author, RECORD_TOOL.beatWrite, { by: "Joss", kind: "do", what: "Joss pockets the key.", surface: "Joss leans on the counter.", exposure: [] })).toHaveProperty("written");
    const mara = await envOf(rig, chatId, HARNESS_AGENT.character, "mara");
    expect(await answer(mara, RECORD_TOOL.beatWrite, { by: "mara", kind: "say", what: "Mara asks after the key.", surface: "Mara asks where the key went.", quotes: ["Where's the key?"], exposure: [{ who: "joss", reach: "whole" }] })).toHaveProperty("written");
    expect(await refusal(mara, RECORD_TOOL.beatWrite, { by: "joss", kind: "do", what: "Joss gives the key back.", surface: "Joss hands it over.", exposure: [] })).toBe(note(RECORD_NOTE.notOwn, { self: "Mara", other: "Joss" }));
    expect(await refusal(mara, RECORD_TOOL.beatWrite, { by: "mara", kind: "happen", what: "The lights go out.", surface: "Darkness.", exposure: [] })).toBe(note(RECORD_NOTE.notOwnKind));
    expect(await refusal(await envOf(rig, chatId, HARNESS_AGENT.character), RECORD_TOOL.beatWrite, { by: "mara", kind: "say", what: "Hello.", surface: "Hello.", exposure: [] })).toBe(note(RECORD_NOTE.noSelf));
    expect(await refusal(await envOf(rig, chatId, "knowledge"), RECORD_TOOL.beatWrite, { by: "mara", kind: "say", what: "Hello.", surface: "Hello.", exposure: [] })).toBe(note(RECORD_NOTE.notWriter, { tool: RECORD_TOOL.beatWrite }));
    // The reads are the author's and the game master's: a character's agent reads nothing of the record but its own feed.
    expect(await refusal(mara, RECORD_TOOL.beatsRead, {})).toBe(note(RECORD_NOTE.notAuthorGm, { tool: RECORD_TOOL.beatsRead }));
    expect(await answer(await envOf(rig, chatId, HARNESS_AGENT.gm), RECORD_TOOL.beatsRead, {})).toMatchObject({ beats: [{ by: "joss", kind: "do" }, { by: "mara", kind: "say", decidedBy: { agent: HARNESS_AGENT.character, as: "mara" } }] });
  });

  test("exposure left out is proposed from who is there, and nothing is written until the caller gives it", async () => {
    const { rig, chatId } = await storyChat();
    const author = await envOf(rig, chatId, HARNESS_AGENT.author);
    const proposal = at(await answer(author, RECORD_TOOL.beatWrite, { by: "mara", kind: "say", what: "Mara laughs.", surface: "Mara laughs aloud." }), "proposed", "exposure");
    // Everyone where Mara is, the player's character as "player", each as having taken in all of it; never Mara herself, nor Okoro, who is elsewhere.
    expect(proposal).toEqual(expect.arrayContaining([{ who: "ilse", reach: "whole" }, { who: "joss", reach: "whole" }, { who: "player", reach: "whole" }]));
    expect(proposal).not.toContainEqual({ who: "mara", reach: "whole" });
    expect(proposal).not.toContainEqual({ who: "okoro", reach: "whole" });
    expect(at(await answer(author, RECORD_TOOL.beatsRead, {}), "beats")).toEqual([]);
    // A thought reaches no one: it needs no exposure, and refuses one.
    expect(await answer(author, RECORD_TOOL.beatWrite, { by: "mara", kind: "inner", what: "Mara doubts Joss." })).toHaveProperty("written");
    expect(await refusal(author, RECORD_TOOL.beatWrite, { by: "mara", kind: "inner", what: "Mara fears him.", exposure: [{ who: "joss", reach: "whole" }] })).toBe(note(RECORD_NOTE.innerReach));
  });

  test("a feed never carries what happened as true unless the beat is the person's own, and a struck beat leaves it", async () => {
    const { rig, chatId } = await storyChat();
    const author = await envOf(rig, chatId, HARNESS_AGENT.author);
    // A feed is a principal's: the author casts those it gives one.
    for (const who of ["Mara", "Joss", "Ilse"]) await answer(author, RECORD_TOOL.castSet, { who, standing: "principal", why: "In the scene." });
    const TRUE = "The cellar door was forced by Okoro.";
    const beat = String(at(await answer(author, RECORD_TOOL.beatWrite, { by: "world", kind: "happen", where: HOME, what: TRUE, surface: "A loud bang from below.", exposure: REACHED }), "written", "beat"));
    const mara = await envOf(rig, chatId, HARNESS_AGENT.character, "mara");
    await answer(mara, RECORD_TOOL.beatWrite, { by: "mara", kind: "inner", what: "Mara thinks of her brother." });
    const fed = await runHarnessTool(mara, RECORD_TOOL.feedRead, {});
    expect(fed.text).not.toContain(TRUE);
    expect(JSON.parse(fed.text)).toMatchObject({ items: [{ beat, reach: "whole", by: "world", surface: "A loud bang from below." }, { reach: "own", kind: "inner", what: "Mara thinks of her brother." }] });
    const joss = await envOf(rig, chatId, HARNESS_AGENT.character, "joss");
    const jossFed = await runHarnessTool(joss, RECORD_TOOL.feedRead, {});
    expect(jossFed.text).not.toContain(TRUE);
    expect(JSON.parse(jossFed.text)).toMatchObject({ items: [{ beat, reach: "part", got: "a thud from upstairs" }] });
    // Ilse wasn't reached, and Mara's thought reaches no one.
    expect(at(await answer(await envOf(rig, chatId, HARNESS_AGENT.character, "ilse"), RECORD_TOOL.feedRead, {}), "items")).toEqual([]);
    // Only a character's agent reads a feed, and only a principal's.
    expect(await refusal(author, RECORD_TOOL.feedRead, {})).toBe(note(MINDS_NOTE.onlyCharacter, { tool: RECORD_TOOL.feedRead }));
    expect(await refusal(await envOf(rig, chatId, HARNESS_AGENT.character, "okoro"), RECORD_TOOL.feedRead, {})).toContain("Okoro");
    expect(await answer(author, RECORD_TOOL.beatStrike, { beat, why: "Okoro was never in the cellar." })).toMatchObject({ struck: { beat, reached: REACHED } });
    expect(await answer(mara, RECORD_TOOL.feedRead, {})).toMatchObject({ items: [{ reach: "own" }] });
    expect(at(await answer(joss, RECORD_TOOL.feedRead, {}), "items")).toEqual([]);
    expect(await refusal(author, RECORD_TOOL.beatStrike, { beat, why: "Again." })).toBe(note(RECORD_NOTE.struckAlready, { beat, why: "Okoro was never in the cellar." }));
  });

  test("the budget refuses a T1, T2 or T3 treatment past what a stretch of story time allows, and never a T4", async () => {
    const { rig, chatId } = await storyChat();
    const settings = await rig.rt.settings.get(rig.host.userId);
    const author = await envOf(rig, chatId, HARNESS_AGENT.author, undefined, { ...settings, story: { ...settings.story, budget: { stretchMinutes: 1440, t1: 1, t2: 2, t3: 4 } } });
    const now = String(at(await answer(author, RECORD_TOOL.beatsRead, {}), "now"));
    const later = (minutes: number): string => {
      const [date = "", time = "00:00"] = now.split(" ");
      const [h = 0, m = 0] = time.split(":").map(Number);
      const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
      return `${date} ${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    };
    const first = String(at(await answer(author, RECORD_TOOL.draftOpen, { what: "The guild robs the docks.", tier: 1, who: ["okoro"], when: later(30) }), "opened", "id"));
    expect(await refusal(author, RECORD_TOOL.draftOpen, { what: "Joss leaves town.", tier: 1, who: ["joss"], when: later(60) })).toBe(note(RECORD_NOTE.budget, { tier: "1", stretch: "day", limit: "1", used: "1" }));
    expect(await answer(author, RECORD_TOOL.draftOpen, { what: "Joss leaves town.", tier: 4, who: ["joss"], when: later(60) })).toHaveProperty("opened");
    // A dropped draft gives its treatment back.
    expect(await answer(author, RECORD_TOOL.draftDrop, { draft: first, why: "The guild lies low." })).toHaveProperty("dropped");
    expect(await answer(author, RECORD_TOOL.draftOpen, { what: "Ilse sells the shop.", tier: 1, who: ["ilse"], when: later(90) })).toHaveProperty("opened");
    // Drafts are the author's and the game master's.
    expect(await refusal(await envOf(rig, chatId, HARNESS_AGENT.character, "mara"), RECORD_TOOL.draftOpen, { what: "x", tier: 4, when: later(10) })).toBe(note(RECORD_NOTE.notAuthorGm, { tool: RECORD_TOOL.draftOpen }));
  });

  test("casting is the author's alone, and a standing the player pinned is refused, as is the player's character", async () => {
    const { rig, chatId } = await storyChat();
    const author = await envOf(rig, chatId, HARNESS_AGENT.author);
    expect(await answer(author, RECORD_TOOL.castSet, { who: "Mara", standing: "principal", why: "She drives the story." })).toHaveProperty("cast");
    expect(await refusal(await envOf(rig, chatId, HARNESS_AGENT.gm), RECORD_TOOL.castSet, { who: "Joss", standing: "supporting", why: "He matters." })).toBe(note(RECORD_NOTE.notAuthor, { tool: RECORD_TOOL.castSet }));
    expect(await refusal(author, RECORD_TOOL.castSet, { who: "player", standing: "extra", why: "No." })).toBe(note(RECORD_NOTE.playerCast, { name: "Jordan Ellis" }));
    // The player's pin, as their page writes it, stands against the author.
    const page = chatStoryPort(rig.rt, { chatId, userId: rig.host.userId, turn: "player-page", on: "last" });
    expect(await page.write({ cast: [{ entity: "mara", standing: "supporting", pinned: true, why: "The player wants her small." }] })).toEqual({ kept: true });
    expect(await refusal(author, RECORD_TOOL.castSet, { who: "Mara", standing: "principal", why: "Again." })).toBe(note(RECORD_NOTE.pinned, { name: "Mara", standing: "supporting" }));
    expect(await answer(author, RECORD_TOOL.castList, {})).toMatchObject({ cast: [{ entity: "mara", standing: "supporting", pinned: true }] });
  });
});
