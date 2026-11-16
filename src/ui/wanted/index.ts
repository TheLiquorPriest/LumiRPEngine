// What the pages read of RPE that the route table does not hold yet. Each entry is a route written as the
// generated types (`src/shared/api`) write one, as the page that needs it takes it, and was asked of the
// area that owns the route (the owner's note names which). A page reads it through `callWanted`, typed by
// the entry here; when the route lands in the generated types the entry goes and the page calls the route
// itself. Nothing here is a copy of a route that is in the table: a name the generated file holds is
// taken from it, and this file is the shorter for it.

import { type CallOptions, type ParamsOf, replyOf, type RpeClient } from "../client";
import type { JobRoutes } from "./jobs";

export * from "./jobs";

/** One route as the generated types hold it. */
export interface WantedRoute<Params, Query, Body, Reply> {
  params: Params;
  query: Query;
  body: Body;
  reply: Reply;
  paged: boolean;
  long: boolean;
  joined: boolean;
}

/** The routes asked for and not yet in the table, by their key, each page's own together. */
export type WantedRoutes = JobRoutes;

export type WantedKey = keyof WantedRoutes;

/** Calls a wanted route as `client.call` calls one in the table, and answers what the entry says (a joined turn's answer is a refusal in words, as `replyOf` makes it). */
export async function callWanted<K extends WantedKey>(
  client: Pick<RpeClient, "call">,
  key: K,
  params: WantedRoutes[K]["params"],
  options: { query?: WantedRoutes[K]["query"]; body?: WantedRoutes[K]["body"] } = {},
): Promise<WantedRoutes[K]["reply"]> {
  const call = client.call as unknown as (key: string, params: ParamsOf<never>, options: CallOptions<never>) => Promise<unknown>;
  return replyOf((await call(key, params as ParamsOf<never>, options as CallOptions<never>)) as WantedRoutes[K]["reply"]);
}
