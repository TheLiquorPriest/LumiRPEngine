// Commit (plan §6.3, §10.8, §10.10): a turn is tied to what its generation saved, read back from the
// swipe that generation wrote, whatever swipe the player looks at by then and whether or not the end
// was heard; and what a continue recorded leaves with it when it saves nothing new. Played through the
// stand-in Lumiverse as the player would. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { type Answer, gate } from "rp-harness/testing/rig";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { ChangeRow, TurnRow } from "../../src/store";
import type { StopAnswer } from "../../src/ui/api";
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

/** The Author's first call in a continue: its intent, then thirty minutes passed in the world, recorded on the turn. */
const PASS_TIME: Answer = { pieces: [{ text: "<intent>Then the storm.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 30, source: { from: "prose" } }] } }] };

describe("what a continue recorded", () => {
  /** A turn played and saved, then continued by the Author's `after`, its change recorded on the turn before that answer begins. */
  async function continued(after: Answer): Promise<{ b: TurnBed; turn: TurnRow; before: ChangeRow[]; continuing: Promise<Outcome> }> {
    const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, after] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const store = b.turns.store.user(USER);
    const before = store.changes(turn.id);
    const continuing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
    await b.until("the continue to record its change on the turn", () => store.changes(turn.id).length > before.length);
    return { b, turn, before, continuing };
  }

  /** The continue's end is recorded, and what it saved nothing of is gone: the turn as it was before it, on the text it was tied to. */
  async function asBefore(b: TurnBed, turn: TurnRow, before: ChangeRow[], generation: string): Promise<void> {
    await b.until("the continue's end to be recorded", () => (b.turns.runs.byGeneration(USER, generation)?.settled ?? null) !== null);
    expect(String(b.db.rows("SELECT content FROM messages WHERE id = ?", turn.message!)[0]!.content)).toBe("The lamp turns.");
    const store = b.turns.store.user(USER);
    expect(store.changes(turn.id)).toEqual(before);
    expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, hash: textHash("The lamp turns.") });
  }

  test("a continue stopped before it wrote anything saves nothing new, and what it recorded on its turn is taken back", async () => {
    const { b, turn, before, continuing } = await continued({ pieces: [{ hold: gate() }, { text: "<reply> Then it stops.</reply>" }] });
    expect((await b.page<StopAnswer>("POST", `/api/v1/chats/${CHAT}/turns/${turn.id}/stop`)).body).toEqual({ stopped: true });
    const out = await continuing;
    expect(out.stopped).toBe(true);
    await asBefore(b, turn, before, out.generationId!);
  });

  test("a continue whose model fails saves nothing new, and what it recorded on its turn is taken back", async () => {
    const { b, turn, before, continuing } = await continued({ pieces: [], end: { error: "The provider went away." } });
    const out = await continuing;
    expect(out.error).not.toBeNull();
    await asBefore(b, turn, before, out.generationId!);
  });

  test("a page following the chat is told its state changed once what a continue that saved nothing recorded is taken back", async () => {
    const { b, turn, before, continuing } = await continued({ pieces: [], end: { error: "The provider went away." } });
    const store = b.turns.store.user(USER);
    const found = onStatePush(b, () => store.changes(turn.id));
    await asBefore(b, turn, before, (await continuing).generationId!);
    expect(found.length).toBeGreaterThan(0);
    expect(found.at(-1)).toEqual(before);
  });

  test("a continue that saves its text keeps what it recorded", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, replying(" Then it stops.")] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const store = b.turns.store.user(USER);
    const before = store.changes(turn.id);
    await play(b, "continue");
    await b.until("the turn tied again to the joined text", () => store.turn(turn.id)?.hash === textHash("The lamp turns. Then it stops."));
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(store.changes(turn.id).slice(0, before.length)).toEqual(before);
    expect(store.changes(turn.id).slice(before.length).map((c) => [c.lane, c.applied])).toEqual([["engine", true]]);
  });
});
