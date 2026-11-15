// Two kinds of result, kept apart (PlanScenarios-1 item 3; plan §17.0 l.1753): "What code does is
// proved as pass or fail. What the shipped guidance achieves is measured as a rate on the test model:
// how often the agent did what the file asks, with every miss shown."
//
// A part is looked for once or more in every play; each look is an instance. A code part passes only
// if every instance was seen on screen, and fails on any it looked for and did not find, or could not
// look for. An "as shipped" part played live is a rate over its instances: hits and misses, each miss
// listed beside its own screens. A miss of guidance never fails a code part, and an instance the code
// broke (a page that would not open, a play that stopped, a page that shows it at one width and not the
// other) is never counted into a rate: it is listed apart as a code failure. In the rig the agent is
// scripted to follow its file, so an "as shipped" part there proves the code path only and is judged
// as code, never reported as a rate.

import type { Mark, Share } from "./form";
import type { Mode } from "./host";

/** One look at one page at one width, as the runner made it. */
export interface Glance {
  page: string;
  /** Pixels for a page, columns for the terminal; null when the page could not be opened. */
  width: number | null;
  /** True: the check saw it; false: it looked and it was not there; null: it could not look. */
  found: boolean | null;
  /** What the check saw or missed, or why it could not look, in plain words. */
  what: string;
  /** The texts the check said show it. */
  shows: string[];
  /** The screen saved, from the form's folder (`play-01/world-1440-four-values.png`); null when none was. */
  screen: string | null;
  /** The page as it named itself when the screen was saved. */
  shotPage: string | null;
  /** The text the page showed when the screen was saved. */
  shotText: string | null;
  /** Why the screen does not show what the check saw; null when it does, or when nothing was seen. */
  unshown: string | null;
}

/**
 * What came of one instance: `shown` seen and on screen; `absent` looked for and not there; `unseen`
 * seen with no screen that shows it; `broken` could not be looked for (a code failure); `unlooked` the
 * play ended and its form never looked; `met` and `unmet` a measured part's verdict.
 */
export type Outcome = "shown" | "absent" | "unseen" | "broken" | "unlooked" | "met" | "unmet";

export interface Instance {
  play: number;
  /** The how-manyth look at the part in its play, from 1; 0 for a look that never happened. */
  at: number;
  outcome: Outcome;
  why: string;
  glances: Glance[];
}

/** A part as a run recorded it. */
export interface PartRecord {
  id: string;
  words: string;
  mark: Mark;
  /** The pages it is seen on; empty for a measured part. */
  pages: string[];
  /** What a measured part measures; null for a part that is seen. */
  measured: string | null;
  wants: Share | null;
  instances: Instance[];
}

/** A scenario or gate as a run recorded it: `result.json` in its folder. */
export interface FormRecord {
  /** The scenario's number as two digits, or the gate's id. */
  id: string;
  kind: "scenario" | "gate";
  number: number | null;
  /** The waves it is played at: a scenario's one, a gate's several. */
  waves: number[];
  line: number | null;
  mode: Mode;
  plays: number;
  parts: PartRecord[];
  /** What stopped a play before its form ended, by play. */
  stops: { play: number; why: string }[];
}

/** A part judged as code: on its own as a code part, or as the code path of an "as shipped" part in the rig. */
export interface CodeVerdict {
  kind: "code";
  result: "passed" | "failed" | "not seen" | "not played";
  /** The instances behind a result other than passed. */
  behind: Instance[];
}

/** An "as shipped" part played live. */
export interface RateVerdict {
  kind: "rate";
  hits: number;
  /** Hits and misses: the instances the guidance was judged on. */
  judged: number;
  misses: Instance[];
  /** Code failures and instances not seen on screen, kept out of the rate. */
  apart: Instance[];
  /** Whether the plan's share (a gate's "in at least 9 of 10") was met; null with no share, or too few judged to say. */
  meets: boolean | null;
  wants: Share | null;
}

export type Verdict = CodeVerdict | RateVerdict;

/** Whether a part is judged as code in this mode: a code part always, an "as shipped" part in the rig. */
export function judgedAsCode(mark: Mark, mode: Mode): boolean {
  return mark === "code" || mode === "rig";
}

