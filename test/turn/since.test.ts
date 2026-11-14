// What the turn lane tells the Author of the turn before, and keeps of it (plan §6.3, §10.9, §10.10),
// played through the stand-in Lumiverse: a reply cut short by a stop, a run stopped at its limit, a
// continue's run kept beside the one it continues, a deleted turn told to the harness once; another
// swipe shown on the newest reply, a reply or a player's message edited, with the text each had and has
// now, and what the player asked for through a panel; and the user the files and the harness's state
// serve, read when they are asked. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { type Gate, gate } from "rp-harness/testing/rig";
import type { StopAnswer, TurnList } from "../../src/ui/api";
import { NO_SESSION } from "../../src/turn";
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

async function play(b: TurnBed, type: "normal" | "continue" | "swipe", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** What the Author was sent in the model's `n`th request, as one text. */
const sent = (b: TurnBed, n: number): string => JSON.stringify(b.model.requests[n]!.messages);

describe("the turn before, told and kept", () => {
  test("a reply cut short by a stop is tied as cut, and the next turn tells the Author", async () => {
    const hold: Gate = gate();
    const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns, and" }, { hold }, { text: " then dims.</reply>" }] }, replying("Wren relights it.")] });
    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const turn = await b.until("the reply's first words", () => {
      const run = b.turns.runs.ofChat(USER, CHAT)[0];
      return run !== undefined && run.reply.includes("The lamp turns") ? run.turn : null;
    });
    expect((await b.page<StopAnswer>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`)).body).toEqual({ stopped: true });
    const out = await generating;
    expect(out.stopped).toBe(true);
    const cut = await settledTurn(b, out.generationId!);
    expect(cut).toMatchObject({ id: turn, status: "cut" });

    await settledTurn(b, await play(b, "normal", "I wait in the dark."));
    expect(sent(b, 1)).toContain(`The reply in message ${cut.message} was stopped before it was finished.`);
    expect(sent(b, 0)).not.toContain("was stopped before it was finished");
  });

  test("a run still at work after its reply, stopped at its limit by the next turn, is told to the Author", async () => {
    const after = gate();
    const b = await bed({
      answers: [
        { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
        { pieces: [{ hold: after }, { text: "Noted." }] },
        replying("Wren looks up."),
        replying("Wren looks away."),
      ],
      global: "limits:\n  previousRun: 0.2\n",
    });
    const first = await play(b, "normal", "I climb the stairs.");
    await b.until("the first turn to be tied while its run goes on", () => {
      const run = b.turns.runs.byGeneration(USER, first);
      return run !== null && b.turns.store.user(USER).turn(run.turn)?.status === "done" && b.turns.runs.running(USER, run.turn) !== undefined;
    });
    await settledTurn(b, await play(b, "normal", "I ask about the boat."));
    const told = "The last turn's work was still going when this one began, and was stopped where it stood.";
    expect(sent(b, 2)).toContain(told);
    // Told once: the turn after that stopped nothing.
    await settledTurn(b, await play(b, "normal", "I ask about the oil."));
    expect(sent(b, 3)).not.toContain(told);
  });

  test("a continue's run is kept beside the run it continues, and the turn is listed once, as its latest run", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Then it stops, and Wren swears.")] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const generation = await play(b, "continue");
    await b.until("the continue's run to be over", () => b.turns.runs.byGeneration(USER, generation)?.status === "released" || null);
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);

    const runs = b.turns.runs.ofTurn(USER, turn.id);
    expect(runs.map((r) => [r.kind, r.reply])).toEqual([
      ["new", "The lamp turns."],
      ["continue", "Then it stops, and Wren swears."],
    ]);
    expect(new Set(runs.map((r) => r.id)).size).toBe(2);
    expect(b.turns.runs.record(USER, turn.id)?.kind).toBe("continue");
    const list = (await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns;
    expect(list.map((t) => [t.id, t.kind])).toEqual([[turn.id, "continue"]]);
  });

  test("a turn whose message is deleted is told to the harness once, when the delete is heard", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up from the brass.")] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.deleteMessage(CHAT, turn.message!);
    await b.until("the harness to be told", () => b.left.some((s) => s.turn === turn.id));
    await settledTurn(b, await play(b, "normal", "I climb the stairs again."));
    expect(b.left.filter((s) => s.turn === turn.id)).toHaveLength(1);
    expect(sent(b, 1)).toContain("1 turn(s) were deleted since the last one.");
  });

  test("a reply written in the chat without a turn is told by its number as chat_read counts it, the chat's first message 0", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up from the brass.")] });
    // The greeting is message 0; the player's first message 1 and the turn's reply 2; the reply written without a turn 3.
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.reply(CHAT, "The keeper's dog barks at the door.");
    await settledTurn(b, await play(b, "normal", "I let the dog in."));
    expect(sent(b, 1)).toContain("replies were written in this chat without a turn of yours (messages 3, counting the chat's first message as 0)");
  });
});

describe("what has happened in the chat since the last turn", () => {
  test("another swipe shown on the newest reply is told, and the turn of the swipe shown is the one the next turn follows", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("The lamp gutters."), replying("Wren trims the wick.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "swipe"));
    expect(sent(b, 1)).not.toContain("now shows another of its swipes");
    b.host.cycleSwipe(CHAT, first.message!, "left");

    const next = await settledTurn(b, await play(b, "normal", "I trim the wick."));
    expect(sent(b, 2)).toContain(`The newest reply (${first.message}) now shows another of its swipes.`);
    expect(next.parent).toBe(first.id);
  });

  test("a reply edited after its turn is told with the text its turn was tied to and the text it has now", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.editMessage(CHAT, first.message!, "The lamp turns, and stops.");

    await settledTurn(b, await play(b, "normal", "I wait."));
    expect(sent(b, 1)).toContain(`Message ${first.message} was edited after its turn. Before: The lamp turns. Now: The lamp turns, and stops.`);
  });

  test("the player's own message edited since the last turn is told with the text RPE read and the text it has now, once", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up."), replying("Wren looks away.")] });
    const asked = b.host.send(CHAT, "I climb the stairs.");
    await settledTurn(b, await play(b, "normal"));
    b.host.editMessage(CHAT, asked, "I climb the stairs, slowly.");

    await settledTurn(b, await play(b, "normal", "I wait."));
    const told = `The player's message ${asked} was edited since your last turn. Before: I climb the stairs. Now: I climb the stairs, slowly.`;
    expect(sent(b, 1)).toContain(told);
    await settledTurn(b, await play(b, "normal", "I wait longer."));
    expect(sent(b, 2)).not.toContain(`The player's message ${asked} was edited`);
  });

  test("a request from a panel is told, with what it was pressed on, to the turn that answers the next message and to a swipe of it, and to no turn after", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren points at the steps."), replying("Wren nods at the steps."), replying("Wren waits.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const asked = await b.page<{ request: { id: string } }>("POST", `/api/v1/chats/${CHAT}/requests`, { what: "Walk here", on: "the harbour steps" });
    expect(asked.status).toBe(200);
    expect((await b.page<{ error: string }>("POST", `/api/v1/chats/${CHAT}/requests`, { on: "the harbour steps" })).status).toBe(400);

    await settledTurn(b, await play(b, "normal", "I go down."));
    await settledTurn(b, await play(b, "swipe"));
    await settledTurn(b, await play(b, "normal", "I stop."));
    const told = "From a panel: Walk here, on the harbour steps";
    expect(sent(b, 0)).not.toContain(told);
    expect(sent(b, 1)).toContain(told);
    expect(sent(b, 2)).toContain(told);
    expect(sent(b, 3)).not.toContain(told);
  });

  test("a chat a migration carried is told what was carried in its first briefing on RPE, and not once a turn RPE played is on its path", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up.")] });
    // What a run of the migration keeps of a chat it imported: names and counts.
    const carried = { engine: "agents", turns: 3, marked: false, characters: [{ name: "Wren Hale", files: ["core.md"] }], story: { beats: 2, struck: 0, futures: 1, castings: 1 }, notes: null };
    await b.app.writes.run((db) => db.run("INSERT INTO migration_chat (user, chat, run, source, outcome, marked, carried) VALUES (?, ?, 'run-1', NULL, 'imported', 0, ?)", [USER, CHAT, JSON.stringify(carried)]));

    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "normal", "I wait."));
    const told = "This chat was carried over from the earlier build.";
    expect(sent(b, 0)).toContain(told);
    expect(sent(b, 0)).toContain("It was played by the earlier build's agents engine; 3 of its turns were carried, each with what it changed.");
    expect(sent(b, 0)).toContain("- Wren Hale: core.md");
    expect(sent(b, 1)).not.toContain(told);
  });
});

