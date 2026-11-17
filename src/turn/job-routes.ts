// The jobs as the Jobs page shows and steers them (plan §13.5, §14 l.1548, l.1560; App. A `JobsApi`), each
// route a call of RPH's jobs, live view or usage, declared in the route form so the page's types are
// written from it: the user's jobs a page at a time, of every chat or of one, in one state or all, the
// newest started first; one job with its run's trace, the calls it made and how full each of its
// agents' windows is; what a job he started was told (its gap checks, consents and rules fired); the
// switches over all his jobs with the limits in force for jobs and the day's use against each that
// counts one; and every control. He starts any job, as his own and tied to no turn (R-27): of a chat, or
// of no chat (C-23). He starts again a job that was interrupted, failed or cancelled, with the same
// task; carries on one stopped at one of its limits with more; resumes an interrupted one from its own
// session; holds one that waits and lets it go; pauses one that runs and lets it go; says a word to
// one that runs; answers one that asks; cancels one. Where RPH starts nothing or a control does
// nothing, its fact is answered in words for the page, with a status by what kind of fact it is. A
// job's change of state reaches every page that follows his jobs through `JOB_KIND` (`jobs.ts`).

import type { JobLimits, JobRefusal, JobState, JobView, RunScope, Scope, Usage, UserScope } from "rp-harness/contract";
import { agentRef, type Exactly, type Holds, type Infer, jobView, route, RouteError, shape, traceRecord, usage } from "../app";
import { type ConfigRead, portTexts, readConfig } from "../app/config-read";
import { harnessSettings } from "../app/setting-list";
import { toldRows } from "./events";
import type { Turns } from "./lane";
import { ownerJobRoutes } from "./owner-jobs";
import { jobToldReply } from "./shapes";
import { NO_SESSION } from "./turns";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why RPH started no job, or why a control of one did nothing, in RPE's words for the page: RPH gives the fact and its numbers. */
export function refusalWords(refusal: JobRefusal): string {
  switch (refusal.refused) {
    case "off":
      return "jobs are switched off on the Jobs page.";
    case "day-count":
      return `${refusal.value} jobs${refusal.connection !== undefined ? ` on connection ${refusal.connection}` : ""} were started in the last 24 hours, and the setting allows ${refusal.max}.`;
    case "day-tokens":
      return `jobs spent ${refusal.value} tokens in the last 24 hours, and the setting allows ${refusal.max}.`;
    case "limit":
      return `the job's ${refusal.limit} limit is ${refusal.value}, and a limit is a whole number above 0.`;
    case "agent":
      return `there is no agent definition ${refusal.agent} in force, or no model for it to run on.`;
    case "no-job":
      return `there is no job ${refusal.id}.`;
    case "state":
      return `job ${refusal.id} is ${refusal.state}; that is done only to a job that is ${refusal.applies.join(" or ")}.`;
    case "not-at-limit":
      return `job ${refusal.id} did not stop at one of its limits, so more of one would not let it go on.`;
    // The hook's reason is said in its own words.
    case "hook":
      return `his hook ${refusal.hook} kept it from starting: ${refusal.reason}`;
    case "connection":
      return `there is no connection ${refusal.connection} of his to check.`;
    case "part":
      return `the part ${refusal.part} is missing, switched off, or not as a tag check needs it.`;
  }
}

/** The status a refusal is answered with: a job or an agent that is not there, input that cannot be taken, or a state that does not allow it. */
export function refusalStatus(refusal: JobRefusal): number {
  switch (refusal.refused) {
    case "no-job":
    case "connection":
      return 404;
    case "limit":
    case "agent":
      return 400;
    default:
      return 409;
  }
}

/** A job's view as RPH answers it, or its refusal thrown as the route's answer, led by `lead`. */
function viewOrThrow(answer: JobView | JobRefusal, lead: string): JobView {
  if ("refused" in answer) throw new RouteError(refusalStatus(answer), `${lead}: ${refusalWords(answer)}`);
  return answer;
}

const jobState = shape.oneOf("queued", "held", "running", "asking", "done", "failed", "cancelled", "off-path", "interrupted");
type JobStateMirrored = Holds<Exactly<Infer<typeof jobState>, JobState>>;

