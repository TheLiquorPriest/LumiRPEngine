// Inside a turn (a scene or the direct line) a character's own run writes no file of its mind and
// marks nothing as taken in: that is the work of the run after the reply. A run after the reply
// writes and marks as before, and the author still writes who a principal is during a turn.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { mindPath } from "../../src/backend/story/minds";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import type { Beat, RecStory } from "../../src/shared/ledger";
import { answer, castChat, castEnv, castTurn, JOSS, MARA, memoryFiles, memoryStory, refusal } from "./harness-cast-kit";

const note = (id: string): string => renderPrompt(id, {}, {});

const HELLO: Beat = { id: "b1", turn: "t-1", at: 10, where: null, by: JOSS, kind: "say", what: "Joss says hello.", surface: "Joss says hello.", exposure: [{ who: MARA, reach: "whole" }], decidedBy: { agent: HARNESS_AGENT.character, as: JOSS } };
const HELD: RecStory = { beats: [HELLO], cast: [{ entity: MARA, standing: "principal" }, { entity: JOSS, standing: "principal" }] };

/** A run on a Port Alder chat with `HELD` on its story's path: inside a turn (`staged`, as a turn's own record is) or after the reply. */
async function runOf(staged: boolean) {
  const { rig, chatId } = await castChat();
  const story = { ...memoryStory(HELD), staged };
  const turn = await castTurn(rig, chatId, { main: false, story });
  const files = memoryFiles();
  const env = (role: string, as?: string) => ({ ...castEnv(rig, chatId, turn, role, null, as), files });
  return { files, env };
}

describe("a character's mind and the turn", () => {
  test("inside a turn a character neither writes its mind nor marks what reached it; after the reply it does; the author still writes who a principal is", async () => {
    const inTurn = await runOf(true);
    const mara = inTurn.env(HARNESS_AGENT.character, MARA);
    expect(await refusal(mara, "mind_write", { file: "now.md", text: "Joss said hello." })).toBe(note(MINDS_NOTE.afterReply));
    expect(await refusal(mara, "mind_digested", { to: "b1" })).toBe(note(MINDS_NOTE.afterReply));
    expect(inTurn.files.files.has(mindPath(MARA, "now"))).toBe(false);
    expect(await answer(inTurn.env(HARNESS_AGENT.author), "mind_write", { who: "Mara", file: "core.md", text: "Mara keeps the corner shop." })).toMatchObject({ written: { file: "core.md" } });

    const after = await runOf(false);
    const later = after.env(HARNESS_AGENT.character, MARA);
    expect(await answer(later, "mind_write", { file: "now.md", text: "Joss said hello." })).toMatchObject({ written: { file: "now.md" } });
    expect(await answer(later, "mind_digested", { to: "b1" })).toMatchObject({ digested: { to: "b1" } });
  });
});
