// What the Rules page reads of RPE that the route table does not hold yet (see ./index.ts); asked of O3TurnDoor (the `rules` route group, Turn-14).
// The types are RPH's own, which the routes mirror: a rule as its list gives it, a rule run against a past turn, and a fact with its value.

import type { FactValue, ListedFact, RuleTest, RuleView } from "rp-harness/contract";
import type { RuleFiring, TurnId } from "../../shared/api";
import type { WantedRoute } from "./index";

/** A rule as RPH's list gives it (`why` and `judge` as RPH's newest list says them: a question rule that cannot be put). */
export type RuleShown = Omit<RuleView, "why"> & { why?: NonNullable<RuleView["why"]> | "judge"; judge?: "part" | "yes" | "connection" };

export interface RulesReply {
  chat: string | null;
  rules: RuleShown[];
}

/** A fact a trigger can use, with its value for the chat open (null: no chat open, or none to give) and the names of the rules that name it. */
export interface FactShown extends ListedFact {
  value: FactValue | null;
  rules: string[];
}

/** One firing of a rule, with where it was: the turn, the run and the job or talk it was in. */
export interface FiringShown extends RuleFiring {
  id: string;
  at: number;
  turn: TurnId | null;
  run: string;
  job: string | null;
  talk: string | null;
}

export interface FiringsReply {
  items: FiringShown[];
  next: string | null;
}

/** The Rules page's routes. */
export interface RulesRoutes {
  /** Every rule of a chat's stack, in force or not and why; with no chat, the shipped and global levels as a new chat takes them. */
  "GET /api/v1/rules": WantedRoute<Record<string, never>, { chat?: string }, undefined, RulesReply>;
  /** Switches a rule on or off at the chat's or the global level (RPH's `rules.switch`); answers the rule as it then stands. */
  "POST /api/v1/rules/:name/switch": WantedRoute<{ name: string }, Record<string, never>, { on: boolean; level: "chat" | "global"; chat?: string }, { rule: RuleShown }>;
  /** Every fact a rule can name, RPH's and the host's, with its value for the chat open and the rules that name it. */
  "GET /api/v1/rules/facts": WantedRoute<Record<string, never>, { chat?: string }, undefined, { facts: FactShown[] }>;
  /** What fired in the chat's runs, turns', jobs' and talks', newest first, a page at a time; one rule's when it is named. */
  "GET /api/v1/chats/:chat/rules/firings": WantedRoute<{ chat: string }, { rule?: string; limit?: number; cursor?: string }, undefined, FiringsReply>;
  /** Runs a rule as its file stands against a past turn of the chat; writes nothing. */
  "POST /api/v1/chats/:chat/rules/:name/test": WantedRoute<{ chat: string; name: string }, Record<string, never>, { turn: TurnId }, RuleTest>;
}
