// What the World page reads and sends: the tree at a level, a value's history, a level's typed systems,
// what a turn's time brought due, what no longer applies on another swipe, and the owner's own edit.

import type { ApiRoutes, DueReply, EditOpAsk, NotAppliedReply, SystemsReply, TapReply, TurnId, ValueChangeShown, WorldReply } from "../../../shared/api";
import { replyOf, type RpeClient } from "../../client";
import type { PageOf } from "../../reading";
import { errorWords } from "../../words";

/** Which values each level carries: none, its own (with what game systems keep), or all (with what it inherits). */
export type ValuesShown = NonNullable<ApiRoutes["GET /api/v1/chats/:chat/world"]["query"]["values"]>;

/** Where the page looks: a level by its ref, how many levels below it, which values each carries, and the turn the world stood at (null: the chat's head). */
export interface WorldQuery {
  at: string;
  depth: number;
  values: ValuesShown;
  turn: string | null;
}

/** Where the page starts: the whole world, one level in, each level with what it inherits too. */
export const WORLD_START: WorldQuery = { at: "world", depth: 1, values: "all", turn: null };

/** A read of the tree: RPE's answer, or its refusal in its own words. */
export type WorldResult = { answer: WorldReply; problem: null } | { answer: null; problem: string };

/** Reads the tree as `query` asks; what comes back after the returned function is called (the page asked again, or left) is let go. */
export function readWorld(client: Pick<RpeClient, "call">, chat: string, query: WorldQuery, onResult: (result: WorldResult) => void): () => void {
  let alive = true;
  const asked = { at: query.at, depth: query.depth, values: query.values, ...(query.turn === null ? {} : { turn: query.turn }) };
  client.call("GET /api/v1/chats/:chat/world", { chat }, { query: asked }).then(replyOf).then(
    (answer) => {
      if (alive) onResult({ answer, problem: null });
    },
    (error: unknown) => {
      if (alive) onResult({ answer: null, problem: errorWords(error) });
    },
  );
  return () => {
    alive = false;
  };
}

/** One page of a value's history, newest first, from `cursor` on. */
export async function readHistory(client: Pick<RpeClient, "call">, chat: string, at: string, part: string, turn: TurnId | null, cursor: string | undefined): Promise<PageOf<ValueChangeShown>> {
  const page = await client.call("GET /api/v1/chats/:chat/state/history", { chat }, { query: { at, part, ...(turn === null ? {} : { turn }), ...(cursor === undefined ? {} : { cursor }) } }).then(replyOf);
  return { items: page.items, next: page.next };
}

/** A level's typed systems, as they stand at the head or at a turn. */
export function readSystems(client: Pick<RpeClient, "call">, chat: string, at: string, turn: TurnId | null): Promise<SystemsReply> {
  return client.call("GET /api/v1/chats/:chat/state/systems", { chat }, { query: { at, ...(turn === null ? {} : { turn }) } }).then(replyOf);
}

/** What a turn's time brought due (the chat's newest turn when none is named). */
export function readDue(client: Pick<RpeClient, "call">, chat: string, turn: TurnId | null): Promise<DueReply> {
  return client.call("GET /api/v1/chats/:chat/state/due", { chat }, { query: turn === null ? {} : { turn } }).then(replyOf);
}

/** What no longer applies on the swipe an earlier reply now shows. */
export function readNotApplied(client: Pick<RpeClient, "call">, chat: string): Promise<NotAppliedReply> {
  return client.call("GET /api/v1/chats/:chat/state/not-applied", { chat }).then(replyOf);
}

/** The owner's own edit of a value or a fact: recorded as his change (source `player`), told to the Author at the next turn when `tell`. */
export function sendEdit(client: Pick<RpeClient, "call">, chat: string, op: EditOpAsk, tell: boolean): Promise<TapReply> {
  return client.call("POST /api/v1/chats/:chat/taps", { chat }, { body: { kind: "edit", ops: [op], tell } }).then(replyOf);
}

/** Takes an edit back, by the id its answer gave. */
export function sendUndo(client: Pick<RpeClient, "call">, chat: string, undo: string): Promise<TapReply> {
  return client.call("POST /api/v1/chats/:chat/edits/:edit/undo", { chat, edit: undo }).then(replyOf);
}
