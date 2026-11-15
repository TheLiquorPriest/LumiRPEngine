// Row 0.2's tags, thirty turns on the floor chat (PlanGates-24 item 1; plan §18.1 row 0.2, §10.7, §17.1
// l.1773), and pi's loop told to the owner (item 4). The count is `../lib/count.ts`'s over the counters of
// `../lib/phase0.ts`; the notices go out through G0's module (`../g0/notice.ts`) the moment they are found:
// the loop's before the first turn (it is known, and the loop packages wait on it), the floor model's form
// when the count falls below the plan's 28 of 30 on a play that gives a verdict. The loop's three findings
// are re-checked against the installed pi and RPH (`../lib/pi.ts`) and judged as the part `loop`: met
// where every finding still reads as Phase 0 found it, unmet where one no longer does (the notice's words
// then need the lead's reading), not judged where the installed sources could not be read.

import { resolve } from "node:path";
import type { Play } from "../route/form";
import { isFloorActs, missingActs, type FloorActs } from "../floor/play";
import { formNotice, loopNotice, tell, type Telling } from "../g0/notice";
import type { FormsReading } from "../g0/forms";
import { playCount, type Counted } from "../lib/count";
import { liveLoopReader, type LoopReader } from "../lib/loop";
import { installedRoots, recheck, versionOf, type Roots } from "../lib/pi";
import { buildFrom, installedRph, type BuildReader } from "../lib/record";

const RPE_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** What the play needs of its place besides the host's acts: where pi and RPH are installed, and where notices are printed. */
export interface TagsDeps {
  roots: Roots;
  out: (text: string) => void;
}

/** pi's loop told and judged: the notice printed and kept, each finding judged as met or not by what the installed sources say now. */
export async function tellLoop(play: Play, deps: TagsDeps): Promise<void> {
  const rechecked = recheck(deps.roots);
  const versions = { core: versionOf(deps.roots.core), ai: versionOf(deps.roots.ai) };
  await tell(loopNotice(rechecked, versions), { out: deps.out, keep: (name, text) => play.keep(name, text) } satisfies Telling);
  if (versions.core === null || versions.ai === null) {
    await play.notJudged("loop", `the installed pi could not be read (${deps.roots.core}, ${deps.roots.ai}), so its findings could not be asked of it again`);
    return;
  }
  for (const r of rechecked) {
    const missing = [...r.pi, ...r.around].filter((f) => f.at === null).map((f) => f.what);
    await play.judge("loop", { pass: r.holds, what: r.holds ? `${r.title}: still reads as Phase 0 found it on pi ${versions.core}, with what RPH does around it` : `${r.title}: no longer reads as Phase 0 found it; not found now: ${missing.join("; ")}` });
  }
}

/** Plays the tags on the bed, through the host's acts. */
export async function playTags(play: Play): Promise<void> {
  if (!isFloorActs(play.acts)) throw new Error(`the host's acts do not give what the tags are counted with (the floor's acts, PlanScenarios-2's rig host or PlanScenarios-3's bed host): ${missingActs(play.acts).join("; ")}`);
  const reader = liveLoopReader(play.acts);
  try {
    await playTagsWith(play, play.acts, reader, buildFrom(RPE_ROOT, installedRph(RPE_ROOT)), { roots: installedRoots(RPE_ROOT), out: (text) => void process.stdout.write(text) });
  } finally {
    reader.close();
  }
}

/** The tags' play over a reader: pi's loop told, thirty turns counted, and the floor model's form told where the count falls below the plan's. */
export async function playTagsWith(play: Play, acts: FloorActs, reader: LoopReader, build: BuildReader | null, deps: TagsDeps): Promise<Counted> {
  await tellLoop(play, deps);
  const counted = await playCount(play, acts, reader, build, { form: "tags", setting: "tags", part: "tags", calls: null });
  const kept = counted.kept;
  // Told only on a play that gives a verdict: a trial gives figures and no verdict, so nothing is told the owner of it.
  if (kept !== null && kept.count.verdict === "fail" && counted.trials.length === 0 && play.standing.is === "verdict") {
    const forms: FormsReading = { tags: { kept, run: kept.run, not: [] }, twoStep: { kept: null, run: null, not: ["its own gate (phase0-0.2-two-step) has not been read yet"] } };
    const notice = formNotice(forms);
    if (notice !== null) await tell(notice, { out: deps.out, keep: (name, text) => play.keep(name, text) });
  }
  return counted;
}
