// The bootstrap's routes (plan §12, §14): a chat's page starts its bootstrap job and reads the six facts
// with the chat's bootstrap jobs; the Migration page starts the job for the chats it names, or for every
// chat the migration carried, one after another. Every route is a page's: it answers only for the user
// this RPE belongs to. A start that is refused is answered in words, with nothing started.

import { jobView, route, RouteError } from "../../app";
import type { BootstrapJobs } from "./jobs";
import { bootstrapBatchBody, bootstrapBatchReply, bootstrapChatReply, bootstrapStartBody, MIGRATED } from "./shapes";

export const BOOTSTRAP_CHAT_PATH = "/api/v1/chats/:chat/bootstrap";
export const BOOTSTRAP_PATH = "/api/v1/bootstrap";

export interface BootstrapRoutesDeps {
  jobs: BootstrapJobs;
  /** The chats the last migration carried for the user (imported, or imported again), by id. */
  carried(user: string): Promise<readonly string[]>;
}

export function bootstrapRoutes(deps: BootstrapRoutesDeps) {
  return [
    route({
      method: "POST",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      group: "jobs",
      does: "Starts a chat's bootstrap job (taking on a story with a past), with the player's choice of what to relive; a start that is refused is answered in words, with nothing started.",
      body: bootstrapStartBody,
      reply: jobView,
      handle: async ({ params, body, user }) => {
        const start = await deps.jobs.start(user, params.chat, body.relive ?? null);
        if ("refused" in start) throw new RouteError(start.refused.status, start.refused.why);
        return start.started;
      },
    }),
    route({
      method: "GET",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      group: "jobs",
      does: "A chat's bootstrap: the six facts of \"done enough\", and the chat's bootstrap jobs, oldest first, each with how it stands or ended.",
      reply: bootstrapChatReply,
      handle: ({ params, user }) => deps.jobs.chat(user, params.chat),
    }),
    route({
      method: "POST",
      path: BOOTSTRAP_PATH,
      access: "page",
      group: "jobs",
      does: "Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another; says which started and which were refused, and why.",
      body: bootstrapBatchBody,
      reply: bootstrapBatchReply,
      handle: async ({ body, user }) => deps.jobs.startAll(user, body.chats === MIGRATED ? await deps.carried(user) : body.chats, body.relive ?? null),
    }),
  ] as const;
}
