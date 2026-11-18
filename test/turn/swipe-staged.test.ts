// The empty swipe a swipe or a regenerate stages for its generation to write (plan §6.3, §10.10) is heard before Lumiverse tells
// the generation begun: Lumiverse adds the swipe, shown, then tears down the chat's background work, for up to two seconds, and only
// then announces the generation (`services/generate.service.ts:1699-1727`, `:2036-2055`). Played through the stand-in Lumiverse,
// with the chat's background work holding that teardown until RPE has done all it does on hearing the swipe: the staged swipe is
// never told as another swipe, and what RPE holds of the reply follows at once what a failed swipe left of it. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { ChatChange } from "../../src/adapter/lumiverse/events";
import type { RepliesReply } from "../../src/shared/api";
import type { JsonValue } from "../../src/shared/json";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose first turn has played: the bed, and that turn. */
async function played(answers: Parameters<typeof replying>[0][]) {
  const b = await openTurnBed({ answers: answers.map((a) => replying(a)) });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const first = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
  return { b, first };
}

/**
 * A swipe or a regenerate of the newest reply, its generation held after its swipe is staged until RPE has done all it does on hearing
 * the swipe: the changes RPE heard meanwhile, and the generation's id once it is over and RPE has recorded its end.
 */
async function staged(b: TurnBed, message: string, type: "swipe" | "regenerate") {
  const heard: ChatChange[] = [];
  const lane = b.turns.lane;
  const changed = lane.changed.bind(lane);
  lane.changed = (change) => {
    heard.push(change);
    changed(change);
  };
  const teardown = Promise.withResolvers<void>();
  b.host.background.set(CHAT, new Set([teardown.promise]));
  const going = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  await b.until("the staged swipe to be heard", () => heard.some((c) => c.kind === "message-swiped" && c.message === message));
  await lane.settled();
  const before = heard.some((c) => c.kind === "generation-started");
  teardown.resolve();
  const out = await going;
  await settledTurn(b, out.generationId!);
  await lane.settled();
  lane.changed = changed;
  return { before, out };
}

/** Sets a setting through the Settings page's route, as the player would: at the chat's own level, or for all his chats. */
async function set(b: TurnBed, key: string, value: JsonValue, level: "chat" | "global"): Promise<void> {
  const token = (await b.app.auth.mintPageToken(USER, "extension")).token;
  const res = await fetch(`${b.listening.url}/api/v1/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ level, key, value, ...(level === "chat" ? { chat: CHAT } : {}) }),
  });
  expect(res.status).toBe(200);
}

const lineOf = async (b: TurnBed, message: string) => (await b.page<RepliesReply>("GET", `/api/v1/chats/${CHAT}/replies?ids=${message}`)).body.replies;

for (const type of ["swipe", "regenerate"] as const) {
  test(`a ${type}'s own empty swipe, heard before its generation is told begun, is never told as another of the reply's swipes`, async () => {
    const { b, first } = await played(["The lamp turns.", "The lamp gutters."]);
    const { before, out } = await staged(b, first.message!, type);
    expect(before).toBe(false);
    expect(out.error).toBeNull();

    expect(b.requests[1]!.since.map((s) => s.kind)).not.toContain("swiped");
    expect(JSON.stringify(b.model.requests[1]!.messages)).not.toContain("now shows another of its swipes");
  });
}

test("a failed swipe taken away leaves RPE holding the reply as it shows again, its turn on the path and its line under it, as soon as the swipe's end is recorded", async () => {
  const { b, first } = await played(["The lamp turns."]);
  await set(b, "lumiverse.reply.removeEmpty", true, "global");
  await set(b, "limits.turn.calls", 0, "chat");
  await staged(b, first.message!, "swipe");

  const row = b.db.rows("SELECT swipes FROM messages WHERE id = ?", first.message!)[0]!;
  expect(JSON.parse(String(row.swipes))).toHaveLength(1);
  expect(b.turns.store.user(USER).line(CHAT).at(-1)?.turn).toBe(first.id);
  expect(await lineOf(b, first.message!)).toMatchObject([{ played: true, empty: false, turn: first.id }]);
});

test("a failed swipe's empty swipe that stays has its line at once, and the swipe after it is not told it as another swipe", async () => {
  const { b, first } = await played(["The lamp turns.", "The lamp gutters."]);
  await set(b, "limits.turn.calls", 0, "chat");
  await staged(b, first.message!, "swipe");

  expect(await lineOf(b, first.message!)).toMatchObject([{ played: false, empty: true, turn: null }]);
  await set(b, "limits.turn.calls", 50, "chat");
  const { out } = await staged(b, first.message!, "swipe");
  expect(out.error).toBeNull();
  expect(b.requests.at(-1)!.since.map((s) => s.kind)).not.toContain("swiped");
});
