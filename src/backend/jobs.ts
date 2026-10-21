// Background jobs (DESIGN §9.6, §9.7, §4.2, §13): Import from lore, Build/Refine with AI, Describe a
// map, Propose routines from lore and the lore indexing jobs ask the helper (D10) for proposed world
// edits, checked and deduplicated by `proposals.ts`, `map-job.ts`, `routine-proposals.ts` and
// `lore-index.ts` (the player reviews them and applies the ones they accept with `lre.editor`);
// Playtest and Check world run engine-only on the background lane, a child process
// (`backendProcesses`) that heartbeats while it works and never blocks a turn. Each user's jobs are
// kept in `userStorage/jobs.json` with their status, progress and result (a model job's proposals
// as each chunk is read), so Build still shows them after a reload or a restart; one that was
// running when the extension stopped shows as interrupted, with what it had proposed by then.

import type { EntityId, UserId, WorldId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { loreSourceOf } from "../shared/lore";
import type { ErrorCode, JobKind, JobProposal, JobResult, JobSummary, JobUpdate, LintIssue, WorldCollection } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { StepConfig } from "../shared/settings";
import type { Limit } from "../shared/minds";
import { firedTimeout, formatMs, HOST_LIMITS, hostBound, timeoutSignal, TIMEOUTS } from "../shared/timeouts";
import type { Registry } from "../engine/registry-impl";
import type { HostPort, ProcessEvent, ProcessHandle } from "./host";
import { checkIndexProposals, INDEX_TEXT_CHUNK, indexReplyProblem, indexRetry, indexSystem, readIndexProposals, textChunks, type IndexBook } from "./lore-index";
import { checkProposals, dropSummary, entryTitle, IMPORT_CHUNK, IMPORT_MAX_CALLS, loreChunk, PROPOSAL_MAX_TOKENS, proposalRetry, proposalSystem, readProposals, replyProblem, type DropCounts, type ProposalMode } from "./proposals";
import { MAP_PROSE_MAX, mapProposal, mapRepairText, mapRequestText, mapSystem, problemLines, readMapAnswer, readMapRequest } from "./map-job";
import { afterRepair, checkRoutineReply, finishRoutines, loreCutMessage, readRoutineInput, ROUTINE_MAX_CALLS, ROUTINE_OWNERS_MAX, routineCallText, routinePass, routineRepairText, routineScope, routineSystem, type RoutineCandidate } from "./routine-proposals";
import { own } from "../engine/pack-kit";
import type { SettingsStore } from "./settings-store";
import type { Steps } from "./steps";
import { readStoredJson } from "./stored-json";
import { WORLD_COLLECTIONS, type WorldStore } from "./worlds";

/** The background lane's entry, relative to the extension root (the host requires it to start with `dist/`; DESIGN §18.7). */
export const BACKGROUND_LANE = "dist/worker/background-lane.js";

/** Where each user's jobs are kept. */
export const JOBS_PATH = "jobs.json";

/** Jobs that have ended kept per user (the newest), with their results; running ones are always kept. */
export const JOBS_KEPT = 8;

const JOB_KINDS: Record<JobKind, true> = { import_lore: true, refine: true, describe_map: true, propose_routines: true, playtest: true, check_world: true, index_book: true, index_text: true };
const JOB_STATUSES: Record<JobSummary["status"], true> = { running: true, done: true, failed: true, cancelled: true, interrupted: true };
const SEVERITIES: Record<LintIssue["severity"], true> = { error: true, warning: true, info: true };

/** Bounds on a job's input, as it is kept and run: ids, books an import reads, Refine's request, playtest turns. */
const ID_MAX = 200;
const BOOKS_MAX = 64;
const INSTRUCTIONS_MAX = 4000;
const TURNS_MAX = 50;
const TURN_MAX = 2000;
/** Pasted text an index job keeps: what its calls read and a part more, so it can still say the rest wasn't read. */
const INDEX_TEXT_MAX = (IMPORT_MAX_CALLS + 1) * INDEX_TEXT_CHUNK;

function isJobKind(v: unknown): v is JobKind {
  return typeof v === "string" && hasOwn(JOB_KINDS, v);
}

function isJobStatus(v: unknown): v is JobSummary["status"] {
  return typeof v === "string" && hasOwn(JOB_STATUSES, v);
}

function isCollection(v: unknown): v is WorldCollection {
  return typeof v === "string" && hasOwn(WORLD_COLLECTIONS, v);
}

function isProposal(raw: unknown): raw is JobProposal {
  if (!isRecord(raw) || typeof raw.id !== "string" || !isCollection(raw.collection) || typeof raw.key !== "string" || !hasOwn(raw, "value")) return false;
  if (typeof raw.source !== "string" || typeof raw.confidence !== "number") return false;
  if (raw.note !== undefined && typeof raw.note !== "string") return false;
  if (raw.pack !== undefined && typeof raw.pack !== "string") return false;
  if (raw.owner !== undefined && typeof raw.owner !== "string") return false;
  if (raw.problems !== undefined && !(Array.isArray(raw.problems) && raw.problems.every((p) => typeof p === "string"))) return false;
  if (raw.sourceNames !== undefined && !(isRecord(raw.sourceNames) && Object.values(raw.sourceNames).every((n) => typeof n === "string"))) return false;
  return raw.index === undefined || (isRecord(raw.index) && Array.isArray(raw.index.terms) && raw.index.terms.every((t) => typeof t === "string") && Array.isArray(raw.index.topics) && raw.index.topics.every((t) => isRecord(t) && typeof t.id === "string" && typeof t.label === "string"));
}

/** A stored result as the review reads it: entries of the wrong shape are dropped (the file comes from storage, not from us). */
function storedResult(raw: unknown): JobResult | undefined {
  if (!isRecord(raw)) return undefined;
  if (Array.isArray(raw.proposals)) return { proposals: (JSON.parse(JSON.stringify(raw.proposals)) as unknown[]).filter(isProposal), ...(isRecord(raw.next) ? { next: JSON.parse(JSON.stringify(raw.next)) as JsonObject } : {}) };
  if (!Array.isArray(raw.turns) || !Array.isArray(raw.lint)) return undefined;
  const turns = raw.turns.flatMap((t) => (isRecord(t) && typeof t.user === "string" && typeof t.reply === "string" && Array.isArray(t.notes) ? [{ user: t.user, reply: t.reply, notes: t.notes.filter((n): n is string => typeof n === "string") }] : []));
  const lint = raw.lint.flatMap((l) => (isRecord(l) && typeof l.severity === "string" && hasOwn(SEVERITIES, l.severity) && typeof l.path === "string" && typeof l.code === "string" && typeof l.message === "string" ? [{ severity: l.severity as LintIssue["severity"], path: l.path, code: l.code, message: l.message }] : []));
  return { turns, lint };
}

function storedJob(raw: unknown): JobSummary | null {
  if (!isRecord(raw) || typeof raw.jobId !== "string" || !isJobKind(raw.kind) || typeof raw.worldId !== "string" || !isJobStatus(raw.status)) return null;
  if (typeof raw.progress !== "number" || typeof raw.at !== "number" || !isRecord(raw.input)) return null;
  const result = storedResult(raw.result);
  return { jobId: raw.jobId, kind: raw.kind, worldId: raw.worldId, status: raw.status, progress: Math.max(0, Math.min(1, raw.progress)), ...(typeof raw.message === "string" ? { message: raw.message } : {}), ...(result ? { result } : {}), input: JSON.parse(JSON.stringify(raw.input)) as JsonObject, at: raw.at };
}

/** A job cut off by a stop or restart: what it says in Build. */
function interruptedMessage(job: JobSummary): string {
  const proposals = job.result && "proposals" in job.result ? job.result.proposals.length : 0;
  return proposals > 0 ? `Interrupted by a restart. The ${proposals} proposal(s) it made before it stopped are below; run it again for the rest.` : "Interrupted by a restart. Run it again.";
}

/**
 * A job's input as it is kept in `jobs.json` and run: only what its kind reads, each value cut to
 * what the job can use, so a request can't make every update rewrite more than that. An id too long
 * to be one, more books than an import reads or more owners than a world could name is refused
 * rather than cut.
 */
function boundedInput(kind: JobKind, input: JsonObject): JsonObject {
  const id = (v: JsonValue | undefined): string => {
    if (typeof v !== "string") return "";
    if (v.length > ID_MAX) throw new JobError("bad_request", `an id is at most ${ID_MAX} characters`);
    return v;
  };
  const text = (v: JsonValue | undefined, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  switch (kind) {
    case "import_lore": {
      const bookIds = strings(input.bookIds).map(id);
      if (bookIds.length > BOOKS_MAX) throw new JobError("bad_request", `pick at most ${BOOKS_MAX} lore books`);
      return { bookIds };
    }
    case "refine":
      return { instructions: text(input.instructions, INSTRUCTIONS_MAX) };
    case "describe_map": {
      const mapId = id(input.mapId);
      return { scope: id(input.scope), prose: text(input.prose, MAP_PROSE_MAX), ...(mapId !== "" ? { mapId } : {}) };
    }
    case "propose_routines": {
      const owners = Array.isArray(input.owners) ? [...new Set(strings(input.owners).map(id))].filter((o) => o !== "") : null;
      if (owners && owners.length > ROUTINE_OWNERS_MAX) throw new JobError("bad_request", `name at most ${ROUTINE_OWNERS_MAX} people and groups`);
      const after = id(input.after);
      return { ...(owners ? { owners } : {}), ...(after !== "" ? { after } : {}) };
    }
    case "playtest":
      return { turns: strings(input.turns).slice(0, TURNS_MAX).map((t) => t.slice(0, TURN_MAX)) };
    case "check_world":
      return typeof input.days === "number" ? { days: input.days } : {};
    case "index_book":
      return { bookId: id(input.bookId) };
    case "index_text":
      return { text: text(input.text, INDEX_TEXT_MAX) };
  }
}

/** A job request the runner refuses (too many running; not the user's job). */
export class JobError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Job {
  id: string;
  kind: JobKind;
  userId: UserId;
  worldId: WorldId;
  input: JsonObject;
  session: string | undefined;
  controller: AbortController;
  lane: ProcessHandle | null;
}

/** How a model job reads a helper reply: why it can't be used (null when it can), how many proposals it holds, and the reminder its one retry adds. */
interface ReplyReader {
  problem(reply: JsonValue | null): string | null;
  count(reply: JsonValue | null): number;
  retry: string;
}

/** Lane messages: progress per turn, then the result. */
export interface LaneMessage {
  jobId: string;
  progress?: number;
  done?: boolean;
  error?: string;
  result?: JsonValue;
}

/**
 * Why a lane Lumiverse stopped for time failed its job: Lumiverse's own words, the setting whose wait
 * ran out (its words say start-up or heartbeat) and the most Lumiverse allows for it.
 */
function laneTimedOut(error: string | undefined): string {
  const key = error?.includes("heartbeat") ? "laneHeartbeatMs" : error?.includes("startup") ? "laneStartupMs" : null;
  const named = key ? TIMEOUTS[key].label : `${TIMEOUTS.laneStartupMs.label} or ${TIMEOUTS.laneHeartbeatMs.label}`;
  const cap = HOST_LIMITS[key === "laneHeartbeatMs" ? "processHeartbeat" : "processStartup"].maxMs;
  return `${error ?? "The background lane timed out"}: Lumiverse stopped it when ${named} ran out. Raise it in Settings → Timeouts; Lumiverse allows at most ${formatMs(cap)}.`;
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private seq = 0;
  /** In-process job work (model jobs, lane spawns); `idle()` waits for it. */
  private readonly running = new Set<Promise<void>>();
  /** Each user's kept jobs, oldest first, once read from storage. */
  private readonly kept = new Map<UserId, JobSummary[]>();
  /** Each user's reads and writes of their kept jobs, in order. */
  private readonly stores = new Map<UserId, Promise<void>>();

  constructor(
    private readonly host: HostPort,
    private readonly worlds: WorldStore,
    private readonly steps: Steps,
    private readonly settings: SettingsStore,
    private readonly registry: Registry,
    /** Each Import/Refine model call's own deadline from the user's limit (Settings → Timeouts); null for none. Tests pass a signal they abort. */
    private readonly callDeadline: (limit: Limit) => AbortSignal | null = (limit) => timeoutSignal("jobCallMs", limit),
  ) {
    // A lane that ends before reporting fails its job, instead of leaving it running.
    this.host.processes.onLifecycle((event) => this.onLifecycle(event));
  }

  /** Jobs a user may have running at once. */
  static readonly MAX_PER_USER = 2;

  async start(kind: JobKind, worldId: WorldId, input: JsonObject, userId: UserId, session?: string): Promise<string> {
    // The request is the frontend's: a kind the runner doesn't have would otherwise run as Refine.
    if (!isJobKind(kind)) throw new JobError("bad_request", "no such job");
    if (!isRecord(input)) throw new JobError("bad_request", "a job's input is an object");
    if ([...this.jobs.values()].filter((j) => j.userId === userId).length >= JobRunner.MAX_PER_USER) throw new JobError("unavailable", `at most ${JobRunner.MAX_PER_USER} jobs run at once; wait for one to finish or cancel it`);
    const bounded = boundedInput(kind, input);
    const id = `job${Date.now().toString(36)}${(++this.seq).toString(36)}`;
    const job: Job = { id, kind, userId, worldId, input: bounded, session, controller: new AbortController(), lane: null };
    this.jobs.set(id, job);
    // Kept before any of its updates: they queue behind it.
    const kept = this.withKept(userId, (list) => {
      list.push({ jobId: id, kind, worldId, status: "running", progress: 0, input: job.input, at: Date.now() });
      return { value: undefined, changed: true };
    });
    const work = this.run(job, worldId, bounded).catch((error: unknown) => this.update(job, { status: "failed", progress: 1, message: error instanceof Error ? error.message : String(error) }));
    this.running.add(work);
    void work.finally(() => this.running.delete(work));
    await kept;
    return id;
  }

  /** Resolves once no in-process job work or job write is pending (lane jobs continue in their child). */
  async idle(): Promise<void> {
    while (this.running.size > 0 || this.stores.size > 0) await Promise.all([...this.running, ...this.stores.values()]);
  }

  /** Cancels the user's own job; another user's job id is unknown to them. */
  async cancel(jobId: string, userId: UserId): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) throw new JobError("not_found", "no such job");
    job.controller.abort();
    await job.lane?.stop();
    this.update(job, { status: "cancelled", progress: 1 });
  }

  /** The user's kept jobs for a world, oldest first. */
  list(worldId: WorldId, userId: UserId): Promise<JobSummary[]> {
    return this.withKept(userId, (list) => ({ value: list.filter((j) => j.worldId === worldId).map((j) => JSON.parse(JSON.stringify(j)) as JobSummary), changed: false }));
  }

  /** Removes the user's own job that has ended, with its result. */
  async dismiss(jobId: string, userId: UserId): Promise<void> {
    const refused = await this.withKept(userId, (list): { value: JobError | null; changed: boolean } => {
      const at = list.findIndex((j) => j.jobId === jobId);
      if (at < 0) return { value: new JobError("not_found", "no such job"), changed: false };
      if (list[at]?.status === "running") return { value: new JobError("bad_request", "the job is still running; cancel it first"), changed: false };
      list.splice(at, 1);
      return { value: null, changed: true };
    });
    if (refused) throw refused;
  }

  /**
   * Runs `step` on the user's kept jobs after their earlier reads and writes, then writes them when
   * `step` changed them. The first read marks a job stored as running that this process isn't
   * running as interrupted (the extension stopped while it ran) and writes that too.
   */
  private withKept<T>(userId: UserId, step: (list: JobSummary[]) => { value: T; changed: boolean }): Promise<T> {
    const done = (this.stores.get(userId) ?? Promise.resolve()).then(async () => {
      let list = this.kept.get(userId);
      let cut = false;
      if (!list) {
        const raw = await readStoredJson(this.host, JOBS_PATH, userId, "jobs", (r) => isRecord(r) && r.v === 1 && Array.isArray(r.jobs));
        list = isRecord(raw) && Array.isArray(raw.jobs) ? raw.jobs.flatMap((j) => storedJob(j) ?? []) : [];
        for (const j of list) {
          if (j.status !== "running" || this.jobs.has(j.jobId)) continue;
          j.status = "interrupted";
          j.message = interruptedMessage(j);
          cut = true;
        }
        this.kept.set(userId, list);
        if (this.kept.size > 256) this.kept.delete(this.kept.keys().next().value ?? "");
      }
      const { value, changed } = step(list);
      if (changed || cut) {
        // Every running job stays; of the ended ones, the newest `JOBS_KEPT`.
        const ended = list.filter((j) => j.status !== "running");
        const dropped = new Set(ended.slice(0, Math.max(0, ended.length - JOBS_KEPT)));
        if (dropped.size > 0) list.splice(0, list.length, ...list.filter((j) => !dropped.has(j)));
        await this.host.storage.write(`${JOBS_PATH}.tmp`, JSON.stringify({ v: 1, jobs: list }), userId);
        await this.host.storage.move(`${JOBS_PATH}.tmp`, JOBS_PATH, userId);
      }
      return value;
    });
    const queued = done.then(
      () => undefined,
      (error: unknown) => this.host.log("warn", `[LumiRPEngine] the jobs file wasn't saved (${error instanceof Error ? error.message : String(error)})`, userId),
    );
    this.stores.set(userId, queued);
    void queued.finally(() => {
      if (this.stores.get(userId) === queued) this.stores.delete(userId);
    });
    return done;
  }

  private onLifecycle(event: ProcessEvent): void {
    const job = this.jobs.get(event.key);
    if (!job?.lane || job.lane.processId !== event.processId) return;
    if (event.state === "failed" || event.state === "timed_out" || event.state === "stopped" || event.state === "completed") {
      this.update(job, { status: "failed", progress: 1, message: event.state === "timed_out" ? laneTimedOut(event.error) : (event.error ?? `the background lane ${event.state === "completed" ? "ended without a result" : event.state.replace("_", " ")}`) });
    }
  }

  /** Messages from the background lane. */
  onLane(message: unknown): void {
    if (!isRecord(message) || typeof message.jobId !== "string") return;
    const job = this.jobs.get(message.jobId);
    if (!job) return;
    if (typeof message.error === "string") {
      this.update(job, { status: "failed", progress: 1, message: message.error });
      return;
    }
    if (message.done === true && isRecord(message.result)) {
      const turns = Array.isArray(message.result.turns) ? message.result.turns : [];
      const lint = Array.isArray(message.result.lint) ? message.result.lint : [];
      const result = JSON.parse(JSON.stringify({ turns, lint })) as JobResult;
      this.update(job, { status: "done", progress: 1, result });
      void job.lane?.stop();
      return;
    }
    if (typeof message.progress === "number") this.update(job, { status: "running", progress: message.progress });
  }

  /**
   * Sends a job's update and keeps it. `partial` is kept but not sent: an import's proposals so far,
   * reviewable if the job is interrupted. A job that ended otherwise than done keeps no result.
   */
  private update(job: Job, u: Omit<JobUpdate, "lre" | "type" | "jobId" | "kind">, partial?: JobResult): void {
    const msg: JobUpdate = { lre: PROTOCOL_VERSION, type: "lre.job.update", jobId: job.id, kind: job.kind, ...u };
    this.host.frontend.send(msg, job.userId, job.session);
    if (u.status !== "running") this.jobs.delete(job.id);
    void this.withKept(job.userId, (list) => {
      const kept = list.find((j) => j.jobId === job.id);
      // An update after the job ended (a lane message behind a cancel) changes nothing.
      if (!kept || kept.status !== "running") return { value: undefined, changed: false };
      const result = u.result ?? (u.status === "running" ? (partial ?? kept.result) : undefined);
      Object.assign(kept, { status: u.status, progress: u.progress, at: Date.now() });
      if (u.message === undefined) delete kept.message;
      else kept.message = u.message;
      if (result === undefined) delete kept.result;
      else kept.result = JSON.parse(JSON.stringify(result)) as JobResult;
      return { value: undefined, changed: true };
    }).catch(() => undefined);
  }

  /**
   * One model job's helper call (DESIGN §9.7), with room for a full answer (`PROPOSAL_MAX_TOKENS`).
   * A reply with nothing usable (the reader's `problem`: empty, not JSON of its shape after the
   * steps' fence stripping and repair call, nothing readable, or an empty list for lore) is asked
   * once more with a reminder of the shape when `retry` allows. The retry shares the call's signal,
   * so it ends at the same deadline, and a call that timed out or was cancelled is not asked again.
   * Each call's outcome and time go to the user's diagnostics. Returns the reply and the calls made.
   */
  private async proposalReply(name: string, reader: ReplyReader, label: string, system: string, user: string, config: StepConfig | null, userId: UserId, signal: AbortSignal, retry: boolean): Promise<{ reply: JsonValue | null; calls: number }> {
    const roomy: StepConfig = { ...(config ?? { enabled: true, signals: [] }), maxTokens: Math.max(config?.maxTokens ?? 0, PROPOSAL_MAX_TOKENS) };
    const ask = async (text: string, attempt: string): Promise<JsonValue | null> => {
      const t0 = performance.now();
      const reply = await this.steps.helperJson("brief", system, text, roomy, userId, signal);
      const fired = firedTimeout(signal);
      this.host.log(fired ? "warn" : "info", `[LumiRPEngine] ${name} ${label} ${attempt}: ${fired ? fired.message : (reader.problem(reply) ?? `${reader.count(reply)} proposal(s)`)} in ${Math.round(performance.now() - t0)} ms`, userId);
      return reply;
    };
    const reply = await ask(user, "call");
    if (reader.problem(reply) === null || !retry || signal.aborted) return { reply, calls: 1 };
    return { reply: await ask(`${user}\n\n${reader.retry}`, "retry"), calls: 2 };
  }

  /** The reader for Import and Refine replies. */
  private static proposalReader(mode: ProposalMode): ReplyReader {
    return { problem: (reply) => replyProblem(reply, mode), count: (reply) => readProposals(reply, "check").length, retry: proposalRetry(mode) };
  }

  /**
   * Propose routines from lore (DESIGN §13): a pass over the draft's people and groups, a few to a
   * call, each call's answer checked against the draft and, when the helper can fix what's wrong,
   * asked once more listing it. A call starts only while its repair still has one of the pass's
   * `ROUTINE_MAX_CALLS`, so a pass that runs out says where the next one starts (`next`). The
   * proposals so far are kept with the job after each call, so a restart loses none of them.
   */
  private async proposeRoutines(job: Job, worldId: WorldId, input: JsonObject, config: StepConfig | null, loreTokens: Limit, callSignal: () => AbortSignal): Promise<void> {
    // On the draft, where the author is working: what an earlier pass proposed and was applied counts as the world's.
    const draft = await this.worlds.working(worldId, job.userId);
    const scope = routineScope(this.registry, draft);
    const request = readRoutineInput(input);
    const pass = routinePass(scope, request, loreTokens);
    const unread = pass.unread.length > 0 ? `${pass.unread.length} named weren't read: they aren't people or groups the job may read (${pass.unread.slice(0, 6).join(", ")}${pass.unread.length > 6 ? "…" : ""}).` : null;
    if (pass.owners.length === 0) throw new Error(request.owners ? `none of the named people or groups is one the job may read; secret ones and the player character aren't proposed for${unread ? `. ${unread}` : ""}` : request.after ? `no one comes after ${request.after}: the last pass read everyone` : "the world has no people or groups the job may read; secret ones and the player character aren't proposed for");
    if (pass.batches.length === 0) throw new Error(loreCutMessage(scope, pass.cut, loreTokens) ?? "no one has a sheet field or a lore entry to go on: write about their days in the lore or their sheets first");
    const signal = job.controller.signal;
    const system = routineSystem(scope);
    const roomy: StepConfig = { ...(config ?? { enabled: true, signals: [] }), maxTokens: Math.max(config?.maxTokens ?? 0, PROPOSAL_MAX_TOKENS) };
    // Each call has its own deadline (Settings → Timeouts), and says why when it answers nothing usable.
    const ask = async (user: string, label: string): Promise<{ reply: JsonValue | null; failed: string | null }> => {
      const t0 = performance.now();
      const call = callSignal();
      const failure = { reason: "" };
      const reply = await this.steps.helperJson("brief", system, user, roomy, job.userId, call, { failure });
      const fired = firedTimeout(call);
      const failed = reply !== null ? null : (fired?.message ?? (failure.reason || "the answer was empty"));
      this.host.log(failed ? "warn" : "info", `[LumiRPEngine] routines ${label}: ${failed ?? "answered"} in ${Math.round(performance.now() - t0)} ms`, job.userId);
      return { reply, failed };
    };
    const candidates: RoutineCandidate[] = [];
    const failures: string[] = [];
    let calls = 0;
    let read = 0;
    let answered = 0;
    let last: EntityId | null = null;
    for (const [i, batch] of pass.batches.entries()) {
      if (signal.aborted) return;
      // A batch starts only while its repair still has a call.
      if (ROUTINE_MAX_CALLS - calls < 2) break;
      const label = `batch ${i + 1} of ${pass.batches.length}`;
      const text = routineCallText(scope, batch);
      const first = await ask(text, `${label} call`);
      calls++;
      if (signal.aborted) return;
      let check = checkRoutineReply(scope, batch, first.reply);
      // A call that failed or ran out of time isn't asked again; an answer with problems the helper can fix is, once, listing them.
      if (first.failed === null && (check.problem !== null || check.fixable.length > 0)) {
        this.update(job, { status: "running", progress: Math.min(0.99, read / pass.batches.length), message: "Fixing the proposals' problems…" }, { proposals: finishRoutines(scope, candidates) });
        const second = await ask(routineRepairText(text, first.reply, check), `${label} repair`);
        calls++;
        if (signal.aborted) return;
        const again = checkRoutineReply(scope, batch, second.reply);
        // The repair's answer stands, with what the first had right that the repair left out.
        if (again.problem === null) check = afterRepair(check, again);
        else if (second.failed !== null) failures.push(`a repair call: ${second.failed}`);
      }
      if (first.failed !== null) failures.push(first.failed);
      else if (check.problem !== null) failures.push(`the answer couldn't be read (${check.problem})`);
      else answered++;
      candidates.push(...check.candidates);
      read++;
      last = batch.owners.at(-1) ?? last;
      this.update(job, { status: "running", progress: Math.min(0.99, read / pass.batches.length) }, { proposals: finishRoutines(scope, candidates) });
    }
    if (answered === 0 && failures.length > 0) throw new Error(`no call answered: ${[...new Set(failures)].join("; ")}`);
    const drops: DropCounts = new Map();
    const proposals = finishRoutines(scope, candidates, drops);
    const dropped = [...drops.values()].reduce((a, b) => a + b, 0);
    const rest = read < pass.batches.length && last !== null ? pass.batches.slice(read).reduce((n, b) => n + b.owners.length, 0) : 0;
    const bare = pass.bare.length > 0 ? `${pass.bare.length} had nothing in their sheets or the lore to go on (${pass.bare.slice(0, 6).map((id) => own(draft.entities, id)?.name ?? id).join(", ")}${pass.bare.length > 6 ? "…" : ""}), so they get none.` : null;
    const flagged = proposals.filter((p) => (p.problems?.length ?? 0) > 0).length;
    const message = [
      rest > 0 ? `${rest} people and groups weren't read in this pass's ${ROUTINE_MAX_CALLS} calls; continue for the rest.` : null,
      unread,
      loreCutMessage(scope, pass.cut, loreTokens),
      bare,
      failures.length > 0 ? `${failures.length} call(s) answered nothing: ${[...new Set(failures)].join("; ")}.` : null,
      dropSummary(candidates.length, candidates.length - dropped, drops),
      flagged > 0 ? `${flagged} proposal(s) have problems to look at; they start unticked.` : null,
    ].filter((m): m is string => m !== null);
    const next: JsonObject | null = rest > 0 && last !== null ? { ...(request.owners ? { owners: request.owners } : {}), after: last } : null;
    this.update(job, { status: "done", progress: 1, result: { proposals, ...(next ? { next } : {}) }, ...(message.length > 0 ? { message: message.join(" ") } : {}) });
  }

  private async run(job: Job, worldId: WorldId, input: JsonObject): Promise<void> {
    const { world, revision } = await this.worlds.get(worldId, job.userId);
    this.update(job, { status: "running", progress: 0 });
    const settings = await this.settings.get(job.userId);
    const config = settings.modelUse.steps.brief ?? settings.modelUse.steps.interpret ?? null;
    const signal = job.controller.signal;
    // A call ends at its own deadline or when the job is cancelled, whichever comes first.
    const callSignal = (): AbortSignal => {
      const own = this.callDeadline(settings.timeouts.jobCallMs);
      return own ? AbortSignal.any([signal, own]) : signal;
    };
    // The background lane's start-up and heartbeat waits, within what Lumiverse allows.
    const lane = { startupMs: hostBound(HOST_LIMITS.processStartup, settings.timeouts.laneStartupMs), heartbeatMs: hostBound(HOST_LIMITS.processHeartbeat, settings.timeouts.laneHeartbeatMs) };
    if (job.kind === "playtest") {
      const turns = Array.isArray(input.turns) ? input.turns.filter((t): t is string => typeof t === "string") : [];
      if (turns.length === 0) throw new Error("a playtest needs at least one typed turn");
      job.lane = await this.host.processes.spawn({ entry: BACKGROUND_LANE, kind: "background", key: job.id, payload: { jobId: job.id, kind: "playtest", world: JSON.parse(JSON.stringify(world)) as JsonValue, revision, turns, runSeed: `playtest:${job.id}` }, userId: job.userId, ...lane });
      return;
    }
    if (job.kind === "check_world") {
      const days = typeof input.days === "number" ? Math.max(1, Math.min(14, Math.floor(input.days))) : 3;
      job.lane = await this.host.processes.spawn({ entry: BACKGROUND_LANE, kind: "background", key: job.id, payload: { jobId: job.id, kind: "check_world", world: JSON.parse(JSON.stringify(world)) as JsonValue, revision, days, runSeed: `check:${revision}` }, userId: job.userId, ...lane });
      return;
    }
    if (job.kind === "import_lore") {
      const bookIds = Array.isArray(input.bookIds) ? input.bookIds.filter((b): b is string => typeof b === "string") : [];
      if (bookIds.length === 0) throw new Error("pick at least one lore book");
      const index = await this.worlds.index(worldId, job.userId);
      const entries = [];
      for (const bookId of bookIds) {
        if (bookId === index?.loreBookId) continue;
        for (const e of await this.host.books.entries(bookId, job.userId)) if (e.content.trim() !== "" && !e.disabled) entries.push(e);
      }
      if (entries.length === 0) throw new Error("the chosen books have no entries with text");
      const system = proposalSystem("import", world, this.registry);
      const calls = Math.min(IMPORT_MAX_CALLS, Math.ceil(entries.length / IMPORT_CHUNK));
      // Retries spend only the calls no chunk needs, so a retry never costs a later chunk its read.
      let spare = IMPORT_MAX_CALLS - calls;
      // Back-links (DESIGN §9.7): a proposal cites its entry's id; a title works too.
      const links = new Map<string, string>();
      const titles = new Map<string, string>();
      for (const e of entries) {
        const link = `${e.bookId}/${e.id}`;
        const title = entryTitle(e);
        links.set(e.id, link);
        if (title !== "") titles.set(link, title);
        if (title !== "" && !links.has(title.toLowerCase())) links.set(title.toLowerCase(), link);
      }
      const linkOf = (source: string): string | null => links.get(source.trim()) ?? links.get(source.trim().toLowerCase()) ?? null;
      const review = (raw: readonly JobProposal[], drops: DropCounts): JobProposal[] =>
        checkProposals(world, this.registry, raw, "import", { linkOf }, drops).map((p) => {
          // Show value names each cited entry by its title; the review adds its book's name.
          const cited = isRecord(p.value) && Array.isArray(p.value.sources) ? p.value.sources.filter((link): link is string => typeof link === "string") : [];
          const named = cited.flatMap((link) => {
            const title = titles.get(link);
            return title ? [[link, title] as const] : [];
          });
          return named.length > 0 ? { ...p, sourceNames: Object.fromEntries(named) } : p;
        });
      const raw: JobProposal[] = [];
      for (let c = 0; c < calls; c++) {
        if (signal.aborted) return;
        const chunk = entries.slice(c * IMPORT_CHUNK, (c + 1) * IMPORT_CHUNK);
        const { reply, calls: made } = await this.proposalReply("import", JobRunner.proposalReader("import"), `chunk ${c + 1} of ${calls}`, system, loreChunk(chunk), config, job.userId, callSignal(), spare > 0);
        spare -= made - 1;
        // A proposal that cites no source stays unlinked rather than borrowing the chunk's first entry.
        raw.push(...readProposals(reply, `lore${c}`).map((p) => ({ ...p, source: p.source === `lore${c}` ? "lore" : p.source })));
        // The checked proposals so far are kept with the job, so a restart before the end loses none of them.
        this.update(job, { status: "running", progress: Math.min(0.99, (c + 1) / calls) }, { proposals: review(raw, new Map()) });
      }
      const skipped = entries.length - calls * IMPORT_CHUNK;
      const drops: DropCounts = new Map();
      const proposals = review(raw, drops);
      const message = [skipped > 0 ? `${skipped} entries past the first ${calls * IMPORT_CHUNK} were not read; import them in another pass.` : null, dropSummary(raw.length, proposals.length, drops)].filter((m): m is string => m !== null).join(" ");
      this.update(job, { status: "done", progress: 1, result: { proposals }, ...(message ? { message } : {}) });
      return;
    }
    if (job.kind === "describe_map") {
      // On the draft, where the author is working: the place may be new, and the map applies there.
      const draft = await this.worlds.working(worldId, job.userId);
      const request = readMapRequest(draft, input);
      const system = mapSystem();
      const text = mapRequestText(draft, request);
      const roomy: StepConfig = { ...(config ?? { enabled: true, signals: [] }), maxTokens: Math.max(config?.maxTokens ?? 0, PROPOSAL_MAX_TOKENS) };
      const ask = async (user: string, attempt: string) => {
        const t0 = performance.now();
        const call = callSignal();
        const answer = readMapAnswer(draft, request, await this.steps.helperJson("brief", system, user, roomy, job.userId, call));
        const errors = answer.problems.filter((p) => p.severity === "error").length;
        const fired = firedTimeout(call);
        this.host.log(fired ? "warn" : "info", `[LumiRPEngine] describe_map ${request.mapId} ${attempt}: ${fired ? fired.message : answer.map ? `${errors} error(s), ${answer.problems.length - errors} warning(s)` : "no map"} in ${Math.round(performance.now() - t0)} ms`, job.userId);
        return answer;
      };
      const first = await ask(text, "call");
      if (signal.aborted) return;
      const wrong = first.map === null || first.problems.some((p) => p.severity === "error");
      // One repair call, as the other helper calls get: the problems, and the map they're in.
      if (wrong) this.update(job, { status: "running", progress: 0.5, message: "Fixing the map's problems…" });
      const answer = wrong ? await ask(mapRepairText(text, first), "repair") : first;
      if (signal.aborted) return;
      if (answer.map === null) throw new Error(`the helper's answer isn't a map${wrong ? " after the repair either" : ""}:\n${problemLines(answer.problems.slice(0, 6))}`);
      const errors = answer.problems.some((p) => p.severity === "error");
      const message = wrong ? (errors ? "The repair call left problems; the map's note lists them, and it starts unticked." : "The first map had problems; a repair call fixed them.") : undefined;
      this.update(job, { status: "done", progress: 1, result: { proposals: [mapProposal(request, { ...answer, map: answer.map })] }, ...(message ? { message } : {}) });
      return;
    }
    if (job.kind === "propose_routines") {
      await this.proposeRoutines(job, worldId, input, config, settings.jobs.routineLoreTokens, callSignal);
      return;
    }
    if (job.kind === "index_book" || job.kind === "index_text") {
      // Indexing reads the draft, so entries already there (applied from an earlier run) aren't proposed again.
      const draft = await this.worlds.working(worldId, job.userId);
      const mode = job.kind === "index_book" ? "book" : "text";
      const notes: string[] = [];
      let book: IndexBook | null = null;
      let parts: string[];
      if (mode === "book") {
        const bookId = typeof input.bookId === "string" ? input.bookId : "";
        if (bookId === "") throw new Error("pick a World Info book");
        if (bookId === (await this.worlds.index(worldId, job.userId))?.loreBookId) throw new Error("that is the world's own engine book; pick one of your books");
        const indexed = new Set(
          Object.values(draft.lore).flatMap((l) => {
            const s = loreSourceOf(l.source);
            return s.kind === "book" && s.bookId === bookId ? [s.entryId] : [];
          }),
        );
        const withText = (await this.host.books.entries(bookId, job.userId)).filter((e) => e.content.trim() !== "" && !e.disabled);
        const fresh = withText.filter((e) => !indexed.has(e.id));
        if (fresh.length === 0) throw new Error(withText.length > 0 ? "every entry of that book with text is already in the world's lore" : "that book has no entries with text");
        if (fresh.length < withText.length) notes.push(`${withText.length - fresh.length} entr${withText.length - fresh.length === 1 ? "y" : "ies"} already in the world's lore ${withText.length - fresh.length === 1 ? "was" : "were"} skipped.`);
        if (fresh.length > IMPORT_MAX_CALLS * IMPORT_CHUNK) notes.push(`${fresh.length - IMPORT_MAX_CALLS * IMPORT_CHUNK} entries past the first ${IMPORT_MAX_CALLS * IMPORT_CHUNK} were not read; apply these, then index the book again for the rest.`);
        book = { bookId, entries: new Map(fresh.map((e) => [e.id, { title: entryTitle(e), content: e.content, keys: e.keys }])) };
        parts = Array.from({ length: Math.ceil(fresh.length / IMPORT_CHUNK) }, (_, c) => loreChunk(fresh.slice(c * IMPORT_CHUNK, (c + 1) * IMPORT_CHUNK)));
      } else {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (text === "") throw new Error("paste the text to index");
        parts = textChunks(text);
        if (parts.length > IMPORT_MAX_CALLS) notes.push(`Only the first ${IMPORT_MAX_CALLS} parts of the text (about ${IMPORT_MAX_CALLS * INDEX_TEXT_CHUNK} characters) were read; index the rest in another pass.`);
      }
      const calls = Math.min(IMPORT_MAX_CALLS, parts.length);
      // As for Import: retries spend only the calls no part needs.
      let spare = IMPORT_MAX_CALLS - calls;
      const reader: ReplyReader = { problem: indexReplyProblem, count: (reply) => readIndexProposals(reply, "check").length, retry: indexRetry(mode) };
      const system = indexSystem(mode, draft);
      const raw: JobProposal[] = [];
      for (let c = 0; c < calls; c++) {
        if (signal.aborted) return;
        const { reply, calls: made } = await this.proposalReply("index", reader, `part ${c + 1} of ${calls}`, system, parts[c] ?? "", config, job.userId, callSignal(), spare > 0);
        spare -= made - 1;
        raw.push(...readIndexProposals(reply, `${mode}${c}`));
        // The checked proposals so far are kept with the job, so a restart before the end loses none of them.
        this.update(job, { status: "running", progress: Math.min(0.99, (c + 1) / calls) }, { proposals: checkIndexProposals(draft, raw, book) });
      }
      const drops: DropCounts = new Map();
      const proposals = checkIndexProposals(draft, raw, book, drops);
      const message = [...notes, dropSummary(raw.length, proposals.length, drops)].filter((m): m is string => m !== null).join(" ");
      this.update(job, { status: "done", progress: 1, result: { proposals }, ...(message ? { message } : {}) });
      return;
    }
    // refine: Build/Refine with AI, one call and its retry.
    const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
    if (instructions === "") throw new Error("say what to build or change");
    const { reply } = await this.proposalReply("refine", JobRunner.proposalReader("refine"), "request", proposalSystem("refine", world, this.registry), instructions, config, job.userId, callSignal(), true);
    if (signal.aborted) return;
    const raw = readProposals(reply, "refine");
    const drops: DropCounts = new Map();
    const proposals = checkProposals(world, this.registry, raw, "refine", undefined, drops);
    const message = dropSummary(raw.length, proposals.length, drops);
    this.update(job, { status: "done", progress: 1, result: { proposals }, ...(message ? { message } : {}) });
  }
}
