// The bootstrap's routes (plan §12, §14): a chat's Story page reads the six facts, the start as it stands
// (the skill, its relive words, the token limit and the caps in force) and the jobs under way with the
// question of each that waits for his word, starts a job with his own limit if he sets one, answers a job
// that asks, and walks its bootstrap jobs a page at a time; the Migration page lists the chats the last
// migration carried a page at a time, each with how its bootstrap stands, and starts the job for the chats
// it names or every carried chat, one after another. Every route is a page's: it answers only for the
// user this RPE belongs to. A start that is refused is answered in words, with nothing started.

import { jobView, type PageSizes, route, RouteError, shape } from "../../app";
import type { BootstrapJobs } from "./jobs";
import { bootstrapAnswerBody, bootstrapBatchBody, bootstrapBatchReply, bootstrapChatReply, bootstrapJob, bootstrapStartBody, carriedBootstrap, MIGRATED } from "./shapes";

export const BOOTSTRAP_CHAT_PATH = "/api/v1/chats/:chat/bootstrap";
export const BOOTSTRAP_PATH = "/api/v1/bootstrap";

export interface BootstrapRoutesDeps {
  jobs: BootstrapJobs;
  /** The chats the last migration carried for the user (imported, or imported again), by id. */
  carried(user: string): Promise<readonly string[]>;
  /** A list's page when the caller names none and the most one may ask: the turn area's page settings (`turns.page`, `turns.maxPage`). */
  sizes(): PageSizes;
}

export function bootstrapRoutes(deps: BootstrapRoutesDeps) {
  const sizes = deps.sizes;
  return [
    route({
      method: "POST",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      group: "jobs",
      does: "Starts a chat's bootstrap job (taking on a story with a past), with his choice of what to relive (a word the skill offers, or none) and his own token limit for this job if he sets one; a second start while one is under way begins a second job. A start that is refused is answered in words, with nothing started.",
      body: bootstrapStartBody,
      reply: jobView,
      handle: async ({ params, body, user }) => {
        const start = await deps.jobs.start(user, params.chat, { relive: body.relive ?? null, tokenLimit: body.tokenLimit ?? null });
        if ("refused" in start) throw new RouteError(start.refused.status, start.refused.why);
        return start.started;
      },
    }),
    route({
      method: "GET",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      group: "jobs",
      does: "A chat's bootstrap: the six facts of \"done enough\"; the start as it stands (whether the skill is in force, the relive words it offers, the token limit at which a job asks, how a cached token counts, and each cap on a bootstrap job's run); the chat's bootstrap jobs under way; and the question of each that waits for his word.",
      reply: bootstrapChatReply,
      handle: ({ params, user }) => deps.jobs.chat(user, params.chat),
    }),
    route({
      method: "GET",
      path: `${BOOTSTRAP_CHAT_PATH}/jobs`,
      access: "page",
      group: "jobs",
      does: "A chat's bootstrap jobs a page at a time, the newest started first, each with what it was given and how it stands or ended.",
      reply: shape.page(bootstrapJob),
      paged: { sizes },
      handle: ({ params, user, query }) => deps.jobs.jobs(user, params.chat, query.limit, query.after),
    }),
    route({
      method: "POST",
      path: `${BOOTSTRAP_CHAT_PATH}/:job/answer`,
      access: "page",
      group: "jobs",
      does: "His word to a bootstrap job of the chat that waits for it at its token limit: go on in its own session, asking again after `more` tokens (its token limit again when left out), or end with what it has.",
      body: bootstrapAnswerBody,
      reply: jobView,
      handle: async ({ params, body, user }) => {
        const answered = await deps.jobs.answer(user, params.chat, params.job, body.go === "end" ? { go: "end" } : { go: "on", more: body.more ?? null });
        if ("refused" in answered) throw new RouteError(answered.refused.status, answered.refused.why);
        return answered.started;
      },
    }),
    route({
      method: "GET",
      path: BOOTSTRAP_PATH,
      access: "page",
      group: "jobs",
      does: "The chats the last migration carried, a page at a time, each with how its bootstrap stands (no job yet, queued, held, running, waiting for his word, or ended), its newest bootstrap job, and that job's question when it waits.",
      reply: shape.page(carriedBootstrap),
      paged: { sizes },
      handle: async ({ user, query }) => {
        const chats = await deps.carried(user);
        const from = query.after === undefined ? 0 : chats.indexOf(query.after) + 1;
        if (query.after !== undefined && from === 0) throw new RouteError(409, `Chat ${query.after} is no longer among the chats the last migration carried: read the list again from its start.`);
        const page = chats.slice(from, from + query.limit);
        const items = await Promise.all(page.map((chat) => deps.jobs.carried(user, chat)));
        return { items, next: from + page.length < chats.length ? (page.at(-1) ?? null) : null };
      },
    }),
    route({
      method: "POST",
      path: BOOTSTRAP_PATH,
      access: "page",
      group: "jobs",
      does: "Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another, each with his choice of what to relive and his token limit if he sets one; says which started and which were refused, and why.",
      body: bootstrapBatchBody,
      reply: bootstrapBatchReply,
      handle: async ({ body, user }) => deps.jobs.startAll(user, body.chats === MIGRATED ? await deps.carried(user) : body.chats, { relive: body.relive ?? null, tokenLimit: body.tokenLimit ?? null }),
    }),
  ] as const;
}
