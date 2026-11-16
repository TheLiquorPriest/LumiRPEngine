// Build's background jobs as kept code reads them as data (DESIGN §13): what a job is, what it
// proposes, its result and its kept summary. Moved unchanged out of the previous extension's
// protocol (PlanSwap-13), which takes them back from here until it goes.

import type { EntityId, WorldId } from "./ids";
import type { JsonObject, JsonValue } from "./json";
import type { LintIssue } from "./lint";
import type { LoreIndexAddition } from "./lore";
import type { WorldCollection } from "./world";

/**
 * Background-lane jobs (DESIGN §13): Import from lore, Build/Refine with AI, Describe a map,
 * Propose routines from lore, Playtest, Check world, and the lore indexing jobs (§4.2). Input:
 * `import_lore` `{bookIds}`; `refine` `{instructions}`; `describe_map` `{scope, prose, mapId?}`
 * (the place drawn, the author's description, and the map's id, by default `<scope>_map`; its one
 * proposal is the map); `propose_routines` `RoutineJobInput`; `playtest` `{turns: string[]}`;
 * `check_world` `{days?: number}` (1–14 simulated days, default 3); `index_text` `{text}`.
 * Playtest and Check world results share the `turns`/`lint` shape (Check
 * world: one entry per day, with drops, failures and leaks as notes).
 */
export type JobKind = "import_lore" | "refine" | "describe_map" | "propose_routines" | "playtest" | "check_world" | "index_text";

/** Where a job stands while it runs and once it ends. */
export type JobStatus = "running" | "done" | "failed" | "cancelled";

/** A proposed world edit; the UI applies accepted ones as `lre.editor put`, then `lre.world commit`. */
export interface JobProposal {
  id: string;
  collection: WorldCollection;
  key: string;
  value: JsonValue;
  source: string;
  confidence: number;
  note?: string;
  /** The pack the proposal belongs to (an entity's kind's pack; `space` for places and routes), for grouping the review. */
  pack?: string;
  /**
   * Import: the title of each lore entry the value's `sources` cite, by back-link (`bookId/entryId`), for the review; a book index job: the book entry its lore entry comes from;
   * Propose routines: each source it cites, by key (a lore entry's id, or `<entity>.<field>` for a sheet's field), named as the review shows it.
   */
  sourceNames?: Record<string, string>;
  /** A lore indexing proposal: the terms and topics its entry joins in the lookup table when it is applied. */
  index?: LoreIndexAddition;
  /** Propose routines: the person or group it is for, for grouping the review by character and group. */
  owner?: EntityId;
  /**
   * What checking it against the draft found wrong, in the author's words: a place, owner or person
   * that isn't there, a window that can't be, company with no ground, a clash with what the owner's
   * schedules or routine already hold. The review starts it unticked.
   */
  problems?: string[];
}

/**
 * A job's result: proposals, with `next`, the input that continues a pass that stopped before the
 * end (Propose routines), or a run's turns and lint. `processMs`: a Check world day's ms per
 * simulated process, wall clock, shown beside the day; absent for Playtest.
 */
export type JobResult = { proposals: JobProposal[]; next?: JsonObject } | { turns: { user: string; reply: string; notes: string[]; processMs?: Record<string, number> }[]; lint: LintIssue[] };

/**
 * A kept job (`lre.job list`). `interrupted`: it was running when the extension stopped; its result
 * holds the proposals it had made by then, and `input` runs it again as it was started.
 */
export interface JobSummary {
  jobId: string;
  kind: JobKind;
  worldId: WorldId;
  status: JobStatus | "interrupted";
  progress: number;
  message?: string;
  result?: JobResult;
  input: JsonObject;
  /** Epoch ms of the job's last change. */
  at: number;
}