const WHOLE = shape.whole({ least: 1 });
const jobLimitsAsk = shape.named(
  "JobLimitsAsk",
  "Limits a start or a carry-on gives one job, each a whole number above 0: model calls, tokens sent, tokens written, tokens together as the day's job tokens are counted, seconds, and the tokens at which it is held and he is asked whether to go on.",
  shape.object({ calls: opt(WHOLE), tokensIn: opt(WHOLE), tokensOut: opt(WHOLE), tokens: opt(WHOLE), time: opt(WHOLE), askAt: opt(WHOLE) }),
);
type JobLimitsMirrored = Holds<Exactly<Infer<typeof jobLimitsAsk>, JobLimits>>;

const jobStartAsk = shape.named(
  "JobStartAsk",
  "A job he starts: the agent definition it runs as, what it is to do, what it is given by name, and limits of its own.",
  shape.object({
    definition: shape.text({ blank: false }),
    brief: T,
    given: opt(shape.list(T), "What it is given by name, as an agent's attachments are named."),
    limits: opt(jobLimitsAsk, "Limits of its own: each holds in place of the setting's for this job."),
  }),
);

export const jobReply = shape.named("JobReply", "A job as it stands after the call.", shape.object({ job: jobView }));

const runUsage = shape.named("RunUsage", "What a run spent, in all and by agent.", shape.object({ run: T, total: usage, agents: shape.list(shape.object({ agent: agentRef, usage })) }));
const windowGauge = shape.named("WindowGauge", "How full an agent's context is: the tokens it holds, its model's window, and the room kept for its answer.", shape.object({ used: N, window: N, reserve: N }));

const jobShownReply = shape.named(
  "JobShownReply",
  "One job: its record, its run's trace as the live view shows a turn's, what its run spent by agent (null before it spent anything or after the record was let go), and how full each of its agents' windows is while it runs.",
  shape.object({ job: jobView, trace: shape.list(traceRecord), usage: shape.nullable(runUsage), windows: shape.list(shape.object({ agent: agentRef, gauge: windowGauge })) }),
);

const jobLimitShown = shape.named(
  "JobLimitShown",
  "A limit in force for jobs: its setting's key, its value (null: none), and the use it is held against over the last 24 hours, or now for the jobs at once; null where it counts no day's use.",
  shape.object({ key: T, value: shape.json(), used: shape.nullable(N) }),
);
const jobSwitchesReply = shape.named(
  "JobSwitchesReply",
  "His two switches over all his jobs (switched off: none starts; held: those running wait at their next call and none starts), and the limits in force for jobs with the day's use.",
  shape.object({ off: shape.yesNo(), held: shape.yesNo(), limits: shape.list(jobLimitShown) }),
);

/** Whether a job's scope is a chat's (the job of no chat has none, C-23). */
function ofChat(scope: RunScope): scope is Scope {
  return scope.chat !== undefined;
}

export interface JobRoutesDeps {
  turns: Turns;
  /** The levels every chat shares, read now: the limits in force for jobs of no chat. */
  shared(): ConfigRead;
}

