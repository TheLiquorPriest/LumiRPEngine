// The floor's instrument proven (PlanGates-41; plan §17.1 l.1761, §18.3): the ten pairs of the floor played in the rig, by the floor's own
// play (`playPairs`) through the rig host's acts, the chat page and the stand-in, against scripted replies whose delays are set here, and
// the numbers the floor's own rows print (`measuredRows`, `Row.figures`) held to those delays, in both of the Author's reply forms.
//
// What each number is, in the delays set. Plain generation (the stand-in's scripted provider): thinking arrives `firstThinking` after Send,
// the first word `firstWord` after Send, a word every `between`, the stream ends `end` after the last. RPE's Author is the rig's script,
// paced the same way (`scripts.ts` `paced`, a delay before the first thinking, before the first text, and between pieces; each model call
// of the script is paced on its own):
//   - Tag form, one call: two thinking pieces, the intent record in three pieces, then the reply's words. First thinking at `firstThinking`,
//     the record's pieces from `firstWord + between`, a gap apart, the reply's first word one gap after the record's last piece.
//   - Two-step form, two calls: the first thinks (two pieces) and writes the record to its file; the second thinks (one piece) and writes
//     the reply as its message, a word every `between`, and ends `end` after its last word; the reply is shown at that message's end.
// The floor takes the record's own time off RPE's time to its first word (tag) or to its message's end (two-step), and compares with plain's
// time to its first word (tag) or its last (two-step). Time per token is a stream's first word to its last over the tokens Lumiverse counts
// in the shown reply, less one: on RPE's own live socket in the two-step form, where the page shows the reply whole.
//
// The page's figure is the scripted delay plus the path from Send to the first piece (the two requests Send makes, RPE's turn route, the
// stand-in's forty-millisecond batching of a stream): a constant of the rig, never negative. So each moment is held to its delay within
// [-resolution, +PATH_MS], each span between two moments of one stream within SPAN_MS, and a second run with one arm's delays changed by
// more than that must come out off by what was changed (the check can fail). A timing test in the suite is a guard, not the gate
// (READINGS R-15): the allowances are the rig's own, so a busy machine does not fail it.

import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { liveReader, playPairs, type FloorActs } from "../../../scripts/proof/floor/play";
import type { Play } from "../../../scripts/proof/route/form";
import type { Host, PlayStart } from "../../../scripts/proof/route/host";
import { liveLoopReader, setSetting } from "../../../scripts/proof/lib/loop";
import { openRig, REPLY_WORDS, type RigActs } from "../../../scripts/proof/rig/host";
import type { Delays } from "../../../scripts/proof/rig/scripts";
import { releaseUi } from "../../../scripts/proof/rig/ui";
import { measuredRows, median, type FloorRun, type Form, type Row } from "../../../scripts/testbed/floor-measure";
import type { Answer, Piece, RecordedRequest, Reply } from "rp-harness/testing/rig";
import { recordOf } from "./replay";

const ROOT = resolve(import.meta.dir, "../../../scripts/proof");

/** What the page's clock cannot tell from the path before a reply's first piece: the two requests Send makes, RPE's turn route, its intake before the first call, a batch of the stream (40 ms), and a loaded machine. */
const PATH_MS = 300;
/** The same in the two-step form, where the reply's message comes after the first call's tool, its answer and the second call's start (measured 235 to 290 ms of path on a machine at load 5 to 7). */
const TWO_STEP_PATH_MS = 350;
/** What a span between two moments of one stream can be off its gaps by: the stream's batch at each end, and a loaded machine. */
const SPAN_MS = 100;
/** What a moment's change between two runs can be off the change made: the path's own jitter in the median of ten, each way. */
const SHIFT_MS = 60;

afterAll(releaseUi);

/** Every delay of both arms: what one run of the floor is played with. */
interface ArmsDelays {
  plain: Required<Delays>;
  rpe: Required<Delays>;
}

