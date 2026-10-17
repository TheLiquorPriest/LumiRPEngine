// Background jobs (DESIGN §9.6, §9.7): Import from lore and Build/Refine with AI ask the
// helper (D10) for proposed world edits per pack, checked and deduplicated by `proposals.ts`
// (the player reviews them and applies the ones they accept with `lre.editor put`); Playtest and
// Check world run engine-only on the background lane, a child process (`backendProcesses`) that
// heartbeats while it works and never blocks a turn.

import type { UserId, WorldId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { ErrorCode, JobKind, JobProposal, JobResult, JobUpdate } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { StepConfig } from "../shared/settings";
import type { Registry } from "../engine/registry-impl";
import type { HostPort, ProcessEvent, ProcessHandle } from "./host";
import { checkProposals, dropSummary, entryTitle, IMPORT_CHUNK, IMPORT_MAX_CALLS, loreChunk, PROPOSAL_MAX_TOKENS, proposalRetry, proposalSystem, readProposals, replyProblem, type DropCounts, type ProposalMode } from "./proposals";
import type { SettingsStore } from "./settings-store";
import type { Steps } from "./steps";
import type { WorldStore } from "./worlds";

/** The background lane's entry, relative to the extension root (the host requires it to start with `dist/`; DESIGN §18.7). */
export const BACKGROUND_LANE = "dist/worker/background-lane.js";

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
  session: string | undefined;
  controller: AbortController;
  lane: ProcessHandle | null;
}

