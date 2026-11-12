// The runtime's own copy of a chat the engine plays, proved against the link: every read the
// runtime's core makes of the chat is asked of both (`RuntimeDeps.reads` "both") and the two answers
// compared, while the chat plays two turns with the player's message edited and swiped between them,
// then a third once the player has deleted a swipe of a reply, which moves the reply's records in the
// engine's ledger with no write of the runtime's. The copy reads the chat over Lumiverse's routes,
// from the rows LumiAH's backend reads too (`support/lumiverse-rows.ts`); it takes LumiAH's records
// from the ledger through the mount (`ownElsewhere`), reads them again when they change, and never asks
// for a world book. With LumiAH's real backend and its runtime linked (`support/runtime-bed.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import type { ChatDataView } from "lumi-ah/shared";
import { recHarnessOf } from "../../src/backend/harness/record";
import { isRecord } from "../../src/shared/json";
import { ENGINE_EXTENSION } from "../../src/shared/protocol";
import { type Answer, cast, offers } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { runtimeBed } from "../support/runtime-bed";
import { noModelCalls, recordOn } from "./harness-driver";
import { alderWorld, calls, chatOn, guard, inRuntime, release, say } from "./harness-e2e-kit";

const opened: { close(): void }[] = [];
afterEach(() => {
  for (const one of opened.splice(0)) one.close();
});

/** The author's part in one turn: time passes, it commits, it releases `reply`. */
const author = (minutes: number, reply: string): Answer[] => [calls("time_pass", { minutes }), calls("commit"), release(reply), "Released."];

