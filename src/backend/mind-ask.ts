// Where the minds' model calls take their answers (INC2-SPEC lane T2): a mind, a memory, a
// consolidation, the knowledge step, a time skip's beats and its plan. Each is asked through
// `askMind`. A classic turn has no asker, so every call is its step's own (`classic`); an agent
// turn's roles answer them (`backend/agents/roles/minds-ask.ts`), with classic's own check of the
// answer and classic's own call to fall back on. What is asked, what it reads and how its answer is
// checked and recorded stay classic's either way.

import type { EntityId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import type { MindPurpose } from "../shared/minds";

/** What a call is: a minds step, or a time skip's plan (the `skip` step's purpose, with a prompt of its own). */
export type MindCallKind = MindPurpose | "skip_plan";

export interface MindCall {
  kind: MindCallKind;
  /** Whom the call thinks for: null for one about no one (a scene's knowledge step, a skip's beats or plan). */
  who: EntityId | null;
  /** The placeholders its prompt is filled with, as classic fills them. */
  vars: Readonly<Record<string, string>>;
  /** The world's or the user's own wording of the step's prompt, as classic would send it filled in; null for the shipped one. */
  template: string | null;
  /** What it reads: the call's user message, as classic sends it. */
  context: string;
  signal: AbortSignal;
  /** What the call spent, in tokens, as the step's trace counts it. */
  usage: { tokens: number };
  /** Why it failed, in short words naming no one, when it does. */
  failure: { reason: string };
  /** A memory call while the chat tracks knowledge: its answer is the one without `told` (§16), telling being the knowledge step's. */
  knowing?: true;
  /** Whether an answer is one the step takes: classic's own check of it. */
  check(raw: JsonValue): boolean;
  /** The call as classic makes it. */
  classic(): Promise<JsonValue | null>;
}

export type MindAsk = (call: MindCall) => Promise<JsonValue | null>;

/** A minds call's answer: the asker's, or with none, classic's own call. */
export function askMind(ask: MindAsk | undefined, call: MindCall): Promise<JsonValue | null> {
  return ask ? ask(call) : call.classic();
}
