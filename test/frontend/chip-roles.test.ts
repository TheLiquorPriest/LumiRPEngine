import { describe, expect, test } from "bun:test";
import type { ChipRole } from "../../src/frontend/chip-roles";
import { chipRole, chipTone } from "../../src/frontend/chip-roles";
import type { ChipKind } from "../../src/shared/state-view";

const ROLES: readonly [ChipKind, ChipRole][] = [
  ["confirm", "decision"],
  ["keep_report", "decision"],
  ["read_failed", "decision"],
  ["retry", "decision"],
  ["retry_read", "decision"],
  ["reread", "decision"],
  ["overdue", "decision"],
  ["refused", "decision"],
  ["timelapse_offer", "offer"],
  ["continue_timelapse", "offer"],
  ["choice", "offer"],
  ["swipe_option", "offer"],
  ["change", "done"],
  ["elapsed", "done"],
  ["roll", "done"],
  ["price", "done"],
  ["undo", "done"],
  ["not_action", "done"],
  ["mode_change", "done"],
  ["fix", "done"],
  ["pending", "done"],
  ["degraded", "done"],
  ["untracked", "done"],
  ["decline", "done"],
];

describe("chip roles", () => {
  test("every kind has its role", () => {
    for (const [kind, role] of ROLES) expect([kind, chipRole({ kind })]).toEqual([kind, role]);
  });

  test("tones: declines, failed reads and refusals are negative; degraded, pending, overdue and confirm warn; the rest are neutral", () => {
    const kinds: ChipKind[] = ROLES.map(([kind]) => kind);
    const of = (tone: string) => kinds.filter((kind) => chipTone({ kind }) === tone).sort();
    expect(of("neg")).toEqual(["decline", "read_failed", "refused"]);
    expect(of("warn")).toEqual(["confirm", "degraded", "overdue", "pending"]);
    expect(of("neutral")).toHaveLength(kinds.length - 7);
  });
});