/** The delays the first run is played with: both arms think first, plain's first word comes later than RPE's, each arm has its own pace. */
const DELAYS: ArmsDelays = {
  plain: { firstThinking: 150, firstWord: 450, between: 80, end: 120 },
  rpe: { firstThinking: 100, firstWord: 250, between: 70, end: 0 },
};

/** The second run: plain's first word 500 ms later and its pace 50 ms slower; RPE's delays are as they were. */
const SLOWER: ArmsDelays = { plain: { ...DELAYS.plain, firstWord: DELAYS.plain.firstWord + 500, between: DELAYS.plain.between + 50 }, rpe: DELAYS.rpe };

/** The two-step run: RPE's reply message ends 80 ms after its last word (the page shows it then); plain's delays are as they were. */
const TWO_STEP: ArmsDelays = { plain: DELAYS.plain, rpe: { ...DELAYS.rpe, end: 80 } };

/** What the two-step run's figures are held to wrongly: RPE's first word 300 ms later and its message ending 300 ms later than it did. */
const LATER: ArmsDelays = { plain: TWO_STEP.plain, rpe: { ...TWO_STEP.rpe, firstWord: TWO_STEP.rpe.firstWord + 300, end: TWO_STEP.rpe.end + 300 } };

const THINKING_PIECES = ["The scene ", "asks for one beat."];
const INTENT_PIECES = ["<intent>Turn one: the scene", " goes on,", " one beat.</intent>"];

/** The Author's replies in the tag form: its thinking, the intent record in pieces, the reply's words with the tags on the first and last. */
function tagAuthor(count: number): Answer[] {
  return Array.from({ length: count }, (): Answer => ({
    pieces: [
      ...THINKING_PIECES.map((thinking): Piece => ({ thinking })),
      ...INTENT_PIECES.map((text): Piece => ({ text })),
      ...REPLY_WORDS.map((word, at): Piece => ({ text: `${at === 0 ? "<reply>" : ""}${word}${at === REPLY_WORDS.length - 1 ? "</reply>" : ""}` })),
    ],
  }));
}

/** The intent file the Author's briefing names for the turn (`guidance/.prompts/briefing.md`, "This turn's intent file"). */
const INTENT_PATH = /This turn's intent file: `([^`]+)`/;

