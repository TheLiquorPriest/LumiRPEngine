// Taking on a story with a past as a job the player starts (plan §12, §13.5). Its lead is the agent that
// leads the chat's turns (the Author, as shipped); its brief is the `bootstrap` skill's own text as the
// chat's file tree gives it, so the player's edit of the skill is the next job's brief. It is given by
// name what the player chose when starting it, with its token limit (`bootstrap:job`), and the counts of
// the six facts of "done enough" (`bootstrap:facts`); any agent of it can be given the facts again by
// that name. The relive word is passed through as the player chose it and changes nothing else: what it
// means is the skill's to say. The token limit is the player's setting, and RPH holds the job to it (and
// to the user's limits on jobs where they are tighter): the job ends at it with what it has, and its
// record says which limit stopped it. Nothing starts the job but the player: no turn, no timer, no
// migration. A start is refused, in words for the page, only while a bootstrap job of the chat is under
// way, for a chat Lumiverse does not hold, where the skill is switched off, or where RPH refuses it.
// Which of a chat's jobs are its bootstrap jobs, with what each was given, is kept in RPH's store beside
// RPH's own record of its jobs.

import { loadGuidance } from "../../app/guidance";
import type { AgentRef, JobRefusal, JobState, JobView, JsonValue, Scope } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { Turns } from "../lane";
import { turnSettings } from "../settings";
import { NO_SESSION, turnErrorWords } from "../turns";
import { type DoneEnough, doneEnough } from "./facts";
import { bootstrapSettings } from "./settings";

/** The skill whose text is the job's brief (plan §12). */
export const BOOTSTRAP_SKILL = "bootstrap";
/** What the player chose when starting the job, and its token limit, by the name its agents are given it. */
export const BOOTSTRAP_JOB = "bootstrap:job";
/** The six facts of "done enough", by the name its agents are given them. */
export const BOOTSTRAP_FACTS = "bootstrap:facts";

/** Where a chat's bootstrap jobs are kept in RPH's store, by the chat's id. */
const KEPT = "rpe/bootstrap/";
/** The states a job is under way in: one of the chat's bootstrap jobs in one of them keeps another from starting. */
const UNDER_WAY: Readonly<Partial<Record<JobState, true>>> = { queued: true, held: true, running: true, asking: true };

/** What a bootstrap job is given beside its brief: the player's choice of what to relive (null: none was made), and the token limit the setting gives. */
export interface BootstrapAsk {
  relive: string | null;
  tokenLimit: number;
}

/** A bootstrap job of a chat: what it was given, and its view as RPH gives it, null when RPH no longer holds it. */
export interface BootstrapJob extends BootstrapAsk {
  id: string;
  view: JobView | null;
}

/** A chat's bootstrap, as its page reads it: the six facts, and the chat's bootstrap jobs, oldest first, each with how it stands or ended. */
export interface BootstrapChat {
  chat: string;
  facts: DoneEnough;
  jobs: BootstrapJob[];
}

/** What came of a start: the job's view as RPH gives it; or why none was started, in words for the page, with the status it is answered with. */
export type BootstrapStart = { started: JobView } | { refused: { status: number; why: string } };

/** What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why. */
export interface BootstrapBatch {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}

export interface BootstrapJobsDeps {
  /** The turn lane and the harness, once mounted. */
  turns(): Turns;
}

interface KeptJob extends BootstrapAsk {
  job: string;
}

/** The chat's key in RPH's store: its id in letters, digits, "-" and "_", whatever the id holds. */
function keyOf(chat: string): string {
  return `${KEPT}${Buffer.from(chat, "utf8").toString("base64url")}`;
}

/** A chat's kept bootstrap jobs, read back: what is not one is passed over. */
function keptOf(value: JsonValue | undefined): KeptJob[] {
  const jobs = isRecord(value) && Array.isArray(value.jobs) ? value.jobs : [];
  return jobs.flatMap((j): KeptJob[] =>
    isRecord(j) && typeof j.job === "string" && typeof j.tokenLimit === "number" ? [{ job: j.job, relive: typeof j.relive === "string" ? j.relive : null, tokenLimit: j.tokenLimit }] : [],
  );
}

function refused(status: number, why: string): BootstrapStart {
  return { refused: { status, why } };
}

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
  }
}

export class BootstrapJobs {
  readonly #deps: BootstrapJobsDeps;
  /** Each chat's latest start, by user and chat, so that one chat's starts run one at a time. */
  readonly #starting = new Map<string, Promise<unknown>>();
  /** What a job being started was given, by user and chat, until its id is kept: its agents are given it while RPH makes them. */
  readonly #asking = new Map<string, BootstrapAsk>();

  constructor(deps: BootstrapJobsDeps) {
    this.#deps = deps;
  }

