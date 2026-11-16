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
import { TREE_DEFAULTS } from "./settings";

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
  /** The chat's limits (`suggestions.openMost`, `suggestions.decidedKept`), as its levels' config files set them; the defaults where absent. */
  limits?(user: string, chat: string): Promise<{ openMost: number; decidedKept: number }>;
}

/** What filing a suggestion came to: kept, with its id; or not kept, because the chat's open suggestions are at their limit. */
export type SuggestionFiled = { kept: true; id: number } | { kept: false; openMost: number };

/** The decided suggestions of a chat past the `kept` newest, by the decision's time: their count and bytes, and their removal. */
const DECIDED_PAST = {
  count: "SELECT count(*) AS n, sum(length(text) + length(reason)) AS bytes FROM suggestion WHERE user = ?1 AND chat = ?2 AND state <> 'open' AND id NOT IN (SELECT id FROM suggestion WHERE user = ?1 AND chat = ?2 AND state <> 'open' ORDER BY decided DESC, id DESC LIMIT ?3)",
  delete: "DELETE FROM suggestion WHERE user = ?1 AND chat = ?2 AND state <> 'open' AND id NOT IN (SELECT id FROM suggestion WHERE user = ?1 AND chat = ?2 AND state <> 'open' ORDER BY decided DESC, id DESC LIMIT ?3)",
} as const;

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

  async #limits(user: string, chat: string): Promise<{ openMost: number; decidedKept: number }> {
    return (await this.#d.limits?.(user, chat)) ?? { openMost: TREE_DEFAULTS.suggestionsOpenMost, decidedKept: TREE_DEFAULTS.suggestionsDecidedKept };
  }

  /**
   * Keeps a suggestion an agent filed, unless the chat's open ones are at their limit (`suggestions.openMost`), in which case it is not
   * kept and the limit is said, whatever the suggestion says; null for one of lore, which is not the tree's.
   */
  async file(scope: Scope, agent: AgentRef, suggestion: Suggestion): Promise<SuggestionFiled | null> {
    if (!("file" in suggestion.target)) return null;
    const path = suggestion.target.file;
    const { openMost } = await this.#limits(scope.user, scope.chat);
    return await this.#d.writes.run((db): SuggestionFiled => {
      const open = db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM suggestion WHERE user = ? AND chat = ? AND state = 'open'").get(scope.user, scope.chat)?.n ?? 0;
      if (open >= openMost) return { kept: false, openMost };
      const id = Number(db.run("INSERT INTO suggestion (user, chat, turn, agent, path, text, reason, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')", [scope.user, scope.chat, scope.turn ?? null, JSON.stringify(agent), path, suggestion.text, suggestion.reason, this.#d.now()]).lastInsertRowid);
      return { kept: true, id };
    }, "keeping an agent's suggestion");
  }

  /** A chat's suggestions (every chat's when none is named), newest first; only those in `state` when it is given. */
  list(user: string, chat: string | null, state?: SuggestionState): TreeSuggestion[] {
    return this.#d.db
      .query<SuggestionRow, [string, string | null, string | null]>("SELECT id, chat, turn, agent, path, text, reason, at, state, decided FROM suggestion WHERE user = ?1 AND (?2 IS NULL OR chat = ?2) AND (?3 IS NULL OR state = ?3) ORDER BY id DESC")
      .all(user, chat, state ?? null)
      .map(suggestionOf);
  }

  one(user: string, id: number): TreeSuggestion | null {
    const row = this.#d.db.query<SuggestionRow, [string, number]>("SELECT id, chat, turn, agent, path, text, reason, at, state, decided FROM suggestion WHERE user = ? AND id = ?").get(user, id);
    return row === null ? null : suggestionOf(row);
  }

  /** Decides an open suggestion; false when it is not open (decided already, or none). The chat's decided suggestions are then kept to its setting, the oldest going. */
  async decide(user: string, id: number, state: Exclude<SuggestionState, "open">): Promise<boolean> {
    const chat = this.one(user, id)?.chat;
    const kept = chat === undefined ? null : (await this.#limits(user, chat)).decidedKept;
    return await this.#d.writes.run((db) => {
      const decided = db.run("UPDATE suggestion SET state = ?, decided = ? WHERE user = ? AND id = ? AND state = 'open'", [state, this.#d.now(), user, id]).changes === 1;
      if (decided && chat !== undefined && kept !== null) db.run(DECIDED_PAST.delete, [user, chat, kept]);
      return decided;
    }, "deciding a suggestion");
  }

  /** The decided suggestions of a chat past the `kept` newest, and the bytes they hold: what pruning them takes. */
  decidedPast(user: string, chat: string, kept: number): { count: number; bytes: number } {
    const row = this.#d.db.query<{ n: number; bytes: number | null }, [string, string, number]>(DECIDED_PAST.count).get(user, chat, kept);
    return { count: row?.n ?? 0, bytes: row?.bytes ?? 0 };
  }

  /** Lets go of a chat's decided suggestions past the `kept` newest; open ones never. How many went. */
  async pruneDecided(user: string, chat: string, kept: number): Promise<number> {
    return await this.#d.writes.run((db) => db.run(DECIDED_PAST.delete, [user, chat, kept]).changes, "pruning decided suggestions");
  }

  /** Opens a suggestion again: its acceptance could not be written. */
  async reopen(user: string, id: number): Promise<void> {
    await this.#d.writes.run((db) => db.run("UPDATE suggestion SET state = 'open', decided = NULL WHERE user = ? AND id = ?", [user, id]), "opening a suggestion again");
  }
}
