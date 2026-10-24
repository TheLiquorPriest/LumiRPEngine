// A plan two people make together, as each one's memory of the turn records it (DESIGN §24.8): the
// first memory records it, everyone in it holds it under one id, and the second records no copy.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import type { LedgerEvent } from "../../src/shared/ledger";
import { MINDS_EVENTS } from "../../src/shared/minds";
import { readCharacter } from "../../src/packs/minds/core/state";
import { alderChat, DANNY, fakeModels, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

/** Every event the chat's head records: its turn's and those added after it. */
async function headEvents(rig: Rig, chatId: string): Promise<LedgerEvent[]> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const head = core.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).at(-1);
  const rec = head?.ledger?.swipes[String(head.swipeId)];
  return rec ? [...rec.events, ...rec.post.flatMap((p) => p.events)] : [];
}

describe("a plan made together, in two memories of one turn", () => {
  test("the first memory records it, both hold it under one id, and the second memory writes no copy", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    // Each memory takes the same dinner from the turn, from its own side and in its own words.
    fakeModels(rig, (name) => ({
      plans:
        name === "Danny Okafor"
          ? [{ what: "Dinner at the Anchor with Priya", kind: "meet", when: { from: "19:00", to: "20:30" }, where: "The Rusty Anchor", with: ["Priya Nair"], priority: 3 }]
          : [{ what: "Dinner with Danny", kind: "meet", when: { from: "19:00", to: "20:30" }, with: ["Danny Okafor"], priority: 3 }],
    }));
    const chatId = await alderChat(rig, async () => undefined, [DANNY, PRIYA]);
    await rig.turn(chatId, "So, dinner at seven, you two?", "Danny and Priya agree on dinner at the Anchor at seven.");
    const recorded = (await headEvents(rig, chatId)).flatMap((e) => (e.type === MINDS_EVENTS.memory && "data" in e && Array.isArray(e.data.plans) ? [e.data.plans.length] : []));
    expect(recorded.sort()).toEqual([0, 1]);
    const { state } = await stateOf(rig, chatId);
    const danny = readCharacter(state, DANNY).plans;
    const priya = readCharacter(state, PRIYA).plans;
    expect([danny.length, priya.length, danny[0]?.id === priya[0]?.id, danny[0]?.with, priya[0]?.with]).toEqual([1, 1, true, [PRIYA], [DANNY]]);
  });
});
