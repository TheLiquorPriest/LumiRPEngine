// Heavy work off the main thread (plan §4.1): worker threads, so a long prompt's parse or a search over a
// long chat never stalls another chat's turn, the extension's question or a page.
//
// Every thread runs from the app's own file, the file this module was loaded from: in the built app that
// is the one bundle a server runs (an update or a swap that moves the file moves its threads with it,
// R-13); run from source, it is this module. Loaded on a thread RPE started, the file serves tasks and
// nothing else (`serveTasks`, below; the process's entry starts no command line there).
//
// A task is a function of the one list (`tasks.ts`), named and typed there: it is handed its input, and
// its answer, or its failure, goes back to its caller. A failure is in the log too, and the pool goes on;
// a thread that died is let go and its task failed, and the next task starts another. A thread takes one
// task at a time; threads are started as tasks come, up to the pool's number, and stopped with the app.

import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, type Transferable, Worker, workerData } from "node:worker_threads";
import type { Log } from "rp-harness/contract";
import { TASKS, type TaskInput, type TaskName, type TaskOutput } from "./tasks";

/** What marks a thread as one of RPE's, in the data it is started with. */
const THREAD_MARK = "rpeWorker";
/** The file every thread runs: the app's own, or this module run from source. */
const THREAD_FILE = fileURLToPath(import.meta.url);

/** The number of threads where the setting names none: the machine's cores less one, at least one. */
export function defaultThreads(): number {
  return Math.max(1, availableParallelism() - 1);
}

/** A task's failure as its thread answered it: the error's name and words, rebuilt for its caller. */
export class TaskFailed extends Error {
  constructor(
    readonly task: string,
    name: string,
    message: string,
  ) {
    super(message);
    this.name = name;
  }
}

/** What a thread answers for one task. */
type Answer = { ok: true; output: unknown } | { ok: false; name: string; message: string };

interface Job {
  task: TaskName;
  input: unknown;
  transfer: readonly Transferable[];
  resolve: (output: unknown) => void;
  reject: (error: unknown) => void;
}

interface Thread {
  worker: Worker;
  job: Job | null;
}

export interface WorkersOptions {
  /** The most threads it runs at once. */
  threads: number;
  /** What these threads are, as the log names them. */
  name: string;
  log: Log;
}

/** A pool of worker threads that run the tasks of the one list. */
export class Workers {
  readonly #threads: number;
  readonly #name: string;
  readonly #log: Log;
  readonly #all = new Set<Thread>();
  readonly #idle: Thread[] = [];
  readonly #queue: Job[] = [];
  #closed = false;

  constructor(options: WorkersOptions) {
    if (!Number.isInteger(options.threads) || options.threads < 1) throw new Error(`A pool runs at least one thread, not ${options.threads}.`);
    this.#threads = options.threads;
    this.#name = options.name;
    this.#log = options.log;
  }

  /** Runs `task` on a thread with `input`, handing over `transfer` (the input's buffers it gives up); its answer, or its failure. */
  run<N extends TaskName>(task: N, input: TaskInput<N>, transfer: readonly Transferable[] = []): Promise<TaskOutput<N>> {
    if (this.#closed) return Promise.reject(new Error(`RPE is stopping, so ${this.#name} ran no ${task}.`));
    const done = Promise.withResolvers<TaskOutput<N>>();
    this.#queue.push({ task, input, transfer, resolve: done.resolve as (output: unknown) => void, reject: done.reject });
    this.#next();
    return done.promise;
  }

  /** Stops every thread; a task under way or waiting fails. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) job.reject(new Error(`RPE is stopping, so ${this.#name} ran no ${job.task}.`));
    const threads = [...this.#all];
    this.#all.clear();
    this.#idle.length = 0;
    for (const thread of threads) {
      thread.job?.reject(new Error(`RPE is stopping, so ${this.#name} did not finish ${thread.job.task}.`));
      thread.job = null;
    }
    await Promise.all(threads.map((thread) => thread.worker.terminate()));
  }

  #next(): void {
    while (this.#queue.length > 0) {
      const thread = this.#idle.pop() ?? (this.#all.size < this.#threads ? this.#start() : null);
      if (thread === null) return;
      const job = this.#queue.shift() as Job;
      thread.job = job;
      thread.worker.ref();
      try {
        thread.worker.postMessage({ task: job.task, input: job.input }, [...job.transfer]);
      } catch (error) {
        // An input that cannot be sent to a thread fails its task alone.
        thread.job = null;
        thread.worker.unref();
        this.#idle.push(thread);
        this.#failed(job, error);
      }
    }
  }

  #start(): Thread {
    const worker = new Worker(THREAD_FILE, { workerData: { [THREAD_MARK]: true } });
    const thread: Thread = { worker, job: null };
    this.#all.add(thread);
    worker.on("message", (answer: Answer) => {
      const job = thread.job;
      thread.job = null;
      worker.unref();
      if (this.#all.has(thread)) this.#idle.push(thread);
      if (job !== null) {
        if (answer.ok) job.resolve(answer.output);
        else this.#failed(job, new TaskFailed(job.task, answer.name, answer.message));
      }
      this.#next();
    });
    const lost = (why: string): void => {
      if (!this.#all.delete(thread)) return;
      const at = this.#idle.indexOf(thread);
      if (at >= 0) this.#idle.splice(at, 1);
      const job = thread.job;
      thread.job = null;
      if (job !== null) this.#failed(job, new Error(`${this.#name} lost the thread running ${job.task}: ${why}`));
      else this.#log.warn("a worker thread ended", { workers: this.#name, why });
      this.#next();
    };
    worker.on("error", (error: unknown) => lost(error instanceof Error ? error.message : String(error)));
    worker.on("exit", (code: number) => lost(`it ended with code ${code}`));
    return thread;
  }

  #failed(job: Job, error: unknown): void {
    this.#log.warn("a task failed on a worker thread", { workers: this.#name, task: job.task, error: error instanceof Error ? error.message : String(error) });
    job.reject(error);
  }
}

/** On a thread RPE started: each message is a task of the list, answered with its output or its failure. */
function serveTasks(): void {
  const port = parentPort;
  if (port === null) return;
  port.on("message", async (asked: { task: TaskName; input: unknown }) => {
    let answer: Answer;
    try {
      const run = TASKS[asked.task] as ((input: unknown) => unknown) | undefined;
      if (run === undefined) throw new Error(`There is no task ${String(asked.task)}.`);
      answer = { ok: true, output: await run(asked.input) };
    } catch (error) {
      answer = { ok: false, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(answer);
  });
}

/** Whether this thread is one RPE started for its tasks. */
export const ON_WORKER_THREAD = !isMainThread && typeof workerData === "object" && workerData !== null && THREAD_MARK in workerData && workerData[THREAD_MARK] === true;

if (ON_WORKER_THREAD) serveTasks();
