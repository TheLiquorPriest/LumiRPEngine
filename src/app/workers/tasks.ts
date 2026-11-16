// The one list of tasks RPE's worker threads run (`pool.ts`), each a function from its input to its
// answer, typed here for its callers. A thread is handed a task's name and input and runs it from this
// list, so a lane's heavy work runs on a thread once its function is listed here. Inputs and answers
// cross between threads by structured clone: plain data, and buffers that may be handed over.
//
// This file is where the lanes' heavy functions are put on the list, so it may reach the lanes that own
// them (the boundary test counts it with the composition). A lane's function is imported by the first
// task that needs it, on the thread that runs it: a static import would load every lane on every thread
// and, since the lanes import the application, which starts these threads, would close an import cycle
// through this file.

import type { CatalogueInput } from "../../lore/lore";
import type { WorldDoc } from "../../shared/world";
import type { FoldDone, FoldJob, StoreBrief } from "../../store/away";
import type { LabStepInput, LabStepOutput } from "../../worker/background-lane";
import { INDEX_TASKS } from "../index-file/thread";
import { grepLines } from "./grep";

const decoder = new TextDecoder();

export const TASKS = {
  /** A request's body as JSON; throws a SyntaxError for one that is not. */
  parseJson: (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes)),
  /** A pattern tested on the lines of one file's text: the grep of the agents' files, which the pool may end when its time is out. */
  grepLines,
  /**
   * A fold longer than the store runs where it is asked (`store.workerFoldAt`): the thread reads the database file on a connection of its
   * own, folds with the shipped packs and the areas the store was opened with, and answers with the states it held and the snapshots
   * it found worth storing, which the store takes as its own.
   */
  fold: async (input: { brief: StoreBrief; job: FoldJob }): Promise<FoldDone> => {
    const [{ foldAway }, { STORE_AREAS }] = await Promise.all([import("../../store/away-thread"), import("../../turn/store-areas")]);
    return foldAway(input, STORE_AREAS);
  },
  /** A large library's catalogue (`Lore.catalog`): each entry's id, title, keys, size, how it activates, revision and public text, from the rows alone. */
  catalogue: async (input: CatalogueInput) => (await import("../../lore/lore")).catalogueOf(input),
  /** One step of Build's Playtest or Check world, played by the pure engine on a thread (`worker/background-lane.ts`). */
  labStep: async (input: LabStepInput): Promise<LabStepOutput> => (await import("../../worker/background-lane")).labStep(input),
  /** The lint a lab job ends with. */
  labLint: async (world: WorldDoc) => (await import("../../worker/background-lane")).labLint(world),
  ...INDEX_TASKS,
} as const;

export type TaskName = keyof typeof TASKS;
export type TaskInput<N extends TaskName> = Parameters<(typeof TASKS)[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<(typeof TASKS)[N]>>;