describe("the user served", () => {
  test("the files and the harness's state serve the user set when they are asked, and refuse a scope of anyone else or of no user", async () => {
    const b = await bed({ answers: [] });
    const config = b.app.config.lumiverse as { user: string | null };
    const scope = { user: USER, chat: CHAT, session: NO_SESSION };
    try {
      expect((await b.turns.files.places(scope)).notes).toBe("persistent-workspace/");
      await expect(b.turns.files.places({ ...scope, user: "" })).rejects.toThrow();
      await b.turns.env.store.set("kit/count", 3);

      config.user = null;
      await expect(b.turns.files.places(scope)).rejects.toThrow("belongs to no Lumiverse user yet");
      await expect(b.turns.env.store.get("kit/count")).rejects.toThrow("belongs to no Lumiverse user yet");

      // A user set after the lane was built is the one served from then on.
      config.user = "user-tamsin";
      await expect(b.turns.files.places(scope)).rejects.toThrow();
      expect((await b.turns.files.places({ ...scope, user: "user-tamsin" })).notes).toBe("persistent-workspace/");
      expect(await b.turns.env.store.get("kit/count")).toBeUndefined();
    } finally {
      config.user = USER;
    }
    expect(await b.turns.env.store.get("kit/count")).toBe(3);
  });
});
