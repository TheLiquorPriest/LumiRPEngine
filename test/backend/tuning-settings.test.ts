// The tuning build's settings (TUNING-BUILD-PLAN §7): the defaults sized for long-form play, an
// older file's old defaults moved to them once while a value the user chose stays, two settings
// nothing read dropped from an older file as it loads, each refusal that comes from a limit naming
// that limit's row by its label, and each cut at Engine answers shown whole naming that setting.

import { describe, expect, test } from "bun:test";
import { runHarnessTool } from "../../src/backend/agents/tools/harness";
import type { HarnessTurn } from "../../src/backend/agents/tools/harness-turn";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { renderPrompt } from "../../src/backend/prompts";
import { chatStoryPort } from "../../src/backend/story/record";
import { beatProblem, draftProblem, lengthProblem } from "../../src/engine/story/checks";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import { PREPARE_NOTE } from "../../src/shared/harness-texts-prepare";
import { RECORD_NOTE, RECORD_TOOL } from "../../src/shared/harness-texts-record";
import { BUILD_NOTE } from "../../src/shared/harness-texts-build";
import { WORLD_NOTE } from "../../src/shared/harness-texts-world";
import { RUNTIME_TEXT } from "../../src/shared/agent-prompts";
import { LOOP_DEFS } from "../../src/shared/agent-settings";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Beat, Draft } from "../../src/shared/ledger";
import { MIND_FILE_TITLES, PREPARE_LABELS, SETTINGS_DEFAULTS_REV, STORY_DEFAULTS, STORY_LIMIT_LABELS, type UserSettings } from "../../src/shared/settings";
import { Rig } from "../support/rig";
import { alderChat, HOME, toolEnv } from "../support/tools";

/** A settings file as stored, `{v: 1}` and `file`. */
const stored = (rig: Rig, file: Readonly<Record<string, unknown>>): void => void rig.host.files.set(`${rig.host.userId}/settings.json`, JSON.stringify({ v: 1, ...file }));
/** The settings file as the store last wrote it. */
const saved = (rig: Rig): unknown => JSON.parse(rig.host.files.get(`${rig.host.userId}/settings.json`) ?? "{}");
/** What `value` holds at `path`, key by key; undefined where it holds nothing there. */
const at = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, key) => (isRecord(v) ? v[key] : undefined), value);
/** The settings a stored `file` reads as. */
async function readStored(file: JsonObject): Promise<UserSettings> {
  const rig = new Rig({ shipped: true });
  stored(rig, file);
  return rig.rt.settings.get(rig.host.userId);
}
/** The four sizes the tuning build set for long-form play, as `s` has them. */
const sizes = (s: UserSettings): number[] => [s.narration.passageChars, s.story.limits.beatsRead, s.story.limits.feedItems, s.agents.clipChars];
/** A file that holds each of the four at `values`. */
const holding = (defaults: number | undefined, [passageChars, beatsRead, feedItems, clipChars]: number[]): JsonObject => ({ ...(defaults !== undefined ? { defaults } : {}), narration: { passageChars }, story: { limits: { beatsRead, feedItems } }, agents: { clipChars } });

describe("the settings sized for long-form play", () => {
  test("an untouched store reads a passage of 24,000 characters, 24 beats a read and at once, and 8,000 characters of an engine answer", async () => {
    const rig = new Rig({ shipped: true });
    expect(sizes(await rig.rt.settings.get(rig.host.userId))).toEqual([24_000, 24, 24, 8000]);
  });

  test("a file saved at the old defaults reads the new ones, once; a value the user chose, and the old ones saved since, stay", async () => {
    const old = [12_000, 40, 40, 4000];
    // Revision 10 was an earlier build's, which wrote it into files with the old numbers: those move too.
    for (const defaults of [undefined, 5, 9, 10]) expect([defaults, sizes(await readStored(holding(defaults, old)))]).toEqual([defaults, [24_000, 24, 24, 8000]]);
    // Chosen: any other number stays, whatever the file's revision.
    expect(sizes(await readStored(holding(9, [13_000, 41, 12, 3999])))).toEqual([13_000, 41, 12, 3999]);
    // Once: read against the new defaults, the old numbers are the user's own.
    expect(sizes(await readStored(holding(SETTINGS_DEFAULTS_REV, old)))).toEqual(old);
    // A moved file saved back holds the new numbers at the new revision, and a later choice of an old number stays across a save and a load.
    const rig = new Rig({ shipped: true });
    stored(rig, holding(10, old));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { story: { limits: { beatsRead: 40 } } } }));
    const file = saved(rig);
    expect([at(file, "defaults"), at(file, "narration", "passageChars"), at(file, "story", "limits", "beatsRead"), at(file, "agents", "clipChars")]).toEqual([SETTINGS_DEFAULTS_REV, 24_000, 40, 8000]);
    if (!isRecord(file)) throw new Error("no settings file was written");
    const again = new Rig({ shipped: true });
    stored(again, file);
    expect(sizes(await again.rt.settings.get(again.host.userId))).toEqual([24_000, 40, 24, 8000]);
  });

  test("an older file that still holds the world tools' two unread limits loads, keeping its time a call passes, and is written without them", async () => {
    const rig = new Rig({ shipped: true });
    stored(rig, { defaults: 9, agents: { harnessLimits: { timePassMinutes: 60, worldExamples: 5, worldTextChars: 100 } } });
    expect((await rig.rt.settings.get(rig.host.userId)).agents.harnessLimits).toEqual({ timePassMinutes: 60 });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harnessLimits: { timePassMinutes: 90 } } } }));
    expect(at(saved(rig), "agents", "harnessLimits")).toEqual({ timePassMinutes: 90 });
  });
});

