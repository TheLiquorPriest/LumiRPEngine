// What the Agents page reads of RPE that the route table does not hold yet (see ./index.ts): the `agents` routes, built in `src/agents/` and to be
// mounted by the composition; their types are RPH's own, which the routes mirror.

import type { DeclaredTools, ListedDefinition, RegisteredTool } from "rp-harness/contract";
import type { WantedRoute } from "./index";

export interface AgentsReply {
  chat: string | null;
  agents: ListedDefinition[];
}

export interface AgentToolsReply {
  agent: string;
  declared: Pick<DeclaredTools["tools"][number], "name" | "description">[];
  tokens: number;
  most: number;
  registered: RegisteredTool[];
}

/** The Agents page's routes. */
export interface AgentsRoutes extends GivenRoutes {
  "GET /api/v1/agents": WantedRoute<Record<string, never>, { chat?: string }, undefined, AgentsReply>;
  "GET /api/v1/agents/:agent/tools": WantedRoute<{ agent: string }, { chat?: string }, undefined, AgentToolsReply>;
}

/** One name a definition is given at the start of a run: what kind of thing it is, whose it is (RPH's or RPE's), and whether something provides it (null for RPH's own kinds, found at the run). */
export interface GivenName {
  name: string;
  kind: "file" | "chat" | "lore" | "prompt" | "world" | "story" | "cast" | "turn" | "index" | "ruleset" | "map" | "view";
  by: "rph" | "rpe";
  found: boolean | null;
}

export interface GivenReply {
  chat: string;
  turn: string | null;
  definitions: { name: string; off: boolean; given: GivenName[]; missing: string[] }[];
}

export interface GivenRoutes {
  /** What each definition in force for a chat is given by name, each resolved to what provides it. */
  "GET /api/v1/chats/:chat/given": WantedRoute<{ chat: string }, Record<string, never>, undefined, GivenReply>;
}
