// What the turn lane tells the Author of the turn before, and keeps of it (plan §6.3, §10.9, §10.10),
// played through the stand-in Lumiverse: a reply cut short by a stop, a run stopped at its limit, a
// continue's run kept beside the one it continues, a deleted turn told to the harness once; another
// swipe shown on the newest reply, a reply or a player's message edited, with the text each had and has
// now, and what the player asked for through a panel; and the user the files and the harness's state
// serve, read when they are asked. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Gate, gate } from "rp-harness/testing/rig";
import type { StopReply, TurnsReply } from "../../src/shared/api";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { keepCarriedRun, NO_SESSION } from "../../src/turn";
import { STARTER_WORLDS } from "../../src/packs/index";
import { TIMELAPSE_ACTION } from "../../src/play/state/palette";
import type { ChatMessage } from "../standin/lumiverse";
import { CHAT, CONNECTION, GREETING, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

/** A bed whose chat plays a starter world, which a panel's press is of (the palette is the world's). */
async function worldBed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await bed(options);
  await playsWorld(b, STARTER_WORLDS.fantasy_town("w-harbour", "Harbour"));
  return b;
}

/** A panel's press that waits for the player's next message, on its own route: the Timelapse, which the palette offers, by its label. */
const press = (b: TurnBed, label: string) => b.page<{ request: { id: string } | null }>("POST", `/api/v1/chats/${CHAT}/requests/panel`, { action: TIMELAPSE_ACTION, values: { label }, from: "palette" });

/** What a press is told to the Author as, in the notices part's words. */
const pressedAs = (label: string): string => `From a panel (palette): ${label}, with label: ${label} (action ${TIMELAPSE_ACTION})`;

const CARRIED = "This chat was carried over from the earlier build.";

