// G0's run (PlanGates-17 item 1; plan §18.1 G0: "the floor test in miniature", pass "§17.1's first four
// rows"). The floor's own ten pairs, played by the floor's own script over the same chat, preset and model
// (`scripts/proof/floor/play.ts`, `playPairs`), but judged here for four rows only: first words on screen,
// time per output token, model calls on the reply's path, and what the model was sent. The tags result of
// row 0.2 is read from the tags run's own bundle (`./forms.ts`), never counted here, and the owner is told
// what it means. G0 and the floor are two ids, each played once in a run: G0 in a run of its own, after the
// tags run and before the floor's.
//
// What the play gives the runner: `conditions` (the whole test's sentence, as the floor holds it to), the
// four rows, `tags` (the count of the tags run, reported with what follows from it), and `verdict` (G0's
// own: `./verdict.ts`). With the floor's own trial, a stop, or a runner's trial, every part is not judged,
// with why and the figures; "what the model was sent" not measured leaves `verdict` not judged. What it
// keeps beside the screens: the floor's `turns.json` and `table.txt` (G0's rows), `g0.json` (the verdict,
// the counts read, the effort and each pair's replies), `report.md` (the owner's report) and a `notice-*.md`
// for each finding the owner is told of, each also printed the moment the play finds it.
//
// `bun scripts/proof/g0/run.ts report <run folder> [<variant run folder> ...]` writes the report again
// from bundles alone, the first folder the first run and the others the variants measured after it (item
// 3); `notices <run folder>` prints the notices a run's findings call for.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { Play } from "../route/form";
import { buildFrom, installedRph, standingLines, type BuildReader } from "../lib/record";
import { frontMatter, TAGS_PASS } from "../lib/phase0";
import { floorHead, intentCrossCheck, noVerdict, noVerdictKind, tableText, type FloorRun, type Row } from "../../testbed/floor-measure";
import { isFloorActs, judge, liveReader, missingActs, optionOf, playPairs, type FloorActs, type FloorReader } from "../floor/play";
import { countWords, type FormsReading, needsTwoStep, readForms, type Stands, usable } from "./forms";
import { g0Notices, tell, type Notice } from "./notice";
import { entryOf, EntryRefused, renderReport, type Entry } from "./report";
import { effortOf, g0Rows, g0Verdict, repliesOf, type G0Kept, type G0Verdict } from "./verdict";

/** RPE's repository: the shipped Author definition is read from its guidance. */
const RPE_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** The effort the shipped Author definition names (`effort:` in the header of `guidance/.agents/author.md`); null where it names none or the file cannot be read. */
export function shippedEffort(root: string): string | null {
  try {
    const header = frontMatter(readFileSync(resolve(root, "guidance", ".agents", "author.md"), "utf8"));
    return typeof header?.effort === "string" ? header.effort : null;
  } catch {
    return null;
  }
}

/** The title G0's table is printed under. */
export const G0_TITLE = "G0: the floor test in miniature (§18.1 G0; §17.1's first four rows)";

/** The lines G0 adds to the table's head: what the two counts of row 0.2 are, as G0 reads them. */
export function formsHead(forms: FormsReading): string[] {
  const one = (name: string, r: FormsReading["tags"]): string => (r.kept === null ? `${name}: no count was read (${r.not.join("; ")})` : `${name}: ${countWords(r.kept)}, run ${r.run ?? "not named"}${r.not.length === 0 ? "" : `; G0 does not stand on it: ${r.not.join("; ")}`}`);
  return [one("Row 0.2, the tags", forms.tags), one("Row 0.2, the two-step form", forms.twoStep)];
}

/** What the play told the runner of each part, in order: the floor's judge over the four rows, then `tags` and `verdict`. */
export async function judgeG0(play: Pick<Play, "judge" | "notJudged">, run: FloorRun, rows: readonly Row[], verdict: G0Verdict, forms: FormsReading): Promise<void> {
  await judge(play, run, rows);
  const none = noVerdict(run);
  const tags = forms.tags;
  const figures = tags.kept === null ? "no count was read" : countWords(tags.kept);
  if (none !== null) await play.notJudged("tags", `${none.kind}: ${none.why}; figures: ${figures}`);
  else if (tags.kept === null) await play.notJudged("tags", `the tags run's count was not read: ${tags.not.join("; ")}`);
  else if (!usable(tags)) await play.notJudged("tags", `G0 does not stand on the tags run's count: ${tags.not.join("; ")}; figures: ${figures}`);
  else await play.judge("tags", { pass: true, what: `reported: ${figures} (run ${tags.run ?? "not named"}); ${needsTwoStep(tags) ? `below the plan's ${TAGS_PASS.hits} of ${TAGS_PASS.of}: the floor model works the two-step way, and the owner is told` : `the plan's ${TAGS_PASS.hits} of ${TAGS_PASS.of} is met: the tag form stands`}` });
  if (verdict.verdict === "none") await play.notJudged("verdict", `${verdict.kind}: ${verdict.why.join("; ")}`);
  else await play.judge("verdict", { pass: verdict.verdict === "pass", what: verdict.verdict === "pass" ? "passed: first words, time per output token, calls on the reply's path and what the model was sent all passed on a run whose conditions held" : `failed: ${verdict.why.join("; ")}` });
}

