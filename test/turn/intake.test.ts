// Intake, guarded (plan §4.7: "Intake (everything before the first model call): median ≤ 150 ms on a
// 10,000-message chat, not counting any wait for the previous turn's work, which is reported on its own";
// "database reads, no network; files written after the call starts, not before"; §17.1). The gate itself is
// measured on the test bed (READINGS R-15). This file is the suite's guard, and must not fail because the
// machine is busy: it asserts the order in which things happen, as the code records them, never a time. It
// fails if intake waits for the turn's folder or reads Lumiverse over the network; it reports intake's time
// by step, and the waits for the turn before on their own. With it, the waits kept apart on the run, and the
// run's timings in a database made before they were kept. Played through the stand-in Lumiverse with RPE
// reading its rows from the database file. Every name is invented.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Answer, gate } from "rp-harness/testing/rig";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { STORE_MIGRATIONS } from "../../src/store";
import { HARNESS_MIGRATIONS, PROMPT_MIGRATIONS, Runs } from "../../src/turn";
import { TURN_FILES } from "../../src/turn/folder";
import type { RunRecord } from "../../src/turn/runs";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

/** The per-test limit the suite's runner gives Bun and tells the file; run alone, the file gives itself 60 s, and tells the bed. */
const LIMIT_MS = Number(process.env.RPE_TEST_LIMIT_MS) || 60_000;
process.env.RPE_TEST_LIMIT_MS = String(LIMIT_MS);

const MESSAGES = 10_000;
/** Turns measured, each after the one before has settled. */
const TURNS = 3;
/** The shipped progress line that tells the player a request waits for the turn before (`.prompts/progress.md`, `waiting_previous`). */
const WAITING = "Finishing the last turn's work first.";

/** The player says something and asks for a reply; gives the turn once its end is recorded and no run of the chat goes on. */
async function playTurn(b: TurnBed, said: string) {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return await settledTurn(b, out.generationId!);
}

/** The files of a turn's folder only RPE writes: the harness writes its own views of the prompt there too, and `briefing.md`. */
function rpeFolderFile(path: string): boolean {
  return [TURN_FILES.lore, TURN_FILES.worldState, TURN_FILES.turn].some((name) => path.endsWith(`/${name}`)) || path.includes(`/${TURN_FILES.attempts}`);
}

/** Intake's steps and its waits, in the order they happened: each from where the one before it ended. */
function stretchesOf(run: RunRecord): { from: number; to: number; wait: boolean; step?: string }[] {
  return [...(run.intake ?? []).map((s) => ({ ...s, wait: false })), ...(run.wait ?? []).map((w) => ({ ...w, wait: true }))].sort((x, y) => x.from - y.from || x.to - y.to);
}

