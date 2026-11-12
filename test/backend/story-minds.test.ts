// Minds on the story engine (DEPTH2-PLAN §4, §5): a mind's files reach only whom they may, who the
// caller is comes from the call's `as` and never from an argument, only a principal is run as a
// character, and the model ladder picks most specific first. Each tool is called as the bridge calls
// it (`runHarnessTool`), on a real chat, with the workspace and the story record kept in memory.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { mindPath } from "../../src/backend/story/minds";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import type { Beat, RecStory } from "../../src/shared/ledger";
import { STORY_DEFAULTS, storySettingsOf } from "../../src/shared/settings";
import { characterRun, chooseAgentModel } from "../../src/shared/story-models";
import { stateOf } from "../support/mind-chat";
import { POV } from "../support/tools";
import { answer, call, castChat, castEnv, castTurn, ILSE, JOSS, MARA, memoryFiles, memoryStory, noModelCalls, OKORO, refusal, type TurnSetup } from "./harness-cast-kit";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** Mara and Joss are principals, Ilse a supporting character; Okoro was never cast, so an extra. */
const CAST: RecStory = { cast: [{ entity: MARA, standing: "principal" }, { entity: JOSS, standing: "principal" }, { entity: ILSE, standing: "supporting" }] };

const beat = (id: string, at: number): Beat => ({ id, turn: "t-1", at, where: null, by: JOSS, kind: "say", what: `Joss says ${id}.`, surface: `Joss says ${id}.`, exposure: [{ who: MARA, reach: "whole" }], decidedBy: { agent: HARNESS_AGENT.character, as: JOSS } });

/** A run after the reply (a digest) on a Port Alder chat with `CAST` (and `held`) on its story's path, one workspace for every call, and the env of a call by an agent of `role` started as `as`. Inside a turn a character writes no mind (`story-minds-turn.test.ts`). */
async function minds(setup: TurnSetup = {}, held: RecStory = CAST) {
  const { rig, chatId } = await castChat();
  const story = memoryStory(held, false);
  const turn = await castTurn(rig, chatId, { main: false, story, ...setup });
  const files = memoryFiles();
  const env = (as?: string, role: string = HARNESS_AGENT.character) => ({ ...castEnv(rig, chatId, turn, role, null, as), files });
  return { rig, chatId, turn, story, files, env };
}

