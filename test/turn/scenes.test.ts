// The story record's scenes and coverage, plugged into the turn (plan §11, §8.1): a scene the Author
// opens is played in a session of its own, the session before it closed as the work of the turn that
// moved on, and the harness is told of both, the new scene's session starting from the summary of the
// scene before it; and what the record covers is what the history window's hold and the story's facts
// count by. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import type { ChatMessage } from "../standin/lumiverse";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  // The reminder of writes that name no source would ask for calls these tests do not script.
  const b = await openTurnBed({ off: ["rules/unsourced"], ...options });
  beds.push(b);
  return b;
}

/** The player says something and asks for a reply; gives the turn once its end is recorded. */
async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

/** The Author records with `story_record`, after its intent record. */
const recording = (intent: string, operations: JsonObject[]): Answer => ({ pieces: [{ text: `<intent>${intent}</intent>` }, { call: "story_record", args: { operations } }] });
const reply = (text: string): Answer => ({ pieces: [{ text: `<reply>${text}</reply>` }] });

describe("scenes and sessions", () => {
  test("a scene the Author opens is played in a session of its own; the one before it closes as the work of the turn that moved on, and the next opens with the summary of the scene before it", async () => {
    const b = await bed({
      answers: [
        recording("The watch begins.", [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: ["Wren Hale"] }]),
        reply("Wren trims the wick."),
        recording("Morning comes.", [
          { op: "scene", close: true, summary: "SUMMARY-WATCH Wren kept the light burning through the storm." },
          { op: "scene", new: true, title: "Dawn", place: "the gallery", who: ["Wren Hale"] },
        ]),
        reply("The sky greys over the sea."),
        replying("Wren yawns."),
      ],
    });
    // The scene open at the chat's head is a stretch an agent can ask for by name: from the first message of its opening turn on.
    const stretch = async () => (await b.turns.env.chat.info({ user: USER, chat: CHAT, session: "any" })).ranges;
    expect(await stretch()).toEqual({});
    const first = await play(b, "I climb the stairs.");
    expect(await stretch()).toEqual({ scene: { from: 1, to: 3 } });
    const second = await play(b, "I wait for the light.");
    expect(await stretch()).toEqual({ scene: { from: 3, to: 5 } });
    await play(b, "I watch the sun come up.");

    // Each turn played in its own session: none for a scene, then the watch's, then the dawn's.
    const [none, watch, dawn] = b.requests.map((r) => r.scope.session);
    expect(new Set([none, watch, dawn]).size).toBe(3);
    const store = b.turns.store.user(USER);
    expect(store.session(none!)).toMatchObject({ scene: "", openedBy: first, closedBy: first });
    expect(store.session(watch!)).toMatchObject({ openedBy: first, closedBy: second });
    expect(store.session(dawn!)).toMatchObject({ openedBy: second, closedBy: null });
    expect(store.session(watch!)!.scene).not.toBe(store.session(dawn!)!.scene);

    // The harness heard each closing and each opening.
    const sessions = b.turns.harness.sessions!;
    const state = async (session: string) => (await sessions.get({ user: USER, chat: CHAT, session }))?.state;
    expect([await state(none!), await state(watch!), await state(dawn!)]).toEqual(["closed", "closed", "open"]);

    // The dawn's first turn is given the summary the watch closed with; the turn that wrote it was not.
    const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
    expect(sent).toHaveLength(5);
    expect(sent[2]).not.toContain("SUMMARY-WATCH");
    expect(sent[4]).toContain("SUMMARY-WATCH Wren kept the light burning through the storm.");
  });
});

describe("what the record covers", () => {
  /** Seven messages before the player's first, each marked by its place. */
  const HISTORY: ChatMessage[] = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, role: i % 2 === 0 ? "assistant" : "user", content: `HIST-0${i} ${i % 2 === 0 ? "The sea is loud." : "I listen."}` }));

  test("the window's hold keeps only what the record does not cover, and the story's facts count on the chat's own window", async () => {
    const beats = [0, 1, 2, 3, 4].map((message) => ({ op: "beat", text: `BEAT-${message} What happened there.`, message }));
    const b = await bed({
      answers: [recording("Note the past.", beats), reply("The lamp turns."), replying("Wren checks the glass.")],
      messages: HISTORY,
      global: "history:\n  window: 3\n  hold: true\n",
    });
    await play(b, "I ask whether the boat came.");
    const second = await play(b, "I look at the barometer.");

    // Nothing was covered when the first prompt was cut, so the hold kept the whole history; once the record covers the first five
    // messages, the second prompt keeps none of them and holds the rest.
    const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
    expect(sent[0]).toContain("HIST-00");
    expect(sent[2]).not.toContain("HIST-04");
    expect(sent[2]).toContain("HIST-05");

    // The five covered messages have left the prompt with beats and no summarized scene around them.
    const facts = await b.turns.env.facts.read({ user: USER, chat: CHAT, session: b.turns.runs.record(USER, second)!.session, turn: second }, ["history.unsummarized"]);
    expect(facts["history.unsummarized"]).toMatchObject({ count: 5, fields: { range: { from: 0, to: 4 } } });
  });
});
