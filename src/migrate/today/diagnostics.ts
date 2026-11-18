// What today's ledger tells a turn's diagnostics (DESIGN §6.9), carried for the migration with the
// ledger (PlanSwap-5): where a record belongs, a step's verdict, an error's message, and the part of
// the old runtime's diagnostics (src/backend/diagnostics.ts) the ledger calls. With them, what
// today's ledger and settings store read of the old diagnostics' shared half (PlanSwap-15 item 3):
// the phases a record falls in, the parts of a turn's time, the words a stopped or refused run says,
// a phase's in-flight label and the diagnostics settings.

import type { ChatId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";

/** Where in a turn a record falls. `request` is a frontend request (a view or an edit). */
export type DiagPhase = "pre" | "plan" | "prose" | "sections" | "reply" | "read" | "memory" | "skip" | "request";

/**
 * The parts of a turn's time, in the turn's order (Settings → Speed, GM → Live and Diagnostics show
 * them as "Where the last turn's time went"). Each is recorded as it ends (`phase`), with its time
 * and, where it says why, its cause: `wait` the time the turn waited for the chat (another write or
 * turn holding it), `setup` reading the chat and settings up to the first model call, `compaction`
 * the main session's summary of earlier turns on the turn's path (cause `ready` when it was made
 * ahead), `digest` what changed since the main agent's last turn, `stage.<stage>` the main agent's
 * sends in each stage, `plan` the engine's plan, `brief` the narrator's brief and outline,
 * `final_review` the final review, `reply` the narrator's reply, `read` the reply's read, and
 * `memory` the minds' memory.
 */
export const TURN_PHASES = ["wait", "setup", "compaction", "digest", "stage.intent", "stage.prepare", "stage.beats", "stage.read", "stage.memory", "plan", "brief", "final_review", "reply", "read", "memory"] as const;
export type TurnPhaseName = (typeof TURN_PHASES)[number];

/** Records kept per chat unless Settings → Diagnostics says otherwise; the oldest go first. */
export const DIAG_RING = 400;

/** Settings → Diagnostics (AGENT-LOOP-PLAN §15). */
export interface DiagnosticsSettings {
  /** Records kept per chat, the oldest going first: agent calls fill them faster than helper steps. */
  recordsPerChat: number;
}

export const DIAGNOSTICS_DEFAULTS: Readonly<DiagnosticsSettings> = Object.freeze({ recordsPerChat: DIAG_RING });

/** `UserSettings.diagnostics` as stored: a whole number of records from 1, with no ceiling, else `base`'s. */
export function diagnosticsSettingsOf(raw: unknown, base: Readonly<DiagnosticsSettings> = DIAGNOSTICS_DEFAULTS): DiagnosticsSettings {
  const n = isRecord(raw) ? raw.recordsPerChat : undefined;
  return { recordsPerChat: typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : base.recordsPerChat };
}

/** A phase's or a model call's in-flight label, by phase or step purpose. */
export const STEP_LABEL: Record<string, string> = {
  engine: "Running the engine…",
  pre: "Planning…",
  interpret: "Reading your action…",
  judge: "Judging the approach…",
  "puzzle.answer": "Judging the answer…",
  "npc.choose": "Choosing what people do…",
  mind: "Asking minds…",
  skip: "Running the time skip…",
  plan: "Planning…",
  prose: "Writing the outline…",
  brief: "Writing the outline…",
  outline: "Writing the outline…",
  sections: "Filling the prompt…",
  /** The main agent's final review of the narrator's prompt (DESIGN §4.6), after the sections are made. */
  "final review": "Reviewing the prompt…",
  book: "Waiting for another chat of this world…",
  clear: "Clearing an earlier turn's sections…",
  restart: "Ready; reopen the chat to continue",
  elsewhere: "Already started in another window",
  ready: "Ready: press Send for the reply",
  reply: "Waiting for the reply…",
  read: "Reading the reply…",
  extract: "Reading the reply…",
  choices: "Writing choices…",
  memory: "Updating memory…",
  consolidate: "Updating memory…",
  knowledge: "Working out who knows what…",
  minds: "Updating the characters' memories…",
  /** The GM assistant answering in GM → Assistant, outside any turn: its label is all the line shows of it. */
  assistant: "Asking the GM assistant…",
  /** The main agent working a stage of an agent turn (`pipeline.mode: main`): its label is all the line shows of it. */
  main: "The main agent is working…",
};

/** Where a record belongs: the chat, its owner, and the generation (null outside a turn). */
export interface DiagAt {
  chatId: ChatId;
  userId: UserId;
  turn: string | null;
}

/** A step's verdict when it returned without throwing but didn't do its work. */
export type DiagVerdict = { status: "skipped" | "failed"; reason: string; fix?: string } | null;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The part of the old runtime's diagnostics the ledger calls; the runtime sets its own as the ledger's `diag`. */
export interface LedgerDiagnostics {
  begin(at: DiagAt, label?: string): void;
  rest(at: { chatId: ChatId; userId: UserId }, label: string): void;
  end(at: DiagAt, outcome?: DiagVerdict): void;
  failed(at: DiagAt, phase: DiagPhase, step: string, reason: string, fix?: string): void;
  skipped(at: DiagAt, phase: DiagPhase, step: string, reason: string): void;
  step<T>(at: DiagAt, phase: DiagPhase, step: string, fn: () => Promise<T>, judge?: (value: T) => DiagVerdict, purposes?: readonly string[]): Promise<T>;
  phased<T>(at: DiagAt, name: TurnPhaseName, fn: () => Promise<T>, cause?: (value: T) => string | undefined): Promise<T>;
  error(at: DiagAt, where: string, error: unknown, context?: string): void;
  failure(at: DiagAt): { step: string; reason: string } | null;
  stopped(at: DiagAt): { step: string; reason: string } | null;
  phase(at: DiagAt, p: { name: TurnPhaseName; ms: number; cause?: string }): void;
  rename(chatId: ChatId, from: string, to: string): void;
}
