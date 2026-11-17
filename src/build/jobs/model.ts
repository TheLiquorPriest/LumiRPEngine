// Build's model jobs run as RPH jobs (plan §13.5, §14; PlanChatUI-B5; C-23): a job he starts from Build is kept in the job home and runs
// as a job of RPH's under a scope naming only him, no chat and no turn, so its agent reads no turn's state. Its agent runs as the kind's
// definition (`guidance/.agents/build-*.md`: the model, the tools) with its brief (`guidance/.prompts/build-jobs.md`, the kind's line),
// both his to edit at the global level; it is given its input by name (`build:job`, through the areas' `views` hook) and proposes
// through `world_propose`, beside the world family's reads, which are Build's tools for a job of no chat (the `jobTools` hook). Each call
// of `world_propose` is checked by the kind and kept with the job at once, and the job ends with what its agent proposed when RPH's job
// ends, done or at one of its limits. A cancel in Build cancels RPH's job. Nothing here writes to a world: he reviews and applies.

import type { AgentRef, FilesPort, HostTool, JobRefusal, JobsApi, JobState, JobView, Log, ToolCtx, ToolResult, UserSessionScope } from "rp-harness/contract";
import type { ViewHook } from "../../app";
import { type LinesPart, loadGuidance, type PromptPart } from "../../app/guidance";
import { WORLD_TOOLS } from "../../iface/families/world";
import { type Call, described, type EngineDeps, faultAnswer, IFACE_DEFAULTS, Reply } from "../../iface/kit";
import { Lines, toolText } from "../../iface/texts";
import type { UserId } from "../../shared/ids";
import type { JobResult } from "../../shared/jobs";
import type { JsonObject, JsonValue } from "../../shared/json";
import { readPart } from "../../store/words";
import type { WorldService } from "../../worlds/service";
import type { BuildBooks } from "../lore/books";
import type { JobRun, JobRunner } from "./home";
import { type KindRun, MODEL_KINDS, type ModelKind } from "./kinds";
import type { JobLimits } from "./limits";

/** The name a model job's agent is given its input by. */
export const BUILD_GIVEN = "build:job";
/** The prompt part of Build's jobs: each kind's brief, `world_propose`'s answers and the words of RPH's refusals (`format: lines`). */
export const BUILD_JOBS_PART = "build-jobs";
/** Build's own tool for a job of no chat. */
export const WORLD_PROPOSE = "world_propose";

/** The world family's reads a model job's agent may hold: the four that read a world named by id and no chat. */
const READS = ["world_read", "world_shape", "world_status", "world_history"];
const ENDED: readonly JobState[] = ["done", "failed", "cancelled", "off-path", "interrupted"];

export interface ModelJobsDeps {
  rph: { jobs: JobsApi; files: FilesPort };
  worlds: WorldService;
  books: BuildBooks;
  log: Log;
  /** The jobs' limits as they stand. */
  limits(): Promise<JobLimits>;
  /** How long between looks at a running RPH job, in ms. */
  pollMs?: number;
}

/** A model job that runs now, by its RPH job's id. */
interface Live {
  job: JobRun;
  run: KindRun;
  calls: number;
}

/** The guidance in force at his own levels (shipped, global), as a job of no chat reads it: a part, and a file's text. */
function userGuidance(files: FilesPort, user: UserId) {
  const guidance = loadGuidance(files, { user });
  return {
    part: (name: string): Promise<PromptPart | undefined> => guidance.part(name),
    async text(kind: "tools" | "prompts", name: string): Promise<string | undefined> {
      const part = kind === "tools" ? await guidance.tool(name) : await guidance.part(name);
      if (part === undefined) return undefined;
      const read = await files.read({ user }, part.source.path);
      return read.status === "read" ? read.text : undefined;
    },
  };
}

function linesOf(part: PromptPart | undefined): LinesPart | undefined {
  return part?.format === "lines" ? part : undefined;
}

