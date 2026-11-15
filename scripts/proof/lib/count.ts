// The count of a reply form over thirty turns (PlanGates-24 items 1 and 2; plan §18.1 row 0.2, §10.7): the
// floor chat's thirty lines (`LINES_30`) sent one at a time through the chat page on RPE's connection, the
// connection set to the form being counted for the run in the chat's own settings, each turn read from RPE's
// trace and judged by the counters (`./phase0.ts`) and by nothing written here. What it keeps for G0
// (`scripts/proof/g0/forms.ts`) is the count, in the gate's folder of the bundle, as `count.json`.
//
// A run with the floor's own reasons for a trial (a shipped tree that is not the build's, guidance in a
// layer, a lead that is not the Author) gives figures and no verdict on any turn. A setting that did not
// hold, a reply contract that names no tags, or a connection `run.json` does not name leave nothing played:
// the part is not judged, with why. A turn whose RPE side could not be read is `unread`, not a miss.

import type { Play } from "../route/form";
import { LINES_30 } from "../../testbed/floor-fixture";
import { TAGS_WORDS, TWO_STEP_WORDS, exactCalls, formCount, tagsOf, tagsTurn, twoStepTurn, type ReplyTags } from "./phase0";
import { ledAway, open, send, setSetting, authorConnection, type LoopReader, type Sent } from "./loop";
import type { BuildReader } from "./record";
import { leadStart } from "./turn";
import type { FloorActs } from "../floor/play";
import type { CountedForm, FormKept } from "../g0/forms";

/** What a count plays: the form, the value its connection is set to, and the gate's parts it judges each turn on. */
export interface CountSpec {
  form: CountedForm;
  /** The value of `reply.forms.<connection>` for the run. */
  setting: "tags" | "two-step";
  /** The part each turn is judged on as kept or not. */
  part: string;
  /** The part each turn's calls on the reply's path are judged on against exactly 2; null for the tag form, whose calls are G0's. */
  calls: string | null;
}

/** What a count made of its play. */
export interface Counted {
  /** The count kept, null where nothing was played (why in `unplayed`). */
  kept: FormKept | null;
  /** The floor's own reasons for a trial, found before the first line or in the turns' traces. */
  trials: string[];
  /** Why the play stopped before its thirtieth turn; null where it did not. */
  stopped: string | null;
  /** Why nothing was played, where nothing was. */
  unplayed: string | null;
}

/** One turn's outcome word and the calls on its reply's path, as the form's counter gives them; unread where its RPE side was not read. */
function outcomeOf(form: CountedForm, tags: ReplyTags, sent: Sent): { outcome: string; calls: number | null } {
  if (sent.read.rpe === null) return { outcome: "unread", calls: null };
  if (form === "tags") return { outcome: tagsTurn(sent.read.rpe.trace, tags), calls: null };
  return twoStepTurn(sent.read.rpe.trace, tags);
}

/** Plays the thirty lines in the form and judges each turn; keeps `count.json`. */
export async function playCount(play: Play, acts: FloorActs, reader: LoopReader, build: BuildReader | null, spec: CountSpec): Promise<Counted> {
  const opened = await open(play, acts, reader, build);
  const connection = authorConnection(play.run);
  const unplayed = async (why: string): Promise<Counted> => {
    await play.notJudged(spec.part, why);
    if (spec.calls !== null) await play.notJudged(spec.calls, why);
    return { kept: null, trials: opened.trials, stopped: null, unplayed: why };
  };
  if (connection === null) return unplayed("run.json names no Author among its agents, so the connection whose form is counted is not known");
  const held = await setSetting(reader, opened.chat, `reply.forms.${connection}`, spec.setting);
  if (held !== null) return unplayed(`the connection was not set to the ${spec.form} form for the run: ${held}`);
  let tags: ReplyTags | { none: string };
  try {
    tags = tagsOf(await reader.contract(opened.chat));
  } catch (error) {
    return unplayed(`the reply contract could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if ("none" in tags) return unplayed(`the tags to count by are not known: ${tags.none}`);
  const sent: Sent[] = [];
  let stopped: string | null = null;
  for (const line of LINES_30) {
    const one = await send(acts, reader, opened, line, opened.fixture.preset.id);
    sent.push(one);
    if (one.stopped !== null) {
      stopped = `turn ${sent.length}: ${one.stopped}`;
      break;
    }
  }
  const trials = [...opened.trials, ...ledAway(opened.ground.observed.leads.expected, sent)];
  const results = sent.map((s) => outcomeOf(spec.form, tags, s));
  const judged = results.filter((r) => r.outcome !== "unread");
  const first = sent.map((s) => (s.read.rpe === null ? null : leadStart(s.read.rpe.trace))).find((s) => s !== null && s !== undefined) ?? null;
  const kept: FormKept = {
    kind: "form-count",
    form: spec.form,
    run: play.run.run,
    nonce: play.run.nonce ?? null,
    connection: first?.connection ?? connection,
    model: first?.model ?? null,
    count: formCount(
      judged.map((r) => r.outcome),
      results.length - judged.length,
    ),
    calls: spec.form === "two-step" ? exactCalls(judged.map((r) => r.calls), 2) : null,
    turns: sent.map((s, i) => ({ line: s.line, outcome: results[i]?.outcome ?? "unread", calls: results[i]?.calls ?? null })),
  };
  await play.keep("count", { ...kept });
  const figures = `kept in ${kept.count.kept} of ${kept.count.played} turns${kept.count.unread > 0 ? ` (${kept.count.unread} unread)` : ""}${kept.calls === null ? "" : `; exactly 2 calls in ${kept.calls.exact} of ${kept.calls.of}`}`;
  if (trials.length > 0) {
    await play.notJudged(spec.part, `trial: ${trials.join("; ")}; figures: ${figures}`);
    if (spec.calls !== null) await play.notJudged(spec.calls, `trial: ${trials.join("; ")}; figures: ${figures}`);
    return { kept, trials, stopped, unplayed: null };
  }
  const words: Readonly<Record<string, string>> = spec.form === "tags" ? TAGS_WORDS : TWO_STEP_WORDS;
  for (const [i, s] of sent.entries()) {
    const r = results[i];
    if (r === undefined) continue;
    if (r.outcome === "unread") {
      await play.notJudged(spec.part, `turn ${i + 1}: its RPE side could not be read: ${s.unread ?? "unknown"}`);
      if (spec.calls !== null) await play.notJudged(spec.calls, `turn ${i + 1}: its RPE side could not be read`);
      continue;
    }
    await play.judge(spec.part, { pass: r.outcome === "kept", what: `turn ${i + 1}: ${words[r.outcome] ?? r.outcome}` });
    if (spec.calls !== null) await play.judge(spec.calls, { pass: r.calls === 2, what: `turn ${i + 1}: ${r.calls === null ? "no call counted: the reply was never released" : `${r.calls} call(s) before the reply's release`}` });
  }
  return { kept, trials, stopped, unplayed: null };
}
