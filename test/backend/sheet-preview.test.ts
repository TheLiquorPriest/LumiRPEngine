// The Sheet Designer's live preview (`lre.world` op `sheet`) reads the frontend's unsaved ruleset
// on the backend: a malformed one, or one past the preview's limits, is a plain bad request.

import { describe, expect, test } from "bun:test";
import { SHEET_PREVIEW_LIMITS } from "../../src/engine/ruleset";
import { Rig } from "../support/rig";

describe("the sheet preview", () => {
  test("previews a sheet, and refuses a malformed or oversized ruleset as a bad request", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const sheet = (ruleset: unknown) => rig.send({ type: "lre.world", op: "sheet", worldId, ruleset });
    const ok = rig.body(await sheet({ sheet: { sections: [{ id: "s", label: "S", rows: [{ formula: "1 + 1", label: "Two" }] }] } }));
    expect(ok.sheet).toEqual([{ title: "S", rows: [{ label: "Two", value: "2" }] }]);
    const progression = (thresholds: number) => ({ p: { label: "P", xpField: "xp", levelField: "level", thresholds: Array.from({ length: thresholds }, (_, i) => i) } });
    const rows = (n: number) => Array.from({ length: n }, () => ({ progression: "p" }));
    for (const bad of [
      { sheet: { sections: [null] } },
      { sheet: { sections: [{ id: "s", label: "S", rows: [{ field: "a", formula: "1" }] }] } },
      { sheet: { sections: Array.from({ length: SHEET_PREVIEW_LIMITS.sections + 1 }, (_, i) => ({ id: `s${i}`, label: "S", rows: [] })) } },
      { sheet: { sections: [{ id: "s", label: "S", rows: rows(SHEET_PREVIEW_LIMITS.rows + 1) }] } },
      { progression: progression(SHEET_PREVIEW_LIMITS.thresholds + 1), sheet: { sections: [{ id: "s", label: "S", rows: rows(1) }] } },
      { sheet: { sections: [{ id: "s", label: "S", rows: [{ formula: "1".repeat(SHEET_PREVIEW_LIMITS.formula + 1), label: "Long" }] }] } },
    ]) {
      expect(await sheet(bad)).toMatchObject({ type: "lre.error", code: "bad_request" });
    }
  });
});
