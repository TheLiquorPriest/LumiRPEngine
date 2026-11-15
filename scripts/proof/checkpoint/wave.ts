// A wave's record and what it takes to meet it (PlanScenarios-5 items 4, 5 and 10; plan §18.3 l.1974-1976, §20 risk 13). One record for each wave, kept outside the repositories
// (`$RPE_PROOF_RECORDS/checkpoints/wave-<n>.json`, `checkpoint.ts`): the packages run with their start and end, the gaps each claims closed with file and line, each package's items left
// open with the lane that took them, the rig's bundle and, for waves 1 and 5, the live bundle (whose counts, E12's rates among them, it is met on, never on an exit code alone), the
// review of the wave's whole diff between two named commits with every finding fixed, the lead's check, the fixed values put to the owner, and the pinned commit whole.
//
// A wave is met only when every one of those holds. Nothing here changes a record but what `checkpoint.ts` writes when it is asked to mark: the round it was tried in, that it was met,
// and that the build stopped. This file only reads a record and says what is missing.

import { isRecord } from "../../../src/shared/json";
import type { ReadBundle } from "../route/evidence";
import { parseStageId } from "../route/form";
import { partTrial, verdictOf } from "../route/results";
import { countsOfFolder, type CountsRead, type RateRead } from "./counts";

/** A whole git commit: 40 hex digits, never a prefix. */
export const WHOLE_COMMIT = /^[0-9a-f]{40}$/;

/** The most packages that run at once: decision 14's seven is refused (§18.3). */
export const MOST_AT_ONCE = 6;

/** The waves that are met on a live bundle too: wave 1's checkpoint is live, and wave 5's. */
export const LIVE_WAVES: readonly number[] = [1, 5];

export interface PackageRun {
  id: string;
  started: string;
  /** Null while the package runs: a wave is not met with one still going. */
  ended: string | null;
  lane: string;
}

export interface GapClaim {
  id: string;
  file: string;
  line: number;
}

/** An item a package left open, and the lane that took it at once (a lane that stops with items open reports them and the next lane takes them: `build/REBUILD-PLAN.md` §2). */
export interface OpenItem {
  package: string;
  item: string;
  lane: string | null;
}

export interface Finding {
  id: string;
  /** The whole commit that fixed it; null while it is not fixed. */
  fixed: string | null;
}

/** The review of the wave's whole diff (§18.3 l.1976): the two commits it was made between, the plan's sections it was briefed with, and each finding with its fix. */
export interface Review {
  from: string;
  to: string;
  sections: string[];
  findings: Finding[];
}

export interface Round {
  at: string;
  met: boolean;
  problems: string[];
}

export interface Stopped {
  at: string;
  why: string;
  /** The owner's answer to the report, put here by the lead: a build that stopped goes on only with it. */
  ruling: { answer: string; at: string } | null;
}

export interface WaveRecord {
  wave: number;
  packages: PackageRun[];
  gaps: GapClaim[];
  open: OpenItem[];
  /** The bundle folders of the wave's rig run and, for waves 1 and 5, its live run. */
  rig: string | null;
  live: string | null;
  review: Review | null;
  lead: { checked: string; by: string } | null;
  fixedValues: { putToOwner: boolean; at: string | null } | null;
  /** The pinned commit of RPH, whole. */
  pin: string | null;
  rounds: Round[];
  met: { at: string } | null;
  stopped: Stopped | null;
}

