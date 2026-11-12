// What each run of the prepared start (DEPTH2-PLAN §1.11) is started with: its own allowance from
// Settings → Story → Preparing, never LumiAH's allowance for any job, and the words its author is
// told of the preparation's file in place of LumiAH's own ask that a job write its plan. The file
// (`author/prepare.md`) is the plan of the whole preparation, kept by the preparing tools; what one
// run may spend bounds that run only, and the preparation carries on in a new run from the file
// (`prepare-carry.ts`). A run has no token limit of its own: what the whole preparation spends is
// held by the player's word on its plan and their cap, which the tools and the carrying on hold to.

import { PREPARE_NOTE } from "../../shared/harness-texts-prepare";
import type { PromptTexts } from "../../shared/prompts";
import type { StoryPrepare } from "../../shared/settings";
import { renderPrompt } from "../prompts";

/** What a run of the preparation is started with, as LumiAH's `jobs.start` takes it beside the job's agent, task and plan file. */
export interface PrepareRun {
  /** The run's own time and rounds; no token limit of its own (null). */
  allowance: { wallMs: number; toolTurns: number; tokensIn: null; tokensOut: null };
  /** What the author is told of the preparation's file and of its allowance, in place of being asked to write a plan. */
  planWords: string;
}

/** A run's start as the player's settings (`prepare`) and their texts make it. */
export function prepareRun(prepare: Pick<StoryPrepare, "runMinutes" | "runRounds">, texts: PromptTexts): PrepareRun {
  return { allowance: { wallMs: prepare.runMinutes * 60_000, toolTurns: prepare.runRounds, tokensIn: null, tokensOut: null }, planWords: renderPrompt(PREPARE_NOTE.runWords, texts, {}) };
}
