// The chat's in-flight line (the HUD's and Play's activity line): what is going on in the chat's turn now,
// or what failed last. Folded by the kept Play page from RPE's live trace (`ui/kept/play/activity.ts`).

import type { ChatId } from "./ids";

/** The in-flight line: what the engine is doing for the chat now, or what failed last. */
export interface Activity {
  chatId: ChatId;
  turn: string | null;
  state: "running" | "failed";
  /** "Planning…", "Asking 3 minds…"; for a failure, the step that failed. */
  label: string;
  /** Epoch ms the turn's work started (running) or the failure happened. */
  since: number;
  /** A running line whose run Cancel can stop now; absent while it only waits for the reply or for Send. */
  cancellable?: boolean;
  /** While a turn runs, one row per agent at work (the live trace); absent when none is. */
  agents?: ActivityAgent[];
}

/**
 * One agent at work in the chat's turn, as the live trace shows it: its id, its label, and the tokens
 * it has sent and written this turn. Nothing else: what it reads and the tools it calls can name what
 * the player hasn't met.
 */
export interface ActivityAgent {
  id: string;
  label: string;
  tokens: { in: number; out: number };
}
