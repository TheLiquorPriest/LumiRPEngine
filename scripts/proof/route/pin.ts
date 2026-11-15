// How RPH's pin is held, and the one rule for whether it is one (PlanScenarios-3 item 7; READINGS R-19, R-196).
// RPH counts as pinned only when RPE's manifest names one whole commit (forty hex digits), it is the commit
// installed, and the manifest's whole name is the one the pin's stage gives: `rph.invalid`'s until publishing,
// GitHub's after it. A shared prefix is no pin, and a link or a name that holds no commit is none. The stage is the
// lead's publishing step's to set (`RPE_PROOF_PIN_STAGE`), never a guess from the name: a name read back as its own
// stage would check nothing.

import { existsSync, readFileSync } from "node:fs";
import { isRecord } from "../../../src/shared/json";
import type { PinFrom, PinHeld, PinStage } from "./host";

/** A whole commit: forty hex digits. */
export const WHOLE_COMMIT = /^[0-9a-f]{40}$/;

export const PIN_FROMS: readonly PinFrom[] = ["rph-repository", "bed-mirror", "github"];
export const PIN_STAGES: readonly PinStage[] = ["before-publishing", "after-publishing"];

/** The name RPE's manifest holds for `rp-harness` at a stage: a host that is no host until publishing, GitHub's after it. */
export function pinName(stage: PinStage, commit: string): string {
  return stage === "before-publishing" ? `git+https://rph.invalid/RPHarness.git#${commit}` : `github:TheLiquorPriest/RPHarness#${commit}`;
}

/** Why RPH is not the pinned commit, in plain words; empty when it is. */
export function pinReasons(rph: { commit: string; pin: string | null; held: PinHeld }): string[] {
  const why: string[] = [];
  if (rph.pin === null) why.push("RPE's manifest names no commit for rp-harness");
  else if (!WHOLE_COMMIT.test(rph.pin)) why.push(`RPE's manifest names ${rph.pin.length} characters of a commit: a shared prefix is no pin, and a pin is one whole commit of forty hex digits`);
  if (!WHOLE_COMMIT.test(rph.commit)) why.push(`RPH as installed is ${rph.commit.length} characters of a commit: a shared prefix is no pin, and a pin is one whole commit of forty hex digits`);
  if (rph.pin !== null && WHOLE_COMMIT.test(rph.pin) && WHOLE_COMMIT.test(rph.commit) && rph.pin !== rph.commit) why.push("the two are different commits (a shared prefix is no pin)");
  if (rph.held.name === null) why.push("the manifest's name for rp-harness is not given");
  else if (rph.pin !== null && WHOLE_COMMIT.test(rph.pin) && rph.held.name !== pinName(rph.held.stage, rph.pin)) why.push(`the manifest names rp-harness ${rph.held.name}, and the name ${rph.held.stage === "before-publishing" ? "before" : "after"} publishing is ${pinName(rph.held.stage, rph.pin)}`);
  return why;
}

/** Whether RPH as installed is the commit RPE pins: the one rule, worked out when a run is made and again whenever its bundle is read. */
export function isPinned(rph: { commit: string; pin: string | null; held: PinHeld }): boolean {
  return pinReasons(rph).length === 0;
}

/** What the pin's `held` record is missing, for the facts' check; empty when it is whole. */
export function heldFaults(held: unknown, mode: "rig" | "live"): string[] {
  if (!isRecord(held)) return ["how the pin was held (the manifest's name for rp-harness, where it was installed from, the stage, the bundles)"];
  const out: string[] = [];
  if (!(held.name === null || (typeof held.name === "string" && held.name.trim() !== ""))) out.push("the manifest's name for rp-harness");
  if (!PIN_FROMS.includes(held.from as PinFrom)) out.push(`where rp-harness was installed from (${PIN_FROMS.join(", ")})`);
  if (!PIN_STAGES.includes(held.stage as PinStage)) out.push(`the pin's stage (${PIN_STAGES.join(", ")})`);
  const bundles = held.bundles;
  const bundleOk = bundles === null || (isRecord(bundles) && typeof bundles.rpe === "string" && WHOLE_COMMIT.test(bundles.rpe) && typeof bundles.rph === "string" && WHOLE_COMMIT.test(bundles.rph));
  if (!bundleOk) out.push("the commit ids of the bundles the mirrors were fed from (forty hex digits each)");
  else if (mode === "live" && held.from === "bed-mirror" && bundles === null) out.push("the commit ids of the bundles the bed's mirrors were fed from");
  return out;
}

/** What a host knows of how the pin was held, besides the manifest itself. */
export interface PinHow {
  from: PinFrom;
  stage: PinStage;
  bundlesFile: string | null;
}

/** The stage and the origin as the environment gives them: no default, since the lead's publishing step is what sets the stage. */
export function pinSettingsFromEnv(env: Record<string, string | undefined> = process.env): { stage: PinStage; from: PinFrom | null; bundlesFile: string | null } {
  const stage = env.RPE_PROOF_PIN_STAGE?.trim();
  if (!PIN_STAGES.includes(stage as PinStage)) throw new Error(`set RPE_PROOF_PIN_STAGE to ${PIN_STAGES.join(" or ")}: the lead's publishing step sets it, and a run records which name RPE's manifest was held to`);
  const from = env.RPE_PROOF_PIN_FROM?.trim();
  if (from !== undefined && from !== "" && !PIN_FROMS.includes(from as PinFrom)) throw new Error(`RPE_PROOF_PIN_FROM is ${from}; it names where rp-harness was installed from: ${PIN_FROMS.join(", ")}`);
  return { stage: stage as PinStage, from: from === undefined || from === "" ? null : (from as PinFrom), bundlesFile: env.RPE_PROOF_BUNDLES?.trim() || null };
}

/** The commit ids the bed's mirrors were fed from (`scripts/proof/bed/feed.sh` leaves them in a file of two lines, `rpe <id>` and `rph <id>`, or as JSON `{rpe, rph}`). */
export function readBundles(file: string): { rpe: string; rph: string } {
  if (!existsSync(file)) throw new Error(`${file} (RPE_PROOF_BUNDLES) is not there: feed.sh leaves the commit ids of the bundles it fed the mirrors from`);
  const text = readFileSync(file, "utf8").trim();
  const found: Record<string, string> = {};
  if (text.startsWith("{")) {
    const raw: unknown = JSON.parse(text);
    if (isRecord(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") found[k] = v;
  } else {
    for (const line of text.split("\n")) {
      const [name, id] = line.trim().split(/\s+/);
      if (name !== undefined && id !== undefined) found[name] = id;
    }
  }
  const { rpe, rph } = found;
  if (rpe === undefined || rph === undefined || !WHOLE_COMMIT.test(rpe) || !WHOLE_COMMIT.test(rph)) throw new Error(`${file} does not give both bundles' commit ids, forty hex digits each`);
  return { rpe, rph };
}

/**
 * How the pin was held, from RPE's manifest and the settings: the whole name, where the installed copy came from
 * (`from` as the host knows it, else `RPE_PROOF_PIN_FROM`), the stage, and the bundles the mirrors were fed from.
 */
export function heldOf(manifest: unknown, how: PinHow): PinHeld {
  const dependencies = isRecord(manifest) ? manifest.dependencies : undefined;
  const name = isRecord(dependencies) && typeof dependencies["rp-harness"] === "string" ? dependencies["rp-harness"] : null;
  return { name, from: how.from, stage: how.stage, bundles: how.from === "bed-mirror" ? (how.bundlesFile === null ? null : readBundles(how.bundlesFile)) : null };
}
