// What a beat, a draft or a reason may hold as it is written (DEPTH2-PLAN §4), against the player's
// limits (`StorySettings.limits`), and whom staging puts in reach of a beat. Pure. A problem is a
// code with what its text names, the limit's row by its label among them, so the tool that writes
// says it in the player's own words (`shared/harness-texts-record.ts`).

import type { Beat, Draft, Exposure } from "../../shared/ledger";
import { STORY_LIMIT_LABELS, type StoryLimits } from "../../shared/settings";
import type { WorldDoc } from "../../shared/world";
import { acts } from "../life";
import { together } from "../presence";
import type { Registry } from "../registry-impl";
import { isGone, kindIs, placeOfEntity } from "../scope";
import type { WorldState } from "../state";

/** Why something can't be written as given. */
export type StoryProblemCode = "long" | "many" | "blank" | "inner_reach" | "reach_actor" | "reach_twice" | "got_missing";

export interface StoryProblem {
  code: StoryProblemCode;
  vars: Record<string, string>;
}

const long = (field: string, size: number, max: number, limit: keyof StoryLimits): StoryProblem => ({ code: "long", vars: { field, size: String(size), max: String(max), row: STORY_LIMIT_LABELS[limit] } });
const many = (field: string, count: number, limits: StoryLimits, limit: keyof StoryLimits): StoryProblem => ({ code: "many", vars: { field, count: String(count), max: String(limits[limit]), row: STORY_LIMIT_LABELS[limit] } });

/** `text` past what the player's limit `limit` allows, as a problem of `field`; null where it fits. */
export function lengthProblem(field: string, text: string, limits: StoryLimits, limit: keyof StoryLimits): StoryProblem | null {
  return text.length > limits[limit] ? long(field, text.length, limits[limit], limit) : null;
}

/**
 * Why `beat` can't be written, against `limits`; null where it can. Its texts fit (`what` said, a
 * thought's `surface` alone left blank), its lists fit, a thought reaches no one, and whom it reached
 * is said once each, never its actor, with what they got where they got only part of it or were told.
 */
export function beatProblem(beat: Beat, limits: StoryLimits): StoryProblem | null {
  if (beat.what.trim() === "") return { code: "blank", vars: { field: "what" } };
  if (beat.kind !== "inner" && beat.surface.trim() === "") return { code: "blank", vars: { field: "surface" } };
  const quotes = beat.quotes ?? [];
  if (quotes.length > limits.quotes) return many("quotes", quotes.length, limits, "quotes");
  if ((beat.to ?? []).length > limits.people) return many("to", beat.to?.length ?? 0, limits, "people");
  if (beat.exposure.length > limits.people) return many("exposure", beat.exposure.length, limits, "people");
  const texts: [string, string, keyof StoryLimits][] = [["what", beat.what, "beatChars"], ["surface", beat.surface, "beatChars"], ...quotes.map((q, i): [string, string, keyof StoryLimits] => [`quote ${i + 1}`, q, "quoteChars"]), ...beat.exposure.map((e): [string, string, keyof StoryLimits] => [`what ${e.who} got`, e.got ?? "", "beatChars"])];
  for (const [field, text, limit] of texts) {
    const problem = lengthProblem(field, text, limits, limit);
    if (problem) return problem;
  }
  if (beat.kind === "inner" && beat.exposure.length > 0) return { code: "inner_reach", vars: {} };
  const seen = new Set<string>();
  for (const e of beat.exposure) {
    if (e.who === beat.by) return { code: "reach_actor", vars: { who: e.who } };
    if (seen.has(e.who)) return { code: "reach_twice", vars: { who: e.who } };
    seen.add(e.who);
    if (e.reach !== "whole" && (e.got ?? "").trim() === "") return { code: "got_missing", vars: { who: e.who, reach: e.reach } };
  }
  return null;
}

/** Why `draft` can't be written, against `limits`; null where it can. */
export function draftProblem(draft: Draft, limits: StoryLimits): StoryProblem | null {
  if (draft.what.trim() === "") return { code: "blank", vars: { field: "what" } };
  if (draft.who.length > limits.people) return many("who", draft.who.length, limits, "people");
  if ((draft.where ?? []).length > limits.people) return many("where", draft.where?.length ?? 0, limits, "people");
  return lengthProblem("what", draft.what, limits, "draftChars") ?? lengthProblem("notes", draft.notes ?? "", limits, "draftChars");
}

/**
 * Who staging puts in reach of what is done at `where`: everyone there, or in a place that is one
 * with it (as presence counts it), who is a person, is still in the world and can take it in; never
 * `by`, who did it, nor the player's character where `by` is "player". Each as having taken in all of
 * it: what the caller confirms or adjusts. The player's character is named "player", as a beat names
 * them. None where nothing happens anywhere the world names.
 */
export function inReach(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, where: string | null, by: string): Exposure[] {
  if (where === null) return [];
  return Object.keys(state.entities)
    .sort()
    .filter((id) => together(world, where, placeOfEntity(state, id)) && kindIs(reg, world, state.entities[id]?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id))
    .map((id) => (id === world.pov ? "player" : id))
    .filter((who) => who !== by)
    .map((who): Exposure => ({ who, reach: "whole" }));
}