const person = (id: string, name: string): JsonObject => ({ id, kind: "character", name, tier: "background", fields: { place: HOME }, relations: [] });

/** The author's env on a Port Alder chat whose story record is the real one, under `limits` over the shipped ones. */
async function authorEnv(limits: Partial<UserSettings["story"]["limits"]>): Promise<ToolEnv> {
  const { rig, chatId } = await alderChat({ put: { entities: { mara: person("mara", "Mara"), joss: person("joss", "Joss") } } });
  const settings = await rig.rt.settings.get(rig.host.userId);
  const base = { ...toolEnv(rig, chatId, "gm"), marks: true };
  const { state } = await base.reader.view();
  const turn: HarnessTurn = {
    main: true,
    directed: false,
    grant: () => false,
    knowing: false,
    settings: { ...settings, story: { ...settings.story, limits: { ...settings.story.limits, ...limits } } },
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
  return { ...base, agent: { role: HARNESS_AGENT.author, id: "agent_author" }, turn };
}

async function refusal(env: ToolEnv, name: string, args: JsonObject): Promise<string> {
  const out = await runHarnessTool(env, name, args);
  if (!out.error) throw new Error(`${name} answered: ${out.text}`);
  return out.text;
}

const BEAT = { by: "mara", kind: "say", what: "Mara asks after the key.", surface: "Mara asks where the key went.", exposure: [{ who: "joss", reach: "whole" }] } satisfies JsonObject;

describe("a refusal that comes from a limit names its row", () => {
  test("the story record's tools name the row of the limit each refusal comes from", async () => {
    const author = await authorEnv({ quoteChars: 20, quotes: 1, people: 1, beatsPerTurn: 1, draftsPerTurn: 1 });
    expect(await refusal(author, RECORD_TOOL.beatWrite, { ...BEAT, quotes: ["Where is the key, Joss?"] })).toContain(STORY_LIMIT_LABELS.quoteChars);
    expect(await refusal(author, RECORD_TOOL.beatWrite, { ...BEAT, quotes: ["Key?", "Now."] })).toContain(STORY_LIMIT_LABELS.quotes);
    expect(await refusal(author, RECORD_TOOL.beatWrite, { ...BEAT, exposure: [{ who: "joss", reach: "whole" }, { who: "player", reach: "whole" }] })).toContain(STORY_LIMIT_LABELS.people);
    const written = await runHarnessTool(author, RECORD_TOOL.beatWrite, BEAT);
    expect(written.error).toBeFalsy();
    expect(await refusal(author, RECORD_TOOL.beatWrite, { ...BEAT, what: "Mara asks again." })).toContain(STORY_LIMIT_LABELS.beatsPerTurn);
    const now = String(at(JSON.parse((await runHarnessTool(author, RECORD_TOOL.beatsRead, {})).text), "now"));
    const opened = await runHarnessTool(author, RECORD_TOOL.draftOpen, { what: "The guild robs the docks.", tier: 4, who: ["joss"], when: now });
    expect(opened.error).toBeFalsy();
    expect(await refusal(author, RECORD_TOOL.draftOpen, { what: "Joss leaves town.", tier: 4, who: ["joss"], when: now })).toContain(STORY_LIMIT_LABELS.draftsPerTurn);
    const id = String(at(JSON.parse(opened.text), "opened", "id"));
    expect(await refusal(author, RECORD_TOOL.draftDrop, { draft: id, why: "x".repeat(STORY_DEFAULTS.limits.whyChars + 1) })).toContain(STORY_LIMIT_LABELS.whyChars);
  });

  test("each check of a beat, a draft and a reason carries the row of the limit it comes from", () => {
    const limits = { ...STORY_DEFAULTS.limits, beatChars: 40, draftChars: 40, people: 1 };
    const beat: Beat = { id: "b1", turn: "t1", at: 0, where: null, by: "mara", kind: "say", what: "Mara asks.", surface: "Mara asks.", exposure: [], decidedBy: { agent: HARNESS_AGENT.author } };
    const draft: Draft = { id: "d1", what: "The guild robs the docks.", tier: 4, who: ["joss"], when: 0, basis: { messageId: "m1", swipeId: 0 }, state: "open" };
    expect(beatProblem({ ...beat, what: "x".repeat(41) }, limits)?.vars.row).toBe(STORY_LIMIT_LABELS.beatChars);
    expect(beatProblem({ ...beat, to: ["joss", "ilse"] }, limits)?.vars.row).toBe(STORY_LIMIT_LABELS.people);
    expect(draftProblem({ ...draft, notes: "x".repeat(41) }, limits)?.vars.row).toBe(STORY_LIMIT_LABELS.draftChars);
    expect(lengthProblem("why", "x".repeat(STORY_DEFAULTS.limits.whyChars + 1), STORY_DEFAULTS.limits, "whyChars")?.vars.row).toBe(STORY_LIMIT_LABELS.whyChars);
    // And the record's refusals say it, as their texts ship.
    for (const id of [RECORD_NOTE.long, RECORD_NOTE.many, RECORD_NOTE.full]) expect(renderPrompt(id, {}, { field: "what", size: "9", count: "9", max: "8", what: "beats", row: STORY_LIMIT_LABELS.beatChars })).toContain(STORY_LIMIT_LABELS.beatChars);
  });

  test("mind_write's refusals name the mind file's row, and the prepared start's name theirs", () => {
    for (const id of [MINDS_NOTE.fileLong, MINDS_NOTE.appendLong]) expect(renderPrompt(id, {}, { file: "now.md", size: "9", max: "8", row: MIND_FILE_TITLES.now })).toContain(MIND_FILE_TITLES.now);
    const vars = { field: "about", size: "9", max: "8", most: "3", count: "4", stretch: "s1", span: "#1 to #9", reliving: "Mara", estimate: "1", ceiling: "1", from: "1", to: "9" };
    const rows: [string, string][] = [
      [PREPARE_NOTE.long, PREPARE_LABELS.textChars],
      [PREPARE_NOTE.split, PREPARE_LABELS.stretchMessages],
      [PREPARE_NOTE.tooLong, PREPARE_LABELS.stretchMessages],
      [PREPARE_NOTE.crowd, PREPARE_LABELS.reliveAtOnce],
      [PREPARE_NOTE.atOnce, PREPARE_LABELS.reliveAtOnce],
      [PREPARE_NOTE.beatsFull, PREPARE_LABELS.beatsPerStretch],
      [PREPARE_NOTE.waits, PREPARE_LABELS.askAboveTokens],
      [PREPARE_NOTE.surveyOrder, PREPARE_LABELS.surveyChars],
      [PREPARE_NOTE.outlineLong, MIND_FILE_TITLES.outline],
    ];
    for (const [id, label] of rows) expect([id, renderPrompt(id, {}, vars).includes(label)]).toEqual([id, true]);
  });

  test("a player's own wording, saved before it named its row or its setting, is kept and sent as theirs", async () => {
    const own = {
      [RECORD_NOTE.long]: "{{field}} runs {{size}} of {{max}}. Shorter, please.",
      [MINDS_NOTE.fileLong]: "{{file}} runs {{size}} of {{max}}. Shorter, please.",
      [RECORD_NOTE.feedMore]: "{{more}} more wait. Read on with after set to last.",
    };
    const settings = await readStored({ defaults: SETTINGS_DEFAULTS_REV, prompts: { texts: own } });
    expect(settings.prompts.texts).toEqual(own);
    expect(renderPrompt(RECORD_NOTE.long, settings.prompts.texts, { field: "what", size: "9", max: "8", row: STORY_LIMIT_LABELS.beatChars })).toBe("what runs 9 of 8. Shorter, please.");
    expect(renderPrompt(MINDS_NOTE.fileLong, settings.prompts.texts, { file: "now.md", size: "9", max: "8", row: MIND_FILE_TITLES.now })).toBe("now.md runs 9 of 8. Shorter, please.");
    expect(renderPrompt(RECORD_NOTE.feedMore, settings.prompts.texts, { more: "3", setting: STORY_LIMIT_LABELS.feedItems, most: "24" })).toBe("3 more wait. Read on with after set to last.");
  });
});

describe("a cut at Engine answers shown whole names that setting", () => {
  test("the world tools' outlines and cut lists, and the agents engine's clipped result, name it and where it is changed, and a player's own wording of them from before is kept", async () => {
    const vars = { pointer: "/entities", count: "4", after: "mara", list: "Mara, Joss", shown: "10", total: "20", handle: "s1" };
    for (const id of [WORLD_NOTE.outline, WORLD_NOTE.outlineCut, WORLD_NOTE.andMore, WORLD_NOTE.more, BUILD_NOTE.moreIds, RUNTIME_TEXT.clipped]) {
      const shipped = renderPrompt(id, {}, vars);
      expect([id, shipped.includes(LOOP_DEFS.clipChars.label), shipped.includes("Settings → Agents → Budgets")]).toEqual([id, true, true]);
    }
    const own = { [WORLD_NOTE.andMore]: "{{list}} and {{count}} others", [RUNTIME_TEXT.clipped]: "[Cut at {{shown}}; the rest is in {{handle}}.]" };
    expect((await readStored({ defaults: SETTINGS_DEFAULTS_REV, prompts: { texts: own } })).prompts.texts).toEqual(own);
  });
});