export function jobRoutes(deps: JobRoutesDeps) {
  const { turns } = deps;
  const jobs = turns.harness.jobs;

  /** The user's job by id; a 404 for one he has none by. */
  const jobOf = async (user: string, id: string): Promise<JobView> => {
    const job = await jobs.get(user, id);
    if (job === undefined) throw new RouteError(404, `There is no job ${id}.`);
    return job;
  };

  /** He starts a job, as his own and tied to no turn (R-27): of the chat the scope names, or of none. */
  const start = async (scope: Scope | UserScope, ask: Infer<typeof jobStartAsk>): Promise<{ job: JobView }> => {
    const view = await jobs.start(scope, { agent: ask.definition, brief: ask.brief, ...(ask.given !== undefined ? { attach: ask.given } : {}), ...(ask.limits !== undefined ? { limits: ask.limits } : {}) });
    return { job: viewOrThrow(view, "No job was started") };
  };

  /** A control of RPH's jobs on one of his jobs: its answer, or its refusal as the route's. */
  const control = async (answer: Promise<JobView | JobRefusal>): Promise<{ job: JobView }> => ({ job: viewOrThrow(await answer, "Nothing was done") });

  /** A control of the live view on a job's run (its run is the job's own id): the job as it stands after, or why nothing was done. */
  const onRun = async (user: string, id: string, done: (run: string) => boolean, why: string): Promise<{ job: JobView }> => {
    const job = await jobOf(user, id);
    if (!done(job.id)) throw new RouteError(409, `Nothing was done: job ${job.id} ${why}`);
    return { job: await jobOf(user, id) };
  };

  /** The switches, with each limit in force for jobs (for the chat's levels, or the shared ones) and its use over the last 24 hours. */
  const switches = async (user: string, chat: string | undefined) => {
    // The settings that limit jobs, as RPH lists them: its `jobs.*` settings (none per connection) and the day's tokens of every agent.
    const listed = harnessSettings();
    const defs = listed.filter((s) => (s.key.startsWith("jobs.") && !s.key.includes("<")) || s.key === "limits.day.tokens");
    const weightDef = listed.find((d) => d.key === "limits.cachedWeight");
    const read = chat === undefined ? deps.shared() : readConfig(await portTexts(turns.files, { user, chat, session: NO_SESSION }), null, weightDef === undefined ? defs : [...defs, weightDef]);
    const [held, running, day, jobsDay] = await Promise.all([jobs.switches(user), jobs.list({ user, states: ["running", "asking"] }), turns.harness.usage.day(user), turns.harness.usage.day(user, "jobs")]);
    const since = turns.env.clock.now() - DAY_MS;
    const started = turns.store.db.query<{ n: number }, [string, number]>("SELECT COUNT(*) AS n FROM job WHERE user = ? AND value IS NOT NULL AND started >= ?").get(user, since)?.n ?? 0;
    // Tokens as RPH counts them against a day's cap: sent, a token read again from a cache at `limits.cachedWeight`, and written.
    const weight = weightDef === undefined ? 1 : read.value(weightDef);
    const cached = typeof weight === "number" ? weight : 1;
    const tokens = (u: Usage): number => Math.round(u.input - u.cacheRead + u.cacheRead * cached) + u.output;
    const used: Record<string, number> = {
      "jobs.atOnce": running.jobs.length,
      "jobs.perDay": started,
      "jobs.tokensPerDay": tokens(jobsDay),
      "limits.day.tokens": tokens(day),
    };
    return { off: held.off, held: held.held, limits: defs.map((def) => ({ key: def.key, value: read.value(def), used: used[def.key] ?? null })) };
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/jobs",
      access: "page",
      group: "jobs",
      does: "His jobs a page at a time, of every chat or of one, in one state or in any, the newest started first, each as RPH keeps it: where it stands, its agent, who started it and the turn that did.",
      query: {
        chat: opt(T, "Only the jobs of this chat."),
        state: opt(jobState, "Only the jobs in this state."),
      },
      reply: shape.page(jobView),
      paged: {},
      handle: async ({ user, query }) => {
        const page = await jobs.list({
          user,
          ...(query.chat !== undefined ? { chat: query.chat } : {}),
          ...(query.state !== undefined ? { states: [query.state] } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.after !== undefined ? { cursor: query.after } : {}),
        });
        return { items: page.jobs, next: page.next ?? null };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs",
      access: "page",
      group: "jobs",
      does: "He starts a job of no chat, as his own and tied to no turn, with any agent definition, its brief, what it is given and limits of its own.",
      body: jobStartAsk,
      reply: jobReply,
      handle: ({ user, body }) => start({ user }, body),
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/jobs",
      access: "page",
      group: "jobs",
      does: "He starts a job of the chat, as his own and tied to no turn, with any agent definition, its brief, what it is given and limits of its own.",
      body: jobStartAsk,
      reply: jobReply,
      handle: ({ user, params, body }) => start({ user, chat: params.chat, session: NO_SESSION }, body),
    }),
    route({
      method: "GET",
      path: "/api/v1/jobs/switches",
      access: "page",
      group: "jobs",
      does: "His switches over all his jobs, and the limits in force for jobs (for the chat's levels, or the shared ones) with the use each is held against over the last 24 hours.",
      query: { chat: opt(T, "The chat whose levels the limits are read for; the shared levels when left out.") },
      reply: jobSwitchesReply,
      handle: ({ user, query }) => switches(user, query.chat),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/switches",
      access: "page",
      group: "jobs",
      does: "Switches all his jobs off or on, holds them or lets them go, and answers the switches with the limits in force.",
      body: shape.object({ off: opt(shape.yesNo()), held: opt(shape.yesNo()) }),
      reply: jobSwitchesReply,
      handle: async ({ user, body }) => {
        await jobs.setSwitches(user, { ...(body.off !== undefined ? { off: body.off } : {}), ...(body.held !== undefined ? { held: body.held } : {}) });
        return switches(user, undefined);
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/jobs/:job",
      access: "page",
      group: "jobs",
      does: "One job: its record, its run's trace, what its run spent by agent, and how full each of its agents' windows is while it runs.",
      reply: jobShownReply,
      long: true,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        const { scope } = job;
        // A job's run is traced under its own id: in its turn's folder for a job a turn started, in its own session's for his own (a job of no chat's at the user's level).
        const trace = (await turns.trace.records(scope)).filter((r) => r.run === job.id);
        const spent = (await turns.harness.usage.run(user, job.id)) ?? null;
        const windows =
          ofChat(scope) && spent !== null
            ? (
                await Promise.all(
                  spent.agents.map(async ({ agent }) => {
                    const gauge = await turns.harness.usage.window(scope, agent.id);
                    return gauge === undefined ? [] : [{ agent, gauge }];
                  }),
                )
              ).flat()
            : [];
        return { job, trace, usage: spent, windows };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/jobs/:job/told",
      access: "page",
      group: "jobs",
      does: "What a job he started (which belongs to no turn) was told as it went: its gap checks, consents and rules fired.",
      reply: jobToldReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        const { db } = turns.store;
        const of = { job: job.id };
        return {
          job: job.id,
          told: {
            gapChecks: toldRows(db, user, "gap-check", of).map((r) => ({ check: r.body, at: r.at })),
            consents: toldRows(db, user, "consent", of).map((r) => ({ grant: r.body, at: r.at })),
            rules: toldRows(db, user, "rule", of).map((r) => ({ firing: r.body, at: r.at })),
            attachments: [],
            dropped: [],
          },
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/cancel",
      access: "page",
      group: "jobs",
      does: "Cancels a job; one that has ended already is given as it ended.",
      reply: jobReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        return { job: (await jobs.cancel(user, job.id)) ?? job };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/restart",
      access: "page",
      group: "jobs",
      does: "Starts again a job that was interrupted by a restart, failed or was cancelled: a new job of his with the same agent, brief, attachments and limits, tied to no turn.",
      reply: jobReply,
      handle: ({ user, params }) => control(jobs.again(user, params.job)),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/continue",
      access: "page",
      group: "jobs",
      does: "Carries on a job that stopped at one of its own limits, from its own session where it stood, with more of each limit named.",
      body: shape.object({ limits: opt(jobLimitsAsk, "How much more of each limit; none named gives none more.") }),
      reply: jobReply,
      handle: ({ user, params, body }) => control(jobs.carryOn(user, params.job, body.limits ?? {})),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/resume",
      access: "page",
      group: "jobs",
      does: "Resumes an interrupted job from the last call its own session holds, with what it had done and spent.",
      reply: jobReply,
      handle: ({ user, params }) => control(jobs.resume(user, params.job)),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/hold",
      access: "page",
      group: "jobs",
      does: "Holds a job that waits for a place: it keeps its place and does not start until let go.",
      reply: jobReply,
      handle: ({ user, params }) => control(jobs.hold(user, params.job)),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/release",
      access: "page",
      group: "jobs",
      does: "Lets go a job he held while it waited, or one he paused while it ran.",
      reply: jobReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        if (job.state === "held") return control(jobs.letGo(user, job.id));
        return onRun(user, job.id, (run) => turns.harness.live.letGo(user, run), "is neither held nor paused.");
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/pause",
      access: "page",
      group: "jobs",
      does: "Pauses a running job: every agent of its run waits at its next call until he lets it go.",
      reply: jobReply,
      handle: ({ user, params }) => onRun(user, params.job, (run) => turns.harness.live.pause(user, run), "is not running, or is paused already."),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/word",
      access: "page",
      group: "jobs",
      does: "Says a word to a running job's lead, which hears it at its next call as his.",
      body: shape.object({ text: shape.text({ blank: false }) }),
      reply: jobReply,
      handle: ({ user, params, body }) => onRun(user, params.job, (run) => turns.harness.live.say(user, run, body.text), "is not running."),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/answer",
      access: "page",
      group: "jobs",
      does: "Answers a job that asks whether to go on: it goes on in its own session, to the point it asks at next (none: it asks no more), or ends with what it has.",
      body: shape.union(shape.object({ go: shape.literal("on"), askAt: opt(WHOLE) }), shape.object({ go: shape.literal("end") })),
      reply: jobReply,
      handle: ({ user, params, body }) => control(jobs.answer(user, params.job, body)),
    }),
    ...ownerJobRoutes(turns),
  ] as const;
}
