// A chat on depth retires the classic steps its scene takes over (DEPTH-PLAN §9.2 A2): its turn asks
// no mind before the plan and no memory or knowledge step after the reply, and a Re-read of a reply
// asks neither; the same chat played before it went on depth asked them all.

import { describe, expect, test } from "bun:test";
import { alderChat, DANNY, fakeModels, PRIYA } from "../support/mind-chat";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

const MIND = "You are the private mind of";
const MEMORY = "You keep the memory of";
const KNOWLEDGE = "You keep track of who knows what";

describe("a chat on depth", () => {
  test("asks no classic mind, memory or knowledge step, on a turn or a Re-read; before it went on depth, the same chat asked them", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const asked = (): Record<"minds" | "memories" | "knowledge", number> => {
      const count = (mark: string): number => rig.host.quietCalls.filter((c) => c.messages.some((m) => m.content.includes(mark))).length;
      return { minds: count(MIND), memories: count(MEMORY), knowledge: count(KNOWLEDGE) };
    };
    await rig.turn(chatId, "Morning, Danny.", "Danny looks up from the bench and nods.");
    const classic = asked();
    expect(classic.minds).toBeGreaterThan(0);
    expect(classic.memories).toBeGreaterThan(0);
    expect(classic.knowledge).toBeGreaterThan(0);

    await readyLoopback(rig);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    await rig.turn(chatId, "I ask Priya how her morning is going.", "Priya says it has been slow, and laughs.");
    expect(asked()).toEqual(classic);
    // On depth nothing reads a reply into canon: a Re-read edit is refused, and asks nothing.
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.host.editMessage(chatId, reply.id, "Priya says it has been slow, and hands Danny a coffee.");
    await rig.host.settle();
    const reread = await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:${reply.swipeId}`, choice: "reread" });
    expect(reread.type).toBe("lre.error");
    expect(asked()).toEqual(classic);
  });
});
