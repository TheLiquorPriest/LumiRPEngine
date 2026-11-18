// Taking on a story with a past as a job the player starts (plan §12, §13.5). Its lead is the agent that
// leads the chat's turns (the Author, as shipped); its brief is the `bootstrap` skill's own text as the
// chat's file tree gives it, so the player's edit of the skill is the next job's brief. It is given by
// name what the player chose when starting it, with its token limit (`bootstrap:job`), and the counts of
// the six facts of "done enough" (`bootstrap:facts`); any agent of it can be given the facts again by
// that name. The relive words are the skill's own (its header's `relive:`): a start takes one of them or
// none, and code holds no list of them. The token limit (the setting, or his own for one job) is the
// point at which RPH holds the job and asks him whether to go on (`askAt`), not a limit that ends it; the
// job's run is held to the bootstrap's own caps (`bootstrap.run.*`) in place of other jobs'. Nothing
// starts the job but the player: no turn, no timer, no migration. Nothing he asks is refused for the skill
// being switched off (the job is then given nothing of it) or for a job of the chat being under way (RPH
// queues or runs the second as `jobs.atOnce` allows); a start is refused, in words for the page, only
// for a chat Lumiverse does not hold, a relive word the skill does not offer, no lead, or where RPH
// refuses it. Which of a chat's jobs are its bootstrap jobs, with what each was given, is kept in RPH's
// store beside RPH's own record of its jobs; their records are read a page at a time from RPE's one job
// table.

import type { AgentRef, JobRefusal, JobState, JobView, JsonValue, Scope, Usage } from "rp-harness/contract";
import { portTexts, readConfig } from "../../app/config-read";
import { loadGuidance } from "../../app/guidance";
import { harnessSettings } from "../../app/setting-list";
import { isRecord } from "../../shared/json";
import { refusalWords } from "../job-routes";
import { jobsAmong } from "../jobs";
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
/** The states a job is under way in: queued or held waiting for a place, running, or waiting for his word. */
const UNDER_WAY: Readonly<Partial<Record<JobState, true>>> = { queued: true, held: true, running: true, asking: true };
/** RPH's caps on a job's run that still hold for a bootstrap job beside its own: the tokens it sends and writes. */
const RPH_CAPS = ["jobs.run.tokensIn", "jobs.run.tokensOut"] as const;

/** What a bootstrap job is given beside its brief: the player's choice of what to relive (null: none was made), and the token limit at which it asks. */
export interface BootstrapAsk {
  relive: string | null;
  tokenLimit: number;
}

/** A bootstrap job of a chat: what it was given, and its view as RPH gives it, null when RPH no longer holds it. */
export interface BootstrapJob extends BootstrapAsk {
  id: string;
  view: JobView | null;
}

/** What the start shows before any press (plan §12, §14 l.1560, D.1): whether the skill is in force, the relive words its header offers (none while it is off), the token limit in force for the chat with the weight a cached token counts at, and each cap that ends a bootstrap job's run as in force for the chat (null: none). */
export interface BootstrapStartShown {
  skill: boolean;
  relive: string[];
  tokenLimit: number;
  cachedWeight: number;
  caps: { key: string; value: number | null }[];
}

/** A bootstrap job held at its ask point, waiting for his word: the point it reached and the tokens counted then, what it spent and the weight a cached token counts at, what its agent last wrote, the six facts as they stand now, and how many more tokens a go-on gives by default (its token limit again). */
export interface BootstrapQuestion {
  job: string;
  at: number;
  tokens: number;
  usage: Usage;
  cachedWeight: number;
  wrote: string | null;
  facts: DoneEnough;
  more: number;
}

/** A chat's bootstrap, as its page reads it: the six facts, the start as it stands, the chat's bootstrap jobs under way (newest first), and the question of each that waits for his word. Its jobs, all of them, are read a page at a time (`jobs`). */
export interface BootstrapChat {
  chat: string;
  facts: DoneEnough;
  start: BootstrapStartShown;
  underWay: BootstrapJob[];
  questions: BootstrapQuestion[];
}

/** Where a carried chat's bootstrap stands: no job yet, its newest job queued, held, running or waiting for his word, or ended (how, with its limit and report, is on its job). */
export type BootstrapState = "none" | "queued" | "held" | "running" | "asking" | "ended";

/** A chat the last migration carried, with how its bootstrap stands, its newest bootstrap job, that job's question when it waits for his word, and the start as it stands for the chat. */
export interface CarriedBootstrap {
  chat: string;
  state: BootstrapState;
  job: BootstrapJob | null;
  question: BootstrapQuestion | null;
  start: BootstrapStartShown;
}

/** What he asks of a start: how much to relive (null: as the skill decides), and his own token limit for this job (null: the setting's). */
export interface StartAsk {
  relive: string | null;
  tokenLimit: number | null;
}

/** What came of a start: the job's view as RPH gives it; or why none was started, in words for the page, with the status it is answered with. */
export type BootstrapStart = { started: JobView } | { refused: { status: number; why: string } };

