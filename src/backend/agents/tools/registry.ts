// The agent tool registry (AGENT-LOOP-PLAN §6; INC1-SPEC C6): every tool LRE's agents may call, by
// family and tier, and `toolsFor`, which gives an agent its tools as the runtime takes them (R1's
// `AgentTool`). Each tool reads through one `ToolReadView` (`env.reader`, `tools/read-view.ts`),
// filtered by the agent's knowledge, and writes, at the GM tier, through `env.writer` (C7). A tool's
// description and each argument's are registry texts (`tool.<name>`, `tool.<name>.<path>`, Settings →
// Agents → Prompts, GM agent page, group "Tools"), sent in the user's own words where they wrote them;
// its JSON Schema is hand-written with the world's enums filled in (`tools/schema.ts`).

import type { AgentKnowledge, ToolFamily, ToolTier } from "../../../shared/agent-tools";
import { toolArgTextId, toolText, toolTextId } from "../../../shared/agent-tools";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject } from "../../../shared/json";
import type { PromptTexts } from "../../../shared/prompts";
import type { WorldDoc } from "../../../shared/world";
import { renderPrompt } from "../../prompts";
import type { AgentTool, ToolOutcome } from "../runtime";
import { LORE_TOOLS } from "./lore";
import { READ_TOOLS } from "./read";
import type { ToolReader } from "./read-view";
import { schemaWorld } from "./schema";
import { WORKSPACE_TOOLS } from "./workspace";
import { WRITE_TOOLS } from "./write";
import type { ToolWriter } from "./writer";

export type { AgentKnowledge, ToolFamily, ToolTier } from "../../../shared/agent-tools";

/**
 * What a tool runs with: whose chat, the agent's knowledge, where it reads (`reader`: outside a turn
 * the chat's head, `outsideReader`) and writes (`writer`, null for an agent that may not write), who
 * calls, and a signal that ends when the agent is cancelled or its time runs out.
 */
export interface ToolEnv {
  userId: UserId;
  chatId: ChatId;
  knowledge: AgentKnowledge;
  reader: ToolReader;
  writer: ToolWriter | null;
  agent: { role: string; id: string };
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  family: ToolFamily;
  tier: ToolTier;
  /** Its description is the registry text `tool.<name>` (R5, GM agent page, group "Tools"): editable, with a reset. */
  parameters(world: WorldDoc): JsonObject; // hand-written JSON Schema, with the world's enums filled in
  run(args: JsonObject, env: ToolEnv): Promise<ToolOutcome>;
}

/** Every tool, in the order the Prompts page lists their texts: the read families, then the writes, the workspace and the lore. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [...READ_TOOLS, ...WRITE_TOOLS, ...WORKSPACE_TOOLS, ...LORE_TOOLS];

/** The property at a dotted path of a schema, through nested `properties` and an array's `items`; null where the schema has none. */
function propertyAt(schema: JsonObject, path: string): JsonObject | null {
  let at: JsonObject | null = schema;
  for (const key of path.split(".")) {
    const items: unknown = at?.items;
    const holder: unknown = at?.type === "array" && isRecord(items) ? items : at;
    const properties: unknown = isRecord(holder) ? holder.properties : undefined;
    const next: unknown = isRecord(properties) ? properties[key] : undefined;
    at = isRecord(next) ? (next as JsonObject) : null;
  }
  return at;
}

/** `schema` with each argument's description, in the user's words where they wrote one; a tool whose texts name an argument its schema lacks is a bug, and says so. */
function described(def: ToolDefinition, schema: JsonObject, texts: PromptTexts): JsonObject {
  const out = structuredClone(schema);
  for (const arg of toolText(def.name)?.args ?? []) {
    const property = propertyAt(out, arg.path);
    if (!property) throw new Error(`the ${def.name} tool's texts describe an argument its schema doesn't have: ${arg.path}`);
    property.description = renderPrompt(toolArgTextId(def.name, arg.path), texts, {});
  }
  return out;
}

/**
 * The tools an agent is given (C6): those of `tiers`, and of `families` when it names any, each
 * with its description and its arguments' in `texts` (the user's own where they wrote one, else the
 * shipped), and its schema filled from the world as the agent may name it (`schemaWorld`). A call
 * runs with `env` as it stands then, the agent named by the runtime and ended by its signal too.
 */
export function toolsFor(input: { world: WorldDoc; tiers: readonly ToolTier[]; families?: readonly ToolFamily[]; texts: PromptTexts; env: ToolEnv }): AgentTool[] {
  const { env, texts } = input;
  const world = schemaWorld(input.world, env.reader.registry, env.knowledge);
  return TOOL_DEFINITIONS.filter((def) => input.tiers.includes(def.tier) && (input.families === undefined || input.families.includes(def.family))).map(
    (def): AgentTool => ({
      name: def.name,
      description: renderPrompt(toolTextId(def.name), texts, {}),
      parameters: described(def, def.parameters(world), texts),
      run: (args, ctx) => def.run(args, { ...env, agent: { role: ctx.role, id: ctx.agentId }, signal: AbortSignal.any([env.signal, ctx.signal]) }),
    }),
  );
}
