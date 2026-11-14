// Provenance as the harness passes it: pi's own argument check lets through every source, precision
// and standing the code reads, so a source given as its kind alone is recorded, and a value that is
// none of the choices is answered in the answers' words with the choices, never by the harness's
// misfit answer. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { rig, texts, wordsFromFiles } from "./rig";

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

  test("a precision, a standing or a source that is none of the choices reaches the code, which answers with the choices", async () => {
    const t = await rig();
    const tool = t.tools.get("world_apply") as HostTool;
    for (const [given, field] of [
      [{ source: { from: "prose", message: "m-20" }, precision: "rough" }, "precision"],
      [{ source: { from: "prose" }, standing: "certain" }, "standing"],
      [{ source: { from: "narration" } }, "source.from"],
      [{ source: { message: "m-20" } }, "source.from"],
    ] as [JsonObject, string][]) {
      const r = await t.call("world_apply", asHarnessPasses(tool, { operations: [{ op: "set", at: "bram", key: "mood", value: "wary", ...given }] }));
      expect(r.error).toBe(true);
      expect(texts(r)[0]).toStartWith(`Operation 1 (set): ${field} cannot be read`);
      expect(texts(r)[0]).toContain("It is one of:");
      wordsFromFiles(r);
    }
    expect(t.s.changes(t.turn.id)).toEqual([]);
  });
});