/** Intake's steps and waits follow one another from the request's arrival at the turn lane to the run's start, with no gap and no overlap. */
function expectTiled(run: RunRecord): void {
  const stretches = stretchesOf(run);
  expect(stretches.length).toBeGreaterThan(0);
  expect(stretches[0]!.from).toBe(run.received);
  for (let i = 1; i < stretches.length; i++) expect(stretches[i]!.from).toBe(stretches[i - 1]!.to);
  expect(stretches.at(-1)!.to).toBeLessThanOrEqual(run.started!);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe(`intake on a chat of ${MESSAGES} messages`, () => {
  let b: TurnBed;
  /** For each request for a reply, as it reached RPE: when, how many HTTP requests RPE had made of Lumiverse, and how many the model had been sent. */
  const arrived: { at: number; lumiverse: number; model: number }[] = [];
  /** For each run, as the harness was handed its request: how many HTTP requests RPE had made of Lumiverse by then. */
  const handed: number[] = [];
  /** By turn: how many requests the model had been sent when RPE asked for its folder's first file. */
  const folderFirst = new Map<string, number>();

  beforeAll(async () => {
    // Laid out once, before anything is measured.
    const messages = Array.from({ length: MESSAGES }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Line ${i}: the lamp turns over the grey water, and the keeper counts the hours until the tide.`,
    }));
    b = await openTurnBed({ answers: Array.from({ length: TURNS + 1 }, (_, i) => replying(`Reply ${i}.`)), messages });
    // One turn first, measured by nothing: Lumiverse then holds the breakdown it stores with every saved reply, as on a chat played this long.
    await playTurn(b, "I light the lamp.");

    const origin = new URL(b.listening.url).origin;
    const pass = b.host.servers.get(origin)!;
    b.host.servers.set(origin, (request) => {
      if (new URL(request.url).pathname.endsWith("/chat/completions")) arrived.push({ at: Date.now(), lumiverse: b.server.requests.length, model: b.model.requests.length });
      return pass(request);
    });
    const answer = b.turns.harness.answer;
    b.turns.harness.answer = (request, sink, signal) => {
      handed.push(b.server.requests.length);
      return answer(request, sink, signal);
    };
    const files = b.turns.files;
    const write = files.write;
    files.write = async (scope, path, op, by) => {
      const turn = "turn" in scope ? scope.turn : undefined;
      if (rpeFolderFile(path) && turn !== undefined && !folderFirst.has(turn)) folderFirst.set(turn, b.model.requests.length);
      return await write(scope, path, op, by);
    };
  }, LIMIT_MS);

  afterAll(async () => {
    await b?.close();
  });

  test("the Author starts with no folder written and nothing read over the network; intake's time is reported, the waits apart", async () => {
    const turns = [];
    for (let i = 0; i < TURNS; i++) turns.push(await playTurn(b, `I count the hours, turn ${i}.`));
    expect(arrived).toHaveLength(TURNS);
    expect(handed).toHaveLength(TURNS);

    const report = turns.map((turn, i) => {
      const run = b.turns.runs.record(USER, turn.id)!;
      // The folder's first file was asked for only once this turn's first request to the Author had gone out.
      expect(folderFirst.get(turn.id)).toBeGreaterThan(arrived[i]!.model);
      // From the request's arrival to the run's start, RPE asked nothing of Lumiverse over HTTP: its reads were of the database.
      expect(b.server.requests.slice(arrived[i]!.lumiverse, handed[i]!)).toEqual([]);
      // Intake's own steps and its waits, kept on the run one after another.
      expectTiled(run);
      const steps = Object.fromEntries((run.intake ?? []).map((s) => [s.step, s.to - s.from]));
      return { whole: run.started! - arrived[i]!.at, intake: (run.intake ?? []).reduce((ms, s) => ms + s.to - s.from, 0), wait: (run.wait ?? []).reduce((ms, w) => ms + w.to - w.from, 0), steps };
    });
    // Reported, never asserted: the gate is the bed's (R-15).
    console.log(JSON.stringify({ messages: MESSAGES, turns: TURNS, whole: median(report.map((r) => r.whole)), intake: median(report.map((r) => r.intake)), wait: median(report.map((r) => r.wait)), each: report }, null, 1));
  }, LIMIT_MS);
});

describe("the run's timings", () => {
  test("the wait kept apart", async () => {
    const after = gate();
    const answers: Answer[] = [
      // The first turn's reply, then work after it that holds until `after` opens.
      { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
      { pieces: [{ hold: after }, { text: "Noted." }] },
      replying("Wren looks up."),
    ];
    const w = await openTurnBed({ answers });
    try {
      // The first turn's end is held as it is recorded, where RPE reads back the reply Lumiverse saved, to tie the turn to it.
      const reads = w.composition.door.lumiverse()!.reads;
      const messagesById = reads.messagesById;
      const recorded = Promise.withResolvers<void>();
      let holding = false;
      reads.messagesById = async (chat, ids) => {
        if (!holding && ids.some((id) => w.host.chats.get(CHAT)?.messages.find((m) => m.id === id)?.role === "assistant")) {
          holding = true;
          await recorded.promise;
        }
        return await messagesById(chat, ids);
      };
      w.host.send(CHAT, "I climb the stairs.");
      const first = await w.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
      expect(first.error).toBeNull();
      await w.until("the first turn's end to be held, its run still at work", () => holding && w.turns.runs.ofChat(USER, CHAT).length === 1);

      // A second request: its intake waits for the first turn's end to be recorded, then for its run.
      w.host.send(CHAT, "I ask about the boat.");
      const second = w.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
      await w.until("the second request's intake to begin", () => w.turns.lane.intakesGoing() === 1);
      const endLetGo = Date.now();
      recorded.resolve();
      const generation = await w.until("the second request to be shown the wait for the first turn's run", () =>
        [...w.host.streams.keys()].find((g) => g !== first.generationId && (w.host.streams.get(g)?.reasoning ?? "").includes(WAITING)),
      );
      const runLetGo = Date.now();
      after.open();
      expect((await second).error).toBeNull();
      const turn = await settledTurn(w, generation);
      const run = w.turns.runs.record(USER, turn.id)!;

      // Two waits, each holding the moment its hold was let go: the first turn's end being recorded, then its run.
      expect(run.wait).toHaveLength(2);
      const [ending, running] = run.wait!;
      expect(ending!.from).toBeLessThanOrEqual(endLetGo);
      expect(ending!.to).toBeGreaterThanOrEqual(endLetGo);
      expect(running!.from).toBeLessThanOrEqual(runLetGo);
      expect(running!.to).toBeGreaterThanOrEqual(runLetGo);
      // Intake's own steps never hold a wait: steps and waits follow one another, each from where the one before it ended.
      expectTiled(run);
      expect(stretchesOf(run).filter((s) => s.wait)).toEqual(run.wait!.map((s) => ({ ...s, wait: true })));
    } finally {
      after.open();
      await w.close();
    }
  }, LIMIT_MS);

  test("a database made before the run's timings were kept opens with them empty", async () => {
    const place = await mkdtemp(join(tmpdir(), "rpe-timings-"));
    try {
      const db = openDatabase(join(place, "rpe.db"), 2_000);
      const before = new Migrations();
      before.add("store", STORE_MIGRATIONS);
      before.add("prompt", PROMPT_MIGRATIONS);
      before.add("harness", HARNESS_MIGRATIONS.filter((step) => step.version < 8));
      migrate(db, before, { user: USER, version: "before", backups: join(place, "backups"), now: () => 0 });
      db.run("INSERT INTO turn_run (user, id, turn, chat, session, generation, kind, status, received, started, ended, settled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [USER, "run-old", "turn-old", CHAT, "session-old", "gen-old", "new", "released", 1_000, 1_010, 2_000, 2_000]);
      const now = new Migrations();
      now.add("store", STORE_MIGRATIONS);
      now.add("prompt", PROMPT_MIGRATIONS);
      now.add("harness", HARNESS_MIGRATIONS);
      migrate(db, now, { user: USER, version: "after", backups: join(place, "backups"), now: () => 0 });

      const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('turn_run')").all().map((c) => c.name);
      expect(columns).toEqual(expect.arrayContaining(["intake", "wait", "folder"]));
      const writes = new WriteQueue(db, 50);
      const run = new Runs(db, writes).record(USER, "turn-old")!;
      expect(run).toMatchObject({ id: "run-old", received: 1_000, started: 1_010, ended: 2_000, intake: null, wait: null, folder: null });
      await writes.close();
      db.close();
    } finally {
      await rm(place, { recursive: true, force: true });
    }
  });
});
