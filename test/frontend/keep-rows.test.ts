// Keep report rows: one per dropped event group (its members drop and convert as one unit), and
// identical lines outside a group merge too.
import { describe, expect, test } from "bun:test";
import type { KeepLine } from "../../src/shared/ledger";
import { keepRows } from "../../src/frontend/chips";

const PATH = "f".repeat(32);
const line = (index: number, text: string, extra: Partial<KeepLine> = {}): KeepLine => ({ messageId: "m5", parentPath: PATH, ref: { in: "events", index }, status: "dropped", text, ...extra });

describe("Keep report rows", () => {
  test("a dropped purchase group is one row, with its lead line and its member count", () => {
    const bought = "Bought brass ship's lantern: −$84.00 (Your wallet cash)";
    const rows = keepRows([line(3, bought, { group: "pay:lantern" }), line(4, bought, { group: "pay:lantern" }), line(5, bought, { group: "pay:lantern" })]);
    expect(rows.map((r) => [r.line.text, r.count, r.line.ref])).toEqual([[bought, 3, { in: "events", index: 3 }]]);
  });

  test("two groups in one message stay two rows even when they read the same; lines without a group merge when identical", () => {
    const paid = "Payment: −$20.00 (Your wallet cash)";
    const rows = keepRows([
      line(1, paid, { group: "pay:a" }),
      line(2, paid, { group: "pay:a" }),
      line(3, paid, { group: "pay:b" }),
      line(6, "Dev Patel → Rosie's Diner"),
      line(7, "Dev Patel → Rosie's Diner"),
      line(8, "Dev Patel → Rosie's Diner", { status: "inert" }),
    ]);
    expect(rows.map((r) => [r.line.group ?? null, r.line.status, r.count])).toEqual([
      ["pay:a", "dropped", 2],
      ["pay:b", "dropped", 1],
      [null, "dropped", 2],
      [null, "inert", 1],
    ]);
  });
});
