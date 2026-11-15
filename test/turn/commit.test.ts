// Commit (plan §6.3, §10.8, §10.10): a turn is tied to what its generation saved, read back from the
// swipe that generation wrote, whatever swipe the player looks at by then and whether or not the end
// was heard; and what a continue recorded leaves with it when it saves nothing new. Played through the
// stand-in Lumiverse as the player would, a continue sent and saved as Lumiverse does it, with the
// preset's own postfix: where a test leans on a single space, the bed's preset says it, as Lumiverse's
// default preset does (`src/auth/default-preset.ts:316`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { type Answer, gate } from "rp-harness/testing/rig";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { ChangeRow, TurnRow } from "../../src/store";
import type { StopReply } from "../../src/shared/api";
import { CONTINUE_NUDGE } from "../standin/assembly";
import type { Outcome } from "../standin/lumiverse";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

async function play(b: TurnBed, type: "normal" | "swipe" | "regenerate" | "continue", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** Lumiverse's `GENERATION_ENDED` and `GENERATION_STOPPED` stop reaching RPE's sockets until the returned function is called: RPE misses them. */
function missEnds(b: TurnBed): () => void {
  const send = b.host.sockets;
  b.host.sockets = (event, payload, user) => {
    if (event !== "GENERATION_ENDED" && event !== "GENERATION_STOPPED") send?.(event, payload, user);
  };
  return () => {
    b.host.sockets = send;
  };
}

/** A message's swipes as Lumiverse stored them: each one's text and date, and the one shown. */
function swipesOf(b: TurnBed, message: string): { texts: string[]; dates: number[]; shown: number } {
  const row = b.db.rows("SELECT swipes, swipe_dates, swipe_id FROM messages WHERE id = ?", message)[0]!;
  return { texts: JSON.parse(String(row.swipes)) as string[], dates: JSON.parse(String(row.swipe_dates)) as number[], shown: Number(row.swipe_id) };
}

/**
 * Follows the chat on RPE's live hub as a page does, and gives what a page that reads again at each `state` push would find then:
 * `read` of the moment, once for each push.
 */
function onStatePush<T>(b: TurnBed, read: () => T): T[] {
  const found: T[] = [];
  b.app.live.follow(CHAT, {
    take: (batch) => {
      for (const event of batch.events) if (event.kind === "state") found.push(read());
      return true;
    },
  });
  return found;
}

/** What the Author was sent in the model's `n`th request, as one text. */
const sent = (b: TurnBed, n: number): string => JSON.stringify(b.model.requests[n]!.messages);

describe("a turn is tied to the swipe its generation wrote", () => {
  test.each(["swipe", "regenerate"] as const)("a %s the player looks away from while it is written is tied to its own swipe, and the swipe shown stays on the path", async (kind) => {
    const hold = gate();
    const b = await bed({ answers: [replying("The lamp turns."), { pieces: [{ text: "<intent>Again.</intent>" }, { hold }, { text: "<reply>The lamp gutters.</reply>" }] }, replying("Wren nods.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const writing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: kind });
    await b.until(`the ${kind}'s run to be at work`, () => b.turns.runs.ofChat(USER, CHAT).some((r) => r.kind === kind) || null);
    // The player goes back to the first swipe while the new one is written.
    b.host.cycleSwipe(CHAT, first.message!, "left");
    hold.open();
    const made = await settledTurn(b, (await writing).generationId!);

    const swipes = swipesOf(b, first.message!);
    expect(swipes.shown).toBe(0);
    expect(swipes.texts).toEqual(["The lamp turns.", "The lamp gutters."]);
    expect(made).toMatchObject({ kind, status: "done", message: first.message, hash: textHash("The lamp gutters."), date: swipes.dates[1] });
    const store = b.turns.store.user(USER);
    expect(store.swipes(CHAT, first.message!).map((t) => t.id)).toEqual([first.id, made.id]);

    // The next turn follows the swipe shown: the first attempt is the path, and the new one stands beside it.
    const next = await settledTurn(b, await play(b, "normal", "I wait for the light."));
    expect(next.parent).toBe(first.id);
    expect(store.path(CHAT).find((e) => e.message === first.message)?.turn).toBe(first.id);
    expect(sent(b, 2)).not.toContain("was edited after its turn");
  });

  test("a swipe whose end RPE missed, flipped away from before the next turn, is tied there to the swipe it wrote", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("The lamp gutters."), replying("Wren nods.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const hear = missEnds(b);
    const swiped = await play(b, "swipe");
    await b.until("the swipe's run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    hear();
    b.host.cycleSwipe(CHAT, first.message!, "left");

    await settledTurn(b, await play(b, "normal", "I wait for the light."));
    const store = b.turns.store.user(USER);
    const made = store.turn(b.turns.runs.byGeneration(USER, swiped)!.turn)!;
    expect(made).toMatchObject({ status: "done", message: first.message, hash: textHash("The lamp gutters."), date: swipesOf(b, first.message!).dates[1] });
    expect(store.path(CHAT).find((e) => e.message === first.message)?.turn).toBe(first.id);
    expect(sent(b, 2)).not.toContain("was edited after its turn");
  });

  test("a page following the chat is told its state changed once the turn is tied, and reading again then finds the turn on the chat's path", async () => {
    const b = await bed({ answers: [replying("The lamp turns.")] });
    const store = b.turns.store.user(USER);
    const found = onStatePush(b, () => store.path(CHAT).flatMap((e) => (e.turn === null ? [] : [e.turn])));
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    expect(found.length).toBeGreaterThan(0);
    expect(found.at(-1)).toEqual([turn.id]);
  });
});

describe("a turn whose preset has a prefill", () => {
  test("is tied to the message Lumiverse saved and announced with the prefill in front, by the hash of what was stored", async () => {
    const b = await bed({ answers: [replying("turns, and the sea is loud."), replying("Wren nods.")] });
    // Lumiverse sends the preset's start of the reply as a partial last message and saves it in front of the model's text (`generate.service.ts:3702-3722`, `:4161`, `:4189`).
    b.host.presets.get(PRESET)!.assistantPrefill = "The lamp ";
    const generation = await play(b, "normal", "I climb the stairs.");
    const turn = await settledTurn(b, generation);
    const saved = "The lamp turns, and the sea is loud.";
    const ended = b.host.events.find((e) => e.event === "GENERATION_ENDED")!.payload as { content: string; messageId: string };
    expect(ended.content).toBe(saved);
    expect(b.host.chats.get(CHAT)!.messages.at(-1)!).toMatchObject({ id: ended.messageId, content: saved });
    // RPE's own reply is the model's text alone; the turn is tied to what was stored, with the prefill in front.
    expect(turn).toMatchObject({ status: "done", message: ended.messageId, hash: textHash(saved) });
  });
});

/** The Author's first call in a continue: its intent, then thirty minutes passed in the world, recorded on the turn. */
const PASS_TIME: Answer = { pieces: [{ text: "<intent>Then the storm.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 30, source: { from: "prose" } }] } }] };

describe("what a continue recorded", () => {
  /**
   * A turn played and saved, then continued by the Author's `after`, its change recorded before that answer begins on the continue's
   * own held turn, never on the turn it continues.
   */
  async function continued(after: Answer): Promise<{ b: TurnBed; turn: TurnRow; held: string; before: ChangeRow[]; continuing: Promise<Outcome> }> {
    const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, after] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const store = b.turns.store.user(USER);
    const before = store.changes(turn.id);
    const continuing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
    const held = await b.until("the continue to record its change on its own turn", () => {
      const going = b.turns.runs.ofChat(USER, CHAT)[0]?.held ?? null;
      return going !== null && store.changes(going).length > 0 ? going : null;
    });
    expect(store.changes(turn.id)).toEqual(before);
    return { b, turn, held, before, continuing };
  }

  /**
   * The continue's end is recorded, and what it saved nothing of is gone: the turn as it was before it, tied to what Lumiverse stored,
   * `saved`, which is the text it was tied to, or that text and the preset's join.
   */
  async function asBefore(b: TurnBed, turn: TurnRow, before: ChangeRow[], generation: string, saved: string): Promise<void> {
    await b.until("the continue's end to be recorded", () => (b.turns.runs.byGeneration(USER, generation)?.settled ?? null) !== null);
    expect(String(b.db.rows("SELECT content FROM messages WHERE id = ?", turn.message!)[0]!.content)).toBe(saved);
    const store = b.turns.store.user(USER);
    expect(store.changes(turn.id)).toEqual(before);
    expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, hash: textHash(saved) });
  }

  test("a continue stopped before it wrote anything saves nothing new, and what it recorded on its turn is taken back", async () => {
    const { b, turn, held, before, continuing } = await continued({ pieces: [{ hold: gate() }, { text: "<reply> Then it stops.</reply>" }] });
    expect((await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${held}/stop`)).body).toEqual({ stopped: true });
    const out = await continuing;
    expect(out.stopped).toBe(true);
    // Lumiverse keeps a stopped continue with a thinking block, here RPE's progress line: the text and the preset's postfix, here none,
    // as the preset sets none (`generate.service.ts:3638-3650`).
    await asBefore(b, turn, before, out.generationId!, "The lamp turns.");
  });

  test("a continue whose model fails saves nothing new, and what it recorded on its turn is taken back", async () => {
    const { b, turn, before, continuing } = await continued({ pieces: [], end: { error: "The provider went away." } });
    const out = await continuing;
    expect(out.error).not.toBeNull();
    // It was sent as Lumiverse sends a continue: the reply it goes on with last, out of the history, with its thinking sent back as Lumiverse sends it (RPE's progress lines of the turn that
    // wrote it, `reasoning_content`, `prompt-assembly.service.ts:3370-3394`), with no postfix, as the preset sets none, and the nudge after it (`:742-775`, `generate.service.ts:1969-1978`).
    expect((out.body!.messages as unknown[]).slice(-2)).toEqual([
      { role: "assistant", content: "The lamp turns.", reasoning_content: "Reading the turn.\nWriting.\n" },
      { role: "system", content: CONTINUE_NUDGE },
    ]);
    await asBefore(b, turn, before, out.generationId!, "The lamp turns.");
  });

  test("a page following the chat is told its state changed once what a continue that saved nothing recorded is taken back", async () => {
    const { b, turn, before, continuing } = await continued({ pieces: [], end: { error: "The provider went away." } });
    const store = b.turns.store.user(USER);
    const found = onStatePush(b, () => store.changes(turn.id));
    await asBefore(b, turn, before, (await continuing).generationId!, "The lamp turns.");
    expect(found.length).toBeGreaterThan(0);
    expect(found.at(-1)).toEqual(before);
  });

  test("a continue that saves its text keeps what it recorded", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, replying("Then it stops.")] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.presets.get(PRESET)!.continuePostfix = " ";
    const store = b.turns.store.user(USER);
    const before = store.changes(turn.id);
    await play(b, "continue");
    await b.until("the turn tied again to the joined text", () => store.turn(turn.id)?.hash === textHash("The lamp turns. Then it stops."));
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(store.changes(turn.id).slice(0, before.length)).toEqual(before);
    expect(store.changes(turn.id).slice(before.length).map((c) => [c.lane, c.applied])).toEqual([["engine", true]]);
  });
});

describe("every step of the commit (plan §10.8)", () => {
  test("tied by the saved id: a new reply's turn is tied to the message id Lumiverse saved it under, with the saved text's hash", async () => {
    const b = await bed({ answers: [replying("The lamp turns.")] });
    const generation = await play(b, "normal", "I climb the stairs.");
    const turn = await settledTurn(b, generation);
    const saved = b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat DESC LIMIT 1", CHAT)[0]!;
    expect(String(saved.content)).toBe("The lamp turns.");
    expect(turn).toMatchObject({ status: "done", message: String(saved.id), hash: textHash("The lamp turns.") });
    expect(b.turns.runs.byGeneration(USER, generation)).toMatchObject({ saved: null });
  });

  test("a missed end tied at the next intake: a new reply whose end RPE never heard is tied to what Lumiverse saved when the next turn comes in", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren nods.")] });
    const hear = missEnds(b);
    const first = await play(b, "normal", "I climb the stairs.");
    await b.until("the first run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    const store = b.turns.store.user(USER);
    const firstTurn = b.turns.runs.byGeneration(USER, first)!.turn;
    expect(store.turn(firstTurn)?.status).toBe("open");
    hear();

    await settledTurn(b, await play(b, "normal", "I wait for the light."));
    const saved = b.db.rows("SELECT id FROM messages WHERE chat_id = ? AND content = ?", CHAT, "The lamp turns.")[0]!;
    expect(store.turn(firstTurn)).toMatchObject({ status: "done", message: String(saved.id), hash: textHash("The lamp turns.") });
    expect(b.turns.runs.byGeneration(USER, first)?.settled).not.toBeNull();
  });

  test("a missed continue end tied at the next intake: the continue's turn is tied to the joined text Lumiverse saved when the next turn comes in", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Then it stops."), replying("Wren nods.")] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.presets.get(PRESET)!.continuePostfix = " ";
    const hear = missEnds(b);
    const goneOn = await play(b, "continue");
    await b.until("the continue's run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    const store = b.turns.store.user(USER);
    expect(b.turns.runs.byGeneration(USER, goneOn)?.settled).toBeNull();
    expect(store.turn(turn.id)?.hash).toBe(textHash("The lamp turns."));
    hear();

    await settledTurn(b, await play(b, "normal", "I wait for the light."));
    expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, hash: textHash("The lamp turns. Then it stops.") });
    expect(b.turns.runs.byGeneration(USER, goneOn)?.settled).not.toBeNull();
  });
});
