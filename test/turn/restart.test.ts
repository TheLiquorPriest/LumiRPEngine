// RPE stopped in the middle of a turn and started again (plan §10.8, §10.10 "RPE restarted mid-turn"):
// the run it left going is given its end at the chat's next turn, and the turn is tied to what
// Lumiverse saved, or dropped when it saved nothing. Played through the stand-in Lumiverse as the player
// would, with RPE stopped as a process ends: it records nothing more. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gate } from "rp-harness/testing/rig";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { TurnList } from "../../src/ui/api";
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

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** What the Author was sent in the model's `n`th request, as one text. */
const sent = (b: TurnBed, n: number): string => JSON.stringify(b.model.requests[n]!.messages);

describe("RPE restarted mid-turn", () => {
  test("stopped after its reply was saved, before the turn was tied: the next turn ends the run and ties the turn to what Lumiverse saved", async () => {
    const after = gate();
    const b = await bed({
      answers: [
        // The reply, then work after it that holds until RPE stops.
        { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
        { pieces: [{ hold: after }, { text: "Noted." }] },
        replying("Wren looks up."),
      ],
    });
    // RPE does not hear the generation end before it stops.
    const send = b.host.sockets;
    b.host.sockets = (event, payload, user) => {
      if (event !== "GENERATION_ENDED") send?.(event, payload, user);
    };
    const first = await play(b, "I climb the stairs.");
    const run = await b.until("the run to be at work after its reply", () => {
      const r = b.turns.runs.byGeneration(USER, first);
      return r !== null && r.released !== null && b.turns.runs.running(USER, r.turn) !== undefined ? r : null;
    });
    b.host.sockets = send;
    await b.restart();

    const next = await settledTurn(b, await play(b, "I ask about the boat."));
    const store = b.turns.store.user(USER);
    const saved = b.db.rows("SELECT id FROM messages WHERE chat_id = ? AND content = ?", CHAT, "The lamp turns.")[0]!;
    expect(store.turn(run.turn)).toMatchObject({ status: "done", message: String(saved.id), hash: textHash("The lamp turns.") });
    expect(next.parent).toBe(run.turn);
    expect(b.turns.runs.ofTurn(USER, run.turn).map((r) => [r.status, r.released !== null, r.error?.code])).toEqual([["failed", true, "failed"]]);
    expect(sent(b, 2)).not.toContain("without a turn of yours");
    const list = (await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns;
    expect(list.map((t) => [t.id, t.status, t.onPath])).toEqual([
      [next.id, "released", true],
      [run.turn, "failed", true],
    ]);
  });

  test("stopped while its reply was being written: Lumiverse keeps nothing, and the next turn ends the run, in the words of the user's turn-errors part, and drops the turn", async () => {
    const hold = gate();
    const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns, and" }, { hold }, { text: " then dims.</reply>" }] }, replying("Wren relights it.")] });
    // The user's own wording of the turn's failures, over the shipped part.
    await mkdir(join(b.app.paths.files, ".prompts"), { recursive: true });
    await writeFile(join(b.app.paths.files, ".prompts", "turn-errors.md"), "---\ndescription: Our own words.\nformat: lines\n---\nstopped_mid_run: RPE went down in the middle of this one.\n", "utf8");
    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const turn = await b.until("the reply's first words", () => {
      const run = b.turns.runs.ofChat(USER, CHAT)[0];
      return run !== undefined && run.reply.includes("The lamp turns") ? run.turn : null;
    });
    await b.restart();
    // Lumiverse's request failed with RPE gone, and the message it had made for the reply was removed.
    expect((await generating).error).not.toBeNull();

    const next = await settledTurn(b, await play(b, "I wait in the dark."));
    expect(b.turns.store.user(USER).turn(turn)).toMatchObject({ status: "dropped", message: null });
    expect(b.turns.runs.ofTurn(USER, turn).map((r) => [r.status, r.released, r.error?.detail])).toEqual([["failed", null, "RPE went down in the middle of this one."]]);
    expect(next.parent).toBeNull();
    const list = (await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns;
    expect(list.map((t) => [t.id, t.status, t.onPath])).toEqual([
      [next.id, "released", true],
      [turn, "failed", false],
    ]);
  });
});