describe("a character's own mind", () => {
  test("it reads and writes its own mind alone: naming anyone else is refused, never followed, and core.md and outline.md are never its to write", async () => {
    const { rig, files, env } = await minds();
    const mara = env(MARA);
    expect(await answer(mara, "mind_write", { file: "now.md", text: "Joss owes the rent. I won't ask today." })).toMatchObject({ written: { file: "now.md" } });
    // Her mind is prose she reads as it is: who she is, then each file with its version.
    const own = await call(mara, "mind_read");
    expect([own.error, own.text.startsWith(note(MINDS_NOTE.readHead, { name: "Mara", standing: note(MINDS_NOTE.standingPrincipal) }))]).toEqual([undefined, true]);
    expect(own.text).toContain("Joss owes the rent. I won't ask today.");
    expect(await refusal(mara, "mind_read", { who: "Joss" })).toBe(note(MINDS_NOTE.otherMind, { self: "Mara", other: "Joss" }));
    // Who the call says it is never moves whose mind it reaches: Mara's agent can't write Joss's.
    expect(await refusal(mara, "mind_write", { who: "Joss", file: "now.md", text: "I am Joss now." })).toBe(note(MINDS_NOTE.otherMind, { self: "Mara", other: "Joss" }));
    expect(files.files.has(mindPath(JOSS, "now"))).toBe(false);
    expect(await refusal(mara, "mind_write", { file: "core.md", text: "I am someone else at heart." })).toBe(note(MINDS_NOTE.coreNotYours));
    expect(await refusal(mara, "mind_write", { file: "outline.md", text: "A past I chose." })).toBe(note(MINDS_NOTE.outlineWritten));
    expect(files.files.has(mindPath(MARA, "core"))).toBe(false);
    // Joss reads his own mind, which holds nothing of Mara's.
    expect((await call(env(JOSS), "mind_read")).text).not.toContain("owes the rent");
    noModelCalls(rig);
  });

  test("who the caller is comes from the call's as: no one, an extra, a supporting character, no person, and the player's character out of Sovereign Hand are refused", async () => {
    const { rig, chatId, env } = await minds();
    expect(await refusal(env(undefined), "mind_read")).toBe(note(MINDS_NOTE.noOne, { tool: "mind_read" }));
    expect(await refusal(env(OKORO), "mind_read")).toBe(note(MINDS_NOTE.notPrincipal, { name: "Okoro", standing: note(MINDS_NOTE.standingExtra) }));
    expect(await refusal(env(ILSE), "mind_write", { file: "now.md", text: "Me." })).toBe(note(MINDS_NOTE.notPrincipal, { name: "Ilse", standing: note(MINDS_NOTE.standingSupporting) }));
    expect(await refusal(env("nobody-at-all"), "mind_read")).toBe(note(MINDS_NOTE.noPerson, { as: "nobody-at-all" }));
    const pov = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";
    expect(await refusal(env("player"), "mind_read")).toBe(note(MINDS_NOTE.playerNoMind, { name: pov }));
    expect(await refusal(env(POV), "mind_digested", { to: "b1" })).toBe(note(MINDS_NOTE.playerNoMind, { name: pov }));
    // Under Sovereign Hand the player's character has a mind of their own, by the player's switch.
    const directed = await minds({ directed: true });
    expect(await answer(directed.env("player"), "mind_write", { file: "now.md", text: "I wait for the kettle." })).toMatchObject({ written: { file: "now.md" } });
    expect(directed.files.files.has(mindPath(POV, "now"))).toBe(true);
    const settings = directed.turn.settings;
    const off = await minds({ directed: true, settings: { ...settings, story: { ...settings.story, minds: { ...settings.story.minds, playerMind: false } } } });
    expect(await refusal(off.env("player"), "mind_read")).toBe(note(MINDS_NOTE.playerNoMind, { name: pov }));
    // A tool of a character's own is no one else's.
    expect(await refusal(env(MARA, HARNESS_AGENT.author), "mind_digested", { to: "b1" })).toBe(note(MINDS_NOTE.onlyCharacter, { tool: "mind_digested" }));
    expect(await refusal(env(undefined, "narrator"), "mind_read", { who: "Mara" })).toBe(note(MINDS_NOTE.notYours, { tool: "mind_read" }));
    noModelCalls(rig);
  });

  test("the author writes who a principal is and a supporting character's profile, and nothing of a mind's own; the game master reads and writes none", async () => {
    const { rig, files, env } = await minds();
    const author = env(undefined, HARNESS_AGENT.author);
    expect(await answer(author, "mind_write", { who: "Mara", file: "core.md", text: "Mara keeps the café on the quay." })).toMatchObject({ written: { file: "core.md" } });
    expect(await refusal(author, "mind_write", { who: "Mara", file: "beliefs.md", text: "She trusts Joss." })).toBe(note(MINDS_NOTE.charactersOwn, { file: "beliefs.md", name: "Mara" }));
    expect(await refusal(author, "mind_write", { who: "Ilse", file: "core.md", text: "Ilse." })).toBe(note(MINDS_NOTE.coreForPrincipal, { name: "Ilse", standing: note(MINDS_NOTE.standingSupporting) }));
    expect(await answer(author, "mind_write", { who: "Ilse", file: "profile.md", text: "Ilse sells nets." })).toMatchObject({ written: { file: "profile.md" } });
    expect(await refusal(author, "mind_write", { who: "Mara", file: "profile.md", text: "Mara." })).toBe(note(MINDS_NOTE.profileForSupporting, { name: "Mara", standing: note(MINDS_NOTE.standingPrincipal) }));
    expect(files.files.has(mindPath(MARA, "beliefs"))).toBe(false);
    const gm = env(undefined, HARNESS_AGENT.gm);
    expect(await refusal(gm, "mind_write", { who: "Mara", file: "core.md", text: "Changed." })).toBe(note(MINDS_NOTE.gmReadsOnly));
    expect((await call(gm, "mind_read", { who: "Mara" })).text).toContain("Mara keeps the café on the quay.");
    expect((await call(env(MARA), "mind_read")).text).toContain("Mara keeps the café on the quay.");
    expect(await refusal(author, "mind_read", { who: "Okoro" })).toBe(note(MINDS_NOTE.extraNoMind, { name: "Okoro" }));
    noModelCalls(rig);
  });

  test("a file holds no more than the player set: past it, whole or added to, nothing is written", async () => {
    const base = await minds();
    const settings = base.turn.settings;
    const { files, env } = await minds({ settings: { ...settings, story: { ...settings.story, minds: { ...settings.story.minds, chars: { ...settings.story.minds.chars, now: 200 } } } } });
    const mara = env(MARA);
    expect(await refusal(mara, "mind_write", { file: "now.md", text: "x".repeat(201) })).toBe(note(MINDS_NOTE.fileLong, { file: "now.md", size: "201", max: "200" }));
    await answer(mara, "mind_write", { file: "now.md", text: "a".repeat(150) });
    expect(await refusal(mara, "mind_write", { file: "now.md", text: "b".repeat(60), append: true })).toBe(note(MINDS_NOTE.appendLong, { file: "now.md", size: "212", max: "200" }));
    await answer(mara, "mind_write", { file: "now.md", text: "b".repeat(10), append: true });
    expect(files.files.get(mindPath(MARA, "now"))?.text).toBe(`${"a".repeat(150)}\n\n${"b".repeat(10)}`);
  });

  test("mind_digested marks the feed up to a beat on the story's path, and never back", async () => {
    const { rig, story, env } = await minds({}, { ...CAST, beats: [beat("b1", 10), beat("b2", 20)] });
    const mara = env(MARA);
    expect(await refusal(mara, "mind_digested", { to: "b9" })).toBe(note(MINDS_NOTE.toUnknown, { to: "b9" }));
    expect(await answer(mara, "mind_digested", { to: "b2" })).toEqual({ digested: { to: "b2" }, note: note(MINDS_NOTE.digested) });
    expect(story.written.cast).toEqual([{ entity: MARA, standing: "principal", digestedTo: "b2" }]);
    expect(await refusal(mara, "mind_digested", { to: "b1" })).toBe(note(MINDS_NOTE.toDone, { to: "b1" }));
    noModelCalls(rig);
  });
});

