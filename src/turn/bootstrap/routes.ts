// The bootstrap's routes (plan §12, §14): a chat's page starts its bootstrap job and reads the six facts
// with the chat's bootstrap jobs; the Migration page starts the job for the chats it names, or for every
// chat the migration carried, one after another. Every route is a page's: it answers only for the user
// this RPE belongs to. A start that is refused is answered in words, with nothing started.

import { route, RouteError } from "../../app";
import { isRecord } from "../../shared/json";
import type { BootstrapJobs } from "./jobs";

export const BOOTSTRAP_CHAT_PATH = "/api/v1/chats/:chat/bootstrap";
export const BOOTSTRAP_PATH = "/api/v1/bootstrap";

/** What `POST /api/v1/bootstrap` takes in place of a list for every chat the migration carried. */
export const MIGRATED = "migrated";

export interface BootstrapRoutesDeps {
  jobs: BootstrapJobs;
  /** The chats the last migration carried for the user (imported, or imported again), by id. */
  carried(user: string): Promise<readonly string[]>;
}

/** The player's choice of what to relive, as given: a word the bootstrap skill offers, or null when none was given. */
function reliveOf(value: Record<string, unknown>): string | null {
  const { relive } = value;
  if (relive === undefined || relive === null) return null;
  if (typeof relive !== "string" || relive.trim() === "") throw new RouteError(400, "relive, when given, is one of the words the bootstrap skill offers for reliving the past, as text.");
  return relive;
}

export function bootstrapRoutes(deps: BootstrapRoutesDeps) {
  return [
    route({
      method: "POST",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      body: (value): { relive: string | null } => {
        if (!isRecord(value)) throw new RouteError(400, "The body is a JSON object, with relive when the player chose what to relive.");
        return { relive: reliveOf(value) };
      },
      handle: async ({ params, body, user }) => {
        const start = await deps.jobs.start(user, params.chat, body.relive);
        if ("refused" in start) throw new RouteError(start.refused.status, start.refused.why);
        return start.started;
      },
    }),
    route({
      method: "GET",
      path: BOOTSTRAP_CHAT_PATH,
      access: "page",
      handle: ({ params, user }) => deps.jobs.chat(user, params.chat),
    }),
    route({
      method: "POST",
      path: BOOTSTRAP_PATH,
      access: "page",
      body: (value): { chats: readonly string[] | typeof MIGRATED; relive: string | null } => {
        const chats = isRecord(value) ? value.chats : undefined;
        if (!isRecord(value) || !(chats === MIGRATED || (Array.isArray(chats) && chats.every((c) => typeof c === "string" && c.trim() !== "")))) {
          throw new RouteError(400, `The body is a JSON object whose chats are a list of chat ids, or "${MIGRATED}" for every chat the migration carried.`);
        }
        return { chats: chats as readonly string[] | typeof MIGRATED, relive: reliveOf(value) };
      },
      handle: async ({ body, user }) => deps.jobs.startAll(user, body.chats === MIGRATED ? await deps.carried(user) : body.chats, body.relive),
    }),
  ];
}
