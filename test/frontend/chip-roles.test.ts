import { describe, expect, test } from "bun:test";
import type { ChipRole } from "../../src/frontend/chip-roles";
import { chipRole, chipTone } from "../../src/frontend/chip-roles";
import type { ChipKind } from "../../src/shared/state-view";

const NO_ACTIONS: [] = [];
const ACTIONS = [{ id: "dismiss", label: "Dismiss" }];

// Every kind but `decline`, whose role depends on its actions.
const ROLES: readonly [ChipKind, ChipRole][] = [
  ["confirm", "decision"],
  ["keep_report", "decision"],
  ["contradiction", "decision"],
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
];

describe("chip roles", () => {
  test("every kind has its role, with or without actions", () => {
    for (const [kind, role] of ROLES) {
      expect([kind, chipRole({ kind, actions: NO_ACTIONS })]).toEqual([kind, role]);
      expect([kind, chipRole({ kind, actions: ACTIONS })]).toEqual([kind, role]);
    }
  });

  test("a decline asks only when it offers a way out", () => {
    expect(chipRole({ kind: "decline", actions: ACTIONS })).toBe("decision");
    expect(chipRole({ kind: "decline", actions: NO_ACTIONS })).toBe("done");
  });

  test("tones: declines, failed reads and refusals are negative; degraded, pending, overdue and confirm warn; the rest are neutral", () => {
    const kinds: ChipKind[] = [...ROLES.map(([kind]) => kind), "decline"];
    const of = (tone: string) => kinds.filter((kind) => chipTone({ kind }) === tone).sort();
    expect(of("neg")).toEqual(["decline", "read_failed", "refused"]);
    expect(of("warn")).toEqual(["confirm", "degraded", "overdue", "pending"]);
    expect(of("neutral")).toHaveLength(kinds.length - 7);
  });
});