/** What a request says, every message's text whatever its parts. */
function requestText(request: RecordedRequest): string {
  return request.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

/** The Author's replies in the two-step form, two calls to a turn: the first thinks and writes the record to the file its briefing names, the second thinks and writes the reply as its message. */
function twoStepAuthor(turns: number): Answer[] {
  const record = (request: RecordedRequest): Reply => {
    const path = INTENT_PATH.exec(requestText(request))?.[1];
    if (path === undefined) throw new Error("the Author's briefing names no intent file for this turn, so a two-step record cannot be written");
    return { pieces: [...THINKING_PIECES.map((thinking): Piece => ({ thinking })), { call: "file_write", args: { path, op: "write", text: "The scene goes on, one beat." } }] };
  };
  const message: Reply = { pieces: [{ thinking: "The record is written." }, ...REPLY_WORDS.map((text): Piece => ({ text }))] };
  return Array.from({ length: turns }).flatMap((): Answer[] => [record, message]);
}

/** One figure the floor printed, what the delays say it is, and how far off it may be. */
interface Figure {
  name: string;
  measured: number | null;
  expected: number;
  /** How much below and above `expected` the measure may be. */
  below: number;
  above: number;
}

/** What a run of the floor made: its turns as the floor read them, and the figures its rows printed. */
interface Played {
  run: FloorRun;
  rows: Record<"first-words" | "per-token", Row>;
  resolution: number;
  tokens: number;
}

/** The Author's gaps and the shown reply's tokens, as the rows divide them: the words' gaps in the reply over the tokens Lumiverse counts in it, less one. */
const gapsPerToken = (tokens: number, between: number): number => ((REPLY_WORDS.length - 1) * between) / (tokens - 1);

/** What the delays say each figure of the floor's two rows is, in the form the run was played in. */
function expectedOf(d: ArmsDelays, played: Played): Figure[] {
  const { rows, resolution, tokens } = played;
  const twoStep = played.run.form === "two-step";
  const first = rows["first-words"].figures ?? {};
  const token = rows["per-token"].figures ?? {};
  const moment = (name: string, measured: number | null, expected: number): Figure => ({ name, measured, expected, below: resolution, above: twoStep ? TWO_STEP_PATH_MS : PATH_MS });
  const span = (name: string, measured: number | null, expected: number, over = 1): Figure => ({ name, measured, expected, below: SPAN_MS / over, above: SPAN_MS / over });
  const gaps = (REPLY_WORDS.length - 1) * d.plain.between;
  const plainEnd = median(played.run.turns.filter((t) => t.arm === "plain" && t.page !== null && t.page.ended !== null && t.page.lastWord !== null).map((t) => (t.page?.ended ?? 0) - (t.page?.lastWord ?? 0)));
  // Plain's time to the figure it is compared at: its first word (tag), its last (two-step).
  const plainAt = d.plain.firstWord + (twoStep ? gaps : 0);
  // RPE's time to the reply, and what the floor takes off it. Tag: the record's pieces are two gaps long, and the reply's first word comes one gap after them.
  // Two-step: call one thinks for its first thinking and one gap (its second thought), writes the record and ends `end` after it (every scripted answer ends so: call one's end is 80 ms of the trace, 254 ms in all), call two's reply comes at its first word, a gap apart, and ends `end` after its last.
  const unadjusted = twoStep ? d.rpe.firstThinking + d.rpe.between + d.rpe.end + d.rpe.firstWord + (REPLY_WORDS.length - 1) * d.rpe.between + d.rpe.end : d.rpe.firstWord + 4 * d.rpe.between;
  const record = twoStep ? 0 : 2 * d.rpe.between;
  const own = twoStep ? span("RPE: the record's own time (a tool call's write)", first.intent ?? null, 0) : span("RPE: the record's own time", first.intent ?? null, record);
  return [
    moment(twoStep ? "plain: last word" : "plain: first word", first.plain ?? null, plainAt),
    span("plain: thinking", first.thinkingPlain ?? null, d.plain.firstWord - d.plain.firstThinking),
    moment("plain: end after its last word", plainEnd, d.plain.end),
    span("plain: per token", token.plain ?? null, gapsPerToken(tokens, d.plain.between), tokens - 1),
    own,
    span("RPE: thinking", first.thinkingRpe ?? null, d.rpe.between),
    moment(twoStep ? "RPE: message ended, the record not taken off" : "RPE: first word, the record not taken off", first.rpeUnadjusted ?? null, unadjusted),
    moment(twoStep ? "RPE: message ended, less the record" : "RPE: first word, less the record", first.rpe ?? null, unadjusted - record),
    span("RPE: per token", token.rpe ?? null, gapsPerToken(tokens, d.rpe.between), tokens - 1),
    { name: "RPE less plain, first words", measured: first.over ?? null, expected: unadjusted - record - plainAt, below: resolution + PATH_MS, above: PATH_MS + resolution },
    ...(twoStep ? [] : [{ name: "RPE over plain, per token", measured: token.over ?? null, expected: d.rpe.between / d.plain.between - 1, below: 0.15, above: 0.15 }]),
  ];
}

/** The figures that are not what the delays say, each with how far off it is (null where the floor printed none). */
function faultsOf(figures: readonly Figure[]): { name: string; off: number | null }[] {
  return figures.flatMap((f): { name: string; off: number | null }[] => {
    if (f.measured === null) return [{ name: f.name, off: null }];
    const off = f.measured - f.expected;
    return off < -f.below || off > f.above ? [{ name: f.name, off }] : [];
  });
}

/** A play of a form, as the floor's own play needs one: the pairs are played and kept, nothing is looked at or judged. */
function playOf(acts: FloorActs, run: Play["run"], look: Play["look"], keep: (name: string, data: unknown) => void): Play<FloorActs> {
  const refused = async (): Promise<never> => {
    throw new Error("the floor's pairs look at no page and judge no part: the rig test reads the table's own figures");
  };
  return {
    mode: "rig",
    play: 1,
    plays: 1,
    acts,
    look,
    run,
    standing: { is: "verdict", why: [] },
    see: refused,
    judge: refused,
    notJudged: refused,
    declareGuidanceChange: () => undefined,
    keep: async (name, data) => void keep(name, data),
  };
}

/**
 * The ten pairs of the floor, played in a rig whose scripted replies have these delays. In the two-step form RPE's chat is set to it, as RPE's
 * own `reply.form` setting does it, and the run's record names the Author's form as `agentFacts` reads it from that setting (`streams` is
 * false where no `reply.streamAnyway` names the connection); the trace of each turn then shows whether RPE played it (`formFaults`).
 */
async function floorPlayed(delays: ArmsDelays, form: Form, scripts: Record<string, readonly Answer[]>): Promise<Played> {
  const kept = new Map<string, unknown>();
  const start: PlayStart = { form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: ROOT, bed: [] }, play: 1, plays: 1, keep: async (name, data) => void kept.set(name, data) };
  const host: Host<RigActs> = await openRig({ root: ROOT, run: "rig-floor-times", pin: { stage: "before-publishing" }, delays, scripts });
  try {
    const facts = await host.facts();
    const record = recordOf(form === "tag" ? facts : { ...facts, agents: facts.agents.map((a) => (a.agent === "author" ? { ...a, replyForm: "two-step", streams: false } : a)) });
    const session = await host.begin(start);
    try {
      const own = session.acts;
      const acts: FloorActs = {
        lumiverse: own.lumiverse,
        rpe: own.rpe,
        connections: own.connections,
        send: own.send,
        async chat(card) {
          const chat = await own.chat(card);
          if (form === "two-step") {
            const held = await setSetting(liveLoopReader(own), chat, "reply.form", "two-step");
            if (held !== null) throw new Error(`the rig's chat could not be set to the two-step form: ${held}`);
          }
          return chat;
        },
      };
      const reader = liveReader(acts);
      try {
        const { run } = await playPairs(playOf(acts, record, session.browser, (name, data) => void kept.set(name, data)), acts, reader, null, null);
        const counted = new Set(run.turns.map((t) => t.visible));
        const [tokens] = [...counted];
        if (counted.size !== 1 || tokens === null || tokens === undefined) throw new Error(`the shown reply's tokens, as Lumiverse counts them, are not one number over the twenty turns: ${[...counted].join(", ")}`);
        const resolution = Math.max(...run.turns.map((t) => t.page?.resolution ?? Number.POSITIVE_INFINITY));
        const rows = measuredRows(run);
        return { run, rows: { "first-words": rows["first-words"], "per-token": rows["per-token"] }, resolution, tokens };
      } finally {
        reader.close();
      }
    } finally {
      await session.close();
    }
  } finally {
    await host.close();
  }
}

