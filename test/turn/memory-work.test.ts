// A principal's own memory work when the Author voiced it (plan §7.2, §7.3, §7.4, §10.9): the Author has the principal's own agent
// take in what it perceived, right after the reply with `delegate`, or as a job with `job_start`, naming the character definition
// and whom it plays; the agent is given what it has not taken in by its definition, writes its memories, a belief and how it feels
// about someone, and what it named is taken in. The shipped reminders that read what waits (`memory-owed`, `memory-late`,
// `memory-scene-end`, `dream-due`) fire when it waits, and not otherwise; following one clears it, and none fires twice in a turn.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { CastRecord, chatLine, findCharacter } from "../../src/cast";
import { untakenPerceptions } from "../../src/cast/memory";
import { castAt } from "../../src/cast/path";
import { toldRows } from "../../src/turn/events";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

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

/** The rules that fired on a turn, in order. */
function fired(b: TurnBed, turn: string): string[] {
  return toldRows(b.app.db, USER, "rule", { turn }).map((r) => r.body.rule);
}

/** The Author's requests that hold a line. */
function told(b: TurnBed, line: string): number {
  return b.model.requests.filter((r) => JSON.stringify(r.messages).includes(line)).length;
}

/** Each call answered from its own agent's list: a character's agent holds `remember`, the Author does not. */
function routed(author: Answer[], hers: Answer[]): Answer[] {
  const route: Answer = (request) => {
    const next = (request.tools.some((t) => t.name === "remember") ? hers : author).shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  return Array.from({ length: author.length + hers.length }, () => route);
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
  // Nothing waited when the run ended: no reminder fired.
  expect(fired(b, turn)).toEqual([]);
});

test("as a job, the Author starts the character definition for the principal it voiced: what its agent writes is taken in from the first turn that begins after the job ended", async () => {
  // The run ends with her perception still waiting (the job's writes count from the next turn), so the reminder fires once, and the Author says a job has it.
  const author: Answer[] = [...VOICED, calling("job_start", { agent: "character", plays: WREN, brief: BRIEF }), { pieces: [{ text: "Started." }] }, { pieces: [{ text: "A job is taking them in." }] }, replying("The lamp turns.")];
  // Who has no perception of the second turn is not this test's: its reminder is off.
  const b = await openTurnBed({ off: ["rules/unsourced", "rules/perceptions-owed"], answers: routed(author, [TAKING_IN, { pieces: [{ text: "Taken in." }] }]) });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");

  // The job ran on its own, tied to the turn, and ended done.
  const job = await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.ended !== undefined));
  expect(job).toMatchObject({ agent: "character", state: "done", scope: { turn: first } });
  expect(fired(b, first)).toEqual(["memory-owed"]);
  // The turn it was started in reads none of it; the first turn begun after it ended reads it all, and nothing reminds anyone of it.
  expect(wrenAt(b, first)).toMatchObject({ memories: [], untaken: wrenAt(b, first).given });
  const next = await play(b, "I wait.");
  expect(wrenAt(b, next)).toMatchObject({
    memories: ["A stranger asked after the boat."],
    top: ["A stranger asked after the boat."],
    beliefs: ["The stranger knows something about the boat."],
    relationships: [["the stranger", -20]],
    untaken: [],
  });
  expect(fired(b, next)).toEqual([]);
});

test("memory-owed: a run that ends with a principal it voiced holding what it perceived is reminded once, by name; it has her agent take it in, and the run ends", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [
      ...VOICED,
      { pieces: [{ text: "Nothing more." }] },
      // The reminder's text is added and the Author gets another call: it does what the text asks.
      calling("delegate", { agent: "character", plays: WREN, brief: BRIEF }),
      TAKING_IN,
      { pieces: [{ text: "Taken in." }] },
      { pieces: [{ text: "Done." }] },
    ],
  });
  beds.push(b);
  const turn = await play(b, "I ask whether the boat came.");
  expect(told(b, "were on stage this turn and hold perceptions their own agent has not taken in: Wren Hale.")).toBeGreaterThan(0);
  expect(told(b, "- Wren Hale (principal): 1 waiting, the oldest of this turn.")).toBeGreaterThan(0);
  expect(fired(b, turn)).toEqual(["memory-owed"]);
  expect(wrenAt(b, turn).untaken).toEqual([]);
});

