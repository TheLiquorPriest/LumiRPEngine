// On a chat on depth nothing reads a reply into canon (DEPTH-PLAN §1.3; conformance findings 1 and
// 12): a reply no scene played (here one generated off the loopback) commits unread, with no
// Extract, and says it isn't canon; an edit of it offers no Re-read edit, which is refused; the
// journal never reads a depth scene's record again; and the swipe chip says the author reads a
// swipe's word too. The same chat played before it went on depth read its reply as ever.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { keepsPassages } from "../../src/engine/ledger/journal";
import type { LedgerEvent } from "../../src/shared/ledger";
import { passageEvent } from "../../src/shared/passage";
import { alderChat, DANNY, fakeModels, PRIYA } from "../support/mind-chat";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

const EXTRACT = "propose concrete state changes";

describe("a chat on depth", () => {
  test("reads no reply into canon: a reply no scene played commits unread, without Extract, says it isn't canon, and offers no Re-read edit", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const reads = (): number => rig.host.quietCalls.filter((c) => c.messages.some((m) => m.content.includes(EXTRACT))).length;
    await rig.turn(chatId, "Morning, Danny.", "Danny looks up from the bench and nods.");
    const classic = reads();
    expect(classic).toBeGreaterThan(0);

    await readyLoopback(rig);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    // A swipe's word reaches the author on depth, and the chip on the reply at the head says so (finding 12).
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option")?.detail).toContain("so does the author");
    await rig.turn(chatId, "I ask Priya how her morning is going.", "Priya says it has been slow, and hands you a coffee.");
    expect(reads()).toBe(classic);
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const rec = core?.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).at(-1)?.ledger?.swipes[String(reply.swipeId)];
    expect(rec?.unread).toBe("reply");
    expect(rec?.events.length).toBe(rec?.pre);

    const shown = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(shown.find((c) => c.id === `not_canon:${reply.id}:${reply.swipeId}`)).toMatchObject({ kind: "untracked", label: "Not canon" });

    rig.host.editMessage(chatId, reply.id, "Priya says it has been slow, and hands Danny a coffee.");
    await rig.host.settle();
    await rig.rt.depthSettled();
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "reread" || c.kind === "retry_read")).toEqual([]);
    const refused = await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:${reply.swipeId}`, choice: "reread" });
    expect(refused.type).toBe("lre.error");
    expect(reads()).toBe(classic);
  });
});

describe("a depth scene's record", () => {
  test("keeps its prose: the journal refuses to read it again, in its read part or a Continue's", () => {
    const passage = passageEvent({ moment: 0, index: 0, beats: ["b1"], pov: "you", text: "a".repeat(64), drafts: [{ text: "a".repeat(64), faithful: true }] });
    const note: LedgerEvent = { type: "engine.note", data: {} };
    expect(keepsPassages({ pre: 1, events: [note, passage], post: [] })).toBe(true);
    expect(keepsPassages({ pre: 1, events: [note], post: [{ seq: 2, at: "", kind: "cont", events: [passage] }] })).toBe(true);
    // A passage among the planned events (a Re-narrate's copied pre) isn't the record's rendering; a classic record holds none.
    expect(keepsPassages({ pre: 2, events: [note, passage], post: [] })).toBe(false);
    expect(keepsPassages({ pre: 0, events: [note], post: [] })).toBe(false);
  });
});