/** What the play needs of its place besides the host's acts: where the counts of row 0.2 are read from, the shipped definition's effort, what this run changes, where notices are printed. */
export interface G0Deps {
  forms: (stands: Stands) => FormsReading;
  shipped: string | null;
  variant: string | null;
  out: (text: string) => void;
}

/** What a G0 play made. */
export interface G0Played {
  run: FloorRun;
  rows: Row[];
  verdict: G0Verdict;
  forms: FormsReading;
  entry: Entry;
  notices: Notice[];
}

/** G0's play over a reader: the ten pairs, the four rows judged, the counts of row 0.2 read, the report kept, the findings told the moment they are found. */
export async function playG0With(play: Play, acts: FloorActs, reader: FloorReader, option: { plain: string; rpe: string } | null, build: BuildReader | null, deps: G0Deps): Promise<G0Played> {
  const { run, chat } = await playPairs(play, acts, reader, option, build);
  const rows = g0Rows(run);
  const standing = play.standing;
  const forms = deps.forms({ mode: play.mode, served: play.run.standing?.from?.served ?? null, model: run.arms.rpe.model });
  const effort = effortOf(run, deps.shipped);
  const verdict = g0Verdict(run, rows, standing, forms);
  const kept: G0Kept = { kind: "g0", run: play.run.run, variant: deps.variant, verdict, forms, effort, replies: repliesOf(run.turns, await reader.messages(chat)) };
  await play.keep("g0", { ...kept });
  await play.keep("table.txt", tableText(rows, [...standingLines(play.run), ...floorHead(run), ...formsHead(forms)], noVerdictKind(run, standing.is === "trial"), intentCrossCheck(run), G0_TITLE));
  await judgeG0(play, run, rows, verdict, forms);
  const entry: Entry = { name: play.run.run, head: standingLines(play.run), served: play.run.standing?.from?.served ?? null, floor: run, kept };
  await play.keep("report.md", renderReport([entry]));
  const notices = g0Notices({ run, rows, verdict, forms, effort, variant: deps.variant });
  for (const notice of notices) await tell(notice, { out: deps.out, keep: (name, text) => play.keep(name, text) });
  return { run, rows, verdict, forms, entry, notices };
}

/** The label a variant run carries (`G0_VARIANT`): free words for what it changes against the first run; null for the first run. */
export function variantOf(env: Record<string, string | undefined>): string | null {
  const label = env.G0_VARIANT?.trim();
  return label === undefined || label === "" ? null : label;
}

/** Plays G0 on the bed, through the host's acts: the lead runs it there. */
export async function playG0(play: Play): Promise<void> {
  if (!isFloorActs(play.acts)) throw new Error(`the host's acts do not give what G0 plays with (the floor's acts, PlanScenarios-2's rig host or PlanScenarios-3's bed host): ${missingActs(play.acts).join("; ")}`);
  const option = optionOf(process.env);
  const reader = liveReader(play.acts);
  try {
    await playG0With(play, play.acts, reader, option, buildFrom(RPE_ROOT, installedRph(RPE_ROOT)), {
      forms: (stands) => readForms(process.env, stands),
      shipped: shippedEffort(RPE_ROOT),
      variant: variantOf(process.env),
      out: (text) => {
        process.stdout.write(text);
      },
    });
  } finally {
    reader.close();
  }
}

/** The command line: `report` and `notices`, each over run folders. Gives the exit code. */
export async function main(argv: readonly string[], out: (text: string) => void = (t) => void process.stdout.write(t)): Promise<number> {
  const [command, ...dirs] = argv;
  if ((command !== "report" && command !== "notices") || dirs.length === 0 || (command === "notices" && dirs.length !== 1)) {
    out("usage: bun scripts/proof/g0/run.ts report <run folder> [<variant run folder> ...]\n       bun scripts/proof/g0/run.ts notices <run folder>\n");
    return 2;
  }
  try {
    const entries = dirs.map((dir) => entryOf(resolve(dir)));
    if (command === "report") {
      out(`${renderReport(entries)}\n`);
      return 0;
    }
    const [entry] = entries as [Entry];
    const notices = g0Notices({ run: entry.floor, rows: g0Rows(entry.floor), verdict: entry.kept.verdict, forms: entry.kept.forms, effort: entry.kept.effort, variant: entry.kept.variant });
    for (const notice of notices) await tell(notice, { out });
    if (notices.length === 0) out(`Run ${entry.name} calls for no notice: its findings are in its report.\n`);
    return 0;
  } catch (error) {
    if (error instanceof EntryRefused) {
      out(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
