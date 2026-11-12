// When a run of the prepared start ends (DEPTH2-PLAN §1.11; LumiAH's `runEnded` for the
// preparation's job): the engine carries the preparation on in a new run by itself, or stops and
// says why. The player can play, leave and come back while it runs, and nothing is spent that they
// haven't seen the cost of.
//
// A new run starts if and only if the run that ended is the preparation's latest job and ended on
// its own, not held or cancelled by the player; the preparation isn't finished; its plan, once
// written with every word of the player's answered, has their word as it now stands and nothing in
// it waits for their word (a run that ended before the plan was written, or before it answered
// what the player said, is carried on to write it);
// what the preparation has spent leaves room under their cap for another run; the run didn't fail
// on what it runs on, which a new run would only meet again (no connection, a key or a model
// refused: LumiAH marks such a job `lasting`), stop at a day's limit, or get cut off; and fewer
// runs it started by itself in a row than Settings → Story → Preparing → Runs without progress
// moved the preparation nothing forward. Forward is the file's own account: something it named as
// left (`preparationLeft`, which follows the depth the player chose) is done, more beats are
// recorded, more stretches recorded or dropped, more principals have taken in what was recorded,
// or, while it plans, more of the survey is read, the story file changed, or more of the player's
// words are answered. A run started so is logged "carried"; one not started is logged "stopped" with why, in
// plain words, which the card says (`pageState`). A run the player held or cancelled needs no word:
// its job says it.
//
// Whenever a run of it ends, what each of its runs that ended spent is written into the file by job
// (`PrepareState.runs`), so what the whole preparation spent, and the cap held to it, never loses a
// run that fell out of the jobs LumiAH lists (`spentOf`).
//
// How far the preparation had come as each run it started began is kept in this process only:
// after a restart the count of runs without progress starts again.

import type { ChatId, UserId } from "../../shared/ids";
import type { PromptTexts } from "../../shared/prompts";
import type { StoryPath } from "../../engine/story/record";
import type { HarnessFiles } from "../agents/tools/harness-ports";
import type { Runtime } from "../runtime";
import { PREPARE_STORY } from "../../shared/harness-texts-prepare";
import { callWeight, carryOn, jobRows, logPrepare, planned, preparationLeft, type PrepareState, preparing, readPrepare, spentOf, unanswered, UNDER_WAY, updatePrepare, waits, withRelived } from "./prepare";
import { prepareRun } from "./prepare-run";
import { chatStoryPort } from "./record";

/** How far the preparation has come: what its file's own account says is left of it, and what it has done that only grows. */
interface Mark {
  left: string[];
  /** Beats recorded, over all its stretches. */
  beats: number;
  /** Stretches recorded or dropped. */
  settled: number;
  /** Principals through a recorded stretch, over all of them. */
  relived: number;
  /** What planning has to show for itself: the survey's parts read, the story file as it stands, the principals cast, and how many of the player's words are answered. */
  notes: string;
}

/** For each chat whose preparation the engine carried on, by user and chat: the run it started, how far the preparation had come as it started, and how many runs in a row before it moved it nothing forward. */
const carried = new Map<string, { job: string; mark: Mark; idle: number }>();

const count = (n: number): string => n.toLocaleString("en-US");

/** A reason as LumiAH words it, ready to end a sentence: without a full stop of its own. */
const said = (reason: string | null, none: string): string => (reason ?? none).replace(/[.\s]+$/, "");

/** Why it stopped instead of carrying on, as the card and the live view say it. */
const WORDS = {
  waits: "It waits for your word on the plan before it goes on.",
  lasting: (reason: string | null): string => `It stopped: ${said(reason, "what it runs on failed")}. A new run would only fail the same way, so none was started. Put that right, then carry it on.`,
  day: (reason: string | null): string => `It stopped at a day's limit: ${said(reason, "a limit on a day's spend")}. A new run would stop there too. Carry it on once the day's count allows.`,
  cutOff: "The run was cut off before it finished, so no new one was started. Carry it on when you are ready.",
  capped: (spent: number, cap: number): string => `It has spent ${count(spent)} tokens of the ${count(cap)} your cap allows, too few for another run. Raise the cap, then carry it on.`,
  idle: (runs: number): string => `${runs === 1 ? "Its last run" : `Its last ${count(runs)} runs`} made no progress, so it stopped carrying on by itself. Tell the author what to change, or carry it on.`,
  unstarted: (reason: string): string => `Its next run couldn't start: ${said(reason, "LumiAH refused it")}. Carry it on once that is put right.`,
};

/** How far the preparation (`state`) has come, with the story as it stands (`path`). */
async function markOf(files: Pick<HarnessFiles, "read">, state: PrepareState, path: StoryPath | null, texts: PromptTexts): Promise<Mark> {
  const through = path ? withRelived(state, path, Date.now()).stretches : state.stretches;
  return {
    left: await preparationLeft(files, state, path, texts),
    beats: state.stretches.reduce((n, s) => n + s.beats.length, 0),
    settled: state.stretches.filter((s) => s.state === "recorded" || s.state === "dropped").length,
    relived: through.reduce((n, s) => n + (s.relived?.length ?? 0), 0),
    notes: JSON.stringify([state.read ?? [], (await files.read(PREPARE_STORY))?.version ?? null, state.principals.length, state.word.said.length - unanswered(state).length]),
  };
}

