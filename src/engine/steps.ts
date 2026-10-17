// Model steps (DESIGN §5.2, D10, D31; ARCHITECTURE §3.4). The engine asks; the backend answers
// through a StepPort it implements over the host. Routing (D10): `interpret` on the helper;
// `npc.choose` on the Decision connection; on a decision error the helper, then
// engine-only. Prompts and schemas stay model-agnostic (D31). Producers land after the ledger gate.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ActionId } from "../shared/ids";
import type { GenerationKind, LedgerEvent } from "../shared/ledger";
import type { StepPurpose, WorldDoc } from "../shared/world";
import type { Judgement } from "./adjudication";
import type { Answers, Questions } from "./decide";
import type { Registry } from "./registry-impl";
import type { WorldState } from "./state";

export interface DecisionRequest {
  purpose: StepPurpose;
  state: JsonValue;
  questions: Questions;
}

export interface DecisionResult {
  answers: Answers;
  /** Resolved model id. */
  model: string;
  /** Which path answered. */
  via: "decision" | "helper";
  ms: number;
}

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptRequest {
  purpose: StepPurpose;
  messages: PromptMessage[];
  maxTokens: number;
  json: boolean;
}

export interface PromptResult {
  text: string;
  model: string;
  ms: number;
}

export type StepFailure = { kind: "timeout" } | { kind: "aborted" } | { kind: "provider"; message: string } | { kind: "parse"; message: string };

export type StepOutcome<T> = { ok: true; value: T } | { ok: false; failure: StepFailure };

/** Implemented by the backend. Every call is bounded by the caller's signal; there is no blind retry. */
export interface StepPort {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<StepOutcome<DecisionResult>>;
  prompt(request: PromptRequest, signal: AbortSignal): Promise<StepOutcome<PromptResult>>;
}

/** `interpret`: typed input to at most one action (DESIGN §9.4). */
export interface InterpretInput {
  text: string;
  scene: JsonValue;
  actions: ActionId[];
}

export interface InterpretOutput {
  action: ActionId | null;
  params: JsonObject;
  probabilities: Record<string, number>;
  /** Time the input lets pass after the action ("…and sleep until the next morning"): `minutes` or `until`. */
  then?: JsonObject;
  /** The `judge` step's answer for the action's check (DESIGN §11), recorded with the intent so a Re-run reads the same one. */
  judgement?: Judgement;
}

/** `extract`: proposals read from a reply, bounded per channel (DESIGN §9.4). */
export interface ExtractInput {
  narration: string;
  /** The fold prefix the proposals validate against, rendered for the prompt. */
  prefix: JsonValue;
  /** Minutes already applied for this swipe (DESIGN §9.2, `time.advance`). */
  appliedMinutes: number;
  channels: string[];
}

export interface ExtractOutput {
  proposals: JsonObject[];
}

// ---------------------------------------------------------------- the pure turn pipeline
// Implemented in `engine/simulate.ts`; called by the ledger (`TurnModel`) through
// the backend. Everything here is synchronous and deterministic given its inputs: model steps run
// before (`interpret`) and after (`extract`) and arrive as plain data (DESIGN §5.1).

export interface TurnPlanInput {
  registry: Registry;
  world: WorldDoc;
  /** The fold prefix with the target's live markers applied (DESIGN §5.1 step 2.1). */
  state: Readonly<WorldState>;
  runSeed: string;
  /** The action seed: fresh per Re-run, or `hash(runSeed, parent path, action)` in same-roll worlds. */
  seed: string;
  kind: GenerationKind;
  /** The turn's user messages, oldest first. */
  userTexts: string[];
  /** `interpret`'s answer when it ran and succeeded; null otherwise (engine-only, or not an action). */
  intent: InterpretOutput | null;
}

/** Pre-reply events: resolution, elapsed time, simulation, timelapse and in-turn materialization, in fold order. */
export interface TurnPlan {
  events: LedgerEvent[];
  /** The turn's elapsed game minutes (already included in `events` as clock advances). */
  elapsedMinutes: number;
}

export interface PostTurnInput {
  registry: Registry;
  world: WorldDoc;
  /** The fold prefix plus `pre` plus the validated extraction events. */
  state: Readonly<WorldState>;
  runSeed: string;
  seed: string;
  /** Minutes this swipe has applied so far (elapsed plus any `time.advance`). */
  appliedMinutes: number;
  /** The validated extraction events, so post steps can fire event rules on them (e.g. `enter`). */
  extracted: LedgerEvent[];
}

export interface TurnPipeline {
  plan(input: TurnPlanInput): TurnPlan;
  /** Post steps after extraction: catch-up, off-screen agents, tracks and rules (DESIGN §5.1 step 5). */
  post(input: PostTurnInput): LedgerEvent[];
}
