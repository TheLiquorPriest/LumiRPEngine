// What the turn lane does with an edit, a hidden mark and a fork Lumiverse tells between turns (plan §4.2, §6.3, R-21): the mark is
// kept at once; an edit of the swipe a turn was played on is kept as that turn's edit, but not while a generation runs in the chat,
// where the writes are Lumiverse's own; a fork of a chat the store holds is made a branch when it is heard, and one of a chat it never
// saw is left to the branch's first turn. Each is told to the lane as the door hands it on (`ChatChange`), on a chat played through
// the stand-in Lumiverse. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { messageFrom } from "../../src/adapter/lumiverse/rows";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat has one turn played and tied: the reply's message and the player's. */
async function played(): Promise<{ b: TurnBed; reply: string; said: string }> {
  const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);
  const said = String(b.db.rows("SELECT id FROM messages WHERE chat_id = ? AND is_user = 1 ORDER BY index_in_chat DESC LIMIT 1", CHAT)[0]!.id);
  return { b, reply: out.messageId!, said };
}

const EDITED = "e".repeat(64);

test("a hide is kept; an edit of the reply is kept outside a generation, and only its mark while one runs in the chat", async () => {
  const { b, reply, said } = await played();
  const store = b.turns.store.user(USER);
  const shown = messageFrom(b.db.rows("SELECT * FROM messages WHERE id = ?", reply)[0]!).shown;
  // How many marks and edits the store has heard, once what the lane handed the write queue is written.
  const count = async (): Promise<number> => {
    await b.turns.lane.settled();
    return store.heardCount(CHAT);
  };
  const at = await count();

  b.turns.lane.changed({ kind: "message-edited", chat: CHAT, message: said, hidden: true, shown: messageFrom(b.db.rows("SELECT * FROM messages WHERE id = ?", said)[0]!).shown });
  expect(await count()).toBe(at + 1);

  // While a generation runs in the chat, Lumiverse's own write to the reply passes its mark only.
  b.turns.lane.changed({ kind: "generation-started", chat: CHAT, generation: "gen-other" });
  b.turns.lane.changed({ kind: "message-edited", chat: CHAT, message: reply, hidden: false, shown: { date: shown.date, hash: EDITED } });
  expect(await count()).toBe(at + 2);

  // Once it has ended, his edit of the reply is kept as its turn's edit, beside its mark.
  b.turns.lane.changed({ kind: "generation-ended", chat: CHAT, generation: "gen-other", message: null });
  b.turns.lane.changed({ kind: "message-edited", chat: CHAT, message: reply, hidden: false, shown: { date: shown.date, hash: EDITED } });
  expect(await count()).toBe(at + 4);

  // A swipe flipped makes no call; his edit of the swipe that shows, through the swipe route, is his edit: here back to its saved
  // text, which takes the edit back.
  b.turns.lane.changed({ kind: "message-swiped", chat: CHAT, message: reply, swipe: 0, shown });
  expect(await count()).toBe(at + 4);
  b.turns.lane.changed({ kind: "message-swiped", chat: CHAT, message: reply, swipe: 0, shown, updated: true });
  expect(await count()).toBe(at + 5);

  // An event socket that opened again may have missed a generation's end: what comes next is taken as heard outside one.
  b.turns.lane.changed({ kind: "generation-started", chat: CHAT, generation: "gen-lost" });
  b.turns.lane.reopened();
  b.turns.lane.changed({ kind: "message-edited", chat: CHAT, message: reply, hidden: false, shown: { date: shown.date, hash: EDITED } });
  expect(await count()).toBe(at + 7);
});

test("a fork of a chat the store holds is a branch once it is heard; a fork of a chat it never saw makes no call", async () => {
  const { b } = await played();
  const store = b.turns.store.user(USER);
  const ids = Object.fromEntries(b.db.rows("SELECT id FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT).map((r) => [String(r.id), `branch-${String(r.id)}`]));
  b.turns.lane.changed({ kind: "chat-forked", from: CHAT, chat: "chat-branch", ids });
  b.turns.lane.changed({ kind: "chat-forked", from: "chat-unseen", chat: "chat-unseen-branch", ids: {} });
  await b.turns.lane.settled();
  expect(store.chat("chat-branch")).toMatchObject({ id: "chat-branch", sourceChat: CHAT });
  expect(store.chat("chat-unseen-branch")).toBeNull();
});
