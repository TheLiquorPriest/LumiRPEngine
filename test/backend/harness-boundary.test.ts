// What LumiAH is told and given at the boundary (HARNESS-SLICE3: "Boundary with LumiAH"). LumiAH's
// backend serves every user of a Lumiverse, so each member of the extension surface names the user
// it asks for, and the engine answers for that user alone.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT, HARNESS_TEXT } from "../../src/shared/harness-texts";
import { harnessChat, noModelCalls, toolsOf } from "./harness-driver";

const AUTHOR_NAME = HARNESS_TEXT.agent(HARNESS_AGENT.author, "name");

describe("what LumiAH is told and given", () => {
  test("the definitions are the asked user's own; a call that names no user, or another user, is given the shipped ones", async () => {
    const { rig, chatId } = await harnessChat();
    const mine = rig.host.userId;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [AUTHOR_NAME]: "Storyteller" } } } }));
    const nameFor = async (userId: string, about: string | null): Promise<string | undefined> => (await rig.rt.harness.extension.definitions?.({ userId, chatId: about }))?.agents?.find((a) => a.id === HARNESS_AGENT.author)?.name;
    const shipped = renderPrompt(AUTHOR_NAME, {}, {});
    expect(shipped).not.toBe("Storyteller");
    expect(await nameFor(mine, chatId)).toBe("Storyteller");
    expect(await nameFor(mine, null)).toBe("Storyteller");
    // No turn of this user's ran in between, and none is needed: the user is told, never the last one seen.
    expect(await nameFor("someone-else", null)).toBe(shipped);
    expect(await nameFor("", null)).toBe(shipped);
    // The tools are listed for the user the caller names, and for the chat's own where it names none.
    const told = (await rig.rt.harness.tools.list(chatId, mine)).map((t) => t.name);
    expect(told).toContain("commit");
    expect(told).toEqual((await toolsOf(rig, chatId)).map((t) => t.name));
    noModelCalls(rig);
  });
});
