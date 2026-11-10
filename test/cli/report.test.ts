// What's new since the last save (`lintDiff`): the issues the later version brought in, those it
// fixed, matched by severity, code and path, their words first; and the order answers list them in.

import { describe, expect, test } from "bun:test";
import { lintDiff, lintSummary, ranked } from "../../src/cli/report";
import type { LintIssue } from "../../src/shared/protocol";

const issue = (severity: LintIssue["severity"], code: string, path: string, message = `${code} at ${path}`): LintIssue => ({ severity, path, code, message });

describe("lintDiff", () => {
  test("an issue the draft has and the head hasn't is new; one the head has and the draft hasn't is fixed; the rest are kept", () => {
    const kept = issue("warning", "no_place", "entities.mara");
    const gone = issue("error", "missing_pov", "pov");
    const fresh = issue("error", "bad_ref", "entities.sam.fields.place");
    const diff = lintDiff([kept, gone], [kept, fresh]);
    expect(diff).toEqual({ introduced: [fresh], fixed: [gone], kept: 1 });
    expect(lintDiff([], [])).toEqual({ introduced: [], fixed: [], kept: 0 });
    expect(lintDiff([gone], [gone])).toEqual({ introduced: [], fixed: [], kept: 1 });
  });

  test("the same issue in other words is the same one: a count in its message moves with the world", () => {
    const before = issue("warning", "too_many", "entities.shop", "The shop has 3 owners over its limit");
    const after = issue("warning", "too_many", "entities.shop", "The shop has 4 owners over its limit");
    expect(lintDiff([before], [after])).toEqual({ introduced: [], fixed: [], kept: 1 });
    // Another severity, code or path is another issue.
    expect(lintDiff([before], [{ ...after, severity: "error" }]).introduced).toHaveLength(1);
    expect(lintDiff([before], [{ ...after, path: "entities.mill" }]).fixed).toEqual([before]);
  });

  test("each issue matches once, its words first: of two at one path, the one reworded is kept and the one added is new", () => {
    const a = issue("info", "unpaid", "entities.job_a", "Job A pays $0");
    const b = issue("info", "unpaid", "entities.job_a", "Job A has no payday");
    const third = issue("info", "unpaid", "entities.job_a", "Job A has no worker");
    const diff = lintDiff([a, b], [b, a, third]);
    expect(diff.introduced).toEqual([third]);
    expect(diff.kept).toBe(2);
    // Twice the same issue before and once after: one is fixed.
    expect(lintDiff([a, a], [a])).toEqual({ introduced: [], fixed: [a], kept: 1 });
  });

  test("answers list the new first, then errors, warnings and infos, each in the engine's order", () => {
    const info = issue("info", "i", "a");
    const warning = issue("warning", "w", "b");
    const error = issue("error", "e", "c");
    const later = issue("error", "e", "d");
    expect(ranked([info, warning, error, later])).toEqual([error, later, warning, info]);
    expect(ranked([info, warning, error, later], new Set([info]))).toEqual([info, error, later, warning]);
    expect(lintSummary([info, error], 1)).toEqual({ errors: 1, warnings: 0, infos: 1, first: [error], more: 1 });
  });
});