/** What a record says it is, and what in it could not be read as it should. */
export interface ReadRecord {
  record: WaveRecord;
  problems: string[];
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

function list(value: unknown, what: string, problems: string[]): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${what} is not a list`);
    return [];
  }
  return value;
}

/** A record as its file holds it. A field of the wrong kind is a problem named, never taken for another; a field left out is an empty one, which the checks then ask for. */
export function readRecord(raw: unknown, wave: number): ReadRecord {
  const problems: string[] = [];
  const empty: WaveRecord = { wave, packages: [], gaps: [], open: [], rig: null, live: null, review: null, lead: null, fixedValues: null, pin: null, rounds: [], met: null, stopped: null };
  if (!isRecord(raw)) return { record: empty, problems: ["the record is not an object"] };
  if (raw.wave !== wave) problems.push(`the record says it is wave ${String(raw.wave)}, and it is read as wave ${wave}`);
  const packages = list(raw.packages, "packages", problems).flatMap((p, i): PackageRun[] => {
    if (!isRecord(p) || text(p.id) === null || text(p.started) === null || text(p.lane) === null || (p.ended !== null && p.ended !== undefined && text(p.ended) === null)) {
      problems.push(`package ${i + 1} does not name its id, its lane and its start (and its end, once it has one)`);
      return [];
    }
    return [{ id: p.id as string, started: p.started as string, ended: typeof p.ended === "string" ? p.ended : null, lane: p.lane as string }];
  });
  const gaps = list(raw.gaps, "gaps", problems).flatMap((g, i): GapClaim[] => {
    if (!isRecord(g) || text(g.id) === null) {
      problems.push(`gap ${i + 1} names no id`);
      return [];
    }
    return [{ id: g.id as string, file: typeof g.file === "string" ? g.file : "", line: typeof g.line === "number" ? g.line : 0 }];
  });
  const open = list(raw.open, "open", problems).flatMap((o, i): OpenItem[] => {
    if (!isRecord(o) || text(o.package) === null || text(o.item) === null) {
      problems.push(`open item ${i + 1} names no package and item`);
      return [];
    }
    return [{ package: o.package as string, item: o.item as string, lane: text(o.lane) }];
  });
  let review: Review | null = null;
  if (isRecord(raw.review)) {
    const findings = list(raw.review.findings, "the review's findings", problems).flatMap((f, i): Finding[] => {
      if (!isRecord(f) || text(f.id) === null) {
        problems.push(`finding ${i + 1} of the review names no id`);
        return [];
      }
      return [{ id: f.id as string, fixed: text(f.fixed) }];
    });
    review = { from: text(raw.review.from) ?? "", to: text(raw.review.to) ?? "", sections: list(raw.review.sections, "the review's sections", problems).filter((s): s is string => typeof s === "string"), findings };
  }
  const lead = isRecord(raw.lead) && text(raw.lead.checked) !== null && text(raw.lead.by) !== null ? { checked: raw.lead.checked as string, by: raw.lead.by as string } : null;
  const fixedValues = isRecord(raw.fixedValues) ? { putToOwner: raw.fixedValues.putToOwner === true, at: text(raw.fixedValues.at) } : null;
  const rounds = list(raw.rounds, "rounds", problems).flatMap((r): Round[] => (isRecord(r) && typeof r.at === "string" && typeof r.met === "boolean" && Array.isArray(r.problems) ? [{ at: r.at, met: r.met, problems: r.problems.filter((p): p is string => typeof p === "string") }] : []));
  const met = isRecord(raw.met) && text(raw.met.at) !== null ? { at: raw.met.at as string } : null;
  let stopped: Stopped | null = null;
  if (isRecord(raw.stopped) && text(raw.stopped.at) !== null) {
    const ruling = isRecord(raw.stopped.ruling) && text(raw.stopped.ruling.answer) !== null && text(raw.stopped.ruling.at) !== null ? { answer: raw.stopped.ruling.answer as string, at: raw.stopped.ruling.at as string } : null;
    stopped = { at: raw.stopped.at as string, why: text(raw.stopped.why) ?? "", ruling };
  }
  return { record: { wave, packages, gaps, open, rig: text(raw.rig), live: text(raw.live), review, lead, fixedValues, pin: text(raw.pin), rounds, met, stopped }, problems };
}

/** The most packages running at one moment, from their starts and ends; a package that has not ended is running to the end of time. */
export function mostAtOnce(packages: readonly PackageRun[]): { most: number; ids: string[] } {
  const edges = packages.flatMap((p) => [{ at: Date.parse(p.started), step: 1, id: p.id }, { at: p.ended === null ? Number.POSITIVE_INFINITY : Date.parse(p.ended), step: -1, id: p.id }]);
  // An end at the very moment of a start frees its place first.
  edges.sort((a, b) => a.at - b.at || a.step - b.step);
  const running = new Set<string>();
  let most = 0;
  let ids: string[] = [];
  for (const edge of edges) {
    if (edge.step === 1) running.add(edge.id);
    else running.delete(edge.id);
    if (running.size > most) {
      most = running.size;
      ids = [...running];
    }
  }
  return { most, ids };
}

/** Where G0 stands in a live bundle: its `verdict` part (PlanGates-17), the one wave 1's checkpoint reads. */
export type G0Standing = "met" | "failed" | "not played";

export function g0Of(read: ReadBundle): { standing: G0Standing; why: string } {
  const form = read.forms.find((f) => f.id === "G0");
  const record = form?.record ?? null;
  if (form === undefined || record === null) return { standing: "not played", why: "G0 is not in the live bundle, or its record could not be read" };
  const part = record.parts.find((p) => p.id === "verdict");
  if (part === undefined) return { standing: "not played", why: "G0's record has no verdict part" };
  const verdict = verdictOf(part, record.mode, partTrial(record, part));
  if (verdict.kind !== "code") return { standing: "not played", why: `G0's verdict part came to ${verdict.kind}, which is not a verdict` };
  if (verdict.result === "passed") return { standing: "met", why: "G0's verdict part passed" };
  if (verdict.result === "failed") return { standing: "failed", why: `G0's verdict part failed${verdict.behind.length > 0 ? `: ${verdict.behind.map((i) => i.why).join("; ")}` : ""}` };
  return { standing: "not played", why: `G0's verdict part is ${verdict.result}, so G0 gave no verdict` };
}