/** What one look at a part came to, from its glances: every page it is seen on, at every width. */
export function outcomeOf(glances: Glance[], mark: Mark, mode: Mode): { outcome: Outcome; why: string } {
  const blind = glances.find((g) => g.found === null);
  if (blind) return { outcome: "broken", why: `could not look on the ${place(blind)}: ${blind.what}` };
  const seen = glances.filter((g) => g.found === true);
  const missed = glances.filter((g) => g.found === false);
  if (missed.length === 0) {
    const unshown = seen.find((g) => g.screen === null || g.unshown !== null);
    if (unshown) return { outcome: "unseen", why: `seen on the ${place(unshown)}, and ${unshown.unshown ?? "no screen was saved"}` };
    return { outcome: "shown", why: seen.map((g) => g.what || `seen on the ${place(g)}`).join("; ") };
  }
  if (seen.length === 0) return { outcome: "absent", why: missed.map((g) => `not on the ${place(g)}: ${g.what}`).join("; ") };
  const split = `seen on the ${seen.map(place).join(", ")}, not on the ${missed.map(place).join(", ")}`;
  // An agent did it if any page shows it; a page that does not is the code's fault, never the guidance's.
  return judgedAsCode(mark, mode) ? { outcome: "absent", why: split } : { outcome: "broken", why: `${split}: a page that does not show what another does is a fault of the code` };
}

function place(glance: Glance): string {
  return glance.width === null ? `${glance.page} page` : `${glance.page} page at ${glance.width}`;
}

export function verdictOf(part: PartRecord, mode: Mode): Verdict {
  const of = (...outcomes: Outcome[]) => part.instances.filter((i) => outcomes.includes(i.outcome));
  if (judgedAsCode(part.mark, mode)) {
    if (part.instances.length === 0) return { kind: "code", result: "not played", behind: [] };
    const failed = of("absent", "broken", "unmet");
    if (failed.length > 0) return { kind: "code", result: "failed", behind: failed };
    const unseen = of("unseen", "unlooked");
    if (unseen.length > 0) return { kind: "code", result: "not seen", behind: unseen };
    return { kind: "code", result: "passed", behind: [] };
  }
  const hits = of("shown", "met").length;
  const misses = of("absent", "unmet");
  const judged = hits + misses.length;
  const wants = part.wants;
  // "At least 9 of 10" is decided once as many were judged as the plan counts, by the same share.
  const meets = wants === null || judged < wants.of ? null : hits * wants.of >= wants.hits * judged;
  return { kind: "rate", hits, judged, misses, apart: of("broken", "unseen", "unlooked"), meets, wants };
}

export type FormResult = "passed" | "failed" | "not seen" | "rates only";

/**
 * A scenario's or gate's own result. It fails on a code part (or in the rig an "as shipped" part's
 * code path) that failed, on a play that stopped, and on any instance of a rate the code broke: kept
 * out of the rate, a code failure is still a failure. It is not seen where a part, or an instance of a
 * rate, was never seen on screen. With no code part and nothing broken it is its rates alone.
 */
export function formResult(record: FormRecord): FormResult {
  const verdicts = record.parts.map((p) => verdictOf(p, record.mode));
  const code = verdicts.filter((v): v is CodeVerdict => v.kind === "code");
  const apart = verdicts.flatMap((v) => (v.kind === "rate" ? v.apart : []));
  if (record.stops.length > 0 || code.some((v) => v.result === "failed") || apart.some((i) => i.outcome === "broken")) return "failed";
  if (code.some((v) => v.result !== "passed") || apart.length > 0) return "not seen";
  return code.length === 0 ? "rates only" : "passed";
}

/** The screens of an instance, as named in the bundle. */
export function screensOf(instance: Instance): string[] {
  return instance.glances.flatMap((g) => (g.screen === null ? [] : [g.screen]));
}

/** A part's verdict in plain words, the first line its result and each further line one instance behind it, with its screens. */
export function describeVerdict(part: PartRecord, mode: Mode): string[] {
  const verdict = verdictOf(part, mode);
  const screens = (instance: Instance) => {
    const list = screensOf(instance);
    return list.length === 0 ? "no screen" : list.join(", ");
  };
  const line = (label: string, instance: Instance) => `${label} in play ${instance.play}${instance.at > 1 ? `, look ${instance.at}` : ""}: ${instance.why}. Screens: ${screens(instance)}`;
  if (verdict.kind === "code") {
    const head = part.mark === "as shipped" ? `the code path only (the rig plays the agent as its file asks): ${verdict.result}` : verdict.result;
    return [head[0]?.toUpperCase() + head.slice(1), ...verdict.behind.map((i) => line(verdict.result === "failed" ? "Failed" : "Not seen", i))];
  }
  const share = verdict.wants === null ? "" : verdict.meets === null ? `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}, and too few were judged to say` : verdict.meets ? `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}: met` : `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}: not met`;
  const head = `As shipped: ${verdict.hits} of ${verdict.judged} (${verdict.misses.length} ${verdict.misses.length === 1 ? "miss" : "misses"})${verdict.apart.length > 0 ? `; ${verdict.apart.length} kept out of the rate` : ""}${share}`;
  return [head, ...verdict.misses.map((i) => line("Missed", i)), ...verdict.apart.map((i) => line(i.outcome === "broken" ? "Code failure, kept out of the rate," : "Not seen, kept out of the rate,", i))];
}
