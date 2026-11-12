// A turn of a harness chat starts only once every agent of the engine's cast can use each tool it is
// given there (`HarnessEngine.refused`, from LumiAH's `agents.held`). With LumiAH's real backend
// mounted in the engine and its runtime linked (`support/runtime-bed.ts`): a tool a character needs,
// switched off on LumiAH's Tools page, stops the reply before anything is written, the chat says
// which agent, which tool and what to do, and the Engine page says the same while it lasts. Switched
// on again, the turn plays. A tool the engine's own claim withdraws in the chat is no fault.

import { afterEach, describe, expect, test } from "bun:test";
import { cast, offers } from "../support/lumiah-bed";
import type { RuntimeBed } from "../support/runtime-bed";
import { noModelCalls } from "./harness-driver";
import { release, say, worldChat } from "./harness-e2e-kit";

const beds: RuntimeBed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

/** What the chat says while a character's agent can't read what reached it. */
const FEED_OFF = "This chat plays no turn while one of LumiRPEngine's agents can't use a tool it needs. Character can't use feed_read: it is switched off. On the Tools page of the Harness tab, switch it on.";

describe("a turn waits on its agents' tools", () => {
  test("a tool a character needs, switched off, keeps the turn from starting, in words that name the agent, the tool and what to do; switched on again, the turn plays", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const blocked = async (): Promise<unknown> => rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked;
    // As shipped every agent can use each tool it is given: the author's lore family names LumiAH's own lore tools that the engine withdraws here, and that is no fault.
    expect(await blocked()).toBeUndefined();

    await bed.page("lah.def.switch", { kind: "tool", id: "feed_read", off: true });
    const stopped = await say(bed, rig, chatId, "I wait by the window.");
    expect([stopped.generation.halted, stopped.content]).toEqual(["cancelled", ""]);
    const chip = (await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.kind === "engine_failed");
    expect(chip?.detail).toContain(FEED_OFF);
    expect(await blocked()).toBe(FEED_OFF);
    expect(bed.calls).toEqual([]);

    await bed.page("lah.def.switch", { kind: "tool", id: "feed_read", off: false });
    expect(await blocked()).toBeUndefined();
    const play = cast({ name: "author", is: offers("reply_write"), lines: [release("The street below is quiet."), "Released."] });
    bed.script = play.script;
    const played = await bed.reply(chatId);
    expect([played.error, played.content]).toEqual([null, "The street below is quiet."]);
    expect(play.left("author")).toBe(0);
    noModelCalls(rig);
  });
});