test("memory-late: what a principal still holds from an earlier turn is in the next turn's briefing; once its agent takes it in, the turn after has nothing", async () => {
  const LATE = "hold perceptions of earlier turns their own agent has not taken in, the oldest from 1 turn(s) ago: Wren Hale.";
  const b = await openTurnBed({
    // Who has no perception of the second turn is not this test's: its reminders are off.
    off: ["rules/unsourced", "rules/perceptions-owed", "rules/perceptions-missing"],
    answers: [
      ...VOICED,
      { pieces: [{ text: "Nothing more." }] },
      // The first turn's reminder: the Author holds her as only present, and ends.
      { pieces: [{ text: "She was only present; it waits." }] },
      // The second turn begins with the late reminder in its briefing: her agent takes them in, then the reply.
      calling("delegate", { agent: "character", plays: WREN, brief: BRIEF }, "Wren takes in what waits."),
      TAKING_IN,
      { pieces: [{ text: "Taken in." }] },
      { pieces: [{ text: "<reply>Wren trims the wick.</reply>" }] },
      replying("The lamp turns."),
    ],
  });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");
  expect(fired(b, first)).toEqual(["memory-owed"]);
  expect(told(b, LATE)).toBe(0);

  const second = await play(b, "I watch her work.");
  expect(fired(b, second)).toEqual(["memory-late"]);
  expect(told(b, LATE)).toBeGreaterThan(0);
  expect(wrenAt(b, second).untaken).toEqual([]);

  const third = await play(b, "I wait.");
  expect(fired(b, third)).toEqual([]);
});

test("memory-scene-end: a scene closed with a principal's perceptions waiting is in the next turn's briefing; a job takes them in, and the turn after has nothing", async () => {
  const ENDED = "A scene has closed, and these characters still hold perceptions of it their own agent has not taken in: Wren Hale.";
  const author: Answer[] = [
    ...VOICED,
    calling("story_record", { operations: [{ op: "scene", close: true, summary: "The stranger asked after the boat." }] }),
    { pieces: [{ text: "Nothing more." }] },
    // The second turn begins with the reminder: a job for her, then the reply.
    calling("job_start", { agent: "character", plays: WREN, brief: BRIEF }, "Wren's memory work, as the scene ended."),
    { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
    replying("The sea is loud."),
  ];
  const b = await openTurnBed({ off: ["rules/unsourced"], answers: routed(author, [TAKING_IN, { pieces: [{ text: "Taken in." }] }]) });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");
  // The scene closed in this turn, so nobody is on stage as it ends: no run-end reminder; and nothing is late in turns.
  expect(fired(b, first)).toEqual([]);

  const second = await play(b, "I go down the stairs.");
  expect(fired(b, second)).toEqual(["memory-scene-end"]);
  expect(told(b, ENDED)).toBeGreaterThan(0);
  await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.ended !== undefined));

  const third = await play(b, "I wait.");
  expect(fired(b, third)).toEqual([]);
  expect(wrenAt(b, third).untaken).toEqual([]);
});

