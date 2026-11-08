// The bootstrap (DEPTH-PLAN §8): onboarding an existing chat into depth. What the Bootstrap view
// shows (§7, §8.3), the estimate the opt-in offers (§8.1 step 1), the spot-check cards the user marks
// (§8.6), the advice about the memory systems the bootstrap replaces (D-18) and the `lre.bootstrap`
// request's operations. Every number here is bookkeeping; every judgment the run makes is an agent's.

import type { ChatId, EntityId, MessageId } from "./ids";
import type { Misread } from "./misread";

/** The run's stages, in the order a chunk passes through them (§8.1, §8.2). */
export const BOOTSTRAP_STAGES = ["survey", "import", "historian", "author", "pov", "minds", "truthlink", "reconcile"] as const;
export type BootstrapStage = (typeof BOOTSTRAP_STAGES)[number];

/** `estimated`: surveyed, waiting for Start. `pausing`: Pause pressed, calls under way are finishing. */
export type BootstrapStatus = "idle" | "estimated" | "running" | "pausing" | "paused" | "done" | "failed";

/** What a stage spent or will spend. `cost` is in the connection's money as the provider reported it; null where nothing reported one. */
export interface StageCounts {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cost: number | null;
  /** Wall-clock time, in milliseconds. */
  ms: number;
}

export const NO_COUNTS: StageCounts = { calls: 0, tokensIn: 0, tokensOut: 0, cost: null, ms: 0 };

/** The user's cap on the run (§8.3): money or tokens. */
export interface BootstrapCap {
  unit: "money" | "tokens";
  value: number;
}

export interface StageEstimate extends StageCounts {
  stage: BootstrapStage;
  /** The connection the stage's role is set to (Settings → Depth), by its name (its id when Lumiverse no longer has it; null: the helper model's), and its model. */
  connection: string | null;
  model: string | null;
  /** The rates come from this chat's own finished chunks, not the first guess (§8.3, "estimates that learn"). */
  measured: boolean;
}

/** The estimate (§8.1 step 1): from the survey's counts and the chosen models, per stage, before anything runs; afterwards, what the rest would cost. */
export interface BootstrapEstimate {
  chatId: ChatId;
  messages: number;
  words: number;
  tokens: number;
  chunks: number;
  /** The characters the estimate assumes get a mind: those the world already has, until the author's own picks are known. */
  minds: number;
  /** Per stage: what the remaining work would take. */
  stages: StageEstimate[];
  total: StageCounts;
  /** Assumptions and anything the estimate can't price, in plain words. */
  notes: string[];
  /** The largest resident memory the run has measured, in bytes (the rest needs about as much: jobs at once bound it, not the chat's length); null before it ran. */
  rss: number | null;
}

export interface StageProgress {
  stage: BootstrapStage;
  done: number;
  total: number;
  spent: StageCounts;
  /** The largest resident memory measured as the stage's calls and landings ended, in bytes; null where it hasn't run (§8.5, measured on the dev copy). */
  rss: number | null;
}

export interface ChapterView {
  /** The chapter's index, counting from 0 (the run's own lines and the tab say it from 1). */
  n: number;
  /** The chunks it spans, first and last, by index from 0. */
  chunks: [number, number];
  /** The author marked its end; the last chapter stays open until the run reaches the latest message. */
  ended: boolean;
  /** Its spot-check card: waiting for the user, reviewed, or none yet. */
  spot: "none" | "waiting" | "reviewed";
}

/** One thing on a spot-check card (§8.6), beside what it came from. */
export type SpotItem = { id: string; mark: SpotMark | null; flagged: boolean } & (
  | { kind: "beat"; beat: string; what: string; quotes: string; message: MessageId; index: number; prose: string }
  | { kind: "memory"; who: EntityId; name: string; path: string; text: string; lived: { beat: string; text: string }[] }
  | { kind: "notebook"; path: string; excerpt: string; cites: string[] }
  | { kind: "contradiction"; entry: string; source: ImportSource; title: string; text: string; against: string; why: string }
);

export interface SpotMark {
  right: boolean;
  /** A word on what is wrong. */
  note: string;
  at: number;
}

export interface SpotCheckCard {
  id: string;
  /** The chapter's index, counting from 0, as `ChapterView.n`. */
  chapter: number;
  createdAt: number;
  items: SpotItem[];
  /** The model answers the run's parsers didn't keep whole since the card before (the raw-against-saved audit): each with its job and the fields; the answer as written stays in the job's record. Absent when none. */
  misread?: SpotMisread[];
}

/** One call of a job whose answer its stage's parse didn't keep whole: which job and call, and the fields (the first listed of `count`). */
export interface SpotMisread {
  stage: BootstrapStage;
  /** The job's slot ("historian:3", "minds:3:mira"): its record, `jobs/<slot>.json`, keeps the answer as the model wrote it. */
  job: string;
  /** The call's place among the job's calls, from 0. */
  call: number;
  fields: Misread[];
  count: number;
}

/** Where an imported entry came from (§8.1 step 2): `world_lore` is the world document's own lore, `world_info` the chat's World Info books. */
export type ImportSource = "world_lore" | "world_info" | "lumibooks" | "summary" | "cortex" | "lre_minds";

/** What the import read, per source: how many entries, or why it couldn't read them. */
export interface ImportView {
  source: ImportSource;
  entries: number;
  /** Null when it read them; else why not, in plain words. */
  unreadable: string | null;
  /** The chat is marked as using it (LumiBooks' book markers), whatever could be read of it. */
  marked?: true;
}

/** D-18: after the bootstrap, advise turning these off for the chat; nothing more. */
export interface BootstrapAdvice {
  system: "lumibooks" | "summary" | "cortex";
  /** The chat uses it (entries or a summary were found). */
  found: boolean;
  text: string;
}

export interface BootstrapView {
  chatId: ChatId;
  /** The chat is on depth (GM → This chat → Depth). */
  optedIn: boolean;
  status: BootstrapStatus;
  /** Why it paused, stopped or failed, in plain words; null while it runs. */
  reason: string | null;
  startedAt: number | null;
  updatedAt: number;
  /** Milliseconds the run has spent running (pauses excluded). */
  elapsedMs: number;
  chunks: { done: number; total: number };
  progress: StageProgress[];
  chapters: ChapterView[];
  spent: StageCounts;
  cap: BootstrapCap | null;
  /** What the rest would take; null before the survey. */
  remaining: BootstrapEstimate | null;
  imported: ImportView[];
  /** Cards waiting for the user's marks, oldest first. */
  spot: SpotCheckCard[];
  /** Redo from this chapter is offered: a run of wrong marks paused the run (§8.6), or a chunk's beats read again couldn't take the place of the old (§8.4), which only a fresh reading changes. */
  redoFrom: number | null;
  advice: BootstrapAdvice[];
  /** The latest lines of the run's log, newest last. */
  log: string[];
}

/** `lre.bootstrap`'s operations; every one answers with the chat's `BootstrapView`, `estimate` with a `BootstrapEstimate` too. */
export type BootstrapOp =
  | { op: "status" }
  | { op: "estimate" }
  | { op: "opt"; on: boolean }
  | { op: "start"; cap?: BootstrapCap | "none" }
  | { op: "pause" }
  | { op: "resume"; cap?: BootstrapCap | "none" }
  | { op: "mark"; card: string; item: string; right: boolean; note?: string }
  | { op: "redo"; chapter: number };

export const BOOTSTRAP_LOG_LINES = 40;