describe("the runtime's copy of a chat the engine plays", () => {
  test("answers every read as the link does, over two turns with the player's message edited and swiped between them and a third after a swipe of a reply is deleted: it reads the chat over Lumiverse's routes and LumiAH's records from the engine's ledger, reads them again when they change, and asks for no world book", async () => {
    const differences: string[] = [];
    const rig = new Rig({ shipped: true, minds: true });
    const bed = await runtimeBed(rig, { reads: { road: "both", differed: (what) => void differences.push(what) } });
    opened.push(bed);
    // The runtime's reads of a chat's records from the engine (`own.read`), in order, and what each was answered.
    const ownReads: { id: string; chat: unknown }[] = [];
    const deliver = bed.deliver;
    bed.deliver = (payload, session) => {
      if (isRecord(payload) && payload.type === "own.read") ownReads.push({ id: String(payload.id), chat: payload.chat });
      deliver(payload, session);
    };
    const entriesOf = (id: string): Record<string, unknown> => {
      const answer = bed.received.find((frame) => isRecord(frame) && frame.type === "result" && frame.id === id);
      return isRecord(answer) && isRecord(answer.body) && isRecord(answer.body.entries) ? answer.body.entries : {};
    };
    /** LumiAH's record of the turn the reply shows, from the engine's ledger, once it is there. */
    const recordOf = async (replyId: string, what: string): Promise<unknown> => {
      await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, what);
      return recHarnessOf(await recordOn(rig, chatId, replyId))?.record;
    };
    const chatId = await chatOn(rig, await alderWorld(rig));
    await bed.until(() => inRuntime(bed, chatId), "the chat set to play in the runtime");
    guard(rig);

    // The first turn.
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(5, "Five quiet minutes pass.") }).script;
    const first = await say(bed, rig, chatId, "I sit a while.");
    expect([first.error, first.content]).toEqual([null, "Five quiet minutes pass."]);
    const firstId = first.generation.messageId ?? "";
    const firstRecord = await recordOf(firstId, "the first turn's record in the ledger");
    // The entry LumiAH's own would be, which the engine keeps in its ledger: the message's own entry in Lumiverse is the engine's record, not this.
    const firstEntry = { v: 1, swipes: { [String(rig.host.message(chatId, firstId).swipeId)]: firstRecord } };
    expect(rig.host.message(chatId, firstId).bag[ENGINE_EXTENSION]).not.toEqual(firstEntry);

    // Between the turns, in Lumiverse: the player's message edited (the chat waits on Keep or Discard, and the player keeps it), then given another swipe, which it shows.
    const playerId = rig.host.chat(chatId).messages.findLast((m) => m.isUser)?.id ?? "";
    rig.host.editMessage(chatId, playerId, "I sit a long while.");
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.keep", chatId, choice: "keep", messageId: playerId }));
    rig.host.addSwipe(chatId, playerId, "I sit and watch the street.");
    await rig.host.settle();

    // The second turn, after the first's record is in the ledger; then its reply swiped, the swipe a turn of its own.
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(10, "The street lamps come on.") }).script;
    const second = await say(bed, rig, chatId, "I stand and stretch.");
    expect([second.error, second.content]).toEqual([null, "The street lamps come on."]);
    const secondId = second.generation.messageId ?? "";
    const told = await recordOf(secondId, "the second turn's record in the ledger");
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(10, "The street lamps flicker, then hold.") }).script;
    const swiped = await bed.reply(chatId, { type: "swipe" });
    expect([swiped.error, swiped.content]).toEqual([null, "The street lamps flicker, then hold."]);
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, secondId))?.record !== told, "the swipe's record in the ledger");
    const retold = recHarnessOf(await recordOn(rig, chatId, secondId))?.record;

    // The player deletes the reply's first telling: the ledger moves the swipe's record to the place it now has, with no write of the runtime's.
    rig.host.deleteSwipe(chatId, secondId, 0);
    await rig.host.settle();
    const deleted = ownReads.length;

    // The third turn reads the chat as it now stands.
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(15, "The harbor is dark and still.") }).script;
    const third = await say(bed, rig, chatId, "I walk down to the harbor.");
    expect([third.error, third.content]).toEqual([null, "The harbor is dark and still."]);
    await recordOf(third.generation.messageId ?? "", "the third turn's record in the ledger");

    // Every read was answered alike on both roads: the player's message as edited and swiped, each reply's records where the ledger has them.
    expect(differences).toEqual([]);

    // The copy answered every read itself: it read the chat whole once, as the runtime's user over Lumiverse's routes, and Lumiverse's events kept it current from then on (the edit, the swipes, the deleted swipe, every reply); no read went to the link instead, and no world book was asked for.
    const [relay] = await bed.backend.relays.linked(rig.host.userId);
    if (relay === undefined) throw new Error("no runtime linked");
    const { state } = await bed.page<{ state: ChatDataView }>("lah.runtime.chatdata", { relay: relay.id });
    expect([state.road, state.source]).toEqual(["copy", "http"]);
    expect(state.chats.map((c) => c.id)).toContain(chatId);
    expect(state.reads.filter((read) => read.id === chatId)).toHaveLength(1);
    expect(state.fallbacks.total).toBe(0);
    expect(bed.asked).toContain(`GET /api/v1/chats/${chatId}/messages?limit=1000&offset=0`);
    expect(bed.asked.filter((line) => line.includes("/world-books"))).toEqual([]);

    // The records came from the ledger, through the mount, and were read again once the deleted swipe moved them.
    const reread = ownReads.slice(deleted).find((read) => read.chat === chatId);
    const entries = reread === undefined ? {} : entriesOf(reread.id);
    expect([entries[firstId], entries[secondId]]).toEqual([firstEntry, { v: 1, swipes: { "0": retold } }]);
    noModelCalls(rig);
  });

  test("an edit discarded on the engine's page drops the records of the replies after it in the ledger, and the runtime's copy has the records as the ledger now has them at once: it is told, reads them again, and its next turn reads no record the ledger dropped", async () => {
    const differences: string[] = [];
    const rig = new Rig({ shipped: true, minds: true });
    const bed = await runtimeBed(rig, { reads: { road: "both", differed: (what) => void differences.push(what) } });
    opened.push(bed);
    const ownReads: { id: string; chat: unknown }[] = [];
    const deliver = bed.deliver;
    bed.deliver = (payload, session) => {
      if (isRecord(payload) && payload.type === "own.read") ownReads.push({ id: String(payload.id), chat: payload.chat });
      deliver(payload, session);
    };
    /** What the runtime was answered for one of its reads of a chat's records. */
    const answered = (id: string): Record<string, unknown> => {
      const answer = bed.received.find((frame) => isRecord(frame) && frame.type === "result" && frame.id === id);
      return isRecord(answer) && isRecord(answer.body) && isRecord(answer.body.entries) ? answer.body.entries : {};
    };
    const chatId = await chatOn(rig, await alderWorld(rig));
    await bed.until(() => inRuntime(bed, chatId), "the chat set to play in the runtime");
    guard(rig);
    /** How many times the backend told the runtime the chat's records changed. */
    const told = (): number => bed.received.filter((frame) => isRecord(frame) && frame.type === "own" && frame.chat === chatId).length;
    /** LumiAH's records as the engine's ledger holds them now, by reply. */
    const ledgerHolds = async (): Promise<Record<string, unknown>> => Object.fromEntries((await rig.rt.harness.anchors(chatId, rig.host.userId)).filter((row) => Object.keys(row.swipes).length > 0).map((row) => [row.messageId, { v: 1, swipes: row.swipes }]));

    // Two turns, each with LumiAH's record in the ledger, which the runtime's copy reads.
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(5, "Five quiet minutes pass.") }).script;
    const first = await say(bed, rig, chatId, "I sit a while.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, first.generation.messageId ?? ""))?.record !== undefined, "the first turn's record in the ledger");
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(10, "The street lamps come on.") }).script;
    const second = await say(bed, rig, chatId, "I stand and stretch.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, second.generation.messageId ?? ""))?.record !== undefined, "the second turn's record in the ledger");
    expect(Object.keys(await ledgerHolds()).sort()).toEqual([first.generation.messageId ?? "", second.generation.messageId ?? ""].sort());

    // The player edits the message the first reply answered, and discards on the engine's page what came after it: the ledger drops both turns' records.
    const playerId = rig.host.chat(chatId).messages.find((m) => m.isUser)?.id ?? "";
    rig.host.editMessage(chatId, playerId, "I sit a long while.");
    await rig.host.settle();
    const before = { told: told(), reads: ownReads.length };
    rig.body(await rig.send({ type: "lre.keep", chatId, choice: "discard", messageId: playerId }));
    await rig.host.settle();
    expect(await ledgerHolds()).toEqual({});
    // The runtime is told at once, not when what its copy keeps of the chat runs out.
    await bed.until(() => told() > before.told, "the runtime told the chat's records changed");

    // Its next turn reads the chat as the ledger has it: the records it reads are the ledger's, and both roads answer alike.
    bed.script = cast({ name: "author", is: offers("reply_write"), lines: author(15, "The harbor is dark and still.") }).script;
    const third = await say(bed, rig, chatId, "I walk down to the harbor.");
    expect([third.error, third.content]).toEqual([null, "The harbor is dark and still."]);
    const reread = ownReads.slice(before.reads).find((read) => read.chat === chatId);
    if (reread === undefined) throw new Error("the runtime's copy didn't read the chat's records again");
    const entries = answered(reread.id);
    expect([entries[first.generation.messageId ?? ""], entries[second.generation.messageId ?? ""]]).toEqual([undefined, undefined]);
    expect(differences).toEqual([]);
    noModelCalls(rig);
  });
});