  /** The player starts the chat's bootstrap job, choosing what to relive or not; one start of a chat waits for the one before it. */
  start(user: string, chat: string, relive: string | null): Promise<BootstrapStart> {
    const place = `${user}\u0000${chat}`;
    const run = (this.#starting.get(place) ?? Promise.resolve()).then(() => this.#start(place, user, chat, relive));
    const settled = run.catch(() => undefined);
    this.#starting.set(place, settled);
    void settled.then(() => {
      if (this.#starting.get(place) === settled) this.#starting.delete(place);
    });
    return run;
  }

  /** The job started for each chat, one after another; RPH runs as many at once as the user's setting allows, and the rest wait for a place. */
  async startAll(user: string, chats: readonly string[], relive: string | null): Promise<BootstrapBatch> {
    const batch: BootstrapBatch = { started: [], refused: [] };
    for (const chat of new Set(chats)) {
      const start = await this.start(user, chat, relive);
      if ("started" in start) batch.started.push({ chat, job: start.started });
      else batch.refused.push({ chat, why: start.refused.why });
    }
    return batch;
  }

  /** The six facts for a chat, at its head. */
  facts(user: string, chat: string): Promise<DoneEnough> {
    const turns = this.#deps.turns();
    return doneEnough({ store: turns.store, loreIndex: turns.loreIndex, files: turns.files, chat: turns.env.chat, log: turns.env.log }, user, chat);
  }

  /** The chat's bootstrap: its six facts, and its bootstrap jobs with how each stands or ended. */
  async chat(user: string, chat: string): Promise<BootstrapChat> {
    const turns = this.#deps.turns();
    const kept = keptOf(await turns.env.store.get({ user }, keyOf(chat)));
    const [facts, views] = await Promise.all([this.facts(user, chat), Promise.all(kept.map((k) => turns.harness.jobs.get(user, k.job)))]);
    return { chat, facts, jobs: kept.map((k, i) => ({ id: k.job, relive: k.relive, tokenLimit: k.tokenLimit, view: views[i] ?? null })) };
  }

  /**
   * What an agent is given by one of the bootstrap's names, as data: the six facts for its chat, to any agent; what the player
   * chose and the token limit, to an agent of a bootstrap job of the chat. Null for a name that is not the bootstrap's, or for
   * `bootstrap:job` asked by an agent of no such job.
   */
  async view(scope: Scope, agent: AgentRef, ref: string): Promise<string | null> {
    if (ref === BOOTSTRAP_FACTS) return JSON.stringify(await this.facts(scope.user, scope.chat));
    if (ref !== BOOTSTRAP_JOB || agent.job === undefined) return null;
    const kept = keptOf(await this.#deps.turns().env.store.get(scope, keyOf(scope.chat))).find((k) => k.job === agent.job);
    const ask = kept ?? this.#asking.get(`${scope.user}\u0000${scope.chat}`);
    return ask === undefined ? null : JSON.stringify({ ...(ask.relive !== null ? { relive: ask.relive } : {}), tokenLimit: ask.tokenLimit });
  }

  async #start(place: string, user: string, chat: string, relive: string | null): Promise<BootstrapStart> {
    const turns = this.#deps.turns();
    const jobs = turns.harness.jobs;
    const scope: Scope = { user, chat, session: NO_SESSION };
    for (const kept of keptOf(await turns.env.store.get(scope, keyOf(chat)))) {
      const view = await jobs.get(user, kept.job);
      if (view !== undefined && UNDER_WAY[view.state] === true) return refused(409, `A bootstrap job of chat ${chat} is ${view.state} (job ${view.id}). Another can be started once it has ended.`);
    }
    try {
      await turns.env.chat.info(scope);
    } catch (error) {
      return refused(404, `No bootstrap job was started: ${error instanceof Error ? error.message : String(error)}`);
    }
    const skill = await loadGuidance(turns.files, scope).skill(BOOTSTRAP_SKILL);
    if (skill === undefined) return refused(409, `No bootstrap job was started: the skill ${BOOTSTRAP_SKILL} is switched off or missing in the files of chat ${chat}.`);
    const [{ lead }, { tokenLimit }] = await Promise.all([turnSettings(turns.files, scope, turns.env.log), bootstrapSettings(turns.files, scope, turns.env.log)]);
    if (lead === null) return refused(409, await turnErrorWords(turns.files, scope, "no_lead"));
    const ask: BootstrapAsk = { relive, tokenLimit };
    this.#asking.set(place, ask);
    try {
      let view: JobView | JobRefusal;
      try {
        view = await jobs.start(scope, { agent: lead, brief: skill.body, attach: [BOOTSTRAP_JOB, BOOTSTRAP_FACTS], limits: { tokens: tokenLimit } });
      } catch (error) {
        return refused(409, error instanceof Error ? error.message : String(error));
      }
      if ("refused" in view) return refused(409, `No bootstrap job was started: ${refusalWords(view)}`);
      const job: KeptJob = { job: view.id, ...ask };
      await turns.env.store.update(scope, keyOf(chat), (current) => ({ jobs: [...keptOf(current), job] }) as unknown as JsonValue);
      return { started: view };
    } finally {
      this.#asking.delete(place);
    }
  }
}
