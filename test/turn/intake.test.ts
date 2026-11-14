// Intake timed (plan §17.1: "Intake: median ≤ 150 ms on a 10,000-message chat"), played through the
// stand-in Lumiverse with RPE reading its rows from the database file: from the moment Lumiverse's
// request reaches RPE's provider endpoint to the moment the Author's run starts, for each of several
// turns of one chat, with the turn lane's own steps from its log. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const MESSAGES = 10_000;
/** Turns timed: few, since laying out the stand-in's chat of 10,000 messages already takes most of this file's time. */
const TURNS = 5;
/** Plan §17.1. */
const INTAKE_MS = 150;

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

test(`intake on a chat of ${MESSAGES} messages, over the database reader, has a median within ${INTAKE_MS} ms`, async () => {
  const messages = Array.from({ length: MESSAGES }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Line ${i}: the lamp turns over the grey water, and the keeper counts the hours until the tide.`,
  }));
  const b = await openTurnBed({ answers: Array.from({ length: TURNS }, (_, i) => replying(`Reply ${i}.`)), messages });
  beds.push(b);
  expect(b.turns.lane).toBeDefined();
  // When each of Lumiverse's requests for a reply reaches RPE.
  const origin = new URL(b.listening.url).origin;
  const pass = b.host.servers.get(origin)!;
  const arrived: number[] = [];
  b.host.servers.set(origin, (request) => {
    if (new URL(request.url).pathname.endsWith("/chat/completions")) arrived.push(Date.now());
    return pass(request);
  });

  const totals: number[] = [];
  const lane: number[] = [];
  for (let i = 0; i < TURNS; i++) {
    b.host.send(CHAT, `I count the hours, turn ${i}.`);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    const turn = await settledTurn(b, out.generationId!);
    const run = b.turns.runs.record(USER, turn.id)!;
    totals.push(run.started! - arrived[i]!);
    lane.push(run.started! - run.received);
  }
  expect(arrived).toHaveLength(TURNS);

  const steps = b.logged.filter((l) => l.message === "A turn's intake, in milliseconds by step.").map((l) => l.fields as Record<string, number>);
  expect(steps).toHaveLength(TURNS);
  const byStep = Object.fromEntries(Object.keys(steps[0]!).filter((k) => k !== "turn").map((k) => [k, { first: steps[0]![k]!, median: median(steps.slice(1).map((s) => s[k]!)) }]));
  console.log(JSON.stringify({ messages: MESSAGES + 2 * TURNS, turns: TURNS, total: { first: totals[0], median: median(totals), all: totals }, lane: { first: lane[0], median: median(lane) }, byStep }, null, 1));
  expect(median(totals)).toBeLessThanOrEqual(INTAKE_MS);
}, 60_000);