/** What is asked of a wave's bundle where it is read: the folders are read through this, so a test can give recorded ones. */
export type ReadFolder = (dir: string) => CountsRead & { read: ReadBundle | null };

export interface Evaluation {
  /** Why the wave is not met, one line each; empty when it is. */
  problems: string[];
  /** G0 at wave 1; null at the other waves. */
  g0: { standing: G0Standing; why: string } | null;
  /** E12's rates from the live bundle's turns. */
  rates: RateRead[];
  /** What was read, for the report: each bundle with its counts. */
  read: { what: string; dir: string; counts: string }[];
}

const countsLine = (c: CountsRead["counts"]): string => `${c.asked} asked, ${c.played} played, ${c.notPlayed} not played; passed ${c.passed}, failed ${c.failed}, measured as a rate ${c.measured}, not seen ${c.notSeen}, not played whole ${c.notPlayedWhole}, trial ${c.trial}, not judged ${c.notJudged}`;

/**
 * What stands between a record and the wave being met. `asked` is what the wave's checkpoint asks of the rig bundle (every scenario of the wave and every gate whose waves name it), `null` where
 * it is not known; `folder` reads a bundle.
 */
export function evaluate(record: WaveRecord, asked: readonly string[] | null, folder: ReadFolder = countsOfFolder): Evaluation {
  const problems: string[] = [];
  const out: Evaluation = { problems, g0: null, rates: [], read: [] };

  // The packages: each ended, at most six at once.
  if (record.packages.length === 0) problems.push("the record holds no package run in this wave");
  for (const p of record.packages) {
    if (Number.isNaN(Date.parse(p.started))) problems.push(`package ${p.id} has a start that is not a date`);
    if (p.ended === null) problems.push(`package ${p.id} has not ended`);
    else if (Number.isNaN(Date.parse(p.ended))) problems.push(`package ${p.id} has an end that is not a date`);
    else if (Date.parse(p.ended) < Date.parse(p.started)) problems.push(`package ${p.id} ended before it started`);
  }
  const atOnce = mostAtOnce(record.packages.filter((p) => !Number.isNaN(Date.parse(p.started))));
  if (atOnce.most > MOST_AT_ONCE) problems.push(`${atOnce.most} packages ran at once (${atOnce.ids.join(", ")}): at most ${MOST_AT_ONCE} run together, so a wave runs in halves or sets, and decision 14's seven is refused`);

  // The gaps claimed closed carry a file and a line; the items left open each name the lane that took them.
  for (const g of record.gaps) if (g.file.trim() === "" || !Number.isInteger(g.line) || g.line < 1) problems.push(`the gap ${g.id} is claimed closed with no file and line`);
  for (const o of record.open) if (o.lane === null) problems.push(`item ${o.item} of ${o.package} is left open and names no lane that took it`);

  // The review: two whole commits, each finding fixed by a whole commit.
  const review = record.review;
  if (review === null) problems.push("the record holds no review of the wave's diff");
  else {
    if (!WHOLE_COMMIT.test(review.from) || !WHOLE_COMMIT.test(review.to)) problems.push("the review names its two commits by anything but a whole commit (40 hex digits each)");
    else if (review.from === review.to) problems.push("the review's two commits are one: a wave's diff lies between two");
    if (review.sections.length === 0) problems.push("the review names none of the plan's sections it was briefed with");
    for (const f of review.findings) if (f.fixed === null || !WHOLE_COMMIT.test(f.fixed)) problems.push(`the review's finding ${f.id} is not fixed by a whole commit`);
  }
  if (record.lead === null) problems.push("the lead's check is not on the record");
  if (record.fixedValues === null || !record.fixedValues.putToOwner) problems.push("the fixed values are not recorded as put to the owner");
  if (record.pin === null || !WHOLE_COMMIT.test(record.pin)) problems.push("the pinned commit of RPH is not on the record as one whole commit");

  // The bundles: met on the counts of each kind of result, never on the exit code.
  const bundle = (what: string, dir: string | null, mode: "rig" | "live"): ReadBundle | null => {
    if (dir === null) {
      problems.push(`the record names no ${what} bundle`);
      return null;
    }
    const counted = folder(dir);
    out.read.push({ what, dir, counts: countsLine(counted.counts) });
    for (const p of counted.problems) problems.push(`the ${what} bundle: ${p}`);
    const read = counted.read;
    if (read === null) return null;
    if (read.run.mode !== mode) problems.push(`the ${what} bundle is a ${read.run.mode} run`);
    if (review !== null && WHOLE_COMMIT.test(review.to) && read.run.rpe.commit !== review.to) problems.push(`the ${what} bundle ran RPE at ${read.run.rpe.commit.slice(0, 12)}, not at the commit the wave's review ends at (${review.to.slice(0, 12)})`);
    if (record.pin !== null && (read.run.rph.commit !== record.pin || read.run.rph.pin !== record.pin || !read.run.rph.pinned)) problems.push(`the ${what} bundle's RPH is not the pinned commit ${record.pin.slice(0, 12)} held as the pin is held`);
    if (asked !== null && mode === "rig") {
      const played = new Set(read.run.asked.map((id) => parseStageId(id)?.scenario ?? id));
      const absent = asked.filter((id) => !played.has(id));
      if (absent.length > 0) problems.push(`the rig bundle was not asked ${absent.join(", ")}, which the wave's checkpoint plays`);
    }
    out.rates.push(...(mode === "live" ? counted.rates : []));
    return read;
  };
  bundle("rig", record.rig, "rig");
  if (LIVE_WAVES.includes(record.wave)) {
    const live = bundle("live", record.live, "live");
    if (record.wave === 1 && live !== null) {
      out.g0 = g0Of(live);
      if (out.g0.standing !== "met") problems.push(`G0 is not met: ${out.g0.why}`);
    }
  }
  return out;
}
