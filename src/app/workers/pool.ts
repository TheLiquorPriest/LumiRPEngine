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
//
// What a thread must hold to run a task as the main thread would (the engine's lines of words, `SHARED` in `tasks.ts`) is shared with it:
// `share` tells every thread now running and each one started after, in order before its first task; a thread whose pool shared nothing
// begins its first task with the shipped files' own, so no thread says its words from nothing.

import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, type Transferable, Worker, workerData } from "node:worker_threads";
import type { Log } from "rp-harness/contract";
import { SHARED, SHARED_SHIPPED, type SharedName, type SharedValue, TASKS, type TaskInput, type TaskName, type TaskOutput } from "./tasks";

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

/** A task that ran past the time it was given: its thread was ended. */
export class TaskTimedOut extends Error {
  constructor(
    readonly task: string,
    readonly ms: number,
  ) {
    super(`${task} ran past ${ms} ms`);
    this.name = "TaskTimedOut";
  }
}

/** What a thread answers for one task. */
type Answer = { ok: true; output: unknown } | { ok: false; name: string; message: string };

interface Job {
  task: TaskName;
  input: unknown;
  transfer: readonly Transferable[];
  timeoutMs?: number;
  timer?: Timer;
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
  readonly #shared = new Map<SharedName, unknown>();
  #closed = false;

  constructor(options: WorkersOptions) {
    if (!Number.isInteger(options.threads) || options.threads < 1) throw new Error(`A pool runs at least one thread, not ${options.threads}.`);
    this.#threads = options.threads;
    this.#name = options.name;
    this.#log = options.log;
  }

  /**
   * Runs `task` on a thread with `input`, handing over `transfer` (the input's buffers it gives up); its answer, or its failure. With
   * `timeoutMs`, a task still running that long after it began is stopped by ending its thread, and fails as `TaskTimedOut`.
   */
  run<N extends TaskName>(task: N, input: TaskInput<N>, transfer: readonly Transferable[] = [], options: { timeoutMs?: number } = {}): Promise<TaskOutput<N>> {
    if (this.#closed) return Promise.reject(new Error(`RPE is stopping, so ${this.#name} ran no ${task}.`));
    const done = Promise.withResolvers<TaskOutput<N>>();
    this.#queue.push({ task, input, transfer, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }), resolve: done.resolve as (output: unknown) => void, reject: done.reject });
    this.#next();
    return done.promise;
  }

  /** Tells every thread, those running now and each started after, what it needs to run a task as the main thread would (`SHARED`): the last value given for `name` is the one a thread holds. */
  share<N extends SharedName>(name: N, value: SharedValue<N>): void {
    this.#shared.set(name, value);
    for (const thread of this.#all) thread.worker.postMessage({ share: name, value });
  }

  /** Stops every thread; a task under way or waiting fails. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) job.reject(new Error(`RPE is stopping, so ${this.#name} ran no ${job.task}.`));
    const threads = [...this.#all];
    this.#all.clear();
    this.#idle.length = 0;
    for (const thread of threads) {
      if (thread.job !== null) {
        clearTimeout(thread.job.timer);
        thread.job.reject(new Error(`RPE is stopping, so ${this.#name} did not finish ${thread.job.task}.`));
      }
      thread.job = null;
    }
    await Promise.all(threads.map((thread) => thread.worker.terminate()));
  }

  /** A task that ran past its time: its thread is ended (a pattern in a line may never return) and the next task starts another; the caller is told. */
  #timedOut(thread: Thread, job: Job): void {
    if (thread.job !== job) return;
    this.#all.delete(thread);
    thread.job = null;
    void thread.worker.terminate();
    job.reject(new TaskTimedOut(job.task, job.timeoutMs ?? 0));
    this.#next();
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
        if (job.timeoutMs !== undefined) job.timer = setTimeout(() => this.#timedOut(thread, job), job.timeoutMs);
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
    // What the pool shares comes first, so a thread holds it before its first task.
    for (const [name, value] of this.#shared) worker.postMessage({ share: name, value });
    worker.on("message", (answer: Answer) => {
      const job = thread.job;
      thread.job = null;
      worker.unref();
      if (this.#all.has(thread)) this.#idle.push(thread);
      if (job !== null) {
        clearTimeout(job.timer);
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
      if (job !== null) {
        clearTimeout(job.timer);
        this.#failed(job, new Error(`${this.#name} lost the thread running ${job.task}: ${why}`));
      } else this.#log.warn("a worker thread ended", { workers: this.#name, why });
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

/** What a thread is told or asked: a value to hold (`Workers.share`), or a task of the list. */
type Asked = { share: SharedName; value: unknown } | { task: TaskName; input: unknown };

/** On a thread RPE started: a message is a shared value to hold, or a task of the list, answered with its output or its failure. They are served one at a time, in the order they came. */
function serveTasks(): void {
  const port = parentPort;
  if (port === null) return;
  const held = new Set<SharedName>();
  /** What a shared value that could not be held did: the next task fails with it, and says what it is. */
  let broken: unknown = null;
  const hold = async (name: SharedName, value: unknown): Promise<void> => {
    try {
      await (SHARED[name] as (value: unknown) => unknown)(value);
      held.add(name);
      broken = null;
    } catch (error) {
      broken = error;
    }
  };
  const serve = async (asked: Asked): Promise<void> => {
    if ("share" in asked) return await hold(asked.share, asked.value);
    let answer: Answer;
    try {
      const run = TASKS[asked.task] as ((input: unknown) => unknown) | undefined;
      if (run === undefined) throw new Error(`There is no task ${String(asked.task)}.`);
      if (broken !== null) throw broken;
      // A pool that shared nothing leaves a thread the shipped files' values, the same loaders' as the main thread's.
      for (const name of Object.keys(SHARED) as SharedName[]) if (!held.has(name)) await hold(name, await SHARED_SHIPPED[name]());
      if (broken !== null) throw broken;
      answer = { ok: true, output: await run(asked.input) };
    } catch (error) {
      answer = { ok: false, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(answer);
  };
  let served: Promise<void> = Promise.resolve();
  port.on("message", (asked: Asked) => {
    served = served.then(() => serve(asked));
  });
}

/** Whether this thread is one RPE started for its tasks. */
export const ON_WORKER_THREAD = !isMainThread && typeof workerData === "object" && workerData !== null && THREAD_MARK in workerData && workerData[THREAD_MARK] === true;

if (ON_WORKER_THREAD) serveTasks();
