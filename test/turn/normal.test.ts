// One normal turn, end to end (plan §4.2, §10.1, §10.8): the player sends a message in the stand-in
// Lumiverse and asks for a reply on RPE's connection; the extension tags the request; RPE's provider
// endpoint takes it in against the turn tree; the shipped Author answers on a scripted model; the reply
// streams back and Lumiverse saves it as a message; the generation's end ties the turn to that message;
// and the Turn page's routes give the turn back. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { ChatsReply, TurnReply, TurnsReply } from "../../src/shared/api";
import { CHAT, CONNECTION, GREETING, openTurnBed, PRESET, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

const SENT = "I climb the stairs to the lamp room and ask whether the supply boat came.";
const INTENT = "Wants: news of the supply boat. Scope: one exchange. Story lane: the storm closes in. Engine lane: nothing changes.";
const REPLY = "Wren shakes her head without looking up from the brass. No boat, not in this sea.";

describe("one normal turn, end to end", () => {
  test("the player's message is answered by the shipped Author through RPE, saved by Lumiverse, tied to its turn, and shown by the Turn page", async () => {
    const b = await bed({ answers: [{ pieces: [{ text: `<intent>${INTENT}</intent>` }, { text: `<reply>${REPLY}</reply>` }], usage: { input: 900, output: 40 } }] });

    b.host.send(CHAT, SENT);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe(REPLY);

    // Lumiverse saved the reply in the message it staged for it.
    const rows = b.db.rows("SELECT id, is_user, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT);
    expect(rows.map((r) => [r.is_user, r.content])).toEqual([
      [0, GREETING],
      [1, SENT],
      [0, REPLY],
    ]);
    const message = String(rows[2]!.id);

    // The Author was asked once, holding the prompt Lumiverse assembled: the preset, the greeting and the player's message.
    expect(b.model.requests).toHaveLength(1);
    const asked = JSON.stringify(b.model.requests[0]!.messages);
    for (const text of ["You narrate a lighthouse on Gannet Rock", GREETING, SENT]) expect(asked).toContain(text);

    // The generation's end, heard on the event socket, tied the turn to the saved message by the hash of what was stored;
    // once the run is over, the turn holds what it spent.
    const store = b.turns.store.user(USER);
    const turnId = await b.until("the turn tied to the saved message", () => store.path(CHAT).find((e) => e.message === message)?.turn);
    expect(store.turn(turnId)).toMatchObject({ kind: "new", status: "done", message, generation: out.generationId!, hash: textHash(REPLY), intent: INTENT });
    await b.until("the turn's run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    await b.until("the turn's spending to be kept", () => store.turn(turnId)?.tokensIn !== null);
    expect(store.turn(turnId)).toMatchObject({ tokensIn: 900, tokensOut: 40 });

    // The Turn page: the chat with its name, its one turn on the path, and the turn with its intent, its reply and its trace.
    const chats = await b.page<ChatsReply>("GET", "/api/v1/chats");
    expect(chats.status).toBe(200);
    expect(chats.body.chats).toEqual([{ id: CHAT, name: "The lighthouse", lastTurnAt: expect.any(Number), running: false, played: true, world: false }]);
    const list = await b.page<TurnsReply>("GET", `/api/v1/chats/${CHAT}/turns`);
    expect(list.body.more).toBe(false);
    expect(list.body.turns).toHaveLength(1);
    expect(list.body.turns[0]).toMatchObject({ id: turnId, kind: "new", onPath: true, message, status: "released", usage: { calls: 1, input: 900, output: 40 } });
    const timings = list.body.turns[0]!.timings;
    for (const moment of [timings.started, timings.firstWord, timings.released, timings.ended]) expect(moment).toBeGreaterThanOrEqual(timings.received);
    const detail = await b.page<TurnReply>("GET", `/api/v1/chats/${CHAT}/turns/${turnId}`);
    expect(detail.body).toMatchObject({ id: turnId, chat: CHAT, intent: INTENT, reply: { text: REPLY }, error: null });
    expect(detail.body.trace.length).toBeGreaterThan(0);

    // Nothing failed on the way, and the extension, which has every permission it needs, is not said to be missing one.
    expect(b.logged.filter((l) => l.level === "error")).toEqual([]);
    expect(b.logged.filter((l) => l.message.includes("missing permissions"))).toEqual([]);
  });
});