describe("the floor's numbers are the delays of the scripted replies, in the tag form", () => {
  let first: Promise<Played> | null = null;
  const firstRun = (): Promise<Played> => (first ??= floorPlayed(DELAYS, "tag", { author: tagAuthor(12) }));

  test("ten pairs through the chat page: every turn read, the Author leading, and the floor's rows hold the delays set", async () => {
    const played = await firstRun();
    expect(played.run.form).toBe("tag");
    expect(played.run.stopped).toBeNull();
    expect(played.run.turns).toHaveLength(20);
    expect(played.run.turns.every((t) => t.error === null && t.page !== null)).toBe(true);
    expect(played.resolution).toBeLessThan(5);
    expect(faultsOf(expectedOf(DELAYS, played))).toEqual([]);
    // The rows print these numbers: their words carry what their figures are made of.
    expect(played.rows["first-words"].measured).toContain(`plain ${((played.rows["first-words"].figures?.plain ?? 0) / 1000).toFixed(2)} s`);
    expect(played.rows["per-token"].measured).toContain(`plain ${(played.rows["per-token"].figures?.plain ?? 0).toFixed(1)} ms per token`);
  }, 300_000);

  test("it can fail: the same ten pairs with plain's first word 500 ms later and its pace 50 ms slower come out off by exactly that, and the check against the first run's delays fails", async () => {
    const before = await firstRun();
    const after = await floorPlayed(SLOWER, "tag", { author: tagAuthor(12) });
    expect(faultsOf(expectedOf(SLOWER, after))).toEqual([]);
    const figures = (played: Played, d: ArmsDelays): Map<string, Figure> => new Map(expectedOf(d, played).map((f) => [f.name, f]));
    const was = figures(before, DELAYS);
    const now = figures(after, SLOWER);
    const moved = (name: string): number => (now.get(name)?.measured ?? Number.NaN) - (was.get(name)?.measured ?? Number.NaN);
    // What was changed is what moved: plain's first word, its thinking (its first thinking did not move), its pace per token, and so RPE less plain.
    expect(Math.abs(moved("plain: first word") - 500)).toBeLessThan(SHIFT_MS);
    expect(Math.abs(moved("plain: thinking") - 500)).toBeLessThan(SHIFT_MS);
    expect(Math.abs(moved("plain: per token") - gapsPerToken(after.tokens, 50))).toBeLessThan((2 * SPAN_MS) / (after.tokens - 1));
    expect(Math.abs(moved("RPE less plain, first words") + 500)).toBeLessThan(SHIFT_MS);
    // What was not changed did not move.
    for (const name of ["RPE: first word, less the record", "RPE: first word, the record not taken off", "RPE: the record's own time", "RPE: thinking"]) expect(Math.abs(moved(name))).toBeLessThan(SHIFT_MS);
    expect(Math.abs(moved("RPE: per token"))).toBeLessThan((2 * SPAN_MS) / (after.tokens - 1));
    // The second run's figures against the first run's delays: the check fails, naming what was changed and by what.
    const wrong = faultsOf(expectedOf(DELAYS, after));
    expect(wrong.map((f) => f.name).sort()).toEqual(["RPE less plain, first words", "RPE over plain, per token", "plain: first word", "plain: per token", "plain: thinking"].sort());
    expect(Math.abs((wrong.find((f) => f.name === "plain: first word")?.off ?? 0) - 500)).toBeLessThan(SHIFT_MS);
    expect(Math.abs((wrong.find((f) => f.name === "plain: thinking")?.off ?? 0) - 500)).toBeLessThan(SHIFT_MS);
  }, 400_000);
});

