// The rig's scripted models (PlanScenarios-2 items 4 and 8): each agent of RPE's shipped set answers from a list of
// its own, whatever order its calls come in; a call can be held at a gate the scenario opens, so a swipe sent while
// the earlier attempt's run still goes, a reply not held back by a mapping job, a stop mid-reply and a kill mid-turn
// happen on cue; and a reply's delays (to its first thinking, to its first word, between words, to its end) run in
// real time, so a page's own clock can measure them. RPH's contract is not changed: the rig is RPH's own scripted
// model (`rp-harness/testing/rig`) behind the one `ModelSource` the harness is given, which tells the agents apart
// by their own definition, which every agent's request carries in its system messages.
//
// An agent is recognised by the opening words of its shipped definition's body (`guidance/.agents/<name>.md`), found
// in the request's system messages. A request that holds none of them, or more than one, is answered with an error in
// those words: no agent runs unscripted, and none runs on another's list.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { StreamFn } from "@earendil-works/pi-agent-core";
import { FakeClock, gate, type Answer, type Gate, type ModelSource, type Piece, type RecordedRequest, type Reply, scriptedModel, type ScriptedModel } from "rp-harness/testing/rig";

/** A clock whose waits are real: a scripted reply's `wait` pieces take the time they say. */
export class RealClock extends FakeClock {
  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    if (signal?.aborted === true) {
      reject(signal.reason);
      return promise;
    }
    const stop = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
    return promise;
  }
}

/** A scripted reply's delays, in ms: to its first thinking, to its first word, between words, and to its end after the last. */
export interface Delays {
  firstThinking?: number;
  firstWord?: number;
  between?: number;
  end?: number;
}

/** A reply's pieces with its delays set in them: waits before the first thinking and the first word (counted from the start), between each later piece, and after the last. */
export function paced(pieces: readonly Piece[], delays: Delays): Piece[] {
  const out: Piece[] = [];
  let thinking = false;
  let text = false;
  let any = false;
  for (const piece of pieces) {
    if ("wait" in piece || "hold" in piece) {
      out.push(piece);
      continue;
    }
    const kind = "thinking" in piece ? "thinking" : "text" in piece ? "text" : null;
    if (kind === null) {
      out.push(piece);
      continue;
    }
    if (kind === "thinking" && !thinking) {
      if ((delays.firstThinking ?? 0) > 0) out.push({ wait: delays.firstThinking ?? 0 });
      thinking = true;
    } else if (kind === "text" && !text) {
      // The first word comes that long after the start, less what the thinking already took.
      const owed = (delays.firstWord ?? 0) - (thinking ? (delays.firstThinking ?? 0) : 0);
      if (owed > 0) out.push({ wait: owed });
      text = true;
    } else if (any && (delays.between ?? 0) > 0) out.push({ wait: delays.between ?? 0 });
    any = true;
    out.push(piece);
  }
  if ((delays.end ?? 0) > 0) out.push({ wait: delays.end ?? 0 });
  return out;
}

/** An answer with delays set in it (a function answer is asked first). */
export function withDelays(answer: Answer, delays: Delays): Answer {
  return async (request: RecordedRequest): Promise<Reply> => {
    const reply = typeof answer === "function" ? await answer(request) : answer;
    return { ...reply, pieces: paced(reply.pieces, delays) };
  };
}

/** The agents of the shipped set by name, with the opening words of each one's definition body. */
export function definitionsOf(guidance: string): Map<string, string> {
  const folder = join(guidance, ".agents");
  const found = new Map<string, string>();
  for (const file of readdirSync(folder).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(folder, file), "utf8").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const end = lines[0] === "---" ? lines.findIndex((line, i) => i > 0 && line === "---") : -1;
    const body = lines.slice(end + 1).map((line) => line.trim()).filter((line) => line !== "");
    // The first lines of the body that make a sentence of their own are what no other agent's definition holds.
    const opening = body.find((line) => !line.startsWith("#"));
    if (opening === undefined) throw new Error(`the shipped definition ${file} has no body to tell its agent by`);
    found.set(file.replace(/\.md$/, ""), opening);
  }
  return found;
}

