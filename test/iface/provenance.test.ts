// Provenance as the harness passes it: pi's own argument check lets through every source, precision
// and standing the code reads, so a source given as its kind alone is recorded, and a value that is
// none of the choices, an operation that is none of the thirteen, or one that lacks what its kind
// needs is refused by the check naming the field and what it takes. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { rig } from "./rig";

describe("provenance through the harness's argument check", () => {
  test("a source given as its kind alone passes the check and is recorded", async () => {
    const t = await rig();
    const tool = t.tools.get("world_apply") as HostTool;
    const r = await t.call("world_apply", asHarnessPasses(tool, { operations: [{ op: "set", at: "bram", key: "mood", value: "wary", source: "prose", standing: "established" }] }));
    expect(r.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === "prose" && row.standing === "established")).toBe(true);
    // A searchable write takes the same.
    const found = t.tools.get("item_condition") as HostTool;
    const worn = await t.call("item_condition", asHarnessPasses(found, { item: "knife", delta: -5, source: "gm" }));
    expect(worn.error).toBeUndefined();
  });

  test("a precision, a standing or a source that is none of the choices is refused by the check, naming the field and its choices", async () => {
    const t = await rig();
    const tool = t.tools.get("world_apply") as HostTool;
    for (const [given, field] of [
      [{ source: { from: "prose", message: "m-20" }, precision: "rough" }, "operations.0.precision: expected one of"],
      [{ source: { from: "prose" }, standing: "certain" }, "operations.0.standing: expected one of"],
      [{ source: { from: "narration" } }, "operations.0.source.from: expected one of"],
      [{ source: { message: "m-20" } }, "operations.0.source.from: missing"],
    ] as [JsonObject, string][]) {
      expect(() => asHarnessPasses(tool, { operations: [{ op: "set", at: "bram", key: "mood", value: "wary", ...given }] })).toThrow(field);
    }
    expect(() => asHarnessPasses(tool, { operations: [{ op: "teleport", who: "bram" }] })).toThrow("operations.0.op: expected one of");
    expect(() => asHarnessPasses(tool, { operations: [{ op: "move", who: "bram" }] })).toThrow("operations.0.to: missing");
    expect(t.s.changes(t.turn.id)).toEqual([]);
  });
});
