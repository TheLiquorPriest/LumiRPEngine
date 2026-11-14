// Settle now (plan §10.10 "Edit of a reply", §14 the Turn page): after an edit of a reply, the player
// asks from the Turn page for the newest turn to be settled at once. A run on that turn is told the edit
// and what was asked, in the words of the notices part, with no prompt; what it records is that turn's,
// so the world shows it at once; nothing of it is written into the chat; the rules that ask a turn for
// its reply and its record do not ask it; and the next turn is not told the edit again. It is refused in
// the words of the turn-errors part while a turn of the chat goes on, and where no turn is on the path.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { type Answer, gate } from "rp-harness/testing/rig";
import type { TurnList } from "../../src/ui/api";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** The Author's call that lets `minutes` pass in the world, with its intent record first where one is given. */
function passing(minutes: number, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call: "world_apply", args: { operations: [{ op: "pass_time", minutes, source: { from: "prose" } }] } }] };
}

/** The Turn page's Settle now: its status, and its answer. */
async function settle(b: TurnBed): Promise<{ status: number; body: { turn?: string; run?: string; error?: string } }> {
  return await b.page("POST", `/api/v1/chats/${CHAT}/settle`, {});
}

/** What the Author was sent in the model's `n`th request, as one text. */
const sent = (b: TurnBed, n: number): string => JSON.stringify(b.model.requests[n]?.messages ?? []);

test("Settle now runs on the newest turn after an edit: told the edit and the ask, with no prompt; what it records is that turn's at once; nothing reaches the chat; nothing more is asked of it", async () => {
  // Every shipped rule is on: the one that asks for a missing reply and the one that asks for an unrecorded turn among them.
  const b = await bed({
    off: [],
    answers: [
      passing(30, "Half an hour at the lamp."),
      replying("The lamp turns."),
      // The first Settle now: an hour passes, as the edited reply says; no reply.
      passing(60),
      { pieces: [{ text: "The hour is recorded." }] },
      // The second: nothing to record, and no reply.
      { pieces: [{ text: "Nothing more to settle." }] },
      // The next turn.
      passing(10, "Ten minutes more."),
      replying("Wren trims the wick."),
    ],
  });
  await playsWorld(b, world());
  const turn = await settledTurn(b, await play(b, "I climb the stairs."));
  const store = b.turns.store.user(USER);
  const clock = (): number => store.headState(CHAT).state.world.clock;
  const before = clock();
  b.host.editMessage(CHAT, turn.message!, "The lamp turns, and an hour slips by.");
  const chatBefore = b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY rowid", CHAT);

  const first = await settle(b);
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ turn: turn.id, run: expect.any(String) });
  await b.until("the Settle now run to end", () => b.turns.runs.ofChat(USER, CHAT).length === 0);

  // What the run was asked: no prompt, the turn's own session going on, no reply owed, the edit and the ask among what happened since.
  const asked = b.requests[1]!;
  expect(asked).toMatchObject({ kind: "continue", owesReply: false, prompt: [], parent: turn.parent, scope: { turn: turn.id, session: b.turns.runs.ofTurn(USER, turn.id)[0]!.session } });
  // Every turn a generation plays owes the player its reply.
  expect(b.requests[0]!.owesReply).toBeUndefined();
  expect(asked.since.map((s) => [s.kind, s.text])).toEqual([
    ["edit", `Message ${turn.message} was edited after its turn. Before: The lamp turns. Now: The lamp turns, and an hour slips by.`],
    ["request", "The player asked, from the Turn page, for this turn to be settled now against the chat as it reads. This run writes no reply, and nothing of it reaches the chat."],
  ]);
  expect(sent(b, 2)).toContain("The lamp turns, and an hour slips by.");
  // Its briefing's turn facts say what the run is; an ordinary turn's do not.
  expect(sent(b, 2)).toContain("- This run is a Settle now of the turn, which the player asked for from the Turn page. It writes no reply.");
  expect(sent(b, 0)).not.toContain("This run is a Settle now");
  // Its writes are the turn's: the world shows the hour at once.
  expect(clock()).toBe(before + 60);
  expect(store.changes(turn.id).filter((c) => c.lane === "engine")).toHaveLength(2);

  // A Settle now that records nothing is not asked for a record, nor for a reply.
  expect((await settle(b)).status).toBe(200);
  await b.until("the second Settle now run to end", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  expect(b.model.requests).toHaveLength(5);
  const runs = b.turns.runs.ofTurn(USER, turn.id);
  expect(runs.map((r) => [r.kind, r.status, r.released])).toEqual([
    ["new", "released", expect.any(Number)],
    ["settle", "no-reply", null],
    ["settle", "no-reply", null],
  ]);
  // Nothing of either reached the chat, and the Turn page lists the turn by its latest run.
  expect(b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY rowid", CHAT)).toEqual(chatBefore);
  expect((await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns.map((t) => [t.id, t.kind])).toEqual([[turn.id, "settle"]]);

  // The next turn is not told the edit again: the run on its turn was told it.
  const next = await settledTurn(b, await play(b, "I watch the sea."));
  expect(next.parent).toBe(turn.id);
  expect(b.requests[3]!.since.map((s) => s.kind)).not.toContain("edit");
});

test("Settle now is refused in the turn-errors part's words while a turn of the chat goes on, and where no turn is on the chat's path", async () => {
  const hold = gate();
  const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { hold }, { text: "<reply>The lamp turns.</reply>" }] }] });
  expect(await settle(b)).toEqual({ status: 409, body: { error: "No turn of RPE's is on this chat's path, so there is nothing to settle." } });

  b.host.send(CHAT, "I climb the stairs.");
  const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  await b.until("the turn's run to be at work", () => b.turns.runs.ofChat(USER, CHAT).length > 0);
  expect(await settle(b)).toEqual({ status: 409, body: { error: "A turn of this chat is going on. Settle it once that turn is over." } });
  hold.open();
  await settledTurn(b, (await generating).generationId!);
  expect(b.turns.runs.ofTurn(USER, b.turns.runs.ofChatKept(USER, CHAT, 1)[0]!.turn).map((r) => r.kind)).toEqual(["new"]);
});