/** The agent a request is, from the system messages it carries; null for none or more than one. */
export function identify(messages: readonly { role: string; content: unknown }[], definitions: ReadonlyMap<string, string>): { agent: string } | { fault: string } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
  const held = [...definitions].filter(([, opening]) => system.includes(opening)).map(([name]) => name);
  const [one] = held;
  if (held.length === 1 && one !== undefined) return { agent: one };
  return { fault: held.length === 0 ? "no agent of the shipped set is recognised in this request: none of their definitions' opening words is in its system messages" : `this request holds the definitions of ${held.join(" and ")}: it is not one agent's` };
}

export interface RigModelsOptions {
  /** Each agent's own list of answers, by name. */
  scripts?: Readonly<Record<string, readonly Answer[]>>;
  /** The shipped definitions' opening words, by agent (`definitionsOf`). */
  definitions: ReadonlyMap<string, string>;
  /** The model's limits in tokens, as the rig's scripted models give them. */
  contextWindow?: number;
  maxTokens?: number;
}

/** Every agent's scripted model behind one `ModelSource`. */
export class RigModels {
  private readonly models = new Map<string, ScriptedModel>();
  private readonly clock = new RealClock();
  private readonly definitions: ReadonlyMap<string, string>;
  private readonly limits: { contextWindow: number; maxTokens: number };
  /** Every request in the order it came, with the agent it was. */
  readonly seen: { agent: string; request: RecordedRequest }[] = [];

  constructor(options: RigModelsOptions) {
    this.definitions = options.definitions;
    this.limits = { contextWindow: options.contextWindow ?? 64_000, maxTokens: options.maxTokens ?? 4_000 };
    for (const agent of options.definitions.keys()) this.models.set(agent, this.make(agent, options.scripts?.[agent] ?? []));
  }

  private make(agent: string, answers: readonly Answer[]): ScriptedModel {
    return scriptedModel(answers, { clock: this.clock, ...this.limits, id: `scripted-${agent}`, name: `Scripted ${agent}` });
  }

  /** Adds answers to an agent's own list. */
  add(agent: string, ...answers: Answer[]): void {
    const model = this.models.get(agent);
    if (model === undefined) throw new Error(`there is no agent named ${agent} in the shipped set: ${[...this.models.keys()].join(", ")}`);
    model.add(...answers);
  }

  /** A gate a reply can hold at (`{ hold: gate }`); the scenario opens it. */
  gate(): Gate {
    return gate();
  }

  /** How many answers an agent's list still has. */
  left(agent: string): number {
    return this.models.get(agent)?.left ?? 0;
  }

  /** The stream function: each request goes to the list of the agent it is. */
  private readonly streamFn: StreamFn = (asked, context, options) => {
    const who = identify(context.messages, this.definitions);
    const model = "agent" in who ? this.models.get(who.agent) : undefined;
    if (model === undefined) {
      const fault = "fault" in who ? who.fault : `agent ${who.agent} has no scripted model`;
      return scriptedModel([() => {
        throw new Error(fault);
      }]).streamFn(asked, context, options);
    }
    const before = model.requests.length;
    const stream = model.streamFn(asked, context, options);
    // The request is kept, as its model keeps it, once the stream function has run: its record is its model's.
    const request = model.requests[before];
    if (request !== undefined && "agent" in who) this.seen.push({ agent: who.agent, request });
    return stream;
  };

  /** The model layer's place: every agent runs on its own script, at the effort its definition names. */
  readonly source: ModelSource = {
    agentModel: async (choice) => {
      const any = this.models.values().next().value;
      if (any === undefined) throw new Error("the rig has no agents to script");
      const level = choice.effort === undefined || choice.effort === "inherit" || choice.effort === "auto" ? "off" : choice.effort;
      const base = any.agentModel(level);
      return { ...base, streamFn: this.streamFn };
    },
  };
}
