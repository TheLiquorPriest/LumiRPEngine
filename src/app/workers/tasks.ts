// The one list of tasks RPE's worker threads run (`pool.ts`), each a function from its input to its
// answer, typed here for its callers. A thread is handed a task's name and input and runs it from this
// list, so a lane's heavy work runs on a thread once its function is listed here. Inputs and answers
// cross between threads by structured clone: plain data, and buffers that may be handed over.

import { INDEX_TASKS } from "../index-file/thread";

const decoder = new TextDecoder();

export const TASKS = {
  /** A request's body as JSON; throws a SyntaxError for one that is not. */
  parseJson: (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes)),
  ...INDEX_TASKS,
} as const;

export type TaskName = keyof typeof TASKS;
export type TaskInput<N extends TaskName> = Parameters<(typeof TASKS)[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<(typeof TASKS)[N]>>;
