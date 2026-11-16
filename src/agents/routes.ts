// The Agents page's routes (plan §4.4 "agents", §14 Agents): every definition in force for a chat, or for none (the shipped and global levels as a
// new chat takes them), as RPH's own list gives it, with what each runs on among the user's connections (its connection, its model, its effort), its
// tools, what it reads and what it is given; and for one agent the fixed list its requests carry, as declared, beside every tool the registry holds,
// so a tool nobody registers is plain. Its stack is the Files page's `files-stack`; its edits are the tree's own file routes. Every route is a
// page's: it answers only for the user this RPE belongs to.

import type { DeclaredTools, DefinitionRun, ListedDefinition, RegisteredTool, Scope } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, shape } from "../app";
import { effort, layerLevel } from "../app/live";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const nullable = shape.nullable;

const toolsAs = shape.named("ToolsAs", "How a definition's tools are offered to its model: as the connection does best (`auto`), as native tool calls, or as text.", shape.oneOf("auto", "native", "text"));

const runsOn = shape.named(
  "DefinitionRun",
  "What a definition runs on, resolved among the user's connections for the chat it is listed for: the connection its header names (his default where it names none), that connection's model, and the effort it thinks at: its definition's, else its connection's own.",
  shape.object({ connection: nullable(shape.object({ id: T, name: T })), model: nullable(T), effort: nullable(effort) }),
);
type RunMirrored = Holds<Exactly<Infer<typeof runsOn>, DefinitionRun>>;

const agentShown = shape.named(
  "AgentShown",
  "A definition in force for a chat, as RPH lists it: its file and level, the farther files it replaces, whether it is switched off, its profile and effort as its header says them, how its tools are offered, its fixed tools, the instruction files it reads and what it is given at a run's start, the definition its reply goes to a writer through, and what it runs on.",
  shape.object({
    name: T,
    description: T,
    path: T,
    level: layerLevel,
    replaces: shape.list(shape.object({ level: layerLevel, path: T })),
    off: shape.yesNo(),
    model: opt(T),
    effort: opt(effort),
    toolsAs: opt(toolsAs),
    tools: shape.list(T),
    reads: shape.list(T),
    given: shape.list(T),
    writer: opt(T),
    runsOn,
  }),
);
type AgentMirrored = Holds<Exactly<Infer<typeof agentShown>, ListedDefinition>>;

const agentsReply = shape.named("AgentsReply", "Every definition in force for a chat, or for none: the shipped and global levels as a new chat takes them.", shape.object({ chat: nullable(T), agents: shape.list(agentShown) }));

const registeredTool = shape.named(
  "RegisteredTool",
  "A tool the registry holds for a chat: its name, its family, and whose it is: RPH's own, the host's, or his own from a manifest.",
  shape.object({ name: T, family: T, from: shape.oneOf("rph", "host", "owner") }),
);
type RegisteredMirrored = Holds<Exactly<Infer<typeof registeredTool>, RegisteredTool>>;

const toolsReply = shape.named(
  "AgentToolsReply",
  "What an agent's requests carry as its fixed list for a chat, as declared (each tool's name and description), the whole's size in tokens against the most the user allows (`tools.fixedTokens`; a list over it is marked, nothing is refused), and every tool the registry holds.",
  shape.object({
    agent: T,
    declared: shape.list(shape.object({ name: T, description: T })),
    tokens: N,
    most: N,
    registered: shape.list(registeredTool),
  }),
);

export type Mirrors = [RunMirrored, AgentMirrored, RegisteredMirrored];

/** What the routes take from the harness and the application: RPH's definitions, and the scope it asks a chat's in (a chat of none being the user's shipped and global levels). */
export interface AgentsRoutesDeps {
  definitions: { list(scope: Scope): Promise<ListedDefinition[]>; declared(scope: Scope, agent: string): Promise<DeclaredTools>; tools(scope: Scope): Promise<RegisteredTool[]> };
  scope(user: string, chat: string | null): Scope;
}

const chatQuery = opt(shape.text({ blank: false }), "The chat whose stack of definitions is read; left out, the shipped level and the user's own.");

export function agentsRoutes(deps: AgentsRoutesDeps) {
  return [
    route({
      method: "GET",
      path: "/api/v1/agents",
      access: "page",
      group: "agents",
      does: "Every definition in force for a chat, or for none: its file, level, what it replaces, whether it is off, its tools, what it reads and is given, and what it runs on (its connection, its model and its effort) as RPH resolves them.",
      query: { chat: chatQuery },
      reply: agentsReply,
      handle: async ({ user, query }) => ({ chat: query.chat ?? null, agents: await deps.definitions.list(deps.scope(user, query.chat ?? null)) }),
    }),
    route({
      method: "GET",
      path: "/api/v1/agents/:agent/tools",
      access: "page",
      group: "agents",
      does: "The fixed list of tools an agent's requests carry in a chat, as declared and counted in tokens, and every tool the registry holds there, so one a definition lists and nobody registers can be told.",
      query: { chat: chatQuery },
      reply: toolsReply,
      handle: async ({ user, params, query }) => {
        const at = deps.scope(user, query.chat ?? null);
        const [declared, registered] = await Promise.all([deps.definitions.declared(at, params.agent), deps.definitions.tools(at)]);
        return { agent: params.agent, declared: declared.tools.map((t) => ({ name: t.name, description: t.description })), tokens: declared.tokens, most: declared.most, registered };
      },
    }),
  ];
}
