// The prepared start as it runs (`lre.prepareLive`, `backend/story/prepare-live.ts`): where it
// stands, who is at work on it, how far it has come, what it has taken and cost, and what happened,
// for the live view in Play → Now's card. Read from the preparation's file, the jobs LumiAH lists and
// the list of the chat's own files, never the chat itself, so a page may ask for it every few
// seconds for hours. Facts only, each from what ran: the page words them. A file older than a fact
// keeps none of it, and the view says so (null, or false) rather than guess.

import type { PrepareDepth, StoryNames } from "./story-pages";

/** The stages of a preparation, in their order. */
export const PREPARE_STAGES = ["reading", "planning", "waiting", "reliving", "filling", "scene", "ready"] as const;
export type PrepareStage = (typeof PREPARE_STAGES)[number];

/** How a stage stands: done; the one the preparation is at; still to come; or none of this preparation's (a new chat relives nothing; a plan within the player's ceiling needed no word). */
export type PrepareStageState = "done" | "now" | "ahead" | "skipped";

/** How the preparation is going: a run of it at work; a run waiting for its place; held; its plan waiting for the player's word with no run; nothing under way before it was done; done. */
export type PrepareGoing = "running" | "queued" | "held" | "waiting" | "stopped" | "done";

/** Who a run is: the author, the historian, a principal, or another agent of the story's. */
export type PrepareRole = "author" | "historian" | "principal" | "other";

/** Where a run stands, as LumiAH says it: waiting for its place, at work, held; or ended without its work done (failed, cut off by a restart, out of what it may spend, the reply it worked for gone, cancelled). */
export type PrepareRunState = "queued" | "running" | "paused" | "failed" | "interrupted" | "spent" | "off_path" | "cancelled";

/** One run of the preparation: one under way, or the last of someone's that stopped before its work was done. */
export interface PrepareRunLine {
  /** LumiAH's id of the job; for the historian at work inside another run, that run's. */
  id: string;
  role: PrepareRole;
  /** A principal's entity id; null for anyone else. */
  who: string | null;
  /** The agent definition it runs as. */
  agent: string;
  state: PrepareRunState;
  /** The stretch it works on, where the preparation's file says which; null where it says none. */
  stretch: string | null;
  /** Since when, in ms: its start, or its wait for its place while queued; for the historian inside another run, when its stretch was opened (null where the file keeps no times). */
  since: number | null;
  /** When it ended; null while under way. */
  endedAt: number | null;
  /** What it has used, as LumiAH counts it (live while it runs); null for the historian inside another run, whose use is that run's. */
  used: { tokens: number; calls: number } | null;
  /** Why it stopped, in LumiAH's words; null where it gave none. */
  reason: string | null;
  /** For a run out of what it may spend: its own allowance, or a day's limit; null for any other. */
  stoppedAt: "allowance" | "day" | null;
  /** The run the historian works inside (the author's, which handed it its stretch); null for a run of its own. */
  inside: string | null;
}

/** How far a stretch has come: waiting to be opened; being read and recorded by the historian; recorded, with principals it reached still reliving it; done, everyone it reached having relived it; recorded, in a file too old to say who relived it; left out by the depth the preparation goes to; dropped from the plan. */
export type PrepareStretchState = "waiting" | "reading" | "reliving" | "done" | "recorded" | "left" | "dropped";

export interface PrepareStretchLine {
  id: string;
  from: number;
  to: number;
  state: PrepareStretchState;
  /** Beats recorded of it so far. */
  beats: number;
  /** The last message its beats cover so far; null before any. */
  through: number | null;
  /** One of the few moments that made the story what it is, as the author marked it: what the depth "key" relives. */
  key: boolean;
  /** Who relives it: whom its beats reached once it is recorded, where the file keeps that; else whom the plan names. */
  relivers: string[];
  /** Those of them who have taken it in, as of `relivedAt`; null where the file keeps none. */
  relived: string[] | null;
}

