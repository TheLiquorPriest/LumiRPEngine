// The Speed-through threshold (DESIGN §9.2: 1 minute to 7 days): Settings keeps a value inside that
// range, and the threshold stepper offers exactly the range Settings keeps.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { NumberStepper } from "../../src/frontend/components";
import { TimeControlsEditor, type TimeValues } from "../../src/frontend/time-controls";
import { INTERRUPT_CLASSES } from "../../src/shared/ids";
import { Rig } from "../support/rig";

type StepperProps = Parameters<typeof NumberStepper>[0];

/** The NumberStepper props in a rendered tree, as the editor lays them out (no DOM needed). */
function steppers(node: unknown): StepperProps[] {
  if (Array.isArray(node)) return node.flatMap(steppers);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const v = node as VNode<Record<string, unknown>>;
  return [...(v.type === NumberStepper ? [v.props as unknown as StepperProps] : []), ...steppers(v.props.children)];
}

const values: TimeValues = {
  sceneTicks: { conversation: 2 },
  scale: 1,
  interrupts: Object.fromEntries(INTERRUPT_CLASSES.map((c) => [c, "note"])) as TimeValues["interrupts"],
  speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } },
  montage: "key",
  unitCap: { agentDays: 600, events: 5000 },
};

async function kept(rig: Rig, thresholdMinutes: number): Promise<unknown> {
  const body = rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { speedThrough: { sleep: { mode: "offer", thresholdMinutes } } } } }));
  const settings = body.settings as { time: { speedThrough: Record<string, { thresholdMinutes: number } | undefined> } };
  return settings.time.speedThrough.sleep?.thresholdMinutes;
}

describe("the Speed-through threshold", () => {
  const threshold = steppers(TimeControlsEditor({ values, onChange: () => undefined })).find((s) => s.label === "When longer than (min)");

  test("the stepper runs from 1 minute to 7 days", () => {
    expect(threshold?.min).toBe(1);
    expect(threshold?.max).toBe(7 * 24 * 60);
  });

  test("Settings keeps every value the stepper offers, and brings anything else inside the range", async () => {
    const rig = new Rig();
    const min = threshold?.min ?? Number.NaN;
    const max = threshold?.max ?? Number.NaN;
    expect(await kept(rig, min)).toBe(min);
    expect(await kept(rig, max)).toBe(max);
    expect(await kept(rig, 45)).toBe(45);
    // A 0 saved by an earlier stepper keeps its policy, at the shortest threshold.
    expect(await kept(rig, 0)).toBe(min);
    expect(await kept(rig, max + 1)).toBe(max);
    expect(await kept(rig, 44.6)).toBe(45);
  });
});