test("dream-due: a principal who goes to sleep is reminded of once, as the run ends; its agent dreams, and sleeping on brings nothing back", async () => {
  const DUE = "Since they last dreamt, these characters have slept or lived a long stretch: Bram.";
  const asleep = { operations: [{ op: "set", at: "bram", key: "activity", value: "sleep", source: "author" }] };
  const b = await openTurnBed({
    // Only the dream's reminder: Bram is on stage with nobody writing his perceptions of the later turns or taking in the first.
    off: ["rules/unsourced", "rules/memory-owed", "rules/memory-late", "rules/perceptions-owed", "rules/perceptions-missing"],
    answers: [
      calling("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, "Bram closes up."),
      { pieces: [{ text: "<reply>Bram bars the door.</reply>" }, { call: "perceive", args: { perceptions: [{ who: "Bram", reach: "whole", content: "The last guest goes up the stairs." }] } }] },
      { pieces: [{ text: "Nothing more." }] },
      // He goes to bed: as the run ends the reminder fires, and his agent dreams.
      { pieces: [{ text: "<intent>Bram sleeps.</intent><reply>Bram goes up to bed.</reply>" }, { call: "world_apply", args: asleep }] },
      { pieces: [{ text: "Nothing more." }] },
      calling("delegate", { agent: "character", plays: "Bram", brief: "BRIEF-DREAM You sleep." }),
      calling("dream", {}),
      { pieces: [{ text: "Slept." }] },
      { pieces: [{ text: "Done." }] },
      replying("The inn is quiet."),
    ],
  });
  beds.push(b);
  await playsWorld(b, world());
  const first = await play(b, "I sit by the fire.");
  expect(fired(b, first)).toEqual([]);
  const night = await play(b, "I watch him go up.");
  expect(fired(b, night)).toEqual(["dream-due"]);
  expect(told(b, DUE)).toBeGreaterThan(0);
  expect(told(b, "- Bram (principal): a sleep has begun since it first perceived anything; it has never dreamt.")).toBeGreaterThan(0);
  const third = await play(b, "I wait.");
  expect(fired(b, third)).toEqual([]);
});

test("the Cast page's press: the cast list and the Turn page's record say what waits, the press starts the job as his own with her agent playing her, briefed by the shipped part, and once the first turn begun after it ended is played both read it taken in", async () => {
  const author: Answer[] = [...VOICED, { pieces: [{ text: "Nothing more." }] }, { pieces: [{ text: "She was only present; it waits." }] }, replying("The lamp turns.")];
  const b = await openTurnBed({ off: ["rules/unsourced", "rules/perceptions-owed"], answers: routed(author, [TAKING_IN, { pieces: [{ text: "Taken in." }] }]) });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");
  // The Turn page's record of the first turn: her perception, and that her own agent has not taken it in.
  const record = async () => (await b.page<{ turns: { people: { name: string; perceptions: string[]; untaken: string[] }[] }[] }>("GET", `/api/v1/chats/${CHAT}/perceptions?turn=${first}`)).body.turns[0]?.people.find((p) => p.name === WREN);
  const before = await record();
  expect(before?.perceptions).toHaveLength(1);
  expect(before?.untaken).toEqual(before?.perceptions);

  const list = await b.page<{ characters: { name: string; waits: { perceptions: number; dreamt: unknown } }[] }>("GET", `/api/v1/chats/${CHAT}/cast`);
  expect(list.body.characters.find((c) => c.name === WREN)?.waits).toMatchObject({ perceptions: 1, dreamt: null });
  const started = await b.page<{ job: { agent: string; plays?: string; startedBy: unknown } }>("POST", `/api/v1/chats/${CHAT}/jobs/take-in`, { character: WREN });
  expect(started.status).toBe(200);
  expect(started.body.job).toMatchObject({ agent: "character", plays: WREN, startedBy: "user" });
  await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.ended !== undefined && j.state === "done"));
  expect(told(b, "Take in what you have perceived and not yet taken in.")).toBeGreaterThan(0);

  const next = await play(b, "I wait.");
  expect(wrenAt(b, next)).toMatchObject({ memories: ["A stranger asked after the boat."], untaken: [] });
  expect(fired(b, next)).toEqual([]);
  const after = await b.page<{ characters: { name: string; waits: { perceptions: number } }[] }>("GET", `/api/v1/chats/${CHAT}/cast`);
  expect(after.body.characters.find((c) => c.name === WREN)?.waits.perceptions).toBe(0);
  expect((await record())?.untaken).toEqual([]);
});
