// What the bootstrap's tests share: the turn lane's bed (the stand-in Lumiverse, RPE as `compose()` puts it
// together, every agent on one scripted model), with the bootstrap beside it as the composition is to
// mount it: its jobs over the bed's turn lane, its routes called as the server calls a page's route, and
// the turn lane's attachments answering the bootstrap's names through it, the hook its report asks of the
// turn lane. Every name is invented.

import { RouteError } from "../../../src/app";
import { BootstrapJobs, bootstrapRoutes } from "../../../src/turn/bootstrap";
import type { RecordedRequest } from "rp-harness/testing/rig";
import { callRoute } from "../../app/call";
import { openTurnBed, type TurnBed, type TurnBedOptions, USER } from "../bed";

export interface BootBed {
  b: TurnBed;
  jobs: BootstrapJobs;
  /** A page's call of one of the bootstrap's routes, as the server makes it: its status, and its answer or `{ error }` with the refusal's words. */
  call<T>(method: "GET" | "POST", path: string, params: Record<string, string>, body?: unknown): Promise<{ status: number; body: T }>;
}

export async function openBootBed(options: TurnBedOptions & { carried?: readonly string[] }): Promise<BootBed> {
  const b = await openTurnBed(options);
  const jobs = new BootstrapJobs({ turns: () => b.turns });
  const routes = bootstrapRoutes({ jobs, carried: async () => options.carried ?? [], sizes: () => ({ default: 50, most: 500 }) });
  // The turn lane's hook: a name an agent is given that is none of RPH's own is the bootstrap's to give, as well as the lane's.
  const events = b.turns.env.events;
  const given = events.attachments.bind(events);
  events.attachments = async (scope, agent, refs, moment) => {
    const blocks = await given(scope, agent, refs, moment);
    if (scope.chat === undefined) return blocks;
    for (const { ref, own } of refs) {
      if (own) continue;
      const text = await jobs.view(scope, agent, ref);
      if (text !== null) blocks.push({ name: ref, text });
    }
    return blocks;
  };
  const call = async <T>(method: "GET" | "POST", path: string, params: Record<string, string>, body?: unknown): Promise<{ status: number; body: T }> => {
    const r = routes.find((x) => x.method === method && x.path === path);
    if (r === undefined) throw new Error(`the bootstrap has no route ${method} ${path}`);
    try {
      const reply = await callRoute(r, { params, body, user: USER });
      return { status: 200, body: reply as T };
    } catch (error) {
      if (error instanceof RouteError) return { status: error.status, body: { error: error.message } as T };
      throw error;
    }
  };
  return { b, jobs, call };
}

/** Every text a request holds, its messages' in order. */
export function textsOf(r: RecordedRequest | undefined): string {
  return (r?.messages ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))).join("\n");
}