/** What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why. */
export interface BootstrapBatch {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}

/** His word to a job that asks: go on, with how many more tokens before it asks again (null: its token limit again), or end with what it has. */
export type BootstrapWord = { go: "on"; more: number | null } | { go: "end" };

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

/** The part whose header lists the relive words the start offers (`relive:`), beside the skill they are the skill's words for. */
const RELIVE_PART = "bootstrap-relive";

export class BootstrapJobs {
  readonly #deps: BootstrapJobsDeps;
  /** Each chat's latest start, by user and chat, so that one chat's starts run one at a time. */
  readonly #starting = new Map<string, Promise<unknown>>();
  /** What a job being started was given, by user and chat, until its id is kept: its agents are given it while RPH makes them. */
  readonly #asking = new Map<string, BootstrapAsk>();

  constructor(deps: BootstrapJobsDeps) {
    this.#deps = deps;
  }

  /** The player starts the chat's bootstrap job; one start of a chat waits for the one before it. */
  start(user: string, chat: string, ask: StartAsk): Promise<BootstrapStart> {
    const place = `${user}\u0000${chat}`;
    const run = (this.#starting.get(place) ?? Promise.resolve()).then(() => this.#start(place, user, chat, ask));
    const settled = run.catch(() => undefined);
    this.#starting.set(place, settled);
    void settled.then(() => {
      if (this.#starting.get(place) === settled) this.#starting.delete(place);
    });
    return run;
  }

  /** The job started for each chat, one after another; RPH runs as many at once as the user's setting allows, and the rest wait for a place. */
  async startAll(user: string, chats: readonly string[], ask: StartAsk): Promise<BootstrapBatch> {
    const batch: BootstrapBatch = { started: [], refused: [] };
    for (const chat of new Set(chats)) {
      const start = await this.start(user, chat, ask);
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

  /** The start as it stands for a chat: the skill and its relive words, the token limit and the caps in force. */
  async startShown(user: string, chat: string): Promise<BootstrapStartShown> {
    const turns = this.#deps.turns();
    const scope: Scope = { user, chat, session: NO_SESSION };
    const guidance = loadGuidance(turns.files, scope);
    const [skill, part, settings, texts] = await Promise.all([guidance.skill(BOOTSTRAP_SKILL), guidance.part(RELIVE_PART), bootstrapSettings(turns.files, scope, turns.env.log), portTexts(turns.files, scope)]);
    // The relive words are the skill's, listed in the header of their own part: none while the skill is off.
    const words = skill === undefined ? undefined : part?.header.relive;
    const rph = harnessSettings();
    const read = readConfig(texts, null, rph);
    const number = (key: string): number | null => {
      const def = rph.find((d) => d.key === key);
      const value = def === undefined ? null : read.value(def);
      return typeof value === "number" ? value : null;
    };
    return {
      skill: skill !== undefined,
      relive: Array.isArray(words) ? words.filter((w): w is string => typeof w === "string" && w.trim() !== "") : [],
      tokenLimit: settings.tokenLimit,
      cachedWeight: number("limits.cachedWeight") ?? 0,
      caps: [
        { key: "bootstrap.run.calls", value: settings.runCalls },
        { key: "bootstrap.run.time", value: settings.runTime },
        ...RPH_CAPS.map((key) => ({ key, value: number(key) })),
      ],
    };
  }

  /** The chat's bootstrap: its six facts, the start as it stands, its jobs under way and the questions of those that wait for his word. */
  async chat(user: string, chat: string): Promise<BootstrapChat> {
    const turns = this.#deps.turns();
    const kept = keptOf(await turns.env.store.get({ user }, keyOf(chat)));
    const asks = new Map(kept.map((k) => [k.job, k]));
    const [facts, start, going] = await Promise.all([this.facts(user, chat), this.startShown(user, chat), turns.harness.jobs.list({ user, chat, states: Object.keys(UNDER_WAY) as JobState[] })]);
    const underWay = going.jobs.flatMap((view) => {
      const ask = asks.get(view.id);
      return ask === undefined ? [] : [{ id: view.id, relive: ask.relive, tokenLimit: ask.tokenLimit, view }];
    });
    const questions = underWay.flatMap((job) => (job.view.asks === undefined ? [] : [this.#question(job.view, job.tokenLimit, start.cachedWeight, facts)]));
    return { chat, facts, start, underWay, questions };
  }

  /** The chat's bootstrap jobs a page at a time, the newest started first, read from the one job record in one query. */
  async jobs(user: string, chat: string, limit: number, after?: string): Promise<{ items: BootstrapJob[]; next: string | null }> {
    const turns = this.#deps.turns();
    const kept = keptOf(await turns.env.store.get({ user }, keyOf(chat)));
    const asks = new Map(kept.map((k) => [k.job, k]));
    const page = jobsAmong(turns.store.db, user, [...asks.keys()], limit, after);
    return { items: page.jobs.map((view) => ({ id: view.id, relive: asks.get(view.id)?.relive ?? null, tokenLimit: asks.get(view.id)?.tokenLimit ?? 0, view })), next: page.next };
  }

  /** Where a carried chat's bootstrap stands: its newest bootstrap job, how it stands, its question when it waits for his word, and its start. */
  async carried(user: string, chat: string): Promise<CarriedBootstrap> {
    const [{ items }, start] = await Promise.all([this.jobs(user, chat, 1), this.startShown(user, chat)]);
    const job = items[0] ?? null;
    const view = job?.view ?? null;
    if (job === null || view === null) return { chat, state: "none", job: null, question: null, start };
    const state: BootstrapState = UNDER_WAY[view.state] === true ? (view.state as BootstrapState) : "ended";
    if (view.asks === undefined) return { chat, state, job, question: null, start };
    return { chat, state, job, question: this.#question(view, job.tokenLimit, start.cachedWeight, await this.facts(user, chat)), start };
  }

  /**
   * His word to a bootstrap job of the chat that waits for it: go on in its own session, to its next ask point (by default its token
   * limit again past where it asked), or end with what it has. A job that is not the chat's bootstrap job, or does not wait, is answered
   * so, in words for the page.
   */
  async answer(user: string, chat: string, job: string, word: BootstrapWord): Promise<BootstrapStart> {
    const turns = this.#deps.turns();
    const kept = keptOf(await turns.env.store.get({ user }, keyOf(chat))).find((k) => k.job === job);
    if (kept === undefined) return refused(404, `Chat ${chat} has no bootstrap job ${job}.`);
    const view = await turns.harness.jobs.get(user, job);
    if (view === undefined) return refused(404, `There is no job ${job}.`);
    if (view.state !== "asking" || view.asks === undefined) return refused(409, `Bootstrap job ${job} is not waiting for your word: it is ${view.state}.`);
    const answered: JobView | JobRefusal = await turns.harness.jobs.answer(user, job, word.go === "end" ? { go: "end" } : { go: "on", askAt: view.asks.tokens + (word.more ?? kept.tokenLimit) });
    return "refused" in answered ? refused(409, `Nothing was done: ${refusalWords(answered)}`) : { started: answered };
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

  #question(view: JobView, tokenLimit: number, cachedWeight: number, facts: DoneEnough): BootstrapQuestion {
    return { job: view.id, at: view.asks?.at ?? 0, tokens: view.asks?.tokens ?? 0, usage: view.usage, cachedWeight, wrote: view.report ?? null, facts, more: tokenLimit };
  }

  async #start(place: string, user: string, chat: string, ask: StartAsk): Promise<BootstrapStart> {
    const turns = this.#deps.turns();
    const jobs = turns.harness.jobs;
    const scope: Scope = { user, chat, session: NO_SESSION };
    try {
      await turns.env.chat.info(scope);
    } catch (error) {
      return refused(404, `No bootstrap job was started: ${error instanceof Error ? error.message : String(error)}`);
    }
    const [skill, shown, { lead }, settings] = await Promise.all([loadGuidance(turns.files, scope).skill(BOOTSTRAP_SKILL), this.startShown(user, chat), turnSettings(turns.files, scope, turns.env.log), bootstrapSettings(turns.files, scope, turns.env.log)]);
    // A word the skill does not offer is a name that does not exist (§6.1), answered with the words it takes; with the skill off it takes none.
    if (ask.relive !== null && !shown.relive.includes(ask.relive)) {
      return refused(400, shown.relive.length === 0 ? `No bootstrap job was started: the bootstrap skill offers no relive words here, so "${ask.relive}" is none of them; start it without one.` : `No bootstrap job was started: "${ask.relive}" is not a relive word of the bootstrap skill. It takes ${shown.relive.map((w) => `"${w}"`).join(", ")}, or none.`);
    }
    if (lead === null) return refused(409, await turnErrorWords(turns.files, scope, "no_lead"));
    const given: BootstrapAsk = { relive: ask.relive, tokenLimit: ask.tokenLimit ?? settings.tokenLimit };
    this.#asking.set(place, given);
    try {
      let view: JobView | JobRefusal;
      try {
        // With the skill switched off the job is given nothing of it: its brief is empty, and it has no stated end (D.2).
        view = await jobs.start(scope, {
          agent: lead,
          brief: skill?.body ?? "",
          attach: [BOOTSTRAP_JOB, BOOTSTRAP_FACTS],
          limits: { askAt: given.tokenLimit, ...(settings.runCalls === null ? {} : { calls: settings.runCalls }), ...(settings.runTime === null ? {} : { time: settings.runTime }) },
        });
      } catch (error) {
        return refused(409, error instanceof Error ? error.message : String(error));
      }
      if ("refused" in view) return refused(409, `No bootstrap job was started: ${refusalWords(view)}`);
      const job: KeptJob = { job: view.id, ...given };
      await turns.env.store.update(scope, keyOf(chat), (current) => ({ jobs: [...keptOf(current), job] }) as unknown as JsonValue);
      return { started: view };
    } finally {
      this.#asking.delete(place);
    }
  }
}
