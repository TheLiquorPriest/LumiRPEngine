// Agents' suggestions (plan §5.1, §5.2): when an agent thinks an instruction or a rule should change, it
// files a suggestion through RPH (`TurnEvents.suggestion`): the file, the proposed text, and its reason.
// It is kept here and shown on the Files page, where the user accepts it as it is or edited, or
// dismisses it. Accepting writes the file as the user (the Files page's routes); nothing here writes a
// file, and no agent can reach a decision. A new chat's suggested `WORLD.md`, `SIMULATION.md` and
// `WRITING.md` arrive the same way. A suggestion for lore is the lore's, not the tree's.

import type { Database } from "bun:sqlite";
import type { AgentRef, Scope, Suggestion } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { TreeWrites } from "./chats";

export type SuggestionState = "open" | "accepted" | "dismissed";
export const SUGGESTION_STATES: readonly SuggestionState[] = ["open", "accepted", "dismissed"];

/** A suggestion as the Files page shows it. */
export interface TreeSuggestion {
  id: number;
  chat: string;
  /** The turn it was filed in; null for one filed outside a turn. */
  turn: string | null;
  agent: AgentRef;
  /** The file it would change, as the agent named it in the chat's view. */
  path: string;
  /** The proposed text, whole. */
  text: string;
  reason: string;
  at: number;
  state: SuggestionState;
  /** When the user accepted or dismissed it; null while open. */
  decided: number | null;
}

export interface SuggestionsDeps {
  db: Database;
  writes: TreeWrites;
  now(): number;
}

interface SuggestionRow {
  id: number;
  chat: string;
  turn: string | null;
  agent: string;
  path: string;
  text: string;
  reason: string;
  at: number;
  state: SuggestionState;
  decided: number | null;
}

function suggestionOf(row: SuggestionRow): TreeSuggestion {
  const agent: unknown = JSON.parse(row.agent);
  if (!isRecord(agent) || typeof agent.id !== "string" || typeof agent.definition !== "string") throw new Error(`Suggestion ${row.id} names no agent RPE kept.`);
  return { ...row, agent: { id: agent.id, definition: agent.definition, ...(typeof agent.parent === "string" ? { parent: agent.parent } : {}) } };
}

export class TreeSuggestions {
  readonly #d: SuggestionsDeps;

  constructor(deps: SuggestionsDeps) {
    this.#d = deps;
  }

  /** Keeps a suggestion an agent filed; null for one of lore, which is not the tree's. */
  async file(scope: Scope, agent: AgentRef, suggestion: Suggestion): Promise<number | null> {
    if (!("file" in suggestion.target)) return null;
    const path = suggestion.target.file;
    return await this.#d.writes.run(
      (db) =>
        Number(
          db.run("INSERT INTO tree_suggestion (user, chat, turn, agent, path, text, reason, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')", [scope.user, scope.chat, scope.turn ?? null, JSON.stringify(agent), path, suggestion.text, suggestion.reason, this.#d.now()]).lastInsertRowid,
        ),
      "keeping an agent's suggestion",
    );
  }

  /** A chat's suggestions (every chat's when none is named), newest first; only those in `state` when it is given. */
  list(user: string, chat: string | null, state?: SuggestionState): TreeSuggestion[] {
    return this.#d.db
      .query<SuggestionRow, [string, string | null, string | null]>("SELECT id, chat, turn, agent, path, text, reason, at, state, decided FROM tree_suggestion WHERE user = ?1 AND (?2 IS NULL OR chat = ?2) AND (?3 IS NULL OR state = ?3) ORDER BY id DESC")
      .all(user, chat, state ?? null)
      .map(suggestionOf);
  }

  one(user: string, id: number): TreeSuggestion | null {
    const row = this.#d.db.query<SuggestionRow, [string, number]>("SELECT id, chat, turn, agent, path, text, reason, at, state, decided FROM tree_suggestion WHERE user = ? AND id = ?").get(user, id);
    return row === null ? null : suggestionOf(row);
  }

  /** Decides an open suggestion; false when it is not open (decided already, or none). */
  async decide(user: string, id: number, state: Exclude<SuggestionState, "open">): Promise<boolean> {
    return await this.#d.writes.run((db) => db.run("UPDATE tree_suggestion SET state = ?, decided = ? WHERE user = ? AND id = ? AND state = 'open'", [state, this.#d.now(), user, id]).changes === 1, "deciding a suggestion");
  }

  /** Opens a suggestion again: its acceptance could not be written. */
  async reopen(user: string, id: number): Promise<void> {
    await this.#d.writes.run((db) => db.run("UPDATE tree_suggestion SET state = 'open', decided = NULL WHERE user = ? AND id = ?", [user, id]), "opening a suggestion again");
  }
}
