// What the pages read of RPE that the route table does not hold yet. Each entry is a route written as the
// generated types (`src/shared/api`) write one, as the page that needs it takes it, and was asked of the
// area that owns the route (the owner's note names which). A page reads it through `callWanted`, typed by
// the entry here; when the route lands in the generated types the entry goes and the page calls the route
// itself. Nothing here is a copy of a route that is in the table: a name the generated file holds is
// taken from it, and this file is the shorter for it.

import type { FactPrecision, FactSource, FactStanding, JsonValue, TurnId } from "../shared/api";
import { type CallOptions, type ParamsOf, replyOf, type RpeClient } from "./client";

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

/** A change of the store as a page lists it: whose, from where, how exact and how sure, and what it reported. */
export interface ChangeShown {
  id: string;
  turn: TurnId;
  /** Its turn's number on the chat's path. */
  n: number;
  /** When it was recorded, epoch milliseconds. */
  at: number;
  lane: "story" | "engine";
  /** The area that holds what it wrote: the story, the cast, the overlays or the engine. */
  area: string;
  op: string;
  /** What it changed, in a line. */
  words: string;
  /** The values it wrote, by key. */
  values: { [key: string]: JsonValue };
  by: string | null;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  source: FactSource | null;
  reports: string[];
}

/** One change that wrote a value (a field, a relation, a balance, a fact's key, an area item's part), newest first on its page. */
export interface ValueChangeShown extends ChangeShown {
  /** The value it left; null where it removed it. */
  value: string | null;
  /** Whether it wrote a typed value or a fact beside one. */
  kind: "value" | "fact";
  /** A fact stands beside a typed value; the turn of the later exact record that settled it, or null while it stands. */
  settledBy: TurnId | null;
}

export interface ValueHistoryReply {
  at: string;
  part: string;
  items: ValueChangeShown[];
  next: string | null;
}

/** One row of a typed system's view at a level: its label, its value, a note, and how exact and how sure it is. */
export interface SystemRowShown {
  label: string;
  value: string;
  note: string | null;
  precision: FactPrecision | null;
  standing: FactStanding | null;
}

/** One typed system's view at a level, as the system keeps it: its sections of rows (an account's postings and balance, a price, a thing's four facts, a group's ranks). */
export interface SystemShown {
  /** The system: economy, gear, groups, calendar, weather, vehicles, sheets. */
  system: string;
  title: string;
  sections: { title: string; rows: SystemRowShown[] }[];
}

export interface SystemsReply {
  at: string;
  systems: SystemShown[];
}

/** One thing a span of time brought due, with the outcome recorded for it. */
export interface DueShown {
  /** Its kind: arrival, schedule, routine, need, effect, future, price, weather, market. */
  kind: string;
  words: string;
  /** In-world time it fell due, as the world prints it. */
  when: string;
  /** The level it concerns; null where none. */
  at: string | null;
  /** What was recorded for it, in words; null while nothing was. */
  outcome: string | null;
}

export interface DueReply {
  turn: TurnId;
  /** The span of the turn, as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
}

/** A change that no longer applies on the swipe now showing, and why. */
export interface NotAppliedShown {
  change: string;
  turn: TurnId;
  n: number;
  op: string;
  words: string;
  reason: string;
}

export interface NotAppliedReply {
  /** The earlier reply that shows another swipe than its later turns were made on; null where none does. */
  reply: { turn: TurnId; n: number } | null;
  items: NotAppliedShown[];
}

/** One field of an owner's edit: set a value or a fact at a level, or remove it. */
export interface EditOpAsk {
  op: "set" | "remove";
  at: string;
  key: string;
  as: "value" | "fact";
  value?: string;
  precision?: FactPrecision;
  standing?: FactStanding;
}

export interface EditAsk {
  kind: "edit";
  ops: EditOpAsk[];
  /** Whether the next briefing tells the Author of it (the "Tell the story" choice). */
  tell: boolean;
}

export interface EditReply {
  applied: boolean;
  /** What the world's rules reported of it, listed under unsettled. */
  reports: string[];
  /** The id its Undo takes; null where nothing was recorded. */
  undo: string | null;
  words: string;
}

export interface UndoAsk {
  undo: string;
}

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

/** The routes asked for and not yet in the table, by their key. */
export interface WantedRoutes {
  "GET /api/v1/chats/:chat/state/history": WantedRoute<{ chat: string }, { at: string; part: string; turn?: TurnId; limit?: number; cursor?: string }, undefined, ValueHistoryReply>;
  "GET /api/v1/chats/:chat/state/systems": WantedRoute<{ chat: string }, { at: string; turn?: TurnId }, undefined, SystemsReply>;
  "GET /api/v1/chats/:chat/state/due": WantedRoute<{ chat: string }, { turn?: TurnId }, undefined, DueReply>;
  "GET /api/v1/chats/:chat/state/not-applied": WantedRoute<{ chat: string }, Record<string, never>, undefined, NotAppliedReply>;
  "POST /api/v1/chats/:chat/taps": WantedRoute<{ chat: string }, Record<string, never>, EditAsk, EditReply>;
  "POST /api/v1/chats/:chat/taps/undo": WantedRoute<{ chat: string }, Record<string, never>, UndoAsk, EditReply>;
}

export type WantedKey = keyof WantedRoutes;