/**
 * A job of the chat's ended its run (`job`): what each run of the preparation that ended spent is
 * kept in its file; and where the job is the preparation's latest, the preparation is carried on in
 * a new run, or stopped with why logged in its file. Anything else is left alone.
 */
export async function preparationRunEnded(rt: Runtime, at: { chatId: ChatId; userId: UserId; job: string }): Promise<void> {
  const core = rt.harness.core;
  const files = rt.harness.files?.({ chatId: at.chatId, userId: at.userId }) ?? null;
  if (core === null || files === null) return;
  const where = { chatId: at.chatId, userId: at.userId };
  const rows = await jobRows(core, where);
  const settings = await rt.settings.get(at.userId);
  const { texts } = settings.prompts;
  const { prepare } = settings.story;
  // What each run of it that ended spent goes into the file, by job, at the most LumiAH has counted of it (a job a run started is charged to that run when it ends): what the whole preparation spent never loses a run that falls out of the jobs LumiAH lists.
  const counted = await updatePrepare<null>(files, texts, (now) => {
    if (!now.state) return { stop: null };
    const runs = [...(now.state.runs ?? [])];
    let more = false;
    for (const r of rows) {
      if (!preparing(r) || UNDER_WAY.includes(r.state)) continue;
      const i = runs.findIndex((k) => k.job === r.id);
      const was = runs[i];
      if (was !== undefined && was.tokens >= r.tokens && was.calls >= r.calls) continue;
      const entry = { job: r.id, tokens: Math.max(r.tokens, was?.tokens ?? 0), calls: Math.max(r.calls, was?.calls ?? 0) };
      if (was !== undefined) runs[i] = entry;
      else runs.push(entry);
      more = true;
    }
    return more ? { ...now.state, runs } : { stop: null };
  });
  if ("failed" in counted) rt.host.log("warn", `[LumiRPEngine] chat ${at.chatId}: what the preparation's runs spent wasn't written to its file (${counted.failed})`, at.userId);
  const ended = rows.find(preparing);
  // Only the preparation's latest job carries it on; one the player started since stands, and one they held or cancelled is theirs.
  if (ended?.id !== at.job || ended.paused || ended.state === "cancelled" || UNDER_WAY.includes(ended.state)) return;
  if ((await rt.chatKnowledge.engine(at.chatId, at.userId)) !== "harness") return;
  const key = `${at.userId}\u0000${at.chatId}`;
  const chain = carried.get(key);
  const log = async (entry: { what: "carried" | "stopped"; text?: string }): Promise<void> => {
    const out = await updatePrepare<null>(files, texts, (now) => (now.state ? logPrepare(now.state, { at: Date.now(), ...entry }) : { stop: null }));
    if ("failed" in out) rt.host.log("warn", `[LumiRPEngine] chat ${at.chatId}: the preparation's log wasn't written (${out.failed})`, at.userId);
  };
  const stop = (text: string): Promise<void> => {
    carried.delete(key);
    return log({ what: "stopped", text });
  };
  // No plan to carry on, a file that can't be read, or a preparation finished: the card says so from the file and the job.
  const file = await readPrepare(files);
  const state = file.state;
  if (file.damaged || state === null || state.done !== null) return;
  // The author's run ended before its plan did (none written yet, or what the player said not answered): it is carried on like any other run, and stopped like any other once runs move nothing forward. A plan that is written waits for the player's word.
  const planning = !planned(state) || unanswered(state).length > 0;
  if (!planning && (waits(state) || !state.word.approved)) return stop(WORDS.waits);
  if (ended.state === "failed" && ended.lasting) return stop(WORDS.lasting(ended.reason));
  if (ended.state === "spent" && ended.stoppedAt === "day") return stop(WORDS.day(ended.reason));
  if (ended.state === "interrupted" || ended.state === "off_path") return stop(WORDS.cutOff);
  // The cap holds whatever a run is allowed: no run starts that one more call would take past it.
  const spent = spentOf(core, where, rows, state.runs ?? []);
  const { cap } = state.word;
  if (cap !== null && spent.tokens + callWeight(spent, prepare).tokens > cap) return stop(WORDS.capped(spent.tokens, cap));
  const read = await chatStoryPort(rt, { ...where, turn: "", on: "first" }).read();
  const mark = await markOf(files, state, read?.path ?? null, texts);
  // A run the engine didn't start is the player's word: the count of runs without progress starts again after it. One it started moved the preparation forward where more is recorded or taken in than as it began, or something then left is done.
  const before = chain?.job === at.job ? chain : null;
  const idle = before === null || mark.beats > before.mark.beats || mark.settled > before.mark.settled || mark.relived > before.mark.relived || mark.notes !== before.mark.notes || before.mark.left.some((line) => !mark.left.includes(line)) ? 0 : before.idle + 1;
  if (idle >= prepare.idleRuns) return stop(WORDS.idle(idle));
  // Read again just before it starts: a run the player started meanwhile stands.
  if ((await jobRows(core, where)).find(preparing)?.id !== at.job) return;
  let job: string | null;
  try {
    job = await carryOn(core, where, texts, state, prepareRun(prepare, texts));
  } catch (error) {
    return stop(WORDS.unstarted(error instanceof Error ? error.message : String(error)));
  }
  if (job !== null) carried.set(key, { job, mark, idle });
  await log({ what: "carried" });
}
