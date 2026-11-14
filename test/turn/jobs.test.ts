// A job's work as the turn lane hears of it (plan §10.9, §13.5): what a job records, with the turn that
// started it, takes effect just before the first turn to begin after the harness says the job ended, and
// no turn begun before that has its state changed; that turn is told the job finished. And an engine
// handler that throws on such a change is an error for people, not for a model. Played through the
// stand-in Lumiverse on the scripted model, on a chat that plays an invented world; the job's end is
// told as the harness tells it, through the trace. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { TraceRecord } from "rp-harness/contract";
import type { LiveEvent } from "../../src/app/live";
import type { ChangeInput } from "../../src/store";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function worldBed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  await playsWorld(b, world());
  return b;
}

/** The player says something, unless it is a swipe, and asks for a reply; gives the turn's id once it is settled. */
async function play(b: TurnBed, said: string | null): Promise<string> {
  if (said !== null) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, ...(said === null ? { type: "swipe" as const } : {}) });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

const JOB = "job-ledger";

/** What a job's agent records, as the engine's tools record it for a job: with the turn that started the job. */
const sourMood: ChangeInput = { lane: "engine", op: "set", value: { type: "set", entity: "bram", field: "mood", value: "sour" }, by: "steward", source: "gm", job: JOB };

/** The harness telling the host that the job `turn` started has ended, as its trace does. */
function jobEnded(b: TurnBed, turn: string, session: string): void {
  const now = Date.now();
  const record: TraceRecord = {
    seq: 1,
    run: JOB,
    scope: { user: USER, chat: CHAT, session, turn },
    at: now,
    agent: { id: "a1", definition: "steward", job: JOB },
    event: {
      kind: "job",
      job: { id: JOB, agent: "steward", brief: "Tally the bar's stock.", state: "done", scope: { user: USER, chat: CHAT, session, turn }, startedBy: { id: "a0", definition: "author" }, started: now - 5, ended: now, usage: { calls: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5 } },
    },
  };
  b.turns.env.trace.event(record);
}

test("a job's change takes effect at the first turn to begin after the harness says the job ended, and changes no turn begun before", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram pours."), replying("Bram scowls at the till.")] });
  const store = b.turns.store.user(USER);
  const mood = (turn: string): unknown => store.stateAt(turn).state.world.entities.bram?.fields.mood;
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));

  const second = await play(b, "I order a drink.");
  expect(mood(second)).toBe("steady");

  jobEnded(b, first, b.turns.runs.record(USER, first)!.session);
  const third = await play(b, "I wait for the change.");
  expect(mood(third)).toBe("sour");
  expect(mood(second)).toBe("steady");
});

test("the turn a job's changes take effect at is told the job finished, once, and a swipe of it is told again", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram scowls at the till."), replying("Bram sighs at the till."), replying("Bram counts coins.")] });
  const store = b.turns.store.user(USER);
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));
  jobEnded(b, first, b.turns.runs.record(USER, first)!.session);

  await play(b, "I order a drink.");
  await play(b, null);
  await play(b, "I count my coins.");
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  const told = `A job finished: ${JOB}.`;
  expect(sent[0]).not.toContain(told);
  expect(sent[1]).toContain(told);
  expect(sent[2]).toContain(told);
  expect(sent[3]).not.toContain(told);
});

test("an engine handler that throws is told to the log and to the live view of the chat at work, and to no model", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram stares at nothing.")] });
  const store = b.turns.store.user(USER);
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));
  // From here the engine's handler for a field set throws, as a fault in the engine would. The registry is frozen, so the store folds
  // with a copy of it that answers the set's type with a broken handler.
  const registry = b.turns.store.env.registry;
  const broken = (type: string) => {
    const def = registry.get(type);
    return type !== "set" || def === undefined
      ? def
      : {
          ...def,
          apply: () => {
            throw new Error("the set handler broke");
          },
        };
  };
  b.turns.store.env.registry = { ...registry, get: broken };
  const published: LiveEvent[] = [];
  const publish = b.app.live.publish.bind(b.app.live);
  b.app.live.publish = (chat, event) => {
    const out = publish(chat, event);
    published.push(out);
    return out;
  };
  jobEnded(b, first, b.turns.runs.record(USER, first)!.session);
  const second = await play(b, "I wait.");

  expect(store.stateAt(second).state.world.entities.bram?.fields.mood).toBe("steady");
  expect(b.logged.some((l) => l.level === "error" && l.fields?.op === "set" && l.fields.error === "the set handler broke")).toBe(true);
  expect(published.filter((e) => e.kind === "handler_failed").map((e) => [e.chat, e.data])).toContainEqual([CHAT, { op: "set", error: "the set handler broke" }]);
  expect(b.model.requests.map((r) => JSON.stringify(r.messages)).join("\n")).not.toContain("the set handler broke");
});
