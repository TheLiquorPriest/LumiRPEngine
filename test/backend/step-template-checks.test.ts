// What lint says of a world's step templates (DESIGN §5.2), and the one limit on a GM edit's
// operations: a placeholder only some steps are given passes in those steps, a blank template and a
// contradiction template that isn't a check are warned of, and the tools' schemas take exactly as
// many operations as the engine accepts.

import { describe, expect, test } from "bun:test";
import { PLAY_TOOLS } from "../../src/cli/tools-play";
import { lintWorld } from "../../src/engine/authoring";
import { EDIT_OPS_MAX } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { isRecord } from "../../src/shared/json";
import type { StepTemplateDef } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { baseWorld } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The lint codes on the world's one template, `t`. */
function codesFor(t: Omit<StepTemplateDef, "id">): string[] {
  const w = baseWorld();
  w.steps.t = { id: "t", ...t };
  return lintWorld(w, reg)
    .filter((i) => i.path.startsWith("steps.t."))
    .map((i) => i.code);
}

describe("step template checks", () => {
  test("{{usual}} in extract and {{sections}} in the outline are placeholders those steps fill", () => {
    expect(codesFor({ purpose: "extract", template: "Where they go: {{usual}}", output: "text", signals: [] })).toEqual([]);
    expect(codesFor({ purpose: "outline", template: "Point only at {{sections}}.", output: "text", signals: [] })).toEqual([]);
    // A step that isn't given one still renders it empty.
    expect(codesFor({ purpose: "brief", template: "Brief, with {{usual}}.", output: "text", signals: [] })).toEqual(["unknown_placeholder"]);
  });

  test("a blank template is flagged, and a contradiction template that isn't a decision is", () => {
    expect(codesFor({ purpose: "brief", template: "  ", output: "text", signals: [] })).toEqual(["step_blank"]);
    expect(codesFor({ purpose: "contradiction", template: "Does the reply contradict the facts?", output: "text", signals: [] })).toEqual(["step_contradiction_output"]);
    expect(codesFor({ purpose: "contradiction", template: "Does the reply contradict the facts?", output: "decision", signals: [] })).toEqual([]);
  });
});

describe("the GM edit tools", () => {
  test("each takes at most as many operations as the engine accepts in one edit", () => {
    const limits = PLAY_TOOLS.flatMap((tool) => {
      const ops = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties.ops : undefined;
      return isRecord(ops) && ops.type === "array" ? [[tool.name, ops.maxItems]] : [];
    });
    expect(limits.length).toBeGreaterThanOrEqual(3);
    expect(limits).toEqual(limits.map(([name]) => [name, EDIT_OPS_MAX]));
  });
});