describe("the model ladder", () => {
  const settings = {
    story: storySettingsOf({
      models: {
        default: { connectionId: "c-default", model: "m-default", effort: "low" },
        agents: { character: { model: "m-character" }, author: { effort: "high" } },
        standings: { job: { connectionId: "c-job" } },
        runs: { digest: { effort: "minimal" }, nonsense: { effort: "max" } },
        characters: { mara: { model: "m-mara", effort: "not-an-effort" } },
      },
    }),
  };

  test("each of connection, model and effort is picked most specific first: the character, the kind of run, the standing, the agent, the default", () => {
    const digest = { basis: "turn-1", due: "next_turn" };
    expect(chooseAgentModel(settings, { definition: "character", as: "mara", standing: "job", job: digest })).toEqual({ connectionId: "c-job", model: "m-mara", effort: "minimal" });
    expect(chooseAgentModel(settings, { definition: "character", as: "joss", standing: "job", job: digest })).toEqual({ connectionId: "c-job", model: "m-character", effort: "minimal" });
    expect(chooseAgentModel(settings, { definition: "character", as: "joss", standing: "sub", job: null })).toEqual({ connectionId: "c-default", model: "m-character", effort: "low" });
    expect(chooseAgentModel(settings, { definition: "author", as: null, standing: "turn", job: null })).toEqual({ connectionId: "c-default", model: "m-default", effort: "high" });
    // Only a character's agent has a person of its own: an author run `as` someone takes nothing of theirs.
    expect(chooseAgentModel(settings, { definition: "author", as: "mara", standing: "turn", job: null })).toEqual({ connectionId: "c-default", model: "m-default", effort: "high" });
    // Nothing picked: the agent runs on its own.
    expect(chooseAgentModel({ story: STORY_DEFAULTS }, { definition: "character", as: "mara", standing: "sub", job: null })).toBeNull();
    // What the ladder can't take is left out: a kind of run there is none of, an effort that isn't one.
    expect([settings.story.models.runs, settings.story.models.characters]).toEqual([{ digest: { effort: "minimal" } }, { mara: { model: "m-mara" } }]);
  });

  test("a character's kind of run is read from how it was started, never from its task", () => {
    expect(characterRun({ definition: "character", as: "mara", standing: "sub", job: null })).toBe("scene");
    expect(characterRun({ definition: "character", as: "mara", standing: "job", job: { basis: "turn-1", due: "next_turn" } })).toBe("digest");
    expect(characterRun({ definition: "character", as: "mara", standing: "job", job: { basis: "turn-1" } })).toBe("prepare");
    expect(characterRun({ definition: "character", as: "mara", standing: "job", job: { basis: null } })).toBe("relive");
    expect(characterRun({ definition: "author", as: null, standing: "job", job: { basis: null } })).toBeNull();
  });
});