/** The bed's chat as a run of the migration leaves it: imported, with names and counts of what it carried. */
async function carriedOver(b: TurnBed): Promise<void> {
  const carried = { engine: "agents", turns: 3, marked: false, characters: [{ name: "Wren Hale", files: ["core.md"] }], story: { beats: 2, struck: 0, futures: 1, castings: 1 }, notes: null };
  await b.app.writes.run((db) => db.run("INSERT INTO migration_chat (user, chat, run, source, outcome, marked, carried) VALUES (?, ?, 'run-1', NULL, 'imported', 0, ?)", [USER, CHAT, JSON.stringify(carried)]));
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
    // The words have reached Lumiverse's stream: a stop before they do saves nothing, and the turn is dropped, not cut.
    const turn = await b.until("the reply's first words", () => {
      const run = b.turns.runs.ofChat(USER, CHAT)[0];
      return run !== undefined && [...b.host.streams.values()].some((seen) => seen.content.includes("The lamp turns")) ? run.turn : null;
    });
    expect((await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`)).body).toEqual({ stopped: true });
    const out = await generating;
    expect(out.stopped).toBe(true);
    const cut = await settledTurn(b, out.generationId!);
    expect(cut).toMatchObject({ id: turn, status: "cut" });

    await settledTurn(b, await play(b, "normal", "I wait in the dark."));
    expect(sent(b, 1)).toContain(`The reply in message ${cut.message} was stopped before it was finished.`);
    expect(sent(b, 0)).not.toContain("was stopped before it was finished");
  });

  test("after a Settle now on a reply cut short, which is told the cut, the next turn is not told it again", async () => {
    const hold: Gate = gate();
    const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns, and" }, { hold }, { text: " then dims.</reply>" }] }, { pieces: [{ text: "Nothing to settle." }] }, replying("Wren relights it.")] });
    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    // The words have reached Lumiverse's stream: a stop before they do saves nothing, and the turn is dropped, not cut.
    const turn = await b.until("the reply's first words", () => {
      const run = b.turns.runs.ofChat(USER, CHAT)[0];
      return run !== undefined && [...b.host.streams.values()].some((seen) => seen.content.includes("The lamp turns")) ? run.turn : null;
    });
    await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`);
    const cut = await settledTurn(b, (await generating).generationId!);
    expect(cut.status).toBe("cut");

    expect((await b.page("POST", `/api/v1/chats/${CHAT}/settle`)).status).toBe(200);
    await b.until("the Settle now run to end", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(sent(b, 1)).toContain(`The reply in message ${cut.message} was stopped before it was finished.`);
    await settledTurn(b, await play(b, "normal", "I wait in the dark."));
    expect(sent(b, 2)).not.toContain("was stopped before it was finished");
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
      global: "limits:\n  previousRunSeconds: 0.2\n",
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

  test("a continue's run is kept beside the run it continues, and the turn is listed once, as the run that played it, with each run beside it", async () => {
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
    const list = (await b.page<TurnsReply>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns;
    expect(list.map((t) => [t.id, t.kind, t.runs.map((r) => r.kind)])).toEqual([[turn.id, "new", ["new", "continue"]]]);
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

  test("after a delete leaves a gap in Lumiverse's numbers, the chat plays on: a reply written without a turn is still told by its place as chat_read counts it", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up."), replying("Wren lets the dog in.")] });
    // The greeting is message 0; the player's lines 1 and 3 with the turns' replies 2 and 4. The player's second line is deleted, so
    // Lumiverse's numbers run 0, 1, 2, 4 (`services/chats.service.ts:3236-3240`), and the reply written without a turn is stored as 5,
    // its place on the path, counting from 0, being 4.
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const second = await play(b, "normal", "I look around.");
    await settledTurn(b, second);
    const asked = b.host.chats.get(CHAT)!.messages.find((m) => m.content === "I look around.")!;
    b.host.deleteMessage(CHAT, asked.id);
    const dog = b.host.reply(CHAT, "The keeper's dog barks at the door.");
    expect(b.db.rows("SELECT index_in_chat AS n FROM messages WHERE id = ?", dog)).toEqual([{ n: 5 }]);
    await settledTurn(b, await play(b, "normal", "I let the dog in."));
    expect(sent(b, 2)).toContain("replies were written in this chat without a turn of yours (messages 4, counting the chat's first message as 0)");
  });

  test("a reply written without a turn is told to the turn after it, and not again to the two after that", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren lets the dog in."), replying("The dog shakes off the rain."), replying("Wren laughs.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.reply(CHAT, "The keeper's dog barks at the door.");
    for (const said of ["I let the dog in.", "I dry the dog.", "I sit by the fire."]) await settledTurn(b, await play(b, "normal", said));
    const unplayed = (n: number): string[] => b.requests[n]!.since.flatMap((s) => (s.kind === "unplayed" ? [s.text] : []));
    expect([1, 2, 3].map((n) => unplayed(n).length)).toEqual([1, 0, 0]);
    expect(unplayed(1)[0]).toContain("(messages 3, counting the chat's first message as 0)");
  });

  test("the empty message Lumiverse keeps of a generation stopped before its first word is no reply, and is never told as one", async () => {
    const hold = gate();
    const b = await bed({ answers: [replying("The lamp turns."), { pieces: [{ hold }, { text: "<reply>Too late.</reply>" }] }, replying("Wren looks up."), replying("Wren nods.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    b.host.send(CHAT, "I listen at the door.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    // Lumiverse keeps a stopped generation's message once its thinking block shows something: here RPE's progress line. The Author's
    // call is held, so the stop comes before the reply's first word.
    await b.until("RPE's progress line in the thinking block, and the Author's call held", () => {
      const started = b.host.events.findLast((e) => e.event === "GENERATION_STARTED")?.payload as { generationId: string } | undefined;
      return started !== undefined && (b.host.streams.get(started.generationId)?.reasoning ?? "") !== "" && b.model.requests.length === 2;
    });
    b.host.stop(USER, { chat: CHAT });
    const out = await generating;
    expect(out.stopped).toBe(true);
    expect((await settledTurn(b, out.generationId!)).status).toBe("dropped");
    const kept = b.host.chats.get(CHAT)!.messages.at(-1)!;
    expect([kept.role, kept.content]).toEqual(["assistant", ""]);

    for (const said of ["I open the door.", "I step out."]) await settledTurn(b, await play(b, "normal", said));
    expect(b.requests.slice(2).map((r) => r.since.filter((s) => s.kind === "unplayed").length)).toEqual([0, 0]);
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

  test("an edit of a hidden message is told without its texts, and none of its text is kept, unless the chat lets agents read hidden messages", async () => {
    const aside = "An aside I keep from the story.";
    const changed = "A changed aside I keep from the story.";
    /** The second turn's since-items and model request, and how many texts of the hidden message RPE kept. */
    const played = async (global?: string): Promise<{ told: string[]; sent: string; kept: number }> => {
      const messages = [{ id: "m-greeting", role: "assistant" as const, content: GREETING }, { id: "m-aside", role: "user" as const, content: aside, hidden: true }];
      const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up.")], messages, ...(global !== undefined ? { global } : {}) });
      await settledTurn(b, await play(b, "normal"));
      b.host.editMessage(CHAT, "m-aside", changed);
      await settledTurn(b, await play(b, "normal", "I wait."));
      const kept = b.app.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turn_prompt WHERE answered = ?").get("m-aside")?.n ?? 0;
      return { told: b.requests[1]!.since.map((s) => s.text), sent: sent(b, 1), kept };
    };

    const shut = await played();
    expect(shut.told).toContain("The player's message m-aside was edited since your last turn.");
    expect(shut.sent).not.toContain("aside I keep");
    expect(shut.kept).toBe(0);

    const open = await played("history:\n  hiddenReadable: true\n");
    expect(open.told).toContain(`The player's message m-aside was edited since your last turn. Before: ${aside} Now: ${changed}`);
  });

  test("a request from a panel is told, as what was pressed, to the turn that answers the next message and to a swipe of it, and to no turn after", async () => {
    const b = await worldBed({ answers: [replying("The lamp turns."), replying("Wren points at the steps."), replying("Wren nods at the steps."), replying("Wren waits.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const asked = await press(b, "Walk here");
    expect(asked.status).toBe(200);
    expect((await b.page<{ error: string }>("POST", `/api/v1/chats/${CHAT}/requests/panel`, { values: {}, from: "palette" })).status).toBe(400);

    await settledTurn(b, await play(b, "normal", "I go down."));
    await settledTurn(b, await play(b, "swipe"));
    await settledTurn(b, await play(b, "normal", "I stop."));
    const told = pressedAs("Walk here");
    expect(sent(b, 0)).not.toContain(told);
    expect(sent(b, 1)).toContain(told);
    expect(sent(b, 2)).toContain(told);
    expect(sent(b, 3)).not.toContain(told);
  });

  test("a request from a panel for a chat RPE does not hold is refused, and nothing of it is kept", async () => {
    const b = await worldBed({ answers: [replying("The lamp turns.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const refused = await b.page<{ error: string }>("POST", "/api/v1/chats/chat-elsewhere/requests/panel", { action: TIMELAPSE_ACTION, values: { label: "Walk here" }, from: "palette" });
    expect(refused.status).toBe(404);
    expect(b.app.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM request WHERE chat = ?").get("chat-elsewhere")?.n).toBe(0);
    expect((await press(b, "Walk here")).status).toBe(200);
  });

  test("a request made while a reply is written, or after the newest reply flipped to another swipe, reaches the turn that answers the next message", async () => {
    const hold = gate();
    const b = await worldBed({
      answers: [
        { pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns" }, { hold }, { text: ".</reply>" }] },
        replying("Wren points at the steps."),
        replying("Wren nods at the steps."),
        replying("Wren rings the bell."),
      ],
    });
    const ask = async (what: string): Promise<void> => {
      expect((await press(b, what)).status).toBe(200);
    };
    const told = (n: number): string[] => b.requests[n]!.asked ?? [];

    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    await b.until("the reply's first words", () => b.turns.runs.ofChat(USER, CHAT)[0]?.reply.includes("The lamp turns"));
    await ask("Walk here");
    hold.open();
    await settledTurn(b, (await generating).generationId!);
    const second = await settledTurn(b, await play(b, "normal", "I go down."));
    await settledTurn(b, await play(b, "swipe"));
    b.host.cycleSwipe(CHAT, second.message!, "left");
    await ask("Ring the bell");
    const third = await settledTurn(b, await play(b, "normal", "I stop."));

    expect(told(1)).toContain(pressedAs("Walk here"));
    expect(told(2)).toContain(pressedAs("Walk here"));
    expect(third.parent).toBe(second.id);
    expect(told(3)).toContain(pressedAs("Ring the bell"));
    expect(told(3)).not.toContain(pressedAs("Walk here"));
  });

  test("a swipe made after a request does not take it from the turn that answers the next message", async () => {
    const b = await worldBed({ answers: [replying("The lamp turns."), replying("The lamp gutters."), replying("Wren points at the steps.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    expect((await press(b, "Walk here")).status).toBe(200);
    await settledTurn(b, await play(b, "swipe"));
    await settledTurn(b, await play(b, "normal", "I go down."));
    expect(b.requests[1]!.asked ?? []).not.toContain(pressedAs("Walk here"));
    expect(b.requests[2]!.asked ?? []).toContain(pressedAs("Walk here"));
  });

  test("a chat a migration carried is told what was carried in its first briefing on RPE, and not once a turn RPE played is on its path", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up.")] });
    await carriedOver(b);

    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "normal", "I wait."));
    expect(sent(b, 0)).toContain(CARRIED);
    expect(sent(b, 0)).toContain("It was played by the earlier build's agents engine; 3 of its turns were carried, each with what it changed.");
    expect(sent(b, 0)).toContain("- Wren Hale: core.md");
    expect(sent(b, 1)).not.toContain(CARRIED);
  });

  test("a migrated chat's carried turns, each with the record of its run the migration keeps, do not count as played: its first turn on RPE is told what was carried", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up.")] });
    await carriedOver(b);
    const store = b.turns.store.user(USER);
    await b.app.writes.run((db) => {
      store.createChat({ id: CHAT });
      const carried = store.beginTurn({ chat: CHAT, kind: "new", imported: true });
      store.tieTurn(carried.id, { message: "m-greeting", hash: textHash(GREETING) });
      keepCarriedRun(db, { user: USER, chat: CHAT, turn: carried.id, at: 1, released: GREETING, saved: null });
    });

    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "normal", "I wait."));
    expect(sent(b, 0)).toContain(CARRIED);
    expect(sent(b, 1)).not.toContain(CARRIED);
  });

  test("a swipe of a migrated chat's first turn on RPE is told what was carried, and the turn after it is not", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("The lamp gutters."), replying("Wren looks up.")] });
    await carriedOver(b);
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "swipe"));
    await settledTurn(b, await play(b, "normal", "I wait."));
    expect(sent(b, 0)).toContain(CARRIED);
    expect(sent(b, 1)).toContain(CARRIED);
    expect(sent(b, 2)).not.toContain(CARRIED);
  });

  test("a continue of an imported reply is told what was carried, and the turn after it is not told again", async () => {
    const b = await bed({ answers: [replying(" It hums."), replying("Wren looks up.")] });
    await carriedOver(b);
    // The greeting as a migration imports it: a turn of the earlier build's, tied to the message.
    const store = b.turns.store.user(USER);
    await b.app.writes.run(() => {
      store.createChat({ id: CHAT });
      const imported = store.beginTurn({ chat: CHAT, kind: "new", imported: true });
      store.tieTurn(imported.id, { message: "m-greeting", hash: textHash(GREETING) });
    });

    const generation = await play(b, "continue");
    await b.until("the continue's run to be over", () => b.turns.runs.byGeneration(USER, generation)?.status === "released" || null);
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    await settledTurn(b, await play(b, "normal", "I wave."));
    expect(sent(b, 0)).toContain(CARRIED);
    expect(sent(b, 1)).not.toContain(CARRIED);
  });

  test("a carried chat whose first comparison finds more replies edited after their turns than the briefing's bound: the newest are told in full, the rest in one line by their messages' numbers, and the next turn is told none of them again", async () => {
    // Seven replies the earlier build played, each touched up by the player since it last read them: the chat shows the new text, and
    // each carried turn is tied to the old one, as the migration ties it.
    const reply = (i: number, how: string): string => `Reply ${i}, ${how}: ${"the lamp turns and the sea runs high under the rock, ".repeat(6)}`.trimEnd();
    const messages: ChatMessage[] = Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? { id: `m${i}`, role: "assistant", content: reply(i, "touched up") } : { id: `m${i}`, role: "user", content: `Line ${i}.` }));
    const b = await bed({ answers: [replying("Wren looks up."), replying("Wren nods.")], messages, global: "briefing:\n  editedTokens: 250\n" });
    await carriedOver(b);
    const store = b.turns.store.user(USER);
    await b.app.writes.run(() => {
      store.createChat({ id: CHAT });
      for (const [i, m] of messages.entries()) {
        if (m.role !== "assistant") continue;
        const [date] = JSON.parse(String(b.db.rows("SELECT swipe_dates FROM messages WHERE id = ?", m.id)[0]!.swipe_dates)) as number[];
        const carried = store.beginTurn({ chat: CHAT, kind: "new", imported: true });
        store.tieTurn(carried.id, { message: m.id, hash: textHash(reply(i, "as first written")), date: date ?? null });
      }
    });

    await settledTurn(b, await play(b, "normal", "I wave."));
    // Each reply told in full is about 120 tokens: the newest two fit in 250, and the five before them are named by number.
    expect(b.requests[0]!.since.filter((s) => s.kind === "edit").map((s) => s.text)).toEqual([
      "5 replies were edited after their turns and are not given in full here: messages 0, 2, 4, 6, 8, counting the chat's first message as 0. chat_read reads any of them.",
      `Message m10 was edited after its turn. Now: ${reply(10, "touched up")}`,
      `Message m12 was edited after its turn. Now: ${reply(12, "touched up")}`,
    ]);
    await settledTurn(b, await play(b, "normal", "I wave again."));
    expect(b.requests[1]!.since.filter((s) => s.kind === "edit")).toEqual([]);
  });
});

describe("what a comparison of the path found, kept with the chat", () => {
  test("what an intake found is told to the next turn when Lumiverse stops that intake after its comparison, before the harness takes it", async () => {
    const after = gate();
    const b = await bed({
      answers: [
        { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
        { pieces: [{ hold: after }, { text: "Noted." }] },
        replying("Wren looks up."),
      ],
      global: "limits:\n  previousRunSeconds: 30\n",
    });
    const asked = b.host.send(CHAT, "I climb the stairs.");
    const first = await play(b, "normal");
    await b.until("the first turn to be tied while its run goes on", () => {
      const run = b.turns.runs.byGeneration(USER, first);
      return run !== null && b.turns.store.user(USER).turn(run.turn)?.status === "done" && b.turns.runs.running(USER, run.turn) !== undefined;
    });
    const read = b.turns.store.user(USER).path(CHAT).find((e) => e.message === asked)!.hash;
    b.host.editMessage(CHAT, asked, "I climb the stairs, slowly.");

    // The next request compares the path, then waits for the first turn's run; Lumiverse's Stop ends it there.
    b.host.send(CHAT, "I wait.");
    const stopped = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    await b.until("the second request's comparison", () => b.turns.store.user(USER).path(CHAT).find((e) => e.message === asked)?.hash !== read);
    b.host.stop(USER, { chat: CHAT });
    expect((await stopped).stopped).toBe(true);
    after.open();
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(b.requests).toHaveLength(1);

    await settledTurn(b, await play(b, "normal"));
    const told = b.requests[1]!.since.map((s) => s.text);
    expect(told).toContain(`The player's message ${asked} was edited since your last turn. Before: I climb the stairs. Now: I climb the stairs, slowly.`);
  });

  test("a swipe of the turn that was told what the comparison found is told it too, and the turn after the swipe is not", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up."), replying("Wren waits."), replying("Wren waits, frowning."), replying("Wren nods.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const second = await settledTurn(b, await play(b, "normal", "I look around."));
    b.host.editMessage(CHAT, first.message!, "The lamp turns, and stops.");
    b.host.deleteMessage(CHAT, second.message!);

    await settledTurn(b, await play(b, "normal", "I wait."));
    await settledTurn(b, await play(b, "swipe"));
    await settledTurn(b, await play(b, "normal", "I wait longer."));
    const edited = `Message ${first.message} was edited after its turn. Before: The lamp turns. Now: The lamp turns, and stops.`;
    const deleted = "1 turn(s) were deleted since the last one.";
    const told = (n: number): string[] => b.requests[n]!.since.map((s) => s.text);
    for (const n of [2, 3]) expect(told(n)).toEqual(expect.arrayContaining([edited, expect.stringContaining(deleted)]));
    expect(told(4)).not.toContain(edited);
    expect(told(4)).not.toContain(deleted);
  });
});

describe("the kinds of what happened since", () => {
  test("each item goes under its kind as the harness's contract has it, so a file the user's config adds for that kind is given to that turn", async () => {
    // The user's own files at the global level, each added for one kind by the user's own config.
    const b = await worldBed({
      global: "stack:\n  added:\n    migrated: [CARRIED]\n    swiped: [SHOWN]\n",
      answers: [replying("The lamp turns."), replying("The lamp gutters."), replying("Wren trims the wick.")],
    });
    const files = { CARRIED: "FILE-CARRIED Mind what was carried.", SHOWN: "FILE-SHOWN Mind the swipe the player chose." };
    for (const [name, text] of Object.entries(files)) await writeFile(join(b.app.paths.files, `${name}.md`), `${text}\n`);
    await carriedOver(b);

    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    await settledTurn(b, await play(b, "swipe"));
    b.host.cycleSwipe(CHAT, first.message!, "left");
    expect((await press(b, "Walk here")).status).toBe(200);
    await settledTurn(b, await play(b, "normal", "I trim the wick."));

    // The request each turn's run was asked, by kind: what a panel's press asked is told as an asked line (09bf9bd68), not as a kind of what happened since.
    expect(b.requests.map((r) => r.since.map((s) => s.kind))).toEqual([["migrated"], ["migrated"], ["swiped"]]);
    expect(b.requests.map((r) => r.asked ?? [])).toEqual([[], [], [pressedAs("Walk here")]]);
    // What the Author was given for each turn: the messages after its last answer.
    const given = b.model.requests.map((r) => JSON.stringify(r.messages.slice(r.messages.findLastIndex((m) => m.role === "assistant") + 1)));
    const held = given.map((text) => Object.entries(files).flatMap(([name, line]) => (text.includes(line) ? [name] : [])));
    expect(held).toEqual([["CARRIED"], ["CARRIED"], ["SHOWN"]]);
  });
});

describe("the user served", () => {
  test("the files serve the user set when they are asked, and refuse a scope of anyone else or of no user; the harness's state is kept by the user its scope names", async () => {
    const b = await bed({ answers: [] });
    const config = b.app.config.lumiverse as { user: string | null };
    const scope = { user: USER, chat: CHAT, session: NO_SESSION };
    try {
      expect((await b.turns.files.places(scope)).notes).toBe("persistent-workspace/");
      await expect(b.turns.files.places({ ...scope, user: "" })).rejects.toThrow();
      await b.turns.env.store.set(scope, "kit/count", 3);

      config.user = null;
      await expect(b.turns.files.places(scope)).rejects.toThrow("belongs to no Lumiverse user yet");
      // The store has no user of its own: what a scope's user keeps reads the same whoever is set.
      expect(await b.turns.env.store.get(scope, "kit/count")).toBe(3);

      // A user set after the lane was built is the one served from then on.
      config.user = "user-tamsin";
      await expect(b.turns.files.places(scope)).rejects.toThrow();
      expect((await b.turns.files.places({ ...scope, user: "user-tamsin" })).notes).toBe("persistent-workspace/");
      expect(await b.turns.env.store.get({ user: "user-tamsin" }, "kit/count")).toBeUndefined();
    } finally {
      config.user = USER;
    }
    expect(await b.turns.env.store.get(scope, "kit/count")).toBe(3);
  });
});