/** RPH's refusal to start a job, in the words of the part's `job_refused_<why>` line, else its `job_refused`; the facts as data where neither is there. */
function refusedWords(lines: LinesPart | undefined, refusal: JobRefusal): string {
  const { refused, ...facts } = refusal;
  const fields: Record<string, string | number> = { refused, ...Object.fromEntries(Object.entries(facts).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")) };
  return lines?.line(`job_refused_${refused.replaceAll("-", "_")}`, fields) ?? lines?.line("job_refused", fields) ?? JSON.stringify(refusal);
}

function objectOf(args: JsonValue): JsonObject {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
}

export class ModelJobs {
  readonly #live = new Map<string, Live>();
  /** Starts in flight, by user: a call of the job's agent may come before RPH's start has answered. */
  readonly #starting = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly deps: ModelJobsDeps) {}

  /** The job home's runners of the five kinds. */
  runners(): Record<ModelKind, JobRunner> {
    const out = {} as Record<ModelKind, JobRunner>;
    for (const kind of Object.keys(MODEL_KINDS) as ModelKind[]) out[kind] = { bound: (input, limits) => MODEL_KINDS[kind].bound(input, limits), run: (job) => this.run(kind, job) };
    return out;
  }

  /** What a model job's agent is given by name: its input, as data. Null for any other name, or an agent of no Build job. */
  readonly views: ViewHook = async (scope, agent, ref) => {
    if (ref !== BUILD_GIVEN) return null;
    const live = await this.liveOf(scope.user, agent);
    return live === null ? null : JSON.stringify(live.run.given);
  };

  /** Build's tools for a job of no chat: the world family's reads and `world_propose`, each worded by its file in force at his levels. */
  readonly tools = async (scope: UserSessionScope): Promise<HostTool[]> => {
    const guidance = userGuidance(this.deps.rph.files, scope.user);
    const answers = await guidance.text("prompts", "engine-answers");
    const lines = answers === undefined ? Lines.none() : Lines.parse(answers, ".prompts/engine-answers.md");
    const out: HostTool[] = [];
    for (const spec of WORLD_TOOLS.filter((t) => READS.includes(t.name))) {
      const file = await guidance.text("tools", spec.name);
      if (file === undefined) continue;
      const text = toolText(file, `.tools/${spec.name}.md`);
      out.push({
        name: spec.name,
        family: spec.family,
        tier: spec.tier,
        description: text.description,
        parameters: described(spec.properties, spec.required, text),
        run: async (args: JsonValue, ctx: ToolCtx): Promise<ToolResult> => {
          const live = await this.liveOf(ctx.scope.user, ctx.agent);
          if (live === null) return new Reply(lines).line("no_chat_run", { tool: spec.name }).fail().result();
          // The world is the job's: the reads name it, so none of them looks for a chat's.
          const call: Call = {
            scope: { user: ctx.scope.user, chat: "", session: ctx.scope.session },
            agent: ctx.agent,
            callId: ctx.callId,
            signal: ctx.signal,
            tool: spec.name,
            lines,
            reply: () => new Reply(lines),
            deps: { worlds: this.deps.worlds } as unknown as EngineDeps,
            settings: { ...IFACE_DEFAULTS },
            tree: readPart("", ".prompts/world-state.md"),
          };
          try {
            return (await spec.run({ ...objectOf(args), world: live.job.world }, call)).result();
          } catch (error) {
            if (ctx.signal.aborted) throw error;
            return faultAnswer(lines, spec.name, error, undefined, "");
          }
        },
      });
    }
    const propose = await guidance.text("tools", WORLD_PROPOSE);
    if (propose !== undefined) {
      const text = toolText(propose, `.tools/${WORLD_PROPOSE}.md`);
      const object = { type: "object" };
      const list = { type: "array", items: object };
      out.push({
        name: WORLD_PROPOSE,
        family: "world",
        tier: "read",
        description: text.description,
        parameters: described({ proposals: list, entries: list, map: object, routines: list, schedules: list }, [], text),
        run: (args: JsonValue, ctx: ToolCtx) => this.propose(args, ctx.scope.user, ctx.agent),
      });
    }
    return out;
  };

  /** The live job an agent runs in, once RPH's start of it has answered; null for an agent of no Build job. */
  private async liveOf(user: string, agent: AgentRef): Promise<Live | null> {
    if (agent.job === undefined) return null;
    if (!this.#live.has(agent.job)) await Promise.all(this.#starting.get(user) ?? []);
    const live = this.#live.get(agent.job);
    return live !== undefined && live.job.user === user ? live : null;
  }

  /** One call of `world_propose`: checked by the job's kind, kept with the job at once, and answered as data with the line that says it. */
  private async propose(args: JsonValue, user: string, agent: AgentRef): Promise<ToolResult> {
    const live = await this.liveOf(user, agent);
    const lines = linesOf(await userGuidance(this.deps.rph.files, user).part(BUILD_JOBS_PART));
    if (live === null) return { content: [{ type: "text", text: lines?.line("propose_no_job") ?? JSON.stringify({ proposed: false }) }], error: true };
    const { answer, unusable } = await live.run.propose(objectOf(args), (line, fields) => lines?.line(line, fields));
    live.calls += 1;
    const proposals = live.run.proposals((line, fields) => lines?.line(line, fields));
    live.job.report(1 - 1 / (live.calls + 1), { proposals });
    const said = lines?.line(unusable ? "propose_unusable" : "propose_kept", { standing: proposals.length });
    return { content: [...(said === undefined ? [] : [{ type: "text" as const, text: said }]), { type: "text", text: JSON.stringify(answer) }], ...(unusable ? { error: true as const } : {}) };
  }

  private async run(kind: ModelKind, job: JobRun): Promise<{ result: JobResult; message?: string }> {
    const { rph, worlds, books, log } = this.deps;
    const limits = await this.deps.limits();
    const run = await MODEL_KINDS[kind].start({ user: job.user, world: job.world, input: job.input, limits, worlds, books });
    const lines = linesOf(await userGuidance(rph.files, job.user).part(BUILD_JOBS_PART));
    const draft = await worlds.worlds.working(job.world, job.user);
    const brief = lines?.line(`brief_${kind}`, { world: job.world, name: draft.name, ...run.fields }) ?? "";
    // Held as starting before RPH is asked: its agent may ask for its input or call a tool before the start has answered.
    const { promise: ready, resolve } = Promise.withResolvers<void>();
    const pending = this.#starting.get(job.user) ?? new Set<Promise<unknown>>();
    pending.add(ready);
    this.#starting.set(job.user, pending);
    let started: JobView | JobRefusal;
    try {
      started = await rph.jobs.start({ user: job.user }, { agent: MODEL_KINDS[kind].agent, brief, attach: [BUILD_GIVEN] });
      if (!("refused" in started)) this.#live.set(started.id, { job, run, calls: 0 });
    } finally {
      resolve();
      pending.delete(ready);
      if (pending.size === 0) this.#starting.delete(job.user);
    }
    if ("refused" in started) throw new Error(refusedWords(lines, started));
    const id = started.id;
    try {
      let now: JobView | undefined = started;
      while (now !== undefined && !ENDED.includes(now.state)) {
        await Bun.sleep(this.deps.pollMs ?? 1000);
        if (job.signal.aborted) {
          await rph.jobs.cancel(job.user, id).catch((error: unknown) => log.warn("A Build job's RPH job could not be cancelled.", { job: id, error: error instanceof Error ? error.message : String(error) }));
          return { result: { proposals: run.proposals((line, fields) => lines?.line(line, fields)) } };
        }
        now = await rph.jobs.get(job.user, id);
      }
      if (now === undefined) throw new Error(lines?.line("job_gone") ?? "RPH no longer has the job");
      const cut = now.limit !== undefined;
      const { result, notes } = run.end(cut, (line, fields) => lines?.line(line, fields));
      const proposed = "proposals" in result ? result.proposals.length : 0;
      // A job that ended otherwise than done, with nothing proposed, failed with RPH's last word of it.
      if (now.state !== "done" && !cut && proposed === 0) throw new Error(lines?.line(`job_${now.state.replace("-", "_")}`, { report: now.report ?? "" }) ?? now.report ?? now.state);
      const limit = now.limit === undefined ? undefined : lines?.line("job_limit", { limit: now.limit.limit, max: now.limit.max, value: now.limit.value });
      const message = [...(limit === undefined ? [] : [limit]), ...notes].join(" ");
      return { result, ...(message === "" ? {} : { message }) };
    } finally {
      this.#live.delete(id);
    }
  }
}