/** Lane messages: progress per turn, then the result. */
export interface LaneMessage {
  jobId: string;
  progress?: number;
  done?: boolean;
  error?: string;
  result?: JsonValue;
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private seq = 0;
  /** In-process job work (model jobs, lane spawns); `idle()` waits for it. */
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly host: HostPort,
    private readonly worlds: WorldStore,
    private readonly steps: Steps,
    private readonly settings: SettingsStore,
    private readonly registry: Registry,
    /** Each Import/Refine model call's own deadline; tests pass a signal they abort. */
    private readonly callDeadline: () => AbortSignal = () => AbortSignal.timeout(JobRunner.CALL_MS),
  ) {
    // A lane that ends before reporting fails its job, instead of leaving it running.
    this.host.processes.onLifecycle((event) => this.onLifecycle(event));
  }

  /** Jobs a user may have running at once. */
  static readonly MAX_PER_USER = 2;

  /** How long one Import/Refine model call may run before it counts as failed. */
  static readonly CALL_MS = 120_000;

  start(kind: JobKind, worldId: WorldId, input: JsonObject, userId: UserId, session?: string): Promise<string> {
    if ([...this.jobs.values()].filter((j) => j.userId === userId).length >= JobRunner.MAX_PER_USER) return Promise.reject(new JobError("unavailable", `at most ${JobRunner.MAX_PER_USER} jobs run at once; wait for one to finish or cancel it`));
    const id = `job${Date.now().toString(36)}${(++this.seq).toString(36)}`;
    const job: Job = { id, kind, userId, session, controller: new AbortController(), lane: null };
    this.jobs.set(id, job);
    const work = this.run(job, worldId, input).catch((error: unknown) => this.update(job, { status: "failed", progress: 1, message: error instanceof Error ? error.message : String(error) }));
    this.running.add(work);
    void work.finally(() => this.running.delete(work));
    return Promise.resolve(id);
  }

  /** Resolves once no in-process job work is pending (lane jobs continue in their child). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  /** Cancels the user's own job; another user's job id is unknown to them. */
  async cancel(jobId: string, userId: UserId): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) throw new JobError("not_found", "no such job");
    job.controller.abort();
    await job.lane?.stop();
    this.update(job, { status: "cancelled", progress: 1 });
  }

  private onLifecycle(event: ProcessEvent): void {
    const job = this.jobs.get(event.key);
    if (!job?.lane || job.lane.processId !== event.processId) return;
    if (event.state === "failed" || event.state === "timed_out" || event.state === "stopped" || event.state === "completed") {
      this.update(job, { status: "failed", progress: 1, message: event.error ?? `the background lane ${event.state === "completed" ? "ended without a result" : event.state.replace("_", " ")}` });
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

  private update(job: Job, u: Omit<JobUpdate, "lre" | "type" | "jobId" | "kind">): void {
    const msg: JobUpdate = { lre: PROTOCOL_VERSION, type: "lre.job.update", jobId: job.id, kind: job.kind, ...u };
    this.host.frontend.send(msg, job.userId, job.session);
    if (u.status !== "running") this.jobs.delete(job.id);
  }

  /**
   * One Import/Refine helper call (DESIGN §9.7), with room for a full answer (`PROPOSAL_MAX_TOKENS`).
   * A reply with nothing usable (`replyProblem`: empty, not proposal JSON after the steps' fence
   * stripping and repair call, no readable proposal, or an empty list for lore) is asked once more
   * with a reminder of the shape when `retry` allows. The retry shares the call's signal, so it ends
   * at the same deadline, and a call that timed out or was cancelled is not asked again. Each call's
   * outcome and time go to the user's diagnostics. Returns the reply and the calls made.
   */
  private async proposalReply(mode: ProposalMode, label: string, system: string, user: string, config: StepConfig | null, userId: UserId, signal: AbortSignal, retry: boolean): Promise<{ reply: JsonValue | null; calls: number }> {
    const roomy: StepConfig = { ...(config ?? { enabled: true, signals: [] }), maxTokens: Math.max(config?.maxTokens ?? 0, PROPOSAL_MAX_TOKENS) };
    const ask = async (text: string, attempt: string): Promise<JsonValue | null> => {
      const t0 = performance.now();
      const reply = await this.steps.helperJson("brief", system, text, roomy, userId, signal);
      const problem = replyProblem(reply, mode);
      this.host.log("info", `[LumiRPEngine] ${mode} ${label} ${attempt}: ${problem ?? `${readProposals(reply, "check").length} proposal(s)`} in ${Math.round(performance.now() - t0)} ms`, userId);
      return reply;
    };
    const reply = await ask(user, "call");
    if (replyProblem(reply, mode) === null || !retry || signal.aborted) return { reply, calls: 1 };
    return { reply: await ask(`${user}\n\n${proposalRetry(mode)}`, "retry"), calls: 2 };
  }

  private async run(job: Job, worldId: WorldId, input: JsonObject): Promise<void> {
    const { world, revision } = await this.worlds.get(worldId, job.userId);
    this.update(job, { status: "running", progress: 0 });
    const settings = await this.settings.get(job.userId);
    const config = settings.modelUse.steps.brief ?? settings.modelUse.steps.interpret ?? null;
    const signal = job.controller.signal;
    // A call ends at its own deadline or when the job is cancelled, whichever comes first.
    const callSignal = (): AbortSignal => AbortSignal.any([signal, this.callDeadline()]);
    if (job.kind === "playtest") {
      const turns = Array.isArray(input.turns) ? input.turns.filter((t): t is string => typeof t === "string").slice(0, 50) : [];
      if (turns.length === 0) throw new Error("a playtest needs at least one typed turn");
      job.lane = await this.host.processes.spawn({ entry: BACKGROUND_LANE, kind: "background", key: job.id, payload: { jobId: job.id, kind: "playtest", world: JSON.parse(JSON.stringify(world)) as JsonValue, revision, turns, runSeed: `playtest:${job.id}` }, userId: job.userId });
      return;
    }
    if (job.kind === "check_world") {
      const days = typeof input.days === "number" ? Math.max(1, Math.min(14, Math.floor(input.days))) : 3;
      job.lane = await this.host.processes.spawn({ entry: BACKGROUND_LANE, kind: "background", key: job.id, payload: { jobId: job.id, kind: "check_world", world: JSON.parse(JSON.stringify(world)) as JsonValue, revision, days, runSeed: `check:${revision}` }, userId: job.userId });
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
      const raw: JobProposal[] = [];
      for (let c = 0; c < calls; c++) {
        if (signal.aborted) return;
        const chunk = entries.slice(c * IMPORT_CHUNK, (c + 1) * IMPORT_CHUNK);
        const { reply, calls: made } = await this.proposalReply("import", `chunk ${c + 1} of ${calls}`, system, loreChunk(chunk), config, job.userId, callSignal(), spare > 0);
        spare -= made - 1;
        // A proposal that cites no source stays unlinked rather than borrowing the chunk's first entry.
        raw.push(...readProposals(reply, `lore${c}`).map((p) => ({ ...p, source: p.source === `lore${c}` ? "lore" : p.source })));
        this.update(job, { status: "running", progress: Math.min(0.99, (c + 1) / calls) });
      }
      const skipped = entries.length - calls * IMPORT_CHUNK;
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
      const drops: DropCounts = new Map();
      const proposals = checkProposals(world, this.registry, raw, "import", { linkOf }, drops).map((p) => {
        // Show value names each cited entry by its title; the review adds its book's name.
        const cited = isRecord(p.value) && Array.isArray(p.value.sources) ? p.value.sources.filter((link): link is string => typeof link === "string") : [];
        const named = cited.flatMap((link) => {
          const title = titles.get(link);
          return title ? [[link, title] as const] : [];
        });
        return named.length > 0 ? { ...p, sourceNames: Object.fromEntries(named) } : p;
      });
      const message = [skipped > 0 ? `${skipped} entries past the first ${calls * IMPORT_CHUNK} were not read; import them in another pass.` : null, dropSummary(raw.length, proposals.length, drops)].filter((m): m is string => m !== null).join(" ");
      this.update(job, { status: "done", progress: 1, result: { proposals }, ...(message ? { message } : {}) });
      return;
    }
    // refine: Build/Refine with AI, one call and its retry.
    const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
    if (instructions === "") throw new Error("say what to build or change");
    const { reply } = await this.proposalReply("refine", "request", proposalSystem("refine", world, this.registry), instructions.slice(0, 4000), config, job.userId, callSignal(), true);
    if (signal.aborted) return;
    const raw = readProposals(reply, "refine");
    const drops: DropCounts = new Map();
    const proposals = checkProposals(world, this.registry, raw, "refine", undefined, drops);
    const message = dropSummary(raw.length, proposals.length, drops);
    this.update(job, { status: "done", progress: 1, result: { proposals }, ...(message ? { message } : {}) });
  }
}
