// What today's ledger tells a turn's diagnostics (DESIGN §6.9), carried for the migration with the
// ledger (PlanSwap-5): where a record belongs, a step's verdict, an error's message, and the part of
// the old runtime's diagnostics (src/backend/diagnostics.ts) the ledger calls.

import type { ChatId, UserId } from "../../shared/ids";
import type { DiagPhase, TurnPhaseName } from "../../shared/diagnostics";

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
