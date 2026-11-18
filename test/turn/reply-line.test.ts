// The line under a reply (plan §14 l.1565, §10.10), read on its route as soon as the turn's end is recorded: a turn that reached a
// limit after its reply went out names that limit, and the empty reply a turn that failed before its first word left in the chat has
// its line. Played through the stand-in Lumiverse on the scripted model, on a chat that plays an invented world. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { RepliesReply } from "../../src/shared/api";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const lineOf = async (b: TurnBed, message: string) => (await b.page<RepliesReply>("GET", `/api/v1/chats/${CHAT}/replies?ids=${message}`)).body.replies;

test("a turn that reaches a limit after its reply went out names the limit and its value under the reply, in its run's record and in the log, from the run's end", async () => {
  // The one call the turn may make writes the reply and asks for a tool; the call after the tool's answer is past the limit.
  const b = await openTurnBed({
    global: "limits:\n  turn:\n    calls: 1\n",
    answers: [{ pieces: [{ text: "<intent>Half an hour at the lamp.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 30, source: { from: "prose" } }] } }] }],
  });
  beds.push(b);
  await playsWorld(b, world());
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);

  const why = "The turn reached your limit of 1 on calls after its reply began to go out, so its record of what the reply says was not finished.";
  expect((await lineOf(b, turn.message!)).map((l) => l.unfinished?.why)).toEqual([why]);
  expect(b.turns.runs.record(USER, turn.id)).toMatchObject({ status: "limit", error: { code: "limit", limit: { limit: "calls", per: "turn", max: 1 } } });
  expect(b.logged.filter((l) => l.fields?.turn === turn.id && l.level === "warn").map((l) => l.message)).toEqual([`A turn's run ended stopped where it stood: ${why}`]);
});

test("the empty reply a turn that failed before its first word left in the chat has its line as soon as the turn's end is recorded", async () => {
  const b = await openTurnBed({ global: "limits:\n  turn:\n    calls: 0\n", answers: [] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  const turn = await settledTurn(b, out.generationId!);
  await b.turns.lane.settled();
  expect(turn.status).toBe("dropped");

  const left = b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat DESC LIMIT 1", CHAT)[0]!;
  expect(left.content).toBe("");
  expect(await lineOf(b, String(left.id))).toMatchObject([{ message: left.id, played: false, empty: true, turn: null }]);
});