describe("the floor's numbers are the delays of the scripted replies, in the two-step form", () => {
  test("ten pairs: RPE's chat in the form, two calls to a turn, the reply shown when its message ends; the floor's rows hold the delays set, and held to RPE's later ones they fail", async () => {
    const played = await floorPlayed(TWO_STEP, "two-step", { author: twoStepAuthor(14) });
    expect(played.run.form).toBe("two-step");
    expect(played.run.stopped).toBeNull();
    expect(played.run.turns).toHaveLength(20);
    expect(played.run.turns.every((t) => t.error === null && t.page !== null)).toBe(true);
    // RPE played the form the record names: every release is a message's, and the reply was shown whole, not streamed.
    expect(played.rows["first-words"].why.filter((why) => why.includes("released as"))).toEqual([]);
    expect(played.rows["per-token"].why.filter((why) => why.includes("released as"))).toEqual([]);
    expect(played.rows["first-words"].why.filter((why) => why.startsWith("streamed"))).toEqual([]);
    expect(faultsOf(expectedOf(TWO_STEP, played))).toEqual([]);
    // The same figures held to delays RPE did not have (its first word 300 ms and its message's end 300 ms later): off by more than the path can account for, in the figures that rest on them and no other.
    const wrong = faultsOf(expectedOf(LATER, played));
    expect(wrong.map((f) => f.name).sort()).toEqual(["RPE less plain, first words", "RPE: message ended, less the record", "RPE: message ended, the record not taken off"].sort());
    for (const f of wrong) expect(f.off ?? Number.POSITIVE_INFINITY).toBeLessThan(-(600 - TWO_STEP_PATH_MS));
  }, 300_000);
});
