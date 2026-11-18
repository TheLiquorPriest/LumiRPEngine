// A principal's own memory work when the Author voiced it (plan §7.2, §7.4, §10.9): the Author has the principal's own agent
// take in what it perceived, right after the reply with `delegate`, or as a job with `job_start`, naming the character definition
// and whom it plays; the agent is given what it has not taken in by its definition, writes its memories, a belief and how it feels
// about someone, and what it named is taken in. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { CastRecord, chatLine, findCharacter } from "../../src/cast";
import { untakenPerceptions } from "../../src/cast/memory";
import { castAt } from "../../src/cast/path";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const WREN = "Wren Hale";
const BRIEF = "BRIEF-TAKE-IN Take in what you perceived this turn.";

/** One answer that makes one tool call, after the intent record when one is given. */
function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

/** The Author's turn up to its reply and Wren's perception of it: Wren cast a principal, on stage in the open scene, voiced in the reply. */
const VOICED: Answer[] = [
  calling("cast_update", { operations: [{ op: "cast", who: WREN, as: "principal", line: "The keeper of the light." }] }, "Wren answers; I voice her."),
  calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: [WREN] }] }),
  { pieces: [{ text: '<reply>Wren looks past you at the sea. "The boat is late."</reply>' }, { call: "perceive", args: { perceptions: [{ who: WREN, reach: "whole", content: "A stranger climbed the stairs and asked whether the boat came.", knows: ["A stranger is asking after the boat."] }] } }] },
];

/** Wren's own agent at work: it reads the id of what it perceived from what it was given, and writes from it. */
const TAKING_IN: Answer = (request) => {
  const given = JSON.stringify(request.messages);
  const id = /\[(p-\d+)\]/.exec(given)?.[1] ?? "none";
  const memories: JsonObject = { memories: [{ text: "A stranger came up the stairs in the storm and asked about the boat, as if he were owed it.", gist: "A stranger asked after the boat.", weight: 2, who: ["the stranger"], about: ["the boat"], from: [id], top: true, source: "character" }] };
  const entries: JsonObject = { entries: [{ kind: "belief", text: "The stranger knows something about the boat.", from: [id], source: "character" }] };
  const relationships: JsonObject = { relationships: [{ with: "the stranger", text: "I do not trust a man who climbs a light in a storm to ask about a boat.", trust: -20, from: [id], source: "character" }] };
  return { pieces: [{ call: "remember", args: memories }, { call: "mind_set", args: entries }, { call: "relate", args: relationships }] };
};

/** What Wren's record holds at `turn`: her memories by gist, which at top of mind, her beliefs, her relationships, and the perceptions she has not taken in. */
function wrenAt(b: TurnBed, turn: string): { memories: unknown[]; top: unknown[]; beliefs: unknown[]; relationships: unknown[]; untaken: string[]; given: string[] } {
  const u = b.turns.store.user(USER);
  const record = CastRecord.read(b.turns.store, USER, castAt(u, CHAT, turn));
  const wren = findCharacter(b.turns.store.db, USER, chatLine(u, CHAT), WREN)!;
  const memories = record.of(wren.id, "memory");
  return {
    memories: memories.map((m) => m.fields.gist),
    top: memories.filter((m) => m.fields.top === true).map((m) => m.fields.gist),
    beliefs: record.of(wren.id, "mind").filter((m) => m.fields.kind === "belief").map((m) => m.fields.text),
    relationships: record.of(wren.id, "relationship").map((r) => [r.fields.with, r.fields.trust]),
    untaken: untakenPerceptions(record, wren.id).map((p) => p.id),
    given: record.of(wren.id, "perception").map((p) => p.id),
  };
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

test("right after the reply, the Author delegates to the character definition for the principal it voiced: its agent is given what it perceived, writes from it, and that is taken in", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [...VOICED, calling("delegate", { agent: "character", plays: WREN, brief: BRIEF }), TAKING_IN, { pieces: [{ text: "Taken in." }] }, { pieces: [{ text: "Done." }] }],
  });
  beds.push(b);
  const turn = await play(b, "I ask whether the boat came.");

  // Her agent's first request holds the brief and the perception in full with its id, given by its definition; the Author's own do not hold her mind.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  const hers = sent.find((s) => s.includes("BRIEF-TAKE-IN") && s.includes("not yet taken in"));
  expect(hers).toBeDefined();
  expect(hers).toContain("A stranger climbed the stairs and asked whether the boat came.");
  const wren = wrenAt(b, turn);
  expect(wren.given).toHaveLength(1);
  expect(hers).toContain(`[${wren.given[0]}]`);

  // What she wrote, and that her perception is taken in.
  expect(wren).toMatchObject({
    memories: ["A stranger asked after the boat."],
    top: ["A stranger asked after the boat."],
    beliefs: ["The stranger knows something about the boat."],
    relationships: [["the stranger", -20]],
    untaken: [],
  });
});

test("as a job, the Author starts the character definition for the principal it voiced: what its agent writes is taken in from the first turn that begins after the job ended", async () => {
  const author: Answer[] = [...VOICED, calling("job_start", { agent: "character", plays: WREN, brief: BRIEF }), { pieces: [{ text: "Started." }] }, replying("The lamp turns.")];
  const hers: Answer[] = [TAKING_IN, { pieces: [{ text: "Taken in." }] }];
  // Each call answered from its own agent's list: her agent holds `remember`.
  const route: Answer = (request) => {
    const next = (request.tools.some((t) => t.name === "remember") ? hers : author).shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  const b = await openTurnBed({ off: ["rules/unsourced"], answers: Array.from({ length: 9 }, () => route) });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");

  // The job ran on its own, tied to the turn, and ended done.
  const job = await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.ended !== undefined));
  expect(job).toMatchObject({ agent: "character", state: "done", scope: { turn: first } });
  // The turn it was started in reads none of it; the first turn begun after it ended reads it all.
  expect(wrenAt(b, first)).toMatchObject({ memories: [], untaken: wrenAt(b, first).given });
  const next = await play(b, "I wait.");
  expect(wrenAt(b, next)).toMatchObject({
    memories: ["A stranger asked after the boat."],
    top: ["A stranger asked after the boat."],
    beliefs: ["The stranger knows something about the boat."],
    relationships: [["the stranger", -20]],
    untaken: [],
  });
});