/** One principal of the plan and how far their part has come. */
export interface PreparePrincipalLine {
  id: string;
  /** The stretches they relive (whom a recorded stretch reached, where kept, else whom the plan names), dropped ones aside. */
  planned: number;
  /** Of those, how many they have taken in, as of `relivedAt`; null where the file keeps none. */
  relived: number | null;
  /** Their outline is written; null on a new chat, which has no past to outline. */
  outline: boolean | null;
  /** Their profile (`core.md`) is written. */
  profile: boolean;
  /** A run of theirs is under way. */
  atWork: boolean;
}

/** What a trail line is: an entry of the preparation's own log, as its tools and the player's presses wrote it; or a run of it as LumiAH lists it: begun, ended, stopped before its work was done (with LumiAH's reason), cancelled, started again. */
export type PrepareTrailWhat =
  | "planned"
  | "revised"
  | "said"
  | "answered"
  | "approved"
  | "depth"
  | "cap"
  | "opened"
  | "recorded"
  | "dropped"
  | "relived"
  | "outlined"
  | "profiled"
  | "paused"
  | "resumed"
  | "cancelled"
  | "carried"
  | "stopped"
  | "reopened"
  | "finished"
  | "run_started"
  | "run_ended"
  | "run_stopped"
  | "run_cancelled"
  | "run_again";

/** One line of the trail: when, what, and what it names (a stretch, a principal, a run's role and agent, words, a count). */
export interface PrepareTrailEntry {
  at: number;
  what: PrepareTrailWhat;
  stretch?: string;
  who?: string;
  role?: PrepareRole;
  agent?: string;
  text?: string;
  count?: number | null;
}

/** The preparation as it runs. */
export interface PrepareLive {
  /** A chat with a history to relive, or a new one; null before the file says which. */
  kind: "history" | "new" | null;
  /** The stage it is at, and each stage as it stands, in order. */
  stage: PrepareStage;
  stages: { id: PrepareStage; state: PrepareStageState }[];
  going: PrepareGoing;
  /** The depth it goes to (the player's pick, else the author's recommendation) and the author's recommendation; null for a plan from before depths, which relives every stretch, or before a plan. */
  depth: { chosen: PrepareDepth; recommended: PrepareDepth; picked: boolean } | null;
  /** Who is at work: each run under way, the historian inside the run that handed it its stretch, and the last run of anyone's that stopped before its work was done; the author first. */
  runs: PrepareRunLine[];
  /** Every stretch of the plan, in the chat's order. */
  stretches: PrepareStretchLine[];
  principals: PreparePrincipalLine[];
  /** Of the chat's messages as the plan found them: relived (in a stretch done), filled from summaries (in what a summary covers, not relived), neither; null where the file doesn't keep the chat's count. */
  messages: { total: number; relived: number; filled: number; neither: number } | null;
  /** When who has relived each stretch was last worked out; null where the file keeps no time of it. */
  relivedAt: number | null;
  /** The file says whom each recorded stretch reached and who relived it: an older one doesn't. */
  reach: boolean;
  /** The scene and the author's notebook are written since the plan. */
  scene: boolean;
  notebook: boolean;
  /** When it started (its first log entry or its first run), when it finished (null until then), and how long its author's runs have worked, less the time they were held. */
  startedAt: number | null;
  endedAt: number | null;
  workedMs: number;
  /** A rough time left for the stretches not yet done, at the pace of those done so far (the file's own times, less the time it was held or waited for the player's word); null before a stretch is done, or where the file keeps no times. */
  left: { ms: number; stretches: number } | null;
  /** What it has spent, as LumiAH counts it; what the whole is reckoned at (null before a plan); the player's cap (null: none). */
  spent: number;
  estimate: number | null;
  cap: number | null;
  /** What happened, newest first. */
  trail: PrepareTrailEntry[];
  /** The file keeps its own log: an older one keeps none, and only its runs show in the trail. */
  logged: boolean;
  names: StoryNames;
}

/** `lre.prepareLive`: the chat's preparation as it runs (null: none to show), when it was read, and whether the page asks again: every `every` seconds while a run of it is under way, and not once none is. */
export interface PrepareLiveView {
  at: number;
  live: boolean;
  every: number;
  prep: PrepareLive | null;
}
