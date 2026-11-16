// The gear pack's `notWithYou` setting as Build edits it (ITEMS-SPEC §5.5, §11): how many of the player character's own things
// that go about with them, and aren't with them now, the Gear section tells. The gear pack keeps it in its config and reads it
// as RPE runs the pack, so this stays; the editors of the narrator's section guidance, which only the classic pipeline read, are
// not drawn (R-50).

import type { LintIssue } from "../../shared/lint";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonPatchOp } from "../../shared/json-patch";
import { thingsConfigOf } from "../../shared/things";
import type { WorldDoc } from "../../shared/world";
import { NumberInput } from "./schema-form";

/** Where the Gear section's Not with you lines are kept, as lint names it. */
export const NOT_WITH_YOU_PATH = "packs.gear.config.notWithYou";

/** The Gear section's Not with you lines (ITEMS-SPEC §5.5, §11): how many of the player character's own things that go about with them, and aren't with them now, the section tells. */
export function NotWithYouField(props: { value: number; issues: readonly LintIssue[]; onChange(value: number): void }) {
  return (
    <NumberInput
      label="Not with you, at most lines"
      value={props.value}
      min={0}
      step={1}
      hint="How many of your character's things that go about with them (their phone, their keys) the section tells when they aren't with them, with where each is; 0 tells none"
      issues={props.issues}
      onChange={(next) => {
        if (typeof next === "number" && Number.isInteger(next) && next >= 0) props.onChange(next);
      }}
    />
  );
}

/** The patch that sets the Gear section's Not with you lines in the gear pack's config; none when they read so already, or the world has no gear pack. */
export function notWithYouPatch(world: Pick<WorldDoc, "packs">, lines: number): JsonPatchOp[] {
  const gear = hasOwn(world.packs, "gear") ? world.packs.gear : undefined;
  if (!gear || thingsConfigOf(world).notWithYou === lines) return [];
  return isRecord(gear.config) ? [{ op: "add", path: "/packs/gear/config/notWithYou", value: lines }] : [{ op: "add", path: "/packs/gear/config", value: { notWithYou: lines } }];
}
